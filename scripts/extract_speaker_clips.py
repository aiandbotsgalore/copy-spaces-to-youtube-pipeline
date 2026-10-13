#!/usr/bin/env python3
"""
extract_speaker_clips.py - Automated Speaker Audio Slicing & Voice Enrollment Tool

Usage:
  # Extract clips for all speakers from a Space:
  python scripts/extract_speaker_clips.py --json "output_transcripts/<episode>.json" --audio "work/<episode>.mp3"

  # Extract top 5 cleanest clips per speaker (duration between 3s and 12s):
  python scripts/extract_speaker_clips.py --json "<episode>.json" --audio "<episode>.mp3" --min-dur 3.0 --max-dur 12.0 --limit 5

  # Enroll a chosen audio clip directly into voice_profiles.json:
  python scripts/extract_speaker_clips.py --enroll "speaker_samples/Dorgy Meta/clip_01_08m02s.wav" --name "Dorgy Meta"
"""

import os
import re
import sys
import json
import argparse
import subprocess
from pathlib import Path
from typing import List, Dict, Any, Optional

try:
    import imageio_ffmpeg
    FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()
except ImportError:
    FFMPEG_EXE = "ffmpeg"


def sanitize_filename(name: str) -> str:
    """Sanitizes speaker name for filesystem directory creation."""
    clean = re.sub(r'[\\/*?:"<>|]', "", name)
    clean = clean.strip()
    if not clean:
        return "Unknown_Speaker"
    return clean


def format_seconds_to_timestamp(sec: float) -> str:
    """Formats seconds into readable string for filenames e.g. 01h23m45s or 07m38s."""
    hours = int(sec // 3600)
    minutes = int((sec % 3600) // 60)
    seconds = int(sec % 60)
    if hours > 0:
        return f"{hours:02d}h{minutes:02d}m{seconds:02d}s"
    return f"{minutes:02d}m{seconds:02d}s"


def extract_clip(audio_path: str, start: float, duration: float, out_wav: str) -> bool:
    """Extracts a slice of audio using FFmpeg as 16kHz mono WAV."""
    cmd = [
        FFMPEG_EXE,
        "-y",
        "-ss", str(start),
        "-t", str(duration),
        "-i", audio_path,
        "-ac", "1",
        "-ar", "16000",
        "-c:a", "pcm_s16le",
        out_wav
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    return res.returncode == 0


def process_episode(
    json_path: str,
    audio_path: str,
    output_dir: str = "speaker_samples",
    min_duration: float = 3.0,
    max_duration: float = 15.0,
    max_clips_per_speaker: int = 10
):
    """Processes transcript JSON and extracts speaker clips into labeled directories."""
    if not os.path.exists(json_path):
        print(f"[!] Transcript JSON not found: {json_path}")
        sys.exit(1)
    if not os.path.exists(audio_path):
        print(f"[!] Audio file not found: {audio_path}")
        sys.exit(1)

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    segments = data.get("segments", [])
    if not segments:
        print("[!] No segments found in transcript JSON.")
        return

    # Group segments by speaker
    speaker_segments: Dict[str, List[Dict[str, Any]]] = {}
    for seg in segments:
        speaker = seg.get("speaker", "Unknown").strip()
        if not speaker:
            speaker = "Unknown"
        speaker_segments.setdefault(speaker, []).append(seg)

    print(f"[*] Found {len(speaker_segments)} distinct speakers in transcript.")
    os.makedirs(output_dir, exist_ok=True)

    summary_counts = {}

    for speaker, segs in speaker_segments.items():
        folder_name = sanitize_filename(speaker)
        speaker_dir = os.path.join(output_dir, folder_name)
        os.makedirs(speaker_dir, exist_ok=True)

        # Filter candidate segments by duration
        candidates = []
        for s in segs:
            dur = round(s["end"] - s["start"], 2)
            if min_duration <= dur <= max_duration:
                text = s.get("text", "").strip()
                if len(text.split()) >= 3:
                    candidates.append({
                        "start": s["start"],
                        "end": s["end"],
                        "duration": dur,
                        "text": text
                    })

        # Prefer clips in the 5s to 10s range (ideal for ECAPA-TDNN)
        candidates.sort(key=lambda c: abs(c["duration"] - 7.5))

        selected = candidates[:max_clips_per_speaker]
        selected.sort(key=lambda c: c["start"])

        manifest_lines = [
            f"=== SPEAKER MANIFEST: {speaker} ===",
            f"Source Audio: {os.path.basename(audio_path)}",
            f"Total Utterances: {len(segs)}",
            f"Clips Extracted: {len(selected)}",
            f"Enrollment Instructions: Listen to the clips below. Pick the cleanest sample and run:",
            f"  python scripts/extract_speaker_clips.py --enroll \"<path-to-clip>\" --name \"{speaker}\"",
            "",
            "--------------------------------------------------------------------------------",
            ""
        ]

        extracted_count = 0
        for idx, clip in enumerate(selected, 1):
            ts_label = format_seconds_to_timestamp(clip["start"])
            clip_filename = f"clip_{idx:02d}_{ts_label}.wav"
            clip_path = os.path.join(speaker_dir, clip_filename)

            success = extract_clip(audio_path, clip["start"], clip["duration"], clip_path)
            if success:
                extracted_count += 1
                manifest_lines.append(f"[{clip_filename}]")
                manifest_lines.append(f"Timestamp: {clip['start']:.2f}s - {clip['end']:.2f}s ({clip['duration']:.1f}s)")
                manifest_lines.append(f"Transcript: \"{clip['text']}\"")
                manifest_lines.append("")

        manifest_path = os.path.join(speaker_dir, "manifest.txt")
        with open(manifest_path, "w", encoding="utf-8") as mf:
            mf.write("\n".join(manifest_lines))

        summary_counts[speaker] = extracted_count
        print(f"  [✓] {speaker}: Extracted {extracted_count} clips -> {speaker_dir}")

    print("\n[✓] Finished extraction!")
    print(f"Output directory: {os.path.abspath(output_dir)}")


def enroll_clip_to_profiles(clip_path: str, speaker_name: str, profiles_file: str = "voice_profiles.json"):
    """Enrolls one or more extracted audio clips into voice_profiles.json using ECAPA-TDNN."""
    clip_paths = []
    if os.path.isdir(clip_path):
        clip_paths = sorted([
            os.path.join(clip_path, f)
            for f in os.listdir(clip_path)
            if f.lower().endswith(".wav")
        ])
    elif "," in clip_path:
        clip_paths = [p.strip() for p in clip_path.split(",") if os.path.exists(p.strip())]
    elif os.path.exists(clip_path):
        clip_paths = [clip_path]

    if not clip_paths:
        print(f"[!] No valid clip files found for: {clip_path}")
        sys.exit(1)

    print(f"[*] Enrolling '{speaker_name}' from {len(clip_paths)} audio sample(s): {clip_paths}")

    clips_json_str = json.dumps(clip_paths)
    worker_code = f"""
import sys, json, os, shutil, warnings
warnings.filterwarnings('ignore')
import numpy as np
import soundfile as sf
import torch
from speechbrain.inference.speaker import EncoderClassifier

clip_paths = json.loads(r'''{clips_json_str}''')
speaker_name = r'{speaker_name}'
profiles_file = r'{profiles_file}'

device = 'cuda:0' if torch.cuda.is_available() else 'cpu'
classifier = EncoderClassifier.from_hparams(
    source='speechbrain/spkrec-ecapa-voxceleb',
    savedir=os.path.join(os.path.expanduser('~'), '.cache', 'speechbrain', 'spkrec-ecapa-voxceleb'),
    run_opts={{'device': device}}
)

embeddings = []
for cp in clip_paths:
    try:
        audio_data, sr = sf.read(cp)
        if audio_data.ndim > 1:
            audio_data = np.mean(audio_data, axis=1)
        audio_data = audio_data.astype(np.float32)
        if len(audio_data) < sr * 1.0:
            continue
        max_val = np.max(np.abs(audio_data))
        if max_val > 1e-6:
            audio_data = audio_data / max_val
        t = torch.from_numpy(audio_data).unsqueeze(0).to(device)
        with torch.no_grad():
            emb = classifier.encode_batch(t).squeeze().cpu().numpy()
        norm = np.linalg.norm(emb)
        if norm > 1e-6:
            emb = emb / norm
            embeddings.append(emb)
    except Exception as e:
        print(f'Warning on clip {{cp}}: {{e}}')

if not embeddings:
    sys.exit(1)

if len(embeddings) >= 3:
    emb_mat = np.stack(embeddings, axis=0)
    raw_centroid = np.mean(emb_mat, axis=0)
    rc_norm = np.linalg.norm(raw_centroid)
    if rc_norm > 1e-6:
        raw_centroid = raw_centroid / rc_norm
    sims = np.dot(emb_mat, raw_centroid)
    med_sim = float(np.median(sims))
    inliers = [embeddings[i] for i in range(len(embeddings)) if sims[i] >= max(0.45, med_sim - 0.18)]
    if inliers:
        dropped = len(embeddings) - len(inliers)
        if dropped > 0:
            print(f'[*] Filtered out {{dropped}} acoustic outlier clip(s) before averaging.')
        embeddings = inliers

batch_mean = np.mean(embeddings, axis=0)
batch_norm = np.linalg.norm(batch_mean)
if batch_norm > 1e-6:
    batch_mean = batch_mean / batch_norm
new_samples_n = len(embeddings)

data = {{'version': '2.0-neural', 'embedding_model': 'speechbrain/spkrec-ecapa-voxceleb', 'embedding_dim': 192, 'profiles': {{}}}}
if os.path.exists(profiles_file):
    try:
        with open(profiles_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception:
        pass

data.setdefault('profiles', {{}})
existing_profile = data['profiles'].get(speaker_name, {{}})
old_count = existing_profile.get('sample_count', 0)
old_emb = existing_profile.get('embedding', [])

if old_count > 0 and isinstance(old_emb, list) and len(old_emb) == 192:
    old_vec = np.array(old_emb, dtype=np.float32)
    new_count = old_count + new_samples_n
    weighted_sum = (old_vec * float(old_count)) + (batch_mean * float(new_samples_n))
    norm_merged = np.linalg.norm(weighted_sum)
    if norm_merged > 1e-6:
        weighted_sum = weighted_sum / norm_merged
    final_emb = [float(x) for x in weighted_sum]
    sample_count = new_count
else:
    final_emb = [float(x) for x in batch_mean]
    sample_count = new_samples_n

profile_entry = dict(existing_profile)
profile_entry.update({{
    'name': speaker_name,
    'sample_count': sample_count,
    'embedding': final_emb
}})
data['profiles'][speaker_name] = profile_entry

with open(profiles_file, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2)

if os.path.exists('public'):
    shutil.copyfile(profiles_file, 'public/voice_profiles.json')

print('__ENROLL_SUCCESS__')
"""
    res = subprocess.run([sys.executable, "-c", worker_code], capture_output=True, text=True, encoding="utf-8")
    if res.returncode != 0 or "__ENROLL_SUCCESS__" not in res.stdout:
        print(f"[!] Enrollment failed:\n{res.stderr}\n{res.stdout}")
        sys.exit(1)

    print(f"[✓] Successfully enrolled '{speaker_name}' ({len(clip_paths)} clip(s)) into {profiles_file}!")
    print(f"    Future Spaces transcribed with transcribe_and_diarize.py will automatically identify {speaker_name}.")


def main():
    parser = argparse.ArgumentParser(description="Extract clean speaker audio clips and enroll into voice_profiles.json")
    parser.add_argument("--json", type=str, help="Path to episode transcript JSON")
    parser.add_argument("--audio", type=str, help="Path to episode audio file (.mp3, .wav, .m4a)")
    parser.add_argument("--output-dir", type=str, default="speaker_samples", help="Output directory for speaker folders")
    parser.add_argument("--min-dur", type=float, default=3.0, help="Minimum clip duration in seconds (default: 3.0)")
    parser.add_argument("--max-dur", type=float, default=15.0, help="Maximum clip duration in seconds (default: 15.0)")
    parser.add_argument("--limit", type=int, default=10, help="Max clips to extract per speaker (default: 10)")
    
    # Enrollment mode
    parser.add_argument("--enroll", type=str, help="Path to an audio clip to enroll into voice_profiles.json")
    parser.add_argument("--name", type=str, help="Speaker name for enrollment")
    parser.add_argument("--profiles", type=str, default="voice_profiles.json", help="Path to voice_profiles.json")

    args = parser.parse_args()

    if args.enroll:
        if not args.name:
            print("[!] Error: --name is required when enrolling a clip.")
            sys.exit(1)
        enroll_clip_to_profiles(args.enroll, args.name, args.profiles)
        return

    if not args.json or not args.audio:
        parser.print_help()
        sys.exit(1)

    process_episode(
        json_path=args.json,
        audio_path=args.audio,
        output_dir=args.output_dir,
        min_duration=args.min_dur,
        max_duration=args.max_dur,
        max_clips_per_speaker=args.limit
    )


if __name__ == "__main__":
    main()
