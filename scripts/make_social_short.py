#!/usr/bin/env python3
"""
make_social_short.py - Automated Video Shorts / Audiogram Generator

Generates high-engagement 9:16 vertical video shorts (1080x1920 MP4)
from any audio clip or highlight with animated audio waveforms,
episode badges, and styled text overlays ready for X, TikTok, & YouTube Shorts.

Usage:
  # Turn a specific audio clip into a vertical short:
  python scripts/make_social_short.py --audio "best_saved_clips/Humor_&_Banter/01h33m45s_I_Don't_Like_It_In_The_Butt.mp3" --title "Eric's Secret Wine" --speaker "Eric Hecker"

  # Convert all clips in a category to shorts:
  python scripts/make_social_short.py --category Humor_&_Banter

  # Generate from catalog metadata:
  python scripts/make_social_short.py --catalog "best_saved_clips/clips_catalog.json" --limit 3
"""

import os
import re
import sys
import json
import tempfile
import argparse
import subprocess
from pathlib import Path
from typing import Optional, List, Dict, Any

try:
    import imageio_ffmpeg
    FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()
except ImportError:
    FFMPEG_EXE = "ffmpeg"


def sanitize_filename(name: str) -> str:
    clean = re.sub(r'[\\/*?:"<>|]', "", name)
    clean = re.sub(r'\s+', "_", clean).strip(" ._")
    return clean[:50] if clean else "short"


def escape_ffmpeg_text(text: str) -> str:
    """Escapes text for FFmpeg drawtext filter."""
    text = text.replace("\\", "\\\\")
    text = text.replace(":", "\\:")
    text = text.replace("'", "\\'")
    text = text.replace("%", "\\%")
    text = text.replace('"', '\\"')
    return text


def generate_vertical_short(
    audio_path: str,
    output_path: str,
    title: str = "Space Highlight",
    category: str = "Highlight",
    speakers: Optional[List[str]] = None,
    quote: str = "",
) -> bool:
    """Generates a 1080x1920 vertical MP4 audiogram with animated waveform & badges."""
    if not os.path.exists(audio_path):
        print(f"[!] Audio file not found: {audio_path}")
        return False

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    spk_text = ", ".join(speakers) if speakers else ""

    # Wrap quote for 1080 width (approx 35 chars per line)
    words = quote.split()
    wrapped_lines = []
    curr_line = []
    for w in words[:40]: # cap word count for clean layout
        curr_line.append(w)
        if len(" ".join(curr_line)) > 30:
            wrapped_lines.append(" ".join(curr_line))
            curr_line = []
    if curr_line:
        wrapped_lines.append(" ".join(curr_line))
    wrapped_quote = "\n".join(wrapped_lines[:6]) # max 6 lines

    out_dir = os.path.dirname(output_path) or "."
    os.makedirs(out_dir, exist_ok=True)
    quote_file = os.path.join(out_dir, "_temp_quote.txt")
    title_file = os.path.join(out_dir, "_temp_title.txt")
    spk_file = os.path.join(out_dir, "_temp_spk.txt")

    with open(quote_file, "w", encoding="utf-8") as f:
        f.write(wrapped_quote)
    with open(title_file, "w", encoding="utf-8") as f:
        f.write(title[:45])
    with open(spk_file, "w", encoding="utf-8") as f:
        f.write(f"Speakers: {spk_text}" if spk_text else "")

    q_rel = quote_file.replace("\\", "/").replace(":", "\\:")
    t_rel = title_file.replace("\\", "/").replace(":", "\\:")
    s_rel = spk_file.replace("\\", "/").replace(":", "\\:")

    esc_cat = escape_ffmpeg_text(category.upper())
    print(f"[*] Rendering vertical short (1080x1920): {os.path.basename(output_path)}...")

    filter_complex = (
        "color=c=0x0B0F19:s=1080x1920:d=1000[bg];"
        "[0:a]showwaves=s=880x280:mode=p2p:colors=0x6366F1@0.85:scale=sqrt[waves];"
        "[bg][waves]overlay=(W-w)/2:920:shortest=1[v1];"
        f"[v1]drawbox=x=(w-320)/2:y=340:w=320:h=60:color=0x4F46E5@0.35:t=fill,"
        f"drawtext=text='{esc_cat}':fontcolor=0xA5B4FC:fontsize=22:x=(w-text_w)/2:y=360,"
        f"drawtext=textfile='{t_rel}':fontcolor=0xFFFFFF:fontsize=46:x=(w-text_w)/2:y=450,"
        f"drawtext=textfile='{s_rel}':fontcolor=0x94A3B8:fontsize=26:x=(w-text_w)/2:y=530,"
        f"drawbox=x=90:y=620:w=900:h=240:color=0x1E293B@0.6:t=fill,"
        f"drawbox=x=90:y=620:w=900:h=240:color=0x475569@0.5:t=2,"
        f"drawtext=textfile='{q_rel}':fontcolor=0xF1F5F9:fontsize=32:line_spacing=14:x=(w-text_w)/2:y=650,"
        f"drawtext=text='Twitter Space Audio Archive':fontcolor=0x64748B:fontsize=22:x=(w-text_w)/2:y=1760[vfinal]"
    )

    cmd = [
        FFMPEG_EXE,
        "-y",
        "-i", audio_path,
        "-filter_complex", filter_complex,
        "-map", "[vfinal]",
        "-map", "0:a",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "22",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        output_path
    ]

    try:
        res = subprocess.run(cmd, capture_output=True, text=True)
    finally:
        for p in (quote_file, title_file, spk_file):
            if os.path.exists(p):
                try:
                    os.remove(p)
                except Exception:
                    pass

    if res.returncode != 0:
        print(f"[!] FFmpeg rendering failed:\n{res.stderr[-600:]}")
        return False

    print(f"[✓] Successfully rendered short: {output_path}")
    return True


def process_catalog(catalog_path: str, output_dir: str = "social_shorts", limit: int = 5):
    """Processes entries from clips_catalog.json and renders them as vertical shorts."""
    if not os.path.exists(catalog_path):
        print(f"[!] Catalog JSON not found: {catalog_path}")
        return

    with open(catalog_path, "r", encoding="utf-8") as f:
        clips = json.load(f)

    os.makedirs(output_dir, exist_ok=True)
    print(f"[*] Found {len(clips)} clips in catalog. Processing up to {limit} shorts...")

    rendered = 0
    for idx, c in enumerate(clips[:limit], 1):
        audio_path = c.get("file_path", "")
        if not os.path.exists(audio_path):
            # check public/clips or relative
            alt = os.path.join("public", "clips", os.path.basename(os.path.dirname(audio_path)), os.path.basename(audio_path))
            if os.path.exists(alt):
                audio_path = alt
            else:
                continue

        out_name = f"short_{idx:02d}_{sanitize_filename(c.get('title', 'clip'))}.mp4"
        out_path = os.path.join(output_dir, out_name)

        success = generate_vertical_short(
            audio_path=audio_path,
            output_path=out_path,
            title=c.get("title", "Space Highlight"),
            category=c.get("category", "Highlights"),
            speakers=c.get("speakers", []),
            quote=c.get("transcript_snippet", "")
        )
        if success:
            rendered += 1

    print(f"\n[✓] Finished rendering {rendered} vertical shorts into {os.path.abspath(output_dir)}!")


def main():
    parser = argparse.ArgumentParser(description="Generate vertical 9:16 video shorts for social media from audio clips")
    parser.add_argument("--audio", type=str, help="Path to audio clip (.mp3, .wav)")
    parser.add_argument("--output", type=str, default=None, help="Output MP4 path")
    parser.add_argument("--title", type=str, default="Space Highlight", help="Title displayed on video")
    parser.add_argument("--category", type=str, default="Highlight", help="Category tag")
    parser.add_argument("--speaker", type=str, default="", help="Speaker name(s)")
    parser.add_argument("--quote", type=str, default="", help="Quote text overlay")
    
    # Catalog mode
    parser.add_argument("--catalog", type=str, default="best_saved_clips/clips_catalog.json", help="Path to clips_catalog.json")
    parser.add_argument("--output-dir", type=str, default="social_shorts", help="Output directory for generated shorts")
    parser.add_argument("--limit", type=int, default=3, help="Max shorts to generate from catalog")

    args = parser.parse_args()

    if args.audio:
        out_file = args.output or f"short_{sanitize_filename(args.title)}.mp4"
        generate_vertical_short(
            audio_path=args.audio,
            output_path=out_file,
            title=args.title,
            category=args.category,
            speakers=[s.strip() for s in args.speaker.split(",") if s.strip()],
            quote=args.quote
        )
    else:
        process_catalog(args.catalog, args.output_dir, args.limit)


if __name__ == "__main__":
    main()
