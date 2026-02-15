#!/usr/bin/env python3
"""Strict preflight availability check for Twitter/X Space URLs."""

from __future__ import annotations

import argparse
import json
import subprocess


def check(url: str, timeout: int = 45) -> tuple[bool, str]:
    cmd = ["yt-dlp", "--simulate", "--skip-download", "--no-warnings", url]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        return False, "preflight_timeout"

    if proc.returncode == 0:
        return True, ""

    out = f"{proc.stdout}\n{proc.stderr}".lower()
    if "private" in out:
        return False, "preflight_filtered_private"
    if "deleted" in out:
        return False, "preflight_filtered_deleted"
    if "unavailable" in out or "not available" in out:
        return False, "preflight_filtered_unavailable"
    return False, "preflight_filtered_unavailable"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--timeout", type=int, default=45)
    args = parser.parse_args()

    ok, reason = check(args.url, timeout=args.timeout)
    print(json.dumps({"url": args.url, "ok": ok, "reason": reason}))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
