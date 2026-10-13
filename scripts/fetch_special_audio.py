#!/usr/bin/env python3
"""
scripts/fetch_special_audio.py - Automated Audio Asset Harvester for Angela Special Presentation

Queries GitHub Releases for the 16 unique episode tags needed for the 32 master presentation cues,
downloads the source MP3s directly to the work/ directory if not already cached.

Usage:
  python scripts/fetch_special_audio.py --dest-dir work
"""

import os
import sys
import json
import urllib.request
import argparse
from pathlib import Path

REPO_OWNER = "aiandbotsgalore"
REPO_NAME = "copy-spaces-to-youtube-pipeline"

# The 16 unique episodes containing all 32 curated presentation cues
TARGET_EPISODES = [
    "20260916_1YxNrbXNjQLxw",  # AQ-0276 (Tannerite)
    "20260908_1nGeLMjONkAKX",  # AQ-0271 (Doxxing confession), AQ-0269 (Defended Logan)
    "20260217_1mrGmBoEYMdJy",  # AQ-0244, AQ-0243, AQ-0248, AQ-0247, AQ-0241, AQ-0242 (SPACE # 1000)
    "20260909_1pKkOXAZPMZKj",  # AQ-0281 (Orr), AQ-0280 (Logan on projection)
    "20260216_1dRJZYLgYXMGB",  # AQ-0254 (Discord burn)
    "20260217_1lPKqMoEQZPKb",  # AQ-0251 (27-person list), AQ-0250 (Baiting discovery)
    "20260217_1OwGWYlXpRmxQ",  # AQ-0146 (Logan shoutout, badass spaces)
    "20260217_1mnGeAPMdvEGX",  # AQ-0097 (Male witch hunt)
    "20260902_1qGvvevyVvgGB",  # AQ-0278 (Screenshot drop), AQ-0279 (Host fear)
    "20260930_1lJQRWLvWVzxE",  # AQ-0031 (Martyrdom on suicide threat)
    "20260918_1AxRnZMeZNYxl",  # AQ-0200, AQ-0201 (Angela screams at Sav), AQ-0213 (Sav mic), AQ-0206 (Parole), AQ-0210 (Infant)
    "20260918_1wGWjlMgYrAKQ",  # AQ-0282 (Process server threat to Sav)
    "20260915_1qGvvebNOARGB",  # AQ-0233 (Nude smear)
    "20260908_1wxWjlrwXokJQ",  # AQ-0261 (Monologue space), AQ-0264 (Under investigation)
    "20260926_1DGleVWzYrdJL",  # AQ-0283 (Logan exposes Kimball Midjourney blackmail)
    "20260904_1OxwbnpyBjLJB"   # AQ-0239 (CPS called 4 times)
]

def download_file(url: str, dest_path: Path):
    """Downloads a file with basic progress display."""
    print(f"Downloading: {dest_path.name}...")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req) as resp, open(dest_path, "wb") as out_file:
        total_size = int(resp.headers.get("Content-Length", 0))
        downloaded = 0
        chunk_size = 1024 * 1024 # 1MB
        while True:
            chunk = resp.read(chunk_size)
            if not chunk:
                break
            out_file.write(chunk)
            downloaded += len(chunk)
            if total_size > 0:
                percent = (downloaded / total_size) * 100
                print(f"  -> {downloaded // (1024*1024)}MB / {total_size // (1024*1024)}MB ({percent:.1f}%)", end="\r")
        print(f"\n  Finished {dest_path.name} ({downloaded // (1024*1024)}MB)")

def main():
    parser = argparse.ArgumentParser(description="Fetch source audio assets for Angela Special")
    parser.add_argument("--dest-dir", default="work", help="Directory to save downloaded episode audio files")
    args = parser.parse_args()

    dest_dir = Path(args.dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)

    print(f"Checking {len(TARGET_EPISODES)} target episodes in GitHub Releases for {REPO_OWNER}/{REPO_NAME}...\n")

    already_cached = 0
    downloaded_count = 0
    missing_count = 0

    for idx, ep_tag in enumerate(TARGET_EPISODES, 1):
        # Check if already cached in dest_dir
        existing = list(dest_dir.glob(f"*{ep_tag}*.mp3"))
        if existing:
            print(f"[{idx:02d}/{len(TARGET_EPISODES)}] ALREADY CACHED: {existing[0].name}")
            already_cached += 1
            continue

        # Query GitHub release metadata for tag
        api_url = f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/releases/tags/{ep_tag}"
        req = urllib.request.Request(api_url, headers={"User-Agent": "Mozilla/5.0"})
        try:
            with urllib.request.urlopen(req) as resp:
                data = json.load(resp)
                mp3_assets = [a for a in data.get("assets", []) if a["name"].endswith(".mp3")]
                if not mp3_assets:
                    print(f"[{idx:02d}/{len(TARGET_EPISODES)}] NO MP3 ASSET in release tag {ep_tag}")
                    missing_count += 1
                    continue
                
                asset = mp3_assets[0]
                dest_file = dest_dir / asset["name"]
                download_file(asset["browser_download_url"], dest_file)
                downloaded_count += 1
        except Exception as e:
            print(f"[{idx:02d}/{len(TARGET_EPISODES)}] ERROR fetching {ep_tag}: {e}")
            missing_count += 1

    print("\n" + "="*50)
    print(f"HARVEST SUMMARY: {already_cached} cached, {downloaded_count} downloaded, {missing_count} missing/failed.")
    print("="*50)

if __name__ == "__main__":
    main()
