#!/usr/bin/env python3
"""
scripts/deepgram_transcriber.py - Deepgram Nova-2 Cloud Audio Transcriber & Highlight Extractor

Transcribes Twitter Spaces 100% in the cloud via Deepgram Nova-2 with:
- Neural speech-to-text with precise millisecond word-level timestamps
- Automatic multi-speaker diarization
- Automated 2GB Workaround:
  * Auto-compression via FFmpeg (48kbps mono) for high-bitrate/uncompressed audio near 2GB
  * Lossless 2-hour chunking & timestamp offset stitching for extreme marathon spaces (>3.5 hours or >1.8 GB)
- Gemini 2.5 Flash contextual speaker discovery (identifying Logan, guests, etc.)
- AI Highlight Clip extraction & cutting (via scripts/find_and_cut_best_clips.py)
- Direct upload of .txt, .srt, .json, and clips to GitHub Release assets
- Zero local PC disk/bandwidth usage (runs in GitHub Actions cloud runners)
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

FFMPEG_EXE = shutil.which("ffmpeg") or "ffmpeg"
FFPROBE_EXE = shutil.which("ffprobe") or "ffprobe"


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

    # Fallback to parsing ffmpeg stderr
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
            break

    return sorted(list(known_set))


def resolve_speakers_llm(
    segments: List[Dict[str, Any]],
    title: str,
    known_speakers: List[str],
    gemini_key: str = "",
    cohere_key: str = "",
    openrouter_key: str = ""
) -> Dict[str, str]:
    """Tries resolving speaker names via LLM with full context (Gemini -> Cohere -> OpenRouter)."""
    if not segments:
        return {}

    total_segs = len(segments)
    sample_candidates = segments if total_segs <= 120 else (
        segments[:60] + segments[max(60, (total_segs // 2) - 20):max(60, (total_segs // 2) + 20)] + segments[-40:]
    )
    sample_lines = [f"[{s['start']:.1f}s] {s['speaker']}: {s['text']}" for s in sample_candidates]
    transcript_sample = "\n".join(sample_lines)

    prompt = f"""You are an expert audio diarization analyst. Identify the real names of the generic speakers (e.g. Speaker 0, Speaker 1, etc.) in this Twitter Space transcript.

Space Title: {title}
Known Community Hosts & Recurring Speakers: {', '.join(known_speakers)}

Diarization & Identification Rules:
1. Direct Self-Introductions: Look for speakers introducing themselves (e.g. "I'm Angela", "This is Logan").
2. Direct Conversational Address: Look for when one speaker directly addresses another (e.g. "Good morning Angela, thanks for hosting", "I agree with you Angela"). Note who was speaking before or after.
3. Third-Person vs Direct Address: Do NOT confuse talking ABOUT a person (e.g. "we are reading Logan Black chats", "Logan was unmasked") with the person speaking! If a host is discussing someone, the host is NOT that subject unless they explicitly say so.
4. Host Identification: The dominant speaker who is addressed as host by participants is the host.
5. Only map speakers you are confident about (confidence >= 0.70). Do not use generic labels like "Unknown" or "Speaker".

Return a valid JSON object with this exact schema:
{{
  "speaker_mappings": [
    {{"speaker_id": "Speaker 0", "identified_name": "Angela", "confidence": 0.95}}
  ]
}}

Transcript sample:
{transcript_sample}
"""

    generic_tokens = {"participant", "unknown", "listener", "guest", "someone", "unidentified", "audience", "none"}

    def parse_speaker_json(text: str) -> Dict[str, str]:
        if not text:
            return {}
        clean_text = text.strip()
        if "```" in clean_text:
            clean_text = re.sub(r"^```(?:json)?\s*|\s*```$", "", clean_text, flags=re.MULTILINE).strip()
        match = re.search(r"\{[\s\S]*\}", clean_text)
        if match:
            clean_text = match.group(0)
        try:
            parsed = json.loads(clean_text)
            mappings = {}
            for m in parsed.get("speaker_mappings", []):
                spk_id = m.get("speaker_id", "")
                name = m.get("identified_name", "").strip()
                conf = float(m.get("confidence", 0.0))
                if spk_id and name and conf >= 0.70:
                    if not any(token in name.lower() for token in generic_tokens) and not name.lower().startswith("speaker"):
                        mappings[spk_id] = name
            return mappings
        except Exception:
            return {}

    # 1. Try Gemini Flash
    if gemini_key:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={gemini_key}"
            headers = {"Content-Type": "application/json"}
            payload = {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"responseMimeType": "application/json"}
            }
            resp = requests.post(url, headers=headers, json=payload, timeout=30)
            if resp.status_code == 200:
                raw_text = resp.json().get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                res = parse_speaker_json(raw_text)
                if res:
                    print(f"[*] Resolved speakers via Gemini Flash: {res}")
                    return res
        except Exception as e:
            print(f"[!] Notice: Gemini speaker resolution skipped: {e}")

    # 2. Try Cohere Command Fallback
    if cohere_key:
        try:
            url = "https://api.cohere.ai/v1/chat"
            headers = {
                "Authorization": f"Bearer {cohere_key}",
                "Content-Type": "application/json"
            }
            payload = {
                "message": prompt,
                "temperature": 0.1,
                "response_format": {"type": "json_object"}
            }
            resp = requests.post(url, headers=headers, json=payload, timeout=30)
            if resp.status_code == 200:
                raw_text = resp.json().get("text", "")
                res = parse_speaker_json(raw_text)
                if res:
                    print(f"[*] Resolved speakers via Cohere Command: {res}")
                    return res
        except Exception as e:
            print(f"[!] Notice: Cohere speaker resolution skipped: {e}")

    # 3. Try OpenRouter Fallback
    if openrouter_key:
        for m_slug in ["google/gemini-2.5-flash", "openai/gpt-4o-mini"]:
            try:
                url = "https://openrouter.ai/api/v1/chat/completions"
                headers = {
                    "Authorization": f"Bearer {openrouter_key}",
                    "Content-Type": "application/json"
                }
                payload = {
                    "model": m_slug,
                    "messages": [{"role": "user", "content": prompt}],
                    "response_format": {"type": "json_object"}
                }
                resp = requests.post(url, headers=headers, json=payload, timeout=30)
                if resp.status_code == 200:
                    raw_text = resp.json()["choices"][0]["message"]["content"]
                    res = parse_speaker_json(raw_text)
                    if res:
                        print(f"[*] Resolved speakers via OpenRouter ({m_slug}): {res}")
                        return res
            except Exception:
                pass

    return {}


def analyze_conversational_heuristics(
    segments: List[Dict[str, Any]],
    known_speakers: List[str]
) -> Dict[str, str]:
    """Deterministic, zero-API conversational analyzer detecting self-intros and vocatives."""
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

        # 1. Self introductions
        for intro in self_intro_re.findall(text):
            target = next(n for n in known_speakers if n.lower() == intro.lower())
            speaker_scores[spk][target] += 10.0

        # 2. Direct address
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
        if not scores:
            continue
        best_name, best_score = max(scores.items(), key=lambda x: x[1])
        if best_name in assigned:
            continue
        if best_score >= 5.0:
            mappings[spk] = best_name
            assigned.add(best_name)

    return mappings


def resolve_speakers_intelligently(
    segments: List[Dict[str, Any]],
    title: str = "",
    gemini_key: str = "",
    cohere_key: str = "",
    openrouter_key: str = ""
) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    """Comprehensive multi-tier speaker identification."""
    if not segments:
        return segments, {}

    known_speakers = load_known_speakers()

    # Tier 1: Try LLM resolution with full context
    llm_mappings = resolve_speakers_llm(
        segments=segments,
        title=title,
        known_speakers=known_speakers,
        gemini_key=gemini_key,
        cohere_key=cohere_key,
        openrouter_key=openrouter_key
    )

    # Tier 2: Deterministic conversational analysis
    heuristic_mappings = analyze_conversational_heuristics(
        segments=segments,
        known_speakers=known_speakers
    )

    # Combine mappings (LLM prioritized, filled by heuristics)
    final_mappings = dict(heuristic_mappings)
    final_mappings.update(llm_mappings)

    if final_mappings:
        print(f"[*] AI Speaker Resolution Identified:")
        for spk_id, name in final_mappings.items():
            print(f"    • {spk_id} -> {name}")
        for s in segments:
            if s["speaker"] in final_mappings:
                s["speaker"] = final_mappings[s["speaker"]]

    return segments, final_mappings


def resolve_speakers_with_gemini(segments: List[Dict[str, Any]], gemini_api_key: str) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    """Backwards compatibility alias for resolve_speakers_intelligently."""
    cohere_key = os.environ.get("COHERE_API_KEY", "")
    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "")
    return resolve_speakers_intelligently(segments, gemini_key=gemini_api_key, cohere_key=cohere_key, openrouter_key=openrouter_key)


def transcribe_audio_chunk_deepgram(
    audio_path: Path,
    deepgram_key: str,
    time_offset: float = 0.0
) -> List[Dict[str, Any]]:
    """Transcribes a single audio file/chunk with Deepgram Nova-2 with word-level speaker diarization."""
    print(f"[*] Submitting {audio_path.name} ({audio_path.stat().st_size / (1024*1024):.1f} MB, offset: {time_offset:.1f}s) to Deepgram Nova-2...")

    # Fix 3: Deepgram Diarization Tuning
    # - diarize=true: enables speaker diarization
    # - filler_words=true: retains interjections (yeah, uh-huh, right) with proper speaker attribution
    # - smart_format=true & punctuate=true: clean formatting
    # - Omit coarse utterances=true so we build exact turn boundaries from word-level speaker tags
    endpoint = (
        "https://api.deepgram.com/v1/listen?"
        "model=nova-2&"
        "smart_format=true&"
        "diarize=true&"
        "punctuate=true&"
        "filler_words=true"
    )

    headers = {
        "Authorization": f"Token {deepgram_key}",
        "Content-Type": "audio/mpeg"
    }

    start_t = time.time()
    with open(audio_path, "rb") as f:
        resp = requests.post(endpoint, headers=headers, data=f, timeout=900)

    elapsed = time.time() - start_t

    if resp.status_code != 200:
        err_detail = resp.text[:300]
        if resp.status_code == 401 or resp.status_code == 403:
            raise RuntimeError(f"Deepgram Authentication Failed: Invalid or missing API key. ({err_detail})")
        if "INSUFFICIENT_FUNDS" in resp.text or "spend limit" in resp.text.lower() or "credits" in resp.text.lower():
            raise RuntimeError(f"Deepgram Insufficient Credits: {err_detail}")
        raise RuntimeError(f"Deepgram API error {resp.status_code}: {err_detail}")

    result = resp.json()
    print(f"[✓] Deepgram transcription completed in {elapsed:.1f}s!")

    # Fix 1: Word-Level State Machine
    # Use word-by-word speaker tags as the primary source of truth for crisp turn boundaries
    alts = result.get("results", {}).get("channels", [{}])[0].get("alternatives", [{}])[0]
    words = alts.get("words", [])
    segments: List[Dict[str, Any]] = []

    if words:
        curr_speaker = None
        curr_start = 0.0
        curr_end = 0.0
        curr_words: List[str] = []

        for w in words:
            spk_id = w.get("speaker", 0)
            spk = f"Speaker {spk_id}"
            word_text = (w.get("punctuated_word") or w.get("word", "")).strip()
            if not word_text:
                continue

            w_start = w.get("start", 0.0) + time_offset
            w_end = w.get("end", 0.0) + time_offset

            if curr_speaker is None:
                curr_speaker = spk
                curr_start = w_start
                curr_end = w_end
                curr_words = [word_text]
            elif curr_speaker == spk:
                # Same speaker continues
                # If there's a significant pause (>2.5s) AND the previous word ended a sentence,
                # split into a new segment for visual readability
                last_word = curr_words[-1] if curr_words else ""
                sentence_ended = any(last_word.endswith(p) for p in [".", "!", "?", ".\"", "!\"", "?\""])
                pause_gap = w_start - curr_end

                if pause_gap > 2.5 and sentence_ended:
                    segments.append({
                        "start": round(curr_start, 2),
                        "end": round(curr_end, 2),
                        "speaker": curr_speaker,
                        "text": " ".join(curr_words).strip()
                    })
                    curr_start = w_start
                    curr_end = w_end
                    curr_words = [word_text]
                else:
                    curr_words.append(word_text)
                    curr_end = w_end
            else:
                # Speaker SWITCH: immediately flush previous speaker's turn!
                if curr_words:
                    segments.append({
                        "start": round(curr_start, 2),
                        "end": round(curr_end, 2),
                        "speaker": curr_speaker,
                        "text": " ".join(curr_words).strip()
                    })
                curr_speaker = spk
                curr_start = w_start
                curr_end = w_end
                curr_words = [word_text]

        if curr_words:
            segments.append({
                "start": round(curr_start, 2),
                "end": round(curr_end, 2),
                "speaker": curr_speaker,
                "text": " ".join(curr_words).strip()
            })
    else:
        # Fallback to coarse utterances only if word-level data is unavailable
        utterances = result.get("results", {}).get("utterances", [])
        for u in utterances:
            text = u.get("transcript", "").strip()
            if not text:
                continue
            spk_num = u.get("speaker", 0)
            segments.append({
                "start": round(u.get("start", 0.0) + time_offset, 2),
                "end": round(u.get("end", 0.0) + time_offset, 2),
                "speaker": f"Speaker {spk_num}",
                "text": text
            })

    return segments


def process_audio_file(
    input_audio: Path,
    deepgram_key: str,
    gemini_key: str,
    title: str,
    output_dir: Path,
    cohere_key: str = "",
    openrouter_key: str = ""
) -> Tuple[Path, Path, Path, float]:
    """Processes an audio file through the 2GB Workaround Pipeline and Deepgram Nova-2."""
    file_size = input_audio.stat().st_size
    duration_sec = get_audio_duration(input_audio)
    print(f"\n[*] Audio File Inspection: {input_audio.name}")
    print(f"    • Size: {file_size / (1024*1024):.1f} MB")
    print(f"    • Duration: {format_timestamp(duration_sec)} ({duration_sec:.1f}s)")

    active_audio = input_audio

    # -------------------------------------------------------------------------
    # 2GB Workaround - Tier 1: Cloud Re-Encoding (Auto-Compression)
    # If audio is > 1.5 GB or uncompressed WAV, re-encode to 48kbps mono MP3.
    # -------------------------------------------------------------------------
    if file_size > 1.5 * (1024 ** 3) or input_audio.suffix.lower() == ".wav":
        print(f"\n[⚡ 2GB Workaround Tier 1] Large file detected ({file_size / (1024*1024):.1f} MB).")
        print(f"[*] Re-encoding to high-efficiency 48kbps mono speech stream via FFmpeg...")
        compressed_audio = input_audio.parent / f"{input_audio.stem}_compressed.mp3"
        compress_cmd = [
            FFMPEG_EXE, "-y",
            "-i", str(input_audio),
            "-ac", "1",
            "-ar", "16000",
            "-b:a", "48k",
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
            else:
                print(f"[!] Notice: FFmpeg compression skipped; proceeding with original audio.")
        except Exception as ffmpeg_err:
            print(f"[!] Notice: FFmpeg execution unavailable ({ffmpeg_err}); proceeding with original audio.")

    # -------------------------------------------------------------------------
    # 2GB Workaround - Tier 2: Lossless Cloud Audio Chunking & Stitching
    # If duration > 3.5 hours (12,600s) or file is still > 1.8 GB:
    # Slice into 2-hour segments, transcribe with Deepgram, and stitch timestamps.
    # -------------------------------------------------------------------------
    all_segments: List[Dict[str, Any]] = []

    if duration_sec > 12600.0 or file_size > 1.8 * (1024 ** 3):
        chunk_seconds = 7200  # 2-hour slices
        print(f"\n[⚡ 2GB Workaround Tier 2] Marathon Space detected ({format_timestamp(duration_sec)}).")
        print(f"[*] Slicing audio into 2-hour lossless segments via FFmpeg...")

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
            res_split = subprocess.run(split_cmd, capture_output=True, text=True, errors="replace")
            chunk_files = sorted(list(chunks_dir.glob("chunk_*.mp3")))

            if res_split.returncode == 0 and chunk_files:
                print(f"[✓] Successfully sliced audio into {len(chunk_files)} segment(s).")
                current_offset = 0.0

                for idx, c_file in enumerate(chunk_files, 1):
                    c_dur = get_audio_duration(c_file)
                    print(f"\n--- Processing Chunk [{idx}/{len(chunk_files)}]: {c_file.name} ({format_timestamp(c_dur)}) ---")
                    chunk_segs = transcribe_audio_chunk_deepgram(
                        audio_path=c_file,
                        deepgram_key=deepgram_key,
                        time_offset=current_offset
                    )
                    all_segments.extend(chunk_segs)
                    current_offset += c_dur if c_dur > 0 else chunk_seconds

                shutil.rmtree(chunks_dir, ignore_errors=True)
            else:
                print(f"[!] Slicing skipped; submitting as direct audio stream.")
                all_segments = transcribe_audio_chunk_deepgram(
                    audio_path=active_audio,
                    deepgram_key=deepgram_key,
                    time_offset=0.0
                )
        except Exception as split_err:
            print(f"[!] Slicing unavailable ({split_err}); submitting as direct audio stream.")
            all_segments = transcribe_audio_chunk_deepgram(
                audio_path=active_audio,
                deepgram_key=deepgram_key,
                time_offset=0.0
            )
    else:
        # Standard Single-Pass Deepgram transcription
        all_segments = transcribe_audio_chunk_deepgram(
            audio_path=active_audio,
            deepgram_key=deepgram_key,
            time_offset=0.0
        )

    # Clean temporary compressed audio if generated
    if active_audio != input_audio and active_audio.exists():
        try:
            active_audio.unlink(missing_ok=True)
        except Exception:
            pass

    # Fix 2: Prevent aggressive merging across sentences or distinct thoughts.
    # Only merge tight intra-sentence fragments (<0.6s) without sentence terminators.
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
        else:
            merged.append(s)

    all_segments = merged

    # AI Contextual Speaker Resolution
    all_segments, _ = resolve_speakers_intelligently(
        segments=all_segments,
        title=title,
        gemini_key=gemini_key,
        cohere_key=cohere_key,
        openrouter_key=openrouter_key
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
        f.write(f"Engine: Deepgram Nova-2 (Cloud Diarization)\n\n")
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
        "model": "deepgram-nova-2",
        "speakers_detected": list(speaker_talk_time.keys()),
        "speaker_talk_time": speaker_talk_time,
        "segments": all_segments
    }
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    return txt_path, srt_path, json_path, duration_sec


def main():
    parser = argparse.ArgumentParser(description="Deepgram Nova-2 Cloud Audio Transcriber & Highlight Extractor")
    parser.add_argument("--release-tag", type=str, required=True, help="GitHub release tag (e.g. 20260918_1MJgNbdaAPlGL)")
    parser.add_argument("--part", type=int, default=0, help="Specific audio part (0 for all)")
    parser.add_argument("--force", action="store_true", help="Force re-transcribe even if transcript exists")
    parser.add_argument("--repo", type=str, default="aiandbotsgalore/copy-spaces-to-youtube-pipeline", help="GitHub repo")
    args = parser.parse_args()

    deepgram_key = os.environ.get("DEEPGRAM_API_KEY", "").strip()
    if not deepgram_key:
        print("[🛑] CRITICAL ERROR: DEEPGRAM_API_KEY environment variable is not set!")
        print("     Please add DEEPGRAM_API_KEY to your GitHub Secrets or environment.")
        sys.exit(1)

    gh_token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN", "")
    gemini_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY", "")
    cohere_key = os.environ.get("COHERE_API_KEY", "").strip()
    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "").strip()

    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "SpacePipe-DeepgramTranscriber"
    }
    if gh_token:
        headers["Authorization"] = f"token {gh_token}"

    # Fetch release info
    rel_url = f"https://api.github.com/repos/{args.repo}/releases/tags/{args.release_tag}"
    print(f"[*] Fetching Release details for {args.release_tag}...")
    resp = requests.get(rel_url, headers=headers)
    if resp.status_code != 200:
        print(f"[!] Failed to fetch release {args.release_tag}: status {resp.status_code}")
        sys.exit(1)

    release_data = resp.json()
    assets = release_data.get("assets", [])
    upload_url_template = release_data.get("upload_url", "").split("{")[0]

    mp3_assets = [a for a in assets if a["name"].endswith(".mp3") and not a["name"].startswith("clip_")]
    if not mp3_assets:
        print(f"[!] No eligible MP3 assets found in release {args.release_tag}.")
        sys.exit(0)

    if args.part > 0 and args.part <= len(mp3_assets):
        mp3_assets = [mp3_assets[args.part - 1]]

    work_dir = Path(tempfile.gettempdir()) / "spacepipe_deepgram_work"
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
        print(f"[*] Downloading audio stream to cloud runner scratch disk...")
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
                deepgram_key=deepgram_key,
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
                "User-Agent": "SpacePipe-DeepgramTranscriber"
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

    print(f"\n[🎉] Deepgram Transcription Completed for {args.release_tag} ({processed_count} asset(s) processed)!")


if __name__ == "__main__":
    main()
