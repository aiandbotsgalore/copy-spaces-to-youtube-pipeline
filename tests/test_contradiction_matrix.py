# tests/test_contradiction_matrix.py
import os
import sys
import json
import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from scripts.build_contradiction_matrix import (
    slice_transcript_windows,
    hydrate_claims_from_disk,
    group_claims_into_trajectories,
    generate_pair_id,
    merge_contradiction_pairs_into_graph,
    TopicAnchor,
    ClaimRecord,
)
from scripts.resolve_archive_speakers import CandidateOverlay


def test_slice_transcript_windows():
    # Create 120 segments
    segments = [
        {"start": float(i * 10), "end": float(i * 10 + 8), "speaker": f"Speaker {i % 2}", "text": f"Segment {i} text here."}
        for i in range(120)
    ]
    windows = slice_transcript_windows(segments, max_segments=50, overlap=5)
    assert len(windows) >= 3
    # Check overlap
    assert windows[0]["end_idx"] >= 45
    assert windows[1]["start_idx"] <= windows[0]["end_idx"]


def test_hydrate_claims_from_disk():
    raw_episode = {
        "release_tag": "ep1",
        "audio_url": "https://example.com/audio.mp3",
        "published_at": "2025-07-01T12:00:00Z",
        "segments": [
            {"start": 10.0, "end": 20.0, "speaker": "Speaker 1", "text": "I never heard of any tunnels under Wright-Patt."},
            {"start": 25.0, "end": 35.0, "speaker": "Logan", "text": "Shane and I organized the eviction fundraiser."},
        ]
    }

    raw_llm_claims = [
        {
            "segment_idx": 0,
            "topic_anchors": ["wright_patt_claims"],
            "stance_polarity": "denial",
            "context_intent": "literal",
            "diarization_bleed_suspected": False,
            "claim_summary": "Denied tunnels under base"
        },
        {
            "segment_idx": 1,
            "topic_anchors": ["eviction_fundraiser"],
            "stance_polarity": "affirmation",
            "context_intent": "literal",
            "diarization_bleed_suspected": False,
            "claim_summary": "Organized the fundraiser"
        }
    ]

    overlay = CandidateOverlay({
        "candidates": [
            {
                "scope": "cluster",
                "episode_id": "ep1",
                "raw_speaker": "Speaker 1",
                "resolved_name": "Angela",
                "status": "auto_approved",
                "confidence": 0.95
            }
        ]
    })

    hydrated = hydrate_claims_from_disk("ep1", raw_episode, raw_llm_claims, overlay)
    assert len(hydrated) == 2

    # Claim 0: speaker dynamically hydrated to "Angela" via overlay
    c0 = hydrated[0]
    assert c0["speaker"] == "Angela"
    assert c0["raw_speaker"] == "Speaker 1"
    assert c0["verbatim_quote"] == "I never heard of any tunnels under Wright-Patt."
    assert c0["start_sec"] == 10.0
    assert c0["end_sec"] == 20.0
    assert c0["audio_url"] == "https://example.com/audio.mp3"

    # Claim 1: speaker is "Logan"
    c1 = hydrated[1]
    assert c1["speaker"] == "Logan"
    assert c1["verbatim_quote"] == "Shane and I organized the eviction fundraiser."


def test_group_claims_into_trajectories_filters_generics():
    claims = [
        # Generic speaker -> MUST BE FILTERED OUT
        {
            "episode_id": "ep1",
            "date": "2024-01-01",
            "speaker": "Speaker 1",
            "topic_anchors": ["wright_patt_claims"],
            "verbatim_quote": "Claim by generic speaker",
            "context_intent": "literal",
            "diarization_bleed_suspected": False
        },
        # Real speaker Angela in 2025
        {
            "episode_id": "ep2",
            "date": "2025-07-16",
            "speaker": "Angela",
            "topic_anchors": ["wright_patt_claims"],
            "verbatim_quote": "There are tunnels under the base.",
            "context_intent": "literal",
            "diarization_bleed_suspected": False
        },
        # Real speaker Angela in 2026
        {
            "episode_id": "ep3",
            "date": "2026-02-18",
            "speaker": "Angela",
            "topic_anchors": ["wright_patt_claims"],
            "verbatim_quote": "I never said there were tunnels.",
            "context_intent": "literal",
            "diarization_bleed_suspected": False
        },
        # Sarcastic turn -> MUST BE FILTERED OUT
        {
            "episode_id": "ep4",
            "date": "2026-03-01",
            "speaker": "Angela",
            "topic_anchors": ["wright_patt_claims"],
            "verbatim_quote": "Oh yeah sure, and aliens live there too.",
            "context_intent": "sarcasm",
            "diarization_bleed_suspected": False
        }
    ]

    trajectories = group_claims_into_trajectories(claims)
    
    # Generic "Speaker 1" trajectory must NOT exist!
    assert ("Speaker 1", "wright_patt_claims") not in trajectories

    # Real ("Angela", "wright_patt_claims") must exist and contain exactly 2 claims (ep2, ep3)
    angela_traj = trajectories.get(("Angela", "wright_patt_claims"))
    assert angela_traj is not None
    assert len(angela_traj) == 2
    assert angela_traj[0]["episode_id"] == "ep2"
    assert angela_traj[1]["episode_id"] == "ep3"


def test_deterministic_pair_id():
    p1 = generate_pair_id("ep1", 10, "ep2", 20)
    p2 = generate_pair_id("ep1", 10, "ep2", 20)
    p3 = generate_pair_id("ep1", 11, "ep2", 20)
    assert p1 == p2
    assert p1 != p3
    assert p1.startswith("PAIR_")


def test_merge_contradiction_pairs_into_graph():
    existing_graph = {
        "version": "1.0",
        "contradiction_pairings": [
            {
                "pairing_id": "PAIR-01",
                "title": "Curated Pair 1",
                "curated": True,
                "pre_fallout": {"quote_id": "AQ-0097"}
            }
        ]
    }

    new_discovered_pairs = [
        # Duplicate of curated -> should not overwrite
        {
            "pairing_id": "PAIR-01",
            "title": "Auto Attempt Overwrite",
            "curated": False
        },
        # Brand new pair
        {
            "pairing_id": "PAIR_a1b2c3d4",
            "title": "Discovered Wright-Patt Reversal",
            "curated": False,
            "pre_fallout": {"episode_tag": "ep2", "start_sec": 10.0, "end_sec": 20.0},
            "post_fallout": {"episode_tag": "ep3", "start_sec": 50.0, "end_sec": 60.0}
        }
    ]

    merged = merge_contradiction_pairs_into_graph(existing_graph, new_discovered_pairs)
    pairs = merged["contradiction_pairings"]
    assert len(pairs) == 2

    curated = next(p for p in pairs if p["pairing_id"] == "PAIR-01")
    assert curated["title"] == "Curated Pair 1"  # preserved!

    discovered = next(p for p in pairs if p["pairing_id"] == "PAIR_a1b2c3d4")
    assert discovered["title"] == "Discovered Wright-Patt Reversal"
