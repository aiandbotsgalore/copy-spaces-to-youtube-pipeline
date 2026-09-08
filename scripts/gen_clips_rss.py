#!/usr/bin/env python3
"""
scripts/gen_clips_rss.py

Generates a dedicated, standard-compliant podcast RSS 2.0 feed (clips.xml)
for short highlight clips. YouTube Podcasts can ingest this as a separate
show / playlist, completely distinct from the full-length episodes feed.
"""

import os
import json
import re
import urllib.request
import urllib.parse
import subprocess
from datetime import datetime, timezone
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape
from pathlib import Path

def norm_name(s):
    if not s:
        return ""
    return re.sub(r'[^a-z0-9]', '', s.lower())

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
    feed_url = f"{pages_url}clips.xml"

    # Load metadata dynamically
    meta = {}
    if os.path.exists("metadata.json"):
        try:
            with open("metadata.json", "r", encoding="utf-8") as mf:
                meta = json.load(mf)
        except Exception:
            pass

    author = os.environ.get("PODCAST_AUTHOR") or meta.get("authorName") or "Logan Black"
    email = os.environ.get("PODCAST_EMAIL") or meta.get("email") or "loganblack0@gmail.com"
    base_title = os.environ.get("PODCAST_TITLE") or meta.get("podcastTitle") or "Logan Black's X-Space"
    clips_title = f"{base_title} Best Clips & Highlights"

    if os.path.exists("artwork.png"):
        image_url = f"{pages_url}artwork.png"
    elif os.path.exists("artwork.jpg"):
        image_url = f"{pages_url}artwork.jpg"
    else:
        image_url = os.environ.get("PODCAST_IMAGE") or meta.get("imageUrl") or f"{pages_url}artwork.png"

    # Load clips catalog
    catalog_path = Path("public/clips/clips_catalog.json")
    if not catalog_path.exists():
        catalog_path = Path("best_saved_clips/clips_catalog.json")
    
    if not catalog_path.exists():
        print(f"[!] No clips catalog found at {catalog_path}")
        return

    with open(catalog_path, "r", encoding="utf-8") as f:
        clips = json.load(f)

    print(f"[*] Loaded {len(clips)} clips from {catalog_path}")

    # Load releases from cache or GitHub API
    releases = []
    if os.path.exists("releases.json"):
        try:
            with open("releases.json", "r", encoding="utf-8") as f:
                releases = json.load(f)
            print(f"[*] Loaded {len(releases)} releases from releases.json cache.")
        except Exception as e:
            print(f"[!] Could not read releases.json: {e}")

    if not releases and token:
        print("[*] Fetching releases from GitHub API for asset sizing & dates...")
        page = 1
        while True:
            req = urllib.request.Request(f"https://api.github.com/repos/{repo}/releases?per_page=100&page={page}")
            req.add_header("Authorization", f"token {token}")
            try:
                with urllib.request.urlopen(req, timeout=20.0) as r:
                    data = json.loads(r.read())
            except Exception as e:
                print(f"  [!] Error fetching releases page {page}: {e}")
                break

            if not data:
                break
            releases.extend(data)
            page += 1
            if len(data) < 100:
                break
        print(f"[*] Fetched {len(releases)} releases from API.")

    # Build asset lookup
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
            asset_info = {
                "size": a.get("size", 0),
                "id": a.get("id"),
                "url": url,
                "date": dt
            }
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

        # Look up asset
        asset = asset_map.get(url)
        if not asset:
            asset = asset_map.get(urllib.parse.unquote(url))
        if not asset:
            raw_fname = url.split("/")[-1]
            asset = asset_map.get(raw_fname.lower()) or asset_map.get(urllib.parse.unquote(raw_fname).lower())
        if not asset:
            norm_asset = norm_asset_map.get(norm_name(url.split("/")[-1]))
            if norm_asset:
                asset = norm_asset

        size = asset["size"] if asset and asset.get("size") else int(duration_sec * 16000)
        pub_dt = asset["date"] if asset and asset.get("date") else None

        if not pub_dt:
            ep_name = (c.get("episode") or "").lower()
            pub_dt = release_date_map.get(ep_name, datetime.now(timezone.utc))

        pub_date_str = pub_dt.strftime("%a, %d %b %Y %H:%M:%S +0000")

        # Rich description
        speakers = ", ".join(c.get("speakers", [])) if c.get("speakers") else "Logan Black"
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
        if asset and asset.get("id"):
            guid = f"clip_{asset['id']}_{title_slug}"
        else:
            guid = f"clip_{abs(hash(url + raw_title))}"

        tags = escape(f"Twitter Space,X Space,Highlights,{category},{speakers},{author},viral clip")

        item_xml = f'''<item>
      <title>{clean_title}</title>
      <description>{full_desc}</description>
      <pubDate>{pub_date_str}</pubDate>
      <enclosure url="{url}" length="{size}" type="audio/mpeg"/>
      <guid isPermaLink="false">{guid}</guid>
      <itunes:author>{escape(author)}</itunes:author>
      <itunes:summary>{full_desc}</itunes:summary>
      <itunes:duration>{duration_str}</itunes:duration>
      <itunes:keywords>{tags}</itunes:keywords>
      <itunes:explicit>yes</itunes:explicit>
    </item>'''
        items.append(item_xml)

    rss_content = f'''<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>{escape(clips_title)}</title>
  <link>{pages_url}</link>
  <atom:link href="{feed_url}" rel="self" type="application/rss+xml"/>
  <description>The best curated highlights, viral moments, debates, and comedy clips from {escape(base_title)}.</description>
  <language>en-us</language>
  <itunes:author>{escape(author)}</itunes:author>
  <itunes:owner>
    <itunes:name>{escape(author)}</itunes:name>
    <itunes:email>{escape(email)}</itunes:email>
  </itunes:owner>
  <itunes:image href="{image_url}"/>
  <image>
    <url>{image_url}</url>
    <title>{escape(clips_title)}</title>
    <link>{pages_url}</link>
  </image>
  <itunes:category text="Technology"/>
  <itunes:category text="Comedy"/>
  <itunes:explicit>yes</itunes:explicit>
  {''.join(items)}
</channel>
</rss>'''

    # Validate XML & GUID Uniqueness
    try:
        root = ET.fromstring(rss_content)
        clip_items = root.findall(".//item")
        guids = [item.find("guid").text for item in clip_items if item.find("guid") is not None]
        if len(guids) != len(set(guids)):
            from collections import Counter
            counts = Counter(guids)
            dups = [g for g, c in counts.items() if c > 1]
            raise ValueError(f"Duplicate GUIDs found: {dups}")
        print(f"[✓] XML is valid! Generated {len(clip_items)} items with 100% unique GUIDs.")
    except Exception as e:
        print(f"[!] XML validation error: {e}")
        raise

    for dest in ["clips.xml", "public/clips.xml"]:
        Path(dest).parent.mkdir(parents=True, exist_ok=True)
        with open(dest, "w", encoding="utf-8") as f:
            f.write(rss_content)
    print(f"[✓] Wrote clips.xml ({len(rss_content)} bytes)")

    if os.path.exists("site"):
        with open("site/clips.xml", "w", encoding="utf-8") as f:
            f.write(rss_content)

if __name__ == "__main__":
    main()
