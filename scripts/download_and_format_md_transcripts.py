#!/usr/bin/env python3
"""
scripts/download_and_format_md_transcripts.py

Downloads and formats all episode transcripts from GitHub Releases and the pipeline
into rich, human-readable Markdown (.md) documents.

Features:
- Exports all 83 episodes into structured .md documents in transcripts/md/ and transcripts/
- Enriches each file with metadata (Date, Space ID, Duration, Speaker breakdown, Audio URLs, RSS descriptions)
- Downloads raw .txt transcript assets from GitHub releases to transcripts/raw_txt/
- Generates master indexes in transcripts/README.md and transcripts/md/README.md
"""

import os
import re
import json
import xml.etree.ElementTree as ET
import urllib.request
from pathlib import Path
from datetime import datetime

ROOT_DIR = Path(__file__).resolve().parent.parent
SEARCH_INDEX_PATH = ROOT_DIR / "public" / "transcripts" / "transcripts_search_index.json"
PODCAST_XML_PATH = ROOT_DIR / "podcast.xml"
RELEASES_JSON_PATH = ROOT_DIR / "releases.json"

MD_DIR = ROOT_DIR / "transcripts" / "md"
RAW_TXT_DIR = ROOT_DIR / "transcripts" / "raw_txt"
ROOT_TRANSCRIPTS_DIR = ROOT_DIR / "transcripts"

MD_DIR.mkdir(parents=True, exist_ok=True)
RAW_TXT_DIR.mkdir(parents=True, exist_ok=True)


def sanitize_filename(name: str) -> str:
    cleaned = re.sub(r'[\\/*?:"<>|]', "", name)
    cleaned = re.sub(r'[\s\-_]+', "_", cleaned).strip("_")
    return cleaned[:60] if cleaned else "transcript"


def format_timestamp(seconds: float) -> str:
    total_sec = max(0, int(seconds))
    hrs, remainder = divmod(total_sec, 3600)
    mins, secs = divmod(remainder, 60)
    if hrs > 0:
        return f"{hrs:02d}:{mins:02d}:{secs:02d}"
    return f"{mins:02d}:{secs:02d}"


def load_rss_metadata():
    metadata_by_tag = {}
    if not PODCAST_XML_PATH.exists():
        return metadata_by_tag

    try:
        tree = ET.parse(PODCAST_XML_PATH)
        root = tree.getroot()
        channel = root.find("channel")
        if channel is None:
            return metadata_by_tag

        for item in channel.findall("item"):
            title = (item.findtext("title") or "").strip()
            desc = (item.findtext("description") or "").strip()
            pub_date = (item.findtext("pubDate") or "").strip()
            enclosure = item.find("enclosure")
            enc_url = enclosure.get("url", "") if enclosure is not None else ""

            m_tag = re.search(r"202\d{5}_[0-9a-zA-Z]+", enc_url)
            if m_tag:
                tag = m_tag.group(0)
                metadata_by_tag[tag] = {
                    "title": title,
                    "description": desc,
                    "pub_date": pub_date,
                    "audio_url": enc_url,
                }
    except Exception as e:
        print(f"[!] Warning reading podcast.xml: {e}")

    return metadata_by_tag


def extract_space_id(tag: str) -> str:
    parts = tag.split("_", 1)
    if len(parts) > 1 and len(parts[1]) >= 8:
        return parts[1]
    return ""


def main():
    print("[*] Starting episode transcript Markdown exporter...")

    if not SEARCH_INDEX_PATH.exists():
        print(f"[!] Error: {SEARCH_INDEX_PATH} not found.")
        return

    with open(SEARCH_INDEX_PATH, "r", encoding="utf-8") as f:
        episodes = json.load(f)

    print(f"[*] Loaded {len(episodes)} episodes from search index.")
    rss_meta = load_rss_metadata()
    print(f"[*] Loaded RSS metadata for {len(rss_meta)} episodes.")

    # Sort episodes chronologically descending (newest first)
    def get_sort_key(ep):
        tag = ep.get("release_tag", "")
        pub = ep.get("published_at", "")
        return (tag, pub)

    episodes.sort(key=get_sort_key, reverse=True)

    catalog_entries = []
    total_words = 0
    total_segments = 0

    for idx, ep in enumerate(episodes, 1):
        tag = ep.get("release_tag", "")
        title = ep.get("title", tag).strip()
        audio_url = ep.get("audio_url", "")
        segments = ep.get("segments", [])
        space_id = extract_space_id(tag)
        meta = rss_meta.get(tag, {})

        # Date resolution
        date_str = ""
        if tag.startswith("202"):
            try:
                date_str = datetime.strptime(tag[:8], "%Y%m%d").strftime("%Y-%m-%d")
            except Exception:
                date_str = tag[:8]
        elif ep.get("published_at"):
            date_str = ep["published_at"][:10]

        # Calculate duration & speakers
        max_end = max((s.get("end", 0.0) for s in segments), default=0.0)
        duration_str = format_timestamp(max_end)

        speaker_turns = {}
        for s in segments:
            spk = s.get("speaker", "Unknown")
            speaker_turns[spk] = speaker_turns.get(spk, 0) + 1

        sorted_speakers = sorted(speaker_turns.items(), key=lambda x: x[1], reverse=True)
        top_speakers = [f"{spk} ({cnt})" for spk, cnt in sorted_speakers[:8]]

        # Build Markdown content
        slug = sanitize_filename(title)
        md_filename = f"{tag}_{slug}.md"

        md_lines = []
        md_lines.append(f"# {title}\n")
        md_lines.append(f"- **Date:** {date_str or 'Unknown'}")
        md_lines.append(f"- **Release Tag:** `{tag}`")
        if space_id:
            md_lines.append(f"- **Twitter Space:** [https://x.com/i/spaces/{space_id}](https://x.com/i/spaces/{space_id})")
        if audio_url:
            md_lines.append(f"- **Audio Recording:** [Download MP3]({audio_url})")
        md_lines.append(f"- **Duration:** {duration_str}")
        md_lines.append(f"- **Total Spoken Turns:** {len(segments):,}")
        md_lines.append(f"- **Identified Speakers:** {', '.join(top_speakers) if top_speakers else 'None'}\n")

        # Include RSS description if available
        rss_desc = meta.get("description", "").strip()
        if rss_desc:
            clean_desc = "\n".join(f"> {line}" for line in rss_desc.splitlines() if line.strip())
            md_lines.append(f"### Description\n\n{clean_desc}\n")

        md_lines.append("---\n")
        md_lines.append("## Transcript\n")

        # Group consecutive segments by speaker if gap < 3 seconds
        ep_words = 0
        current_speaker = None
        current_start = None
        current_texts = []

        for s in segments:
            spk = s.get("speaker", "Speaker")
            start = s.get("start", 0.0)
            end = s.get("end", start + 5.0)
            text = (s.get("text") or "").strip()
            if not text:
                continue

            ep_words += len(text.split())

            if current_speaker is None:
                current_speaker = spk
                current_start = start
                current_texts = [text]
            elif spk == current_speaker and (start - current_texts_end) < 3.5:
                current_texts.append(text)
            else:
                # Flush previous block
                ts_str = format_timestamp(current_start)
                combined_text = " ".join(current_texts)
                md_lines.append(f"**[{ts_str}] {current_speaker}:**  \n{combined_text}\n")
                current_speaker = spk
                current_start = start
                current_texts = [text]

            current_texts_end = end

        # Flush final block
        if current_speaker and current_texts:
            ts_str = format_timestamp(current_start)
            combined_text = " ".join(current_texts)
            md_lines.append(f"**[{ts_str}] {current_speaker}:**  \n{combined_text}\n")

        md_content = "\n".join(md_lines)

        # Write to transcripts/md/ and transcripts/
        md_file_path = MD_DIR / md_filename
        root_md_path = ROOT_TRANSCRIPTS_DIR / md_filename
        with open(md_file_path, "w", encoding="utf-8") as f:
            f.write(md_content)
        with open(root_md_path, "w", encoding="utf-8") as f:
            f.write(md_content)

        total_words += ep_words
        total_segments += len(segments)

        catalog_entries.append({
            "index": idx,
            "title": title,
            "tag": tag,
            "space_id": space_id,
            "date": date_str,
            "duration": duration_str,
            "turns": len(segments),
            "words": ep_words,
            "filename": md_filename,
            "audio_url": audio_url,
            "speakers": ", ".join(spk for spk, _ in sorted_speakers[:3]),
        })

    print(f"[✓] Generated {len(catalog_entries)} Markdown transcript files.")
    print(f"    Total spoken turns: {total_segments:,}")
    print(f"    Total words transcribed: {total_words:,}")

    # Build master Markdown catalog / index
    index_lines = []
    index_lines.append("# Twitter Spaces Episode Transcripts\n")
    index_lines.append(f"Complete library of **{len(catalog_entries)}** Twitter Space episode transcripts formatted in clean Markdown (`.md`).\n")
    index_lines.append(f"- **Total Episodes:** {len(catalog_entries)}")
    index_lines.append(f"- **Total Spoken Turns:** {total_segments:,}")
    index_lines.append(f"- **Total Transcribed Words:** {total_words:,}")
    index_lines.append(f"- **Generated:** {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}\n")
    index_lines.append("---\n")
    index_lines.append("## Episode Index\n")
    index_lines.append("| # | Date | Episode Title | Duration | Turns | Speakers | Transcript (.md) | Audio |")
    index_lines.append("|---|---|---|---|---|---|---|---|")

    for entry in catalog_entries:
        title_esc = entry["title"].replace("|", "\\|")
        speakers_esc = entry["speakers"].replace("|", "\\|")
        md_link = f"[{entry['filename']}]({entry['filename']})"
        md_link_sub = f"[{entry['filename']}](md/{entry['filename']})"
        audio_link = f"[Listen]({entry['audio_url']})" if entry["audio_url"] else "-"
        index_lines.append(
            f"| {entry['index']} | {entry['date']} | {title_esc} | {entry['duration']} | {entry['turns']:,} | {speakers_esc} | {md_link} | {audio_link} |"
        )

    index_content = "\n".join(index_lines) + "\n"

    with open(ROOT_TRANSCRIPTS_DIR / "README.md", "w", encoding="utf-8") as f:
        f.write(index_content)
    with open(ROOT_TRANSCRIPTS_DIR / "INDEX.md", "w", encoding="utf-8") as f:
        f.write(index_content)
    with open(MD_DIR / "README.md", "w", encoding="utf-8") as f:
        f.write(index_content)

    print(f"[✓] Created master index catalogs in transcripts/README.md and transcripts/md/README.md")

    # Download any raw .txt assets from releases.json if not present
    if RELEASES_JSON_PATH.exists():
        print("[*] Checking for raw .txt transcript assets from GitHub releases...")
        with open(RELEASES_JSON_PATH, "r", encoding="utf-8") as f:
            releases = json.load(f)

        dl_count = 0
        for r in releases:
            tag = r.get("tag_name")
            for a in r.get("assets", []):
                name = a.get("name", "")
                if name.endswith(".txt") and not ("m" in name[:7] and "s" in name[:7]):
                    dest = RAW_TXT_DIR / name
                    if not dest.exists():
                        url = a.get("browser_download_url")
                        if url:
                            try:
                                print(f"  [-] Downloading raw {name}...", flush=True)
                                req = urllib.request.Request(url, headers={"User-Agent": "TranscriptDownloader"})
                                with urllib.request.urlopen(req, timeout=30) as resp:
                                    with open(dest, "wb") as out_f:
                                        out_f.write(resp.read())
                                dl_count += 1
                            except Exception as e:
                                print(f"  [!] Failed downloading {name}: {e}")

        print(f"[✓] Downloaded {dl_count} raw .txt files to {RAW_TXT_DIR}.")

    print("\n[🎉] ALL EPISODE TRANSCRIPTS DOWNLOADED AND FORMATTED IN MD SUCCESSFULLY!")


if __name__ == "__main__":
    main()
