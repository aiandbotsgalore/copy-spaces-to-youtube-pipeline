#!/usr/bin/env python3
"""
scripts/sync_clips_catalog.py

Aggregates all highlight clips from all GitHub Releases and local catalog,
and updates public/clips/clips_catalog.json so that the React web app displays
all live clips from the cloud releases with playable audio URLs.
"""

import re
import json
import subprocess
from pathlib import Path

PUBLIC_CATALOG = Path("public/clips/clips_catalog.json")

def parse_clip_info(filename: str, release_title: str, download_url: str):
    stem = Path(filename).stem
    # Match patterns like 07m19s_Title or 01h33m45s_Title
    m = re.match(r"^(?:(\d+)h)?(\d+)m(\d+)s_(.*)$", stem)
    start_sec = 0.0
    if m:
        hours = int(m.group(1)) if m.group(1) else 0
        minutes = int(m.group(2))
        seconds = int(m.group(3))
        start_sec = hours * 3600 + minutes * 60 + seconds
        title_raw = m.group(4)
    else:
        title_raw = stem

    title = title_raw.replace("_", " ").replace(".", "'").strip()
    
    return {
        "title": title,
        "category": "Highlights",
        "start_seconds": start_sec,
        "end_seconds": start_sec + 60.0,
        "duration": 60.0,
        "speakers": ["Speaker"],
        "viral_score": 9,
        "reason": f"AI selected highlight moment from {release_title}.",
        "transcript_snippet": f"Highlight moment from {release_title}",
        "episode": release_title,
        "file_path": download_url,
        "download_url": download_url
    }

def main():
    print("[*] Fetching releases to scan for highlight clips...")
    cmd = ["gh", "api", "repos/aiandbotsgalore/copy-spaces-to-youtube-pipeline/releases?per_page=100"]
    res = subprocess.run(cmd, capture_output=True, text=True, check=True)
    releases = json.loads(res.stdout)

    # Load existing local catalog if present
    existing_clips = []
    if PUBLIC_CATALOG.exists():
        try:
            with open(PUBLIC_CATALOG, "r", encoding="utf-8") as f:
                existing_clips = json.load(f)
        except Exception:
            existing_clips = []

    print(f"[*] Found {len(existing_clips)} existing catalog entries.")
    
    # Map existing clips by title / file_path
    seen_titles = {c.get("title", "").lower() for c in existing_clips}
    seen_files = {Path(c.get("file_path", "")).name.lower() for c in existing_clips if c.get("file_path")}

    new_clips_added = 0
    
    for r in releases:
        rel_name = r.get("name") or r.get("tag_name")
        assets = r.get("assets", [])

        # Check if release has rich clips metadata JSON
        clips_json_asset = next(
            (a for a in assets if a.get("name", "").endswith("_clips.json") or a.get("name") == "clips_catalog.json"),
            None
        )

        if clips_json_asset:
            try:
                asset_id = clips_json_asset.get("id")
                api_cmd = ["gh", "api", f"repos/aiandbotsgalore/copy-spaces-to-youtube-pipeline/releases/assets/{asset_id}", "-H", "Accept: application/octet-stream"]
                api_res = subprocess.run(api_cmd, capture_output=True, text=True)
                if api_res.returncode == 0:
                    remote_meta = json.loads(api_res.stdout)
                else:
                    import urllib.request
                    with urllib.request.urlopen(clips_json_asset["browser_download_url"], timeout=15) as resp:
                        remote_meta = json.loads(resp.read().decode("utf-8"))
                    if isinstance(remote_meta, list):
                        for rc in remote_meta:
                            # Match MP3 asset
                            rc_start = round(rc.get("start_seconds", 0))
                            matched_asset = next(
                                (a for a in assets if a.get("name", "").endswith(".mp3") and (
                                    a.get("name", "").lower() == Path(rc.get("file_path", "")).name.lower() or
                                    abs(parse_clip_info(a.get("name", ""), rel_name, "")["start_seconds"] - rc_start) <= 5
                                )),
                                None
                            )
                            if matched_asset:
                                rc["file_path"] = matched_asset.get("browser_download_url")
                                rc["download_url"] = matched_asset.get("browser_download_url")
                                seen_files.add(matched_asset.get("name", "").lower())
                            rc["episode"] = rc.get("episode") or rel_name

                            # Replace existing placeholder if present, else append
                            ex_idx = next(
                                (idx for idx, c in enumerate(existing_clips) if (
                                    c.get("episode") == rc["episode"] and (
                                        c.get("title", "").lower() == rc.get("title", "").lower() or
                                        abs(c.get("start_seconds", 0) - rc["start_seconds"]) <= 5
                                    )
                                )),
                                None
                            )
                            if ex_idx is not None:
                                existing_clips[ex_idx] = rc
                            else:
                                existing_clips.append(rc)
                                new_clips_added += 1
                                print(f"  [+] Added rich cloud clip: \"{rc.get('title')}\" ({rel_name})")
            except Exception as e:
                print(f"  [!] Failed fetching clips JSON for {rel_name}: {e}")

        for a in assets:
            fname = a.get("name", "")
            dl_url = a.get("browser_download_url", "")
            
            # Check if this asset is a clip (e.g. starts with timestamp like 07m19s or 03h05m)
            if fname.endswith(".mp3") and ("m" in fname[:7] and "s" in fname[:7]):
                if fname.lower() not in seen_files:
                    clip_data = parse_clip_info(fname, rel_name, dl_url)
                    existing_clips.append(clip_data)
                    seen_files.add(fname.lower())
                    new_clips_added += 1
                    print(f"  [+] Added fallback clip: {fname} ({rel_name})")

    # Save merged catalog
    PUBLIC_CATALOG.parent.mkdir(parents=True, exist_ok=True)
    with open(PUBLIC_CATALOG, "w", encoding="utf-8") as f:
        json.dump(existing_clips, f, indent=2)

    print(f"\n[✓] Successfully updated {PUBLIC_CATALOG}: {len(existing_clips)} total clips ({new_clips_added} new cloud clips added).")

if __name__ == "__main__":
    main()
