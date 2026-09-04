#!/usr/bin/env python3
import json
import subprocess
from pathlib import Path

def main():
    print("[*] Fetching all releases and assets via GitHub API with pagination...")
    cmd = ["gh", "api", "repos/aiandbotsgalore/copy-spaces-to-youtube-pipeline/releases?per_page=100", "--paginate"]
    res = subprocess.run(cmd, capture_output=True, text=True, check=True)
    
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
    
    # Sort strictly most recent to oldest (by published_at or created_at)
    releases.sort(key=lambda r: r.get("published_at") or r.get("created_at") or "", reverse=True)
    
    queue = []
    
    print(f"\nTotal Releases Found: {len(releases)}\n")
    print(f"{'#':<3} | {'Tag':<24} | {'Published':<19} | {'Status':<20} | Title")
    print("-" * 105)
    
    for i, r in enumerate(releases, 1):
        tag = r.get("tag_name", "")
        pub = (r.get("published_at") or r.get("created_at") or "")[:19]
        title = (r.get("name") or "Untitled")[:36]
        assets = r.get("assets", [])
        
        main_mp3 = next((a for a in assets if a["name"].endswith(".mp3") and not ("m" in a["name"][:7] and "s" in a["name"][:7])), None)
        json_asset = next((a for a in assets if a["name"].endswith(".json") and a.get("size", 0) > 1000), None)
        clips = [a for a in assets if a["name"].endswith(".mp3") and ("m" in a["name"][:7] and "s" in a["name"][:7])]
        
        has_mp3 = main_mp3 is not None
        has_json = json_asset is not None
        clip_count = len(clips)
        
        if not has_mp3:
            status = "NO_MP3"
        elif has_json and clip_count >= 3:
            status = f"DONE ({clip_count} clips)"
        elif has_json and clip_count == 0:
            status = "NEEDS_CLIPS"
            queue.append({"tag": tag, "title": title, "mode": "CLIPS_ONLY", "published": pub})
        else:
            status = "NEEDS_TRANSCRIBE"
            queue.append({"tag": tag, "title": title, "mode": "TRANSCRIBE_AND_CLIPS", "published": pub})
            
        print(f"{i:<3} | {tag:<24} | {pub:<19} | {status:<20} | {title}")

    print("\n" + "=" * 105)
    print(f"[*] ACTION QUEUE: {len(queue)} episodes to process (Chronological: Most Recent to Oldest):")
    print("=" * 105)
    for idx, item in enumerate(queue, 1):
        print(f"  {idx:<2}. [{item['mode']:<20}] {item['tag']:<24} -> {item['title']}")

    with open("processing_queue.json", "w", encoding="utf-8") as f:
        json.dump(queue, f, indent=2)
    print(f"\n[✓] Saved {len(queue)} episodes to processing_queue.json")

if __name__ == "__main__":
    main()
