import os
import sys
import json
import shutil
import tempfile
import unittest

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SCRIPTS_DIR = os.path.join(BASE_DIR, "scripts")
SPACES_DIR = os.path.join(BASE_DIR, "spaces", "zerogpu-transcriber")

for p in [SCRIPTS_DIR, SPACES_DIR]:
    if p not in sys.path:
        sys.path.insert(0, p)

import rediarize_transcripts as rediarizer
import spacepipe_transcribe_core as core


class TestRediarizeBatch(unittest.TestCase):

    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.checkpoint_path = os.path.join(self.test_dir, "rediarize_checkpoint.json")

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_checkpoint_resume_and_tracking(self):
        # Empty checkpoint initially
        self.assertFalse(rediarizer.is_tag_completed("tag_001", self.checkpoint_path))

        # Record completion
        rediarizer.mark_tag_completed("tag_001", self.checkpoint_path)
        self.assertTrue(rediarizer.is_tag_completed("tag_001", self.checkpoint_path))
        self.assertFalse(rediarizer.is_tag_completed("tag_002", self.checkpoint_path))

        # Verify persisted JSON
        with open(self.checkpoint_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        self.assertIn("tag_001", data.get("completed_tags", []))

    def test_text_hash_rejection_on_altered_words(self):
        original_segments = [
            {"start": 0.0, "end": 2.0, "speaker": "SPEAKER_00", "text": "Original text unmodified."}
        ]
        mutated_segments = [
            {"start": 0.0, "end": 2.0, "speaker": "Logan", "text": "Mutated text altered words!"}
        ]

        orig_hash = core.compute_transcript_text_hash(original_segments)
        mutated_hash = core.compute_transcript_text_hash(mutated_segments)

        self.assertNotEqual(orig_hash, mutated_hash)
        with self.assertRaises(ValueError):
            rediarizer.verify_text_integrity(orig_hash, mutated_hash, "test_tag")


if __name__ == "__main__":
    unittest.main()
