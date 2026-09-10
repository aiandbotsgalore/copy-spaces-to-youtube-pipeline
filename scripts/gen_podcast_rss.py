#!/usr/bin/env python3
"""
scripts/gen_podcast_rss.py

Generates standard-compliant podcast RSS 2.0 feeds:
1. podcast.xml: Tailored for YouTube Podcasts and standard platforms.
   Strictly filters out marathon episodes exceeding 11h 58m (YouTube has a
   hard 12-hour video length limit, which causes "audio file was too long" errors).
2. podcast_archive.xml: Complete unconstrained archive of all episodes,
   including marathon spaces (for VLC, Pocket Casts, Downcast, etc.).
"""

import os
import json
import re
import urllib.request
import subprocess
from datetime import datetime, timezone
from xml.sax.saxutils import escape

# YouTube has an absolute, hard video limit of 12 hours (43,200 seconds).
# Any episode exceeding this limit causes:
# "We failed to ingest this episode because the audio file was too long."
# 11 hours 58 minutes (43,080 seconds) provides a safe 2-minute buffer.
MAX_YOUTUBE_DURATION_SECONDS = 11 * 3600 + 58 * 60


def parse_duration_seconds(dur_str: str) -> int:
    """Parse 'HH:MM:SS' or 'MM:SS' into total seconds."""
    if not dur_str:
        return 0
    parts = dur_str.strip().split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        elif len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
    except Exception:
        pass
    return 0


def extract_recorded_datetime(rel: dict) -> datetime:
    body = rel.get("body", "") or ""
    tag = rel.get("tag_name", "") or ""
    name = rel.get("name", "") or ""
    pub = rel.get("published_at", "") or ""

    m = re.search(r"METADATA::EPISODE_DATE::(\d{4})[-/]?(\d{2})[-/]?(\d{2})", body)
    if m:
        try:
            return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), 12, 0, 0, tzinfo=timezone.utc)
        except Exception:
            pass

    rec = re.search(r"\*\*Recorded:\*\*\s*(\d{4})[-/]?(\d{2})[-/]?(\d{2})", body)
    if rec:
        try:
            return datetime(int(rec.group(1)), int(rec.group(2)), int(rec.group(3)), 12, 0, 0, tzinfo=timezone.utc)
        except Exception:
            pass

    t = re.search(r"^(?:v)?(\d{4})[-_]?(\d{2})[-_]?(\d{2})", tag)
    if t:
        try:
            return datetime(int(t.group(1)), int(t.group(2)), int(t.group(3)), 12, 0, 0, tzinfo=timezone.utc)
        except Exception:
            pass

    n = re.search(r"\b(\d{4})[-/](\d{2})[-/](\d{2})\b", name)
    if n:
        try:
            return datetime(int(n.group(1)), int(n.group(2)), int(n.group(3)), 12, 0, 0, tzinfo=timezone.utc)
        except Exception:
            pass

    if pub:
        try:
            return datetime.strptime(pub, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        except Exception:
            pass

    return datetime.now(timezone.utc)


def build_channel_xml(
    title: str,
    link: str,
    feed_url: str,
    description: str,
    author: str,
    email: str,
    image_url: str,
    items: list[str],
) -> str:
    now_rfc822 = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")
    year = datetime.now(timezone.utc).year
    items_xml = "\n".join(items)

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>{escape(title)}</title>
    <link>{link}</link>
    <description>{escape(description)}</description>
    <language>en-us</language>
    <copyright>&#169; {year} {escape(author)}</copyright>
    <managingEditor>{escape(email)} ({escape(author)})</managingEditor>
    <lastBuildDate>{now_rfc822}</lastBuildDate>
    <atom:link href="{feed_url}" rel="self" type="application/rss+xml"/>
    <itunes:author>{escape(author)}</itunes:author>
    <itunes:summary>{escape(description)}</itunes:summary>
    <itunes:subtitle>{escape(description)}</itunes:subtitle>
    <itunes:owner>
      <itunes:name>{escape(author)}</itunes:name>
      <itunes:email>{escape(email)}</itunes:email>
    </itunes:owner>
    <itunes:image href="{image_url}"/>
    <image>
      <url>{image_url}</url>
      <title>{escape(title)}</title>
      <link>{link}</link>
    </image>
    <itunes:category text="Technology"/>
    <itunes:explicit>no</itunes:explicit>
    <itunes:type>episodic</itunes:type>
{items_xml}
  </channel>
</rss>"""


def main():
    repo = os.environ.get("REPO", "aiandbotsgalore/copy-spaces-to-youtube-pipeline")
    token = os.environ.get("GH_TOKEN")
    if not token:
        try:
            token = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True).stdout.strip()
        except Exception:
            token = None

    parts = repo.split("/")
    owner = parts[0]
    reponame = parts[1] if len(parts) > 1 else ""
    pages_url = f"https://{owner}.github.io/{reponame}/"

    # Dynamic metadata from metadata.json or env
    meta = {}
    if os.path.exists("metadata.json"):
        try:
            with open("metadata.json", "r", encoding="utf-8") as mf:
                meta = json.load(mf)
        except Exception:
            pass

    podcast_title = os.environ.get("PODCAST_TITLE") or meta.get("podcastTitle") or "Logan Black's X-Space"
    podcast_desc = os.environ.get("PODCAST_DESC") or meta.get("podcastDescription") or "Logan Black's X-Space Podcast Archive"
    podcast_author = os.environ.get("PODCAST_AUTHOR") or meta.get("authorName") or "Logan Black"
    podcast_email = os.environ.get("PODCAST_EMAIL") or meta.get("email") or "loganblack0@gmail.com"

    if os.path.exists("artwork.png"):
        image_url = f"{pages_url}artwork.png"
    elif os.path.exists("artwork.jpg"):
        image_url = f"{pages_url}artwork.jpg"
    else:
        image_url = os.environ.get("PODCAST_IMAGE") or meta.get("imageUrl") or "https://picsum.photos/1400/1400"

    # Fetch all releases
    releases = []
    page = 1
    while True:
        req = urllib.request.Request(f"https://api.github.com/repos/{repo}/releases?per_page=100&page={page}")
        if token:
            req.add_header("Authorization", f"token {token}")
        req.add_header("Accept", "application/vnd.github.v3+json")
        try:
            with urllib.request.urlopen(req, timeout=20.0) as r:
                batch = json.loads(r.read())
        except Exception as e:
            print(f"Error fetching releases page {page}: {e}")
            break
        if not batch:
            break
        releases.extend(batch)
        if len(batch) < 100:
            break
        page += 1

    print(f"Total releases fetched: {len(releases)}")

    valid_releases = [r for r in releases if not r.get("draft") and not r.get("prerelease")]
    sorted_releases = sorted(valid_releases, key=extract_recorded_datetime, reverse=True)

    yt_items = []
    archive_items = []
    over_limit_episodes = []

    for rel in sorted_releases:
        dt = extract_recorded_datetime(rel)
        rfc822 = dt.strftime("%a, %d %b %Y %H:%M:%S +0000")
        body = rel.get("body", "") or ""

        # Support 1 to 3+ digit hour durations (e.g. 137:50:27, 432:59:33)
        dur_match = re.search(r"METADATA::DURATION::(\d+:\d{2}:\d{2})", body)
        duration = dur_match.group(1) if dur_match else "00:00:00"
        dur_seconds = parse_duration_seconds(duration)

        mp3_assets = [a for a in rel.get("assets", []) if a.get("name", "").endswith(".mp3")]
        if not mp3_assets:
            continue

        # Exclude highlight clips (which start with timing prefixes like '05m53s_' or '01h20m30s_')
        non_clip_mp3s = [a for a in mp3_assets if not re.match(r"^\d+(?:h\d+)?m\d+s_", a.get("name", ""))]

        title_match = re.search(r"\*\*Title:\*\*\s*(.+?)(?:\n|$)", body)
        host_match = re.search(r"\*\*Host:\*\*\s*(.+?)(?:\n|$)", body)
        listeners_match = re.search(r"\*\*Listeners:\*\*\s*(.+?)(?:\n|$)", body)
        recorded_match = re.search(r"\*\*Recorded:\*\*\s*(.+?)(?:\n|$)", body)
        source_match = re.search(r"\*\*Source:\*\*\s*(.+?)(?:\n|$)", body)
        spaceid_match = re.search(r"\*\*Space ID:\*\*\s*(.+?)(?:\n|$)", body)
        desc_match = re.search(r"\*\*Space ID:\*\*[^\n]*\n\n(.+?)\n\n---", body, re.DOTALL)

        title = title_match.group(1).strip() if title_match else rel.get("name", "Unknown")
        host = host_match.group(1).strip() if host_match else ""
        if not host or host.lower() in ("unknown", "none", ""):
            host = "Logan Black"
        listeners = listeners_match.group(1).strip() if listeners_match else "0"
        recorded = recorded_match.group(1).strip() if recorded_match else ""
        source = source_match.group(1).strip() if source_match else ""
        space_id = spaceid_match.group(1).strip() if spaceid_match else ""
        orig_desc = desc_match.group(1).strip() if desc_match else ""

        desc_parts = [escape(title)]
        desc_parts.append(f"\n\nHost: {escape(host)}")
        desc_parts.append(f"\nDuration: {duration}")
        if listeners and listeners != "0":
            desc_parts.append(f"\nOriginal Listeners: {escape(listeners)}")
        if recorded:
            desc_parts.append(f"\nRecorded: {escape(recorded)}")
        if orig_desc:
            desc_parts.append(f"\n\n{escape(orig_desc)}")
        desc_parts.append("\n\n---")
        if source:
            desc_parts.append(f"\nSource: {escape(source)}")
        if space_id:
            desc_parts.append(f"\nSpace ID: {escape(space_id)}")

        full_desc = "".join(desc_parts)
        host_name = host.split("(")[0].strip() if "(" in host else host
        tags = f"Twitter Space,X Space,{escape(host_name)},podcast,audio,live recording"

        # Handle either single episode or multi-part episodes (e.g. Part 1, Part 2)
        target_assets = sorted(non_clip_mp3s, key=lambda a: a.get("name", "")) if non_clip_mp3s else [max(mp3_assets, key=lambda a: a.get("size", 0))]

        for part_idx, asset in enumerate(target_assets, 1):
            is_multi = len(target_assets) > 1
            item_title = f"{rel['name']} (Part {part_idx})" if is_multi else rel["name"]
            item_guid = f"{asset['id']}"

            # Accurately report each part's duration for YouTube compliance (<= 10 hours per part)
            if is_multi and dur_seconds > 0:
                CHUNK_SECS = 36000  # 10 hours per chunk
                part_start = (part_idx - 1) * CHUNK_SECS
                part_dur_sec = max(0, min(CHUNK_SECS, dur_seconds - part_start))
                part_dur_str = f"{part_dur_sec // 3600:02d}:{(part_dur_sec % 3600) // 60:02d}:{part_dur_sec % 60:02d}"
            else:
                part_dur_str = duration

            item_desc = full_desc.replace(f"Duration: {duration}", f"Duration: {part_dur_str} (Total Space: {duration})") if is_multi else full_desc

            item_xml = f"""    <item>
      <title>{escape(item_title)}</title>
      <description>{item_desc}</description>
      <pubDate>{rfc822}</pubDate>
      <enclosure url="{asset['browser_download_url']}" length="{asset['size']}" type="audio/mpeg"/>
      <guid isPermaLink="false">{item_guid}</guid>
      <itunes:author>{escape(host)}</itunes:author>
      <itunes:summary>{item_desc}</itunes:summary>
      <itunes:duration>{part_dur_str}</itunes:duration>
      <itunes:keywords>{tags}</itunes:keywords>
      <itunes:explicit>no</itunes:explicit>
      <itunes:episodeType>full</itunes:episodeType>
    </item>"""

            archive_items.append(item_xml)

            # In multi-part assets, each part duration is bounded; for single assets check dur_seconds
            if not is_multi and dur_seconds > MAX_YOUTUBE_DURATION_SECONDS:
                over_limit_episodes.append((rel["name"], duration))
            else:
                yt_items.append(item_xml)

    # 1. podcast.xml (YouTube safe: strictly <= 11h 58m)
    yt_rss = build_channel_xml(
        title=podcast_title,
        link=pages_url,
        feed_url=f"{pages_url}podcast.xml",
        description=podcast_desc,
        author=podcast_author,
        email=podcast_email,
        image_url=image_url,
        items=yt_items,
    )
    with open("podcast.xml", "w", encoding="utf-8") as f:
        f.write(yt_rss)

    # 2. podcast_archive.xml (Full unconstrained archive)
    archive_rss = build_channel_xml(
        title=f"{podcast_title} (Complete Archive)",
        link=pages_url,
        feed_url=f"{pages_url}podcast_archive.xml",
        description=f"{podcast_desc} - Complete unconstrained archive including marathon spaces.",
        author=podcast_author,
        email=podcast_email,
        image_url=image_url,
        items=archive_items,
    )
    with open("podcast_archive.xml", "w", encoding="utf-8") as f:
        f.write(archive_rss)

    # Save releases.json for offline caching / inspections
    with open("releases.json", "w", encoding="utf-8") as f:
        json.dump(releases, f)

    print(f"Generated podcast.xml: {len(yt_items)} YouTube-compatible episodes (<= 11h 58m)")
    print(f"Generated podcast_archive.xml: {len(archive_items)} total episodes")
    print(f"Excluded from YouTube feed: {len(over_limit_episodes)} marathon episodes (> 11h 58m)")


if __name__ == "__main__":
    main()
