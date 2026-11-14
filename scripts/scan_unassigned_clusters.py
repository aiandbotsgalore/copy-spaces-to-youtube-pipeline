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
import urllib.request
from pathlib import Path
from typing import Dict, List, Any, Optional

EPISODES_DIR = Path("public/transcripts/episodes")
CANDIDATES_OUT = Path("public/transcripts/speaker_candidates.json")

def load_env_api_key() -> Optional[str]:
    key = os.environ.get("INCEPTION_API_KEY")
    if key:
        return key.strip()
    for f in [".env.local", ".env"]:
        p = Path(f)
        if p.exists():
            try:
                for line in p.read_text(encoding="utf-8").splitlines():
                    if line.startswith("INCEPTION_API_KEY="):
                        return line.split("=", 1)[1].strip().strip('"').strip("'")
            except Exception:
                pass
    return None

def resolve_speaker_with_mercury(dialogue_excerpt: str, api_key: str) -> Optional[str]:
    """Uses Mercury-3 to semantically identify unknown speakers from dialog context."""
    url = os.environ.get("INCEPTION_BASE_URL", "https://api.inceptionlabs.ai/v1") + "/chat/completions"
    payload = {
        "model": "mercury-3",
        "messages": [
            {
                "role": "system",
                "content": "Analyze the conversational context and determine the real name of the generic speaker (e.g. Speaker 1 or SPEAKER_00). If clearly identified by introductions, questions, or self-reference, return their name. If not identifiable, return name as null."
            },
            {"role": "user", "content": dialogue_excerpt}
        ],
        "max_tokens": 128,
        "temperature": 0.0,
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "speaker_identification",
                "strict": True,
                "schema": {
                    "type": "object",
                    "required": ["name", "confidence", "reason"],
                    "properties": {
                        "name": {"type": ["string", "null"]},
                        "confidence": {"type": "number"},
                        "reason": {"type": "string"}
                    },
                    "additionalProperties": False
                }
            }
        }
    }
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            content = data.get("choices", [{}])[0].get("message", {}).get("content")
            if content:
                parsed = json.loads(content)
                if parsed.get("name") and parsed.get("confidence", 0) >= 0.8:
                    return str(parsed["name"]).strip()
    except Exception:
        pass
    return None

GENERIC_PATTERN = re.compile(r"^(?:speaker[_\s]?\d+|speaker\b|unknown)$", re.IGNORECASE)

HANDOFF_PATTERNS = [
    re.compile(r"\b(?:go\s+ahead|hey|hi|hello|welcome|thanks|thank\s+you)\s+([A-Z][a-z]{2,15})\b"),
    re.compile(r"\bthis\s+is\s+([A-Z][a-z]{2,15})\b"),
    re.compile(r"\bi\'m\s+([A-Z][a-z]{2,15})\b"),
    re.compile(r"\b([A-Z][a-z]{2,15}),?\s+(?:what\s+do\s+you\s+think|you\s+there|you\'re\s+on\s+mute|unmute)\b"),
]

EXCLUDED_NAMES = {
    "The", "This", "That", "Yeah", "Sure", "Well", "Right", "Like", "Just", "Good", "Here", "There",
    "Someone", "Everyone", "Nobody", "Anyone", "Today", "Tonight", "Yesterday", "Bro", "Man", "Dude",
    # Conjunctions, prepositions, auxiliary verbs & common sentence starters/fillers
    "And", "But", "Can", "So", "Now", "Or", "If", "Because", "What", "When", "Where", "Why", "How",
    "Also", "Then", "Which", "Who", "Whom", "Whose", "They", "Them", "Their", "We", "You", "Your",
    "Are", "Were", "Was", "Been", "Have", "Has", "Had", "Will", "Would", "Could", "Should", "Shall",
    "Did", "Does", "Doing", "Done", "Going", "Come", "Came", "Got", "Getting", "Get",
    "Please", "Okay", "Oh", "Uh", "Um", "Wait", "See", "Look", "Listen", "Tell", "Say", "Let", "Make",
    "First", "Second", "Last", "Next", "Another", "One", "Two", "Three", "Four", "Five",
    "Yes", "No", "Nope", "Yep", "Alright", "Actually", "Basically", "Probably", "Maybe"
}


def scan_clusters(limit_episodes: int = 0, use_mercury: bool = True) -> Dict[str, Any]:
    if not EPISODES_DIR.exists():
        return {"total_clusters": 0, "candidates": []}

    api_key = load_env_api_key() if use_mercury else None
    if api_key and use_mercury:
        print("[*] Mercury-3 semantic speaker identification active.")

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
        ep_speaker_cache: Dict[str, Optional[str]] = {}

        for i, seg in enumerate(segments):
            spk = seg.get("speaker", "").strip()
            if not GENERIC_PATTERN.match(spk):
                continue

            txt = seg.get("text", "").strip()
            start = seg.get("start", 0)
            end = seg.get("end", 0)
            dur = end - start

            if spk in ep_speaker_cache:
                suggested_name = ep_speaker_cache[spk]
            else:
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

                # If still not found and Mercury is enabled, query Mercury-3 for contextual resolution
                if not suggested_name and use_mercury and api_key and dur >= 8.0:
                    context_window = ""
                    if i > 0:
                        context_window += f"{segments[i - 1].get('speaker', 'Speaker')}: {segments[i - 1].get('text', '')}\n"
                    context_window += f"{spk}: {txt}\n"
                    if i + 1 < len(segments):
                        context_window += f"{segments[i + 1].get('speaker', 'Speaker')}: {segments[i + 1].get('text', '')}\n"
                    
                    m_name = resolve_speaker_with_mercury(context_window, api_key)
                    if m_name and m_name not in EXCLUDED_NAMES:
                        suggested_name = m_name
                        print(f"  [Mercury-3] Resolved {tag} {spk} -> {m_name}")

                ep_speaker_cache[spk] = suggested_name

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

    from datetime import datetime, timezone
    result = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
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
    parser.add_argument("--no-mercury", action="store_true", help="Disable Mercury-3 semantic resolution")
    args = parser.parse_args()

    print(f"[*] Scanning transcript files in {EPISODES_DIR}...")
    res = scan_clusters(limit_episodes=args.limit, use_mercury=not args.no_mercury)
    print(f"[✓] Identified {res['total_candidates']} candidate clusters. Saved to {CANDIDATES_OUT}")


if __name__ == "__main__":
    main()
