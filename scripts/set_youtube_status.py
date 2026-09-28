#!/usr/bin/env python3
"""
scripts/set_youtube_status.py

Updates the YouTube visibility/approval metadata for a specific GitHub Release.
Usage:
    python scripts/set_youtube_status.py --tag "20260925_1qJDzWQRqWNKV" --status "APPROVED"
    python scripts/set_youtube_status.py --tag "20260925_1qJDzWQRqWNKV" --status "UNLISTED"
"""

import argparse
import json
import os
import re
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description="Update YouTube approval status in GitHub Release metadata.")
    parser.add_argument("--tag", required=True, help="Release tag (e.g. 20260925_1qJDzWQRqWNKV)")
    parser.add_argument("--status", required=True, choices=["APPROVED", "UNLISTED"], help="New status")
    args = parser.parse_args()

    tag = args.tag.strip()
    status = args.status.upper().strip()

    gh_token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    env = os.environ.copy()
    if gh_token:
        env["GH_TOKEN"] = gh_token

    print(f"[*] Fetching release notes for tag '{tag}'...")
    view_cmd = ["gh", "release", "view", tag, "--json", "body"]
    res = subprocess.run(view_cmd, capture_output=True, text=True, env=env)

    if res.returncode != 0:
        print(f"[🛑] Error: Could not find release '{tag}': {res.stderr.strip()}", file=sys.stderr)
        sys.exit(1)

    try:
        data = json.loads(res.stdout)
        body = data.get("body", "") or ""
    except Exception as e:
        print(f"[🛑] Error parsing release JSON: {e}", file=sys.stderr)
        sys.exit(1)

    tag_pattern = r"METADATA::YOUTUBE(?:_STATUS)?::[A-Za-z0-9_-]+"
    if re.search(tag_pattern, body):
        new_body = re.sub(tag_pattern, f"METADATA::YOUTUBE_STATUS::{status}", body)
    else:
        new_body = body.rstrip() + f"\nMETADATA::YOUTUBE_STATUS::{status}\n"

    print(f"[*] Updating release notes with METADATA::YOUTUBE_STATUS::{status}...")
    notes_file = "temp_release_notes.txt"
    with open(notes_file, "w", encoding="utf-8") as f:
        f.write(new_body)

    try:
        edit_cmd = ["gh", "release", "edit", tag, "--notes-file", notes_file]
        edit_res = subprocess.run(edit_cmd, capture_output=True, text=True, env=env)
        if edit_res.returncode != 0:
            print(f"[🛑] Error updating release: {edit_res.stderr.strip()}", file=sys.stderr)
            sys.exit(1)
        print(f"[✓] Release '{tag}' successfully updated to METADATA::YOUTUBE_STATUS::{status}!")
    finally:
        if os.path.exists(notes_file):
            try:
                os.remove(notes_file)
            except Exception:
                pass


if __name__ == "__main__":
    main()
