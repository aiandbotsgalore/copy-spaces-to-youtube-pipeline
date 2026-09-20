#!/usr/bin/env python3
"""
scripts/build_transcripts_index.py

Compiles a unified, compact transcripts search index (public/transcripts/transcripts_search_index.json)
from all GitHub Release transcripts. This powers the cross-episode global search in the React web app.
Zero local disk usage for audio: only text JSON transcripts are processed.
"""

import os
import sys
import re
import json
import shutil
import subprocess
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    from scripts.clean_transcript_index import clean_episode_segments
except ImportError:
    from clean_transcript_index import clean_episode_segments

INDEX_PATH = Path("public/transcripts/transcripts_search_index.json")
DIST_INDEX_PATH = Path("dist/transcripts/transcripts_search_index.json")
CACHE_DIR = Path(".cache/transcripts")
CACHE_DIR.mkdir(parents=True, exist_ok=True)


def parse_time_to_seconds(time_str: str) -> float:
    if not time_str:
        return 0.0
    cleaned = time_str.strip().lstrip("[").rstrip("]")
    parts = cleaned.split(":")
    try:
        if len(parts) == 3:
            return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
        if len(parts) == 2:
            return float(parts[0]) * 60 + float(parts[1])
        return float(cleaned)
    except Exception:
        return 0.0


def parse_txt_transcript(raw_text: str):
    """Parses standard timestamped text transcript [00:00:00 - 00:00:05] Speaker: text into segment dicts."""
    lines = raw_text.splitlines()
    line_regex = re.compile(
        r"^\[?(\d+:\d{2}(?::\d{2})?(?:\.\d+)?)\s*(?:-\s*(\d+:\d{2}(?::\d{2})?(?:\.\d+)?))?\]?\s*([^:\n\r]+?)\s*:\s*(.*)$"
    )
    segments = []
    current = None

    for line in lines:
        trimmed = line.strip()
        if not trimmed:
            continue
        m = line_regex.match(trimmed)
        if m:
            if current:
                segments.append(current)
            start_sec = parse_time_to_seconds(m.group(1))
            end_sec = parse_time_to_seconds(m.group(2)) if m.group(2) else (start_sec + 5.0)
            speaker = m.group(3).strip() or "Speaker"
            text = m.group(4).strip()
            current = {
                "start": round(start_sec, 2),
                "end": round(end_sec, 2),
                "speaker": speaker,
                "text": text,
            }
        elif current:
            current["text"] += " " + trimmed
        else:
            # First line without timestamp
            current = {
                "start": 0.0,
                "end": 5.0,
                "speaker": "Speaker",
                "text": trimmed,
            }

    if current:
        segments.append(current)

    return segments


def main():
    print("[*] Fetching all releases from GitHub API with pagination...")
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    env = os.environ.copy()
    if token:
        env["GH_TOKEN"] = token
        env["GITHUB_TOKEN"] = token

    cmd = ["gh", "api", "repos/aiandbotsgalore/copy-spaces-to-youtube-pipeline/releases?per_page=100", "--paginate"]
    res = subprocess.run(cmd, capture_output=True, text=True, check=True, env=env)
    releases = []
    decoder = json.JSONDecoder()
    pos = 0
    raw = res.stdout
    while pos < len(raw.strip()):
        while pos < len(raw) and raw[pos].isspace():
            pos += 1
        if pos >= len(raw):
            break
        obj, idx = decoder.raw_decode(raw[pos:])
        pos += idx
        if isinstance(obj, list):
            releases.extend(obj)
        elif isinstance(obj, dict):
            releases.append(obj)
    print(f"[*] Found {len(releases)} total releases across repository.")

    index = []
    total_segments = 0

    for r in releases:
        rel_tag = r.get("tag_name", "")
        rel_name = r.get("name") or rel_tag
        assets = r.get("assets", [])

        mp3_asset = next(
            (
                a
                for a in assets
                if a.get("name", "").endswith(".mp3")
                and not ("m" in a.get("name")[:7] and "s" in a.get("name")[:7])
            ),
            None,
        )
        if not mp3_asset:
            mp3_asset = next((a for a in assets if a.get("name", "").endswith(".mp3")), None)

        # 1. Prefer JSON transcript asset
        transcript_asset = None
        is_txt_format = False

        for a in assets:
            name = a.get("name", "")
            if (
                name.endswith(".json")
                and not name.endswith("_clips.json")
                and name != "clips_catalog.json"
                and not ("m" in name[:7] and "s" in name[:7])
            ):
                if "20260826_1AxRnZYBVdrxl" in name and rel_tag != "20260826_1AxRnZYBVdrxl":
                    continue
                if a.get("size", 0) > 100:
                    transcript_asset = a
                    is_txt_format = False
                    break

        # 2. Fallback to TXT transcript asset if no valid JSON transcript
        if not transcript_asset:
            for a in assets:
                name = a.get("name", "")
                if name.endswith(".txt") and a.get("size", 0) > 100:
                    transcript_asset = a
                    is_txt_format = True
                    break

        if not transcript_asset:
            continue

        asset_id = transcript_asset.get("id")
        cache_ext = "txt" if is_txt_format else "json"
        cache_file = CACHE_DIR / f"{rel_tag}_{asset_id}.{cache_ext}"

        raw_str = None
        if cache_file.exists():
            try:
                with open(cache_file, "r", encoding="utf-8") as f:
                    raw_str = f.read()
            except Exception:
                pass

        if not raw_str:
            print(f"[*] Downloading transcript for {rel_tag} ({transcript_asset['name']})...", flush=True)
            dl = subprocess.run(
                [
                    "gh",
                    "api",
                    f"repos/aiandbotsgalore/copy-spaces-to-youtube-pipeline/releases/assets/{asset_id}",
                    "-H",
                    "Accept: application/octet-stream",
                ],
                capture_output=True,
                text=True,
                env=env,
            )
            if dl.returncode == 0:
                raw_str = dl.stdout
                with open(cache_file, "w", encoding="utf-8") as f:
                    f.write(raw_str)
            else:
                print(f"[!] Could not download asset {asset_id}: {dl.stderr}")
                continue

        segments = []

        if is_txt_format:
            segments = parse_txt_transcript(raw_str)
        else:
            try:
                data = json.loads(raw_str)
            except Exception as e:
                print(f"[!] JSON decode error for {rel_tag}: {e}")
                # Try fallback text parser in case JSON is corrupted or plain text inside
                segments = parse_txt_transcript(raw_str)
                data = None

            if data is not None:
                candidates = []
                if isinstance(data, list):
                    candidates = data
                elif isinstance(data, dict):
                    candidates = (
                        data.get("segments")
                        or data.get("utterances")
                        or (data.get("transcript") and data["transcript"].get("segments"))
                        or (data.get("data") and data["data"].get("segments"))
                        or []
                    )

                for s in candidates:
                    text = (s.get("text") or s.get("transcript") or "").strip()
                    if not text:
                        continue
                    start = s.get("start") or s.get("start_time") or s.get("start_sec") or 0.0
                    end = s.get("end") or s.get("end_time") or s.get("end_sec") or (start + 5.0)
                    speaker = s.get("speaker") or s.get("speaker_label") or s.get("speaker_id") or "Speaker"
                    segments.append(
                        {
                            "start": round(float(start), 2),
                            "end": round(float(end), 2),
                            "speaker": str(speaker),
                            "text": text,
                        }
                    )

        if segments:
            # Skip known duplicate test copies
            if len(segments) == 1319 and rel_tag != "20260826_1AxRnZYBVdrxl":
                continue

            cleaned_segments = clean_episode_segments(segments, rel_name)
            total_segments += len(cleaned_segments)
            index.append(
                {
                    "release_id": r.get("id"),
                    "release_tag": rel_tag,
                    "title": rel_name,
                    "published_at": r.get("published_at"),
                    "audio_url": mp3_asset.get("browser_download_url") if mp3_asset else "",
                    "segment_count": len(cleaned_segments),
                    "segments": cleaned_segments,
                }
            )
            print(f"  [✓] {rel_name[:36]:36} : {len(cleaned_segments)} turns", flush=True)

    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(INDEX_PATH, "w", encoding="utf-8") as f:
        json.dump(index, f)

    if DIST_INDEX_PATH.parent.exists():
        shutil.copyfile(INDEX_PATH, DIST_INDEX_PATH)

    print(f"\n[🎉] Complete! Saved {len(index)} episodes ({total_segments} total spoken turns) to {INDEX_PATH}.")
    print(f"File size: {INDEX_PATH.stat().st_size / (1024*1024):.2f} MB")


if __name__ == "__main__":
    main()
