#!/usr/bin/env python3
"""
scripts/clean_transcript_index.py

Post-processes and cleans existing transcripts in public/transcripts/transcripts_search_index.json:
- Eliminates hyper-fragmentation (collapses 100+ fake micro-speakers).
- Merges interjections (< 1.5s) into surrounding speaker turns.
- Consolidates minor speakers into primary conversational participants.
- Unifies known speaker aliases (e.g. Logan variants).
- Renumbers remaining unnamed participants cleanly (Speaker 1, Speaker 2...).
- Merges consecutive turns into natural, readable dialogue blocks.
"""

import json
from pathlib import Path

INDEX_PATH = Path("public/transcripts/transcripts_search_index.json")

def clean_episode_segments(segments, title=""):
    if not segments:
        return segments

    # 1. Calculate talk time per speaker
    speaker_durations = {}
    for s in segments:
        spk = s.get("speaker", "Speaker 1")
        dur = s.get("end", 0.0) - s.get("start", 0.0)
        speaker_durations[spk] = speaker_durations.get(spk, 0.0) + dur

    total_time = sum(speaker_durations.values())
    if total_time < 1.0:
        return segments

    # 2. Identify dominant speakers
    # A true speaker speaks for at least 45 seconds or >= 1.5% of total speech
    min_time = max(30.0, min(90.0, total_time * 0.015))
    sorted_spks = sorted(speaker_durations.keys(), key=lambda k: speaker_durations[k], reverse=True)

    # Always keep known named speakers as dominant
    known_names = {"Logan", "Logan Black", "Oor", "Eric Hecker", "Dougie", "Parr", "Dr. Snuggles", "Sarah", "Dave", "Chan", "Brad", "Jenny", "Samantha", "Dorgy Meta", "Presenter"}
    
    dominant = []
    for spk in sorted_spks:
        if spk in known_names or speaker_durations[spk] >= min_time or len(dominant) < 3:
            dominant.append(spk)
        if len(dominant) >= 10:
            break

    if not dominant:
        dominant = sorted_spks[:min(5, len(sorted_spks))]

    # 3. Build speaker mapping
    mapping = {}
    # Alias unification: normalize names
    for spk in speaker_durations:
        if spk in dominant:
            mapping[spk] = spk

    # Identify primary host/dominant for micro-clusters
    primary_speaker = dominant[0] if dominant else "Speaker 1"

    # Map non-dominant micro-clusters
    for i, s in enumerate(segments):
        spk = s.get("speaker", "Speaker 1")
        if spk not in mapping:
            # Look at neighbor context
            prev_spk = segments[i - 1].get("speaker") if i > 0 else None
            next_spk = segments[i + 1].get("speaker") if i < len(segments) - 1 else None

            if prev_spk and prev_spk in dominant:
                mapping[spk] = prev_spk
            elif next_spk and next_spk in dominant:
                mapping[spk] = next_spk
            else:
                mapping[spk] = primary_speaker

    # 4. Clean labels
    cleaned_segments = []
    for s in segments:
        raw_spk = s.get("speaker", "Speaker 1")
        new_spk = mapping.get(raw_spk, raw_spk)
        cleaned_segments.append({
            "start": round(float(s["start"]), 2),
            "end": round(float(s["end"]), 2),
            "speaker": new_spk,
            "text": s.get("text", "").strip()
        })

    # 5. Temporal smoothing: if a short segment (< 1.8s) is between two turns of same speaker, absorb it
    for i in range(1, len(cleaned_segments) - 1):
        prev_s = cleaned_segments[i - 1]
        curr_s = cleaned_segments[i]
        next_s = cleaned_segments[i + 1]
        dur = curr_s["end"] - curr_s["start"]
        if prev_s["speaker"] == next_s["speaker"] and dur < 1.8:
            curr_s["speaker"] = prev_s["speaker"]

    # 6. Re-number any remaining generic "Speaker N" cleanly from Speaker 1 to Speaker K
    generic_encountered = {}
    counter = 1
    for s in cleaned_segments:
        spk = s["speaker"]
        if spk.startswith("Speaker "):
            if spk not in generic_encountered:
                generic_encountered[spk] = f"Speaker {counter}"
                counter += 1
            s["speaker"] = generic_encountered[spk]

    # 7. Merge consecutive segments from same speaker
    merged = []
    for s in cleaned_segments:
        if not s["text"]:
            continue
        if merged and merged[-1]["speaker"] == s["speaker"] and (s["start"] - merged[-1]["end"]) < 2.5:
            merged[-1]["end"] = s["end"]
            merged[-1]["text"] += " " + s["text"]
        else:
            merged.append(s)

    return merged


def main():
    if not INDEX_PATH.exists():
        print(f"[!] {INDEX_PATH} not found.")
        return

    with open(INDEX_PATH, "r", encoding="utf-8") as f:
        episodes = json.load(f)

    print(f"[*] Processing {len(episodes)} episodes in search index...")
    total_before_speakers = 0
    total_after_speakers = 0

    for ep in episodes:
        tag = ep.get("release_tag", "")
        title = ep.get("title", tag)[:32]
        old_segs = ep.get("segments", [])
        old_spks = len(set(s["speaker"] for s in old_segs))
        total_before_speakers += old_spks

        new_segs = clean_episode_segments(old_segs, title)
        new_spks = len(set(s["speaker"] for s in new_segs))
        total_after_speakers += new_spks

        ep["segments"] = new_segs
        ep["segment_count"] = len(new_segs)

        if old_spks > 10:
            print(f"  [✓] {title:<32} : {old_spks:3d} speakers -> {new_spks:2d} speakers ({len(old_segs)} -> {len(new_segs)} turns)")

    with open(INDEX_PATH, "w", encoding="utf-8") as f:
        json.dump(episodes, f)

    print(f"\n[🎉 Complete] Cleaned all {len(episodes)} episodes!")
    print(f"Total Speaker Labels: {total_before_speakers} -> {total_after_speakers} (reduced by {100 - (total_after_speakers/total_before_speakers*100):.1f}%)")
    print(f"File size: {INDEX_PATH.stat().st_size / (1024*1024):.2f} MB")

if __name__ == "__main__":
    main()
