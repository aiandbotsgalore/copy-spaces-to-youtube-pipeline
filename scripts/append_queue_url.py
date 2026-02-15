#!/usr/bin/env python3
"""Append one URL to queue file using GitHub Contents API (atomic retry)."""

from __future__ import annotations

import argparse
import base64
import json
import time
import urllib.error
import urllib.parse
import urllib.request


def req(method: str, url: str, token: str, payload: dict | None = None) -> dict:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Authorization", f"token {token}")
    r.add_header("Accept", "application/vnd.github+json")
    r.add_header("X-GitHub-Api-Version", "2022-11-28")
    if data is not None:
        r.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(r) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--repo", required=True)
    p.add_argument("--token", required=True)
    p.add_argument("--branch", required=True)
    p.add_argument("--queue-file", default="batch_queue.txt")
    p.add_argument("--url", required=True)
    args = p.parse_args()

    path = urllib.parse.quote(args.queue_file, safe="/")
    endpoint = f"https://api.github.com/repos/{args.repo}/contents/{path}"

    for attempt in range(1, 9):
        try:
            cur = req("GET", f"{endpoint}?ref={urllib.parse.quote(args.branch)}", args.token)
            sha = cur["sha"]
            raw = base64.b64decode(cur["content"]).decode("utf-8", errors="replace")
        except urllib.error.HTTPError as err:
            if err.code == 404:
                sha = None
                raw = ""
            else:
                raise

        raw = raw.rstrip("\n")
        new = raw + ("\n" if raw else "") + args.url.strip() + "\n"
        body = {
            "message": "chore(queue): requeue failed URL",
            "content": base64.b64encode(new.encode("utf-8")).decode("ascii"),
            "branch": args.branch,
        }
        if sha:
            body["sha"] = sha
        try:
            req("PUT", endpoint, args.token, body)
            print(args.url.strip())
            return 0
        except urllib.error.HTTPError as err:
            if err.code in (409, 422):
                time.sleep(0.35 * attempt)
                continue
            raise
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
