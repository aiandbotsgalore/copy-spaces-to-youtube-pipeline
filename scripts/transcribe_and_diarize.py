#!/usr/bin/env python3
"""
scripts/transcribe_and_diarize.py - Cloud Audio Transcriber, Speaker Diarizer & Highlight Extractor

Transcribes Twitter Spaces 100% in the cloud via AssemblyAI Universal-3.5 Pro with:
- Neural speech-to-text with precise millisecond word-level timestamps
- Automatic multi-speaker diarization (speaker_labels=True)
- Universal-3.5 Pro flagship with automatic fallback to Universal-2
- Automated Cloud Audio Workarounds:
  * Auto-compression via FFmpeg (48kbps mono) for high-bitrate audio near 2GB
  * Lossless 4-hour chunking & timestamp offset stitching for marathon spaces (>10 hours)
- Multi-tier contextual speaker discovery (identifying Logan, hosts, guests, etc.)
- AI Highlight Clip extraction & cutting (via scripts/find_and_cut_best_clips.py)
- Direct upload of .txt, .srt, .json, and clips to GitHub Release assets
- Zero local PC disk/bandwidth usage (runs in GitHub Actions cloud runners or locally)
"""

import os
import sys
import re
import json
import time
import math
import shutil
import argparse
import tempfile
import subprocess
import urllib.parse
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
from collections import defaultdict

import requests

try:
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)
except Exception:
    pass



def find_ffmpeg() -> str:
    """Finds ffmpeg executable across Linux, macOS, and Windows environments."""
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


def find_ffprobe() -> str:
    """Finds ffprobe executable across Linux, macOS, and Windows environments."""
    cand = shutil.which("ffprobe")
    if cand:
        return cand
    for p in [
        r"C:\Program Files\ShareX\ffprobe.exe",
        r"C:\Users\Logan\Downloads\ytdlp-gui-windows-64\ffprobe.exe",
    ]:
        if os.path.exists(p):
            return p
    return "ffprobe"


FFMPEG_EXE = find_ffmpeg()
FFPROBE_EXE = find_ffprobe()


def format_timestamp(seconds: float, srt: bool = False) -> str:
    """Formats seconds into HH:MM:SS or HH:MM:SS,mmm."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds - int(seconds)) * 1000)
    if srt:
        return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def get_audio_duration(file_path: Path) -> float:
    """Returns audio duration in seconds using ffprobe or ffmpeg."""
    try:
        cmd = [
            FFPROBE_EXE, "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(file_path)
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, errors="replace")
        if res.returncode == 0 and res.stdout.strip():
            return float(res.stdout.strip())
    except Exception:
        pass

    try:
        cmd = [FFMPEG_EXE, "-i", str(file_path)]
        res = subprocess.run(cmd, capture_output=True, text=True, errors="replace")
        match = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.?\d*)", res.stderr)
        if match:
            h, m, s = match.groups()
            return int(h) * 3600 + int(m) * 60 + float(s)
    except Exception:
        pass

    return 0.0


def load_known_speakers(repo_root: Optional[Path] = None) -> List[str]:
    """Loads known recurring hosts and community speakers."""
    default_speakers = [
        "Angela", "Logan", "Oor", "Eric Hecker", "Mary", "Shane",
        "Lana", "Rick Doty", "Gabe", "Parr", "Chan", "Tom"
    ]
    known_set = set(default_speakers)

    paths_to_try = []
    if repo_root:
        paths_to_try.append(repo_root / "voice_profiles.json")
    paths_to_try.extend([
        Path("voice_profiles.json"),
        Path(__file__).parent.parent / "voice_profiles.json",
        Path(__file__).parent / "voice_profiles.json"
    ])

    for p in paths_to_try:
        if p.exists():
            try:
                with open(p, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    for k in data.get("profiles", {}).keys():
                        if k and not k.lower().startswith("speaker"):
                            known_set.add(k.strip())
            except Exception:
                pass
    extra_hints = os.environ.get("EPISODE_SPEAKER_HINTS", "").strip()
    if extra_hints:
        for item in re.split(r"[,;/|]+", extra_hints):
            clean = item.strip()
            if clean and not clean.lower().startswith("speaker"):
                known_set.add(clean)

    return sorted(list(known_set))


def resolve_speakers_llm(
    segments: List[Dict[str, Any]],
    title: str,
    known_speakers: List[str],
    gemini_key: str = "",
    cohere_key: str = "",
    openrouter_key: str = "",
    acoustic_hints: Optional[Dict[str, str]] = None
) -> Dict[str, str]:
    """Resolves speaker names via LLM with conversational context and acoustic voiceprint anchors."""
    if not segments:
        return {}

    total_segs = len(segments)
    sample_candidates = segments if total_segs <= 120 else (
        segments[:60] + segments[max(60, (total_segs // 2) - 20):max(60, (total_segs // 2) + 20)] + segments[-40:]
    )
    sample_lines = [f"[{s['start']:.1f}s] {s['speaker']}: {s['text']}" for s in sample_candidates]
    transcript_sample = "\n".join(sample_lines)

    hints_block = ""
    if acoustic_hints:
        hint_items = ", ".join(f"{k} = {v}" for k, v in acoustic_hints.items())
        hints_block = f"\nConfirmed Acoustic Voiceprint Anchors (100% Verified): {hint_items}\nUse these confirmed speakers as conversational anchors to deduce who the remaining generic speakers are when they address each other.\n"

    prompt = f"""You are an expert audio diarization analyst. Identify the real names of the generic speakers (e.g. Speaker A, Speaker B, etc.) in this Twitter Space transcript.

Space Title: {title}
Known Community Hosts & Recurring Speakers: {', '.join(known_speakers)}{hints_block}
Diarization & Identification Rules:
1. Direct Self-Introductions: Look for speakers introducing themselves (e.g. "I'm Angela", "This is Logan").
2. Direct Conversational Address: Look for when one speaker directly addresses another (e.g. "Good morning Angela, thanks for hosting", "I agree with you Angela"). Note who was speaking before or after.
3. Third-Person vs Direct Address: Do NOT confuse talking ABOUT a person (e.g. "we are reading Logan Black chats") with the person speaking!
4. Host Identification: The dominant speaker who is addressed as host by participants is the host.
5. Only map speakers you are confident about (confidence >= 0.70). Do not use generic labels like "Unknown" or "Speaker".

Return a valid JSON object with this exact schema:
{{
  "speaker_mappings": [
    {{"speaker_id": "Speaker A", "identified_name": "Angela", "confidence": 0.95}}
  ]
}}

Transcript sample:
{transcript_sample}
"""

    def parse_speaker_json(text: str) -> Dict[str, str]:
        if not text:
            return {}
        clean_text = text.strip()
        if "```" in clean_text:
            m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", clean_text)
            if m:
                clean_text = m.group(1).strip()
        try:
            parsed = json.loads(clean_text)
            out_map = {}
            for item in parsed.get("speaker_mappings", []):
                spk_id = item.get("speaker_id", "").strip()
                name = item.get("identified_name", "").strip()
                conf = float(item.get("confidence", 0.0))
                if spk_id and spk_id.lower().startswith("speaker") and name and conf >= 0.70 and not name.lower().startswith("speaker"):
                    out_map[spk_id] = name
            return out_map
        except Exception:
            return {}

    # Tier 1: Cohere Free API (command-r-plus-08-2024 / command-r-08-2024)
    if cohere_key:
        for cohere_model in ["command-r-plus-08-2024", "command-r-08-2024"]:
            try:
                resp = requests.post(
                    "https://api.cohere.com/v2/chat",
                    headers={
                        "Authorization": f"Bearer {cohere_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": cohere_model,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.2
                    },
                    timeout=45
                )
                if resp.status_code == 200:
                    data = resp.json()
                    content_items = data.get("message", {}).get("content", [])
                    out = "".join(c.get("text", "") for c in content_items if isinstance(c, dict))
                    mapped = parse_speaker_json(out)
                    if mapped:
                        return mapped
                else:
                    print(f"[!] Notice: Cohere ({cohere_model}) returned HTTP {resp.status_code}")
            except Exception as e:
                print(f"[!] Notice: Cohere speaker resolution error ({cohere_model}): {e}")

    # Tier 2: OpenRouter Free Models ($0.00 cost)
    if openrouter_key:
        free_or_models = [
            "nvidia/nemotron-3-ultra-550b-a55b:free",
            "google/gemma-4-31b-it:free",
            "openrouter/free"
        ]
        for or_model in free_or_models:
            try:
                resp = requests.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {openrouter_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": or_model,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.2,
                        "max_tokens": 1000
                    },
                    timeout=45
                )
                if resp.status_code == 200:
                    out = resp.json()["choices"][0]["message"]["content"]
                    mapped = parse_speaker_json(out)
                    if mapped:
                        return mapped
                else:
                    print(f"[!] Notice: OpenRouter ({or_model}) returned HTTP {resp.status_code}")
            except Exception as e:
                print(f"[!] Notice: OpenRouter speaker resolution error ({or_model}): {e}")

    return {}


def analyze_conversational_heuristics(
    segments: List[Dict[str, Any]],
    known_speakers: List[str]
) -> Dict[str, str]:
    """Deterministic conversational analyzer detecting self-intros and vocatives."""
    if not segments:
        return {}

    name_pattern = "|".join(re.escape(n) for n in known_speakers)
    self_intro_re = re.compile(
        rf"(?:(?<!said\s)(?<!says\s)(?<!told\s)\b(?:i(?:'m| am)|this is|my name is|it(?:'s| s) me)\s+({name_pattern})\b)",
        re.IGNORECASE
    )
    direct_addr_re = re.compile(
        rf"(?:"
        rf"(?:[,\.\?!]|\b(?:hey|hi|hello|morning|thanks|thank you|sorry|appreciate|agree with|tell|ask|apologize to|here)\b)\s*,?\s*({name_pattern})\b"
        rf"|"
        rf"\b({name_pattern})\s*,\s*(?:what|can|could|do|did|would|are|you|how|let|please|i think|i know|look|see|yeah)\b"
        rf")",
        re.IGNORECASE
    )
    third_person_re = re.compile(
        rf"\b(?:about|reading|post|allegation|chats|tweets|video|expose|unmasked|story of)\s+({name_pattern})\b|"
        rf"\b({name_pattern})(?:'s|\s+chats|\s+video|\s+tweets|\s+allegations|\s+was|\s+did|\s+said)\b",
        re.IGNORECASE
    )

    talk_times = {}
    for s in segments:
        talk_times[s["speaker"]] = talk_times.get(s["speaker"], 0.0) + (s["end"] - s["start"])
    top_spk = max(talk_times.items(), key=lambda x: x[1])[0] if talk_times else None

    speaker_scores = defaultdict(lambda: defaultdict(float))

    for i, seg in enumerate(segments):
        spk = seg["speaker"]
        text = seg["text"]

        for intro in self_intro_re.findall(text):
            target = next(n for n in known_speakers if n.lower() == intro.lower())
            speaker_scores[spk][target] += 10.0

        for m in direct_addr_re.findall(text):
            found_raw = next(n for n in m if n)
            target = next(n for n in known_speakers if n.lower() == found_raw.lower())
            idx_name = text.lower().find(found_raw.lower())
            surrounding = text[max(0, idx_name - 20):idx_name + len(found_raw) + 20]
            if third_person_re.search(surrounding) and not any(k in surrounding.lower() for k in ["morning", "thanks", "apologize", "here,"]):
                continue

            if i > 0 and segments[i - 1]["speaker"] != spk:
                speaker_scores[segments[i - 1]["speaker"]][target] += 3.0
            elif top_spk and spk != top_spk:
                speaker_scores[top_spk][target] += 2.0

    mappings = {}
    assigned = set()
    for spk, scores in sorted(speaker_scores.items(), key=lambda item: max(item[1].values(), default=0.0), reverse=True):
        if not scores or not spk.lower().startswith("speaker"):
            continue
        best_name, best_score = max(scores.items(), key=lambda x: x[1])
        if best_name in assigned:
            continue
        if best_score >= 5.0:
            mappings[spk] = best_name
            assigned.add(best_name)

    return mappings


def resolve_speakers_acoustically(
    segments: List[Dict[str, Any]],
    audio_path: Optional[Path] = None,
    profiles_file: str = "voice_profiles.json"
) -> Dict[str, str]:
    """
    1. Splits any merged speaker cluster where AssemblyAI lumped 2 distinct voices together.
    2. Matches speakers against 192-dim SpeechBrain ECAPA-TDNN voiceprints in voice_profiles.json
       using isolated, edge-trimmed turns, outlier rejection, and a clear-winner separation margin.
    """
    if not segments or not audio_path or not Path(audio_path).exists():
        return {}
    if not os.path.exists(profiles_file):
        return {}

    try:
        with open(profiles_file, "r", encoding="utf-8") as f:
            prof_data = json.load(f)
    except Exception:
        return {}

    enrolled_profiles = {}
    for name, p in prof_data.get("profiles", {}).items():
        emb = p.get("embedding")
        if isinstance(emb, list) and len(emb) == 192:
            enrolled_profiles[name] = emb

    if not enrolled_profiles:
        return {}

    # Group candidate turns (3.8s - 15s) per generic speaker with crosstalk isolation & 0.4s edge trimming
    spk_candidates: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for idx, s in enumerate(segments):
        spk = s.get("speaker", "")
        if not spk or not spk.lower().startswith("speaker"):
            continue
        raw_start = float(s.get("start", 0))
        raw_end = float(s.get("end", 0))
        raw_dur = raw_end - raw_start
        words_n = len((s.get("text") or "").split())
        if raw_dur < 4.2 or raw_dur > 16.5 or words_n < 6:
            continue

        prev_s = segments[idx - 1] if idx > 0 else None
        next_s = segments[idx + 1] if idx < len(segments) - 1 else None
        gap_before = (raw_start - float(prev_s.get("end", 0))) if (prev_s and prev_s.get("speaker") != spk) else 2.0
        gap_after = (float(next_s.get("start", raw_end + 10)) - raw_end) if (next_s and next_s.get("speaker") != spk) else 2.0
        is_isolated = gap_before >= 0.4 and gap_after >= 0.4

        # Trim 0.4s off start and end to avoid boundary crosstalk
        trim_pad = 0.4 if raw_dur >= 5.2 else 0.15
        trimmed_start = round(raw_start + trim_pad, 2)
        trimmed_dur = round(raw_dur - (trim_pad * 2), 2)

        words_list = s.get("words") or []
        avg_conf = (
            sum(float(w.get("confidence", 0.92)) for w in words_list) / len(words_list)
            if words_list else 0.92
        )
        if avg_conf < 0.75:
            continue

        spk_conf = float(s.get("speaker_confidence", 0.90) or 0.90)
        quality_score = (
            (20.0 if is_isolated else 0.0)
            + (avg_conf * 10.0)
            + (spk_conf * 15.0)
            - abs(trimmed_dur - 8.5)
        )
        spk_candidates[spk].append({
            "seg_idx": idx,
            "start": trimmed_start,
            "duration": trimmed_dur,
            "quality_score": quality_score,
            "speaker_confidence": spk_conf
        })

    if not spk_candidates:
        return {}

    tmp_dir = Path(audio_path).parent / "tmp_voice_match"
    shutil.rmtree(tmp_dir, ignore_errors=True)
    tmp_dir.mkdir(parents=True, exist_ok=True)

    spk_wav_map: Dict[str, List[Dict[str, Any]]] = {}
    for spk, cands in spk_candidates.items():
        cands.sort(key=lambda c: c["quality_score"], reverse=True)
        picked = []
        for c in cands:
            if all(abs(c["start"] - p["start"]) >= 15.0 for p in picked):
                picked.append(c)
            if len(picked) >= 5:
                break
        if not picked:
            picked = cands[:3]

        # Also include up to 3 low-speaker-confidence turns (>= 4.5s) so sub-cluster splitting can catch merged speakers
        low_spk_conf_cands = [
            c for c in cands
            if c not in picked and c.get("speaker_confidence", 1.0) < 0.72 and c["duration"] >= 4.5
        ][:3]
        picked.extend(low_spk_conf_cands)

        safe_spk = re.sub(r"[^a-zA-Z0-9_]", "_", spk)
        wav_entries = []
        for c_idx, clip in enumerate(picked):
            out_w = tmp_dir / f"{safe_spk}_{c_idx}.wav"
            cmd = [
                FFMPEG_EXE, "-y",
                "-ss", str(clip["start"]),
                "-t", str(clip["duration"]),
                "-i", str(audio_path),
                "-ac", "1", "-ar", "16000",
                str(out_w)
            ]
            try:
                r = subprocess.run(cmd, capture_output=True, timeout=30)
                if r.returncode == 0 and out_w.exists():
                    wav_entries.append({"path": str(out_w), "seg_idx": clip["seg_idx"]})
            except Exception:
                pass
        if wav_entries:
            spk_wav_map[spk] = wav_entries

    if not spk_wav_map:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        return {}

    payload_json = json.dumps({"spk_wavs": spk_wav_map, "profiles": enrolled_profiles})
    payload_file = tmp_dir / "match_input.json"
    payload_file.write_text(payload_json, encoding="utf-8")

    worker_code = f"""
import sys, json, os, warnings
warnings.filterwarnings('ignore')
import numpy as np
import soundfile as sf
import torch
from speechbrain.inference.speaker import EncoderClassifier

with open(r'{str(payload_file)}', 'r', encoding='utf-8') as f:
    payload = json.load(f)

spk_wavs = payload['spk_wavs']
profiles = {{k: np.array(v, dtype=np.float32) for k, v in payload['profiles'].items()}}
for k in profiles:
    n = np.linalg.norm(profiles[k])
    if n > 1e-6:
        profiles[k] = profiles[k] / n

device = 'cuda:0' if torch.cuda.is_available() else 'cpu'
classifier = EncoderClassifier.from_hparams(
    source='speechbrain/spkrec-ecapa-voxceleb',
    savedir=os.path.join(os.path.expanduser('~'), '.cache', 'speechbrain', 'spkrec-ecapa-voxceleb'),
    run_opts={{'device': device}}
)

spk_vecs = {{}}
split_overrides = {{}}
for spk, entries in spk_wavs.items():
    embs = []
    seg_indices = []
    for item in entries:
        w = item['path']
        try:
            sig, sr = sf.read(w)
            if sig.ndim > 1:
                sig = np.mean(sig, axis=1)
            sig = sig.astype(np.float32)
            if len(sig) < sr * 1.0:
                continue
            m = np.max(np.abs(sig))
            if m > 1e-6:
                sig = sig / m
            t = torch.from_numpy(sig).unsqueeze(0).to(device)
            with torch.no_grad():
                e = classifier.encode_batch(t).squeeze().cpu().numpy()
            en = np.linalg.norm(e)
            if en > 1e-6:
                embs.append(e / en)
                seg_indices.append(item['seg_idx'])
        except Exception:
            pass
    if embs:
        # Sub-cluster splitting & Outlier rejection:
        # If AssemblyAI merged a 2nd distinct voice into this speaker bucket (sim < 0.36 to main voice),
        # split those turns into a separate speaker cluster (f"{{spk}}_B") and reject outliers.
        if len(embs) >= 3:
            mat = np.stack(embs, axis=0)
            c_vec = np.mean(mat, axis=0)
            cn = np.linalg.norm(c_vec)
            if cn > 1e-6:
                c_vec = c_vec / cn
            sims = np.dot(mat, c_vec)
            med = float(np.median(sims))
            divergent = [i for i in range(len(embs)) if sims[i] < 0.36]
            if divergent:
                sub_spk = f"{{spk}}_B"
                sub_embs = [embs[i] for i in divergent]
                for i in divergent:
                    split_overrides[str(seg_indices[i])] = sub_spk
                sub_mean = np.mean(sub_embs, axis=0)
                smn = np.linalg.norm(sub_mean)
                if smn > 1e-6:
                    spk_vecs[sub_spk] = sub_mean / smn
            inliers = [embs[i] for i in range(len(embs)) if sims[i] >= max(0.45, med - 0.18)]
            if inliers:
                embs = inliers
        mean_v = np.mean(embs, axis=0)
        mn = np.linalg.norm(mean_v)
        if mn > 1e-6:
            spk_vecs[spk] = mean_v / mn

# Score all pairs and require both >= 0.54 similarity AND >= 0.06 clear-winner separation margin
pairs = []
for spk, s_vec in spk_vecs.items():
    scored = []
    for p_name, p_vec in profiles.items():
        sim = float(np.dot(s_vec, p_vec))
        scored.append((sim, p_name))
    scored.sort(reverse=True)
    if scored:
        best_sim, best_name = scored[0]
        runner_up_sim = scored[1][0] if len(scored) > 1 else 0.0
        margin = best_sim - runner_up_sim
        if best_sim >= 0.54 and margin >= 0.06:
            pairs.append((best_sim, spk, best_name))

pairs.sort(reverse=True)
assigned_spks = set()
assigned_names = set()
result = {{}}
for sim, spk, p_name in pairs:
    if spk not in assigned_spks and p_name not in assigned_names:
        result[spk] = p_name
        assigned_spks.add(spk)
        assigned_names.add(p_name)

print('__ACOUSTIC_MATCH__:' + json.dumps({{'matches': result, 'splits': split_overrides}}))
"""
    matched_map: Dict[str, str] = {}
    try:
        res = subprocess.run([sys.executable, "-c", worker_code], capture_output=True, text=True, timeout=180)
        for line in (res.stdout or "").splitlines():
            if line.startswith("__ACOUSTIC_MATCH__:"):
                out_payload = json.loads(line.split("__ACOUSTIC_MATCH__:", 1)[1])
                matched_map = out_payload.get("matches", {})
                splits = out_payload.get("splits", {})
                for s_idx_str, new_spk_tag in splits.items():
                    s_idx = int(s_idx_str)
                    if 0 <= s_idx < len(segments):
                        segments[s_idx]["speaker"] = new_spk_tag
                if matched_map:
                    print(f"[*] Acoustic Voiceprint Matching Identified: {matched_map}")
    except Exception as e:
        print(f"[!] Notice: Acoustic voiceprint matching skipped ({e})")
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    return matched_map


def resolve_speakers_intelligently(
    segments: List[Dict[str, Any]],
    title: str = "",
    gemini_key: str = "",
    cohere_key: str = "",
    openrouter_key: str = "",
    audio_path: Optional[Path] = None
) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    """Comprehensive multi-tier speaker identification (Acoustic Voiceprints -> LLM with Anchors -> Heuristics)."""
    if not segments:
        return segments, {}

    known_speakers = load_known_speakers()

    # Tier 0: Neural Acoustic Voiceprint Matching (192-dim ECAPA-TDNN)
    acoustic_mappings = resolve_speakers_acoustically(
        segments=segments,
        audio_path=audio_path
    )

    # Pass confirmed acoustic matches into LLM prompt so it can deduce un-enrolled speakers
    llm_mappings = resolve_speakers_llm(
        segments=segments,
        title=title,
        known_speakers=known_speakers,
        gemini_key=gemini_key,
        cohere_key=cohere_key,
        openrouter_key=openrouter_key,
        acoustic_hints=acoustic_mappings
    )

    heuristic_mappings = analyze_conversational_heuristics(
        segments=segments,
        known_speakers=known_speakers
    )

    final_mappings = dict(heuristic_mappings)
    final_mappings.update(llm_mappings)
    final_mappings.update(acoustic_mappings)

    if final_mappings:
        print(f"[*] AI Speaker Resolution Identified:")
        for spk_id, name in final_mappings.items():
            print(f"    • {spk_id} -> {name}")
        for s in segments:
            if s["speaker"] in final_mappings:
                s["speaker"] = final_mappings[s["speaker"]]

    return segments, final_mappings


def _upload_file_to_assemblyai(audio_path: Path, headers: Dict[str, str]) -> str:
    """Streams a local audio file to AssemblyAI's /v2/upload endpoint in 5MB chunks."""
    def _read_chunks(file_path: Path, chunk_size: int = 5242880):
        with open(file_path, "rb") as f:
            while True:
                data = f.read(chunk_size)
                if not data:
                    break
                yield data

    resp = requests.post(
        "https://api.assemblyai.com/v2/upload",
        headers=headers,
        data=_read_chunks(audio_path),
        timeout=600
    )
    if resp.status_code != 200:
        raise RuntimeError(f"AssemblyAI upload failed ({resp.status_code}): {resp.text}")
    return resp.json()["upload_url"]


def transcribe_audio_chunk_assemblyai(
    audio_path: Path,
    assemblyai_key: str,
    time_offset: float = 0.0,
    chunk_prefix: str = "",
    title: str = ""
) -> List[Dict[str, Any]]:
    """
    Transcribes a single audio file or chunk via AssemblyAI Universal-3.5 Pro REST API
    following https://assemblyai.com/docs/llms-full.txt best practices:
    - speech_models: ["universal-3-5-pro", "universal-2"]
    - language_detection: True
    - speaker_labels: True
    - speaker_options: min_speakers_expected=2, max_speakers_expected=10, include_speaker_confidence=True
    - prompt & keyterms_prompt: Universal-3.5 Pro contextual and speaker name prompting
    """
    file_mb = audio_path.stat().st_size / (1024 * 1024)
    print(f"[*] Submitting {audio_path.name} ({file_mb:.1f} MB, offset: {time_offset:.1f}s) to AssemblyAI...")

    headers = {"authorization": assemblyai_key}
    start_t = time.time()
    upload_url = _upload_file_to_assemblyai(audio_path, headers)

    known_speakers = load_known_speakers()
    keyterms = []
    seen_kt = set()
    for spk in known_speakers:
        clean_spk = spk.strip()
        if clean_spk and len(clean_spk.split()) <= 6 and clean_spk.lower() not in seen_kt:
            seen_kt.add(clean_spk.lower())
            keyterms.append(clean_spk)
        if len(keyterms) >= 150:
            break

    clean_title = re.sub(r"[_\-]+", " ", title or audio_path.stem).strip()
    context_prompt = (
        f"Live multi-speaker Twitter Space audio discussion titled '{clean_title}' "
        f"featuring host Logan and regular community speakers."
    )

    payload: Dict[str, Any] = {
        "audio_url": upload_url,
        "speech_models": ["universal-3-5-pro", "universal-2"],
        "language_detection": True,
        "punctuate": True,
        "format_text": True,
        "speaker_labels": True,
        "speaker_options": {
            "min_speakers_expected": 2,
            "max_speakers_expected": 10,
            "include_speaker_confidence": True,
        },
        "prompt": context_prompt,
    }
    if keyterms:
        payload["keyterms_prompt"] = keyterms

    submit_resp = requests.post(
        "https://api.assemblyai.com/v2/transcript",
        headers=headers,
        json=payload,
        timeout=60
    )
    if submit_resp.status_code != 200:
        # Fallback without optional Universal-3.5 Pro prompt/confidence fields if rejected
        payload.pop("prompt", None)
        payload.pop("keyterms_prompt", None)
        if "speaker_options" in payload:
            payload["speaker_options"].pop("include_speaker_confidence", None)
        submit_resp = requests.post(
            "https://api.assemblyai.com/v2/transcript",
            headers=headers,
            json=payload,
            timeout=60
        )
        if submit_resp.status_code != 200:
            raise RuntimeError(f"AssemblyAI submit failed ({submit_resp.status_code}): {submit_resp.text}")

    transcript_id = submit_resp.json()["id"]
    polling_endpoint = f"https://api.assemblyai.com/v2/transcript/{transcript_id}"

    while True:
        poll_resp = requests.get(polling_endpoint, headers=headers, timeout=60)
        if poll_resp.status_code != 200:
            time.sleep(3)
            continue
        t_data = poll_resp.json()
        status = t_data.get("status")
        if status == "completed":
            break
        elif status == "error":
            err_msg = t_data.get("error") or "Unknown error"
            raise RuntimeError(f"AssemblyAI Transcription Error: {err_msg}")
        else:
            time.sleep(3)

    elapsed = time.time() - start_t
    model_used = t_data.get("speech_model_used") or "universal-3-5-pro"
    print(f"[✓] AssemblyAI transcription ({model_used}) completed in {elapsed:.1f}s!")

    segments: List[Dict[str, Any]] = []
    utterances = t_data.get("utterances") or []
    words_top = t_data.get("words") or []

    # 1. Parse speaker utterances with word-level speaker boundary splitting & speaker_confidence
    if utterances:
        for u in utterances:
            raw_u_spk = str(u.get("speaker") or "A").strip()
            if raw_u_spk.lower().startswith("speaker"):
                raw_u_spk = raw_u_spk.split()[-1]
            u_speaker_label = f"Speaker {chunk_prefix}{raw_u_spk}"
            u_spk_conf = float(u.get("speaker_confidence") or 0.90)

            u_words = u.get("words") or []
            if not u_words:
                segments.append({
                    "start": round((float(u.get("start", 0)) / 1000.0) + time_offset, 2),
                    "end": round((float(u.get("end", 0)) / 1000.0) + time_offset, 2),
                    "speaker": u_speaker_label,
                    "speaker_confidence": round(u_spk_conf, 3),
                    "text": (u.get("text") or "").strip(),
                    "words": []
                })
                continue

            # Split utterance if word-level speaker changes mid-utterance (for >= 3 consecutive words)
            runs: List[Tuple[str, List[Dict[str, Any]]]] = []
            for w in u_words:
                w_start = round((float(w.get("start", 0)) / 1000.0) + time_offset, 3)
                w_end = round((float(w.get("end", 0)) / 1000.0) + time_offset, 3)
                conf = round(float(w.get("confidence", 1.0) or 1.0), 3)
                w_spk_conf = round(float(w.get("speaker_confidence") or u_spk_conf), 3)
                w_raw_spk = str(w.get("speaker") or raw_u_spk).strip()
                if w_raw_spk.lower().startswith("speaker"):
                    w_raw_spk = w_raw_spk.split()[-1]
                w_spk_label = f"Speaker {chunk_prefix}{w_raw_spk}"
                w_obj = {
                    "word": w.get("text", ""),
                    "start": w_start,
                    "end": w_end,
                    "confidence": conf,
                    "speaker_confidence": w_spk_conf,
                }
                if runs and runs[-1][0] == w_spk_label:
                    runs[-1][1].append(w_obj)
                else:
                    runs.append((w_spk_label, [w_obj]))

            # Merge tiny 1-2 word flickers back into neighboring run
            cleaned_runs: List[Tuple[str, List[Dict[str, Any]]]] = []
            for spk_lbl, w_list in runs:
                if cleaned_runs and len(w_list) < 3:
                    cleaned_runs[-1][1].extend(w_list)
                else:
                    cleaned_runs.append((spk_lbl, w_list))

            for spk_lbl, w_list in cleaned_runs:
                run_spk_conf = sum(x.get("speaker_confidence", 0.90) for x in w_list) / len(w_list)
                segments.append({
                    "start": round(w_list[0]["start"], 2),
                    "end": round(w_list[-1]["end"], 2),
                    "speaker": spk_lbl,
                    "speaker_confidence": round(run_spk_conf, 3),
                    "text": " ".join(x["word"] for x in w_list).strip(),
                    "words": w_list
                })
    elif words_top:
        # Fallback if utterances is empty but words exist
        curr_words = []
        curr_start = 0.0
        curr_end = 0.0
        curr_spk = f"Speaker {chunk_prefix}A"

        for w in words_top:
            w_start = round((float(w.get("start", 0)) / 1000.0) + time_offset, 3)
            w_end = round((float(w.get("end", 0)) / 1000.0) + time_offset, 3)
            spk_tag = w.get("speaker")
            spk_name = f"Speaker {chunk_prefix}{spk_tag}" if spk_tag else f"Speaker {chunk_prefix}A"

            if spk_name != curr_spk and curr_words:
                segments.append({
                    "start": curr_start,
                    "end": curr_end,
                    "speaker": curr_spk,
                    "text": " ".join([x["word"] for x in curr_words]),
                    "words": curr_words
                })
                curr_words = []
                curr_spk = spk_name
                curr_start = w_start

            if not curr_words:
                curr_start = w_start
                curr_spk = spk_name

            curr_end = w_end
            curr_words.append({
                "word": w.get("text", ""),
                "start": w_start,
                "end": w_end,
                "confidence": round(float(w.get("confidence", 1.0) or 1.0), 3)
            })

        if curr_words:
            segments.append({
                "start": curr_start,
                "end": curr_end,
                "speaker": curr_spk,
                "text": " ".join([x["word"] for x in curr_words]),
                "words": curr_words
            })
    elif t_data.get("text"):
        # Monologue fallback
        dur = float(t_data.get("audio_duration") or 0.0)
        segments.append({
            "start": round(time_offset, 2),
            "end": round(time_offset + dur, 2),
            "speaker": f"Speaker {chunk_prefix}A",
            "text": (t_data.get("text") or "").strip(),
            "words": []
        })

    return segments


def process_audio_file(
    input_audio: Path,
    assemblyai_key: str,
    gemini_key: str,
    title: str,
    output_dir: Path,
    cohere_key: str = "",
    openrouter_key: str = ""
) -> Tuple[Path, Path, Path, float]:
    """Processes an audio file through AssemblyAI with compression and marathon chunking if needed."""
    file_size = input_audio.stat().st_size
    duration_sec = get_audio_duration(input_audio)
    print(f"\n[*] Audio File Inspection: {input_audio.name}")
    print(f"    • Size: {file_size / (1024*1024):.1f} MB")
    print(f"    • Duration: {format_timestamp(duration_sec)} ({duration_sec:.1f}s)")

    active_audio = input_audio

    # 1. Compression Workaround: Preserve 24kHz 64kbps vocal formants for accurate speaker separation
    if file_size > 1.5 * (1024 ** 3) or input_audio.suffix.lower() == ".wav":
        print(f"\n[⚡ Auto-Compression] Large file detected ({file_size / (1024*1024):.1f} MB).")
        print(f"[*] Re-encoding to 24kHz 64kbps mono speech stream via FFmpeg (preserving vocal timbre)...")
        compressed_audio = input_audio.parent / f"{input_audio.stem}_compressed.mp3"
        compress_cmd = [
            FFMPEG_EXE, "-y",
            "-i", str(input_audio),
            "-ac", "1",
            "-ar", "24000",
            "-b:a", "64k",
            str(compressed_audio)
        ]
        try:
            res_comp = subprocess.run(compress_cmd, capture_output=True, text=True, errors="replace")
            if res_comp.returncode == 0 and compressed_audio.exists():
                new_size = compressed_audio.stat().st_size
                pct = (1.0 - (new_size / file_size)) * 100
                print(f"[✓] Compression Complete: {new_size / (1024*1024):.1f} MB ({pct:.1f}% size reduction!)")
                active_audio = compressed_audio
                file_size = new_size
        except Exception as e:
            print(f"[!] Notice: FFmpeg compression skipped ({e}); proceeding with original audio.")

    # 2. Marathon Space Chunking: If duration > 10 hours (AssemblyAI single-file limit is 10 hours)
    all_segments: List[Dict[str, Any]] = []

    if duration_sec > 36000.0 or file_size > 2.0 * (1024 ** 3):
        chunk_seconds = 14400  # 4-hour slices
        print(f"\n[⚡ Marathon Space Workaround] Extremely long Space detected ({format_timestamp(duration_sec)}).")
        print(f"[*] Slicing audio into 4-hour segments via FFmpeg...")

        chunks_dir = input_audio.parent / "audio_chunks"
        chunks_dir.mkdir(parents=True, exist_ok=True)
        chunk_pattern = str(chunks_dir / "chunk_%03d.mp3")

        split_cmd = [
            FFMPEG_EXE, "-y",
            "-i", str(active_audio),
            "-f", "segment",
            "-segment_time", str(chunk_seconds),
            "-c", "copy",
            chunk_pattern
        ]
        try:
            subprocess.run(split_cmd, capture_output=True, text=True, errors="replace")
            chunk_files = sorted(list(chunks_dir.glob("chunk_*.mp3")))

            if chunk_files:
                print(f"[✓] Successfully sliced audio into {len(chunk_files)} segment(s).")
                current_offset = 0.0

                for idx, c_file in enumerate(chunk_files, 1):
                    c_dur = get_audio_duration(c_file)
                    print(f"\n--- Processing Chunk [{idx}/{len(chunk_files)}]: {c_file.name} ({format_timestamp(c_dur)}) ---")
                    chunk_segs = transcribe_audio_chunk_assemblyai(
                        audio_path=c_file,
                        assemblyai_key=assemblyai_key,
                        time_offset=current_offset,
                        chunk_prefix=f"C{idx}_" if len(chunk_files) > 1 else "",
                        title=title
                    )
                    all_segments.extend(chunk_segs)
                    current_offset += c_dur if c_dur > 0 else chunk_seconds

                shutil.rmtree(chunks_dir, ignore_errors=True)
            else:
                all_segments = transcribe_audio_chunk_assemblyai(
                    audio_path=active_audio,
                    assemblyai_key=assemblyai_key,
                    time_offset=0.0,
                    title=title
                )
        except Exception as e:
            print(f"[!] Slicing failed ({e}); submitting as direct audio stream.")
            all_segments = transcribe_audio_chunk_assemblyai(
                audio_path=active_audio,
                assemblyai_key=assemblyai_key,
                time_offset=0.0,
                title=title
            )
    else:
        # Standard Single-Pass AssemblyAI transcription
        all_segments = transcribe_audio_chunk_assemblyai(
            audio_path=active_audio,
            assemblyai_key=assemblyai_key,
            time_offset=0.0,
            title=title
        )

    # Clean temporary compressed audio if generated
    if active_audio != input_audio and active_audio.exists():
        try:
            active_audio.unlink(missing_ok=True)
        except Exception:
            pass

    # Merge tight intra-sentence pauses (<0.6s) with the same speaker
    merged: List[Dict[str, Any]] = []
    for s in all_segments:
        text = s["text"].strip()
        if not text:
            continue
        if (
            merged
            and merged[-1]["speaker"] == s["speaker"]
            and (s["start"] - merged[-1]["end"]) < 0.6
            and not any(merged[-1]["text"].endswith(p) for p in [".", "!", "?", ".\"", "!\"", "?\""])
        ):
            merged[-1]["end"] = s["end"]
            merged[-1]["text"] += " " + text
            if "words" in s or "words" in merged[-1]:
                m_words = merged[-1].get("words", [])
                s_words = s.get("words", [])
                merged[-1]["words"] = m_words + s_words
        else:
            merged.append(s)

    all_segments = merged

    # AI Contextual & Acoustic Speaker Resolution
    all_segments, _ = resolve_speakers_intelligently(
        segments=all_segments,
        title=title,
        gemini_key=gemini_key,
        cohere_key=cohere_key,
        openrouter_key=openrouter_key,
        audio_path=input_audio
    )

    # Compute speaker talk time stats
    speaker_talk_time: Dict[str, float] = {}
    for s in all_segments:
        spk = s["speaker"]
        speaker_talk_time[spk] = round(speaker_talk_time.get(spk, 0.0) + (s["end"] - s["start"]), 1)

    print(f"\n[Speaker Breakdown]")
    for spk, secs in sorted(speaker_talk_time.items(), key=lambda x: x[1], reverse=True):
        print(f"  • {spk}: {format_timestamp(secs)} ({secs/60:.1f} min)")

    # Output filenames
    safe_title = re.sub(r'[\\/*?:"<>|]', "", title).replace(" ", "_").strip(". ")
    if not safe_title:
        safe_title = "transcript"

    output_dir.mkdir(parents=True, exist_ok=True)
    txt_path = output_dir / f"{safe_title}.txt"
    srt_path = output_dir / f"{safe_title}.srt"
    json_path = output_dir / f"{safe_title}.json"

    # 1. Text transcript
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(f"=== TRANSCRIPT: {title} ===\n")
        f.write(f"Duration: {format_timestamp(duration_sec)}\n")
        f.write(f"Generated: {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}\n")
        f.write(f"Engine: AssemblyAI Universal-3.5 Pro (Cloud Diarization)\n\n")
        for s in all_segments:
            f.write(f"[{format_timestamp(s['start'])} - {format_timestamp(s['end'])}] {s['speaker']}: {s['text']}\n\n")

    # 2. SRT transcript
    with open(srt_path, "w", encoding="utf-8") as f:
        if all_segments:
            for i, s in enumerate(all_segments, 1):
                f.write(f"{i}\n{format_timestamp(s['start'], srt=True)} --> {format_timestamp(s['end'], srt=True)}\n{s['speaker']}: {s['text']}\n\n")
        else:
            f.write("1\n00:00:00,000 --> 00:00:01,000\n[Silence]\n\n")

    # 3. JSON transcript (matches exact app schema)
    payload = {
        "title": title,
        "source": input_audio.name,
        "duration_seconds": duration_sec,
        "duration_formatted": format_timestamp(duration_sec),
        "model": "assemblyai-universal-3-5-pro",
        "speakers_detected": list(speaker_talk_time.keys()),
        "speaker_talk_time": speaker_talk_time,
        "segments": all_segments
    }
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    return txt_path, srt_path, json_path, duration_sec


def main():
    parser = argparse.ArgumentParser(description="AssemblyAI Universal-3.5 Pro Cloud Audio Transcriber & Highlight Extractor")
    parser.add_argument("--release-tag", type=str, required=True, help="GitHub release tag (e.g. 20260918_1MJgNbdaAPlGL)")
    parser.add_argument("--part", type=int, default=0, help="Specific audio part (0 for all)")
    parser.add_argument("--force", action="store_true", help="Force re-transcribe even if transcript exists")
    parser.add_argument("--repo", type=str, default="aiandbotsgalore/copy-spaces-to-youtube-pipeline", help="GitHub repo")
    args = parser.parse_args()

    assemblyai_key = os.environ.get("ASSEMBLYAI_API_KEY", "").strip()
    if not assemblyai_key:
        print("[🛑] CRITICAL ERROR: ASSEMBLYAI_API_KEY environment variable is not set!")
        print("     Please add ASSEMBLYAI_API_KEY to your GitHub Secrets or environment.")
        sys.exit(1)

    gh_token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN", "")
    gemini_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY", "")
    cohere_key = os.environ.get("COHERE_API_KEY", "").strip()
    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "").strip()

    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "SpacePipe-AssemblyAITranscriber"
    }
    if gh_token:
        headers["Authorization"] = f"token {gh_token}"

    rel_url = f"https://api.github.com/repos/{args.repo}/releases/tags/{args.release_tag}"
    print(f"[*] Fetching Release details for {args.release_tag}...")
    resp = requests.get(rel_url, headers=headers)
    if resp.status_code != 200:
        print(f"[!] Failed to fetch release {args.release_tag}: status {resp.status_code}")
        sys.exit(1)

    release_data = resp.json()
    release_body = release_data.get("body") or ""
    spk_meta = re.search(r"METADATA::SPEAKERS::(.+?)(?:\r?\n|$)", release_body)
    if not spk_meta:
        spk_meta = re.search(r"\*\*(?:Speakers|Host):\*\*\s*(.+?)(?:\r?\n|$)", release_body)
    if spk_meta:
        os.environ["EPISODE_SPEAKER_HINTS"] = spk_meta.group(1).strip()
        print(f"[*] Loaded speaker metadata hints from Release: {os.environ['EPISODE_SPEAKER_HINTS']}")

    assets = release_data.get("assets", [])
    upload_url_template = release_data.get("upload_url", "").split("{")[0]

    mp3_assets = [a for a in assets if a["name"].endswith(".mp3") and not a["name"].startswith("clip_")]
    if not mp3_assets:
        print(f"[!] No eligible MP3 assets found in release {args.release_tag}.")
        sys.exit(0)

    if args.part > 0 and args.part <= len(mp3_assets):
        mp3_assets = [mp3_assets[args.part - 1]]

    work_dir = Path(tempfile.gettempdir()) / "spacepipe_assemblyai_work"
    work_dir.mkdir(parents=True, exist_ok=True)
    output_dir = work_dir / "output_transcripts"
    output_dir.mkdir(parents=True, exist_ok=True)

    processed_count = 0

    for idx, mp3_asset in enumerate(mp3_assets, 1):
        mp3_name = mp3_asset["name"]
        stem = Path(mp3_name).stem
        mp3_url = mp3_asset["browser_download_url"]

        existing_json_asset = next((a for a in assets if a["name"] == f"{stem}.json"), None)
        existing_clips_asset = next((a for a in assets if a["name"] == f"{stem}_clips.json"), None)

        if existing_json_asset and existing_clips_asset and not args.force:
            print(f"[✓] {mp3_name} already has transcript and clips. Skipping.")
            continue

        local_mp3 = work_dir / mp3_name
        print(f"\n========================================================")
        print(f"[*] [{idx}/{len(mp3_assets)}] Processing: {mp3_name}")
        print(f"[*] Downloading audio stream to runner scratch disk...")
        dl_resp = requests.get(mp3_url, headers=headers, stream=True)
        dl_resp.raise_for_status()
        with open(local_mp3, "wb") as f:
            for chunk in dl_resp.iter_content(chunk_size=1048576):
                f.write(chunk)
        print(f"[✓] Download Complete: {local_mp3.stat().st_size / (1024*1024):.1f} MB")

        json_path = output_dir / f"{stem}.json"
        txt_path = output_dir / f"{stem}.txt"
        srt_path = output_dir / f"{stem}.srt"

        if existing_json_asset and not args.force:
            print(f"[*] Transcript already exists ({existing_json_asset['name']}). Downloading for highlight clips...")
            j_resp = requests.get(existing_json_asset["browser_download_url"], headers=headers)
            with open(json_path, "wb") as f:
                f.write(j_resp.content)
        else:
            space_title = release_data.get("name") or stem
            txt_path, srt_path, json_path, _ = process_audio_file(
                input_audio=local_mp3,
                assemblyai_key=assemblyai_key,
                gemini_key=gemini_key,
                title=space_title,
                output_dir=output_dir,
                cohere_key=cohere_key,
                openrouter_key=openrouter_key
            )

        # Highlight clip extraction via Gemini Flash
        clips_dir = work_dir / "best_saved_clips"
        shutil.rmtree(clips_dir, ignore_errors=True)
        clips_dir.mkdir(parents=True, exist_ok=True)

        if json_path.exists():
            print(f"\n[*] Extracting AI Highlight Clips via Gemini Flash...")
            clipper_script = Path("scripts/find_and_cut_best_clips.py")
            if clipper_script.exists():
                cmd_clips = [
                    sys.executable, str(clipper_script),
                    "--json", str(json_path),
                    "--audio", str(local_mp3),
                    "--limit", "5"
                ]
                try:
                    subprocess.run(cmd_clips, timeout=300)
                except Exception as e:
                    print(f"[!] Notice: Clip extraction skipped: {e}")

        # Gather files to upload
        to_upload = [p for p in [txt_path, srt_path, json_path] if p.exists() and p.stat().st_size > 0]
        if clips_dir.exists():
            for c_file in clips_dir.glob("**/*.*"):
                if c_file.is_file() and c_file.suffix.lower() in [".mp3", ".json", ".md"] and c_file.stat().st_size > 0:
                    if c_file not in to_upload:
                        to_upload.append(c_file)

        # Upload back to GitHub Release
        cur_assets_resp = requests.get(rel_url, headers=headers)
        latest_assets = cur_assets_resp.json().get("assets", []) if cur_assets_resp.status_code == 200 else assets
        existing_asset_map = {a["name"]: a["id"] for a in latest_assets}

        print(f"\n[*] Uploading {len(to_upload)} asset(s) to GitHub Release {args.release_tag}...")
        for f_path in to_upload:
            f_name = f_path.name
            if f_name in existing_asset_map:
                del_id = existing_asset_map[f_name]
                del_url = f"https://api.github.com/repos/{args.repo}/releases/assets/{del_id}"
                requests.delete(del_url, headers=headers)

            safe_name = urllib.parse.quote(f_name)
            u_headers = {
                "Content-Type": "application/octet-stream",
                "User-Agent": "SpacePipe-AssemblyAITranscriber"
            }
            if gh_token:
                u_headers["Authorization"] = f"token {gh_token}"

            with open(f_path, "rb") as f_data:
                up_resp = requests.post(f"{upload_url_template}?name={safe_name}", headers=u_headers, data=f_data)
                if up_resp.status_code in [200, 201]:
                    print(f"  [✓] Uploaded: {f_name}")
                else:
                    print(f"  [!] Failed uploading {f_name}: {up_resp.status_code}")

        # Clean scratch audio & clip files
        try:
            local_mp3.unlink(missing_ok=True)
            shutil.rmtree(clips_dir, ignore_errors=True)
        except Exception:
            pass

        processed_count += 1

    print(f"\n[🎉] AssemblyAI Transcription Completed for {args.release_tag} ({processed_count} asset(s) processed)!")


if __name__ == "__main__":
    main()
