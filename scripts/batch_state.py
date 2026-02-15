#!/usr/bin/env python3
"""Per-item batch state management for RSS pipeline."""

from __future__ import annotations

import argparse
import json
from typing import Any

from state_store import GitHubStore, utc_now


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--repo", required=True)
    p.add_argument("--token", required=True)
    p.add_argument("--branch", required=True)
    p.add_argument("--action", required=True, choices=["ensure_batch", "upsert_item", "start_attempt", "mark_release", "mark_filtered", "mark_failure", "finalize_report", "get_item"])
    p.add_argument("--batch-id", required=True)
    p.add_argument("--space-id")
    p.add_argument("--url")
    p.add_argument("--status")
    p.add_argument("--reason", default="")
    p.add_argument("--release-tag", default="")
    p.add_argument("--max-attempts", type=int, default=3)
    return p.parse_args()


def batch_manifest_path(batch_id: str) -> str:
    return f"batches/{batch_id}/manifest.json"


def item_path(batch_id: str, space_id: str) -> str:
    return f"batches/{batch_id}/items/{space_id}.json"


def load_json(store: GitHubStore, path: str, branch: str) -> tuple[dict[str, Any] | None, str | None]:
    text, sha = store.read_text(path, branch)
    if not text:
        return None, sha
    return json.loads(text), sha


def save_json(store: GitHubStore, path: str, branch: str, data: dict[str, Any], sha: str | None, msg: str) -> None:
    store.write_text(path, json.dumps(data, indent=2) + "\n", branch, msg, sha=sha)


def ensure_batch(store: GitHubStore, args: argparse.Namespace) -> None:
    path = batch_manifest_path(args.batch_id)
    manifest, sha = load_json(store, path, args.branch)
    if manifest is None:
        manifest = {
            "batch_id": args.batch_id,
            "created_at": utc_now(),
            "updated_at": utc_now(),
            "total_items": 0,
            "states": {},
        }
        save_json(store, path, args.branch, manifest, sha, f"chore(batch): create {args.batch_id}")


def update_manifest_counts(store: GitHubStore, args: argparse.Namespace) -> None:
    path = batch_manifest_path(args.batch_id)
    manifest, sha = load_json(store, path, args.branch)
    if manifest is None:
        return
    prefix = f"batches/{args.batch_id}/items/"
    paths = store.list_paths(args.branch, prefix)
    counts: dict[str, int] = {}
    for p in paths:
        item, _ = load_json(store, p, args.branch)
        if not item:
            continue
        st = item.get("status", "unknown")
        counts[st] = counts.get(st, 0) + 1
    manifest["total_items"] = len(paths)
    manifest["states"] = counts
    manifest["updated_at"] = utc_now()
    save_json(store, path, args.branch, manifest, sha, f"chore(batch): update counts {args.batch_id}")


def ensure_item(store: GitHubStore, args: argparse.Namespace) -> tuple[dict[str, Any], str | None]:
    if not args.space_id:
        raise SystemExit("space-id required")
    path = item_path(args.batch_id, args.space_id)
    item, sha = load_json(store, path, args.branch)
    if item is None:
        item = {
            "batch_id": args.batch_id,
            "space_id": args.space_id,
            "url": args.url or "",
            "status": args.status or "queued",
            "attempt_count": 0,
            "max_attempts": args.max_attempts,
            "release_tag": "",
            "last_error": "",
            "created_at": utc_now(),
            "updated_at": utc_now(),
        }
    return item, sha


def main() -> int:
    args = parse_args()
    store = GitHubStore(args.repo, args.token)

    if args.action == "ensure_batch":
        ensure_batch(store, args)
        update_manifest_counts(store, args)
        return 0

    if args.action == "finalize_report":
        prefix = f"batches/{args.batch_id}/items/"
        paths = store.list_paths(args.branch, prefix)
        items: list[dict[str, Any]] = []
        counts: dict[str, int] = {}
        for p in paths:
            it, _ = load_json(store, p, args.branch)
            if not it:
                continue
            items.append(it)
            st = it.get("status", "unknown")
            counts[st] = counts.get(st, 0) + 1
        report = {
            "batch_id": args.batch_id,
            "generated_at": utc_now(),
            "total_items": len(items),
            "states": counts,
            "items": items,
        }
        rp = f"batches/{args.batch_id}/report.json"
        rm = f"batches/{args.batch_id}/report.md"
        _, rsha = store.read_text(rp, args.branch)
        _, msha = store.read_text(rm, args.branch)
        store.write_text(rp, json.dumps(report, indent=2) + "\n", args.branch, f"chore(batch): report {args.batch_id}", sha=rsha)
        md = [f"# Batch Report: {args.batch_id}", "", f"- Generated: {report['generated_at']}", f"- Total Items: {len(items)}", "", "## Status Counts"]
        for k, v in sorted(counts.items()):
            md.append(f"- {k}: {v}")
        store.write_text(rm, "\n".join(md) + "\n", args.branch, f"chore(batch): report {args.batch_id}", sha=msha)
        print(json.dumps({"batch_id": args.batch_id, "states": counts}))
        return 0

    item, sha = ensure_item(store, args)
    path = item_path(args.batch_id, args.space_id or "")

    if args.action == "get_item":
        print(json.dumps(item))
        return 0

    if args.action == "upsert_item":
        if args.url:
            item["url"] = args.url
        if args.status:
            item["status"] = args.status
    elif args.action == "start_attempt":
        item["attempt_count"] = int(item.get("attempt_count", 0)) + 1
        item["status"] = "downloading"
        item["last_error"] = ""
    elif args.action == "mark_release":
        item["status"] = "release_created"
        if args.release_tag:
            item["release_tag"] = args.release_tag
        item["last_error"] = ""
    elif args.action == "mark_filtered":
        item["status"] = "preflight_filtered"
        item["last_error"] = args.reason
    elif args.action == "mark_failure":
        item["last_error"] = args.reason
        attempts = int(item.get("attempt_count", 0))
        max_attempts = int(item.get("max_attempts", args.max_attempts))
        if attempts >= max_attempts:
            item["status"] = "failed_permanent"
            should_retry = False
        else:
            item["status"] = "failed_retryable"
            should_retry = True
        item["updated_at"] = utc_now()
        save_json(store, path, args.branch, item, sha, f"chore(batch): fail {item['space_id']}")
        update_manifest_counts(store, args)
        print(json.dumps({"should_retry": should_retry, "attempt_count": attempts, "max_attempts": max_attempts, "status": item["status"]}))
        return 0

    item["updated_at"] = utc_now()
    save_json(store, path, args.branch, item, sha, f"chore(batch): update {item['space_id']}")
    update_manifest_counts(store, args)
    print(json.dumps({"space_id": item.get("space_id"), "status": item.get("status"), "attempt_count": item.get("attempt_count", 0)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
