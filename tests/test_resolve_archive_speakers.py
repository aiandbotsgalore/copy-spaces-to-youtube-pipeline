# tests/test_resolve_archive_speakers.py
import os
import sys
import json
import tempfile
import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from scripts.resolve_archive_speakers import (
    GENERIC_SPEAKER_PATTERN,
    is_generic_speaker,
    extract_cluster_envelopes,
    resolve_cluster_with_context,
    check_biometric_veto,
    hydrate_effective_speaker,
    atomic_json_write,
    sync_summary_index_roster,
    CandidateOverlay,
)


def test_generic_speaker_pattern():
    assert is_generic_speaker("Speaker 1") is True
    assert is_generic_speaker("Speaker 12") is True
    assert is_generic_speaker("SPEAKER_00") is True
    assert is_generic_speaker("speaker_4") is True
    assert is_generic_speaker("Caller #3") is True
    assert is_generic_speaker("Guest") is True
    assert is_generic_speaker("Guest 2") is True
    assert is_generic_speaker("Host") is True
    assert is_generic_speaker("Unknown") is True
    assert is_generic_speaker("Unidentified") is True
    assert is_generic_speaker("Unassigned") is True
    assert is_generic_speaker("") is True
    assert is_generic_speaker("   ") is True

    # Real names must NOT be generic
    assert is_generic_speaker("Logan") is False
    assert is_generic_speaker("Angela") is False
    assert is_generic_speaker("Shane") is False
    assert is_generic_speaker("Sav") is False
    assert is_generic_speaker("Timmy") is False
    assert is_generic_speaker("Eric") is False


def test_extract_cluster_envelopes():
    segments = [
        {"start": 0.0, "end": 5.0, "speaker": "Logan", "text": "Welcome everyone to the Space."},
        {"start": 5.5, "end": 10.0, "speaker": "Logan", "text": "Eric, go ahead and unmute your mic."},
        {"start": 10.5, "end": 25.0, "speaker": "Speaker 1", "text": "Hey Logan, thanks for bringing me up. I wanted to talk about Wright-Patterson."},
        {"start": 25.5, "end": 28.0, "speaker": "Logan", "text": "Yeah."},  # backchannel
        {"start": 28.5, "end": 45.0, "speaker": "Speaker 1", "text": "There are rumors being spread that need to be addressed."},
        {"start": 50.0, "end": 60.0, "speaker": "Speaker 2", "text": "Can I chime in real quick?"},
    ]

    envelopes = extract_cluster_envelopes(
        episode_id="test_ep",
        segments=segments,
        target_speaker="Speaker 1",
        max_envelopes=3
    )

    assert len(envelopes) >= 1
    env = envelopes[0]
    assert env["target_speaker"] == "Speaker 1"
    assert "Logan" in [t["speaker"] for t in env["turns"]]
    assert any("Eric, go ahead" in t["text"] for t in env["turns"])
    assert any("Hey Logan, thanks" in t["text"] for t in env["turns"])


def test_resolve_cluster_title_inference_cap():
    # If the name is only in the title and NOT in the audio envelope, cap confidence at 0.65
    envelope_text = "Logan: Welcome up.\nSpeaker 1: Hi everyone, happy to be here."
    title = "Interview with Special Guest Eric"
    description = "Tonight we speak with Eric."

    mock_llm_response = {
        "resolved_name": "Eric",
        "confidence": 0.95,
        "evidence_quote": "Happy to be here.",
        "handoff_type": "host_handoff"
    }

    result = resolve_cluster_with_context(
        llm_response=mock_llm_response,
        envelope_text=envelope_text,
        title=title,
        description=description,
        known_aliases={"Eric": ["Eric"]}
    )

    assert result["resolved_name"] == "Eric"
    # Because "Eric" does NOT appear anywhere in envelope_text, it must be capped at 0.65
    assert result["confidence"] <= 0.65
    assert result["handoff_type"] == "title_inference_only"
    assert result["status"] == "pending"  # cannot be auto_approved


def test_split_cluster_prevention():
    assigned_names = {"Logan", "Eric"}
    
    mock_llm_response = {
        "resolved_name": "Eric",
        "confidence": 0.92,
        "evidence_quote": "Thanks Eric, take over.",
        "handoff_type": "host_handoff"
    }
    envelope_text = "Logan: Thanks Eric, take over.\nSpeaker 2: Got it."

    result = resolve_cluster_with_context(
        llm_response=mock_llm_response,
        envelope_text=envelope_text,
        title="Open Mic",
        description="",
        existing_episode_assignments=assigned_names
    )

    assert result["resolved_name"] == "Eric"
    assert result["potential_split_cluster"] is True
    assert result["status"] == "pending"  # blocked from auto_approved!


def test_biometric_veto_cosine_similarity():
    # 192-dim vectors
    emb_profile = [1.0] + [0.0] * 191
    # Dissimilar embedding (cosine sim = 0.0)
    emb_cluster_mismatch = [0.0, 1.0] + [0.0] * 190
    # Similar embedding (cosine sim = 1.0)
    emb_cluster_match = [1.0] + [0.0] * 191

    # Match check
    conflict_match, sim_match = check_biometric_veto(emb_cluster_match, emb_profile, threshold=0.38)
    assert conflict_match is False
    assert sim_match >= 0.99

    # Mismatch check (must trigger acoustic veto!)
    conflict_mismatch, sim_mismatch = check_biometric_veto(emb_cluster_mismatch, emb_profile, threshold=0.38)
    assert conflict_mismatch is True
    assert sim_mismatch < 0.38


def test_overlay_hydration_logic():
    overlay_data = {
        "candidates": [
            {
                "scope": "cluster",
                "episode_id": "ep1",
                "raw_speaker": "Speaker 1",
                "resolved_name": "Sav",
                "status": "auto_approved",
                "attribution_method": "acoustic", "acoustic_verified": True,
                "confidence": 0.92,
                "acoustic_conflict": False
            },
            {
                "scope": "segment",
                "episode_id": "ep1",
                "raw_speaker": "Speaker 1",
                "segment_idx": 4,
                "resolved_name": "Angela",
                "status": "human_verified",
                "confidence": 1.0
            },
            {
                "scope": "cluster",
                "episode_id": "ep1",
                "raw_speaker": "Speaker 2",
                "resolved_name": "Shane",
                "status": "pending",
                "confidence": 0.70
            }
        ]
    }

    overlay = CandidateOverlay(overlay_data)

    # Segment 0 (cluster match -> auto_approved Sav)
    spk0 = overlay.get_effective_speaker("ep1", "Speaker 1", segment_idx=0)
    assert spk0 == "Sav"

    # Segment 4 (segment override -> human_verified Angela)
    spk4 = overlay.get_effective_speaker("ep1", "Speaker 1", segment_idx=4)
    assert spk4 == "Angela"

    # Speaker 2 is "pending" -> should NOT hydrate, falls back to raw_speaker!
    spk_pending = overlay.get_effective_speaker("ep1", "Speaker 2", segment_idx=10)
    assert spk_pending == "Speaker 2"


def test_atomic_json_write(tmp_path):
    target = tmp_path / "sub" / "output.json"
    data = {"test": 123, "name": "Logan"}
    
    atomic_json_write(target, data, create_backup=True)
    assert target.exists()
    
    with open(target, "r", encoding="utf-8") as f:
        loaded = json.load(f)
    assert loaded["name"] == "Logan"

    # Update with backup rotation
    data2 = {"test": 456, "name": "Shane"}
    atomic_json_write(target, data2, create_backup=True)

    with open(target, "r", encoding="utf-8") as f:
        loaded2 = json.load(f)
    assert loaded2["name"] == "Shane"
    assert (tmp_path / "sub" / "output.json.bak").exists()


def test_sync_summary_index_roster():
    summary_index = [
        {
            "release_tag": "ep1",
            "title": "Episode 1",
            "speakers": ["Logan", "Speaker 1", "Speaker 2"]
        }
    ]
    raw_segments = [
        {"speaker": "Logan", "text": "Hi"},
        {"speaker": "Speaker 1", "text": "Hello"},
        {"speaker": "Speaker 2", "text": "Hey"},
    ]

    overlay = CandidateOverlay({
        "candidates": [
            {
                "scope": "cluster",
                "episode_id": "ep1",
                "raw_speaker": "Speaker 1",
                "resolved_name": "Sav",
                "status": "auto_approved",
                "attribution_method": "acoustic", "acoustic_verified": True,
                "confidence": 0.95,
                "acoustic_conflict": False
            }
        ]
    })

    updated = sync_summary_index_roster(summary_index, "ep1", raw_segments, overlay)
    assert updated is True
    # Speaker 1 should now be Sav, Speaker 2 remains Speaker 2
    ep = next(e for e in summary_index if e["release_tag"] == "ep1")
    assert "Sav" in ep["speakers"]
    assert "Logan" in ep["speakers"]
    assert "Speaker 2" in ep["speakers"]
    assert "Speaker 1" not in ep["speakers"]
