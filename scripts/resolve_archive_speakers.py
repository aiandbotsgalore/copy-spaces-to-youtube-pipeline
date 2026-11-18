#!/usr/bin/env python3
"""
scripts/resolve_archive_speakers.py

Automated Semantic Mic-Handoff Speaker Resolution with Biometric Veto & Dynamic Read-Only Overlay.
Adheres strictly to the 100% Read-Only Episode Transcripts Invariant:
- public/transcripts/episodes/*.json are NEVER modified in-place.
- Speaker candidate resolutions are stored in public/transcripts/speaker_candidates.json.
- Effective speaker names are resolved dynamically via CandidateOverlay.
- public/transcripts/transcripts_summary_index.json is synced atomically with effective rosters.
"""

import os
import re
import sys
import json
import math
import copy
import time
import random
import asyncio
import argparse
import urllib.request
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple, Set

EPISODES_DIR = Path("public/transcripts/episodes")
CANDIDATES_FILE = Path("public/transcripts/speaker_candidates.json")
SUMMARY_INDEX_FILE = Path("public/transcripts/transcripts_summary_index.json")
VOICE_PROFILES_FILE = Path("voice_profiles.json")
CHECKPOINT_DIR = Path("public/transcripts/cache/checkpoints")

GENERIC_SPEAKER_PATTERN = re.compile(
    r"^(?:speaker|caller|guest|host|unknown|unidentified|unassigned)(?:[\s_#-]*\d+)?$",
    re.IGNORECASE
)

BACKCHANNEL_PATTERN = re.compile(
    r"^(?:yeah|yep|nope|no|yes|uh-huh|mhm|right|okay|ok|sure|oh|wow|cool)\b[\.?!]?$",
    re.IGNORECASE
)

VOCATIVE_PATTERNS = [
    re.compile(r"\b(?:go\s+ahead|welcome|unmute|take\s+the\s+mic|you\'re\s+up|bring\s+up)\s+([A-Z][a-z]{2,15})\b", re.IGNORECASE),
    re.compile(r"\b(?:hey|hi|hello|thanks|thank\s+you)\s+([A-Z][a-z]{2,15})\b", re.IGNORECASE),
    re.compile(r"\bthis\s+is\s+([A-Z][a-z]{2,15})\b", re.IGNORECASE),
    re.compile(r"\bi\'m\s+([A-Z][a-z]{2,15})\b", re.IGNORECASE),
    re.compile(r"\b([A-Z][a-z]{2,15}),?\s+(?:what\s+do\s+you\s+think|your\s+take|you\s+there)\b", re.IGNORECASE),
]


def is_generic_speaker(name: str) -> bool:
    """Returns True if the speaker name is an unassigned generic label or empty."""
    s = str(name or "").strip()
    if not s:
        return True
    return bool(GENERIC_SPEAKER_PATTERN.match(s))


def atomic_json_write(target_path: Path, data: Any, create_backup: bool = False) -> None:
    """
    Cross-platform atomic JSON write using same-directory temp file, fsync, and os.replace.
    Works reliably on both Windows and POSIX systems.
    """
    target = Path(target_path).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    temp_file = target.parent / f".tmp_{target.name}_{os.getpid()}_{random.randint(1000, 9999)}"

    with open(temp_file, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.flush()
        os.fsync(f.fileno())

    if create_backup and target.exists():
        bak_file = target.parent / f"{target.name}.bak"
        try:
            if bak_file.exists():
                bak_file.unlink()
            os.replace(target, bak_file)
        except Exception:
            pass

    os.replace(temp_file, target)


def cosine_similarity(v1: List[float], v2: List[float]) -> float:
    """Computes cosine similarity between two float vectors."""
    if not v1 or not v2 or len(v1) != len(v2):
        return 0.0
    dot = sum(a * b for a, b in zip(v1, v2))
    norm1 = math.sqrt(sum(a * a for a in v1))
    norm2 = math.sqrt(sum(b * b for b in v2))
    if norm1 <= 0.0 or norm2 <= 0.0:
        return 0.0
    return dot / (norm1 * norm2)


def check_biometric_veto(
    cluster_emb: List[float],
    profile_emb: List[float],
    threshold: float = 0.38
) -> Tuple[bool, float]:
    """
    Checks if a cluster embedding matches an enrolled profile embedding.
    Returns (acoustic_conflict: bool, similarity: float).
    If similarity < threshold, acoustic_conflict is True.
    """
    if not cluster_emb or not profile_emb:
        return False, 1.0  # Cannot veto if embeddings missing
    sim = cosine_similarity(cluster_emb, profile_emb)
    conflict = sim < threshold
    return conflict, sim


class CandidateOverlay:
    """
    Two-Tier Read-Only Overlay Hydration engine.
    Precedence: OverlayBySegment(ep, seg) || OverlayByCluster(ep, raw) || raw_speaker
    Status precedence:
    - 'human_verified': hydrates unconditionally (allowing manual UI overrides).
    - 'auto_approved': hydrates only when confidence >= 0.85 and acoustic_conflict is False.
    - 'pending' or 'rejected': never hydrated (falls back).
    """
    def __init__(self, data: Optional[Dict[str, Any]] = None):
        self.segment_map: Dict[Tuple[str, int], Dict[str, Any]] = {}
        self.cluster_map: Dict[Tuple[str, str], Dict[str, Any]] = {}
        self.raw_data = data or {"candidates": []}
        self._build_index()

    def _build_index(self):
        self.segment_map.clear()
        self.cluster_map.clear()
        for cand in self.raw_data.get("candidates", []):
            ep_id = cand.get("episode_id")
            if not ep_id:
                continue
            scope = cand.get("scope", "cluster")
            raw_spk = cand.get("raw_speaker")
            if scope == "segment":
                seg_idx = cand.get("segment_idx")
                if seg_idx is not None:
                    self.segment_map[(ep_id, int(seg_idx))] = cand
            else:
                if raw_spk:
                    self.cluster_map[(ep_id, raw_spk)] = cand

    def get_effective_speaker(self, episode_id: str, raw_speaker: str, segment_idx: Optional[int] = None) -> str:
        segment = self.segment_map.get((episode_id, segment_idx)) if segment_idx is not None else None
        cluster = self.cluster_map.get((episode_id, raw_speaker))
        # Human attribution outranks any automatic prediction, regardless of scope.
        for candidate in (segment, cluster):
            if candidate and candidate.get("status") == "human_verified":
                return candidate["resolved_name"]
        for candidate in (segment, cluster):
            if candidate and self._is_active(candidate):
                return candidate["resolved_name"]
        return raw_speaker

    def _is_active(self, cand: Dict[str, Any]) -> bool:
        status = cand.get("status")
        if status == "human_verified":
            return True
        if status == "auto_approved":
            conf = float(cand.get("confidence", 0.0))
            conflict = bool(cand.get("acoustic_conflict", False))
            return (conf >= 0.85 and not conflict
                    and cand.get("attribution_method") == "acoustic"
                    and cand.get("acoustic_verified") is True)
        return False

    def add_or_update(self, cand: Dict[str, Any]) -> None:
        cands = self.raw_data.setdefault("candidates", [])
        # Check matching ID or (ep, raw_spk, seg_idx)
        cid = cand.get("id")
        scope = cand.get("scope", "cluster")
        ep_id = cand.get("episode_id")
        raw_spk = cand.get("raw_speaker")
        seg_idx = cand.get("segment_idx")

        replaced = False
        for i, existing in enumerate(cands):
            same_target = ((cid and existing.get("id") == cid) or
                           (existing.get("episode_id") == ep_id and existing.get("raw_speaker") == raw_spk
                            and existing.get("scope", "cluster") == scope
                            and (scope != "segment" or existing.get("segment_idx") == seg_idx)))
            if same_target and existing.get("status") == "human_verified" and cand.get("status") != "human_verified":
                return
            if cid and existing.get("id") == cid:
                cands[i] = cand
                replaced = True
                break
            if existing.get("episode_id") == ep_id and existing.get("raw_speaker") == raw_spk:
                if scope == "segment" and existing.get("segment_idx") == seg_idx:
                    cands[i] = cand
                    replaced = True
                    break
                elif scope == "cluster" and existing.get("scope") == "cluster":
                    cands[i] = cand
                    replaced = True
                    break
        if not replaced:
            cands.append(cand)
        self._build_index()


def hydrate_effective_speaker(
    overlay: CandidateOverlay,
    episode_id: str,
    raw_speaker: str,
    segment_idx: Optional[int] = None
) -> str:
    """Convenience helper to hydrate the effective speaker via a CandidateOverlay instance."""
    return overlay.get_effective_speaker(episode_id, raw_speaker, segment_idx=segment_idx)



def extract_cluster_envelopes(
    episode_id: str,
    segments: List[Dict[str, Any]],
    target_speaker: str,
    max_envelopes: int = 5
) -> List[Dict[str, Any]]:
    """
    Extracts up to max_envelopes high-signal conversational envelopes for target_speaker.
    Each envelope contains at least +/- 5 non-backchannel turns covering >= [-45s, +15s]
    around vocative cues or substantive turns.
    """
    indices = [i for i, s in enumerate(segments) if s.get("speaker") == target_speaker]
    if not indices:
        return []

    scored_indices: List[Tuple[float, int]] = []
    for idx in indices:
        seg = segments[idx]
        txt = seg.get("text", "")
        dur = float(seg.get("end", 0.0)) - float(seg.get("start", 0.0))

        # Check vocative cue in this turn or preceding turn
        score = 1.0
        if dur >= 3.0:
            score += 2.0
        if dur >= 8.0:
            score += 2.0

        # Check vocatives in current turn
        for p in VOCATIVE_PATTERNS:
            if p.search(txt):
                score += 5.0
                break

        # Check vocative in previous turn
        if idx > 0:
            prev_txt = segments[idx - 1].get("text", "")
            for p in VOCATIVE_PATTERNS:
                if p.search(prev_txt):
                    score += 6.0
                    break

        # Entry turn boost
        if idx == indices[0]:
            score += 3.0

        scored_indices.append((score, idx))

    scored_indices.sort(key=lambda x: x[0], reverse=True)
    selected_indices = [idx for _, idx in scored_indices[:max_envelopes]]
    selected_indices.sort()

    envelopes = []
    for anchor_idx in selected_indices:
        anchor_seg = segments[anchor_idx]
        anchor_start = float(anchor_seg.get("start", 0.0))
        anchor_end = float(anchor_seg.get("end", anchor_start))

        # Collect turns within [-45s, +15s] with at least +/- 5 turns
        start_idx = anchor_idx
        while start_idx > 0:
            s = segments[start_idx - 1]
            t_start = float(s.get("start", 0.0))
            if anchor_start - t_start > 45.0 and anchor_idx - start_idx >= 5:
                break
            start_idx -= 1

        end_idx = anchor_idx
        while end_idx < len(segments) - 1:
            s = segments[end_idx + 1]
            t_end = float(s.get("end", 0.0))
            if t_end - anchor_end > 15.0 and end_idx - anchor_idx >= 5:
                break
            end_idx += 1

        envelope_turns = []
        for i in range(start_idx, end_idx + 1):
            s = segments[i]
            txt = s.get("text", "").strip()
            # Mark backchannels
            is_bc = bool(BACKCHANNEL_PATTERN.match(txt)) and (float(s.get("end", 0.0)) - float(s.get("start", 0.0))) < 2.0
            envelope_turns.append({
                "segment_idx": i,
                "start": float(s.get("start", 0.0)),
                "end": float(s.get("end", 0.0)),
                "speaker": s.get("speaker", "Speaker"),
                "text": txt,
                "is_backchannel": is_bc
            })

        envelopes.append({
            "episode_id": episode_id,
            "target_speaker": target_speaker,
            "anchor_idx": anchor_idx,
            "turns": envelope_turns,
        })

    return envelopes


def format_envelope_for_prompt(envelopes: List[Dict[str, Any]], title: str, description: str) -> str:
    """Formats selected envelopes into a structured prompt block for Mercury-3."""
    lines = [
        f"Episode Title: {title}",
        f"Episode Description: {description}",
        "\n--- CONVERSATIONAL AUDIO ENVELOPES ---"
    ]
    for i, env in enumerate(envelopes):
        lines.append(f"\n[Envelope {i + 1} - Target Speaker: {env['target_speaker']}]")
        for t in env["turns"]:
            prefix = "(backchannel) " if t.get("is_backchannel") else ""
            lines.append(f"[{t['start']:.1f}s] {prefix}{t['speaker']}: {t['text']}")
    return "\n".join(lines)


def resolve_cluster_with_context(
    llm_response: Dict[str, Any],
    envelope_text: str,
    title: str = "",
    description: str = "",
    known_aliases: Optional[Dict[str, List[str]]] = None,
    existing_episode_assignments: Optional[Set[str]] = None,
    acoustic_conflict: bool = False,
) -> Dict[str, Any]:
    """
    Applies strict confidence calibration, title-inference caps, and split-cluster checks.
    """
    raw_name = llm_response.get("resolved_name")
    resolved_name = str(raw_name).strip() if raw_name else None
    confidence = float(llm_response.get("confidence", 0.0))
    evidence_quote = llm_response.get("evidence_quote")
    handoff_type = llm_response.get("handoff_type", "conversational_reference")

    if not resolved_name or is_generic_speaker(resolved_name):
        return {
            "resolved_name": None,
            "confidence": 0.0,
            "status": "pending",
            "evidence_quote": None,
            "handoff_type": "unidentified",
            "potential_split_cluster": False,
            "acoustic_conflict": False,
        }

    # Normalize name against known aliases
    aliases = [resolved_name.lower()]
    if known_aliases and resolved_name in known_aliases:
        aliases.extend([a.lower() for a in known_aliases[resolved_name]])

    # Check if resolved_name appears in envelope text
    env_lower = envelope_text.lower()
    name_in_envelope = any(a in env_lower for a in aliases)

    # Title-inference guard: if name ONLY in title/description and not in envelope text
    if not name_in_envelope:
        title_desc = (title + " " + description).lower()
        if any(a in title_desc for a in aliases):
            confidence = min(confidence, 0.65)
            handoff_type = "title_inference_only"
        else:
            # Name appears nowhere in provided text! Hallucination guard
            confidence = min(confidence, 0.40)

    # Split-cluster check: is name already assigned to another cluster in this episode?
    potential_split = False
    if existing_episode_assignments and resolved_name in existing_episode_assignments:
        potential_split = True

    # Determine status
    if acoustic_conflict:
        status = "pending"
    elif potential_split:
        status = "pending"
    elif confidence >= 0.85 and handoff_type != "title_inference_only":
        status = "pending"  # Conversational evidence requires human review.
    else:
        status = "pending"

    return {
        "resolved_name": resolved_name,
        "confidence": round(confidence, 2),
        "status": status,
        "evidence_quote": evidence_quote,
        "handoff_type": handoff_type,
        "potential_split_cluster": potential_split,
        "acoustic_conflict": acoustic_conflict,
    }


def call_mercury_speaker_schema(prompt_text: str, api_key: str, max_retries: int = 4) -> Optional[Dict[str, Any]]:
    """Calls Inception Labs Mercury-3 with strict JSON schema and exponential backoff."""
    url = os.environ.get("INCEPTION_BASE_URL", "https://api.inceptionlabs.ai/v1") + "/chat/completions"
    payload = {
        "model": "mercury-3",
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are the SpacePipe Lead Audio Archivist. Analyze conversational handoff cues "
                    "to determine the real identity of the target generic speaker (e.g. Speaker 1). "
                    "Examine vocative cues ('welcome X', 'go ahead X'), greetings, and self-introductions. "
                    "If the speaker identity is clear, return their real name and confidence (0.0 to 1.0). "
                    "If identity cannot be determined with certainty, return resolved_name as null. "
                    "Return strict JSON matching the schema."
                )
            },
            {"role": "user", "content": prompt_text}
        ],
        "max_tokens": 512,
        "temperature": 0.0,
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "speaker_cluster_resolution",
                "strict": True,
                "schema": {
                    "type": "object",
                    "required": ["resolved_name", "confidence", "evidence_quote", "handoff_type", "reason"],
                    "properties": {
                        "resolved_name": {"type": ["string", "null"]},
                        "confidence": {"type": "number"},
                        "evidence_quote": {"type": ["string", "null"]},
                        "handoff_type": {
                            "type": "string",
                            "enum": [
                                "direct_self_intro",
                                "host_handoff",
                                "panel_greeting",
                                "conversational_reference",
                                "title_inference_only",
                                "unidentified"
                            ]
                        },
                        "reason": {"type": "string"}
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
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                content = data.get("choices", [{}])[0].get("message", {}).get("content")
                if content:
                    parsed = json.loads(content)
                    if isinstance(parsed, list):
                        return parsed[0] if (parsed and isinstance(parsed[0], dict)) else None
                    elif isinstance(parsed, dict):
                        return parsed
                    return None
        except Exception as e:
            if attempt == max_retries - 1:
                return None
            jitter = random.uniform(0.1, 0.5)
            time.sleep(delay + jitter)
            delay *= 2.0

    return None


def sync_summary_index_roster(
    summary_index: List[Dict[str, Any]],
    episode_id: str,
    raw_segments: List[Dict[str, Any]],
    overlay: CandidateOverlay
) -> bool:
    """
    Recomputes the effective speaker roster for episode_id and updates summary_index.
    Returns True if the roster changed.
    """
    ep_entry = next((e for e in summary_index if e.get("release_tag") == episode_id), None)
    if not ep_entry:
        return False

    effective_speakers: Set[str] = set()
    for idx, seg in enumerate(raw_segments):
        raw_spk = seg.get("speaker", "Speaker")
        eff = overlay.get_effective_speaker(episode_id, raw_spk, segment_idx=idx)
        if eff and not is_generic_speaker(eff):
            effective_speakers.add(eff)
        elif raw_spk:
            effective_speakers.add(raw_spk)

    new_roster = sorted(list(effective_speakers))
    old_roster = sorted(list(ep_entry.get("speakers", [])))

    if new_roster != old_roster:
        ep_entry["speakers"] = new_roster
        return True
    return False


def load_voice_profiles() -> Dict[str, Dict[str, Any]]:
    """Loads enrolled voice profiles from voice_profiles.json."""
    if not VOICE_PROFILES_FILE.exists():
        return {}
    try:
        with open(VOICE_PROFILES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get("profiles", {})
    except Exception:
        return {}


def load_api_key() -> Optional[str]:
    """Loads INCEPTION_API_KEY from environment or .env.local."""
    k = os.environ.get("INCEPTION_API_KEY")
    if k:
        return k.strip()
    for fname in [".env.local", ".env"]:
        p = Path(fname)
        if p.exists():
            try:
                for line in p.read_text(encoding="utf-8").splitlines():
                    if line.startswith("INCEPTION_API_KEY="):
                        return line.split("=", 1)[1].strip().strip('"').strip("'")
            except Exception:
                pass
    return None


def process_archive_speakers(
    limit: int = 0,
    episode_ids: Optional[List[str]] = None,
    dry_run: bool = False,
    api_key: Optional[str] = None
) -> Dict[str, Any]:
    """
    Processes historical episodes, discovers unassigned generic speaker clusters,
    resolves them via Mercury-3, applies biometric check, and writes the overlay.
    """
    if not api_key:
        api_key = load_api_key()

    profiles = load_voice_profiles()
    known_aliases: Dict[str, List[str]] = {}
    for name, pdata in profiles.items():
        known_aliases[name] = [name]

    # Load existing candidates overlay
    if CANDIDATES_FILE.exists():
        try:
            with open(CANDIDATES_FILE, "r", encoding="utf-8") as f:
                candidates_json = json.load(f)
        except Exception:
            candidates_json = {"candidates": []}
    else:
        candidates_json = {"candidates": []}

    overlay = CandidateOverlay(candidates_json)

    # Load summary index
    summary_index = []
    if SUMMARY_INDEX_FILE.exists():
        try:
            with open(SUMMARY_INDEX_FILE, "r", encoding="utf-8") as f:
                summary_index = json.load(f)
        except Exception:
            summary_index = []

    ep_files = sorted(list(EPISODES_DIR.glob("*.json")))
    if episode_ids:
        target_ids = set(episode_ids)
        ep_files = [f for f in ep_files if f.stem in target_ids]
    if limit > 0:
        ep_files = ep_files[:limit]

    print(f"[*] Scanning {len(ep_files)} episode transcript files...")
    total_resolved = 0
    episodes_modified: Set[str] = set()

    for ep_file in ep_files:
        ep_id = ep_file.stem
        try:
            with open(ep_file, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            continue

        segments = data.get("segments", [])
        title = data.get("title", "")
        desc = data.get("body", "")

        # Find all generic clusters in this episode
        cluster_speakers = set()
        for s in segments:
            spk = s.get("speaker", "")
            if is_generic_speaker(spk):
                cluster_speakers.add(spk)

        if not cluster_speakers:
            continue

        existing_assignments = set(
            overlay.get_effective_speaker(ep_id, s.get("speaker", ""), idx)
            for idx, s in enumerate(segments)
            if not is_generic_speaker(overlay.get_effective_speaker(ep_id, s.get("speaker", ""), idx))
        )

        for raw_spk in sorted(list(cluster_speakers)):
            # Skip if already auto_approved or human_verified in overlay
            existing_cand = overlay.cluster_map.get((ep_id, raw_spk))
            if existing_cand and existing_cand.get("status") in ("auto_approved", "human_verified"):
                continue

            envelopes = extract_cluster_envelopes(ep_id, segments, raw_spk, max_envelopes=4)
            if not envelopes:
                continue

            envelope_text = format_envelope_for_prompt(envelopes, title, desc)

            # Call Mercury-3 if API key available
            llm_res = None
            if api_key:
                llm_res = call_mercury_speaker_schema(envelope_text, api_key)

            if isinstance(llm_res, list):
                llm_res = llm_res[0] if (llm_res and isinstance(llm_res[0], dict)) else None

            if not llm_res or not isinstance(llm_res, dict) or not llm_res.get("resolved_name"):
                continue

            # Check biometric veto if profile exists
            res_name = llm_res.get("resolved_name")
            acoustic_conflict = False
            if res_name in profiles:
                prof_emb = profiles[res_name].get("embedding")
                # Look for per-episode voiceprint sidecar
                vp_sidecar = ep_file.parent.parent / f"{ep_id}_voiceprints.json"
                if vp_sidecar.exists():
                    try:
                        with open(vp_sidecar, "r", encoding="utf-8") as vf:
                            vp_data = json.load(vf)
                            cluster_emb = vp_data.get("clusters", {}).get(raw_spk)
                            if cluster_emb and prof_emb:
                                acoustic_conflict, _ = check_biometric_veto(cluster_emb, prof_emb)
                    except Exception:
                        pass

            resolved_data = resolve_cluster_with_context(
                llm_response=llm_res,
                envelope_text=envelope_text,
                title=title,
                description=desc,
                known_aliases=known_aliases,
                existing_episode_assignments=existing_assignments,
                acoustic_conflict=acoustic_conflict
            )

            if resolved_data.get("resolved_name"):
                cand_record = {
                    "id": f"cand_{ep_id}_{raw_spk}".replace(" ", "_"),
                    "scope": "cluster",
                    "episode_id": ep_id,
                    "raw_speaker": raw_spk,
                    "resolved_name": resolved_data["resolved_name"],
                    "status": resolved_data["status"],
                    "confidence": resolved_data["confidence"],
                    "acoustic_conflict": resolved_data["acoustic_conflict"],
                    "evidence_quote": resolved_data["evidence_quote"],
                    "handoff_type": resolved_data["handoff_type"],
                    "potential_split_cluster": resolved_data["potential_split_cluster"],
                    "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                }
                overlay.add_or_update(cand_record)
                total_resolved += 1
                episodes_modified.add(ep_id)
                print(f"  [+] {ep_id} {raw_spk} -> {resolved_data['resolved_name']} ({resolved_data['status']}, conf: {resolved_data['confidence']})")

        # Sync summary index for modified episodes
        if ep_id in episodes_modified and not dry_run and summary_index:
            sync_summary_index_roster(summary_index, ep_id, segments, overlay)

    if not dry_run:
        # Atomic write of candidate overlay
        atomic_json_write(CANDIDATES_FILE, overlay.raw_data, create_backup=True)
        # Atomic write of summary index
        if summary_index and episodes_modified:
            atomic_json_write(SUMMARY_INDEX_FILE, summary_index, create_backup=True)
        print(f"[✓] Saved {len(overlay.raw_data.get('candidates', []))} candidates to {CANDIDATES_FILE}")

    return {
        "episodes_scanned": len(ep_files),
        "total_resolved": total_resolved,
        "episodes_modified": len(episodes_modified),
    }


def main():
    parser = argparse.ArgumentParser(description="Semantic mic-handoff speaker resolution with dynamic overlay")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of episodes scanned (0 for all)")
    parser.add_argument("--episode-ids", nargs="*", help="Specific episode tags to process")
    parser.add_argument("--dry-run", action="store_true", help="Perform extraction without writing files")
    args = parser.parse_args()

    res = process_archive_speakers(
        limit=args.limit,
        episode_ids=args.episode_ids,
        dry_run=args.dry_run
    )
    print(f"[✓] Done. Scanned {res['episodes_scanned']} episodes. Resolved {res['total_resolved']} clusters.")


if __name__ == "__main__":
    main()
