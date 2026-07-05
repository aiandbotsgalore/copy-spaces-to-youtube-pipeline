#!/usr/bin/env python3
"""Shared release metadata helpers for SpacePipe tests and workflows."""

from __future__ import annotations

import re

MAX_YOUTUBE_SECONDS = 12 * 60 * 60


def duration_to_seconds(value: str) -> int:
    match = re.match(r"^(\d{2,}):(\d{2}):(\d{2})$", value or "")
    if not match:
        return 0
    hours, minutes, seconds = map(int, match.groups())
    return hours * 3600 + minutes * 60 + seconds


def youtube_rss_eligible(duration: str) -> bool:
    seconds = duration_to_seconds(duration)
    return 0 < seconds <= MAX_YOUTUBE_SECONDS


def release_field(body: str, label: str, default: str = "") -> str:
    match = re.search(rf"\*\*{re.escape(label)}:\*\*\s*(.+?)(?:\n|$)", body or "")
    return match.group(1).strip() if match else default


def release_metadata(body: str, key: str, default: str = "") -> str:
    match = re.search(rf"METADATA::{re.escape(key)}::([^\n]+)", body or "")
    return match.group(1).strip() if match else default


def has_asset_with_extension(assets: list[dict], extension: str) -> bool:
    suffix = extension.lower()
    return any(asset.get("name", "").lower().endswith(suffix) for asset in assets)
