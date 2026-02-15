#!/usr/bin/env python3
"""Create immutable batch manifest and per-item state files."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from pipeline_store import GitHubStore, extract_space_id, utc_now
from pre_flight import check as preflight_check


def preflight(url: str, timeout: int) -> tuple[bool, str]:
    return preflight_check(url, timeout)


def read_urls(path: Path) -> list[str]:
    urls: list[str] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        s = line.strip()
        if s:
            urls.append(s)
    return urls


def get_batch_id(explicit: str | None) -> str:
    if explicit:
        return explicit
    return utc_now().replace(":", "").replace("-", "").replace("T", "_").replace("Z", "")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--repo", required=True)
    p.add_argument("--token", required=True)
    p.add_argument("--state-branch", required=True)
    p.add_argument("--base-branch", default="master")
    p.add_argument("--input-file", required=True)
    p.add_argument("--batch-id")
    p.add_argument("--strict-preflight", action="store_true")
    p.add_argument("--preflight-timeout", type=int, default=45)
    return p.parse_args()


def main() -> int:
    args = parse_args()
    store = GitHubStore(args.repo, args.token)
    store.ensure_branch(args.state_branch, args.base_branch)

    input_path = Path(args.input_file)
    if not input_path.exists():
        raise SystemExit(f"Input file not found: {input_path}")

    batch_id = get_batch_id(args.batch_id)
    urls = read_urls(input_path)
    seen: set[str] = set()
    requested: list[dict] = []
    for idx, url in enumerate(urls):
        sid = extract_space_id(url)
        if not sid or sid in seen:
            continue
        seen.add(sid)
        requested.append({"space_id": sid, "url": url, "submit_order": idx + 1})

    manifest = {
        "batch_id": batch_id,
        "submitted_at": utc_now(),
        "source_file": str(input_path),
        "strict_preflight": bool(args.strict_preflight),
        "requested_count": len(requested),
        "requested_spaces": requested,
    }

    manifest_path = f"batches/{batch_id}/manifest.json"
    store.write_text(
        manifest_path,
        json.dumps(manifest, indent=2) + "\n",
        args.state_branch,
        f"chore(batch): create manifest {batch_id}",
        sha=store.read_text(manifest_path, args.state_branch)[1],
    )

    queued = 0
    filtered = 0
    for item in requested:
        sid = item["space_id"]
        url = item["url"]
        status = "queued"
        reason = ""
        if args.strict_preflight:
            ok, reason = preflight(url, args.preflight_timeout)
            if not ok:
                status = "preflight_filtered"
                filtered += 1
            else:
                queued += 1
        else:
            queued += 1

        state = {
            "batch_id": batch_id,
            "space_id": sid,
            "url": url,
            "status": status,
            "attempt_count": 0,
            "max_attempts": 3,
            "last_error": reason,
            "release_tag": "",
            "release_asset_url": "",
            "youtube_video_id": "",
            "youtube_url": "",
            "title": "",
            "host": "",
            "description": "",
            "category": "Podcasts & Blogs",
            "visibility": "private",
            "updated_at": utc_now(),
        }
        path = f"batches/{batch_id}/items/{sid}.json"
        _, sha = store.read_text(path, args.state_branch)
        store.write_text(path, json.dumps(state, indent=2) + "\n", args.state_branch, f"chore(batch): init item {sid}", sha=sha)

    summary = {
        "batch_id": batch_id,
        "requested": len(requested),
        "queued": queued,
        "preflight_filtered": filtered,
    }
    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
