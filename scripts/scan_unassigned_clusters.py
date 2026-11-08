#!/usr/bin/env python3
"""
scripts/scan_unassigned_clusters.py

Discovers recurring unassigned speakers across historical transcript files (Speaker 1, SPEAKER_00, etc.),
analyzes conversational hand-off cues to suggest candidate speaker names,
and generates public/transcripts/speaker_candidates.json for 1-click UI enrollment.
"""

import os
import re
import json
import argparse
from pathlib import Path
from typing import Dict, List, Any

EPISODES_DIR = Path("public/transcripts/episodes")
CANDIDATES_OUT = Path("public/transcripts/speaker_candidates.json")

GENERIC_PATTERN = re.compile(r"^(?:speaker[_\s]?\d+|speaker\b|unknown)$", re.IGNORECASE)

HANDOFF_PATTERNS = [
    re.compile(r"\b(?:go\s+ahead|hey|hi|hello|welcome|thanks|thank\s+you)\s+([A-Z][a-z]{2,15})\b"),
    re.compile(r"\bthis\s+is\s+([A-Z][a-z]{2,15})\b"),
    re.compile(r"\bi\'m\s+([A-Z][a-z]{2,15})\b"),
    re.compile(r"\b([A-Z][a-z]{2,15}),?\s+(?:what\s+do\s+you\s+think|you\s+there|you\'re\s+on\s+mute|unmute)\b"),
]

EXCLUDED_NAMES = {
    "The", "This", "That", "Yeah", "Sure", "Well", "Right", "Like", "Just", "Good", "Here", "There",
    "Someone", "Everyone", "Nobody", "Anyone", "Today", "Tonight", "Yesterday", "Bro", "Man", "Dude"
}


def scan_clusters(limit_episodes: int = 0) -> Dict[str, Any]:
    if not EPISODES_DIR.exists():
        return {"total_clusters": 0, "candidates": []}

    ep_files = sorted(list(EPISODES_DIR.glob("*.json")))
    if limit_episodes > 0:
        ep_files = ep_files[:limit_episodes]

    # Map candidate cluster key -> data
    # cluster key: suggested_name or f"{ep_tag}_{speaker_label}"
    candidates: Dict[str, Dict[str, Any]] = {}

    for ep_file in ep_files:
        try:
            with open(ep_file, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            continue

        tag = ep_file.stem
        segments = data.get("segments", [])
        audio_url = data.get("audio_url") or data.get("metadata", {}).get("audio_url")

        for i, seg in enumerate(segments):
            spk = seg.get("speaker", "").strip()
            if not GENERIC_PATTERN.match(spk):
                continue

            txt = seg.get("text", "").strip()
            start = seg.get("start", 0)
            end = seg.get("end", 0)
            dur = end - start

            suggested_name = None
            for p in HANDOFF_PATTERNS:
                m = p.search(txt)
                if m:
                    cand = m.group(1).strip()
                    if cand not in EXCLUDED_NAMES and len(cand) >= 3:
                        suggested_name = cand
                        break

            # Also check preceding segment for mic-handoff
            if not suggested_name and i > 0:
                prev_txt = segments[i - 1].get("text", "")
                for p in HANDOFF_PATTERNS:
                    m = p.search(prev_txt)
                    if m:
                        cand = m.group(1).strip()
                        if cand not in EXCLUDED_NAMES and len(cand) >= 3:
                            suggested_name = cand
                            break

            cluster_key = suggested_name if suggested_name else f"{tag}_{spk}"

            if cluster_key not in candidates:
                candidates[cluster_key] = {
                    "id": f"cand_{abs(hash(cluster_key)) % 1000000}",
                    "suggested_name": suggested_name or "Unidentified Speaker",
                    "raw_speaker": spk,
                    "episodes": set(),
                    "total_turns": 0,
                    "total_duration_sec": 0.0,
                    "sample_clips": [],
                }

            c = candidates[cluster_key]
            c["episodes"].add(tag)
            c["total_turns"] += 1
            c["total_duration_sec"] += dur

            if dur >= 5.0 and len(c["sample_clips"]) < 3 and audio_url:
                c["sample_clips"].append({
                    "episode_tag": tag,
                    "audio_url": audio_url,
                    "start": start,
                    "end": end,
                    "snippet": txt[:120],
                })

    formatted_candidates = []
    for k, v in candidates.items():
        # Keep candidates with named suggestions or with multiple episodes / significant speech
        if v["suggested_name"] != "Unidentified Speaker" or len(v["episodes"]) >= 2 or v["total_turns"] >= 10:
            formatted_candidates.append({
                "id": v["id"],
                "suggested_name": v["suggested_name"],
                "raw_speaker": v["raw_speaker"],
                "episode_count": len(v["episodes"]),
                "episodes": sorted(list(v["episodes"])),
                "total_turns": v["total_turns"],
                "total_duration_sec": round(v["total_duration_sec"], 1),
                "sample_clips": v["sample_clips"],
            })

    formatted_candidates.sort(key=lambda x: (x["suggested_name"] != "Unidentified Speaker", x["episode_count"], x["total_turns"]), reverse=True)

    result = {
        "updated_at": "2026-11-08T05:40:00Z",
        "total_candidates": len(formatted_candidates),
        "candidates": formatted_candidates[:50],
    }

    CANDIDATES_OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(CANDIDATES_OUT, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)

    return result


def main():
    parser = argparse.ArgumentParser(description="Scan historical transcripts for recurring unassigned speaker clusters")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of episode files scanned (0 for all)")
    args = parser.parse_args()

    print(f"[*] Scanning transcript files in {EPISODES_DIR}...")
    res = scan_clusters(limit_episodes=args.limit)
    print(f"[✓] Identified {res['total_candidates']} candidate clusters. Saved to {CANDIDATES_OUT}")


if __name__ == "__main__":
    main()
