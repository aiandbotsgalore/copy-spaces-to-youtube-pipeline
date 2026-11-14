import os
import sys
import json
import shutil
import tempfile
import unittest

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SCRIPTS_DIR = os.path.join(BASE_DIR, "scripts")
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

import cloud_transcribe_client as client


class TestCloudTranscribeClient(unittest.TestCase):

    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.index_path = os.path.join(self.test_dir, "transcripts_summary_index.json")

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_atomic_merge_preserves_existing_episodes(self):
        # Create an existing index with 2 episodes
        existing_data = [
            {
                "release_id": 1001,
                "release_tag": "tag_001",
                "title": "First Episode",
                "published_at": "2026-11-01T00:00:00Z",
                "audio_url": "https://github.com/audio1.mp3",
                "segment_count": 10,
                "speakers": ["Logan"]
            },
            {
                "release_id": 1002,
                "release_tag": "tag_002",
                "title": "Second Episode",
                "published_at": "2026-11-02T00:00:00Z",
                "audio_url": "https://github.com/audio2.mp3",
                "segment_count": 20,
                "speakers": ["Angela"]
            }
        ]
        with open(self.index_path, "w", encoding="utf-8") as f:
            json.dump(existing_data, f)

        # Update tag_001 with new data
        updated_entry = {
            "release_id": 1001,
            "release_tag": "tag_001",
            "title": "First Episode Updated",
            "published_at": "2026-11-01T00:00:00Z",
            "audio_url": "https://github.com/audio1.mp3",
            "segment_count": 12,
            "speakers": ["Logan", "Guest"]
        }

        client.atomic_update_summary_index(self.index_path, updated_entry)

        with open(self.index_path, "r", encoding="utf-8") as f:
            loaded = json.load(f)

        self.assertEqual(len(loaded), 2)
        # Find tag_001
        t1 = next(x for x in loaded if x["release_tag"] == "tag_001")
        self.assertEqual(t1["title"], "First Episode Updated")
        self.assertEqual(t1["speakers"], ["Logan", "Guest"])

        # Find tag_002 (unaffected)
        t2 = next(x for x in loaded if x["release_tag"] == "tag_002")
        self.assertEqual(t2["title"], "Second Episode")

    def test_episode_summary_schema_conformance(self):
        segments = [
            {"start": 0.0, "end": 2.5, "speaker": "Logan", "text": "Hello world."},
            {"start": 2.5, "end": 5.0, "speaker": "Angela", "text": "Hi Logan."}
        ]
        entry = client.build_summary_entry(
            release_tag="test_tag",
            title="Test Space",
            audio_url="https://github.com/audio.mp3",
            segments=segments,
            release_id=999
        )

        required_keys = [
            "release_id", "release_tag", "title", "published_at",
            "audio_url", "segment_count", "speakers"
        ]
        for k in required_keys:
            self.assertIn(k, entry, f"Missing required key '{k}' in EpisodeSummary")

        self.assertEqual(entry["segment_count"], 2)
        self.assertCountEqual(entry["speakers"], ["Logan", "Angela"])

    def test_srt_and_txt_generation(self):
        segments = [
            {"start": 1.0, "end": 3.5, "speaker": "Logan", "text": " Testing SRT generation."},
            {"start": 4.0, "end": 6.25, "speaker": "Angela", "text": " Format verification."}
        ]
        srt_content = client.generate_srt_content(segments)
        txt_content = client.generate_txt_content(segments)

        # Verify SRT sequence and time format 00:00:01,000 --> 00:00:03,500
        self.assertIn("1\n00:00:01,000 --> 00:00:03,500\nLogan: Testing SRT generation.", srt_content)
        self.assertIn("2\n00:00:04,000 --> 00:00:06,250\nAngela: Format verification.", srt_content)

        # Verify TXT speaker prefixing
        self.assertIn("[00:00:01] Logan: Testing SRT generation.", txt_content)
        self.assertIn("[00:00:04] Angela: Format verification.", txt_content)

    def test_quota_error_detection(self):
        msg_429 = "Client call returned HTTP 429 Too Many Requests / ZeroGPU quota exceeded"
        self.assertTrue(client.is_quota_error(msg_429))
        self.assertFalse(client.is_quota_error("Audio decoding failed"))


if __name__ == "__main__":
    unittest.main()
