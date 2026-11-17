"""Regression checks for speaker attribution on non-diarized transcripts."""
from unittest.mock import patch

from scripts.transcribe_and_diarize import resolve_speakers_intelligently


def test_long_single_whisper_cluster_remains_unidentified():
    segments = [
        {"speaker": "Speaker 1", "start": i * 3, "end": i * 3 + 2,
         "text": "I am Angela Maggard" if i == 5 else "Lana, what do you think?"}
        for i in range(40)
    ]
    with patch("scripts.transcribe_and_diarize.resolve_speakers_llm",
               side_effect=AssertionError("Cannot identify a mixed cluster from text")):
        actual, mappings = resolve_speakers_intelligently(segments, title="Group chat")
    assert actual is segments
    assert mappings == {}
    assert {s["speaker"] for s in actual} == {"Speaker 1"}


def test_real_multispeaker_clusters_can_still_be_resolved():
    segments = [
        {"speaker": "Speaker A", "start": 0.0, "end": 2.0, "text": "Hello"},
        {"speaker": "Speaker B", "start": 2.0, "end": 4.0, "text": "Hi"},
    ]
    with patch("scripts.transcribe_and_diarize.resolve_speakers_acoustically",
               return_value={}), patch(
               "scripts.transcribe_and_diarize.resolve_speakers_llm",
               return_value={"Speaker B": "Lana"}), patch(
               "scripts.transcribe_and_diarize.analyze_conversational_heuristics",
               return_value={}):
        actual, mappings = resolve_speakers_intelligently(segments)
    assert mappings == {"Speaker B": "Lana"}
    assert [s["speaker"] for s in actual] == ["Speaker A", "Lana"]
