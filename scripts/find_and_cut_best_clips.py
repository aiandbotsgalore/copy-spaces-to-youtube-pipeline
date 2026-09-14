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

FFMPEG_EXE = shutil.which("ffmpeg") or "ffmpeg"
if not shutil.which("ffmpeg"):
    try:
        import imageio_ffmpeg
        FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        FFMPEG_EXE = "ffmpeg"


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

    models_to_try = ["google/gemini-2.5-flash", "openai/gpt-4o-mini"]
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    for model_name in models_to_try:
        try:
            print(f"[*] Analyzing highlights with OpenRouter ({model_name})...", flush=True)
            payload = {
                "model": model_name,
                "messages": [{"role": "user", "content": prompt}],
                "response_format": {"type": "json_object"}
            }
            resp = requests.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=payload, timeout=90)
            if resp.status_code == 200:
                data = resp.json()
                content = data["choices"][0]["message"]["content"]
                parsed = json.loads(content)
                raw_clips = parsed.get("clips") or []
                clean_clips = []
                for c in raw_clips:
                    if "start_seconds" in c and "end_seconds" in c and float(c["end_seconds"]) > float(c["start_seconds"]):
                        clean_clips.append({
                            "title": str(c.get("title", "Highlight Clip")),
                            "category": str(c.get("category", "Humor & Banter")),
                            "start_seconds": float(c["start_seconds"]),
                            "end_seconds": float(c["end_seconds"]),
                            "speakers": list(c.get("speakers", [])),
                            "viral_score": int(c.get("viral_score", 8)),
                            "reason": str(c.get("reason", "Entertaining dialogue")),
                            "transcript_snippet": str(c.get("transcript_snippet", ""))
                        })
                if clean_clips:
                    print(f"[✓] OpenRouter ({model_name}) extracted {len(clean_clips)} moments!", flush=True)
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
            "category": "Humor & Banter" if any(t in w["text"].lower() for t in laughter_tokens) else "Wild Story",
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
    """Uses OpenRouter or Gemini Flash to identify the top entertaining clips."""
    # 1. Try OpenRouter first if available
    if os.environ.get("OPENROUTER_API_KEY"):
        or_clips = call_openrouter_highlight_discovery(transcript_text, limit=limit, category_filter=category_filter)
        if or_clips:
            return or_clips

    # 2. Try Google Gemini Client if available
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if api_key:
        try:
            from google import genai
            from pydantic import BaseModel, Field

            class HighlightClip(BaseModel):
                title: str = Field(description="Catchy title")
                category: str = Field(description="Category")
                start_seconds: float
                end_seconds: float
                speakers: List[str]
                viral_score: int
                reason: str
                transcript_snippet: str

            class HighlightDiscoveryResult(BaseModel):
                clips: List[HighlightClip]

            client = genai.Client(api_key=api_key)
            filter_instruction = ""
            if category_filter and category_filter.lower() != "all":
                filter_instruction = f"Focus specifically on moments fitting the category: '{category_filter}'."

            prompt = f"""
You are an expert audio podcast producer and viral clip curator.
Your task is to analyze this Twitter Space transcript and locate the top {limit} very BEST, FUNNIEST, and most entertaining moments to extract as standalone highlight clips.
{filter_instruction}
Transcript:
{transcript_text}
"""
            for model_name in ["gemini-2.5-flash-lite", "gemini-2.5-flash"]:
                try:
                    print(f"[*] Analyzing with Gemini ({model_name})...", flush=True)
                    response = client.models.generate_content(
                        model=model_name,
                        contents=prompt,
                        config={
                            "response_mime_type": "application/json",
                            "response_json_schema": HighlightDiscoveryResult.model_json_schema()
                        }
                    )
                    parsed = HighlightDiscoveryResult.model_validate_json(response.text)
                    return [c.model_dump() for c in parsed.clips]
                except Exception as e:
                    err_str = str(e)
                    print(f"[!] {model_name} notice: {e}", flush=True)
                    if "CONSUMER_SUSPENDED" in err_str or "PERMISSION_DENIED" in err_str or "403" in err_str:
                        print(f"[!] Gemini direct API key suspended or permission denied. Trying fallbacks...", flush=True)
                        break
        except Exception as e:
            print(f"[!] Direct Gemini exception: {e}", flush=True)

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


def main():
    parser = argparse.ArgumentParser(description="Find and cut the best and funniest moments from Twitter Spaces using Gemini AI")
    parser.add_argument("--json", type=str, help="Path to transcript JSON file")
    parser.add_argument("--audio", type=str, help="Path to matching audio MP3 file")
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

    if args.json and args.audio:
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
