#!/usr/bin/env python3
"""
scripts/backfill_clips_metadata.py

Enriches all clips with genuine Gemini 2.5 Flash AI metadata:
- Viral score (1-10)
- Category (Humor & Banter, Wild Story, Passionate Rant, Golden Quote)
- Reason (why it's funny/viral)
- Exact dialogue quote (transcript_snippet)
- Named speakers
- Precise start/end seconds

Uploads <release_tag>_clips.json to each GitHub Release and updates public/clips/clips_catalog.json.
Zero audio is downloaded locally.
"""

import os
import re
import sys
import json
import time
import requests
import subprocess
from pathlib import Path
from typing import Dict, Any, List, Optional
from google import genai
from pydantic import BaseModel, Field

PUBLIC_CATALOG = Path("public/clips/clips_catalog.json")
LOCAL_CATALOG = Path("best_saved_clips/clips_catalog.json")

class ClipMetadata(BaseModel):
    title: str = Field(description="Punchy, catchy title summarizing this moment")
    category: str = Field(description="'Humor & Banter', 'Wild Story', 'Passionate Rant', or 'Golden Quote'")
    viral_score: int = Field(description="Entertainment / viral score from 1 to 10")
    reason: str = Field(description="Engaging explanation of why this moment is hilarious, wild, or memorable")
    transcript_snippet: str = Field(description="Key dialogue quote or punchline from this moment")
    speakers: List[str] = Field(description="List of speakers in this excerpt")

def parse_timestamp_from_name(name: str) -> Optional[float]:
    m = re.match(r"^(?:(\d+)h)?(\d+)m(\d+)s", name)
    if not m:
        return None
    h = int(m.group(1) or 0)
    mi = int(m.group(2) or 0)
    s = int(m.group(3) or 0)
    return float(h * 3600 + mi * 60 + s)

def get_transcript_data(tag: str, assets: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    # First check local output_transcripts/
    local_dir = Path("output_transcripts")
    if local_dir.exists():
        for cand in local_dir.glob("*.json"):
            if tag in cand.name:
                try:
                    with open(cand, "r", encoding="utf-8") as f:
                        return json.load(f)
                except Exception:
                    pass

    # Next fetch from GitHub release assets (small text JSON only, no audio)
    for a in assets:
        name = a.get("name", "")
        if name.endswith(".json") and tag in name and not name.endswith("_clips.json"):
            dl_url = a.get("browser_download_url")
            print(f"    [*] Fetching transcript JSON from cloud: {name} ({a.get('size')} bytes)...")
            res = requests.get(dl_url, timeout=30)
            if res.ok:
                return res.json()
    return None

def analyze_moment_with_gemini(client: genai.Client, dialogue_text: str, clip_title: str) -> Optional[ClipMetadata]:
    prompt = f"""
You are an expert audio podcast curator analyzing a highlight moment from a Twitter Space.
Here is the raw transcript around this moment:
----------------------------------------
{dialogue_text}
----------------------------------------
Clip Title Hint: "{clip_title}"

Extract structured metadata for this highlight moment:
1. title: A catchy, hilarious, or punchy title.
2. category: Must be one of: 'Humor & Banter', 'Wild Story', 'Passionate Rant', 'Golden Quote'.
3. viral_score: Rating from 1 to 10 based on viral and entertainment appeal.
4. reason: 1-2 sentences explaining why this moment is funny, crazy, or memorable.
5. transcript_snippet: The exact punchline or key dialogue lines from this clip.
6. speakers: List of speaker names who spoke in this moment.
"""
    models = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-2.5-flash-lite", "gemini-2.5-flash"]
    for m in models:
        for attempt in range(3):
            try:
                resp = client.models.generate_content(
                    model=m,
                    contents=prompt,
                    config={
                        "response_mime_type": "application/json",
                        "response_schema": ClipMetadata,
                        "temperature": 0.3
                    }
                )
                time.sleep(1.0)
                return ClipMetadata.model_validate_json(resp.text)
            except Exception as e:
                err_str = str(e)
                print(f"      [!] Gemini attempt with {m} failed: {err_str[:100]}")
                delay_match = re.search(r"(?:retry in |retryDelay':\s*')(\d+(?:\.\d+)?)s?", err_str)
                sleep_sec = float(delay_match.group(1)) + 1.5 if delay_match else 5.0
                sleep_sec = min(sleep_sec, 65.0)
                print(f"      [*] Sleeping {sleep_sec:.1f}s for quota reset...")
                time.sleep(sleep_sec)
    return None

def main():
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        print("[!] No GEMINI_API_KEY found.")
        sys.exit(1)
    client = genai.Client(api_key=api_key)

    print("[*] Fetching releases from GitHub API...", flush=True)
    cmd = ["gh", "api", "repos/aiandbotsgalore/copy-spaces-to-youtube-pipeline/releases?per_page=100"]
    res = subprocess.run(cmd, capture_output=True, text=True, check=True)
    releases = json.loads(res.stdout)

    # Load existing local catalogs
    existing_catalog = []
    for cat_path in [LOCAL_CATALOG, PUBLIC_CATALOG]:
        if cat_path.exists():
            try:
                with open(cat_path, "r", encoding="utf-8") as f:
                    c_data = json.load(f)
                    if isinstance(c_data, list):
                        existing_catalog.extend(c_data)
            except Exception:
                pass

    # Map existing rich clips by (episode_tag, start_seconds)
    rich_map = {}
    for c in existing_catalog:
        if "AI selected highlight" not in c.get("reason", "") and c.get("reason"):
            ep = c.get("episode", "")
            start = round(c.get("start_seconds", 0))
            rich_map[(ep, start)] = c

    print(f"[*] Found {len(rich_map)} pre-existing rich clips in catalog.")

    # Target releases to process (can pass tag as arg or auto-detect releases missing _clips.json)
    target_tags = set(sys.argv[1:]) if len(sys.argv) > 1 else set()
    if not target_tags:
        for r in releases[:20]:
            r_tag = r.get("tag_name", "")
            r_assets = r.get("assets", [])
            has_clips = any(("m" in a.get("name", "")[:7] and "s" in a.get("name", "")[:7]) for a in r_assets)
            has_json = any(a.get("name", "").endswith("_clips.json") for a in r_assets)
            if has_clips and not has_json:
                target_tags.add(r_tag)

    print(f"[*] Target releases for enrichment: {list(target_tags)}")

    all_updated_clips = []
    # Copy non-target or already rich clips
    for c in existing_catalog:
        if "AI selected highlight" not in c.get("reason", ""):
            all_updated_clips.append(c)

    for r in releases:
        tag = r.get("tag_name")
        rel_name = r.get("name") or tag
        if tag not in target_tags:
            continue

        print(f"\n==================================================")
        print(f"Processing Release: {rel_name} ({tag})")
        print(f"==================================================")

        assets = r.get("assets", [])
        transcript_data = get_transcript_data(tag, assets)
        segments = transcript_data.get("segments", []) if transcript_data else []
        print(f"  [✓] Transcript segments loaded: {len(segments)}")

        # Find all clip assets in this release
        clip_assets = []
        for a in assets:
            fname = a.get("name", "")
            # Matches audio clip assets
            if ("m" in fname[:7] and "s" in fname[:7]) and (fname.endswith(".mp3") or "_" in fname):
                start_sec = parse_timestamp_from_name(fname)
                if start_sec is not None:
                    clip_assets.append((a, start_sec))

        print(f"  [*] Found {len(clip_assets)} clip assets on release.")
        release_clips = []

        for a, start_sec in clip_assets:
            fname = a.get("name", "")
            dl_url = a.get("browser_download_url", "")
            clean_title = Path(fname).stem
            # Strip timestamp prefix
            m_title = re.match(r"^(?:(\d+)h)?(\d+)m(\d+)s_(.*)$", clean_title)
            if m_title:
                clean_title = m_title.group(4).replace("_", " ").replace(".", "'").strip(" ._")

            # Check if we already have rich metadata for this clip
            matched_rich = None
            for (ep_k, s_k), rc in rich_map.items():
                if abs(s_k - round(start_sec)) <= 5:
                    matched_rich = rc
                    break

            if matched_rich and "AI selected highlight" not in matched_rich.get("reason", ""):
                print(f"  [✓] Reusing existing rich metadata for: \"{matched_rich['title']}\"")
                item = dict(matched_rich)
                item["file_path"] = dl_url
                item["download_url"] = dl_url
                item["episode"] = rel_name
                release_clips.append(item)
                continue

            print(f"  [*] Analyzing moment with Gemini 2.5 Flash: \"{clean_title}\" at {start_sec}s...")

            # Extract window of dialogue around start_sec
            window_segs = [s for s in segments if (start_sec - 10.0) <= s.get("start", 0) <= (start_sec + 80.0)]
            if not window_segs and segments:
                # Fallback: nearest segments
                window_segs = sorted(segments, key=lambda s: abs(s.get("start", 0) - start_sec))[:15]
                window_segs.sort(key=lambda s: s.get("start", 0))

            dialogue_lines = [
                f"[{s.get('start', 0):.1f}s] {s.get('speaker', 'Speaker')}: {s.get('text', '')}"
                for s in window_segs
            ]
            dialogue_text = "\n".join(dialogue_lines)

            meta = analyze_moment_with_gemini(client, dialogue_text, clean_title)
            if meta:
                duration = 60.0
                if window_segs:
                    duration = round(window_segs[-1].get("end", start_sec + 60.0) - window_segs[0].get("start", start_sec), 1)

                clip_item = {
                    "title": meta.title or clean_title,
                    "category": meta.category or "Humor & Banter",
                    "start_seconds": start_sec,
                    "end_seconds": start_sec + duration,
                    "duration": duration,
                    "speakers": meta.speakers or ["Speaker"],
                    "viral_score": meta.viral_score or 9,
                    "reason": meta.reason,
                    "transcript_snippet": meta.transcript_snippet,
                    "episode": rel_name,
                    "file_path": dl_url,
                    "download_url": dl_url
                }
                print(f"    -> Title:    {clip_item['title']}")
                print(f"    -> Category: {clip_item['category']} (Score: {clip_item['viral_score']}/10)")
                print(f"    -> Reason:   {clip_item['reason']}")
                print(f"    -> Snippet:  \"{clip_item['transcript_snippet'][:80]}...\"")
                release_clips.append(clip_item)
            else:
                print(f"    [!] Failed to generate rich metadata for {clean_title}")

        # Save <tag>_clips.json
        out_clips_json = Path("best_saved_clips") / f"{tag}_clips.json"
        out_clips_json.parent.mkdir(parents=True, exist_ok=True)
        with open(out_clips_json, "w", encoding="utf-8") as f:
            json.dump(release_clips, f, indent=2)
        print(f"  [✓] Saved {len(release_clips)} clips to {out_clips_json}")

        # Upload <tag>_clips.json to release
        print(f"  [*] Uploading {out_clips_json.name} to GitHub Release {tag}...")
        up_cmd = ["gh", "release", "upload", tag, str(out_clips_json), "--clobber"]
        subprocess.run(up_cmd, capture_output=True, text=True)

        # Append to all_updated_clips (deduplicated)
        for rc in release_clips:
            all_updated_clips = [c for c in all_updated_clips if not (
                c.get("episode") == rc["episode"] and 
                (c.get("title") == rc["title"] or abs(c.get("start_seconds", 0) - rc["start_seconds"]) <= 5)
            )]
            all_updated_clips.append(rc)

    # Save to public/clips/clips_catalog.json
    PUBLIC_CATALOG.parent.mkdir(parents=True, exist_ok=True)
    with open(PUBLIC_CATALOG, "w", encoding="utf-8") as f:
        json.dump(all_updated_clips, f, indent=2)
    print(f"\n[🎉] Updated {PUBLIC_CATALOG} with {len(all_updated_clips)} total clips (ALL with rich descriptions)!")

if __name__ == "__main__":
    main()
