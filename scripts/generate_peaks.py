#!/usr/bin/env python3
"""
scripts/generate_peaks.py

Generates lightweight .peaks.json waveform files for audio clips.
Enables instantaneous 60fps waveform rendering in the browser without
requiring the client to download and decode full multi-megabyte audio files.

Usage:
    python scripts/generate_peaks.py --dir best_saved_clips --bars 64
    python scripts/generate_peaks.py --file path/to/clip.mp3
"""

import os
import sys
import json
import argparse
import subprocess
import shutil
from pathlib import Path
from typing import List


def find_ffmpeg() -> str:
    cand = shutil.which("ffmpeg")
    if cand:
        return cand
    for p in [
        r"C:\Program Files\ShareX\ffmpeg.exe",
        r"C:\Users\Logan\Downloads\ytdlp-gui-windows-64\ffmpeg.exe",
        r"C:\Users\Logan\Documents\twitterspacedownloader\ffmpeg.exe",
    ]:
        if os.path.exists(p):
            return p
    return "ffmpeg"


def extract_pcm_samples(audio_path: Path, ffmpeg_bin: str) -> List[float]:
    """Uses ffmpeg to decode audio into 8kHz mono 16-bit PCM for fast peak calculation."""
    cmd = [
        ffmpeg_bin,
        "-y",
        "-i", str(audio_path),
        "-ac", "1",
        "-ar", "8000",
        "-f", "s16le",
        "-"
    ]
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True)
        raw = proc.stdout
        # Unpack signed 16-bit integers
        import struct
        count = len(raw) // 2
        if count == 0:
            return []
        integers = struct.unpack(f"<{count}h", raw)
        # Normalize to float between -1.0 and 1.0
        return [val / 32768.0 for val in integers]
    except Exception as e:
        print(f"[!] FFmpeg PCM extraction error on {audio_path.name}: {e}", file=sys.stderr)
        return []


def compute_normalized_peaks(samples: List[float], num_bars: int = 64) -> List[int]:
    if not samples or num_bars <= 0:
        return [30] * num_bars

    chunk_size = max(1, len(samples) // num_bars)
    raw_peaks = []
    max_val = 0.0

    for i in range(num_bars):
        start = i * chunk_size
        end = min(start + chunk_size, len(samples))
        chunk = samples[start:end]
        if not chunk:
            raw_peaks.append(0.1)
            continue

        peak = max(abs(s) for s in chunk)
        sum_sq = sum(s * s for s in chunk)
        rms = (sum_sq / len(chunk)) ** 0.5
        combined = rms * 0.6 + peak * 0.4
        raw_peaks.append(combined)
        if combined > max_val:
            max_val = combined

    safe_max = max_val if max_val > 0.001 else 1.0
    return [max(15, min(95, round((v / safe_max) * 100))) for v in raw_peaks]


def process_file(mp3_path: Path, ffmpeg_bin: str, num_bars: int = 64) -> bool:
    peaks_file = mp3_path.with_suffix(".peaks.json")
    if peaks_file.exists():
        return False

    samples = extract_pcm_samples(mp3_path, ffmpeg_bin)
    if not samples:
        return False

    peaks = compute_normalized_peaks(samples, num_bars)
    peaks_file.write_text(json.dumps(peaks, indent=None), encoding="utf-8")
    return True


def main():
    parser = argparse.ArgumentParser(description="Generate .peaks.json waveform files for audio clips")
    parser.add_argument("--dir", default="best_saved_clips", help="Directory to search recursively for MP3s")
    parser.add_argument("--file", help="Specific audio file to process")
    parser.add_argument("--bars", type=int, default=64, help="Number of normalized peak bars to generate")
    args = parser.parse_args()

    ffmpeg_bin = find_ffmpeg()
    print(f"[*] SpacePipe Waveform Peak Generator using {ffmpeg_bin}")

    if args.file:
        p = Path(args.file)
        if p.exists():
            ok = process_file(p, ffmpeg_bin, args.bars)
            print(f"[{'✓' if ok else '!'}] Processed {p.name}")
        else:
            print(f"[!] File not found: {args.file}")
            sys.exit(1)
        return

    target_dir = Path(args.dir)
    if not target_dir.exists():
        print(f"[!] Directory not found: {target_dir}")
        sys.exit(1)

    mp3s = list(target_dir.rglob("*.mp3"))
    print(f"[*] Found {len(mp3s)} MP3 files in {target_dir}")
    generated = 0
    for mp3 in mp3s:
        if process_file(mp3, ffmpeg_bin, args.bars):
            generated += 1

    print(f"[✓] Generated {generated} new .peaks.json files (Total: {len(mp3s)})")


if __name__ == "__main__":
    main()
