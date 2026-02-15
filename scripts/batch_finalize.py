#!/usr/bin/env python3
"""Aggregate per-item states into final batch report."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from typing import Any

from pipeline_store import GitHubStore, utc_now


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--repo", required=True)
    p.add_argument("--token", required=True)
    p.add_argument("--state-branch", required=True)
    p.add_argument("--batch-id", required=True)
    return p.parse_args()


def main() -> int:
    args = parse_args()
    store = GitHubStore(args.repo, args.token)
    manifest_path = f"batches/{args.batch_id}/manifest.json"
    manifest_text, _ = store.read_text(manifest_path, args.state_branch)
    if not manifest_text:
        raise SystemExit("manifest missing")
    manifest = json.loads(manifest_text)

    prefix = f"batches/{args.batch_id}/items/"
    paths = store.list_paths(args.state_branch, prefix)
    items: list[dict[str, Any]] = []
    for path in paths:
        text, _ = store.read_text(path, args.state_branch)
        if text:
            items.append(json.loads(text))

    counts = Counter(item.get("status", "unknown") for item in items)
    requested = int(manifest.get("requested_count", len(items)))
    report = {
        "batch_id": args.batch_id,
        "generated_at": utc_now(),
        "requested_count": requested,
        "item_count": len(items),
        "status_counts": dict(counts),
        "uploaded_count": counts.get("youtube_uploaded", 0),
        "filtered_count": counts.get("preflight_filtered", 0),
        "failed_permanent_count": counts.get("failed_permanent", 0),
        "runner_minutes_estimate": 0,
        "items": items,
    }

    md_lines = [
        f"# Batch Report: {args.batch_id}",
        "",
        f"- Generated: {report['generated_at']}",
        f"- Requested: {requested}",
        f"- Items tracked: {len(items)}",
        f"- Uploaded to YouTube: {report['uploaded_count']}",
        f"- Preflight filtered: {report['filtered_count']}",
        f"- Failed permanent: {report['failed_permanent_count']}",
        f"- Total Runner Minutes: {report['runner_minutes_estimate']}",
        "",
        "## Status Counts",
    ]
    for key, value in sorted(dict(counts).items()):
        md_lines.append(f"- {key}: {value}")
    md_lines.extend(["", "## Failed Items"])
    failed = [it for it in items if it.get("status") == "failed_permanent"]
    if not failed:
        md_lines.append("- none")
    else:
        for it in failed:
            md_lines.append(f"- {it.get('space_id')}: {it.get('last_error','')}")
    report_md = "\n".join(md_lines) + "\n"

    json_path = f"batches/{args.batch_id}/report.json"
    md_path = f"batches/{args.batch_id}/report.md"
    _, sha_json = store.read_text(json_path, args.state_branch)
    _, sha_md = store.read_text(md_path, args.state_branch)
    store.write_text(json_path, json.dumps(report, indent=2) + "\n", args.state_branch, f"chore(batch): finalize {args.batch_id}", sha=sha_json)
    store.write_text(md_path, report_md, args.state_branch, f"chore(batch): finalize {args.batch_id}", sha=sha_md)

    print(json.dumps({"batch_id": args.batch_id, "status_counts": dict(counts)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
