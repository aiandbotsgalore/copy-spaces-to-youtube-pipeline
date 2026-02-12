#!/usr/bin/env python3
"""Atomically claim one URL from a queue file in a GitHub repository."""

import argparse
import base64
import json
import re
import sys
import time
import urllib.error
import urllib.request


def api_request(method: str, url: str, token: str, payload: dict | None = None) -> dict:
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"token {token}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if data is not None:
        req.add_header("Content-Type", "application/json")

    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def extract_space_id(url: str) -> str:
    match = re.search(r"([A-Za-z0-9]+)$", url.strip())
    return match.group(1) if match else "unknown"


def claim_url(repo: str, queue_file: str, token: str, branch: str, max_retries: int) -> tuple[int, str]:
    api_base = f"https://api.github.com/repos/{repo}/contents/{queue_file}"

    for attempt in range(1, max_retries + 1):
        try:
            payload = api_request("GET", f"{api_base}?ref={branch}", token)
        except urllib.error.HTTPError as err:
            if err.code == 404:
                return 2, f"Queue file not found: {queue_file}"
            return 1, f"Failed to read queue file: HTTP {err.code}"

        sha = payload.get("sha")
        encoded = payload.get("content", "")
        if not sha:
            return 1, "Missing SHA from GitHub API response"

        try:
            queue_text = base64.b64decode(encoded, validate=False).decode("utf-8", errors="replace")
        except Exception as err:  # pragma: no cover - defensive
            return 1, f"Failed to decode queue content: {err}"

        lines = queue_text.splitlines()
        next_url = ""
        for line in lines:
            stripped = line.strip()
            if stripped:
                next_url = stripped
                break

        if not next_url:
            return 3, ""

        removed = False
        new_lines: list[str] = []
        for line in lines:
            stripped = line.strip()
            if not removed and stripped and stripped == next_url:
                removed = True
                continue
            new_lines.append(line.rstrip("\r"))

        if not removed:
            return 1, "Queue mutation failed: target URL not removed"

        new_text = "\n".join(new_lines)
        if new_text:
            new_text += "\n"

        content_b64 = base64.b64encode(new_text.encode("utf-8")).decode("ascii")
        commit_msg = f"chore(queue): dequeue {extract_space_id(next_url)}"
        update_body = {
            "message": commit_msg,
            "content": content_b64,
            "sha": sha,
            "branch": branch,
        }

        try:
            api_request("PUT", api_base, token, update_body)
            return 0, next_url
        except urllib.error.HTTPError as err:
            # SHA mismatch/race, retry.
            if err.code in (409, 422):
                time.sleep(0.5 * attempt)
                continue
            return 1, f"Failed to update queue file: HTTP {err.code}"

    return 1, "Exceeded retries while claiming URL"


def main() -> int:
    parser = argparse.ArgumentParser(description="Claim one URL from a queue file.")
    parser.add_argument("--repo", required=True, help="owner/repo")
    parser.add_argument("--queue-file", default="batch_queue.txt")
    parser.add_argument("--token", required=True)
    parser.add_argument("--branch", default="master")
    parser.add_argument("--max-retries", type=int, default=8)
    args = parser.parse_args()

    code, message = claim_url(
        repo=args.repo,
        queue_file=args.queue_file,
        token=args.token,
        branch=args.branch,
        max_retries=args.max_retries,
    )

    if code == 0:
        print(message)
        return 0
    if code == 3:
        return 3

    print(message, file=sys.stderr)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
