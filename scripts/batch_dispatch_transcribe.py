#!/usr/bin/env python3
"""
Batch Transcribe Dispatcher
Finds all releases with MP3 audio missing transcripts (.txt or .json)
and dispatches the transcribe_episode.yml GitHub Actions workflow for each.
"""

import subprocess
import json
import time
import sys

REPO = "aiandbotsgalore/copy-spaces-to-youtube-pipeline"
WORKFLOW = "transcribe_episode.yml"

def get_all_releases():
    print(f"Fetching all releases for {REPO}...")
    page = 1
    all_releases = []
    while True:
        res = subprocess.run(
            ["gh", "api", f"/repos/{REPO}/releases?per_page=100&page={page}"],
            capture_output=True,
            text=True
        )
        if res.returncode != 0:
            print(f"Error fetching page {page}: {res.stderr}")
            break
        data = json.loads(res.stdout)
        if not data:
            break
        all_releases.extend(data)
        if len(data) < 100:
            break
        page += 1
    print(f"Total releases found across all pages: {len(all_releases)}")
    return all_releases

def find_untranscribed(releases):
    untranscribed = []
    for r in releases:
        if r.get("draft") or r.get("prerelease"):
            continue
        assets = r.get("assets", [])
        has_mp3 = any(a["name"].endswith(".mp3") for a in assets)
        has_transcript = any(a["name"].endswith(".txt") or a["name"].endswith(".json") for a in assets)
        if has_mp3 and not has_transcript:
            untranscribed.append({
                "id": r["id"],
                "tag": r["tag_name"],
                "name": r.get("name") or r["tag_name"],
                "published_at": r.get("published_at"),
                "mp3_name": next(a["name"] for a in assets if a["name"].endswith(".mp3"))
            })
    return untranscribed

def main():
    releases = get_all_releases()
    untranscribed = find_untranscribed(releases)
    
    if not untranscribed:
        print("All releases with MP3s already have transcripts attached! Nothing to do.")
        return 0

    print(f"\nFound {len(untranscribed)} untranscribed episode(s):")
    for idx, ep in enumerate(untranscribed, 1):
        print(f"  {idx:2d}. [{ep['tag']}] {ep['name']}")

    print(f"\nStarting batch dispatch of {len(untranscribed)} transcription workflow(s)...")
    success_count = 0
    fail_count = 0

    for idx, ep in enumerate(untranscribed, 1):
        tag = ep["tag"]
        print(f"[{idx}/{len(untranscribed)}] Dispatching transcribe_episode for {tag}...", end=" ", flush=True)
        res = subprocess.run(
            ["gh", "workflow", "run", WORKFLOW, "--repo", REPO, "-f", f"release_tag={tag}"],
            capture_output=True,
            text=True
        )
        if res.returncode == 0:
            print("OK")
            success_count += 1
        else:
            print(f"FAILED: {res.stderr.strip()}")
            fail_count += 1
        time.sleep(1.5)

    print(f"\nBatch dispatch complete!")
    print(f"  Dispatched: {success_count}")
    print(f"  Failed:     {fail_count}")
    print(f"Monitor live runs at: https://github.com/{REPO}/actions/workflows/{WORKFLOW}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
