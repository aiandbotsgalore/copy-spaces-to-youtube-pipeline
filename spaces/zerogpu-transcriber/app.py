#!/usr/bin/env python3
"""
spaces/zerogpu-transcriber/app.py

Production Hugging Face ZeroGPU Transcriber & Re-Diarizer.
Decoupled CPU orchestrator with per-chunk @spaces.GPU(duration=120) workers,
lazy model initialization, token authentication, host allowlisting,
and ephemeral directory cleanup.
"""

import os
import sys
import json
import time
import shutil
import tempfile
import subprocess
import urllib.parse
import urllib.request
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple

os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

# ZeroGPU decorator initialization
try:
    import spaces
    if not hasattr(spaces, "GPU"):
        raise ImportError("Namespace package collision without GPU attribute")
except (ImportError, AttributeError):
    class _MockSpaces:
        @staticmethod
        def GPU(duration=120):
            def decorator(fn):
                return fn
            return decorator
    spaces = _MockSpaces()

import numpy as np

# Canonical core functions
from spacepipe_transcribe_core import (
    condition_audio_to_16k_mono,
    detect_silence_cut_points,
    subtract_crosstalk_intervals,
    cluster_speaker_embeddings,
    match_biometrics_1to1,
    project_diarization_onto_segments,
    compute_transcript_text_hash,
    reconcile_chunk_speakers,
)

ALLOWED_HOSTS = {
    "github.com",
    "objects.githubusercontent.com",
    "raw.githubusercontent.com",
    "huggingface.co",
    "cdn-lfs.huggingface.co",
    "archive.org",
    "cf-ipfs.com"
}

# Lazy singletons for GPU workers
_WHISPER_MODEL = None
_DIARIZATION_PIPELINE = None
_SPEECHBRAIN_MODEL = None


def validate_api_key(api_key: Optional[str]) -> bool:
    expected = os.environ.get("SPACE_API_KEY", "").strip()
    if not expected:
        return True  # Open if no key configured in Space secrets
    if not api_key:
        return False
    return str(api_key).strip() == expected


def validate_audio_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    hostname = (parsed.hostname or "").lower()
    if hostname not in ALLOWED_HOSTS and not any(hostname.endswith("." + h) for h in ALLOWED_HOSTS):
        raise ValueError(f"Audio host '{hostname}' not permitted by Space allowlist.")
    return url


def download_file_streamed(url: str, dest_path: str):
    validate_audio_url(url)
    req = urllib.request.Request(url, headers={"User-Agent": "SpacePipe-ZeroGPU/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp, open(dest_path, "wb") as f:
        shutil.copyfileobj(resp, f, length=1024 * 1024)


# ==========================================
# Per-Chunk GPU Workers (@spaces.GPU)
# ==========================================

@spaces.GPU(duration=120)
def _gpu_transcribe_chunk(chunk_path: str, model_size: str = "large-v3-turbo") -> List[Dict[str, Any]]:
    """
    Transcribes a single audio chunk on GPU.
    CTranslate2 / faster-whisper is initialized inside GPU lease to avoid container boot crash.
    All outputs returned as plain Python structures (no CUDA tensors).
    """
    global _WHISPER_MODEL
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise RuntimeError("faster-whisper is unavailable; transcription was not performed") from exc

    if _WHISPER_MODEL is None:
        # Pre-cached or lazy init inside GPU context
        _WHISPER_MODEL = WhisperModel(model_size, device="cuda", compute_type="float16")

    try:
        import soundfile as sf
        audio_input, sr = sf.read(chunk_path, dtype="float32")
    except Exception:
        audio_input = chunk_path

    segments_gen, info = _WHISPER_MODEL.transcribe(
        audio_input,
        beam_size=5,
        word_timestamps=True,
        vad_filter=True
    )

    results = []
    for s in segments_gen:
        words = []
        if s.words:
            for w in s.words:
                words.append({
                    "word": w.word,
                    "start": float(w.start),
                    "end": float(w.end),
                    "score": float(w.probability)
                })
        results.append({
            "start": float(s.start),
            "end": float(s.end),
            "text": s.text,
            "words": words
        })
    return results


@spaces.GPU(duration=120)
def _gpu_diarize_chunk(
    chunk_path: str,
    min_speakers: int = 1,
    max_speakers: int = 15
) -> Dict[str, Any]:
    """
    Runs PyAnnote diarization and SpeechBrain ECAPA-TDNN embedding extraction on GPU.
    Converts all embeddings to CPU NumPy / Python float lists before returning
    to prevent CUDA tensor IPC pickling errors across the process boundary.
    """
    global _DIARIZATION_PIPELINE, _SPEECHBRAIN_MODEL
    hf_token = os.environ.get("HF_TOKEN")

    try:
        import torch
        from pyannote.audio import Pipeline
        from speechbrain.inference.speaker import EncoderClassifier
    except ImportError as exc:
        raise RuntimeError("Diarization dependencies unavailable; no speaker evidence generated") from exc

    if not hf_token:
        raise RuntimeError("HF_TOKEN is required for the gated diarization model")
    device = os.environ.get("SPACEPIPE_DIARIZATION_DEVICE", "cuda")
    if device not in ("cpu", "cuda"):
        raise ValueError("SPACEPIPE_DIARIZATION_DEVICE must be cpu or cuda")

    if _DIARIZATION_PIPELINE is None and hf_token:
        _DIARIZATION_PIPELINE = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            token=hf_token
        ).to(torch.device(device))

    if _SPEECHBRAIN_MODEL is None:
        _SPEECHBRAIN_MODEL = EncoderClassifier.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            savedir=os.environ.get("SPACEPIPE_ECAPA_CACHE", "tmp_speechbrain"),
            run_opts={"device": device}
        )

    # In-memory input also works on Windows without FFmpeg shared DLLs.
    import soundfile as sf
    audio_data, sr = sf.read(chunk_path, dtype="float32")
    diarization_input = {"waveform": torch.from_numpy(audio_data).unsqueeze(0), "sample_rate": sr}
    diarization = _DIARIZATION_PIPELINE(
        diarization_input,
        min_speakers=min_speakers,
        max_speakers=max_speakers
    )

    annotation = getattr(diarization, "speaker_diarization", diarization)

    turns = []
    for turn, _, speaker in annotation.itertracks(yield_label=True):
        turns.append({
            "speaker": speaker,
            "start": float(turn.start),
            "end": float(turn.end)
        })

    # Subtract crosstalk before embedding extraction
    clean_intervals = subtract_crosstalk_intervals(turns, min_duration_sec=1.5)

    # Extract 192-dim ECAPA embeddings from the same conditioned waveform.

    speaker_embs: Dict[str, List[List[float]]] = {}
    for item in clean_intervals:
        spk = item["speaker"]
        s_idx = int(item["start"] * sr)
        e_idx = int(item["end"] * sr)
        wav_slice = audio_data[s_idx:e_idx]
        if len(wav_slice) < int(1.5 * sr):
            continue

        wav_t = torch.tensor(wav_slice, dtype=torch.float32).unsqueeze(0).to(device)
        emb = _SPEECHBRAIN_MODEL.encode_batch(wav_t)
        
        # Convert CUDA tensor to CPU list[float]
        emb_cpu = emb.squeeze().detach().cpu().numpy().tolist()
        if spk not in speaker_embs:
            speaker_embs[spk] = []
        speaker_embs[spk].append(emb_cpu)

    # Average embeddings per speaker
    averaged_embs: Dict[str, List[float]] = {}
    for spk, embs in speaker_embs.items():
        arr = np.array(embs, dtype=np.float32)
        mean_vec = np.mean(arr, axis=0)
        norm = np.linalg.norm(mean_vec)
        if norm > 0:
            mean_vec = mean_vec / norm
        averaged_embs[spk] = mean_vec.tolist()

    return {
        "turns": turns,
        "embeddings": averaged_embs
    }


# ==========================================
# Top-Level CPU Orchestrators
# ==========================================

def transcribe_endpoint(
    audio_url: str,
    api_key: str = "",
    min_speakers: int = 1,
    max_speakers: int = 15
) -> str:
    """
    Top-level CPU orchestrator for /transcribe.
    Streams audio, conditions PCM, slices chunks on CPU, invokes per-chunk GPU workers,
    and clusters/matches biometrics on CPU. Cleans up all files in tempfile.TemporaryDirectory.
    """
    if not validate_api_key(api_key):
        return json.dumps({"error": "Unauthorized: invalid SPACE_API_KEY"}, indent=2)

    try:
        with tempfile.TemporaryDirectory() as temp_dir:
            raw_audio = os.path.join(temp_dir, "input_audio")
            conditioned_wav = os.path.join(temp_dir, "conditioned.wav")

            download_file_streamed(audio_url, raw_audio)
            condition_audio_to_16k_mono(raw_audio, conditioned_wav)

            cut_points = detect_silence_cut_points(conditioned_wav, max_chunk_sec=1800.0)

            all_segments: List[Dict[str, Any]] = []
            all_turns: List[Dict[str, Any]] = []
            cluster_embs: Dict[str, List[float]] = {}

            curr_offset = 0.0
            for i, cut_time in enumerate(cut_points):
                chunk_len = cut_time - curr_offset
                if chunk_len <= 0.5:
                    continue

                chunk_wav = os.path.join(temp_dir, f"chunk_{i}.wav")
                ffmpeg_bin = shutil.which("ffmpeg") or "ffmpeg"
                cmd = [
                    ffmpeg_bin, "-y",
                    "-ss", str(curr_offset),
                    "-t", str(chunk_len),
                    "-i", conditioned_wav,
                    "-c", "copy",
                    chunk_wav
                ]
                subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)

                # Run GPU transcribe chunk
                chunk_segs = _gpu_transcribe_chunk(chunk_wav)
                for s in chunk_segs:
                    s["start"] += curr_offset
                    s["end"] += curr_offset
                    for w in s.get("words", []):
                        w["start"] += curr_offset
                        w["end"] += curr_offset
                    all_segments.append(s)

                # Run GPU diarize chunk
                diar_res = _gpu_diarize_chunk(chunk_wav, min_speakers, max_speakers)
                for t in diar_res.get("turns", []):
                    t["speaker"] = f"chunk{i}_{t['speaker']}"
                    t["start"] += curr_offset
                    t["end"] += curr_offset
                    all_turns.append(t)

                for spk, emb in diar_res.get("embeddings", {}).items():
                    scoped_spk = f"chunk{i}_{spk}"
                    cluster_embs[scoped_spk] = emb

                curr_offset = cut_time

            if not all_turns:
                raise RuntimeError("Diarization returned no speaker turns")
            all_turns, centroids = reconcile_chunk_speakers(all_turns, cluster_embs)

            # Final speaker projection
            if all_turns:
                all_segments = project_diarization_onto_segments(all_segments, all_turns)

            return json.dumps({
                "status": "success",
                "segments": all_segments,
                "turns": all_turns,
                "text_hash": compute_transcript_text_hash(all_segments)
            }, indent=2)

    except Exception as e:
        return json.dumps({"error": str(e)}, indent=2)


def rediarize_endpoint(
    audio_url: str,
    existing_segments_json: str,
    api_key: str = "",
    enrolled_profiles_json: str = "{}",
    min_speakers: int = 1,
    max_speakers: int = 15,
    preview_seconds: float = 0
) -> str:
    """
    Top-level CPU orchestrator for /rediarize.
    Diarizes audio, matches against enrolled profiles via 1-to-1 bipartite matching,
    re-projects speaker labels onto existing segments, and asserts SHA-256 text hash immutability.
    """
    if not validate_api_key(api_key):
        return json.dumps({"error": "Unauthorized: invalid SPACE_API_KEY"}, indent=2)

    try:
        segments = json.loads(existing_segments_json)
        profiles = json.loads(enrolled_profiles_json) if enrolled_profiles_json else {}
        orig_hash = compute_transcript_text_hash(segments)

        with tempfile.TemporaryDirectory() as temp_dir:
            raw_audio = os.path.join(temp_dir, "input_audio")
            conditioned_wav = os.path.join(temp_dir, "conditioned.wav")

            download_file_streamed(audio_url, raw_audio)
            condition_audio_to_16k_mono(raw_audio, conditioned_wav)

            cut_points = detect_silence_cut_points(conditioned_wav, max_chunk_sec=1800.0)

            if preview_seconds:
                if not 0 < preview_seconds <= 300:
                    raise ValueError("Preview must be between 0 and 300 seconds")
                if any(float(seg.get("end", 0)) > preview_seconds for seg in segments):
                    raise ValueError("Preview transcript extends beyond requested audio window")
                cut_points = [min(float(preview_seconds), cut_points[-1])]

            all_turns: List[Dict[str, Any]] = []
            speaker_embs: Dict[str, List[float]] = {}

            curr_offset = 0.0
            for i, cut_time in enumerate(cut_points):
                chunk_len = cut_time - curr_offset
                if chunk_len <= 0.5:
                    continue

                chunk_wav = os.path.join(temp_dir, f"chunk_{i}.wav")
                ffmpeg_bin = shutil.which("ffmpeg") or "ffmpeg"
                cmd = [
                    ffmpeg_bin, "-y",
                    "-ss", str(curr_offset),
                    "-t", str(chunk_len),
                    "-i", conditioned_wav,
                    "-c", "copy",
                    chunk_wav
                ]
                subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)

                diar_res = _gpu_diarize_chunk(chunk_wav, min_speakers, max_speakers)
                for t in diar_res.get("turns", []):
                    t["speaker"] = f"chunk{i}_{t['speaker']}"
                    t["start"] += curr_offset
                    t["end"] += curr_offset
                    all_turns.append(t)

                for spk, emb in diar_res.get("embeddings", {}).items():
                    speaker_embs[f"chunk{i}_{spk}"] = emb

                curr_offset = cut_time

            if not all_turns:
                raise RuntimeError("Diarization returned no speaker turns")
            all_turns, centroids = reconcile_chunk_speakers(all_turns, speaker_embs)

            # 1-to-1 Bipartite Profile Matching
            matched_speakers = match_biometrics_1to1(
                centroids,
                profiles,
                min_similarity=0.54,
                min_margin=0.06
            )

            # Project generic clusters first so raw identity survives naming.
            updated_segments = project_diarization_onto_segments(segments, all_turns)
            for seg in updated_segments:
                if seg.get("speaker_verified") or seg.get("attribution", {}).get("method") == "human_verified":
                    continue
                if seg["speaker"] in matched_speakers:
                    seg["speaker"] = matched_speakers[seg["speaker"]]
                    seg["attribution"] = {"method": "acoustic", "model": "speechbrain/spkrec-ecapa-voxceleb"}
                for word in seg.get("words", []):
                    word["raw_speaker"] = word.get("speaker", "Unknown")
                    word["speaker"] = matched_speakers.get(word["raw_speaker"], word["raw_speaker"])

            final_hash = compute_transcript_text_hash(updated_segments)

            return json.dumps({
                "status": "success",
                "preview_seconds": preview_seconds,
                "segments": updated_segments,
                "turns": all_turns,
                "matched_speakers": matched_speakers,
                "clusters": centroids,
                "embedding_model": "speechbrain/spkrec-ecapa-voxceleb",
                "text_hash": final_hash,
                "verified_immutable": (orig_hash == final_hash)
            }, indent=2)

    except Exception as e:
        return json.dumps({"error": str(e)}, indent=2)


def diarize_window_endpoint(audio_url: str, start_seconds: float = 0,
                            duration_seconds: float = 300, api_key: str = "") -> str:
    """One bounded audio window per request/ZeroGPU lease; no transcript upload."""
    if not validate_api_key(api_key):
        return json.dumps({"error": "Unauthorized: invalid SPACE_API_KEY"})
    try:
        import math
        start, duration = float(start_seconds), float(duration_seconds)
        if not math.isfinite(start) or start < 0 or not math.isfinite(duration) or not 0 < duration <= 300:
            raise ValueError("Window requires finite start >= 0 and duration in (0, 300]")
        validate_audio_url(audio_url)
        with tempfile.TemporaryDirectory() as temp_dir:
            wav = os.path.join(temp_dir, "window.wav")
            # Seek before input to use HTTP range access instead of decoding the full episode.
            command = [shutil.which("ffmpeg") or "ffmpeg", "-nostdin", "-y",
                       "-ss", str(start), "-i", audio_url, "-t", str(duration),
                       "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav]
            proc = subprocess.run(command, capture_output=True, timeout=90)
            if proc.returncode:
                raise RuntimeError("Audio window extraction failed: " + proc.stderr.decode(errors="replace")[-1200:])
            import soundfile as sf
            info = sf.info(wav)
            actual_duration = info.frames / info.samplerate
            if actual_duration < duration - 1.0:
                raise RuntimeError(f"Audio window was truncated: {actual_duration:.2f}s of {duration:.2f}s")
            result = _gpu_diarize_chunk(wav)
            result.update({"status": "success", "start_seconds": start,
                           "duration_seconds": duration, "audio_seconds": actual_duration,
                           "embedding_model": "speechbrain/spkrec-ecapa-voxceleb"})
            return json.dumps(result)
    except Exception as exc:
        return json.dumps({"error": str(exc)})


@spaces.GPU(duration=60)
def gpu_health_probe(api_key: str = "") -> str:
    """ZeroGPU probe handler wired to Gradio for startup scanner detection."""
    if not validate_api_key(api_key):
        return json.dumps({"status": "unauthorized"})
    try:
        import torch
        cuda_avail = torch.cuda.is_available()
        dev_name = torch.cuda.get_device_name(0) if cuda_avail else "CPU/None"
    except Exception as e:
        cuda_avail = False
        dev_name = str(e)

    return json.dumps({
        "status": "healthy",
        "cuda_available": cuda_avail,
        "device_name": dev_name
    }, indent=2)


# Gradio Interface Definition
try:
    import gradio as gr

    with gr.Blocks(title="SpacePipe ZeroGPU Transcriber") as demo:
        gr.Markdown("# SpacePipe ZeroGPU Transcriber & Re-Diarizer")

        with gr.Tab("Transcribe"):
            audio_url_input = gr.Textbox(label="Audio URL", placeholder="https://github.com/.../audio.mp3")
            api_key_input = gr.Textbox(label="Space API Key", type="password")
            min_spk = gr.Number(label="Min Speakers", value=1)
            max_spk = gr.Number(label="Max Speakers", value=15)
            transcribe_btn = gr.Button("Transcribe Audio", variant="primary")
            transcribe_output = gr.Code(label="Transcript Output (JSON)", language="json")

            transcribe_btn.click(
                fn=transcribe_endpoint,
                inputs=[audio_url_input, api_key_input, min_spk, max_spk],
                outputs=[transcribe_output],
                api_name="transcribe"
            )

        with gr.Tab("Re-Diarize"):
            rediar_url = gr.Textbox(label="Audio URL")
            rediar_segs = gr.Code(label="Existing Segments JSON", language="json")
            rediar_key = gr.Textbox(label="Space API Key", type="password")
            rediar_profiles = gr.Code(label="Enrolled Profiles JSON", language="json", value="{}")
            preview_duration = gr.Number(label="Preview seconds (0 for full episode, maximum 300)", value=0)
            rediar_btn = gr.Button("Re-Diarize Transcripts", variant="primary")
            rediar_output = gr.Code(label="Updated Transcript (JSON)", language="json")

            rediar_btn.click(
                fn=rediarize_endpoint,
                inputs=[rediar_url, rediar_segs, rediar_key, rediar_profiles, min_spk, max_spk, preview_duration],
                outputs=[rediar_output],
                api_name="rediarize"
            )

        with gr.Tab("Audio Window"):
            window_url = gr.Textbox(label="Audio URL")
            window_start = gr.Number(label="Start seconds", value=0)
            window_duration = gr.Number(label="Duration seconds (maximum 300)", value=300)
            window_key = gr.Textbox(label="Space API Key", type="password")
            window_button = gr.Button("Diarize window")
            window_output = gr.Code(label="Window output", language="json")
            window_button.click(fn=diarize_window_endpoint,
                                inputs=[window_url, window_start, window_duration, window_key],
                                outputs=[window_output], api_name="diarize_window")

        with gr.Tab("Health"):
            health_key = gr.Textbox(label="Space API Key", type="password")
            health_btn = gr.Button("Check GPU Status", variant="secondary")
            health_output = gr.Code(label="Health Output", language="json")

            health_btn.click(
                fn=gpu_health_probe,
                inputs=[health_key],
                outputs=[health_output],
                api_name="health"
            )

    if __name__ == "__main__":
        demo.launch()
except ImportError:
    pass
