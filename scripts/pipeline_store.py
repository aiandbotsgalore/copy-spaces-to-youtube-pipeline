#!/usr/bin/env python3
"""GitHub-backed storage helpers for batch/item pipeline state."""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


TERMINAL_STATES = {"youtube_uploaded", "failed_permanent", "preflight_filtered"}
ACTIVE_STATES = {"claimed", "downloading", "youtube_uploading"}
CLAIMABLE_STATES = {"queued", "failed_retryable"}


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def extract_space_id(url: str) -> str:
    parts = url.strip().split("/")
    return parts[-1] if parts else ""


def sanitize_title(title: str) -> str:
    safe = "".join(ch for ch in title if ch >= " " and ch != "\x7f")
    safe = safe.replace("<", "").replace(">", "").strip()
    return safe[:100] if len(safe) > 100 else safe


class GitHubStore:
    def __init__(self, repo: str, token: str):
        self.repo = repo
        self.token = token

    def _request(self, method: str, url: str, payload: dict[str, Any] | None = None) -> Any:
        data = None
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"token {self.token}")
        req.add_header("Accept", "application/vnd.github+json")
        req.add_header("X-GitHub-Api-Version", "2022-11-28")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else {}

    def ensure_branch(self, branch: str, base_branch: str) -> None:
        try:
            self._request("GET", f"https://api.github.com/repos/{self.repo}/git/ref/heads/{branch}")
            return
        except urllib.error.HTTPError as err:
            if err.code != 404:
                raise
        base_ref = self._request("GET", f"https://api.github.com/repos/{self.repo}/git/ref/heads/{base_branch}")
        self._request(
            "POST",
            f"https://api.github.com/repos/{self.repo}/git/refs",
            {"ref": f"refs/heads/{branch}", "sha": base_ref["object"]["sha"]},
        )

    def read_text(self, path: str, branch: str) -> tuple[str | None, str | None]:
        encoded_path = urllib.parse.quote(path, safe="/")
        try:
            payload = self._request(
                "GET",
                f"https://api.github.com/repos/{self.repo}/contents/{encoded_path}?ref={urllib.parse.quote(branch)}",
            )
        except urllib.error.HTTPError as err:
            if err.code == 404:
                return None, None
            raise
        content = base64.b64decode(payload["content"]).decode("utf-8", errors="replace")
        return content, payload["sha"]

    def write_text(self, path: str, text: str, branch: str, message: str, sha: str | None = None, retries: int = 6) -> None:
        encoded_path = urllib.parse.quote(path, safe="/")
        body = {
            "message": message,
            "content": base64.b64encode(text.encode("utf-8")).decode("ascii"),
            "branch": branch,
        }
        if sha:
            body["sha"] = sha
        for attempt in range(1, retries + 1):
            try:
                self._request("PUT", f"https://api.github.com/repos/{self.repo}/contents/{encoded_path}", body)
                return
            except urllib.error.HTTPError as err:
                if err.code not in (409, 422) or attempt == retries:
                    raise
                time.sleep(0.4 * attempt)
                latest_text, latest_sha = self.read_text(path, branch)
                body["sha"] = latest_sha
                if latest_text is None:
                    body.pop("sha", None)

    def list_paths(self, branch: str, prefix: str) -> list[str]:
        ref = self._request("GET", f"https://api.github.com/repos/{self.repo}/git/ref/heads/{branch}")
        commit = self._request("GET", f"https://api.github.com/repos/{self.repo}/git/commits/{ref['object']['sha']}")
        tree = self._request("GET", f"https://api.github.com/repos/{self.repo}/git/trees/{commit['tree']['sha']}?recursive=1")
        out: list[str] = []
        for node in tree.get("tree", []):
            p = node.get("path", "")
            if node.get("type") == "blob" and p.startswith(prefix):
                out.append(p)
        return sorted(out)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--repo", required=True)
    p.add_argument("--token", required=True)
    p.add_argument("--branch", required=True)
    p.add_argument("--base-branch", default="master")
    p.add_argument("--action", required=True, choices=["ensure-branch"])
    return p.parse_args()


def main() -> int:
    args = parse_args()
    store = GitHubStore(args.repo, args.token)
    if args.action == "ensure-branch":
        store.ensure_branch(args.branch, args.base_branch)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
