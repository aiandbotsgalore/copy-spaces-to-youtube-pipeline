#!/usr/bin/env python3
"""
scripts/generate_rss.py
Unified RSS 2.0 Feed Generator for SpacePipe

Generates:
1. podcast.xml: YouTube Podcasts compatible feed (strictly <= 11h 58m and approved).
2. podcast_archive.xml: Full unconstrained podcast archive (including marathon spaces).
3. clips.xml: Dedicated feed for viral highlight clips and editorial moments.

Usage:
  python scripts/generate_rss.py --all       # Generates podcast.xml, podcast_archive.xml, and clips.xml
  python scripts/generate_rss.py --podcast   # Generates only podcast.xml and podcast_archive.xml
  python scripts/generate_rss.py --clips     # Generates only clips.xml
"""

import os
import sys
import json
import re
import argparse
import urllib.request
import urllib.parse
import subprocess
from pathlib import Path
from datetime import datetime, timezone
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

# Maximum YouTube length buffer (11h 58m)
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


def norm_name(s: str) -> str:
    if not s:
        return ""
    return re.sub(r'[^a-z0-9]', '', s.lower())


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

    for source in [tag, name]:
        m = re.match(r"^(\d{4})(\d{2})(\d{2})", source)
        if m:
            try:
                return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), 12, 0, 0, tzinfo=timezone.utc)
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
    items: list,
) -> str:
    items_xml = "\n".join(items)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>{escape(title)}</title>
    <link>{link}</link>
    <atom:link href="{feed_url}" rel="self" type="application/rss+xml"/>
    <description>{escape(description)}</description>
    <language>en-us</language>
    <itunes:author>{escape(author)}</itunes:author>
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
{items_xml}
  </channel>
</rss>"""


def get_repo_details():
    repo = os.environ.get("REPO", "aiandbotsgalore/copy-spaces-to-youtube-pipeline")
    parts = repo.split("/")
    owner = parts[0]
    reponame = parts[1] if len(parts) > 1 else ""
    pages_url = f"https://{owner}.github.io/{reponame}/"

    token = os.environ.get("GH_TOKEN")
    if not token:
        try:
            token = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True).stdout.strip()
        except Exception:
            token = None

    meta = {}
    if os.path.exists("metadata.json"):
        try:
            with open("metadata.json", "r", encoding="utf-8") as mf:
                meta = json.load(mf)
        except Exception:
            pass

    author = os.environ.get("PODCAST_AUTHOR") or meta.get("authorName") or "Logan Black"
    email = os.environ.get("PODCAST_EMAIL") or meta.get("email") or "loganblack0@gmail.com"
    podcast_title = os.environ.get("PODCAST_TITLE") or meta.get("podcastTitle") or "Logan Black's X-Space"
    podcast_desc = os.environ.get("PODCAST_DESC") or meta.get("podcastDescription") or "Archive of X-Spaces hosted by Logan Black."

    if os.path.exists("artwork.png"):
        image_url = f"{pages_url}artwork.png"
    elif os.path.exists("artwork.jpg"):
        image_url = f"{pages_url}artwork.jpg"
    else:
        image_url = os.environ.get("PODCAST_IMAGE") or meta.get("imageUrl") or f"{pages_url}artwork.png"

    return {
        "repo": repo,
        "token": token,
        "owner": owner,
        "reponame": reponame,
        "pages_url": pages_url,
        "meta": meta,
        "author": author,
        "email": email,
        "podcast_title": podcast_title,
        "podcast_desc": podcast_desc,
        "image_url": image_url,
    }


def fetch_all_releases(repo: str, token: str) -> list:
    if os.path.exists("releases.json"):
        try:
            with open("releases.json", "r", encoding="utf-8") as f:
                rel = json.load(f)
            if rel:
                print(f"[*] Loaded {len(rel)} releases from releases.json cache.")
                return rel
        except Exception:
            pass

    releases = []
    page = 1
    while True:
        url = f"https://api.github.com/repos/{repo}/releases?per_page=100&page={page}"
        req = urllib.request.Request(url)
        req.add_header("User-Agent", "SpacePipe-RSS")
        if token:
            req.add_header("Authorization", f"token {token}")
        try:
            with urllib.request.urlopen(req, timeout=20.0) as resp:
                data = json.loads(resp.read().decode())
                if not data:
                    break
                releases.extend(data)
                page += 1
                if len(data) < 100:
                    break
        except Exception as e:
            print(f"Warning: Failed fetching releases page {page}: {e}")
            break

    if releases:
        with open("releases.json", "w", encoding="utf-8") as f:
            json.dump(releases, f)
    return releases


def generate_podcast_rss():
    print("\n[🎙️] GENERATING PODCAST EPISODE RSS FEEDS...")
    d = get_repo_details()
    releases = fetch_all_releases(d["repo"], d["token"])

    sorted_releases = sorted(releases, key=extract_recorded_datetime, reverse=True)

    yt_items = []
    archive_items = []
    unlisted_episodes = []
    over_limit_episodes = []

    for rel in sorted_releases:
        recorded_dt = extract_recorded_datetime(rel)
        rfc822 = recorded_dt.strftime("%a, %d %b %Y %H:%M:%S +0000")

        body = rel.get("body", "") or ""
        dur_match = re.search(r"METADATA::DURATION::(\S+)", body)
        duration = dur_match.group(1) if dur_match else "00:00:00"
        dur_seconds = parse_duration_seconds(duration)

        yt_match = re.search(r"METADATA::YOUTUBE_STATUS::(\S+)", body)
        yt_status = yt_match.group(1).upper() if yt_match else "APPROVED"
        is_yt_approved = yt_status not in ["UNLISTED", "REJECTED", "EXCLUDED"]

        # Genuine episode audio assets (exclude highlight clips and short preview reels)
        mp3_assets = [
            a for a in rel.get("assets", [])
            if a["name"].endswith(".mp3")
            and not a["name"].endswith("_clips.json")
            and not a["name"].endswith("_short.mp4")
            and not a["name"].startswith("clip_")
            and not re.match(r"^(?:(\d+)h)?(\d+)m(\d+)s_", a["name"])
        ]

        if not mp3_assets:
            continue

        mp3_assets.sort(key=lambda a: a["name"])
        is_multi = len(mp3_assets) > 1

        for part_idx, asset in enumerate(mp3_assets, start=1):
            m_part = re.search(r"[-_]Part(\d+)\.mp3$", asset["name"], re.IGNORECASE)
            part_num = int(m_part.group(1)) if m_part else part_idx
            item_title = f"{rel['name']} (Part {part_num})" if is_multi else rel["name"]
            item_guid = f"{rel['id']}_part{part_num}" if is_multi else str(rel["id"])

            if is_multi and dur_seconds > 0:
                CHUNK_SECS = 36000
                part_start = (part_num - 1) * CHUNK_SECS
                part_dur_sec = max(0, min(CHUNK_SECS, dur_seconds - part_start))
                part_dur_str = f"{part_dur_sec // 3600:02d}:{(part_dur_sec % 3600) // 60:02d}:{part_dur_sec % 60:02d}"
            else:
                part_dur_str = duration

            full_desc = escape(body[:800])
            item_desc = full_desc.replace(f"Duration: {duration}", f"Duration: {part_dur_str} (Total: {duration})") if is_multi else full_desc

            item_xml = f"""    <item>
      <title>{escape(item_title)}</title>
      <description>{item_desc}</description>
      <pubDate>{rfc822}</pubDate>
      <enclosure url="{asset['browser_download_url']}" length="{asset['size']}" type="audio/mpeg"/>
      <guid isPermaLink="false">{item_guid}</guid>
      <itunes:author>{escape(d['author'])}</itunes:author>
      <itunes:summary>{item_desc}</itunes:summary>
      <itunes:duration>{part_dur_str}</itunes:duration>
      <itunes:explicit>no</itunes:explicit>
      <itunes:episodeType>full</itunes:episodeType>
    </item>"""

            archive_items.append(item_xml)

            # Check if this item qualifies for YouTube Podcasts:
            # Must be approved AND must NOT exceed YouTube's maximum duration (11h 58m buffer)
            if not is_yt_approved:
                unlisted_episodes.append((rel["name"], yt_status))
            elif not is_multi and dur_seconds > MAX_YOUTUBE_DURATION_SECONDS:
                over_limit_episodes.append((rel["name"], duration))
            elif is_multi and parse_duration_seconds(part_dur_str) > MAX_YOUTUBE_DURATION_SECONDS:
                over_limit_episodes.append((item_title, part_dur_str))
            else:
                yt_items.append(item_xml)

    yt_rss = build_channel_xml(
        title=d["podcast_title"],
        link=d["pages_url"],
        feed_url=f"{d['pages_url']}podcast.xml",
        description=d["podcast_desc"],
        author=d["author"],
        email=d["email"],
        image_url=d["image_url"],
        items=yt_items,
    )
    with open("podcast.xml", "w", encoding="utf-8") as f:
        f.write(yt_rss)

    archive_rss = build_channel_xml(
        title=f"{d['podcast_title']} (Complete Archive)",
        link=d["pages_url"],
        feed_url=f"{d['pages_url']}podcast_archive.xml",
        description=f"{d['podcast_desc']} - Complete unconstrained archive.",
        author=d["author"],
        email=d["email"],
        image_url=d["image_url"],
        items=archive_items,
    )
    with open("podcast_archive.xml", "w", encoding="utf-8") as f:
        f.write(archive_rss)

    print(f"[✓] Generated podcast.xml: {len(yt_items)} YouTube-approved episodes")
    print(f"[✓] Generated podcast_archive.xml: {len(archive_items)} total episodes")
    print(f"    Held back (Unlisted / Pending): {len(unlisted_episodes)}")
    print(f"    Excluded (> 11h 58m marathon):  {len(over_limit_episodes)}")


def generate_clips_rss():
    print("\n[🎬] GENERATING CLIPS RSS FEED...")
    d = get_repo_details()
    feed_url = f"{d['pages_url']}clips.xml"
    clips_title = f"{d['podcast_title']} Best Clips & Highlights"

    catalog_path = Path("public/clips/clips_catalog.json")
    if not catalog_path.exists():
        catalog_path = Path("best_saved_clips/clips_catalog.json")

    if not catalog_path.exists():
        print(f"[!] No clips catalog found at {catalog_path}")
        return

    with open(catalog_path, "r", encoding="utf-8") as f:
        clips = json.load(f)

    releases = fetch_all_releases(d["repo"], d["token"])

    asset_map = {}
    norm_asset_map = {}
    release_date_map = {}

    for rel in releases:
        pub = rel.get("published_at", "")
        dt = None
        if pub:
            try:
                dt = datetime.strptime(pub, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
            except Exception:
                pass
        if not dt:
            dt = datetime.now(timezone.utc)

        rel_name = rel.get("name", "") or rel.get("tag_name", "")
        release_date_map[rel_name.lower()] = dt
        if rel.get("tag_name"):
            release_date_map[rel["tag_name"].lower()] = dt

        for a in rel.get("assets", []):
            url = a.get("browser_download_url", "")
            fname = a.get("name", "")
            asset_info = {"size": a.get("size", 0), "id": a.get("id"), "url": url, "date": dt}
            if url:
                asset_map[url] = asset_info
                asset_map[urllib.parse.unquote(url)] = asset_info
            if fname:
                asset_map[fname.lower()] = asset_info
                asset_map[urllib.parse.unquote(fname.lower())] = asset_info
                norm_asset_map[norm_name(fname)] = asset_info

    items = []
    for c in clips:
        url = c.get("download_url") or c.get("file_path")
        if not url or not url.startswith("http"):
            continue

        raw_title = c.get("title", "Highlight Clip").strip()
        category = c.get("category", "Highlights").strip()
        duration_sec = float(c.get("duration", 60.0))
        minutes = int(duration_sec // 60)
        seconds = int(duration_sec % 60)
        duration_str = f"{minutes:02d}:{seconds:02d}"

        asset = asset_map.get(url) or asset_map.get(urllib.parse.unquote(url))
        if not asset:
            raw_fname = url.split("/")[-1]
            asset = asset_map.get(raw_fname.lower()) or asset_map.get(urllib.parse.unquote(raw_fname).lower())
        if not asset:
            asset = norm_asset_map.get(norm_name(url.split("/")[-1]))

        size = asset["size"] if asset and asset.get("size") else int(duration_sec * 16000)
        pub_dt = asset["date"] if asset and asset.get("date") else None
        if not pub_dt:
            ep_name = (c.get("episode") or "").lower()
            pub_dt = release_date_map.get(ep_name, datetime.now(timezone.utc))

        pub_date_str = pub_dt.strftime("%a, %d %b %Y %H:%M:%S +0000")
        speakers = ", ".join(c.get("speakers", [])) if c.get("speakers") else d["author"]
        reason = c.get("reason", "")
        snippet = c.get("transcript_snippet", "")
        ep_title = c.get("episode", "")

        desc_parts = [
            f"Clip: {raw_title}",
            f"Category: {category}",
            f"Duration: {duration_str}",
            f"Speakers: {speakers}"
        ]
        if reason:
            desc_parts.append(f"\nHighlight Note:\n{reason}")
        if snippet:
            desc_parts.append(f"\nTranscript Quote:\n\"{snippet}\"")
        if ep_title:
            desc_parts.append(f"\nOriginal Space: {ep_title}")
        desc_parts.append(f"\nDirect Audio: {url}")

        full_desc = escape("\n".join(desc_parts))
        clean_title = escape(f"[{category}] {raw_title}")

        title_slug = re.sub(r'[^a-z0-9]', '', raw_title.lower())[:12]
        guid = f"clip_{asset['id']}_{title_slug}" if asset and asset.get("id") else f"clip_{abs(hash(url + raw_title))}"
        tags = escape(f"Twitter Space,X Space,Highlights,{category},{speakers},{d['author']},viral clip")

        item_xml = f"""    <item>
      <title>{clean_title}</title>
      <description>{full_desc}</description>
      <pubDate>{pub_date_str}</pubDate>
      <enclosure url="{url}" length="{size}" type="audio/mpeg"/>
      <guid isPermaLink="false">{guid}</guid>
      <itunes:author>{escape(d['author'])}</itunes:author>
      <itunes:summary>{full_desc}</itunes:summary>
      <itunes:duration>{duration_str}</itunes:duration>
      <itunes:keywords>{tags}</itunes:keywords>
      <itunes:explicit>yes</itunes:explicit>
    </item>"""
        items.append(item_xml)

    rss_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>{escape(clips_title)}</title>
    <link>{d['pages_url']}</link>
    <atom:link href="{feed_url}" rel="self" type="application/rss+xml"/>
    <description>The best curated highlights, viral moments, debates, and comedy clips from {escape(d['podcast_title'])}.</description>
    <language>en-us</language>
    <itunes:author>{escape(d['author'])}</itunes:author>
    <itunes:owner>
      <itunes:name>{escape(d['author'])}</itunes:name>
      <itunes:email>{escape(d['email'])}</itunes:email>
    </itunes:owner>
    <itunes:image href="{d['image_url']}"/>
    <image>
      <url>{d['image_url']}</url>
      <title>{escape(clips_title)}</title>
      <link>{d['pages_url']}</link>
    </image>
    <itunes:category text="Technology"/>
    <itunes:category text="Comedy"/>
    <itunes:explicit>yes</itunes:explicit>
{chr(10).join(items)}
  </channel>
</rss>"""

    for dest in ["clips.xml", "public/clips.xml"]:
        Path(dest).parent.mkdir(parents=True, exist_ok=True)
        with open(dest, "w", encoding="utf-8") as f:
            f.write(rss_content)
    print(f"[✓] Generated clips.xml: {len(items)} curated highlight items")

    if os.path.exists("site"):
        with open("site/clips.xml", "w", encoding="utf-8") as f:
            f.write(rss_content)


def main():
    parser = argparse.ArgumentParser(description="Unified RSS 2.0 Feed Generator for SpacePipe")
    parser.add_argument("--all", action="store_true", help="Generate podcast and clips RSS feeds (default)")
    parser.add_argument("--podcast", action="store_true", help="Generate podcast.xml and podcast_archive.xml")
    parser.add_argument("--clips", action="store_true", help="Generate clips.xml")

    args = parser.parse_args()

    # Default to all if neither specific flag was passed
    run_all = args.all or (not args.podcast and not args.clips)

    if run_all or args.podcast:
        generate_podcast_rss()
    if run_all or args.clips:
        generate_clips_rss()


if __name__ == "__main__":
    main()
