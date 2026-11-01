import os
import sys
import time
import math
import json
import base64
import shutil
import tempfile
import subprocess
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple
import urllib.request

import modal

# -----------------------------------------------------------------------------
# Modal App & Storage Definitions
# -----------------------------------------------------------------------------
app = modal.App("spacepipe-transcribe")
models_vol = modal.Volume.from_name("spacepipe-transcribe-models", create_if_missing=True)

transcribe_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "ffmpeg", "libsndfile1", "build-essential")
    .pip_install(
        "torch==2.3.1",
        "torchaudio==2.3.1",
        index_url="https://download.pytorch.org/whl/cu121"
    )
    .pip_install(
        "faster-whisper>=1.0.3",
        "ctranslate2>=4.3.0",
        "whisperx>=3.8.0",
        "pyannote.audio>=3.1.1",
        "speechbrain>=1.0.0",
        "soundfile>=0.12.1",
        "scipy>=1.11.0",
        "librosa>=0.10.1",
        "requests>=2.31.0",
        "fastapi[standard]>=0.115.0",
        "pydantic>=2.0.0",
        "huggingface_hub>=0.23.0"
    )
)

CACHE_DIR = "/models/cache"
HF_CACHE = "/models/cache/huggingface"
TORCH_CACHE = "/models/cache/torch"

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
def format_timestamp_srt(seconds: float) -> str:
    millis = int(round(seconds * 1000))
    hrs = millis // 3600000
    millis %= 3600000
    mins = millis // 60000
    millis %= 60000
    secs = millis // 1000
    millis %= 1000
    return f"{hrs:02d}:{mins:02d}:{secs:02d},{millis:03d}"


def get_audio_duration(file_path: Path) -> float:
    cmd = [
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(file_path)
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    try:
        return float(res.stdout.strip())
    except Exception:
        import soundfile as sf
        info = sf.info(str(file_path))
        return float(info.duration)


def condition_audio_to_wav(input_path: Path, output_wav: Path) -> None:
    """Converts audio to 16kHz mono 16-bit PCM WAV for optimal Whisper/PyAnnote processing."""
    cmd = [
        "ffmpeg", "-y", "-i", str(input_path),
        "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
        str(output_wav)
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"FFmpeg audio conditioning failed: {res.stderr}")


def detect_silence_cut_points(wav_path: Path, max_chunk_sec: float = 4800.0) -> List[float]:
    """
    Detects natural silence intervals to split marathon audio without cutting words.
    Target chunk size: ~75 minutes (4500-5000s).
    """
    duration = get_audio_duration(wav_path)
    if duration <= max_chunk_sec:
        return []

    cmd = [
        "ffmpeg", "-i", str(wav_path),
        "-af", "silencedetect=noise=-30dB:d=1.2",
        "-f", "null", "-"
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    output = res.stderr

    import re
    silence_starts = [float(m.group(1)) for m in re.finditer(r"silence_start:\s*([\d.]+)", output)]

    cut_points: List[float] = []
    current_target = max_chunk_sec

    while current_target < duration - 1200:
        candidates = [t for t in silence_starts if abs(t - current_target) < 600]
        if candidates:
            best_cut = min(candidates, key=lambda t: abs(t - current_target))
            cut_points.append(best_cut)
            current_target = best_cut + max_chunk_sec
        else:
            cut_points.append(current_target)
            current_target += max_chunk_sec

    return cut_points


def slice_audio_chunks(wav_path: Path, cut_points: List[float], temp_dir: Path) -> List[Tuple[float, float, Path]]:
    """Slices a marathon WAV into sequential sub-chunks."""
    duration = get_audio_duration(wav_path)
    boundaries = [0.0] + cut_points + [duration]
    chunks: List[Tuple[float, float, Path]] = []

    for i in range(len(boundaries) - 1):
        st = boundaries[i]
        et = boundaries[i + 1]
        length = et - st
        if length < 1.0:
            continue
        chunk_file = temp_dir / f"chunk_{i:03d}.wav"
        cmd = [
            "ffmpeg", "-y", "-ss", f"{st:.3f}", "-i", str(wav_path),
            "-t", f"{length:.3f}", "-c", "copy", str(chunk_file)
        ]
        subprocess.run(cmd, capture_output=True, check=True)
        chunks.append((st, et, chunk_file))

    return chunks


def extract_speaker_embedding(
    sb_classifier: Any,
    audio_data: Any,
    turns: List[Dict[str, Any]],
    device: str,
    sample_rate: int = 16000
) -> Optional[Any]:
    import torch
    import numpy as np

    valid_turns = [t for t in turns if 2.0 <= (t.get("end", 0) - t.get("start", 0)) <= 15.0]
    if not valid_turns:
        valid_turns = turns[:5]

    sample_slices = []
    for t in valid_turns[:8]:
        st_idx = int(t.get("start", 0) * sample_rate)
        end_idx = int(t.get("end", 0) * sample_rate)
        if end_idx > len(audio_data):
            end_idx = len(audio_data)
        slice_wav = audio_data[st_idx:end_idx]
        if len(slice_wav) < sample_rate * 1.5:
            continue
        peak = np.max(np.abs(slice_wav))
        if peak > 1e-6:
            slice_wav = slice_wav / peak
        sample_slices.append(slice_wav)

    if not sample_slices:
        return None

    embeddings = []
    for sw in sample_slices:
        tensor = torch.from_numpy(sw.astype(np.float32)).unsqueeze(0).to(device)
        with torch.no_grad():
            emb = sb_classifier.encode_batch(tensor).squeeze().cpu().numpy()
        norm = np.linalg.norm(emb)
        if norm > 1e-6:
            embeddings.append(emb / norm)

    if not embeddings:
        return None

    mean_emb = np.mean(embeddings, axis=0)
    mean_norm = np.linalg.norm(mean_emb)
    return (mean_emb / mean_norm) if mean_norm > 1e-6 else None


def _execute_transcription(
    audio_bytes: bytes,
    title: str = "Twitter Space",
    release_tag: str = "",
    host_handle: str = "",
    hf_token: str = "",
    enrolled_profiles: Optional[Dict[str, Any]] = None,
    whisper_model_name: str = "large-v3",
    vad_onset: float = 0.50,
) -> Dict[str, Any]:
    import torch
    import numpy as np
    import whisperx
    from speechbrain.inference.speaker import EncoderClassifier

    device = "cuda" if torch.cuda.is_available() else "cpu"
    compute_type = "float16" if device == "cuda" else "int8"
    os.environ["HF_HOME"] = HF_CACHE
    os.environ["TORCH_HOME"] = TORCH_CACHE

    t_start = time.time()
    print(f"=======================================================")
    print(f"[*] SpacePipe Modal WhisperX: {title} ({release_tag or 'ad-hoc'})")
    print(f"    GPU: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU'}")
    print(f"    Model: {whisper_model_name} ({compute_type})")
    print(f"=======================================================")

    with tempfile.TemporaryDirectory() as temp_dir_str:
        temp_dir = Path(temp_dir_str)
        raw_audio_path = temp_dir / "input_audio.bin"
        conditioned_wav = temp_dir / "conditioned.wav"

        raw_audio_path.write_bytes(audio_bytes)
        print(f"[*] Conditioning audio ({len(audio_bytes) / (1024*1024):.1f} MB) via FFmpeg...")
        condition_audio_to_wav(raw_audio_path, conditioned_wav)
        total_duration = get_audio_duration(conditioned_wav)
        print(f"[✓] Audio normalized: {total_duration:.1f}s ({total_duration/60:.1f} min)")

        # Determine chunking plan
        cut_points = detect_silence_cut_points(conditioned_wav, max_chunk_sec=4800.0)
        chunks = slice_audio_chunks(conditioned_wav, cut_points, temp_dir) if cut_points else [(0.0, total_duration, conditioned_wav)]
        print(f"[*] Processing in {len(chunks)} chunk(s)...")

        # 1. Load Whisper Model
        whisper_dir = Path("/models/whisper")
        whisper_dir.mkdir(parents=True, exist_ok=True)
        print(f"[*] Loading WhisperX model ({whisper_model_name})...")
        model = whisperx.load_model(
            whisper_model_name,
            device=device,
            compute_type=compute_type,
            download_root=str(whisper_dir),
            vad_options={"vad_onset": vad_onset}
        )

        # 2. Load Alignment Model
        align_model, align_metadata = whisperx.load_align_model(language_code="en", device=device)

        # 3. Load Diarization Pipeline
        active_hf_token = hf_token or os.environ.get("HF_TOKEN") or ""
        diarize_pipeline = None
        if active_hf_token:
            try:
                print("[*] Initializing PyAnnote 3.1 neural diarization pipeline...")
                diarize_pipeline = whisperx.DiarizationPipeline(use_auth_token=active_hf_token, device=device)
            except Exception as e:
                print(f"[!] Warning: PyAnnote initialization error: {e}")
        else:
            print("[!] Warning: No HF_TOKEN provided; skipping PyAnnote diarization.")

        # 4. Load SpeechBrain ECAPA-TDNN Classifier
        sb_dir = Path("/models/speechbrain_cache")
        sb_dir.mkdir(parents=True, exist_ok=True)
        print("[*] Initializing SpeechBrain ECAPA-TDNN speaker encoder...")
        sb_classifier = EncoderClassifier.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            savedir=str(sb_dir),
            run_opts={"device": device}
        )

        all_segments: List[Dict[str, Any]] = []
        chunk_speaker_embeddings: Dict[str, List[np.ndarray]] = {}

        # Process each chunk
        for c_idx, (offset_sec, end_sec, chunk_path) in enumerate(chunks, 1):
            print(f"\n--- Processing Chunk {c_idx}/{len(chunks)} ({offset_sec:.1f}s - {end_sec:.1f}s) ---")
            audio_arr = whisperx.load_audio(str(chunk_path))

            # Transcribe
            tx_res = model.transcribe(audio_arr, batch_size=16)
            detected_lang = tx_res.get("language") or "en"

            # Align word timestamps
            if detected_lang != "en":
                cur_align_model, cur_meta = whisperx.load_align_model(language_code=detected_lang, device=device)
                aligned_res = whisperx.align(tx_res["segments"], cur_align_model, cur_meta, audio_arr, device)
            else:
                aligned_res = whisperx.align(tx_res["segments"], align_model, align_metadata, audio_arr, device)

            # Diarize
            if diarize_pipeline:
                try:
                    diar_segs = diarize_pipeline(str(chunk_path))
                    final_chunk_res = whisperx.assign_word_speakers(diar_segs, aligned_res)
                except Exception as e:
                    print(f"[!] PyAnnote diarization failed on chunk {c_idx}: {e}")
                    final_chunk_res = aligned_res
            else:
                final_chunk_res = aligned_res

            # Offset timestamps to global timeline
            chunk_segments = final_chunk_res.get("segments", [])
            for s in chunk_segments:
                s["start"] = round(offset_sec + float(s.get("start", 0.0)), 2)
                s["end"] = round(offset_sec + float(s.get("end", 0.0)), 2)
                if "words" in s:
                    for w in s["words"]:
                        if "start" in w and "end" in w:
                            w["start"] = round(offset_sec + float(w["start"]), 2)
                            w["end"] = round(offset_sec + float(w["end"]), 2)
                            w["confidence"] = round(float(w.get("score", 0.95)), 2)

                spk = str(s.get("speaker") or "SPEAKER_00")
                s["chunk_speaker"] = f"C{c_idx}_{spk}"
                all_segments.append(s)

            # Compute speaker embeddings for this chunk
            spk_turns: Dict[str, List[Dict[str, Any]]] = {}
            for s in chunk_segments:
                spk_id = s["chunk_speaker"]
                local_turn = {
                    "start": s["start"] - offset_sec,
                    "end": s["end"] - offset_sec
                }
                spk_turns.setdefault(spk_id, []).append(local_turn)

            for spk_id, turns in spk_turns.items():
                emb = extract_speaker_embedding(sb_classifier, audio_arr, turns, device)
                if emb is not None:
                    chunk_speaker_embeddings.setdefault(spk_id, []).append(emb)

        # ---------------------------------------------------------------------
        # Global Cross-Chunk Speaker Clustering & Biometric Matching
        # ---------------------------------------------------------------------
        print("\n[*] Unifying speakers across chunks and matching biometric voiceprints...")
        spk_keys = list(chunk_speaker_embeddings.keys())
        mean_embeddings = {k: np.mean(v, axis=0) for k, v in chunk_speaker_embeddings.items()}

        cluster_map: Dict[str, str] = {}
        for k in spk_keys:
            cluster_map[k] = k

        for i in range(len(spk_keys)):
            k1 = spk_keys[i]
            emb1 = mean_embeddings[k1]
            for j in range(i + 1, len(spk_keys)):
                k2 = spk_keys[j]
                emb2 = mean_embeddings[k2]
                sim = float(np.dot(emb1, emb2) / (np.linalg.norm(emb1) * np.linalg.norm(emb2) + 1e-8))
                if sim > 0.68:
                    target_root = cluster_map[k1]
                    cluster_map[k2] = target_root

        unique_roots = sorted(list(set(cluster_map.values())))
        canonical_labels = {root: f"Speaker {idx}" for idx, root in enumerate(unique_roots, 1)}
        speaker_mapping = {spk: canonical_labels[cluster_map[spk]] for spk in spk_keys}

        enrolled_vectors = {}
        if enrolled_profiles:
            for name, p in enrolled_profiles.items():
                emb = p.get("embedding")
                if isinstance(emb, list) and len(emb) == 192:
                    v = np.array(emb, dtype=np.float32)
                    norm = np.linalg.norm(v)
                    if norm > 1e-6:
                        enrolled_vectors[name] = v / norm

        biometric_matches: Dict[str, str] = {}
        if enrolled_vectors:
            for root, canonical_name in canonical_labels.items():
                cluster_spks = [s for s, r in cluster_map.items() if r == root]
                cluster_embs = [mean_embeddings[s] for s in cluster_spks if s in mean_embeddings]
                if not cluster_embs:
                    continue
                root_emb = np.mean(cluster_embs, axis=0)
                root_emb = root_emb / (np.linalg.norm(root_emb) + 1e-8)

                best_match = None
                best_sim = -1.0
                for enrolled_name, enr_vec in enrolled_vectors.items():
                    sim = float(np.dot(root_emb, enr_vec))
                    if sim > best_sim:
                        best_sim = sim
                        best_match = enrolled_name

                if best_match and best_sim >= 0.56:
                    biometric_matches[canonical_name] = best_match
                    print(f"[✓] Biometric Match: {canonical_name} -> {best_match} (Cosine Sim: {best_sim:.3f})")

        host_handle_lower = host_handle.lower()
        is_logan_host = "logan" in host_handle_lower or "loganblack" in host_handle_lower
        if is_logan_host and "Logan" not in biometric_matches.values():
            spk_durations: Dict[str, float] = {}
            for s in all_segments:
                cur_spk = speaker_mapping.get(s.get("chunk_speaker", ""), "Speaker 1")
                spk_durations[cur_spk] = spk_durations.get(cur_spk, 0.0) + (s["end"] - s["start"])

            sorted_by_duration = sorted(spk_durations.items(), key=lambda x: x[1], reverse=True)
            if sorted_by_duration:
                top_spk = sorted_by_duration[0][0]
                if top_spk not in biometric_matches:
                    biometric_matches[top_spk] = "Logan"
                    print(f"[✓] Contextual Host Anchor: {top_spk} -> Logan (Host Talk-Time Dominance)")

        # ---------------------------------------------------------------------
        # Final Output Formatting
        # ---------------------------------------------------------------------
        final_segments = []
        srt_lines = []
        txt_lines = [f"=== TRANSCRIPT: {title} ===\n\n"]
        all_unique_speakers = set()

        for idx, seg in enumerate(all_segments, 1):
            raw_spk = seg.get("chunk_speaker", "")
            assigned_canonical = speaker_mapping.get(raw_spk, "Speaker 1")
            final_speaker_name = biometric_matches.get(assigned_canonical, assigned_canonical)
            all_unique_speakers.add(final_speaker_name)

            start = float(seg["start"])
            end = float(seg["end"])
            text = str(seg.get("text", "")).strip()

            words = []
            for w in seg.get("words", []):
                if "start" in w and "end" in w:
                    words.append({
                        "word": str(w.get("word", "")).strip(),
                        "start": float(w["start"]),
                        "end": float(w["end"]),
                        "confidence": float(w.get("confidence", 0.95))
                    })

            final_segments.append({
                "start": start,
                "end": end,
                "speaker": final_speaker_name,
                "text": text,
                "words": words
            })

            srt_lines.append(f"{idx}\n{format_timestamp_srt(start)} --> {format_timestamp_srt(end)}\n[{final_speaker_name}]: {text}\n")
            txt_lines.append(f"[{format_timestamp_srt(start)}] {final_speaker_name}: {text}\n")

        total_elapsed = time.time() - t_start
        print(f"\n[✓] Transcription Completed Successfully in {total_elapsed:.1f}s!")
        print(f"    • Total Segments: {len(final_segments)}")
        print(f"    • Identified Speakers: {sorted(list(all_unique_speakers))}")

        return {
            "title": title,
            "release_tag": release_tag,
            "duration_sec": total_duration,
            "speakers": sorted(list(all_unique_speakers)),
            "segments": final_segments,
            "srt_content": "\n".join(srt_lines),
            "txt_content": "".join(txt_lines),
            "elapsed_sec": round(total_elapsed, 2)
        }


# -----------------------------------------------------------------------------
# Modal Entrypoints & Endpoints
# -----------------------------------------------------------------------------
@app.function(
    image=transcribe_image,
    gpu=["A10G", "A100", "L4"],
    timeout=3600,
    scaledown_window=300,
    volumes={"/models": models_vol},
    secrets=[modal.Secret.from_name("spacepipe-secrets")]
)
def transcribe_job(
    audio_bytes: bytes,
    title: str = "Twitter Space",
    release_tag: str = "",
    host_handle: str = "",
    hf_token: str = "",
    enrolled_profiles: Optional[Dict[str, Any]] = None,
    whisper_model_name: str = "large-v3",
    vad_onset: float = 0.50,
) -> Dict[str, Any]:
    return _execute_transcription(
        audio_bytes=audio_bytes,
        title=title,
        release_tag=release_tag,
        host_handle=host_handle,
        hf_token=hf_token,
        enrolled_profiles=enrolled_profiles,
        whisper_model_name=whisper_model_name,
        vad_onset=vad_onset,
    )


@app.function(
    image=transcribe_image,
    gpu=["A10G", "A100", "L4"],
    timeout=3600,
    scaledown_window=300,
    volumes={"/models": models_vol},
    secrets=[modal.Secret.from_name("spacepipe-secrets")]
)
@modal.fastapi_endpoint(method="POST")
def transcribe_endpoint(payload: Dict[str, Any]) -> Dict[str, Any]:
    audio_url = payload.get("audio_url")
    audio_base64 = payload.get("audio_base64")
    title = payload.get("title") or "Twitter Space"
    release_tag = payload.get("release_tag") or ""
    host_handle = payload.get("host_handle") or ""
    hf_token = payload.get("hf_token") or os.environ.get("HF_TOKEN") or ""
    enrolled_profiles = payload.get("enrolled_profiles")

    if not enrolled_profiles:
        try:
            url = "https://raw.githubusercontent.com/aiandbotsgalore/copy-spaces-to-youtube-pipeline/master/voice_profiles.json"
            req = urllib.request.Request(url, headers={"User-Agent": "SpacePipe-Modal-Transcribe"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                enrolled_profiles = data.get("profiles", {})
        except Exception as e:
            print(f"[!] Warning: Could not fetch default voice_profiles.json: {e}")

    audio_bytes = b""
    if audio_url:
        print(f"[*] Downloading audio from URL: {audio_url}")
        req = urllib.request.Request(audio_url, headers={"User-Agent": "SpacePipe-Modal-Transcribe"})
        with urllib.request.urlopen(req, timeout=300) as resp:
            audio_bytes = resp.read()
    elif audio_base64:
        clean_b64 = audio_base64.split(",")[-1] if "," in audio_base64 else audio_base64
        audio_bytes = base64.b64decode(clean_b64)
    else:
        return {"error": "Either audio_url or audio_base64 must be provided in request payload."}

    if not audio_bytes:
        return {"error": "Audio payload was empty."}

    return _execute_transcription(
        audio_bytes=audio_bytes,
        title=title,
        release_tag=release_tag,
        host_handle=host_handle,
        hf_token=hf_token,
        enrolled_profiles=enrolled_profiles
    )


@app.local_entrypoint()
def main(
    audio: str = r"public\speaker_samples\Logan\master_reference.wav",
    title: str = "Test Audio",
    output: str = r"public\output\test_modal_transcript.json",
):
    print("=== Modal Transcribe Local Test Trigger ===")
    if not os.path.exists(audio):
        raise FileNotFoundError(f"Audio file not found: {audio}")

    with open(audio, "rb") as f:
        audio_bytes = f.read()

    profiles = {}
    vp_path = Path("voice_profiles.json")
    if vp_path.exists():
        with open(vp_path, "r", encoding="utf-8") as f:
            profiles = json.load(f).get("profiles", {})

    print(f"[*] Dispatching to Modal GPU worker...")
    res = transcribe_job.remote(
        audio_bytes=audio_bytes,
        title=title,
        release_tag="test_tag",
        host_handle="loganblack",
        enrolled_profiles=profiles
    )

    out_path = Path(output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(res, f, indent=2)

    print(f"[✓] Success! Saved output to: {out_path.resolve()}")
    print(f"    Duration: {res.get('duration_sec')}s, Elapsed: {res.get('elapsed_sec')}s")
    print(f"    Speakers: {res.get('speakers')}")
    print(f"    Segments: {len(res.get('segments', []))}")
