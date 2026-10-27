#!/usr/bin/env python3
"""
scripts/apply_voice_profiles_to_transcripts.py

Retroactively and comprehensively maps enrolled voice profiles (from voice_profiles.json)
and known hosts/speakers to all historical and new Space transcripts.

Updates:
1. public/transcripts/episodes/*.json
2. public/transcripts/transcripts_summary_index.json
3. public/transcripts/transcripts_search_index.json
"""

import os
import sys
import re
import json
import time
import unicodedata
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple, Set

PROFILES_PATH = Path("voice_profiles.json")
SUMMARY_PATH = Path("public/transcripts/transcripts_summary_index.json")
SEARCH_INDEX_PATH = Path("public/transcripts/transcripts_search_index.json")
EPISODES_DIR = Path("public/transcripts/episodes")

CANONICAL_PROFILES = {
    "logan": "Logan",
    "angela": "Angela",
    "oor": "Oor",
    "eric hecker": "Eric Hecker",
    "god sauce": "God Sauce",
    "rose": "Rose",
    "teejay": "teejay",
    "brian": "Brian",
    "consciousculprit": "ConsciousCulprit",
    "linn": "Linn",
    "daz": "Daz",
    "grider": "Grider",
}

SECONDARY_SPEAKERS = {
    "shane": "Shane",
    "tom": "Tom",
    "mary": "Mary",
    "rick doty": "Rick Doty",
    "lana": "Lana",
    "chan": "Chan",
    "parr": "Parr",
    "dougie": "Dougie",
    "dr. snuggles": "Dr. Snuggles",
    "sarah": "Sarah",
}

ALL_KNOWN_SPEAKERS = {**CANONICAL_PROFILES, **SECONDARY_SPEAKERS}

# High speed master pre-filter regex
MASTER_KEYWORD_REGEX = re.compile(
    r'\b(?:logan|angela|oor|eric|god\s*sauce|godsauce|rose|teejay|tj|brian|culprit|conscious|linn|daz|grider|shane|tom|mary|rick|doty|lana|chan|parr|dougie|snuggles|sarah)\b',
    re.I
)


def extract_host_handle(ep_summary: Dict[str, Any]) -> str:
    h = ep_summary.get("host_handle") or ""
    if not h:
        body = ep_summary.get("body") or ""
        m = re.search(r'METADATA::HOST::([^\r\n]+)', body)
        if m:
            h = m.group(1).strip()
        else:
            m2 = re.search(r'\*\*Host:\*\*\s*([^\r\n]+)', body)
            if m2:
                h = m2.group(1).strip()
    if h:
        return unicodedata.normalize('NFKD', h)
    return ""


def build_dialogue_patterns():
    patterns = {}
    for key, canonical in ALL_KNOWN_SPEAKERS.items():
        name_lower = key
        intros = [
            re.compile(rf'\b(?:this\s+is|i\'m|it\'s|my\s+name\s+is)\s+{re.escape(name_lower)}\b', re.I),
            re.compile(rf'\b{re.escape(name_lower)}\s+(?:here|speaking)\b', re.I)
        ]
        addresses = [
            re.compile(rf'\b(?:go\s+ahead|hey|hello|welcome|thanks|thank\s+you)\s+{re.escape(name_lower)}\b', re.I),
            re.compile(rf'\b{re.escape(name_lower)},?\s+(?:what\s+do\s+you|what\s+are\s+your|what\s+is\s+your|go\s+ahead|you\s+there|you\'re\s+on\s+mute|unmute|talk)\b', re.I),
            re.compile(rf'\bi\s+agree\s+with\s+(?:you,?\s+)?{re.escape(name_lower)}\b', re.I),
            re.compile(rf'\blet\s+{re.escape(name_lower)}\s+(?:talk|speak)\b', re.I),
        ]
        exclude = None
        if name_lower == "rose":
            exclude = re.compile(r'\b(?:amber\s+rose|rose\s+prairie|rose\s+bowl|a\s+rose\s+by\s+any|guns\s+n\s+roses|rose\s+tinted|rose-colored)\b', re.I)
        elif name_lower == "god sauce":
            intros.append(re.compile(r'\b(?:this\s+is|i\'m|it\'s)\s+godsauce\b', re.I))
            addresses.append(re.compile(r'\b(?:go\s+ahead|hey|hello)\s+godsauce\b', re.I))
        elif name_lower == "consciousculprit":
            intros.append(re.compile(r'\b(?:this\s+is|i\'m|it\'s)\s+(?:conscious\s+culprit|culprit)\b', re.I))
            addresses.append(re.compile(r'\b(?:go\s+ahead|hey|hello|what\'s\s+up)\s+(?:conscious\s+culprit|culprit)\b', re.I))
        elif name_lower == "teejay":
            intros.append(re.compile(r'\b(?:this\s+is|i\'m|it\'s)\s+tj\b', re.I))
            addresses.append(re.compile(r'\b(?:go\s+ahead|hey|hello|unmute)\s+tj\b', re.I))
        elif name_lower == "eric hecker":
            intros.append(re.compile(r'\b(?:this\s+is|i\'m|it\'s)\s+eric\b', re.I))
            addresses.append(re.compile(r'\b(?:go\s+ahead|hey|welcome|what\s+do\s+you\s+think)\s+eric\b', re.I))

        patterns[canonical] = {
            "key": key,
            "intros": intros,
            "addresses": addresses,
            "exclude": exclude,
        }
    return patterns


def analyze_episode_speakers(
    ep_data: Dict[str, Any],
    ep_summary: Dict[str, Any],
    patterns: Dict[str, Any]
) -> Dict[str, str]:
    segs = ep_data.get("segments", [])
    if not segs:
        return {}

    existing_speakers = set(s.get("speaker", "") for s in segs)
    generic_speakers = [s for s in existing_speakers if s.lower().startswith("speaker")]
    if not generic_speakers:
        return {}

    spk_durations: Dict[str, float] = {}
    for s in segs:
        spk = s.get("speaker", "")
        dur = max(0.5, float(s.get("end", 0) or 0) - float(s.get("start", 0) or 0))
        spk_durations[spk] = spk_durations.get(spk, 0.0) + dur

    sorted_by_duration = sorted(spk_durations.items(), key=lambda x: -x[1])
    mappings: Dict[str, str] = {}

    host_handle = extract_host_handle(ep_summary).lower()
    title = (ep_summary.get("title") or ep_data.get("title") or "").lower()

    # --- Phase 1: Host Resolution ---
    if "logan" not in [s.lower() for s in existing_speakers]:
        is_logan_host = (
            "logan" in host_handle or
            "loganblack" in host_handle or
            host_handle == "loganblack" or
            "logan black" in host_handle
        )
        if is_logan_host:
            for spk_cand, dur in sorted_by_duration:
                if spk_cand in generic_speakers:
                    mappings[spk_cand] = "Logan"
                    generic_speakers.remove(spk_cand)
                    break

    if "angela" not in [s.lower() for s in existing_speakers]:
        is_angela_host = (
            "angelamaggard3" in host_handle or
            "angela" in host_handle or
            "txrrxstrxxl" in host_handle
        )
        if is_angela_host:
            for spk_cand, dur in sorted_by_duration:
                if spk_cand in generic_speakers:
                    mappings[spk_cand] = "Angela"
                    generic_speakers.remove(spk_cand)
                    break

    if "oor" not in [s.lower() for s in existing_speakers]:
        if "king oor" in host_handle or (host_handle == "txrrxstrxxl" and "Angela" in mappings.values()):
            for spk_cand, dur in sorted_by_duration:
                if spk_cand in generic_speakers:
                    mappings[spk_cand] = "Oor"
                    generic_speakers.remove(spk_cand)
                    break

    if "eric hecker" not in [s.lower() for s in existing_speakers] and "eric" not in [s.lower() for s in existing_speakers]:
        is_eric_host = (
            "eric j. hecker" in host_handle or
            "decipheringtv" in host_handle or
            "deciphering.tv" in host_handle or
            (host_handle.startswith("eric") and "hecker" in host_handle)
        )
        if is_eric_host:
            for spk_cand, dur in sorted_by_duration:
                if spk_cand in generic_speakers:
                    mappings[spk_cand] = "Eric Hecker"
                    generic_speakers.remove(spk_cand)
                    break

    # --- Phase 2: High-Speed Dialogue Heuristics ---
    if generic_speakers:
        cand_indices = [
            i for i, s in enumerate(segs)
            if MASTER_KEYWORD_REGEX.search(s.get("text", ""))
        ]

        if cand_indices:
            for canonical, pat in patterns.items():
                if canonical in mappings.values() or any(s.lower() == canonical.lower() for s in existing_speakers):
                    continue

                exclude = pat["exclude"]
                intros = pat["intros"]
                addresses = pat["addresses"]
                title_bonus = 8.0 if pat["key"] in title else 0.0

                scores: Dict[str, float] = {}

                for i in cand_indices:
                    s = segs[i]
                    txt = s.get("text", "")
                    spk = s.get("speaker", "")
                    if exclude and exclude.search(txt):
                        continue

                    if any(p.search(txt) for p in intros) and spk in generic_speakers:
                        scores[spk] = scores.get(spk, 0.0) + 16.0

                    if any(p.search(txt) for p in addresses):
                        if i + 1 < len(segs):
                            nspk = segs[i + 1].get("speaker", "")
                            if nspk in generic_speakers and nspk != spk:
                                scores[nspk] = scores.get(nspk, 0.0) + 12.0
                        if i > 0:
                            pspk = segs[i - 1].get("speaker", "")
                            if pspk in generic_speakers and pspk != spk:
                                scores[pspk] = scores.get(pspk, 0.0) + 8.0

                if scores:
                    sorted_scores = sorted(scores.items(), key=lambda x: -x[1])
                    best_spk, best_score = sorted_scores[0]
                    total_score = best_score + title_bonus
                    runner_up = sorted_scores[1][1] if len(sorted_scores) > 1 else 0.0

                    if total_score >= 16.0 and (total_score - runner_up >= 6.0 or total_score >= 24.0):
                        if best_spk in generic_speakers:
                            mappings[best_spk] = canonical
                            generic_speakers.remove(best_spk)

    return mappings


def main():
    dry_run = "--dry-run" in sys.argv
    print(f"============================================================")
    print(f"  SPACEPIPE HIGH-SPEED ARCHIVE VOICE PROFILE RELABELER")
    print(f"  Mode: {'DRY RUN (Preview Only)' if dry_run else 'LIVE UPDATE'}")
    print(f"============================================================")

    if not SUMMARY_PATH.exists():
        print(f"[!] Summary index not found: {SUMMARY_PATH}")
        sys.exit(1)

    t0 = time.time()
    with open(SUMMARY_PATH, "r", encoding="utf-8") as f:
        summary_list = json.load(f)

    summary_map = {item.get("release_tag"): item for item in summary_list if item.get("release_tag")}
    patterns = build_dialogue_patterns()

    total_episodes_checked = 0
    total_episodes_updated = 0
    total_turns_updated = 0
    speaker_match_stats: Dict[str, int] = {}
    all_tag_mappings: Dict[str, Dict[str, str]] = {}

    for tag, ep_summary in summary_map.items():
        ep_file = EPISODES_DIR / f"{tag}.json"
        if not ep_file.exists():
            continue

        total_episodes_checked += 1
        try:
            with open(ep_file, "r", encoding="utf-8") as f:
                ep_data = json.load(f)
        except Exception:
            continue

        mappings = analyze_episode_speakers(ep_data, ep_summary, patterns)
        if not mappings:
            continue

        all_tag_mappings[tag] = mappings
        total_episodes_updated += 1

        segs = ep_data.get("segments", [])
        ep_turns = 0
        for s in segs:
            old_spk = s.get("speaker")
            if old_spk in mappings:
                s["speaker"] = mappings[old_spk]
                ep_turns += 1

        total_turns_updated += ep_turns
        for new_name in mappings.values():
            speaker_match_stats[new_name] = speaker_match_stats.get(new_name, 0) + 1

        distinct_speakers = sorted(list({s.get("speaker") for s in segs if s.get("speaker")}))
        ep_data["speakers"] = distinct_speakers
        ep_summary["speakers"] = distinct_speakers

        if not dry_run:
            with open(ep_file, "w", encoding="utf-8") as f:
                json.dump(ep_data, f, ensure_ascii=False, indent=2)

    elapsed = time.time() - t0
    print(f"\n[✓] Checked {total_episodes_checked} episodes in {elapsed:.2f}s.")
    print(f"[✓] Identified and mapped profiles in {total_episodes_updated} episodes ({total_turns_updated} turns updated).")
    print(f"\nBreakdown of identified speakers across episodes:")
    for spk, count in sorted(speaker_match_stats.items(), key=lambda x: -x[1]):
        print(f"    • {spk:18}: {count} episodes")

    if not dry_run and total_episodes_updated > 0:
        with open(SUMMARY_PATH, "w", encoding="utf-8") as f:
            json.dump(list(summary_map.values()), f, ensure_ascii=False, indent=2)
        print(f"\n[✓] Successfully updated {SUMMARY_PATH}")

        if SEARCH_INDEX_PATH.exists():
            print(f"[*] Updating {SEARCH_INDEX_PATH}...")
            t_s = time.time()
            try:
                with open(SEARCH_INDEX_PATH, "r", encoding="utf-8") as f:
                    search_index = json.load(f)

                search_turns_updated = 0
                for ep_entry in search_index:
                    tag = ep_entry.get("release_tag")
                    if tag in all_tag_mappings:
                        tag_map = all_tag_mappings[tag]
                        ep_entry["speakers"] = summary_map[tag]["speakers"]
                        for seg in ep_entry.get("segments", []):
                            old_spk = seg.get("speaker")
                            if old_spk in tag_map:
                                seg["speaker"] = tag_map[old_spk]
                                search_turns_updated += 1

                with open(SEARCH_INDEX_PATH, "w", encoding="utf-8") as f:
                    json.dump(search_index, f, ensure_ascii=False)
                print(f"[✓] Updated {search_turns_updated} turns in {SEARCH_INDEX_PATH} in {time.time() - t_s:.2f}s")
            except Exception as e:
                print(f"[!] Warning updating search index: {e}")

    print("\n[🎉] Done!")


if __name__ == "__main__":
    main()
