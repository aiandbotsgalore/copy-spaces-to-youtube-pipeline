#!/usr/bin/env python3
"""
scripts/sync_clips_catalog.py

Aggregates all highlight clips from all GitHub Releases and local catalog,
and updates public/clips/clips_catalog.json so that the React web app displays
all live clips from the cloud releases with playable audio URLs.
"""

import os
import sys
import re
import json
import argparse
import subprocess
import urllib.request
import urllib.parse
from pathlib import Path
from typing import List, Dict, Any, Optional

PUBLIC_CATALOG = Path("public/clips/clips_catalog.json")


def parse_clip_info(filename: str, release_title: str, download_url: str) -> Dict[str, Any]:
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
        "viral_score": 8,
        "reason": f"AI selected highlight moment from {release_title}.",
        "transcript_snippet": f"Highlight moment from {release_title}",
        "episode": release_title,
        "file_path": download_url,
        "download_url": download_url
    }


def fetch_all_releases(repo: str, token: Optional[str] = None) -> List[Dict[str, Any]]:
    """Fetches releases with pagination using HTTP or gh cli fallback."""
    releases = []

    # First attempt: gh cli if available (handles auth automatically)
    try:
        cmd = ["gh", "api", f"repos/{repo}/releases?per_page=100", "--paginate"]
        env = os.environ.copy()
        if token:
            env["GH_TOKEN"] = token
            env["GITHUB_TOKEN"] = token
        res = subprocess.run(cmd, capture_output=True, text=True, check=True, env=env)
        raw = res.stdout
        decoder = json.JSONDecoder()
        pos = 0
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
        if releases:
            return releases
    except Exception:
        pass

    # Fallback: direct HTTP request via urllib
    headers = {"Accept": "application/vnd.github.v3+json", "User-Agent": "SpacePipe-ClipsSync"}
    if token:
        headers["Authorization"] = f"token {token}"

    page = 1
    while True:
        url = f"https://api.github.com/repos/{repo}/releases?per_page=100&page={page}"
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=20.0) as resp:
                batch = json.loads(resp.read().decode("utf-8"))
                if not batch:
                    break
                releases.extend(batch)
                if len(batch) < 100:
                    break
                page += 1
        except Exception as e:
            print(f"[!] Notice: page {page} fetch stopped: {e}")
            break

    return releases


def main():
    parser = argparse.ArgumentParser(description="Synchronize highlight clips catalog from repository releases")
    parser.add_argument("--repo", default=os.environ.get("REPO", os.environ.get("GITHUB_REPOSITORY", "aiandbotsgalore/copy-spaces-to-youtube-pipeline")))
    parser.add_argument("--token", default=os.environ.get("GH_TOKEN", os.environ.get("GITHUB_TOKEN", "")))
    parser.add_argument("--commit", action="store_true", help="Auto-commit updated catalog if changes occurred")
    args = parser.parse_args()

    print(f"[*] Fetching releases to scan for highlight clips from {args.repo}...")
    releases = fetch_all_releases(args.repo, args.token)
    print(f"[✓] Retrieved {len(releases)} total releases.")

    # Load existing local catalog if present
    existing_clips = []
    if PUBLIC_CATALOG.exists():
        try:
            with open(PUBLIC_CATALOG, "r", encoding="utf-8") as f:
                existing_clips = json.load(f)
        except Exception:
            existing_clips = []

    initial_count = len(existing_clips)
    print(f"[*] Found {initial_count} existing catalog entries.")

    seen_files = {Path(c.get("file_path", "")).name.lower() for c in existing_clips if c.get("file_path")}

    new_clips_added = 0

    headers = {"User-Agent": "SpacePipe-ClipsSync"}
    if args.token:
        headers["Authorization"] = f"token {args.token}"

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
                dl_url = clips_json_asset.get("browser_download_url")
                req = urllib.request.Request(dl_url, headers=headers)
                with urllib.request.urlopen(req, timeout=15.0) as resp:
                    remote_meta = json.loads(resp.read().decode("utf-8"))

                if isinstance(remote_meta, list):
                    for rc in remote_meta:
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
            except Exception as e:
                pass

        for a in assets:
            fname = a.get("name", "")
            dl_url = a.get("browser_download_url", "")

            # Check if this asset is a clip (e.g. starts with timestamp like 07m19s or 03h05m20s)
            if fname.endswith(".mp3") and not re.match(r"^20\d{6}_", fname) and re.match(r"^(?:(\d+)h)?(\d+)m(\d+)s", fname):
                if fname.lower() not in seen_files:
                    clip_data = parse_clip_info(fname, rel_name, dl_url)
                    existing_clips.append(clip_data)
                    seen_files.add(fname.lower())
                    new_clips_added += 1

    # Deduplicate and prioritize rich metadata over generic fallback entries
    entries_by_file = {}
    other_entries = []
    for c in existing_clips:
        fp = c.get("file_path") or ""
        fname = Path(fp).name.lower()
        is_placeholder = "AI selected highlight moment from" in c.get("reason", "")
        if fname and fname.endswith(".mp3"):
            if fname not in entries_by_file:
                entries_by_file[fname] = c
            else:
                curr = entries_by_file[fname]
                curr_is_placeholder = "AI selected highlight moment from" in curr.get("reason", "")
                if curr_is_placeholder and not is_placeholder:
                    entries_by_file[fname] = c
                elif not curr_is_placeholder and not is_placeholder:
                    if len(c.get("reason", "")) > len(curr.get("reason", "")):
                        entries_by_file[fname] = c
        else:
            other_entries.append(c)

    final_clips = list(entries_by_file.values()) + other_entries

    # Save merged catalog
    PUBLIC_CATALOG.parent.mkdir(parents=True, exist_ok=True)
    with open(PUBLIC_CATALOG, "w", encoding="utf-8") as f:
        json.dump(final_clips, f, indent=2)

    print(f"\n[✓] Successfully updated {PUBLIC_CATALOG}: {len(final_clips)} total clips ({new_clips_added} new cloud clips added).")

    # If --commit requested and changes occurred
    if args.commit and len(final_clips) != initial_count:
        try:
            subprocess.run(["git", "config", "user.name", "github-actions[bot]"], check=True)
            subprocess.run(["git", "config", "user.email", "github-actions[bot]@users.noreply.github.com"], check=True)
            subprocess.run(["git", "add", str(PUBLIC_CATALOG)], check=True)
            subprocess.run(["git", "commit", "-m", f"chore(clips): sync highlight clips catalog ({len(final_clips)} clips) [skip ci]"], check=True)
            subprocess.run(["git", "push"], check=True)
            print("[✓] Committed and pushed updated clips catalog to git repository.")
        except Exception as git_err:
            print(f"[!] Notice: Git commit/push skipped: {git_err}")


if __name__ == "__main__":
    main()

