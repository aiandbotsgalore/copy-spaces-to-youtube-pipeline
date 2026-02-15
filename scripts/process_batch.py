#!/usr/bin/env python3
"""Dispatcher loop for batch workers."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import time
from typing import Any

from pipeline_store import ACTIVE_STATES, CLAIMABLE_STATES, GitHubStore, TERMINAL_STATES, utc_now


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--repo", required=True)
    p.add_argument("--token", required=True)
    p.add_argument("--state-branch", required=True)
    p.add_argument("--batch-id", required=True)
    p.add_argument("--max-concurrent", type=int, default=3)
    p.add_argument("--poll-seconds", type=int, default=20)
    p.add_argument("--max-idle-cycles", type=int, default=3)
    return p.parse_args()


def load_items(store: GitHubStore, branch: str, batch_id: str) -> list[tuple[str, dict[str, Any], str]]:
    prefix = f"batches/{batch_id}/items/"
    paths = store.list_paths(branch, prefix)
    out: list[tuple[str, dict[str, Any], str]] = []
    for path in paths:
        text, sha = store.read_text(path, branch)
        if not text or not sha:
            continue
        out.append((path, json.loads(text), sha))
    return out


def dispatch_worker(batch_id: str, state_branch: str, space_id: str, token: str) -> None:
    env = {"GH_TOKEN": token}
    subprocess.run(
        [
            "gh",
            "workflow",
            "run",
            "ingest_worker.yml",
            "-f",
            f"batch_id={batch_id}",
            "-f",
            f"space_id={space_id}",
            "-f",
            f"state_branch={state_branch}",
        ],
        check=True,
        env={**os.environ, **env},
        capture_output=True,
        text=True,
    )


def finalize(batch_id: str, state_branch: str, token: str) -> None:
    env = {"GH_TOKEN": token}
    subprocess.run(
        [
            "gh",
            "workflow",
            "run",
            "finalize_batch.yml",
            "-f",
            f"batch_id={batch_id}",
            "-f",
            f"state_branch={state_branch}",
        ],
        check=False,
        env={**os.environ, **env},
        capture_output=True,
        text=True,
    )


def main() -> int:
    args = parse_args()
    store = GitHubStore(args.repo, args.token)
    idle_cycles = 0

    while True:
        items = load_items(store, args.state_branch, args.batch_id)
        if not items:
            print("No items found; exiting.")
            return 1

        active = [it for _, it, _ in items if it.get("status") in ACTIVE_STATES]
        claimable = [(path, it, sha) for path, it, sha in items if it.get("status") in CLAIMABLE_STATES]
        done = [it for _, it, _ in items if it.get("status") in TERMINAL_STATES]

        slots = max(args.max_concurrent - len(active), 0)
        claimed_ids: list[str] = []

        for path, item, sha in claimable[:slots]:
            item["status"] = "claimed"
            item["attempt_count"] = int(item.get("attempt_count", 0)) + 1
            item["updated_at"] = utc_now()
            item["last_error"] = ""
            store.write_text(
                path,
                json.dumps(item, indent=2) + "\n",
                args.state_branch,
                f"chore(batch): claim {item['space_id']}",
                sha=sha,
            )
            claimed_ids.append(item["space_id"])

        for sid in claimed_ids:
            try:
                dispatch_worker(args.batch_id, args.state_branch, sid, args.token)
            except Exception as err:
                print(f"dispatch_failed space_id={sid} error={err}")

        print(
            json.dumps(
                {
                    "batch_id": args.batch_id,
                    "active": len(active),
                    "claimed_now": len(claimed_ids),
                    "remaining_claimable": max(len(claimable) - len(claimed_ids), 0),
                    "done": len(done),
                    "total": len(items),
                }
            )
        )

        if len(done) == len(items):
            finalize(args.batch_id, args.state_branch, args.token)
            return 0

        if not active and not claimable and not claimed_ids:
            idle_cycles += 1
        else:
            idle_cycles = 0

        if idle_cycles >= args.max_idle_cycles:
            finalize(args.batch_id, args.state_branch, args.token)
            return 0

        time.sleep(args.poll_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
