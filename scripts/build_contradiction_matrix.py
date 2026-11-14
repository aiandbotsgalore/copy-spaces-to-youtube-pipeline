#!/usr/bin/env python3
"""
scripts/build_contradiction_matrix.py

Builds the Global Contradiction & Evolution Matrix for SpacePipe Studio & THE PAPER TRAIL.
Adheres strictly to the Core Invariants:
1. 100% Read-Only Episode Files: public/transcripts/episodes/*.json are immutable.
2. Segment-Index Grounding: Claims are extracted with segment_idx and hydrated from disk.
3. Dynamic Speaker Hydration: Speaker identity is resolved via CandidateOverlay dynamically.
4. Generic Speaker Exclusion: Generic labels (Speaker 1, etc.) are strictly excluded from trajectories.
5. Cross-Platform Atomic I/O: Writes with fsync and .bak rotation.
"""

import os
import re
import sys
import json
import time
import copy
import hashlib
import random
import argparse
import urllib.request
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple, Set

# Ensure local imports
BASE_DIR = Path(__file__).resolve().parents[1]
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from scripts.resolve_archive_speakers import (
    is_generic_speaker,
    atomic_json_write,
    CandidateOverlay,
    load_api_key,
    CANDIDATES_FILE
)

EPISODES_DIR = Path("public/transcripts/episodes")
CLAIMS_CACHE_DIR = Path("public/transcripts/cache/claims")
INVESTIGATIVE_KG_FILE = Path("public/transcripts/investigative_knowledge_graph.json")
CLAIM_EVOLUTION_FILE = Path("public/transcripts/claim_evolution_matrix.json")

TopicAnchor = str
ClaimRecord = Dict[str, Any]

TOPIC_ANCHORS = [
    "eviction_fundraiser",
    "wright_patt_claims",
    "legal_threats",
    "recording_calls",
    "dms_with_logan",
    "allegations_of_harm",
    "accountability_standards",
    "guilt_by_association",
    "harassment_or_paranoia",
    "general_dispute"
]

GROUND_TRUTH_AXIOMS = (
    "EDITORIAL FACT-CHECKING GROUND TRUTH AXIOMS:\n"
    "1. Logan and Shane organized the May eviction fundraiser. Angela's messages regarding it are not financial help.\n"
    "2. In Sav vs. Angela direct messages, exact speaker attributions must be preserved against known historical label reversals.\n"
    "3. Factual allegations remain disputed claims unless corroborated by primary court or bank documents.\n"
)


def generate_pair_id(pre_ep: str, pre_seg: int, post_ep: str, post_seg: int) -> str:
    """Generates a deterministic SHA-256 pair ID for contradiction deduplication."""
    raw = f"{pre_ep}:{pre_seg}->{post_ep}:{post_seg}".encode("utf-8")
    h = hashlib.sha256(raw).hexdigest()[:8]
    return f"PAIR_{h}"


def slice_transcript_windows(
    segments: List[Dict[str, Any]],
    max_segments: int = 50,
    overlap: int = 5
) -> List[Dict[str, Any]]:
    """
    Slices transcript into overlapping dialogue windows to prevent LLM output token starvation.
    """
    total = len(segments)
    if total == 0:
        return []

    windows = []
    start = 0
    while start < total:
        end = min(start + max_segments, total)
        windows.append({
            "start_idx": start,
            "end_idx": end - 1,
            "segments": segments[start:end]
        })
        if end >= total:
            break
        start += max_segments - overlap

    return windows


def format_window_for_prompt(window: Dict[str, Any], title: str, description: str) -> str:
    """Formats window segments with numbered segment indices for deterministic hydration."""
    lines = [
        f"Episode: {title}",
        f"Description: {description}",
        f"Available Topic Anchors: {', '.join(TOPIC_ANCHORS)}",
        "\n--- TRANSCRIPT WINDOW SEGMENTS ---"
    ]
    for seg in window["segments"]:
        # Find global segment index
        idx = seg.get("_global_idx")
        spk = seg.get("speaker", "Speaker")
        txt = seg.get("text", "").strip()
        lines.append(f"[{idx}] {spk}: {txt}")

    return "\n".join(lines)


def call_mercury_claim_extraction(prompt_text: str, api_key: str, max_retries: int = 4) -> Optional[List[Dict[str, Any]]]:
    """Calls Mercury-3 with strict json_schema to extract factual claims."""
    url = os.environ.get("INCEPTION_BASE_URL", "https://api.inceptionlabs.ai/v1") + "/chat/completions"
    payload = {
        "model": "mercury-3",
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are the SpacePipe Lead Investigative Fact-Checker. Extract substantive factual claims, "
                    "allegations, legal assertions, fundraiser mentions, or direct admissions from the transcript. "
                    "For each claim, return the exact integer segment_idx from the brackets [seg_idx], "
                    "one or more topic_anchors, stance_polarity, context_intent, and diarization_bleed_suspected. "
                    "Do NOT extract filler, general banter, or meta-commentary."
                )
            },
            {"role": "user", "content": prompt_text}
        ],
        "max_tokens": 1500,
        "temperature": 0.0,
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "claim_extraction",
                "strict": True,
                "schema": {
                    "type": "object",
                    "required": ["claims"],
                    "properties": {
                        "claims": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "required": [
                                    "segment_idx",
                                    "topic_anchors",
                                    "stance_polarity",
                                    "context_intent",
                                    "diarization_bleed_suspected",
                                    "claim_summary"
                                ],
                                "properties": {
                                    "segment_idx": {"type": "integer"},
                                    "topic_anchors": {
                                        "type": "array",
                                        "items": {"type": "string"}
                                    },
                                    "stance_polarity": {
                                        "type": "string",
                                        "enum": ["affirmation", "denial", "deflection", "hearsay", "eyewitness"]
                                    },
                                    "context_intent": {
                                        "type": "string",
                                        "enum": ["literal", "sarcasm", "reading_quote", "hypothetical"]
                                    },
                                    "diarization_bleed_suspected": {"type": "boolean"},
                                    "claim_summary": {"type": "string"}
                                },
                                "additionalProperties": False
                            }
                        }
                    },
                    "additionalProperties": False
                }
            }
        }
    }

    req_data = json.dumps(payload).encode("utf-8")
    delay = 1.0

    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(
                url,
                data=req_data,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}"
                }
            )
            with urllib.request.urlopen(req, timeout=45) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                content = data.get("choices", [{}])[0].get("message", {}).get("content")
                if content:
                    parsed = json.loads(content)
                    if isinstance(parsed, list):
                        if parsed and isinstance(parsed[0], dict) and "claims" in parsed[0]:
                            return parsed[0].get("claims", [])
                        return [c for c in parsed if isinstance(c, dict)]
                    elif isinstance(parsed, dict):
                        return parsed.get("claims", [])
        except Exception:
            if attempt == max_retries - 1:
                return None
            jitter = random.uniform(0.1, 0.5)
            time.sleep(delay + jitter)
            delay *= 2.0

    return None


def hydrate_claims_from_disk(
    episode_id: str,
    episode_dict: Dict[str, Any],
    raw_claims: List[Dict[str, Any]],
    overlay: Optional[CandidateOverlay] = None
) -> List[Dict[str, Any]]:
    """
    Hydrates claims using immutable segment text, timestamps, and audio_url from disk.
    Applies Dynamic Speaker Hydration via CandidateOverlay.
    """
    segments = episode_dict.get("segments", [])
    audio_url = episode_dict.get("audio_url") or episode_dict.get("metadata", {}).get("audio_url", "")
    date_str = episode_dict.get("published_at") or episode_dict.get("episode_date") or ""

    hydrated = []
    seen_indices = set()

    for rc in raw_claims:
        seg_idx = rc.get("segment_idx")
        if seg_idx is None or not isinstance(seg_idx, int) or seg_idx < 0 or seg_idx >= len(segments):
            continue

        if seg_idx in seen_indices:
            continue
        seen_indices.add(seg_idx)

        seg = segments[seg_idx]
        raw_spk = seg.get("speaker", "Speaker")

        # Dynamic speaker hydration:
        if overlay:
            effective_spk = overlay.get_effective_speaker(episode_id, raw_spk, segment_idx=seg_idx)
        else:
            effective_spk = raw_spk

        hydrated.append({
            "episode_id": episode_id,
            "segment_idx": seg_idx,
            "speaker": effective_spk,
            "raw_speaker": raw_spk,
            "date": date_str,
            "start_sec": float(seg.get("start", 0.0)),
            "end_sec": float(seg.get("end", 0.0)),
            "verbatim_quote": str(seg.get("text", "")).strip(),
            "audio_url": audio_url,
            "topic_anchors": rc.get("topic_anchors", ["general_dispute"]),
            "stance_polarity": rc.get("stance_polarity", "affirmation"),
            "context_intent": rc.get("context_intent", "literal"),
            "diarization_bleed_suspected": bool(rc.get("diarization_bleed_suspected", False)),
            "claim_summary": rc.get("claim_summary", ""),
        })

    return hydrated


def group_claims_into_trajectories(claims: List[Dict[str, Any]]) -> Dict[Tuple[str, str], List[Dict[str, Any]]]:
    """
    Groups claims by (speaker, topic_anchor) sorted chronologically.
    Strictly filters out:
    - Diarization bleed / crosstalk
    - Sarcasm or reading third-party quotes
    - Unresolved generic speaker labels (Speaker 1, etc.)
    """
    trajectories: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}

    for c in claims:
        # Quarantine bleed
        if c.get("diarization_bleed_suspected"):
            continue

        # Filter out sarcasm or reading quotes
        if c.get("context_intent") in ("sarcasm", "reading_quote"):
            continue

        spk = c.get("speaker", "").strip()
        # Strictly exclude generic speakers!
        if is_generic_speaker(spk):
            continue

        topics = c.get("topic_anchors", [])
        if not topics:
            topics = ["general_dispute"]

        for t in topics:
            key = (spk, t)
            if key not in trajectories:
                trajectories[key] = []
            trajectories[key].append(c)

    # Sort each trajectory chronologically
    for key in trajectories:
        trajectories[key].sort(key=lambda x: (x.get("date", ""), x.get("start_sec", 0.0)))

    return trajectories


def call_mercury_cross_examination(
    speaker: str,
    topic: str,
    claim_a: Dict[str, Any],
    claim_b: Dict[str, Any],
    api_key: str
) -> Optional[Dict[str, Any]]:
    """Evaluates two chronological claims by the same speaker for contradictions."""
    url = os.environ.get("INCEPTION_BASE_URL", "https://api.inceptionlabs.ai/v1") + "/chat/completions"

    prompt_user = (
        f"Speaker: {speaker}\n"
        f"Topic: {topic}\n\n"
        f"{GROUND_TRUTH_AXIOMS}\n\n"
        f"CLAIM A (Earlier - {claim_a.get('date', 'Unknown')}):\n"
        f"Episode: {claim_a.get('episode_id')}\n"
        f"Quote: \"{claim_a.get('verbatim_quote')}\"\n"
        f"Summary: {claim_a.get('claim_summary')}\n"
        f"Stance: {claim_a.get('stance_polarity')}\n\n"
        f"CLAIM B (Later - {claim_b.get('date', 'Unknown')}):\n"
        f"Episode: {claim_b.get('episode_id')}\n"
        f"Quote: \"{claim_b.get('verbatim_quote')}\"\n"
        f"Summary: {claim_b.get('claim_summary')}\n"
        f"Stance: {claim_b.get('stance_polarity')}\n\n"
        f"Does Claim B represent a factual reversal, narrative goalpost shift, or standard of disclosure inversion compared to Claim A?"
    )

    payload = {
        "model": "mercury-3",
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are the SpacePipe Senior Investigative Editor. Determine if two statements by the same speaker "
                    "constitute a genuine factual contradiction, narrative goalpost shift, or double standard. "
                    "Reject minor phrasing nuances or genuine honest clarifications. "
                    "If a genuine contradiction exists, return is_contradiction: true with contradiction_type and explanation. "
                    "Otherwise return is_contradiction: false."
                )
            },
            {"role": "user", "content": prompt_user}
        ],
        "max_tokens": 512,
        "temperature": 0.0,
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "contradiction_evaluation",
                "strict": True,
                "schema": {
                    "type": "object",
                    "required": ["is_contradiction", "title", "contradiction_type", "editorial_notes", "confidence"],
                    "properties": {
                        "is_contradiction": {"type": "boolean"},
                        "title": {"type": "string"},
                        "contradiction_type": {
                            "type": "string",
                            "enum": ["factual_reversal", "narrative_shift", "standard_inversion", "none"]
                        },
                        "editorial_notes": {"type": "string"},
                        "confidence": {"type": "number"}
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
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}"
            }
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            content = data.get("choices", [{}])[0].get("message", {}).get("content")
            if content:
                parsed = json.loads(content)
                if isinstance(parsed, list):
                    return parsed[0] if (parsed and isinstance(parsed[0], dict)) else None
                elif isinstance(parsed, dict):
                    return parsed
    except Exception:
        pass

    return None


def merge_contradiction_pairs_into_graph(
    existing_graph: Dict[str, Any],
    new_pairs: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Merges newly discovered contradiction pairs into investigative_knowledge_graph.json
    without overwriting curated: true records.
    """
    out_graph = copy.deepcopy(existing_graph)
    pairings = out_graph.setdefault("contradiction_pairings", [])

    existing_by_id = {p.get("pairing_id"): p for p in pairings if p.get("pairing_id")}

    for npair in new_pairs:
        pid = npair.get("pairing_id")
        if not pid:
            continue

        existing = existing_by_id.get(pid)
        if existing and existing.get("curated", False):
            # Never overwrite curated records!
            continue

        if existing:
            # Update existing non-curated record
            existing.update(npair)
        else:
            pairings.append(npair)
            existing_by_id[pid] = npair

    # Update stats
    out_graph.setdefault("stats", {})["total_contradiction_pairs"] = len(pairings)
    return out_graph


def build_matrix(
    limit: int = 0,
    episode_ids: Optional[List[str]] = None,
    dry_run: bool = False,
    resume: bool = True,
    api_key: Optional[str] = None
) -> Dict[str, Any]:
    """
    Executes Pass A (Claim Extraction & Hydration), Pass B (Trajectory Clustering),
    and Pass C (Cross-Examination Judge).
    """
    if not api_key:
        api_key = load_api_key()

    # Load overlay
    if CANDIDATES_FILE.exists():
        try:
            with open(CANDIDATES_FILE, "r", encoding="utf-8") as f:
                overlay = CandidateOverlay(json.load(f))
        except Exception:
            overlay = CandidateOverlay()
    else:
        overlay = CandidateOverlay()

    CLAIMS_CACHE_DIR.mkdir(parents=True, exist_ok=True)

    ep_files = sorted(list(EPISODES_DIR.glob("*.json")))
    if episode_ids:
        target_ids = set(episode_ids)
        ep_files = [f for f in ep_files if f.stem in target_ids]
    if limit > 0:
        ep_files = ep_files[:limit]

    print(f"[*] Processing {len(ep_files)} episodes for Contradiction Matrix...")
    all_claims: List[Dict[str, Any]] = []

    # PASS A: Windowed Extraction & Disk Cache
    for ep_file in ep_files:
        tag = ep_file.stem
        cache_file = CLAIMS_CACHE_DIR / f"{tag}.json"

        try:
            with open(ep_file, "r", encoding="utf-8") as f:
                ep_data = json.load(f)
        except Exception:
            continue

        cached_claims = None
        if resume and cache_file.exists():
            try:
                with open(cache_file, "r", encoding="utf-8") as cf:
                    cached_claims = json.load(cf).get("claims")
            except Exception:
                pass

        if cached_claims is not None:
            # Rehydrate with latest CandidateOverlay and disk text!
            hydrated = hydrate_claims_from_disk(tag, ep_data, cached_claims, overlay)
            all_claims.extend(hydrated)
            continue

        # Extract claims via Mercury-3
        segments = ep_data.get("segments", [])
        for idx, s in enumerate(segments):
            s["_global_idx"] = idx

        windows = slice_transcript_windows(segments, max_segments=45, overlap=5)
        raw_extracted_claims = []

        if api_key:
            for w in windows:
                p_text = format_window_for_prompt(w, ep_data.get("title", ""), ep_data.get("body", ""))
                w_claims = call_mercury_claim_extraction(p_text, api_key)
                if w_claims:
                    raw_extracted_claims.extend(w_claims)

        # Cache raw claims
        if not dry_run and raw_extracted_claims:
            atomic_json_write(cache_file, {"episode_id": tag, "claims": raw_extracted_claims})

        # Hydrate
        hydrated = hydrate_claims_from_disk(tag, ep_data, raw_extracted_claims, overlay)
        all_claims.extend(hydrated)
        print(f"  [Pass A] {tag}: extracted & hydrated {len(hydrated)} claims.")

    print(f"[✓] Pass A complete. Total claims pool: {len(all_claims)}")

    # PASS B: Trajectory Clustering
    trajectories = group_claims_into_trajectories(all_claims)
    print(f"[✓] Pass B complete. Clustered into {len(trajectories)} multi-year trajectories.")

    # PASS C: Cross-Examination
    discovered_pairs = []
    for (speaker, topic), claim_chain in trajectories.items():
        if len(claim_chain) < 2:
            continue

        # Compare pairs across different episodes
        for i in range(len(claim_chain)):
            for j in range(i + 1, min(i + 4, len(claim_chain))):
                ca = claim_chain[i]
                cb = claim_chain[j]

                # Only compare across different recording dates
                if ca.get("episode_id") == cb.get("episode_id"):
                    continue

                eval_res = None
                if api_key:
                    eval_res = call_mercury_cross_examination(speaker, topic, ca, cb, api_key)

                if eval_res and eval_res.get("is_contradiction") and eval_res.get("confidence", 0) >= 0.75:
                    pid = generate_pair_id(ca["episode_id"], ca["segment_idx"], cb["episode_id"], cb["segment_idx"])
                    pair_record = {
                        "pairing_id": pid,
                        "title": eval_res.get("title") or f"{speaker}: {topic.replace('_', ' ').title()} Reversal",
                        "topic_anchor": topic,
                        "speaker": speaker,
                        "curated": False,
                        "contradiction_type": eval_res.get("contradiction_type", "factual_reversal"),
                        "editorial_notes": eval_res.get("editorial_notes", ""),
                        "confidence": eval_res.get("confidence", 0.8),
                        "pre_fallout": {
                            "episode_tag": ca["episode_id"],
                            "date": ca.get("date", ""),
                            "start_sec": ca.get("start_sec", 0.0),
                            "end_sec": ca.get("end_sec", 0.0),
                            "segment_idx": ca.get("segment_idx"),
                            "verbatim": ca.get("verbatim_quote", ""),
                            "audio_url": ca.get("audio_url", ""),
                            "claim_summary": ca.get("claim_summary", "")
                        },
                        "post_fallout": {
                            "episode_tag": cb["episode_id"],
                            "date": cb.get("date", ""),
                            "start_sec": cb.get("start_sec", 0.0),
                            "end_sec": cb.get("end_sec", 0.0),
                            "segment_idx": cb.get("segment_idx"),
                            "verbatim": cb.get("verbatim_quote", ""),
                            "audio_url": cb.get("audio_url", ""),
                            "claim_summary": cb.get("claim_summary", "")
                        }
                    }
                    discovered_pairs.append(pair_record)
                    print(f"  [Pass C Contradiction] {pid}: {pair_record['title']} ({speaker})")

    # Update knowledge graph & evolution matrix
    if not dry_run:
        # 1. Update claim evolution matrix
        evolution_payload = {
            "version": "1.0",
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "total_claims": len(all_claims),
            "total_trajectories": len(trajectories),
            "total_contradictions": len(discovered_pairs),
            "trajectories": [
                {
                    "speaker": spk,
                    "topic_anchor": top,
                    "claim_count": len(tr_claims),
                    "claims": tr_claims
                }
                for (spk, top), tr_claims in trajectories.items()
            ],
            "pairs": discovered_pairs,
            "claims": all_claims,
        }
        atomic_json_write(CLAIM_EVOLUTION_FILE, evolution_payload, create_backup=True)

        # 2. Merge into investigative knowledge graph
        if INVESTIGATIVE_KG_FILE.exists():
            try:
                with open(INVESTIGATIVE_KG_FILE, "r", encoding="utf-8") as kg_f:
                    kg_data = json.load(kg_f)
            except Exception:
                kg_data = {"version": "1.0", "contradiction_pairings": []}
        else:
            kg_data = {"version": "1.0", "contradiction_pairings": []}

        merged_kg = merge_contradiction_pairs_into_graph(kg_data, discovered_pairs)
        atomic_json_write(INVESTIGATIVE_KG_FILE, merged_kg, create_backup=True)
        print(f"[✓] Saved {len(discovered_pairs)} contradiction pairings into {INVESTIGATIVE_KG_FILE}")

    return {
        "total_claims": len(all_claims),
        "total_trajectories": len(trajectories),
        "total_contradictions": len(discovered_pairs)
    }


def main():
    parser = argparse.ArgumentParser(description="Build Contradiction & Evolution Matrix across SpacePipe archive")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of episodes scanned (0 for all)")
    parser.add_argument("--episode-ids", nargs="*", help="Specific episode tags to process")
    parser.add_argument("--dry-run", action="store_true", help="Perform extraction without saving files")
    parser.add_argument("--no-resume", action="store_true", help="Force re-extraction ignoring disk cache")
    args = parser.parse_args()

    res = build_matrix(
        limit=args.limit,
        episode_ids=args.episode_ids,
        dry_run=args.dry_run,
        resume=not args.no_resume
    )
    print(f"[✓] Done. Extracted {res['total_claims']} claims. Discovered {res['total_contradictions']} contradiction pairs.")


if __name__ == "__main__":
    main()
