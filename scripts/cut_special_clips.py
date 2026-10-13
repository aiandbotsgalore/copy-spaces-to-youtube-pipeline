#!/usr/bin/env python3
"""
scripts/cut_special_clips.py - Dynamic Audio Clip Extraction Tool

Flexible FFmpeg extraction tool for the Angela Maggard investigative audio documentary.
Consumes dynamic cue sheets (Markdown or JSON), custom quote ID lists, or the master catalog.
Extracts broadcast-quality 24-bit / 48 kHz stereo WAV production clips.

Usage:
  # Extract clips defined in the active production cue sheet:
  python scripts/cut_special_clips.py --cue-sheet ANGELA_AUDIO_CUE_SHEET.md --audio-dir work --out-dir special_clips

  # Extract specific quote IDs:
  python scripts/cut_special_clips.py --quote-ids AQ-0012,AQ-0271,AQ-0276 --audio-dir work

  # Dry-run audit to check source audio availability without extracting:
  python scripts/cut_special_clips.py --cue-sheet ANGELA_AUDIO_CUE_SHEET.md --dry-run
"""

import os
import re
import sys
import json
import shutil
import argparse
import subprocess
from pathlib import Path


def parse_cue_ids_from_markdown(md_path: Path) -> list[str]:
    """Extracts Quote IDs (`AQ-xxxx`) in order of appearance from a markdown cue sheet."""
    if not md_path.exists():
        print(f"ERROR: Cue sheet file not found: {md_path}")
        sys.exit(1)

    content = md_path.read_text(encoding="utf-8")
    # Match patterns like `AQ-0123` or AQ-0123
    found = re.findall(r"`(AQ-\d{4})`", content)
    if not found:
        found = re.findall(r"\b(AQ-\d{4})\b", content)

    # Preserve order while removing duplicates
    seen = set()
    ordered_ids = []
    for qid in found:
        if qid not in seen:
            seen.add(qid)
            ordered_ids.append(qid)
    return ordered_ids


def parse_cue_ids_from_input(quote_ids_arg: str) -> list[str]:
    """Parses comma-separated IDs or a text file path containing IDs."""
    path = Path(quote_ids_arg)
    if path.exists() and path.is_file():
        content = path.read_text(encoding="utf-8")
        found = re.findall(r"\b(AQ-\d{4})\b", content)
        return list(dict.fromkeys(found))
    else:
        parts = [p.strip() for p in quote_ids_arg.split(",") if p.strip()]
        return parts


def find_audio_file(audio_dir: Path, episode_id: str) -> Path | None:
    """Finds an audio file matching episode_id in audio_dir or its subdirectories."""
    for ext in [".mp3", ".m4a", ".wav", ".aac", ".opus", ".flac"]:
        candidates = list(audio_dir.glob(f"*{episode_id}*{ext}"))
        if candidates:
            return candidates[0]
        # Check one level of subdirectories if present
        sub_candidates = list(audio_dir.glob(f"*/*{episode_id}*{ext}"))
        if sub_candidates:
            return sub_candidates[0]
    return None


def parse_timestamp_to_seconds(ts_str: str) -> float | None:
    """Converts HH:MM:SS or MM:SS to total seconds."""
    if not ts_str:
        return None
    try:
        parts = ts_str.strip().split(":")
        if len(parts) == 3:
            return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
        elif len(parts) == 2:
            return float(parts[0]) * 60 + float(parts[1])
        elif len(parts) == 1:
            return float(parts[0])
    except ValueError:
        return None
    return None


def main():
    parser = argparse.ArgumentParser(description="Extract production audio clips for Angela Special")
    parser.add_argument("--cue-sheet", default="ANGELA_AUDIO_CUE_SHEET.md",
                        help="Path to Markdown cue sheet to extract (defaults to ANGELA_AUDIO_CUE_SHEET.md)")
    parser.add_argument("--quote-ids", default=None,
                        help="Explicit comma-separated Quote IDs (e.g. AQ-0012,AQ-0271) or file path")
    parser.add_argument("--all-verified", action="store_true",
                        help="Extract all verified quotes in the master JSON")
    parser.add_argument("--audio-dir", default="work",
                        help="Directory containing source episode audio files")
    parser.add_argument("--out-dir", default="special_clips",
                        help="Output directory to save extracted 24-bit 48kHz WAV clips")
    parser.add_argument("--master-json", default="angela_quotes_master.json",
                        help="Path to quotes master JSON database")
    parser.add_argument("--dry-run", action="store_true",
                        help="Audit cue readiness and file existence without executing ffmpeg")
    args = parser.parse_args()

    ffmpeg_bin = shutil.which("ffmpeg")
    if not ffmpeg_bin and not args.dry_run:
        print("ERROR: ffmpeg not found in PATH!")
        sys.exit(1)

    master_path = Path(args.master_json)
    if not master_path.exists():
        print(f"ERROR: Master JSON database not found: {master_path}")
        sys.exit(1)

    with open(master_path, "r", encoding="utf-8") as f:
        master_quotes = json.load(f)
    q_map = {q["quote_id"]: q for q in master_quotes}

    # Determine target quote IDs to extract
    target_ids = []
    if args.quote_ids:
        target_ids = parse_cue_ids_from_input(args.quote_ids)
        print(f"Targeting {len(target_ids)} quotes from CLI --quote-ids.")
    elif args.all_verified:
        target_ids = [q["quote_id"] for q in master_quotes if q.get("verification_status") != "PURGED"]
        print(f"Targeting all {len(target_ids)} active quotes from master JSON.")
    elif args.cue_sheet and Path(args.cue_sheet).exists():
        target_ids = parse_cue_ids_from_markdown(Path(args.cue_sheet))
        print(f"Targeting {len(target_ids)} unique quotes parsed from cue sheet: {args.cue_sheet}")
    else:
        print("ERROR: No valid target quotes or cue sheet specified.")
        sys.exit(1)

    audio_dir = Path(args.audio_dir)
    out_dir = Path(args.out_dir)
    if not args.dry_run:
        out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Audio source directory: {audio_dir.resolve()}")
    print(f"Output directory:       {out_dir.resolve()}")
    print(f"Mode:                   {'DRY RUN (Audit only)' if args.dry_run else 'LIVE EXTRACTION (24-bit/48kHz WAV)'}\n")

    ready_to_cut = 0
    missing_audio = 0
    pending_alignment = 0

    for idx, q_id in enumerate(target_ids, 1):
        q = q_map.get(q_id)
        if not q:
            print(f"[{idx:02d}] WARNING: Quote ID {q_id} not found in master database!")
            continue

        ep_id = q.get("episode_id", "Unknown")
        speaker_raw = q.get("speaker", "Speaker")
        speaker_clean = "".join(c for c in speaker_raw if c.isalnum() or c in (" ", "_")).strip().replace(" ", "_")[:20]

        cut_in = q.get("cut_in") if q.get("cut_in") is not None else q.get("source_in")
        cut_out = q.get("cut_out") if q.get("cut_out") is not None else q.get("source_out")
        duration = q.get("duration")

        # If cut_in is still None, attempt to fall back to transcript search window
        if cut_in is None and q.get("transcript_search_window"):
            win = q["transcript_search_window"]
            parts = win.replace("–", "-").split("-")
            if len(parts) == 2:
                t1 = parse_timestamp_to_seconds(parts[0])
                t2 = parse_timestamp_to_seconds(parts[1])
                if t1 is not None and t2 is not None:
                    cut_in = t1
                    cut_out = t2
                    duration = t2 - t1

        if cut_in is None or cut_out is None:
            print(f"[{idx:02d}] PENDING ALIGNMENT: {q_id} | Ep: {ep_id} | Requires timecode alignment (Window: {q.get('transcript_search_window')})")
            pending_alignment += 1
            continue

        if duration is None:
            duration = cut_out - cut_in

        src_audio = find_audio_file(audio_dir, ep_id)
        out_filename = f"Cue_{idx:02d}_{q_id}_{speaker_clean}.wav"
        out_path = out_dir / out_filename

        if not src_audio:
            print(f"[{idx:02d}] MISSING SOURCE AUDIO: {q_id} | Ep: {ep_id} | Cut: {cut_in:.1f}s–{cut_out:.1f}s ({duration:.1f}s)")
            missing_audio += 1
            continue

        ready_to_cut += 1

        if args.dry_run:
            print(f"[{idx:02d}] READY: {q_id} -> {src_audio.name} ({cut_in:.1f}s to {cut_out:.1f}s, len {duration:.1f}s)")
            continue

        # Execute FFmpeg 24-bit 48kHz PCM WAV extraction
        cmd = [
            ffmpeg_bin,
            "-y",
            "-ss", str(cut_in),
            "-i", str(src_audio),
            "-t", str(duration),
            "-c:a", "pcm_s24le",
            "-ar", "48000",
            str(out_path)
        ]

        res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if res.returncode == 0:
            print(f"[{idx:02d}] EXTRACTED: {out_filename} ({duration:.1f}s)")
        else:
            print(f"[{idx:02d}] ERROR: FFmpeg failed on {q_id} from {src_audio.name}")

    print("\n" + "=" * 60)
    print("EXTRACTION AUDIT SUMMARY")
    print(f"Total Cues Processed:       {len(target_ids)}")
    print(f"Ready / Extracted Cues:     {ready_to_cut}")
    print(f"Pending Timecode Alignment: {pending_alignment}")
    print(f"Missing Source Audio Files: {missing_audio}")
    print("=" * 60)


if __name__ == "__main__":
    main()
