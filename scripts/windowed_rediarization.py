"""Resumable ZeroGPU diarization using one bounded audio window per request."""
import hashlib
import json
import math
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "spaces" / "zerogpu-transcriber"))
from spacepipe_transcribe_core import (
    compute_transcript_text_hash, reconcile_chunk_speakers,
    project_diarization_onto_segments, match_biometrics_1to1,
)


def validate_window(result, start, duration):
    if not isinstance(result, dict) or result.get("error"):
        raise RuntimeError(result.get("error", "Invalid window response") if isinstance(result, dict) else "Invalid window response")
    if result.get("status") != "success":
        raise ValueError("Audio window did not complete successfully")
    if result.get("start_seconds") != start or result.get("duration_seconds") != duration:
        raise ValueError("Audio window boundaries do not match the request")
    if not isinstance(result.get("turns"), list) or not isinstance(result.get("embeddings"), dict):
        raise ValueError("Audio window lacks diarization data")
    if result.get("embedding_model") != "speechbrain/spkrec-ecapa-voxceleb":
        raise ValueError("Unexpected speaker embedding model")
    for turn in result["turns"]:
        a, b = float(turn["start"]), float(turn["end"])
        if not turn.get("speaker") or not (math.isfinite(a) and math.isfinite(b) and 0 <= a < b <= duration + 0.1):
            raise ValueError("Invalid or out-of-window speaker turn")
    return result


def rediarize_in_windows(audio_url, segments, profiles=None, endpoint=None,
                         cache_dir=".cache/rediarize_windows", window_seconds=300):
    from cloud_transcribe_client import create_gradio_client, DEFAULT_SPACE_ENDPOINT
    if not segments or not 0 < window_seconds <= 300:
        raise ValueError("Nonempty transcript and window size in (0, 300] required")
    duration = max(float(s["end"]) for s in segments)
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("Invalid transcript duration")
    identity = {"version": 1, "audio_url": audio_url, "duration": duration,
                "window_seconds": window_seconds, "endpoint": endpoint or DEFAULT_SPACE_ENDPOINT}
    cache_key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    cache = Path(cache_dir) / cache_key
    cache.mkdir(parents=True, exist_ok=True)
    turns, embeddings = [], {}
    count = math.ceil(duration / window_seconds)
    for index in range(count):
        start = index * window_seconds
        length = min(window_seconds, duration - start)
        path = cache / f"window_{index:05d}.json"
        if path.exists():
            result = validate_window(json.loads(path.read_text(encoding="utf-8")), start, length)
            print(f"[Window {index + 1}/{count}] Reusing validated acoustic result", flush=True)
        else:
            print(f"[Window {index + 1}/{count}] Diarizing {start:.2f}s to {start + length:.2f}s", flush=True)
            client = create_gradio_client(endpoint or DEFAULT_SPACE_ENDPOINT, os.environ.get("HF_TOKEN"))
            result = client.predict(audio_url=audio_url, start_seconds=start, duration_seconds=length,
                                    api_key=os.environ.get("SPACE_API_KEY", ""), api_name="/diarize_window")
            if isinstance(result, str):
                result = json.loads(result)
            validate_window(result, start, length)
            temporary = path.with_suffix(".tmp")
            temporary.write_text(json.dumps(result, allow_nan=False), encoding="utf-8")
            os.replace(temporary, path)
        for turn in result["turns"]:
            turns.append(dict(turn, speaker=f"chunk{index}_{turn['speaker']}",
                              start=start + float(turn["start"]), end=min(duration, start + float(turn["end"]))))
        for speaker, vector in result["embeddings"].items():
            embeddings[f"chunk{index}_{speaker}"] = vector
    if not turns:
        raise ValueError("No speech turns found in the episode; nothing persisted")
    reconciled, centroids = reconcile_chunk_speakers(turns, embeddings)
    matches = match_biometrics_1to1(centroids, profiles or {})
    updated = project_diarization_onto_segments(segments, reconciled)
    for segment in updated:
        if segment.get("speaker_verified") or segment.get("attribution", {}).get("method") == "human_verified":
            continue
        raw = segment["raw_speaker"]
        if raw in matches:
            segment["speaker"] = matches[raw]
            segment["attribution"] = {"method": "acoustic", "model": "speechbrain/spkrec-ecapa-voxceleb"}
        for word in segment.get("words", []):
            word["raw_speaker"] = word.get("speaker", "Unknown")
            word["speaker"] = matches.get(word["raw_speaker"], word["raw_speaker"])
    original_hash = compute_transcript_text_hash(segments)
    if compute_transcript_text_hash(updated) != original_hash:
        raise ValueError("Windowed diarization changed transcript text or timing")
    return {"status": "success", "segments": updated, "turns": reconciled,
            "clusters": centroids, "matched_speakers": matches,
            "embedding_model": "speechbrain/spkrec-ecapa-voxceleb",
            "text_hash": original_hash, "verified_immutable": True,
            "window_count": count, "window_cache": str(cache)}
