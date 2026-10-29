#!/usr/bin/env python3
import unittest

from avatar_pipeline import build_render_schedule, build_timeline, clip_relative_intervals, frame_bounds, validate_timeline


class PlannerTests(unittest.TestCase):
    def setUp(self):
        self.speakers = [
            {"id": "a", "name": "Alice", "avatar": {"path": "alice.jpg"}},
            {"id": "b", "name": "Bob", "avatar": {"path": "bob.jpg"}},
        ]

    def test_integer_contract_uses_floor_ceil(self):
        self.assertEqual(frame_bounds(0.041, 0.081, 25), (1, 3))

    def test_clip_relative_conversion_clips_turns_and_preserves_overlap(self):
        turns = [
            {"id": "u1", "speaker": "Alice", "start": 9.8, "end": 11.2},
            {"id": "u2", "speaker": "Bob", "start": 10.4, "end": 10.8},
        ]
        result = clip_relative_intervals(turns, 10.0, 11.0, 25, self.speakers)
        self.assertEqual([(x["speaker_id"], x["start_frame"], x["end_frame"]) for x in result], [("a", 0, 25), ("b", 10, 20)])

    def test_merge_is_deterministic_and_does_not_create_missing_speaker_turn(self):
        timeline = build_timeline(
            duration_seconds=4,
            fps=25,
            source_audio={"url": "https://example.invalid/audio.m4a"},
            speakers=self.speakers,
            intervals=[
                {"speaker_id": "a", "start_seconds": 0.0, "end_seconds": 0.4},
                {"speaker_id": "a", "start_seconds": 0.7, "end_seconds": 0.9},
            ],
        )
        schedule = build_render_schedule(timeline)
        self.assertEqual(len(schedule["a"]), 1)
        self.assertEqual(schedule["b"], [])
        validate_timeline(timeline)

    def test_invalid_frame_boundary_rejected(self):
        timeline = build_timeline(duration_seconds=1, fps=25, source_audio={"url": "x"}, speakers=self.speakers[:1], intervals=[{"speaker_id": "a", "start_seconds": 0.1, "end_seconds": 0.2}])
        timeline["intervals"][0]["end_frame"] += 1
        with self.assertRaises(ValueError):
            validate_timeline(timeline)


if __name__ == "__main__":
    unittest.main(verbosity=2)
