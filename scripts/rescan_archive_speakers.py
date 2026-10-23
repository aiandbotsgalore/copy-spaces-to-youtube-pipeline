#!/usr/bin/env python3
"""
scripts/rescan_archive_speakers.py

Retroactively scans historical Twitter Space transcripts to identify and properly label
an enrolled speaker (e.g. Rose) across all previous episodes for 100% free.

Supports two complementary scan engines:
1. Acoustic Voiceprint Matcher (Tier 0):
   Streams small (5-10s) audio clips via HTTP byte-range requests directly from GitHub release MP3s.
   Computes 192-dim SpeechBrain ECAPA-TDNN embeddings and compares against voice_profiles.json.
2. Conversational Hand-off Matcher (Tier 1):
   Analyzes dialogue transitions (self-introductions, direct mic hand-offs, e.g. "Go ahead Rose")
   to identify generic speaker IDs without audio.
"""

import os
import sys
import re
import json
import time
import shutil
import argparse
import subprocess
from pathlib import Path
from typing import List, Dict, Any, Optional

PROFILES_PATH = Path("voice_profiles.json")
SUMMARY_PATH = Path("public/transcripts/transcripts_summary_index.json")
EPISODES_DIR = Path("public/transcripts/episodes")


def find_ffmpeg() -> str:
    cand = shutil.which("ffmpeg")
    if cand:
        return cand
    for p in [
        r"C:\Program Files\ShareX\ffmpeg.exe",
        r"C:\Users\Logan\Downloads\ytdlp-gui-windows-64\ffmpeg.exe",
        r"C:\Users\Logan\Documents\twitterspacedownloader\ffmpeg.exe",
    ]:
        if os.path.exists(p):
            return p
    return "ffmpeg"


FFMPEG_EXE = find_ffmpeg()


def load_profile_embedding(speaker_name: str) -> Optional[List[float]]:
    if not PROFILES_PATH.exists():
        return None
    try:
        with open(PROFILES_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        profile = data.get("profiles", {}).get(speaker_name)
        if profile and isinstance(profile.get("embedding"), list) and len(profile["embedding"]) == 192:
            return profile["embedding"]
    except Exception as e:
        print(f"[!] Error reading voice profile for {speaker_name}: {e}")
    return None


def slice_candidate_clip(audio_url: str, start_sec: float, dur_sec: float, out_wav: str) -> bool:
    """Streams a small audio clip using FFmpeg HTTP byte-range request without downloading full MP3."""
    try:
        cmd = [
            FFMPEG_EXE, "-y",
            "-ss", str(max(0, start_sec)),
            "-t", str(dur_sec),
            "-i", audio_url,
            "-ar", "16000",
            "-ac", "1",
            "-c:a", "pcm_s16le",
            out_wav
        ]
        r = subprocess.run(cmd, capture_output=True, timeout=40)
        return r.returncode == 0 and os.path.exists(out_wav) and os.path.getsize(out_wav) > 4000
    except Exception:
        return False


def compute_audio_embedding(clip_paths: List[str], classifier) -> Optional[List[float]]:
    """Computes a 192-dim average embedding using an initialized SpeechBrain classifier."""
    try:
        import torch
        import soundfile as sf
        import numpy as np

        embs = []
        for cp in clip_paths:
            sig, sr = sf.read(cp)
            if len(sig.shape) > 1:
                sig = np.mean(sig, axis=1)
            sig_t = torch.tensor(sig, dtype=torch.float32).unsqueeze(0)
            with torch.no_grad():
                emb = classifier.encode_batch(sig_t).squeeze().cpu().numpy()
            norm = np.linalg.norm(emb)
            if norm > 1e-6:
                embs.append(emb / norm)

        if not embs:
            return None
        mean_emb = np.mean(embs, axis=0)
        final_norm = np.linalg.norm(mean_emb)
        if final_norm > 1e-6:
            return (mean_emb / final_norm).tolist()
    except Exception as e:
        print(f"[!] Embedding computation notice: {e}")
    return None


def cosine_similarity(v1: List[float], v2: List[float]) -> float:
    dot = sum(a * b for a, b in zip(v1, v2))
    norm1 = sum(a * a for a in v1) ** 0.5
    norm2 = sum(b * b for b in v2) ** 0.5
    if norm1 < 1e-6 or norm2 < 1e-6:
        return 0.0
    return dot / (norm1 * norm2)


def scan_conversational_heuristics(segments: List[Dict[str, Any]], target_speaker: str) -> Optional[str]:
    """Detects if a generic speaker is directly handed the mic or introduced as target speaker."""
    name_lower = target_speaker.lower()
    address_patterns = [
        re.compile(rf'\b(?:hey|hi|hello)\s+{name_lower}\b', re.I),
        re.compile(rf'\bgo\s+ahead\s+{name_lower}\b', re.I),
        re.compile(rf'\b(?:thanks|thank\s+you)\s+{name_lower}\b', re.I),
        re.compile(rf'\bwelcome\s+{name_lower}\b', re.I),
        re.compile(rf'\blet\s+{name_lower}\s+(?:talk|speak)\b', re.I),
        re.compile(rf'\b{name_lower}\s+(?:what\s+do\s+you|what\s+are\s+your|what\s+is\s+your|go\s+ahead|you\s+there|you\'re\s+on\s+mute|unmute)\b', re.I),
        re.compile(rf'\bi\s+agree\s+with\s+(?:you,?\s+)?{name_lower}\b', re.I),
        re.compile(rf'\b{name_lower},?\s+(?:that\'s|you\'re|you\s+need|keeps\s+going|was\s+killing\s+it)\b', re.I),
    ]
    self_intro = [
        re.compile(rf'\b(?:this\s+is|i\'m|it\'s)\s+{name_lower}\b', re.I),
    ]
    exclude = re.compile(r'\b(?:amber\s+rose|rose\s+prairie|rose\s+bowl|a\s+rose\s+by\s+any|guns\s+n\s+roses)\b', re.I) if name_lower == "rose" else None

    scores = {}
    for i, s in enumerate(segments):
        txt = s.get("text", "")
        spk = s.get("speaker", "")
        if exclude and exclude.search(txt):
            continue

        if any(p.search(txt) for p in self_intro) and spk.lower().startswith("speaker"):
            scores[spk] = scores.get(spk, 0) + 15

        for p in address_patterns:
            if p.search(txt):
                if i + 1 < len(segments):
                    nspk = segments[i + 1].get("speaker", "")
                    if nspk != spk and nspk.lower().startswith("speaker"):
                        scores[nspk] = scores.get(nspk, 0) + 12
                if i > 0:
                    pspk = segments[i - 1].get("speaker", "")
                    if pspk != spk and pspk.lower().startswith("speaker"):
                        scores[pspk] = scores.get(pspk, 0) + 8

    if scores:
        sorted_scores = sorted(scores.items(), key=lambda x: x[1], reverse=True)
        best_spk, best_score = sorted_scores[0]
        runner_up = sorted_scores[1][1] if len(sorted_scores) > 1 else 0
        if best_score >= 18 and (best_score - runner_up >= 8 or best_score >= 26):
            return best_spk

    return None


def update_episode_speaker(ep_file: Path, summary_map: Dict[str, Any], old_spk: str, new_name: str) -> int:
    """Updates speaker label across an episode JSON and summary index."""
    try:
        with open(ep_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        segs = data.get("segments", [])
        updated_turns = 0
        for s in segs:
            if s.get("speaker") == old_spk or s.get("raw_speaker") == old_spk:
                s["speaker"] = new_name
                updated_turns += 1

        if updated_turns > 0:
            distinct = sorted(list({s.get("speaker", "") for s in segs if s.get("speaker")}))
            data["speakers"] = distinct
            with open(ep_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)

            tag = ep_file.stem
            if tag in summary_map:
                summary_map[tag]["speakers"] = distinct
            return updated_turns
    except Exception as e:
        print(f"[!] Failed to update {ep_file.name}: {e}")
    return 0


def main():
    parser = argparse.ArgumentParser(description="Retroactively scan and label speakers across historical spaces")
    parser.add_argument("--speaker", type=str, default="Rose", help="Target speaker name (must be in voice_profiles.json)")
    parser.add_argument("--all-speakers", action="store_true", help="Scan and label all enrolled speakers in voice_profiles.json")
    parser.add_argument("--batch-size", type=int, default=0, help="Max episodes to process (0 = all)")
    parser.add_argument("--min-sim", type=float, default=0.54, help="Min cosine similarity for acoustic match (default: 0.54)")
    parser.add_argument("--heuristic-only", action="store_true", help="Run only dialogue heuristic scanner (no audio needed)")
    args = parser.parse_args()

    if args.all_speakers:
        try:
            with open(PROFILES_PATH, "r", encoding="utf-8") as f:
                p_data = json.load(f)
            target_speakers = list(p_data.get("profiles", {}).keys())
        except Exception as e:
            print(f"[!] Error reading profiles: {e}")
            target_speakers = [args.speaker.strip()]
        print(f"============================================================")
        print(f"  SPACEPIPE MULTI-SPEAKER SCANNER ({len(target_speakers)} ENROLLED PROFILES)")
        print(f"============================================================")
    else:
        target_speakers = [args.speaker.strip()]
        print(f"============================================================")
        print(f"  SPACEPIPE RETROACTIVE SPEAKER SCANNER: '{target_speakers[0]}'")
        print(f"============================================================")

    # Check for SpeechBrain
    classifier = None
    if not args.heuristic_only:
        try:
            import torch
            from speechbrain.inference.speaker import EncoderClassifier
            device = "cuda:0" if torch.cuda.is_available() else "cpu"
            print(f"[*] Initializing SpeechBrain ECAPA classifier on {device}...")
            cache_dir = os.path.join(os.path.expanduser("~"), ".cache", "speechbrain", "spkrec-ecapa-voxceleb")
            classifier = EncoderClassifier.from_hparams(
                source="speechbrain/spkrec-ecapa-voxceleb",
                savedir=cache_dir,
                run_opts={"device": device}
            )
            print("[✓] SpeechBrain Neural Model initialized.")
        except Exception as e:
            print(f"[!] SpeechBrain not available ({e}). Falling back to conversational heuristic scanner.")
            classifier = None

    if not SUMMARY_PATH.exists():
        print(f"[!] Summary index not found: {SUMMARY_PATH}")
        sys.exit(1)

    with open(SUMMARY_PATH, "r", encoding="utf-8") as f:
        summary_list = json.load(f)

    summary_map = {item.get("release_tag"): item for item in summary_list if item.get("release_tag")}

    episodes = [ep for ep in summary_list if ep.get("release_tag")]
    if args.batch_size > 0:
        episodes = episodes[:args.batch_size]

    print(f"[*] Loaded {len(episodes)} historical episodes from summary index...")

    total_scanned_overall = 0
    total_matched_overall = 0
    total_turns_updated_overall = 0
    tmp_dir = Path("tmp_speaker_rescan")
    tmp_dir.mkdir(parents=True, exist_ok=True)

    for speaker in target_speakers:
        target_emb = load_profile_embedding(speaker)
        print(f"\n--- Checking Speaker: '{speaker}' ---")
        if target_emb:
            print(f"[✓] Voiceprint loaded (192-dim vector).")
        else:
            print(f"[*] No voiceprint vector found; heuristic matching only.")

        spk_matched = 0
        spk_turns = 0

        for ep in episodes:
            tag = ep.get("release_tag")
            title = ep.get("title", tag)
            existing_speakers = ep.get("speakers", [])

            # Check if already labeled
            if any(s.lower() == speaker.lower() for s in existing_speakers):
                continue

            ep_file = EPISODES_DIR / f"{tag}.json"
            if not ep_file.exists():
                continue

            total_scanned_overall += 1
            try:
                with open(ep_file, "r", encoding="utf-8") as f:
                    ep_data = json.load(f)
            except Exception:
                continue

            segs = ep_data.get("segments", [])
            if not segs:
                continue

            generic_speakers = sorted(list({s.get("speaker", "") for s in segs if s.get("speaker", "").lower().startswith("speaker")}))
            if not generic_speakers:
                continue

            matched_spk = None
            match_reason = ""

            # Tier 0: Acoustic Voiceprint Match (if audio available and model loaded)
            audio_url = ep.get("audio_url") or ep_data.get("audio_url")
            if classifier and target_emb and audio_url and audio_url.startswith("http") and not args.heuristic_only:
                # Group candidate turns per generic speaker
                for g_spk in generic_speakers:
                    spk_candidate_turns = [
                        s for s in segs
                        if s.get("speaker") == g_spk and 4.0 <= (s.get("end", 0) - s.get("start", 0)) <= 18.0
                    ]
                    if len(spk_candidate_turns) < 3:
                        continue

                    # Slices 3-5 clips
                    clip_files = []
                    for idx, t in enumerate(spk_candidate_turns[:5]):
                        st = float(t.get("start", 0))
                        dur = float(t.get("end", st + 5.0)) - st
                        out_clip = str(tmp_dir / f"{tag}_{g_spk.replace(' ', '_')}_{idx}.wav")
                        if slice_candidate_clip(audio_url, st, dur, out_clip):
                            clip_files.append(out_clip)

                    if len(clip_files) >= 2:
                        computed_emb = compute_audio_embedding(clip_files, classifier)
                        if computed_emb:
                            sim = cosine_similarity(computed_emb, target_emb)
                            if sim >= args.min_sim:
                                matched_spk = g_spk
                                match_reason = f"Acoustic ECAPA Match (Cosine Sim: {sim:.3f})"
                                break

                    for cf in clip_files:
                        try:
                            os.remove(cf)
                        except Exception:
                            pass

            # Tier 1: Conversational Heuristic Fallback
            if not matched_spk:
                heuristic_winner = scan_conversational_heuristics(segs, speaker)
                if heuristic_winner and heuristic_winner in generic_speakers:
                    matched_spk = heuristic_winner
                    match_reason = "Conversational Hand-off & Dialogue Direct Address"

            if matched_spk:
                turns = update_episode_speaker(ep_file, summary_map, matched_spk, speaker)
                if turns > 0:
                    spk_matched += 1
                    spk_turns += turns
                    total_matched_overall += 1
                    total_turns_updated_overall += turns
                    print(f"[✓] {tag} : Labeled '{matched_spk}' -> '{speaker}' ({turns} turns) via {match_reason}")
                    print(f"    Episode: '{title}'")
                    # Update local ep object so subsequent passes see the new speaker
                    if speaker not in ep.get("speakers", []):
                        ep.setdefault("speakers", []).append(speaker)

        if spk_matched > 0:
            print(f"[+] Labeled '{speaker}' in {spk_matched} episodes ({spk_turns} turns).")

    shutil.rmtree(tmp_dir, ignore_errors=True)

    # Sync summary index if any changes made
    if total_matched_overall > 0:
        updated_summary = list(summary_map.values())
        with open(SUMMARY_PATH, "w", encoding="utf-8") as f:
            json.dump(updated_summary, f, ensure_ascii=False, indent=2)
        print(f"\n[🎉] Complete! Labeled enrolled speakers across {total_matched_overall} episodes ({total_turns_updated_overall} total turns).")
        print(f"     Updated {SUMMARY_PATH}.")
    else:
        print(f"\n[*] Scan complete. No new speaker matches found.")


if __name__ == "__main__":
    main()
