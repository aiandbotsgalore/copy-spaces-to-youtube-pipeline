#!/usr/bin/env python3
"""Local acceptance harness for the experimental speaker-aware renderer.

The mock adapter exercises the same planner, frame contract, idle/talking
assembly, and stage compositor used by the cloud worker without downloading a
neural checkpoint.  It deliberately fails if a silent speaker is assigned a
synthetic interval or if audio/frame contracts drift.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from avatar_pipeline import MockModelAdapter, build_timeline, build_render_schedule, render_job, validate_timeline


def run(cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True)


def make_fixture(root: Path, duration: float, speakers: list[str]) -> tuple[Path, dict[str, Path]]:
    audio = root / "source.m4a"
    run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"sine=frequency=440:duration={duration}", "-c:a", "aac", "-b:a", "128k", str(audio)])
    avatars = {}
    colors = ["0x2563eb", "0x16a34a", "0xdc2626", "0xd97706", "0x7c3aed", "0x0891b2"]
    for index, name in enumerate(speakers):
        path = root / f"avatar_{index}.jpg"
        run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"color=c={colors[index % len(colors)]}:s=512x512", "-frames:v", "1", str(path)])
        avatars[name] = path
    return audio, avatars


def motion_score(path: Path) -> float:
    result = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-vf", "fps=8,scale=96:96,format=gray", "-f", "rawvideo", "-"], check=True, capture_output=True)
    frame_size = 96 * 96
    frames = result.stdout
    if len(frames) < frame_size * 2:
        return 0.0
    values = [frames[index:index + frame_size] for index in range(0, len(frames) - frame_size + 1, frame_size)]
    differences = []
    for left, right in zip(values, values[1:]):
        differences.append(sum(abs(a - b) for a, b in zip(left, right)) / frame_size)
    return sum(differences) / len(differences)


class RenderPipelineTests(unittest.TestCase):
    def run_case(self, name: str, duration: float, names: list[str], turns: list[tuple[str, float, float]], layout: str = "stage_grid"):
        with tempfile.TemporaryDirectory(prefix=f"spacepipe-{name}-") as temp:
            root = Path(temp)
            audio, avatars = make_fixture(root, duration, names)
            speaker_data = [{"id": f"speaker-{i + 1}", "name": name, "avatar": {"path": str(avatars[name])}} for i, name in enumerate(names)]
            id_by_name = {entry["name"]: entry["id"] for entry in speaker_data}
            intervals = [{"id": f"turn-{i + 1}", "speaker_id": id_by_name[speaker], "speaker": speaker, "start_seconds": start, "end_seconds": end, "confidence": 0.99, "verified": True} for i, (speaker, start, end) in enumerate(turns)]
            timeline = build_timeline(duration_seconds=duration, fps=25, source_audio={"path": str(audio), "kind": "fixture"}, speakers=speaker_data, intervals=intervals, layout=layout, output={"width": 640, "height": 640}, model={"id": "mock-avatar", "version": "test"})
            validate_timeline(timeline)
            report = render_job(timeline, MockModelAdapter(), root / "work")
            self.assertEqual(report["frame_count"], timeline["duration_frames"])
            self.assertTrue(report["audio_preserved"], report)
            self.assertAlmostEqual(report["duration_seconds"], duration, delta=1 / 25)
            self.assertEqual(report["segment_count"], len(build_render_schedule(timeline)[id_by_name[names[0]]]) + sum(len(build_render_schedule(timeline)[id_by_name[n]]) for n in names[1:]))
            self.assertGreater(motion_score(Path(report["output"])), 0.1)
            return report, timeline

    def test_a_one_speaker(self):
        report, timeline = self.run_case("a", 2.4, ["A"], [("A", 0.25, 1.15), ("A", 1.35, 2.2)])
        self.assertLess(report["active_speaker_seconds"], report["full_length_baseline_seconds"])

    def test_b_two_speakers_alternating(self):
        report, timeline = self.run_case("b", 3.0, ["A", "B"], [("A", 0.0, 0.8), ("B", 0.9, 1.7), ("A", 1.8, 2.2), ("B", 2.3, 2.9)])
        self.assertEqual(timeline["duration_frames"], 75)

    def test_c_five_speakers_long_silence(self):
        report, timeline = self.run_case("c", 4.0, ["A", "B", "C", "D", "E"], [("A", 0.0, 0.4), ("C", 1.0, 1.4), ("E", 2.0, 2.4), ("B", 3.0, 3.4)])
        self.assertEqual(len([x for x in timeline["intervals"] if x["speaker_id"] == "speaker-4"]), 0)
        self.assertLess(report["active_speaker_seconds"], report["full_length_baseline_seconds"] / 2)

    def test_d_overlap_interruptions_short_turns_and_silent(self):
        report, timeline = self.run_case("d", 2.0, ["A", "B", "Silent"], [("A", 0.01, 0.25), ("B", 0.18, 0.37), ("A", 0.38, 0.62), ("B", 0.61, 0.70), ("A", 1.05, 1.08)])
        self.assertEqual(len(build_render_schedule(timeline)["speaker-3"]), 0)
        self.assertEqual(report["target_frames"], 50)


if __name__ == "__main__":
    unittest.main(verbosity=2)
