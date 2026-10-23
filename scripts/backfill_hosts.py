#!/usr/bin/env python3
"""
Backfill METADATA::HOST::<handle> into existing release bodies.

New ingests record the host automatically (see scripts/ingest.sh). This adds it to episodes
processed before that change by asking yt-dlp for the Space's uploader_id.

Usage (needs `gh` authenticated with release write access, and yt-dlp on PATH):
    python scripts/backfill_hosts.py                 # dry run: prints what it would change
    python scripts/backfill_hosts.py --apply         # edits release bodies on GitHub
    python scripts/backfill_hosts.py --apply --limit 20

Safe to re-run: releases that already have METADATA::HOST are skipped. Spaces that yt-dlp
cannot resolve (ended/expired) are reported and left untouched.
Afterwards run scripts/build_transcripts_index.py to refresh the summary index.
"""
import argparse
import json
import re
import subprocess
import sys


def sh(cmd, check=True):
    return subprocess.run(cmd, capture_output=True, text=True, check=check)


def list_releases(repo):
    out = sh(["gh", "api", "--paginate", f"repos/{repo}/releases?per_page=100"]).stdout
    # --paginate concatenates JSON arrays; decode them one after another
    dec, idx, rels = json.JSONDecoder(), 0, []
    out = out.strip()
    while idx < len(out):
        arr, end = dec.raw_decode(out, idx)
        rels.extend(arr)
        idx = end
        while idx < len(out) and out[idx].isspace():
            idx += 1
    return rels


def host_for(space_id):
    url = f"https://x.com/i/spaces/{space_id}"
    r = sh(["yt-dlp", "--print", "uploader_id", "--no-warnings", url], check=False)
    lines = [l.strip() for l in r.stdout.splitlines() if l.strip() and l.strip() != "NA"]
    return lines[0].lstrip("@") if lines else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=None, help="owner/name (default: current gh repo)")
    ap.add_argument("--apply", action="store_true", help="actually edit release bodies")
    ap.add_argument("--limit", type=int, default=0, help="stop after N releases examined")
    args = ap.parse_args()

    repo = args.repo or sh(["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]).stdout.strip()
    releases = list_releases(repo)
    todo = changed = failed = 0
    for rel in releases:
        body = rel.get("body") or ""
        if "METADATA::HOST::" in body:
            continue
        m = re.search(r"METADATA::SOURCE_ID::(\S+)", body)
        if not m:
            continue
        todo += 1
        if args.limit and todo > args.limit:
            break
        handle = host_for(m.group(1))
        if not handle:
            failed += 1
            print(f"  [skip] {rel['tag_name']}: yt-dlp could not resolve a host")
            continue
        print(f"  [{'set ' if args.apply else 'would set'}] {rel['tag_name']}: @{handle}")
        if args.apply:
            new_body = body.rstrip() + f"\nMETADATA::HOST::{handle}\n"
            sh(["gh", "api", "-X", "PATCH", f"repos/{repo}/releases/{rel['id']}", "-f", f"body={new_body}"])
            changed += 1
    print(f"\nExamined {todo} releases without a host. Updated: {changed}. Unresolved: {failed}.")
    if not args.apply:
        print("Dry run only. Re-run with --apply to write the changes.")


if __name__ == "__main__":
    sys.exit(main())
