#!/usr/bin/env python3
"""Shared GitHub Contents API helpers for workflow state files."""

from __future__ import annotations

import base64
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


def utc_now() -> str:
    import datetime as dt

    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class GitHubStore:
    def __init__(self, repo: str, token: str):
        self.repo = repo
        self.token = token

    def _req(self, method: str, url: str, payload: dict[str, Any] | None = None) -> Any:
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

    def read_text(self, path: str, branch: str) -> tuple[str | None, str | None]:
        p = urllib.parse.quote(path, safe="/")
        try:
            data = self._req("GET", f"https://api.github.com/repos/{self.repo}/contents/{p}?ref={urllib.parse.quote(branch)}")
        except urllib.error.HTTPError as err:
            if err.code == 404:
                return None, None
            raise
        text = base64.b64decode(data["content"]).decode("utf-8", errors="replace")
        return text, data["sha"]

    def write_text(self, path: str, text: str, branch: str, message: str, sha: str | None = None, retries: int = 8) -> None:
        p = urllib.parse.quote(path, safe="/")
        body: dict[str, Any] = {
            "message": message,
            "content": base64.b64encode(text.encode("utf-8")).decode("ascii"),
            "branch": branch,
        }
        if sha:
            body["sha"] = sha
        for attempt in range(1, retries + 1):
            try:
                self._req("PUT", f"https://api.github.com/repos/{self.repo}/contents/{p}", body)
                return
            except urllib.error.HTTPError as err:
                if err.code not in (409, 422) or attempt == retries:
                    raise
                _, latest_sha = self.read_text(path, branch)
                if latest_sha:
                    body["sha"] = latest_sha
                else:
                    body.pop("sha", None)
                time.sleep(0.35 * attempt)

    def list_paths(self, branch: str, prefix: str) -> list[str]:
        ref = self._req("GET", f"https://api.github.com/repos/{self.repo}/git/ref/heads/{branch}")
        commit = self._req("GET", f"https://api.github.com/repos/{self.repo}/git/commits/{ref['object']['sha']}")
        tree = self._req("GET", f"https://api.github.com/repos/{self.repo}/git/trees/{commit['tree']['sha']}?recursive=1")
        out: list[str] = []
        for node in tree.get("tree", []):
            path = node.get("path", "")
            if node.get("type") == "blob" and path.startswith(prefix):
                out.append(path)
        return sorted(out)
