#!/usr/bin/env python3
"""
find_and_cut_best_clips.py - AI Best Moments & Highlight Clipper

Scans Twitter Space transcripts using Gemini 2.5 Flash to discover the funniest,
wildest, most entertaining, and viral dialogue exchanges, and cuts them into
audio clips stored in an organized library with a markdown catalog.

Usage:
  # Scan a specific episode:
  python scripts/find_and_cut_best_clips.py --json "output_transcripts/<file>.json" --audio "work/<file>.mp3" --limit 5

  # Scan all available episodes in output_transcripts/:
  python scripts/find_and_cut_best_clips.py --all --limit 3

  # Filter specifically for humor/banter:
  python scripts/find_and_cut_best_clips.py --json "<file>.json" --audio "<file>.mp3" --category humor
"""

import os
import re
import sys
import time
import math
import json
import argparse
import subprocess
from pathlib import Path
from typing import List, Dict, Any, Optional

import requests
import shutil

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
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    return "ffmpeg"


FFMPEG_EXE = find_ffmpeg()


def sanitize_filename(name: str) -> str:
    """Sanitizes strings for Windows/URL filesystem safety."""
    clean = name.replace("&", "and").replace("'", "").replace('"', "")
    clean = re.sub(r'[\\/*?:"<>|!,.;#%`]', "", clean)
    clean = re.sub(r'\s+', "_", clean).strip(" ._")
    return clean[:50] if clean else "clip"


def format_seconds_to_timestamp(sec: float) -> str:
    """Formats seconds to HHmMMs or MMmSSs."""
    hours = int(sec // 3600)
    minutes = int((sec % 3600) // 60)
    seconds = int(sec % 60)
    if hours > 0:
        return f"{hours:02d}h{minutes:02d}m{seconds:02d}s"
    return f"{minutes:02d}m{seconds:02d}s"


def format_seconds_display(sec: float) -> str:
    """Formats seconds to HH:MM:SS or MM:SS."""
    hours = int(sec // 3600)
    minutes = int((sec % 3600) // 60)
    seconds = int(sec % 60)
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:02d}:{seconds:02d}"


def normalize_category(cat: str) -> str:
    c = (cat or "").strip().lower()
    if "humor" in c or "banter" in c:
        return "Humor & Banter"
    if "story" in c or "stories" in c or "wild" in c:
        return "Wild Stories"
    if "rant" in c:
        return "Passionate Rants"
    if "quote" in c or "golden" in c:
        return "Golden Quotes"
    if "highlight" in c:
        return "Highlights"
    return cat.strip() if cat else "Highlights"


def call_openrouter_highlight_discovery(
    transcript_text: str,
    limit: int = 5,
    category_filter: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Calls OpenRouter (Gemini 2.5 Flash / GPT-4o-mini) with structured JSON output."""
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        return []

    filter_instruction = ""
    if category_filter and category_filter.lower() != "all":
        filter_instruction = f"Focus specifically on moments fitting the category: '{category_filter}'."

    prompt = f"""
You are an expert audio podcast producer and viral clip curator.
Your task is to analyze this Twitter Space transcript and locate the top {limit} very BEST, FUNNIEST, and most entertaining moments to extract as standalone highlight clips.

Target Criteria:
1. Humor & Banter: Absurd jokes, hilarious comedic timing, witty roasts, self-deprecating banter, contagious laughs.
2. Wild Stories: Bizarre encounters, unbelievable personal stories, crazy anecdotes.
3. Passionate Rants: Intense, animated, high-energy arguments or hot takes.
4. Golden Quotes: Unforgettable one-liners or mind-bending observations.

Guidelines:
- Each clip should ideally be between 20 seconds and 90 seconds long (self-contained, with complete context).
- Crucial: Ensure 'start_seconds' begins 1.5 to 2.0 seconds BEFORE the natural opening words of the quote/setup to guarantee no words are ever clipped or dropped. Always err on starting early. Ensure 'end_seconds' ends 1.0 second after the punchline or natural resolution. Never cut mid-sentence.
- Rank by viral/entertainment appeal.
{filter_instruction}

Return a valid JSON object with a single "clips" array containing dictionaries with keys:
"title", "category", "start_seconds", "end_seconds", "speakers", "viral_score", "reason", "transcript_snippet".

Transcript:
{transcript_text}
"""

    models_to_try = [
        "nvidia/nemotron-3-ultra-550b-a55b:free",
        "google/gemma-4-31b-it:free",
        "openrouter/free"
    ]
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    for model_name in models_to_try:
        try:
            print(f"[*] Analyzing highlights with OpenRouter Free ({model_name})...", flush=True)
            payload = {
                "model": model_name,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 1500
            }
            resp = requests.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=payload, timeout=90)
            if resp.status_code == 200:
                data = resp.json()
                content = data["choices"][0]["message"]["content"]
                if "```" in content:
                    m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", content)
                    if m:
                        content = m.group(1).strip()
                parsed = json.loads(content)
                raw_clips = parsed.get("clips") or []
                clean_clips = []
                for c in raw_clips:
                    if "start_seconds" in c and "end_seconds" in c and float(c["end_seconds"]) > float(c["start_seconds"]):
                        clean_clips.append({
                            "title": str(c.get("title", "Highlight Clip")),
                            "category": normalize_category(str(c.get("category", "Humor & Banter"))),
                            "start_seconds": float(c["start_seconds"]),
                            "end_seconds": float(c["end_seconds"]),
                            "speakers": list(c.get("speakers", [])),
                            "viral_score": int(c.get("viral_score", 8)),
                            "reason": str(c.get("reason", "Entertaining dialogue")),
                            "transcript_snippet": str(c.get("transcript_snippet", ""))
                        })
                if clean_clips:
                    print(f"[✓] OpenRouter Free ({model_name}) extracted {len(clean_clips)} moments!", flush=True)
                    return clean_clips
            else:
                print(f"[!] OpenRouter notice ({resp.status_code}): {resp.text[:150]}", flush=True)
        except Exception as e:
            print(f"[!] OpenRouter error with {model_name}: {e}", flush=True)

    return []


def extract_heuristic_highlights(
    segments: List[Dict[str, Any]],
    limit: int = 5
) -> List[Dict[str, Any]]:
    """Robust fallback: extracts energetic and funny conversational exchanges without external LLM."""
    if not segments:
        return []

    laughter_tokens = {"haha", "hahaha", "lol", "lmao", "rofl", "giggle", "laugh", "laughing", "crying", "chuckle", "wheeze"}
    wild_tokens = {"wild", "crazy", "insane", "unbelievable", "holy", "shit", "fuck", "fucking", "ridiculous", "hilarious", "bullshit", "no way"}

    scored_windows = []
    # Slide across segments to find 25s - 75s conversational windows
    for i in range(len(segments)):
        w_start = segments[i].get("start", 0.0)
        curr_text = []
        speakers = set()
        score = 0
        w_end = w_start
        for j in range(i, min(len(segments), i + 20)):
            seg = segments[j]
            w_end = seg.get("end", w_start)
            dur = w_end - w_start
            txt = (seg.get("text") or "").strip()
            spk = seg.get("speaker") or "Speaker"
            speakers.add(spk)
            curr_text.append(f"{spk}: {txt}")

            txt_lower = txt.lower()
            if any(t in txt_lower for t in laughter_tokens):
                score += 5
            if any(t in txt_lower for t in wild_tokens):
                score += 4
            score += txt.count("!") * 2
            score += txt.count("?") * 1

            if 25.0 <= dur <= 75.0:
                if len(speakers) > 1:
                    score += 4
                scored_windows.append({
                    "start_seconds": round(w_start, 2),
                    "end_seconds": round(w_end, 2),
                    "score": score,
                    "speakers": list(speakers),
                    "text": " ".join(curr_text)
                })
            elif dur > 75.0:
                break

    if not scored_windows:
        total_dur = segments[-1].get("end", 0.0)
        chunk_len = min(60.0, max(20.0, total_dur / max(1, limit)))
        for i in range(min(limit, int(total_dur // chunk_len))):
            s = i * chunk_len
            e = s + chunk_len
            scored_windows.append({
                "start_seconds": round(s, 2),
                "end_seconds": round(e, 2),
                "score": 5,
                "speakers": list({seg.get("speaker", "Speaker") for seg in segments if s <= seg.get("start", 0) <= e}),
                "text": "Discussion highlight moment"
            })

    scored_windows.sort(key=lambda x: x["score"], reverse=True)
    selected = []
    for w in scored_windows:
        if not any(abs(w["start_seconds"] - s["start_seconds"]) < 30.0 for s in selected):
            selected.append(w)
        if len(selected) >= limit:
            break

    clips = []
    for idx, w in enumerate(selected, 1):
        words = [wd for wd in w["text"].split() if not wd.endswith(":")]
        first_few_words = " ".join(words[:6]).replace('"', "") if words else f"Moment {idx}"
        clips.append({
            "title": f"{first_few_words[:40]}",
            "category": "Humor & Banter" if any(t in w["text"].lower() for t in laughter_tokens) else "Wild Stories",
            "start_seconds": w["start_seconds"],
            "end_seconds": w["end_seconds"],
            "speakers": w["speakers"],
            "viral_score": min(10, max(6, 6 + (w["score"] // 3))),
            "reason": "High-energy dialogue and rapid exchange",
            "transcript_snippet": w["text"][:180] + "..."
        })
    return clips


def call_gemini_highlight_discovery(
    transcript_text: str,
    limit: int = 5,
    category_filter: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Uses Cheaper Inference (Gemini Flash), Cohere API, or OpenRouter to identify the top entertaining clips."""
    # 0. Try Cheaper Inference (gemini-2.5-flash) first if available
    ci_key = os.environ.get("CHEAPER_INFERENCE_API_KEY")
    if ci_key:
        ci_base = os.environ.get("CHEAPER_INFERENCE_BASE_URL", "https://api.cheaperinference.com/v1").rstrip("/")
        ci_model = os.environ.get("DIRECTOR_MODEL", "gemini-2.5-flash")
        filter_instruction = ""
        if category_filter and category_filter.lower() != "all":
            filter_instruction = f"Focus specifically on moments fitting the category: '{category_filter}'."

        prompt = f"""You are an expert audio podcast producer and viral clip curator.
Your task is to analyze this Twitter Space transcript and locate the top {limit} very BEST, FUNNIEST, and most entertaining moments to extract as standalone highlight clips.
Categories must be one of: 'Humor & Banter', 'Wild Stories', 'Passionate Rants', 'Golden Quotes'.
Each clip should be 20 to 90 seconds long.
{filter_instruction}

Return ONLY a valid JSON object with a single "clips" array containing dictionaries with keys:
"title", "category", "start_seconds", "end_seconds", "speakers", "viral_score", "reason", "transcript_snippet".

Transcript:
{transcript_text}"""
        try:
            print(f"[*] Analyzing highlights with Gemini ({ci_model}) via Cheaper Inference...", flush=True)
            resp = requests.post(
                f"{ci_base}/chat/completions",
                headers={
                    "Authorization": f"Bearer {ci_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": ci_model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.3
                },
                timeout=120
            )
            if resp.status_code == 200:
                data = resp.json()
                content = data["choices"][0]["message"]["content"].strip()
                if "```" in content:
                    m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", content)
                    if m:
                        content = m.group(1).strip()
                parsed = json.loads(content)
                raw_clips = parsed.get("clips") or []
                clean_clips = []
                for cl in raw_clips:
                    if "start_seconds" in cl and "end_seconds" in cl and float(cl["end_seconds"]) > float(cl["start_seconds"]):
                        clean_clips.append({
                            "title": str(cl.get("title", "Highlight Clip")),
                            "category": normalize_category(str(cl.get("category", "Humor & Banter"))),
                            "start_seconds": float(cl["start_seconds"]),
                            "end_seconds": float(cl["end_seconds"]),
                            "speakers": list(cl.get("speakers", [])),
                            "viral_score": int(cl.get("viral_score", 8)),
                            "reason": str(cl.get("reason", "Entertaining dialogue")),
                            "transcript_snippet": str(cl.get("transcript_snippet", ""))
                        })
                if clean_clips:
                    print(f"[✓] Gemini Flash extracted {len(clean_clips)} moments!", flush=True)
                    return clean_clips
            else:
                print(f"[!] Cheaper Inference notice ({resp.status_code}): {resp.text[:150]}", flush=True)
        except Exception as e:
            print(f"[!] Cheaper Inference error with {ci_model}: {e}", flush=True)

    # 1. Try Cohere Free API first if available
    cohere_key = os.environ.get("COHERE_API_KEY")
    if cohere_key:
        filter_instruction = ""
        if category_filter and category_filter.lower() != "all":
            filter_instruction = f"Focus specifically on moments fitting the category: '{category_filter}'."

        prompt = f"""You are an expert audio podcast producer and viral clip curator.
Your task is to analyze this Twitter Space transcript and locate the top {limit} very BEST, FUNNIEST, and most entertaining moments to extract as standalone highlight clips.
Categories must be one of: 'Humor & Banter', 'Wild Stories', 'Passionate Rants', 'Golden Quotes'.
Each clip should be 20 to 90 seconds long.
{filter_instruction}

Return ONLY a valid JSON object with a single "clips" array containing dictionaries with keys:
"title", "category", "start_seconds", "end_seconds", "speakers", "viral_score", "reason", "transcript_snippet".

Transcript:
{transcript_text}"""

        for cohere_model in ["command-r-plus-08-2024", "command-r-08-2024"]:
            try:
                print(f"[*] Analyzing highlights with Cohere Free ({cohere_model})...", flush=True)
                resp = requests.post(
                    "https://api.cohere.com/v2/chat",
                    headers={
                        "Authorization": f"Bearer {cohere_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": cohere_model,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.3
                    },
                    timeout=90
                )
                if resp.status_code == 200:
                    data = resp.json()
                    content_items = data.get("message", {}).get("content", [])
                    content = "".join(c.get("text", "") for c in content_items if isinstance(c, dict)).strip()
                    if "```" in content:
                        m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", content)
                        if m:
                            content = m.group(1).strip()
                    parsed = json.loads(content)
                    raw_clips = parsed.get("clips") or []
                    clean_clips = []
                    for c in raw_clips:
                        if "start_seconds" in c and "end_seconds" in c and float(c["end_seconds"]) > float(c["start_seconds"]):
                            clean_clips.append({
                                "title": str(c.get("title", "Highlight Clip")),
                                "category": normalize_category(str(c.get("category", "Humor & Banter"))),
                                "start_seconds": float(c["start_seconds"]),
                                "end_seconds": float(c["end_seconds"]),
                                "speakers": list(c.get("speakers", [])),
                                "viral_score": int(c.get("viral_score", 8)),
                                "reason": str(c.get("reason", "Entertaining dialogue")),
                                "transcript_snippet": str(c.get("transcript_snippet", ""))
                            })
                    if clean_clips:
                        print(f"[✓] Cohere Free ({cohere_model}) extracted {len(clean_clips)} moments!", flush=True)
                        return clean_clips
                else:
                    print(f"[!] Cohere notice ({resp.status_code}): {resp.text[:150]}", flush=True)
            except Exception as e:
                print(f"[!] Cohere error with {cohere_model}: {e}", flush=True)

    # 2. Try OpenRouter Free models if available
    if os.environ.get("OPENROUTER_API_KEY"):
        or_clips = call_openrouter_highlight_discovery(transcript_text, limit=limit, category_filter=category_filter)
        if or_clips:
            return or_clips

    return []


def slice_audio_clip(audio_path: str, start: float, end: float, out_path: str, pre_roll: float = 1.5) -> bool:
    """Slices a segment from source audio using FFmpeg as high-bitrate MP3 with broadcast-level fade in/out and safety pre-roll."""
    safe_start = max(0.0, start - pre_roll)
    duration = max(0.5, (end - start) + pre_roll + 0.8)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    fade_len = min(0.3, duration / 8.0)
    af_filter = f"afade=t=in:ss=0:d={fade_len:.2f},afade=t=out:st={max(0, duration - fade_len):.2f}:d={fade_len:.2f}"
    cmd = [
        FFMPEG_EXE,
        "-y",
        "-nostdin",
        "-ss", str(safe_start),
        "-t", str(duration),
        "-i", audio_path,
        "-af", af_filter,
        "-c:a", "libmp3lame",
        "-b:a", "192k",
        out_path
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        return res.returncode == 0
    except Exception as e:
        print(f"    [!] Error slicing clip {out_path}: {e}")
        return False


def update_markdown_catalog(catalog_file: str, all_clips: List[Dict[str, Any]]):
    """Generates an organized markdown catalog of all saved highlight clips."""
    lines = [
        "# 🎙️ SpacePipe Highlights & Best Moments",
        "",
        "> Curated moments of humor, banter, wild stories, and golden quotes from archived Twitter Spaces.",
        f"> **Total Highlights Extracted:** {len(all_clips)}",
        "",
        "---",
        ""
    ]

    # Group clips by category
    by_category: Dict[str, List[Dict[str, Any]]] = {}
    for clip in all_clips:
        cat = clip.get("category", "General Highlights")
        by_category.setdefault(cat, []).append(clip)

    for cat, clips in by_category.items():
        lines.append(f"## 📂 {cat} ({len(clips)})")
        lines.append("")
        for idx, c in enumerate(clips, 1):
            stars = "⭐" * min(5, max(1, (c.get("viral_score", 5) + 1) // 2))
            dur_str = f"{c.get('duration', 0):.1f}s"
            ts_str = f"{format_seconds_display(c['start_seconds'])} - {format_seconds_display(c['end_seconds'])}"
            speakers_str = ", ".join(c.get("speakers", [])) or "Unknown"

            rel_path = c.get("file_path", "").replace("\\", "/")

            lines.append(f"### {idx}. {c['title']}  {stars}")
            lines.append(f"* **Source Episode:** `{c.get('episode', 'Unknown')}`")
            lines.append(f"* **Timestamp:** `{ts_str}` ({dur_str})")
            lines.append(f"* **Speakers:** **{speakers_str}**")
            lines.append(f"* **Viral Score:** `{c.get('viral_score', 0)}/10`")
            lines.append(f"* **Why It's Great:** {c.get('reason', '')}")
            lines.append(f"* **Audio File:** [`{os.path.basename(rel_path)}`]({rel_path})")
            lines.append("")
            lines.append(f"> \"{c.get('transcript_snippet', '').strip()}\"")
            lines.append("")
            lines.append("---")
            lines.append("")

    with open(catalog_file, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def process_single_episode(
    json_path: str,
    audio_path: str,
    output_dir: str = "best_saved_clips",
    limit: int = 5,
    category: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Analyzes an episode transcript, extracts top highlight moments, and saves audio clips."""
    print(f"\n[*] Processing episode:")
    print(f"    Transcript: {json_path}")
    print(f"    Audio:      {audio_path}")

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    segments = data.get("segments", [])
    if not segments:
        print("[!] No segments found in transcript JSON.")
        return []

    ep_title = data.get("title") or Path(json_path).stem

    # Gemini 2.5 Flash has a 1,000,000 token context window.
    # We analyze up to 1,500 turns in one call (~25k tokens), eliminating fragmented rate-limit loops.
    WINDOW_SIZE = 1500
    OVERLAP = 100
    highlights = []
    
    if len(segments) <= WINDOW_SIZE:
        dialogue_lines = [f"[{s['start']:.1f}s - {s['end']:.1f}s] {s.get('speaker', 'Speaker')}: {s['text']}" for s in segments]
        print(f"[*] Sending {len(segments)} dialogue turns to Gemini in a single pass...")
        highlights = call_gemini_highlight_discovery("\n".join(dialogue_lines), limit=limit, category_filter=category)
    else:
        print(f"[*] Transcript has {len(segments)} turns. Analyzing in windowed chunks of {WINDOW_SIZE}...")
        all_candidates = []
        num_windows = max(1, math.ceil(len(segments) / (WINDOW_SIZE - OVERLAP)))
        for w_idx in range(num_windows):
            start_i = w_idx * (WINDOW_SIZE - OVERLAP)
            end_i = min(len(segments), start_i + WINDOW_SIZE)
            sub_segs = segments[start_i:end_i]
            if not sub_segs:
                break
            dialogue_lines = [f"[{s['start']:.1f}s - {s['end']:.1f}s] {s.get('speaker', 'Speaker')}: {s['text']}" for s in sub_segs]
            print(f"  [Window {w_idx + 1}/{num_windows}] Analyzing turns {start_i}-{end_i}...")
            try:
                cand = call_gemini_highlight_discovery("\n".join(dialogue_lines), limit=max(2, limit // 2), category_filter=category)
                all_candidates.extend(cand)
            except Exception as w_err:
                print(f"  [!] Window {w_idx + 1} notice: {w_err}")
            time.sleep(1.0)
            
        # Deduplicate candidates within 15 seconds of each other, preferring higher viral score
        all_candidates.sort(key=lambda x: x.get("viral_score", 5), reverse=True)
        filtered = []
        for c in all_candidates:
            c_start = c["start_seconds"]
            if not any(abs(c_start - f["start_seconds"]) < 15.0 for f in filtered):
                filtered.append(c)
            if len(filtered) >= limit:
                break
        highlights = filtered

    if not highlights:
        print("[*] External AI highlight discovery returned no moments. Falling back to dialogue heuristic highlight extraction...", flush=True)
        highlights = extract_heuristic_highlights(segments, limit=limit)

    print(f"[✓] Identified {len(highlights)} top moments!")

    saved_clips = []
    for idx, h in enumerate(highlights, 1):
        cat_clean = sanitize_filename(h.get("category", "Highlights"))
        title_clean = sanitize_filename(h.get("title", f"Clip_{idx}"))
        ts_label = format_seconds_to_timestamp(h["start_seconds"])
        duration = round(h["end_seconds"] - h["start_seconds"], 2)

        clip_filename = f"{ts_label}_{title_clean}.mp3"
        cat_dir = os.path.join(output_dir, cat_clean)
        out_clip_path = os.path.join(cat_dir, clip_filename)

        print(f"  [{idx}/{len(highlights)}] Slicing: \"{h['title']}\" ({duration:.1f}s) -> {cat_clean}/{clip_filename}")
        success = slice_audio_clip(audio_path, h["start_seconds"], h["end_seconds"], out_clip_path)
        if success:
            h["episode"] = ep_title
            h["duration"] = duration
            h["file_path"] = out_clip_path
            saved_clips.append(h)

    return saved_clips


def process_release(
    release_tag: str,
    repo: str = "aiandbotsgalore/copy-spaces-to-youtube-pipeline",
    output_dir: str = "best_saved_clips",
    limit: int = 5,
    category: Optional[str] = None,
    force: bool = False,
    token: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Fetches transcript & audio from a GitHub Release, extracts highlight clips, and uploads them to the release."""
    import tempfile
    import urllib.parse
    token = token or os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    headers = {"Accept": "application/vnd.github.v3+json", "User-Agent": "SpacePipe-HighlightClipper"}
    if token:
        headers["Authorization"] = f"token {token}"

    print(f"\n========================================================")
    print(f"[*] Processing Release: {release_tag}")
    print(f"========================================================")

    # 1. Fetch release details via gh cli or HTTP
    release_data = None
    try:
        gh_cmd = ["gh", "release", "view", release_tag, "--repo", repo, "--json", "name,assets,url,id"]
        gh_env = os.environ.copy()
        if token:
            gh_env["GH_TOKEN"] = token
            gh_env["GITHUB_TOKEN"] = token
        r_proc = subprocess.run(gh_cmd, capture_output=True, text=True, check=True, env=gh_env)
        release_data = json.loads(r_proc.stdout)
    except Exception:
        rel_api = f"https://api.github.com/repos/{repo}/releases/tags/{release_tag}"
        resp = requests.get(rel_api, headers=headers)
        if resp.status_code == 200:
            release_data = resp.json()
        else:
            print(f"[!] Could not fetch release {release_tag}: {resp.status_code}")
            return []

    assets = release_data.get("assets", [])
    has_clips_json = any(a.get("name", "").endswith("_clips.json") or a.get("name") == "clips_catalog.json" for a in assets)
    has_clip_mp3 = any(a.get("name", "").endswith(".mp3") and re.match(r"^(?:(\d+)h)?(\d+)m(\d+)s", a.get("name", "")) for a in assets)
    if (has_clips_json or has_clip_mp3) and not force:
        print(f"[✓] Release {release_tag} already has highlight clips. Skipping.")
        return []

    # 2. Find transcript JSON
    json_asset = next(
        (a for a in assets if a.get("name", "").endswith(".json") and not a.get("name", "").endswith("_clips.json") and a.get("name") != "clips_catalog.json"),
        None
    )
    if not json_asset:
        print(f"[!] No transcript JSON found in release {release_tag}. Skipping.")
        return []

    # 3. Find primary MP3 audio
    mp3_asset = next(
        (a for a in assets if a.get("name", "").endswith(".mp3") and not re.match(r"^(?:(\d+)h)?(\d+)m(\d+)s", a.get("name", ""))),
        None
    )
    if not mp3_asset:
        print(f"[!] No primary MP3 audio found in release {release_tag}. Skipping.")
        return []

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)

        # Download transcript JSON
        local_json = tmp_path / json_asset["name"]
        print(f"[*] Downloading transcript: {json_asset['name']}...")
        j_dl_url = json_asset.get("browser_download_url") or json_asset.get("url")
        j_resp = requests.get(j_dl_url, headers=headers)
        j_resp.raise_for_status()
        with open(local_json, "wb") as f:
            f.write(j_resp.content)

        # Download audio MP3
        local_mp3 = tmp_path / mp3_asset["name"]
        print(f"[*] Downloading audio ({mp3_asset.get('size', 0)/(1024*1024):.1f} MB): {mp3_asset['name']}...")
        m_dl_url = mp3_asset.get("browser_download_url") or mp3_asset.get("url")
        m_resp = requests.get(m_dl_url, headers=headers, stream=True)
        m_resp.raise_for_status()
        with open(local_mp3, "wb") as f:
            for chunk in m_resp.iter_content(chunk_size=1048576):
                f.write(chunk)
        print(f"[✓] Audio downloaded: {local_mp3.stat().st_size / (1024*1024):.1f} MB")

        # Process and slice clips
        clips_work_dir = tmp_path / "clips_out"
        clips_work_dir.mkdir(parents=True, exist_ok=True)
        clips = process_single_episode(str(local_json), str(local_mp3), str(clips_work_dir), limit=limit, category=category)

        if not clips:
            print(f"[!] No clips were extracted for {release_tag}.")
            return []

        # Save episode clips JSON
        ep_stem = Path(json_asset["name"]).stem
        ep_clips_json = clips_work_dir / f"{ep_stem}_clips.json"
        with open(ep_clips_json, "w", encoding="utf-8") as f:
            json.dump(clips, f, indent=2)

        # Collect files to upload to GitHub Release
        files_to_upload = [str(ep_clips_json)]
        for c in clips_work_dir.glob("**/*.mp3"):
            if c.is_file() and c.stat().st_size > 0:
                files_to_upload.append(str(c))

        print(f"\n[*] Uploading {len(files_to_upload)} clip assets to GitHub Release {release_tag}...")
        try:
            up_cmd = ["gh", "release", "upload", release_tag, *files_to_upload, "--repo", repo, "--clobber"]
            up_env = os.environ.copy()
            if token:
                up_env["GH_TOKEN"] = token
                up_env["GITHUB_TOKEN"] = token
            subprocess.run(up_cmd, check=True, env=up_env)
            print(f"[✓] Successfully uploaded {len(files_to_upload)} highlight clip assets to {release_tag}!")
        except Exception as up_err:
            print(f"[!] Notice: gh release upload failed ({up_err}). Attempting REST upload...")
            upload_url_base = f"https://uploads.github.com/repos/{repo}/releases/{release_data.get('id')}/assets"
            for f_path in files_to_upload:
                f_name = Path(f_path).name
                u_headers = {
                    "Content-Type": "audio/mpeg" if f_name.endswith(".mp3") else "application/json",
                    "User-Agent": "SpacePipe-HighlightClipper"
                }
                if token:
                    u_headers["Authorization"] = f"token {token}"
                with open(f_path, "rb") as f_data:
                    requests.post(f"{upload_url_base}?name={urllib.parse.quote(f_name)}", headers=u_headers, data=f_data)

        # Copy to local output_dir as well
        os.makedirs(output_dir, exist_ok=True)
        for f_path in files_to_upload:
            p = Path(f_path)
            if p.suffix == ".mp3":
                sub_dir = Path(output_dir) / p.parent.name
                sub_dir.mkdir(parents=True, exist_ok=True)
                shutil.copy2(p, sub_dir / p.name)
            else:
                shutil.copy2(p, Path(output_dir) / p.name)

        return clips


def main():
    parser = argparse.ArgumentParser(description="Find and cut the best and funniest moments from Twitter Spaces using Gemini AI")
    parser.add_argument("--json", type=str, help="Path to transcript JSON file")
    parser.add_argument("--audio", type=str, help="Path to matching audio MP3 file")
    parser.add_argument("--release-tag", type=str, help="Release tag (e.g. 20261023_1yGBePgdOgoKN) to extract and upload clips for")
    parser.add_argument("--batch-missing", type=int, default=0, help="Process up to N transcribed episodes that are missing clips")
    parser.add_argument("--repo", type=str, default="aiandbotsgalore/copy-spaces-to-youtube-pipeline", help="GitHub repository")
    parser.add_argument("--force", action="store_true", help="Force regenerate clips even if existing clips found")
    parser.add_argument("--all", action="store_true", help="Scan all transcripts in output_transcripts/ with matching audio in work/")
    parser.add_argument("--output-dir", type=str, default="best_saved_clips", help="Output directory for saved clips (default: best_saved_clips)")
    parser.add_argument("--limit", type=int, default=5, help="Number of highlights to extract per episode (default: 5)")
    parser.add_argument("--category", type=str, default=None, help="Filter for specific category (e.g. 'humor', 'stories', 'rants')")

    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    all_extracted_clips = []

    # Load existing catalog index if available to append
    index_file = os.path.join(args.output_dir, "clips_catalog.json")
    if os.path.exists(index_file):
        try:
            with open(index_file, "r", encoding="utf-8") as f:
                all_extracted_clips = json.load(f)
        except Exception:
            all_extracted_clips = []

    if args.release_tag:
        clips = process_release(args.release_tag, repo=args.repo, output_dir=args.output_dir, limit=args.limit, category=args.category, force=args.force)
        all_extracted_clips.extend(clips)

    elif args.batch_missing > 0:
        print(f"[*] Scanning for up to {args.batch_missing} transcribed episodes missing clips...")
        status_file = Path("public/transcripts/transcription_status.json")
        missing_tags = []
        if status_file.exists():
            try:
                with open(status_file, "r", encoding="utf-8") as f:
                    s_data = json.load(f)
                    missing_tags = [item["tag"] for item in s_data.get("missing_clips", [])]
            except Exception:
                pass
        if not missing_tags:
            from scripts.batch_transcribe_queue import fetch_all_releases, analyze_releases
            rel_list = fetch_all_releases(args.repo)
            analysis = analyze_releases(rel_list)
            missing_tags = [item["tag"] for item in analysis.get("missing_clips", [])]

        targets = missing_tags[:args.batch_missing]
        print(f"[*] Found {len(targets)} candidate episode(s) to process: {', '.join(targets)}")
        for t in targets:
            try:
                clips = process_release(t, repo=args.repo, output_dir=args.output_dir, limit=args.limit, category=args.category, force=args.force)
                all_extracted_clips.extend(clips)
            except Exception as e:
                print(f"[!] Error processing release {t}: {e}")

    elif args.json and args.audio:
        clips = process_single_episode(args.json, args.audio, args.output_dir, args.limit, args.category)
        all_extracted_clips.extend(clips)
        
        # Save episode-specific clips json for easy cloud release upload
        ep_stem = Path(args.json).stem
        ep_clips_file = os.path.join(args.output_dir, f"{ep_stem}_clips.json")
        with open(ep_clips_file, "w", encoding="utf-8") as f:
            json.dump(clips, f, indent=2)
        print(f"    Saved episode clips metadata: {os.path.abspath(ep_clips_file)}")

    elif args.all:
        transcript_dir = "output_transcripts"
        work_dir = "work"
        if not os.path.exists(transcript_dir):
            print(f"[!] {transcript_dir} not found.")
            sys.exit(1)

        json_files = list(Path(transcript_dir).glob("*.json"))
        print(f"[*] Found {len(json_files)} transcripts in {transcript_dir}.")

        for jf in json_files:
            stem = jf.stem
            # Find matching audio
            matching_mp3 = None
            for cand in Path(work_dir).glob("*.mp3"):
                if stem in cand.stem or cand.stem in stem:
                    matching_mp3 = str(cand)
                    break

            if matching_mp3:
                clips = process_single_episode(str(jf), matching_mp3, args.output_dir, args.limit, args.category)
                all_extracted_clips.extend(clips)
            else:
                print(f"[!] No matching MP3 found in {work_dir}/ for {jf.name}. Skipping.")

    else:
        parser.print_help()
        sys.exit(1)

    # Save updated catalog index and markdown
    with open(index_file, "w", encoding="utf-8") as f:
        json.dump(all_extracted_clips, f, indent=2)

    catalog_md = os.path.join(args.output_dir, "CLIPS_CATALOG.md")
    update_markdown_catalog(catalog_md, all_extracted_clips)

    # Sync to public/clips so web player has instant access
    public_clips = os.path.join("public", "clips")
    if os.path.exists("public"):
        os.makedirs(public_clips, exist_ok=True)
        for item in os.listdir(args.output_dir):
            s = os.path.join(args.output_dir, item)
            d = os.path.join(public_clips, item)
            if os.path.isdir(s):
                if os.path.exists(d):
                    shutil.rmtree(d)
                shutil.copytree(s, d)
            else:
                shutil.copy2(s, d)
        print(f"    Synchronized to web UI: {os.path.abspath(public_clips)}")

    print(f"\n[✓] All clips processed successfully!")
    print(f"    Saved clips directory: {os.path.abspath(args.output_dir)}")
    print(f"    Interactive catalog:   {os.path.abspath(catalog_md)}")


if __name__ == "__main__":
    main()
