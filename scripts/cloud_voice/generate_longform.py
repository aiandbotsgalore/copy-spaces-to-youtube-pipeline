#!/usr/bin/env python3
"""
scripts/cloud_voice/generate_longform.py

Long-Form Neural Speech Synthesizer using OpenBMB VoxCPM-2 on Hugging Face ZeroGPU.
Splits text into natural conversational sentence/clause chunks, synthesizes each via
Logan's dedicated Space (loganblack0/voxcpm-voice-clone), and stitches them seamlessly
with realistic broadcast cadence and natural pauses.
"""

import sys
import os
import re
import time
import argparse
import subprocess
import numpy as np
import soundfile as sf
from pathlib import Path
from gradio_client import Client, handle_file

DEFAULT_REF_TEXT = (
    "Ten years before Hiroshima, the American presidency still belonged to a different world. "
    "This is Franklin Roosevelt at Boulder Dam in 1935."
)

def split_into_phrases(text: str):
    """
    Splits text into paragraphs, then sentences, and breaks long compound sentences
    into natural clauses (under ~25 words) for optimal neural TTS pacing.
    """
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks = []

    for p_idx, para in enumerate(paragraphs):
        # Clean markdown asterisks
        cleaned_para = re.sub(r"\*+", "", para).strip()
        # Split into sentences
        raw_sentences = re.split(r"(?<=[.!?])\s+", cleaned_para)
        
        para_chunks = []
        for s in raw_sentences:
            s = s.strip()
            if not s:
                continue
            words = s.split()
            if len(words) <= 24:
                para_chunks.append(s)
            else:
                # Split at natural punctuation (commas, semicolons, em-dashes)
                parts = re.split(r"(?<=[,;—])\s+", s)
                current = ""
                for part in parts:
                    if not current:
                        current = part
                    elif len((current + " " + part).split()) <= 24:
                        current = current + " " + part
                    else:
                        para_chunks.append(current.strip())
                        current = part
                if current.strip():
                    para_chunks.append(current.strip())

        for s_idx, chunk in enumerate(para_chunks):
            is_end_of_para = (s_idx == len(para_chunks) - 1)
            chunks.append({
                "text": chunk,
                "para_idx": p_idx,
                "is_end_of_para": is_end_of_para
            })

    return chunks

def trim_silence(audio: np.ndarray, sr: int, threshold: float = 0.015, min_pad_ms: int = 40):
    """Trims dead silence from leading and trailing edges of a generation."""
    abs_audio = np.abs(audio)
    mask = abs_audio > threshold
    if not np.any(mask):
        return audio
    start = max(0, np.argmax(mask) - int(sr * min_pad_ms / 1000))
    end = min(len(audio), len(audio) - np.argmax(mask[::-1]) + int(sr * min_pad_ms / 1000))
    return audio[start:end]

def main():
    parser = argparse.ArgumentParser(description="Generate long-form voice clone speech")
    parser.add_argument("--input", help="Path to input text file")
    parser.add_argument("--out-wav", default="public/output/vox/dessa_speech_logan.wav", help="Output WAV path")
    parser.add_argument("--out-mp3", default="public/output/vox/dessa_speech_logan.mp3", help="Output MP3 path")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent.parent.parent
    ref_wav = project_root / "public/speaker_samples/Logan/master_reference.wav"
    cache_dir = project_root / "work/longform_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)

    if args.input:
        with open(args.input, "r", encoding="utf-8") as f:
            full_text = f.read()
    else:
        # Default to Dessa speech
        full_text = sys.stdin.read()

    chunks = split_into_phrases(full_text)
    print(f"[*] Prepared {len(chunks)} speech segments for synthesis.")

    target_space = os.environ.get("VOXCPM_SPACE", "loganblack0/voxcpm-voice-clone")
    hf_token = os.environ.get("HF_VISITOR_TOKEN", os.environ.get("HF_TOKEN", None))

    print(f"[*] Connecting to {target_space}...")
    client = Client(target_space, token=hf_token)
    print(f"[✓] Connected to cloud ZeroGPU endpoint.")

    sample_rate = 48000
    audio_segments = []

    for idx, item in enumerate(chunks):
        chunk_text = item["text"]
        chunk_file = cache_dir / f"chunk_{idx:03d}.wav"

        print(f"\n[{idx+1}/{len(chunks)}] Synthesizing: \"{chunk_text}\"")

        if chunk_file.exists() and chunk_file.stat().st_size > 1000:
            print(f"  [cached] Loading from {chunk_file.name}")
            data, sr = sf.read(str(chunk_file))
            sample_rate = sr
        else:
            retries = 3
            success = False
            for attempt in range(1, retries + 1):
                try:
                    t0 = time.time()
                    res_path = client.predict(
                        text=chunk_text,
                        ref_audio=handle_file(str(ref_wav)),
                        ref_text=DEFAULT_REF_TEXT,
                        timesteps=15,
                        api_name="/generate"
                    )
                    t_cost = round(time.time() - t0, 2)
                    data, sr = sf.read(res_path)
                    sample_rate = sr
                    sf.write(str(chunk_file), data, sr, subtype="PCM_24")
                    print(f"  [generated] {round(len(data)/sr, 2)}s audio in {t_cost}s")
                    success = True
                    break
                except Exception as err:
                    print(f"  [!] Attempt {attempt} failed: {err}")
                    time.sleep(3)
            if not success:
                print(f"[!] Fatal: Failed to synthesize chunk {idx}", file=sys.stderr)
                sys.exit(1)

        # Clean audio & trim trailing/leading silence
        clean_audio = trim_silence(data, sample_rate)
        audio_segments.append(clean_audio)

        # Inject natural cadence pause
        pause_duration = 0.50 if item["is_end_of_para"] else 0.28
        silence_samples = int(sample_rate * pause_duration)
        audio_segments.append(np.zeros(silence_samples, dtype=np.float32))

    # Stitch all audio segments
    print("\n[*] Stitching master audio track...")
    master_audio = np.concatenate(audio_segments)

    # Master peak normalization (-1 dB headroom = 0.89)
    peak = np.max(np.abs(master_audio))
    if peak > 0:
        master_audio = (master_audio / peak) * 0.90

    out_wav_path = project_root / args.out_wav
    out_mp3_path = project_root / args.out_mp3
    out_wav_path.parent.mkdir(parents=True, exist_ok=True)

    sf.write(str(out_wav_path), master_audio, sample_rate, subtype="PCM_24")
    total_seconds = len(master_audio) / sample_rate
    print(f"[✓] Exported WAV: {out_wav_path} ({round(total_seconds, 2)}s, {out_wav_path.stat().st_size} bytes)")

    # Encode high-bitrate broadcast MP3
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(out_wav_path), "-codec:a", "libmp3lame", "-b:a", "192k", str(out_mp3_path)],
        check=True,
        capture_output=True
    )
    print(f"[✓] Exported MP3: {out_mp3_path} ({out_mp3_path.stat().st_size} bytes)")

if __name__ == "__main__":
    main()
