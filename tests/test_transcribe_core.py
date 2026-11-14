import os
import sys
import math
import shutil
import hashlib
import unittest
import numpy as np

# Ensure scripts / spaces directory is on sys.path
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SPACES_DIR = os.path.join(BASE_DIR, "spaces", "zerogpu-transcriber")
SCRIPTS_DIR = os.path.join(BASE_DIR, "scripts")

for p in [SPACES_DIR, SCRIPTS_DIR]:
    if p not in sys.path:
        sys.path.insert(0, p)

import spacepipe_transcribe_core as core


class TestSpacePipeTranscribeCore(unittest.TestCase):

    def test_crosstalk_subtraction(self):
        """
        Verify that overlapping speaker turns have their overlapping intervals subtracted,
        and only non-overlapping single-speaker intervals >= min_duration_sec (default 1.5s)
        are retained for biometric embedding extraction.
        """
        # Speaker A: 0.0 to 10.0
        # Speaker B: 8.0 to 16.0  (Overlap from 8.0 to 10.0)
        # Speaker C: 15.0 to 16.2 (Overlap with B from 15.0 to 16.0; C is 16.0-16.2 = 0.2s < 1.5s)
        raw_turns = [
            {"speaker": "SPEAKER_00", "start": 0.0, "end": 10.0},
            {"speaker": "SPEAKER_01", "start": 8.0, "end": 16.0},
            {"speaker": "SPEAKER_02", "start": 15.0, "end": 16.2},
        ]
        clean_intervals = core.subtract_crosstalk_intervals(raw_turns, min_duration_sec=1.5)

        # Expected:
        # A clean: [0.0, 8.0] (duration 8.0s >= 1.5s)
        # B clean: [10.0, 15.0] (duration 5.0s >= 1.5s)
        # C has no interval >= 1.5s
        speakers = [x["speaker"] for x in clean_intervals]
        self.assertIn("SPEAKER_00", speakers)
        self.assertIn("SPEAKER_01", speakers)
        self.assertNotIn("SPEAKER_02", speakers)

        spk0 = next(x for x in clean_intervals if x["speaker"] == "SPEAKER_00")
        self.assertAlmostEqual(spk0["start"], 0.0)
        self.assertAlmostEqual(spk0["end"], 8.0)

        spk1 = next(x for x in clean_intervals if x["speaker"] == "SPEAKER_01")
        self.assertAlmostEqual(spk1["start"], 10.0)
        self.assertAlmostEqual(spk1["end"], 15.0)

    def test_complete_linkage_clustering(self):
        """
        Verify that complete-linkage clustering avoids transitive chaining drift.
        In complete linkage, the distance between two clusters is the MAX distance
        between any single pair of points.
        """
        # Create 3 points in 1D/2D:
        # P1 = [1.0, 0.0]
        # P2 = [0.85, 0.52] (distance to P1 is small ~0.3)
        # P3 = [0.55, 0.83] (distance to P2 is small ~0.35, but distance to P1 is large ~0.9)
        # Single linkage would chain P1 - P2 - P3 into 1 cluster at threshold 0.4.
        # Complete linkage must NOT merge P1 and P3 at threshold 0.5 because max dist > 0.5.
        embeddings = np.array([
            [1.0, 0.0],
            [0.85, 0.52],
            [0.55, 0.83]
        ], dtype=np.float32)

        # Distances:
        # dist(P1, P2) ~ 0.15
        # dist(P2, P3) ~ 0.09
        # dist(P1, P3) ~ 0.45
        # At threshold 0.25:
        # Single linkage chains P1 - P2 - P3 into 1 cluster (chaining).
        # Complete linkage requires max distance <= 0.25, so P1 and P3 are not merged.
        clusters = core.cluster_speaker_embeddings(embeddings, distance_threshold=0.25)
        self.assertNotEqual(clusters[0], clusters[2], "Complete linkage must not chain distant points")

    def test_1_to_1_bipartite_profile_matching(self):
        """
        Verify that two distinct clusters cannot both be assigned the same enrolled profile,
        even if both exceed the similarity threshold.
        """
        enrolled_profiles = {
            "Logan": {
                "embedding": [1.0, 0.0, 0.0]
            },
            "Angela": {
                "embedding": [0.0, 1.0, 0.0]
            }
        }

        # Cluster 0 is very close to Logan (sim 0.95)
        # Cluster 1 is also somewhat close to Logan (sim 0.70) and Angela (0.2)
        # 1-to-1 bipartite matching must give Logan to Cluster 0, and NOT duplicate Logan onto Cluster 1.
        cluster_centroids = {
            "CLUSTER_0": [0.95, 0.05, 0.0],
            "CLUSTER_1": [0.70, 0.20, 0.1],
        }

        matches = core.match_biometrics_1to1(
            cluster_centroids,
            enrolled_profiles,
            min_similarity=0.54,
            min_margin=0.06
        )

        assigned_speakers = list(matches.values())
        self.assertEqual(matches.get("CLUSTER_0"), "Logan")
        self.assertNotEqual(matches.get("CLUSTER_1"), "Logan", "Duplicate identity assigned in violation of 1-to-1 bipartite constraint")

    def test_elimination_of_talk_time_host_dominance(self):
        """
        Verify that having the most talk time does NOT result in an automatic identity assignment
        if acoustic similarity does not meet threshold.
        """
        enrolled_profiles = {
            "Logan": {
                "embedding": [1.0, 0.0, 0.0]
            }
        }
        # Speaker 0 spoke for 5000 seconds, but their voice is orthogonal to Logan
        cluster_centroids = {
            "CLUSTER_0": [0.0, 1.0, 0.0]
        }
        talk_times = {
            "CLUSTER_0": 5000.0
        }

        matches = core.match_biometrics_1to1(
            cluster_centroids,
            enrolled_profiles,
            talk_times=talk_times,
            min_similarity=0.54,
            min_margin=0.06
        )

        self.assertNotIn("CLUSTER_0", matches, "Talk-time must not force an attribution without acoustic threshold match")

    def test_project_diarization_onto_segments_immutability_and_safe_word_get(self):
        """
        Verify that project_diarization_onto_segments updates speaker labels while
        guaranteeing 100% SHA-256 byte parity on all transcript words, and handles
        unaligned words lacking 'start'/'end' keys without KeyError.
        """
        segments = [
            {
                "id": 0,
                "seek": 0,
                "start": 0.0,
                "end": 4.5,
                "text": " Welcome to Twitter Spaces 2026.",
                "speaker": "SPEAKER_UNKNOWN",
                "words": [
                    {"word": "Welcome", "start": 0.0, "end": 0.8, "score": 0.9, "speaker": "SPEAKER_UNKNOWN"},
                    {"word": "to", "start": 0.8, "end": 1.1, "score": 0.9, "speaker": "SPEAKER_UNKNOWN"},
                    {"word": "Twitter", "start": 1.1, "end": 1.8, "score": 0.9, "speaker": "SPEAKER_UNKNOWN"},
                    {"word": "Spaces", "start": 1.8, "end": 2.5, "score": 0.9, "speaker": "SPEAKER_UNKNOWN"},
                    # Unaligned word with NO start/end keys!
                    {"word": "2026.", "score": 0.8, "speaker": "SPEAKER_UNKNOWN"}
                ]
            }
        ]

        turns = [
            {"speaker": "Logan", "start": 0.0, "end": 5.0}
        ]

        original_hash = core.compute_transcript_text_hash(segments)

        updated_segments = core.project_diarization_onto_segments(segments, turns)

        # Speaker should be updated to Logan
        self.assertEqual(updated_segments[0]["speaker"], "Logan")
        self.assertEqual(updated_segments[0]["words"][0]["speaker"], "Logan")
        self.assertEqual(updated_segments[0]["words"][4]["speaker"], "Logan")

        # SHA-256 text hash MUST be identical
        updated_hash = core.compute_transcript_text_hash(updated_segments)
        self.assertEqual(original_hash, updated_hash)

    def test_reexport_shim(self):
        """
        Verify that scripts/spacepipe_transcribe_core.py can import and re-export
        all core attributes from spaces/zerogpu-transcriber/spacepipe_transcribe_core.py.
        """
        import spacepipe_transcribe_core as shim_core
        self.assertTrue(hasattr(shim_core, "subtract_crosstalk_intervals"))
        self.assertTrue(hasattr(shim_core, "cluster_speaker_embeddings"))
        self.assertTrue(hasattr(shim_core, "match_biometrics_1to1"))
        self.assertTrue(hasattr(shim_core, "project_diarization_onto_segments"))


if __name__ == "__main__":
    unittest.main()
