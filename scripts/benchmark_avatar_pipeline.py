#!/usr/bin/env python3
"""Synthetic benchmark for planner/assembly cost accounting."""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

from avatar_pipeline import MockModelAdapter, build_render_schedule, build_timeline, render_job
from test_render_pipeline import make_fixture


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="spacepipe-avatar-benchmark-") as temp:
        root = Path(temp)
        duration = 60.0
        names = ["A", "B", "C", "D", "E"]
        audio, avatars = make_fixture(root, duration, names)
        speakers = [{"id": f"speaker-{i + 1}", "name": name, "avatar": {"path": str(avatars[name])}} for i, name in enumerate(names)]
        by_name = {speaker["name"]: speaker["id"] for speaker in speakers}
        turns = [("A", 0, 8), ("B", 10, 18), ("A", 20, 27), ("C", 30, 36), ("D", 42, 46), ("B", 50, 58)]
        intervals = [{"id": f"turn-{i + 1}", "speaker_id": by_name[name], "speaker": name, "start_seconds": start, "end_seconds": end, "verified": True} for i, (name, start, end) in enumerate(turns)]
        timeline = build_timeline(duration_seconds=duration, fps=25, source_audio={"path": str(audio)}, speakers=speakers, intervals=intervals, output={"width": 640, "height": 640}, model={"id": "mock-avatar", "version": "benchmark"})
        schedule = build_render_schedule(timeline)
        report = render_job(timeline, MockModelAdapter(), root / "work")
        report.update({
            "benchmark": "synthetic-mock-v1",
            "participant_count": len(names),
            "clip_duration_seconds": duration,
            "baseline_ai_seconds": len(names) * duration,
            "planned_visible_speech_seconds": sum(end - start for _, start, end in turns),
            "planned_inference_seconds_with_padding": sum((item["render_end_frame"] - item["render_start_frame"]) / timeline["fps"] for plans in schedule.values() for item in plans),
            "inference_segment_count": sum(len(plans) for plans in schedule.values()),
            "model_initialization_seconds": 0.0,
            "ffmpeg_assembly_seconds": report["elapsed_seconds"],
            "cloud_verified": False,
        })
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
