#!/usr/bin/env python3
"""Upload release asset to YouTube and mark item status."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
import urllib.request
from pathlib import Path

from pipeline_store import GitHubStore, sanitize_title, utc_now


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--repo", required=True)
    p.add_argument("--token", required=True)
    p.add_argument("--state-branch", required=True)
    p.add_argument("--batch-id", required=True)
    p.add_argument("--space-id", required=True)
    p.add_argument("--visibility", default="private")
    p.add_argument("--category", default="Podcasts & Blogs")
    return p.parse_args()


def find_release_asset(repo: str, token: str, space_id: str) -> tuple[str, str]:
    page = 1
    while True:
        req = urllib.request.Request(f"https://api.github.com/repos/{repo}/releases?per_page=100&page={page}")
        req.add_header("Authorization", f"token {token}")
        req.add_header("Accept", "application/vnd.github+json")
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if not data:
            return "", ""
        for rel in data:
            tag = rel.get("tag_name", "")
            if not tag.endswith(f"_{space_id}"):
                continue
            for asset in rel.get("assets", []):
                if str(asset.get("name", "")).endswith(".mp3"):
                    return tag, asset.get("browser_download_url", "")
            return tag, ""
        page += 1


def sanitize_description(text: str) -> str:
    safe = "".join(ch for ch in text if ch >= " " and ch != "\x7f")
    safe = safe.replace("<", "").replace(">", "")
    return safe[:5000]


def mark(store: GitHubStore, path: str, sha: str, branch: str, item: dict, status: str, msg: str) -> str:
    item["status"] = status
    item["updated_at"] = utc_now()
    store.write_text(path, json.dumps(item, indent=2) + "\n", branch, msg, sha=sha)
    _, new_sha = store.read_text(path, branch)
    return new_sha or sha


def upload_mock(item: dict) -> tuple[str, str]:
    sid = item["space_id"]
    vid = f"mock_{sid}"
    return vid, f"https://youtube.com/watch?v={vid}"


def upload_real(mp3_path: str, item: dict, visibility: str, category: str) -> tuple[str, str]:
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaFileUpload

    client_id = os.environ["YOUTUBE_CLIENT_ID"]
    client_secret = os.environ["YOUTUBE_CLIENT_SECRET"]
    refresh_token = os.environ["YOUTUBE_REFRESH_TOKEN"]
    token_uri = "https://oauth2.googleapis.com/token"
    scopes = ["https://www.googleapis.com/auth/youtube.upload"]
    creds = Credentials(
        None,
        refresh_token=refresh_token,
        token_uri=token_uri,
        client_id=client_id,
        client_secret=client_secret,
        scopes=scopes,
    )
    creds.refresh(Request())
    yt = build("youtube", "v3", credentials=creds, cache_discovery=False)
    body = {
        "snippet": {
            "title": sanitize_title(item.get("title") or f"Space {item['space_id']}"),
            "description": sanitize_description(
                item.get("description")
                or f"Twitter/X Space archive\n\nSpace ID: {item['space_id']}\nSource: {item.get('url','')}"
            ),
            "categoryId": "22" if category == "Podcasts & Blogs" else "22",
            "tags": ["Twitter Space", "Podcast", item["space_id"]],
        },
        "status": {"privacyStatus": visibility},
    }
    media = MediaFileUpload(mp3_path, chunksize=-1, resumable=True, mimetype="audio/mpeg")
    req = yt.videos().insert(part="snippet,status", body=body, media_body=media)
    resp = None
    while resp is None:
        _, resp = req.next_chunk()
    vid = resp["id"]
    return vid, f"https://youtube.com/watch?v={vid}"


def main() -> int:
    args = parse_args()
    store = GitHubStore(args.repo, args.token)
    path = f"batches/{args.batch_id}/items/{args.space_id}.json"
    text, sha = store.read_text(path, args.state_branch)
    if not text or not sha:
        raise SystemExit(f"Missing state {path}")
    item = json.loads(text)

    if item.get("status") == "youtube_uploaded":
        return 0
    if item.get("status") in {"failed_permanent", "preflight_filtered"}:
        return 0
    if item.get("status") not in {"release_created", "failed_retryable", "youtube_uploading"}:
        return 0

    sha = mark(store, path, sha, args.state_branch, item, "youtube_uploading", f"chore(batch): youtube uploading {args.space_id}")
    tag, asset_url = find_release_asset(args.repo, args.token, args.space_id)
    if not asset_url:
        item["last_error"] = "missing_release_asset"
        if int(item.get("attempt_count", 0)) >= int(item.get("max_attempts", 3)):
            mark(store, path, sha, args.state_branch, item, "failed_permanent", f"chore(batch): youtube permanent {args.space_id}")
        else:
            mark(store, path, sha, args.state_branch, item, "failed_retryable", f"chore(batch): youtube retry {args.space_id}")
        return 0

    item["release_tag"] = item.get("release_tag") or tag
    item["release_asset_url"] = asset_url

    with tempfile.TemporaryDirectory() as tmp:
        target = Path(tmp) / f"{args.space_id}.mp3"
        req = urllib.request.Request(asset_url)
        with urllib.request.urlopen(req) as resp:
            target.write_bytes(resp.read())
        try:
            if os.environ.get("YOUTUBE_MOCK_UPLOAD", "").lower() in {"1", "true", "yes"}:
                video_id, video_url = upload_mock(item)
            else:
                video_id, video_url = upload_real(str(target), item, args.visibility, args.category)
            item["youtube_video_id"] = video_id
            item["youtube_url"] = video_url
            item["visibility"] = args.visibility
            item["category"] = args.category
            item["last_error"] = ""
            mark(store, path, sha, args.state_branch, item, "youtube_uploaded", f"chore(batch): youtube uploaded {args.space_id}")
        except Exception as err:
            item["last_error"] = str(err)[:500]
            if int(item.get("attempt_count", 0)) >= int(item.get("max_attempts", 3)):
                mark(store, path, sha, args.state_branch, item, "failed_permanent", f"chore(batch): youtube permanent {args.space_id}")
            else:
                mark(store, path, sha, args.state_branch, item, "failed_retryable", f"chore(batch): youtube retry {args.space_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
