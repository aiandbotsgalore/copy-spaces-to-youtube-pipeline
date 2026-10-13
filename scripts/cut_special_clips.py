#!/usr/bin/env python3
"""
scripts/cut_special_clips.py - Dynamic Audio Clip Extraction Tool

Cloud-native & local FFmpeg extraction tool for the SpacePipe documentary curation studio.
Consumes cue sheet audit manifests (JSON), Markdown cue sheets, custom quote ID lists, or the master catalog.
Extracts broadcast-quality 24-bit / 48 kHz stereo WAV production clips with:
- Zero local footprint: streams cloud audio directly via GitHub Releases URLs using fast HTTP range seeking
- Natural boundary padding (0.3s) to prevent clipped syllables
- Boundary micro-fades (18ms) for click/pop prevention
- Hard exclusion enforcement ("I defended him relentlessly")
- Auto-synchronization with public/clips/clips_catalog.json

Usage:
  # Extract clips defined in cue_sheet_audit_results.json (cloud or local):
  python scripts/cut_special_clips.py --audit-results cue_sheet_audit_results.json

  # Extract specific quote IDs:
  python scripts/cut_special_clips.py --quote-ids AQ-0007,AQ-0008,AQ-0276

  # Dry-run audit to check source availability and boundaries without extracting:
  python scripts/cut_special_clips.py --audit-results cue_sheet_audit_results.json --dry-run
"""

import os
import re
import sys
import json
import shutil
import argparse
import subprocess
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

HARD_EXCLUDE_TEXT = "i defended him relentlessly"


def find_ffmpeg_binary() -> Optional[str]:
    """Finds a usable FFmpeg binary from PATH, environment, or known Windows/Unix locations."""
    found = shutil.which("ffmpeg")
    if found:
        return found

    env_path = os.environ.get("FFMPEG_PATH")
    if env_path and os.path.isfile(env_path):
        return env_path

    candidates = [
        r"C:\Hydrus Network\bin\ffmpeg.exe",
        r"C:\ffmpeg-6.1.1-essentials_build.bak-20260421\bin\ffmpeg.exe",
        r"C:\ffmpeg\bin\ffmpeg.exe",
        r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
        "/usr/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
    ]
    for c in candidates:
        if os.path.isfile(c):
            return c
    return None


def parse_cue_ids_from_markdown(md_path: Path) -> List[str]:
    """Extracts Quote IDs (`AQ-xxxx`) in order of appearance from a markdown cue sheet."""
    if not md_path.exists():
        print(f"ERROR: Cue sheet file not found: {md_path}")
        sys.exit(1)

    content = md_path.read_text(encoding="utf-8")
    found = re.findall(r"`(AQ-\d{4})`", content)
    if not found:
        found = re.findall(r"\b(AQ-\d{4})\b", content)

    seen = set()
    ordered_ids = []
    for qid in found:
        if qid not in seen:
            seen.add(qid)
            ordered_ids.append(qid)
    return ordered_ids


def parse_cue_ids_from_input(quote_ids_arg: str) -> List[str]:
    """Parses comma-separated IDs or a text file path containing IDs."""
    path = Path(quote_ids_arg)
    if path.exists() and path.is_file():
        content = path.read_text(encoding="utf-8")
        found = re.findall(r"\b(AQ-\d{4})\b", content)
        return list(dict.fromkeys(found))
    else:
        parts = [p.strip() for p in quote_ids_arg.split(",") if p.strip()]
        return parts


def load_cloud_audio_map() -> Dict[str, str]:
    """Loads mapping of release_tag / episode_id to GitHub Releases cloud audio URLs."""
    summary_map = {}
    summary_path = Path("public/transcripts/transcripts_summary_index.json")
    if summary_path.exists():
        try:
            with open(summary_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                for s in data:
                    tag = s.get("release_tag")
                    url = s.get("audio_url")
                    if tag and url:
                        summary_map[tag] = url
        except Exception as e:
            print(f"Warning: Failed to parse transcripts_summary_index.json: {e}")
    return summary_map


def find_audio_source(audio_dir: Path, episode_id: str, cloud_map: Dict[str, str]) -> Tuple[Optional[str], bool]:
    """
    Finds audio source for an episode.
    Returns (path_or_url, is_remote).
    Checks local audio_dir first, then checks cloud URL mapping.
    """
    if audio_dir.exists():
        for ext in [".mp3", ".m4a", ".wav", ".aac", ".opus", ".flac"]:
            candidates = list(audio_dir.glob(f"*{episode_id}*{ext}"))
            if candidates:
                return str(candidates[0]), False
            sub_candidates = list(audio_dir.glob(f"*/*{episode_id}*{ext}"))
            if sub_candidates:
                return str(sub_candidates[0]), False

    # Check cloud map
    if episode_id in cloud_map:
        return cloud_map[episode_id], True

    # Check partial match on episode_id in cloud_map keys
    for tag, url in cloud_map.items():
        if episode_id in tag or tag in episode_id:
            return url, True

    return None, False


def parse_timestamp_to_seconds(ts_str: str) -> Optional[float]:
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


def sync_clip_to_catalog(
    catalog_path: Path,
    clip_dict: Dict[str, Any]
) -> None:
    """Appends or updates a clip entry in public/clips/clips_catalog.json."""
    if not catalog_path.exists():
        catalog = []
    else:
        try:
            with open(catalog_path, "r", encoding="utf-8") as f:
                catalog = json.load(f)
        except Exception:
            catalog = []

    # Check if entry already exists by file_path or title
    matched_idx = -1
    for i, item in enumerate(catalog):
        if item.get("file_path") == clip_dict.get("file_path") or item.get("title") == clip_dict.get("title"):
            matched_idx = i
            break

    if matched_idx >= 0:
        catalog[matched_idx] = clip_dict
    else:
        catalog.append(clip_dict)

    catalog_path.parent.mkdir(parents=True, exist_ok=True)
    with open(catalog_path, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2)


def main():
    parser = argparse.ArgumentParser(description="Extract production audio clips for Montage Maker & Studio")
    parser.add_argument("--audit-results", default="cue_sheet_audit_results.json",
                        help="Path to JSON audit manifest (defaults to cue_sheet_audit_results.json if present)")
    parser.add_argument("--cue-sheet", default=None,
                        help="Path to Markdown cue sheet to extract (e.g. ANGELA_AUDIO_CUE_SHEET.md)")
    parser.add_argument("--quote-ids", default=None,
                        help="Explicit comma-separated Quote IDs (e.g. AQ-0007,AQ-0008) or file path")
    parser.add_argument("--all-verified", action="store_true",
                        help="Extract all verified quotes in the master JSON")
    parser.add_argument("--audio-dir", default="work",
                        help="Directory containing local source episode audio files")
    parser.add_argument("--out-dir", default="special_clips",
                        help="Output directory to save extracted 24-bit 48kHz WAV clips")
    parser.add_argument("--master-json", default="angela_quotes_master.json",
                        help="Path to quotes master JSON database")
    parser.add_argument("--pad-start", type=float, default=0.3,
                        help="Pre-roll boundary padding in seconds (default: 0.3s)")
    parser.add_argument("--pad-end", type=float, default=0.3,
                        help="Post-roll boundary padding in seconds (default: 0.3s)")
    parser.add_argument("--micro-fade", type=float, default=0.018,
                        help="Boundary anti-click micro-fade duration in seconds (default: 0.018s = 18ms)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Audit cue readiness and source availability without executing FFmpeg")
    parser.add_argument("--no-sync-catalog", action="store_true",
                        help="Skip updating public/clips/clips_catalog.json after extraction")
    args = parser.parse_args()

    ffmpeg_bin = find_ffmpeg_binary()
    if not ffmpeg_bin and not args.dry_run:
        print("ERROR: FFmpeg binary not found in PATH or standard installation directories!")
        print("Set FFMPEG_PATH environment variable or install FFmpeg.")
        sys.exit(1)

    cloud_map = load_cloud_audio_map()

    master_path = Path(args.master_json)
    q_map = {}
    if master_path.exists():
        with open(master_path, "r", encoding="utf-8") as f:
            master_quotes = json.load(f)
        q_map = {q["quote_id"]: q for q in master_quotes}

    audio_dir = Path(args.audio_dir)
    out_dir = Path(args.out_dir)
    if not args.dry_run:
        out_dir.mkdir(parents=True, exist_ok=True)

    print(f"FFmpeg binary:          {ffmpeg_bin or 'Not found (Dry Run mode)'}")
    print(f"Local audio directory:  {audio_dir.resolve()}")
    print(f"Output directory:       {out_dir.resolve()}")
    print(f"Boundary Padding:       Start +{args.pad_start}s, End +{args.pad_end}s")
    print(f"Micro-Fades:            {args.micro_fade * 1000:.0f}ms")
    print(f"Mode:                   {'DRY RUN (Audit only)' if args.dry_run else 'LIVE EXTRACTION (24-bit/48kHz WAV)'}\n")

    # Mode 1: Audit JSON Manifest
    audit_file = Path(args.audit_results)
    if not args.quote_ids and not args.all_verified and not args.cue_sheet and audit_file.exists():
        print(f"Processing cues from audit results manifest: {audit_file.resolve()}\n")
        with open(audit_file, "r", encoding="utf-8") as f:
            audit_cues = json.load(f)

        ready_count = 0
        exists_count = 0
        missing_count = 0
        excluded_count = 0

        print(f"{'ID':<6} {'Quote ID':<10} {'Status':<18} {'Source Type':<12} {'Duration':<10} {'Asset/Details'}")
        print("-" * 90)

        for cue in audit_cues:
            cid = cue.get("cue_id", "")
            qid = cue.get("quote_id", "")
            status = cue.get("status", "")
            verbatim = cue.get("verbatim", "")

            # Hard exclusion check
            if HARD_EXCLUDE_TEXT in verbatim.lower() or qid == "AQ-0269":
                print(f"{cid:<6} {qid:<10} {'EXCLUDED':<18} {'N/A':<12} {'N/A':<10} Hard-excluded phrase: '{HARD_EXCLUDE_TEXT}'")
                excluded_count += 1
                continue

            if status == "EXISTS":
                print(f"{cid:<6} {qid:<10} {'EXISTS':<18} {'Local Master':<12} {'N/A':<10} {cue.get('filename')}")
                exists_count += 1
                continue

            if status == "SOURCE_NOT_AVAILABLE":
                print(f"{cid:<6} {qid:<10} {'UNAVAILABLE':<18} {'None':<12} {'N/A':<10} {cue.get('note')}")
                missing_count += 1
                continue

            start_sec = cue.get("start_seconds")
            end_sec = cue.get("end_seconds")
            ep_id = cue.get("episode_id", "")
            out_filename = cue.get("filename") or f"{cid}_{qid}.wav"
            out_path = out_dir / out_filename

            # Source resolution: check local or cloud
            src_audio, is_remote = find_audio_source(audio_dir, ep_id, cloud_map)
            if not src_audio and cue.get("audio_url"):
                src_audio = cue["audio_url"]
                is_remote = True

            if not src_audio or start_sec is None or end_sec is None:
                print(f"{cid:<6} {qid:<10} {'UNAVAILABLE':<18} {'Missing':<12} {'N/A':<10} Source audio not found for {ep_id}")
                missing_count += 1
                continue

            # Padded boundaries
            cut_in_padded = max(0.0, start_sec - args.pad_start)
            cut_out_padded = end_sec + args.pad_end
            duration_padded = round(cut_out_padded - cut_in_padded, 3)

            src_type = "Cloud Stream" if is_remote else "Local File"
            print(f"{cid:<6} {qid:<10} {'READY':<18} {src_type:<12} {duration_padded:.1f}s      {out_filename}")
            ready_count += 1

            if not args.dry_run and ffmpeg_bin:
                fade_dur = args.micro_fade
                fade_out_st = max(0.0, duration_padded - fade_dur)
                af_filter = f"afade=t=in:ss=0:d={fade_dur:.3f},afade=t=out:st={fade_out_st:.3f}:d={fade_dur:.3f}"

                cmd = [
                    ffmpeg_bin,
                    "-y",
                    "-ss", f"{cut_in_padded:.3f}",
                    "-i", str(src_audio),
                    "-t", f"{duration_padded:.3f}",
                    "-af", af_filter,
                    "-c:a", "pcm_s24le",
                    "-ar", "48000",
                    str(out_path)
                ]

                res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if res.returncode == 0:
                    print(f"       -> Extracted: {out_path.name} ({duration_padded:.1f}s)")
                    if not args.no_sync_catalog:
                        sync_clip_to_catalog(
                            Path("public/clips/clips_catalog.json"),
                            {
                                "title": f"[{cid}] {qid} - {cue.get('category', 'Special')}",
                                "category": cue.get("category", "Investigative"),
                                "start_seconds": start_sec,
                                "end_seconds": end_sec,
                                "duration": duration_padded,
                                "speakers": [cue.get("speaker", "Speaker")],
                                "viral_score": 9,
                                "reason": cue.get("note", "Documentary cue excerpt"),
                                "transcript_snippet": verbatim,
                                "episode": cue.get("episode_key", ep_id),
                                "file_path": str(out_path).replace("\\", "/"),
                                "download_url": f"special_clips/{out_filename}"
                            }
                        )
                else:
                    print(f"       -> ERROR: FFmpeg failed to extract {out_filename}")

        print("\n" + "=" * 60)
        print("EXTRACTION SUMMARY (Audit Results Manifest)")
        print(f"Total Cues Processed:       {len(audit_cues)}")
        print(f"Already Exists (Master):    {exists_count}")
        print(f"Ready / Extracted Cues:     {ready_count}")
        print(f"Excluded by Editorial Rule: {excluded_count}")
        print(f"Missing / Unavailable:      {missing_count}")
        print("=" * 60)
        return

    # Mode 2: Legacy Quote IDs / Markdown Cue Sheet
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

    ready_to_cut = 0
    missing_audio = 0
    pending_alignment = 0
    excluded_count = 0

    for idx, q_id in enumerate(target_ids, 1):
        q = q_map.get(q_id)
        if not q:
            print(f"[{idx:02d}] WARNING: Quote ID {q_id} not found in master database!")
            continue

        verbatim = q.get("quote_verbatim") or q.get("quote") or ""
        if HARD_EXCLUDE_TEXT in verbatim.lower() or q_id == "AQ-0269":
            print(f"[{idx:02d}] EXCLUDED: {q_id} matches hard exclusion phrase ('{HARD_EXCLUDE_TEXT}')")
            excluded_count += 1
            continue

        ep_id = q.get("episode_id", "Unknown")
        speaker_raw = q.get("speaker", "Speaker")
        speaker_clean = "".join(c for c in speaker_raw if c.isalnum() or c in (" ", "_")).strip().replace(" ", "_")[:20]

        cut_in = q.get("cut_in") if q.get("cut_in") is not None else q.get("source_in")
        cut_out = q.get("cut_out") if q.get("cut_out") is not None else q.get("source_out")
        duration = q.get("duration")

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
            print(f"[{idx:02d}] PENDING ALIGNMENT: {q_id} | Ep: {ep_id} (Window: {q.get('transcript_search_window')})")
            pending_alignment += 1
            continue

        src_audio, is_remote = find_audio_source(audio_dir, ep_id, cloud_map)
        out_filename = f"Cue_{idx:02d}_{q_id}_{speaker_clean}.wav"
        out_path = out_dir / out_filename

        if not src_audio:
            print(f"[{idx:02d}] MISSING SOURCE AUDIO: {q_id} | Ep: {ep_id} | Cut: {cut_in:.1f}s–{cut_out:.1f}s")
            missing_audio += 1
            continue

        cut_in_padded = max(0.0, cut_in - args.pad_start)
        cut_out_padded = cut_out + args.pad_end
        duration_padded = round(cut_out_padded - cut_in_padded, 3)

        ready_to_cut += 1
        src_desc = "Cloud" if is_remote else "Local"

        if args.dry_run:
            print(f"[{idx:02d}] READY ({src_desc}): {q_id} -> {out_filename} ({cut_in_padded:.1f}s–{cut_out_padded:.1f}s, len {duration_padded:.1f}s)")
            continue

        if ffmpeg_bin:
            fade_dur = args.micro_fade
            fade_out_st = max(0.0, duration_padded - fade_dur)
            af_filter = f"afade=t=in:ss=0:d={fade_dur:.3f},afade=t=out:st={fade_out_st:.3f}:d={fade_dur:.3f}"

            cmd = [
                ffmpeg_bin,
                "-y",
                "-ss", f"{cut_in_padded:.3f}",
                "-i", str(src_audio),
                "-t", f"{duration_padded:.3f}",
                "-af", af_filter,
                "-c:a", "pcm_s24le",
                "-ar", "48000",
                str(out_path)
            ]

            res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if res.returncode == 0:
                print(f"[{idx:02d}] EXTRACTED: {out_filename} ({duration_padded:.1f}s)")
                if not args.no_sync_catalog:
                    sync_clip_to_catalog(
                        Path("public/clips/clips_catalog.json"),
                        {
                            "title": f"{q_id} - {speaker_raw}",
                            "category": "Investigative",
                            "start_seconds": cut_in,
                            "end_seconds": cut_out,
                            "duration": duration_padded,
                            "speakers": [speaker_raw],
                            "viral_score": 8,
                            "reason": f"Excerpt for quote {q_id}",
                            "transcript_snippet": verbatim,
                            "episode": ep_id,
                            "file_path": str(out_path).replace("\\", "/"),
                            "download_url": f"special_clips/{out_filename}"
                        }
                    )
            else:
                print(f"[{idx:02d}] ERROR: FFmpeg failed on {q_id} from {src_audio}")

    print("\n" + "=" * 60)
    print("EXTRACTION AUDIT SUMMARY")
    print(f"Total Cues Processed:       {len(target_ids)}")
    print(f"Ready / Extracted Cues:     {ready_to_cut}")
    print(f"Excluded by Editorial Rule: {excluded_count}")
    print(f"Pending Timecode Alignment: {pending_alignment}")
    print(f"Missing Source Audio Files: {missing_audio}")
    print("=" * 60)


if __name__ == "__main__":
    main()
