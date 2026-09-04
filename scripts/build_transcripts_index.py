#!/usr/bin/env python3
"""
scripts/build_transcripts_index.py

Compiles a unified, compact transcripts search index (public/transcripts/transcripts_search_index.json)
from all GitHub Release transcripts. This powers the cross-episode global search in the React web app.
Zero local disk usage for audio: only text JSON transcripts are processed.
"""

import os
import sys
import json
import subprocess
from pathlib import Path

INDEX_PATH = Path("public/transcripts/transcripts_search_index.json")
CACHE_DIR = Path(".cache/transcripts")
CACHE_DIR.mkdir(parents=True, exist_ok=True)

def main():
    print("[*] Fetching releases from GitHub API to build global transcript search index...")
    res = subprocess.run(
        ['gh', 'api', 'repos/aiandbotsgalore/copy-spaces-to-youtube-pipeline/releases?per_page=100'],
        capture_output=True, text=True, check=True
    )
    releases = json.loads(res.stdout)

    index = []
    total_segments = 0

    for r in releases:
        rel_tag = r.get('tag_name', '')
        rel_name = r.get('name') or rel_tag
        mp3_asset = next((a for a in r.get('assets', []) if a.get('name', '').endswith('.mp3') and not ('m' in a.get('name')[:7] and 's' in a.get('name')[:7])), None)
        if not mp3_asset:
            mp3_asset = next((a for a in r.get('assets', []) if a.get('name', '').endswith('.mp3')), None)

        # Pick transcript asset that strictly belongs to this release
        json_asset = None
        for a in r.get('assets', []):
            name = a.get('name', '')
            if name.endswith('.json') and not name.endswith('_clips.json') and name != 'clips_catalog.json' and not ('m' in name[:7] and 's' in name[:7]):
                # Must not be a mismatched test file from another release
                if '20260826_1AxRnZYBVdrxl' in name and rel_tag != '20260826_1AxRnZYBVdrxl':
                    continue
                if a.get('size', 0) > 1000:
                    json_asset = a
                    break

        if not json_asset:
            continue

        asset_id = json_asset.get('id')
        cache_file = CACHE_DIR / f"{rel_tag}_{asset_id}.json"

        raw_json_str = None
        if cache_file.exists():
            try:
                with open(cache_file, "r", encoding="utf-8") as f:
                    raw_json_str = f.read()
            except Exception:
                pass

        if not raw_json_str:
            print(f"[*] Downloading transcript for {rel_tag} ({json_asset['name']})...", flush=True)
            dl = subprocess.run(
                ['gh', 'api', f'repos/aiandbotsgalore/copy-spaces-to-youtube-pipeline/releases/assets/{asset_id}', '-H', 'Accept: application/octet-stream'],
                capture_output=True, text=True
            )
            if dl.returncode == 0:
                raw_json_str = dl.stdout
                with open(cache_file, "w", encoding="utf-8") as f:
                    f.write(raw_json_str)
            else:
                print(f"[!] Could not download asset {asset_id}: {dl.stderr}")
                continue

        try:
            data = json.loads(raw_json_str)
        except Exception as e:
            print(f"[!] JSON decode error for {rel_tag}: {e}")
            continue

        # Extract segments / utterances
        candidates = []
        if isinstance(data, list):
            candidates = data
        elif isinstance(data, dict):
            candidates = data.get('segments') or data.get('utterances') or (data.get('transcript') and data['transcript'].get('segments')) or []

        segments = []
        for s in candidates:
            text = (s.get('text') or s.get('transcript') or '').strip()
            if not text:
                continue
            start = s.get('start') or s.get('start_time') or s.get('start_sec') or 0.0
            end = s.get('end') or s.get('end_time') or s.get('end_sec') or (start + 5.0)
            speaker = s.get('speaker') or s.get('speaker_label') or 'Speaker'
            segments.append({
                'start': round(float(start), 2),
                'end': round(float(end), 2),
                'speaker': str(speaker),
                'text': text
            })

        if segments:
            # Skip known duplicate test copies
            if len(segments) == 1319 and rel_tag != '20260826_1AxRnZYBVdrxl':
                continue

            total_segments += len(segments)
            index.append({
                'release_id': r.get('id'),
                'release_tag': rel_tag,
                'title': rel_name,
                'published_at': r.get('published_at'),
                'audio_url': mp3_asset.get('browser_download_url') if mp3_asset else '',
                'segment_count': len(segments),
                'segments': segments
            })
            print(f"  [✓] {rel_name[:32]:32} : {len(segments)} turns")

    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(INDEX_PATH, "w", encoding="utf-8") as f:
        json.dump(index, f)

    print(f"\n[🎉] Complete! Saved {len(index)} episodes ({total_segments} total spoken turns) to {INDEX_PATH}.")
    print(f"File size: {INDEX_PATH.stat().st_size / (1024*1024):.2f} MB")

if __name__ == "__main__":
    main()
