#!/usr/bin/env python3
"""Download/create release for one claimed batch item and dispatch YouTube stage."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import urllib.request
from pathlib import Path
from typing import Any

from pipeline_store import GitHubStore, sanitize_title, utc_now


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--repo", required=True)
    p.add_argument("--token", required=True)
    p.add_argument("--state-branch", required=True)
    p.add_argument("--batch-id", required=True)
    p.add_argument("--space-id", required=True)
    return p.parse_args()


def list_releases(repo: str, token: str) -> list[dict[str, Any]]:
    page = 1
    out: list[dict[str, Any]] = []
    while True:
        req = urllib.request.Request(f"https://api.github.com/repos/{repo}/releases?per_page=100&page={page}")
        req.add_header("Authorization", f"token {token}")
        req.add_header("Accept", "application/vnd.github+json")
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if not data:
            break
        out.extend(data)
        page += 1
    return out


def mark(store: GitHubStore, path: str, sha: str, branch: str, item: dict[str, Any], status: str, msg: str) -> str:
    item["status"] = status
    item["updated_at"] = utc_now()
    text = json.dumps(item, indent=2) + "\n"
    store.write_text(path, text, branch, msg, sha=sha)
    _, new_sha = store.read_text(path, branch)
    return new_sha or sha


def main() -> int:
    args = parse_args()
    store = GitHubStore(args.repo, args.token)
    path = f"batches/{args.batch_id}/items/{args.space_id}.json"
    text, sha = store.read_text(path, args.state_branch)
    if not text or not sha:
        raise SystemExit(f"Missing item state: {path}")
    item = json.loads(text)

    if item.get("status") in {"youtube_uploaded", "failed_permanent", "preflight_filtered"}:
        print("terminal_state")
        return 0

    if item.get("status") not in {"claimed", "failed_retryable", "queued"}:
        print(f"skip_status={item.get('status')}")
        return 0

    sha = mark(store, path, sha, args.state_branch, item, "downloading", f"chore(batch): downloading {args.space_id}")

    releases = list_releases(args.repo, args.token)
    existing = None
    for rel in releases:
        tag = rel.get("tag_name", "")
        if tag.endswith(f"_{args.space_id}"):
            existing = rel
            break

    if existing:
        item["release_tag"] = existing.get("tag_name", "")
        asset_url = ""
        for asset in existing.get("assets", []):
            if str(asset.get("name", "")).endswith(".mp3"):
                asset_url = asset.get("browser_download_url", "")
                break
        item["release_asset_url"] = asset_url
        sha = mark(store, path, sha, args.state_branch, item, "release_created", f"chore(batch): existing release {args.space_id}")
    else:
        work = Path("work") / args.batch_id
        work.mkdir(parents=True, exist_ok=True)
        date = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d")
        out_tpl = str(work / f"{date}_{args.space_id}_%(title)s.%(ext)s")
        url = item["url"]

        dl = subprocess.run(
            [
                "yt-dlp",
                "--retries",
                "3",
                "--fragment-retries",
                "3",
                "--no-playlist",
                "--restrict-filenames",
                "--extract-audio",
                "--audio-format",
                "mp3",
                "--audio-quality",
                "0",
                "--embed-metadata",
                "--write-info-json",
                "--output",
                out_tpl,
                url,
            ],
            text=True,
            capture_output=True,
            check=False,
        )
        if dl.returncode != 0:
            err = (dl.stderr or dl.stdout or "download_failed").strip()[:500]
            item["last_error"] = err
            if "private" in err.lower() or "unavailable" in err.lower() or "deleted" in err.lower():
                mark(store, path, sha, args.state_branch, item, "failed_permanent", f"chore(batch): permanent fail {args.space_id}")
            else:
                if int(item.get("attempt_count", 0)) >= int(item.get("max_attempts", 3)):
                    mark(store, path, sha, args.state_branch, item, "failed_permanent", f"chore(batch): max attempts {args.space_id}")
                else:
                    mark(store, path, sha, args.state_branch, item, "failed_retryable", f"chore(batch): retry fail {args.space_id}")
            return 0

        mp3s = sorted(work.glob("*.mp3"))
        infos = sorted(work.glob("*.info.json"))
        if not mp3s:
            item["last_error"] = "No MP3 produced"
            mark(store, path, sha, args.state_branch, item, "failed_retryable", f"chore(batch): no mp3 {args.space_id}")
            return 0
        mp3 = mp3s[0]
        title = f"Space {args.space_id}"
        host = "Unknown"
        desc = ""
        if infos:
            data = json.loads(infos[0].read_text(encoding="utf-8", errors="replace"))
            title = sanitize_title(str(data.get("title") or title))
            host = str(data.get("uploader") or host)
            desc = str(data.get("description") or "")[:1000]
        item["title"] = title
        item["host"] = host
        item["description"] = desc

        tag = f"{date}_{args.space_id}"
        notes = Path(work / f"{args.space_id}_release_notes.md")
        notes.write_text(
            "\n".join(
                [
                    f"**Title:** {title}",
                    f"**Host:** {host}",
                    f"**Source:** {item['url']}",
                    f"**Space ID:** {args.space_id}",
                    "",
                    desc[:500],
                ]
            ),
            encoding="utf-8",
        )

        proc = subprocess.run(
            ["gh", "release", "create", tag, str(mp3), "--title", title, "--notes-file", str(notes)],
            text=True,
            capture_output=True,
            check=False,
            env={**os.environ, "GH_TOKEN": args.token},
        )
        if proc.returncode != 0 and "already exists" not in (proc.stderr or "").lower():
            item["last_error"] = (proc.stderr or proc.stdout or "release_create_failed")[:500]
            if int(item.get("attempt_count", 0)) >= int(item.get("max_attempts", 3)):
                mark(store, path, sha, args.state_branch, item, "failed_permanent", f"chore(batch): release fail {args.space_id}")
            else:
                mark(store, path, sha, args.state_branch, item, "failed_retryable", f"chore(batch): release retry {args.space_id}")
            return 0

        rel_view = subprocess.run(
            ["gh", "release", "view", tag, "--json", "assets,tagName"],
            text=True,
            capture_output=True,
            check=False,
            env={**os.environ, "GH_TOKEN": args.token},
        )
        asset_url = ""
        if rel_view.returncode == 0:
            rel_json = json.loads(rel_view.stdout)
            for asset in rel_json.get("assets", []):
                if str(asset.get("name", "")).endswith(".mp3"):
                    asset_url = asset.get("url", "") or asset.get("downloadUrl", "")
                    break

        item["release_tag"] = tag
        item["release_asset_url"] = asset_url
        sha = mark(store, path, sha, args.state_branch, item, "release_created", f"chore(batch): release created {args.space_id}")

    subprocess.run(
        [
            "gh",
            "workflow",
            "run",
            "youtube_upload.yml",
            "-f",
            f"batch_id={args.batch_id}",
            "-f",
            f"space_id={args.space_id}",
            "-f",
            f"state_branch={args.state_branch}",
        ],
        check=False,
        capture_output=True,
        text=True,
        env={**os.environ, "GH_TOKEN": args.token},
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
