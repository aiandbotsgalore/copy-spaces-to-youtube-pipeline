#!/usr/bin/env python3
"""
scripts/scan_recent_episodes_voice_profiles.py

Acoustic Voice Profile Scanner for Recent Transcribed Episodes.
Streams small 4-10 second audio snippets via HTTP Range requests without downloading
full MP3 files, computes SpeechBrain 192-dim ECAPA-TDNN biometric embeddings,
and matches generic speaker tags against verified voice profiles.
"""

import os
import sys
import json
import time
import shutil
import urllib.request
import subprocess
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple

try:
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)
except Exception:
    pass

import soundfile as sf
import numpy as np
import torch

sys.path.insert(0, str(Path("spaces/zerogpu-transcriber").resolve()))
from spacepipe_transcribe_core import match_biometrics_1to1, valid_embedding
from speechbrain.inference.speaker import EncoderClassifier

PROFILES_PATH = Path("voice_profiles.json")
SUMMARY_PATH = Path("public/transcripts/transcripts_summary_index.json")
EPISODES_DIR = Path("public/transcripts/episodes")

def find_ffmpeg() -> str:
    c = shutil.which("ffmpeg")
    if c:
        return c
    for p in [
        r"C:\Program Files\ShareX\ffmpeg.exe",
        r"C:\Users\Logan\Downloads\ytdlp-gui-windows-64\ffmpeg.exe",
    ]:
        if os.path.exists(p):
            return p
    return "ffmpeg"

FFMPEG = find_ffmpeg()

def resolve_direct_audio_url(url: str) -> str:
    """Follows 302 redirects to direct storage URL for HTTP Range support."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 SpacePipe-VoiceScanner"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.geturl()
    except Exception:
        return url

def slice_clip_range(direct_url: str, start: float, dur: float, out_wav: str) -> bool:
    """Streams a small audio clip using FFmpeg HTTP byte-range request directly."""
    try:
        cmd = [
            FFMPEG, "-y",
            "-ss", str(max(0, start)),
            "-t", str(dur),
            "-i", direct_url,
            "-ar", "16000",
            "-ac", "1",
            "-c:a", "pcm_s16le",
            out_wav
        ]
        r = subprocess.run(cmd, capture_output=True, timeout=20)
        return r.returncode == 0 and os.path.exists(out_wav) and os.path.getsize(out_wav) > 4000
    except Exception:
        return False

def compute_audio_embedding(clip_paths: List[str], classifier, device: str) -> Optional[List[float]]:
    try:
        embs = []
        for cp in clip_paths:
            sig, sr = sf.read(cp)
            if len(sig.shape) > 1:
                sig = np.mean(sig, axis=1)
            sig_t = torch.tensor(sig, dtype=torch.float32).unsqueeze(0).to(device)
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
        print(f"[!] Error computing embedding: {e}")
    return None

def update_episode_labels(ep_file: Path, mapping: Dict[str, str]) -> int:
    try:
        with open(ep_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        segs = data.get("segments", [])
        updated = 0
        for s in segs:
            curr = s.get("speaker")
            if curr in mapping:
                new_spk = mapping[curr]
                s.setdefault("raw_speaker", curr)
                s["speaker"] = new_spk
                s["attribution"] = {
                    "method": "acoustic",
                    "model": "speechbrain/spkrec-ecapa-voxceleb",
                    "date": time.strftime("%Y-%m-%d")
                }
                for w in s.get("words", []):
                    if w.get("speaker") == curr:
                        w.setdefault("raw_speaker", curr)
                        w["speaker"] = new_spk
                updated += 1
        if updated > 0:
            distinct = sorted(list({s.get("speaker", "") for s in segs if s.get("speaker")}))
            data["speakers"] = distinct
            with open(ep_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        return updated
    except Exception as e:
        print(f"[!] Failed to update {ep_file.name}: {e}")
        return 0

def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=10, help="Number of recent episodes with generic speakers to scan")
    parser.add_argument("--min-sim", type=float, default=0.50, help="Minimum cosine similarity for match (default 0.50)")
    parser.add_argument("--min-margin", type=float, default=0.04, help="Margin over 2nd best candidate (default 0.04)")
    args = parser.parse_args()

    print("======================================================================")
    print("  SPACEPIPE RECENT EPISODES NEURAL VOICE PROFILE SCANNER")
    print(f"  Threshold: {args.min_sim} | Margin: {args.min_margin}")
    print("======================================================================")

    if not PROFILES_PATH.exists() or not SUMMARY_PATH.exists():
        print("[!] Required files missing.")
        sys.exit(1)

    with open(PROFILES_PATH, "r", encoding="utf-8") as f:
        profiles_data = json.load(f).get("profiles", {})

    # Prepare normalized profiles for fast cosine similarity.
    # STRICT AUDIT RULE: A profile MUST have an auditable, human-approved master reference audio clip.
    # No audio reference = No matching.
    verified_profiles = {}
    for name, p_data in profiles_data.items():
        has_audio_ref = bool(
            p_data.get("sample_audio_url_cdn") or
            p_data.get("sample_audio_path") or
            p_data.get("samples")
        )
        if not has_audio_ref:
            print(f"[-] Excluding unverified headless profile '{name}' (no audio reference).")
            continue

        if (p_data.get("identity_verified") is True and
            p_data.get("embedding_model") == "speechbrain/spkrec-ecapa-voxceleb"):
            raw_emb = p_data.get("embedding")
            v_emb = valid_embedding(raw_emb)
            if v_emb is not None:
                p_copy = dict(p_data)
                p_copy["embedding"] = v_emb.tolist()
                verified_profiles[name] = p_copy

    print(f"[✓] {len(verified_profiles)} verified biometric voiceprints loaded:")
    for name in sorted(verified_profiles.keys()):
        print(f"    - {name}")

    print("\n[*] Initializing SpeechBrain Neural Model...")
    device = "cuda:0" if torch.cuda.is_available() else "cpu"
    cache_dir = os.path.join(os.path.expanduser("~"), ".cache", "speechbrain", "spkrec-ecapa-voxceleb")
    classifier = EncoderClassifier.from_hparams(
        source="speechbrain/spkrec-ecapa-voxceleb",
        savedir=cache_dir,
        run_opts={"device": device}
    )
    print(f"[✓] SpeechBrain initialized on {device}.")

    with open(SUMMARY_PATH, "r", encoding="utf-8") as f:
        summary_list = json.load(f)

    summary_map = {item.get("release_tag"): item for item in summary_list if item.get("release_tag")}

    # Find recent episodes with generic speakers
    candidates = []
    for ep in summary_list:
        tag = ep.get("release_tag")
        if not tag:
            continue
        ep_file = EPISODES_DIR / f"{tag}.json"
        if not ep_file.exists():
            continue
        spks = ep.get("speakers", [])
        has_generic = any(s.lower().startswith("speaker") for s in spks)
        if has_generic and (ep.get("audio_url") or "").startswith("http"):
            candidates.append(ep)

    print(f"\n[*] Found {len(candidates)} total episodes in archive with generic speaker tags.")
    to_scan = candidates[:args.limit]
    print(f"[*] Scanning the {len(to_scan)} most recent target episodes:\n")

    tmp_dir = Path("tmp_voice_range_scan")
    tmp_dir.mkdir(exist_ok=True)

    total_episodes_updated = 0
    total_turns_updated = 0

    for idx, ep in enumerate(to_scan, 1):
        tag = ep.get("release_tag")
        title = (ep.get("title") or tag)[:50]
        audio_url = ep.get("audio_url")
        ep_file = EPISODES_DIR / f"{tag}.json"

        print(f"\n[{idx}/{len(to_scan)}] 🎙️ Episode: {tag}")
        print(f"    Title: '{title}'")
        print(f"    Current Speakers: {ep.get('speakers')}")

        try:
            with open(ep_file, "r", encoding="utf-8") as f:
                ep_data = json.load(f)
        except Exception as e:
            print(f"    [-] Could not load JSON: {e}")
            continue

        segs = ep_data.get("segments", [])
        generic_speakers = sorted(list({s.get("speaker", "") for s in segs if s.get("speaker", "").lower().startswith("speaker")}))
        if not generic_speakers:
            print("    [-] No generic speakers in segment list.")
            continue

        # Resolve direct redirect once
        t0 = time.time()
        direct_url = resolve_direct_audio_url(audio_url)
        print(f"    [*] Resolved audio stream in {time.time()-t0:.2f}s")

        centroids = {}
        for g_spk in generic_speakers:
            usable_turns = [
                s for s in segs
                if s.get("speaker") == g_spk and 3.5 <= (s.get("end", 0) - s.get("start", 0)) <= 25.0
            ]
            if len(usable_turns) < 2:
                continue

            # Slice 3 clips
            clips = []
            for c_idx, t in enumerate(usable_turns[:3]):
                out_wav = str(tmp_dir / f"{tag}_{g_spk.replace(' ', '_')}_{c_idx}.wav")
                st = float(t.get("start", 0))
                dur = float(t.get("end", 0)) - st
                if slice_clip_range(direct_url, st, dur, out_wav):
                    clips.append(out_wav)

            if clips:
                c_vec = compute_audio_embedding(clips, classifier, device)
                if c_vec:
                    centroids[g_spk] = c_vec
                    # Print top 3 matches for visibility
                    sims = []
                    for pname, pdata in verified_profiles.items():
                        pvec = pdata.get("embedding")
                        sim = float(np.dot(c_vec, pvec))
                        sims.append((pname, sim))
                    sims.sort(key=lambda x: x[1], reverse=True)
                    top_matches = ", ".join(f"{n}: {s:.3f}" for n, s in sims[:3])
                    print(f"    --> {g_spk} ({len(clips)} clips) top matches: [{top_matches}]")

            for c in clips:
                try:
                    os.remove(c)
                except Exception:
                    pass

        if not centroids:
            print("    [-] No usable acoustic centroids computed for generic speakers.")
            continue

        # Run 1-to-1 bipartite biometric matching
        matches = match_biometrics_1to1(
            centroids,
            verified_profiles,
            min_similarity=args.min_sim,
            min_margin=args.min_margin
        )

        if matches:
            print(f"    🎉 BIOMETRIC MATCHES CONFIRMED: {matches}")
            turns = update_episode_labels(ep_file, matches)
            if turns > 0:
                total_episodes_updated += 1
                total_turns_updated += turns
                print(f"    [✓] Updated {turns} dialogue turns in {ep_file.name}")
                # Update in summary map
                with open(ep_file, "r", encoding="utf-8") as f:
                    new_ep_data = json.load(f)
                if tag in summary_map:
                    summary_map[tag]["speakers"] = new_ep_data.get("speakers", [])
        else:
            print(f"    [*] No generic speakers exceeded matching threshold (>= {args.min_sim} with margin >= {args.min_margin}).")

    shutil.rmtree(tmp_dir, ignore_errors=True)

    # Save summary index if any updates occurred
    if total_episodes_updated > 0:
        updated_summary = list(summary_map.values())
        with open(SUMMARY_PATH, "w", encoding="utf-8") as f:
            json.dump(updated_summary, f, ensure_ascii=False, indent=2)
        print(f"\n======================================================================")
        print(f"🎉 Complete! Updated {total_episodes_updated} episodes ({total_turns_updated} turns).")
        print(f"   Synchronized {SUMMARY_PATH}")
        print(f"======================================================================")
    else:
        print(f"\n[*] Scan complete. No episodes required label changes.")

if __name__ == "__main__":
    main()
