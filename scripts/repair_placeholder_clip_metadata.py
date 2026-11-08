#!/usr/bin/env python3
"""Replace release-title placeholders in local clip catalogs.

The original standalone-MP3 fallback copied the parent Space title into every
clip's reason and transcript snippet. This repair uses the clip's title and,
when the source transcript is available, the turns overlapping the clip window.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SUMMARY_PATH = ROOT / "public" / "transcripts" / "transcripts_summary_index.json"
EPISODES_DIR = ROOT / "public" / "transcripts" / "episodes"
CATALOG_PATHS = [ROOT / "public" / "clips" / "clips_catalog.json", ROOT / "best_saved_clips" / "clips_catalog.json"]


def norm(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def number(value: Any, default: float | None = None) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if result == result else default


def quote_for(clip: dict[str, Any], segments: list[dict[str, Any]]) -> str:
    start = number(clip.get("start_seconds"), 0) or 0
    end = number(clip.get("end_seconds"))
    if end is None or end <= start:
        end = start + (number(clip.get("duration"), 60) or 60)

    usable: list[dict[str, Any]] = []
    for segment in segments:
        seg_start = number(segment.get("start"))
        if seg_start is None:
            continue
        seg_end = max(seg_start, number(segment.get("end"), seg_start) or seg_start)
        text = re.sub(r"\s+", " ", str(segment.get("text") or "")).strip()
        if text:
            usable.append({"start": seg_start, "end": seg_end, "speaker": str(segment.get("speaker") or "").strip(), "text": text})

    selected = [s for s in usable if s["start"] < end and s["end"] >= start]
    if not selected:
        selected = [s for s in usable if start - 10 <= s["start"] <= end + 10][:8]
    if not selected and usable:
        nearest = min(usable, key=lambda s: abs(s["start"] - start))
        if abs(nearest["start"] - start) <= 30:
            selected = [nearest]

    lines: list[str] = []
    for segment in sorted(selected, key=lambda s: s["start"]):
        prefix = f"{segment['speaker']}: " if segment["speaker"] else ""
        remaining = 360 - len(" ".join(lines)) - (1 if lines else 0)
        if remaining <= len(prefix) + 12:
            break
        text = segment["text"]
        if len(text) > remaining - len(prefix):
            text = text[: max(0, remaining - len(prefix) - 1)].rstrip() + "…"
        lines.append(prefix + text)
        if len(" ".join(lines)) >= 350:
            break
    return " ".join(lines)


def time_label(seconds: float) -> str:
    total = max(0, round(seconds))
    return f"{total // 60}:{total % 60:02d}"


def load_segments() -> dict[str, list[dict[str, Any]]]:
    summaries = json.loads(SUMMARY_PATH.read_text(encoding="utf-8"))
    by_title = {norm(item.get("title")): item.get("release_tag") for item in summaries if item.get("title") and item.get("release_tag")}
    result: dict[str, list[dict[str, Any]]] = {}
    for summary_title, tag in by_title.items():
        path = EPISODES_DIR / f"{tag}.json"
        if not path.exists():
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            result[tag] = payload if isinstance(payload, list) else payload.get("segments", [])
        except (OSError, json.JSONDecodeError):
            result[tag] = []
    result["__by_title__"] = by_title  # type: ignore[assignment]
    return result


def repair_catalog(path: Path, segments_by_tag: dict[str, list[dict[str, Any]]]) -> int:
    data = json.loads(path.read_text(encoding="utf-8"))
    changed = 0
    by_title = segments_by_tag["__by_title__"]
    for clip in data:
        if not isinstance(clip, dict) or "AI selected highlight moment from" not in str(clip.get("reason", "")):
            continue
        title = str(clip.get("title") or "Untitled moment").strip() or "Untitled moment"
        start = number(clip.get("start_seconds"), 0) or 0
        duration = number(clip.get("duration"), 60) or 60
        tag = by_title.get(norm(clip.get("episode")))
        quote = quote_for(clip, segments_by_tag.get(tag or "", []))
        clip["reason"] = (
            f"{title} captures a {round(duration)}-second exchange: {quote}"
            if quote else
            f"{title} is a {round(duration)}-second highlight beginning at {time_label(start)}."
        )
        clip["transcript_snippet"] = quote or f"{title} ({time_label(start)}–{time_label(start + duration)})"
        changed += 1
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return changed


def main() -> None:
    segments_by_tag = load_segments()
    total = 0
    for path in CATALOG_PATHS:
        if path.exists():
            changed = repair_catalog(path, segments_by_tag)
            print(f"{path}: repaired {changed} placeholder clips")
            total += changed
    print(f"Repaired {total} catalog entries")


if __name__ == "__main__":
    main()
