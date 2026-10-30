---
name: marathon-rss-verifier
description: Validates marathon audio chunking, YouTube 12-hour limit compliance, and tri-feed RSS isolation (podcast.xml, podcast_archive.xml, clips.xml). Use when modifying RSS feed logic, splitting long episodes, or updating audio catalog generators.
---

# Marathon Audio & RSS Verifier

## Purpose
This skill provides authoritative verification procedures for SpacePipe Gen's marathon audio slicing and multi-feed RSS distribution system.

## Invariant Checks

### 1. YouTube 12-Hour Ceiling & 10-Hour Chunk Threshold
- **Threshold:** Any episode longer than 10 hours (36,000 seconds) must be sliced into sequential chunks:
  `(Part 1)`, `(Part 2)`, `(Part 3)`, etc.
- **Buffer:** Audio files in `podcast.xml` must not exceed `MAX_YOUTUBE_DURATION_SECONDS = 43080` (11 hours 58 minutes).
- **Execution Script:**
  ```bash
  python scripts/split_marathon_releases.py
  ```

### 2. Tri-Feed RSS Isolation
SpacePipe serves three distinct RSS feeds that must never have cross-feed contamination:

| Feed | Path | Contents | Exclusions |
| :--- | :--- | :--- | :--- |
| **YouTube Podcasts** | `podcast.xml` | Approved episodes $\le$ 11h 58m, chunked marathon parts `(Part X)` | Raw marathon files (> 11h 58m), highlight clips |
| **Complete Archive** | `podcast_archive.xml` | Complete unconstrained historical archive, uncut marathons | None |
| **Highlights / Clips** | `clips.xml` | Short clips from `public/clips/clips_catalog.json` | Full episodes, multipart marathon chunks |

## Verification Procedures

### Step 1: Dry-Run RSS Generation
Run the RSS generator with the dry-run flag or inspect feed output:
```bash
python scripts/generate_rss.py --all
```

### Step 2: Automated Feed Inspection
Run a Python check or verify XML entries:
```python
import xml.etree.ElementTree as ET

# 1. Verify podcast.xml has no durations > 43080 seconds
tree = ET.parse('podcast.xml')
for item in tree.findall('.//item'):
    title = item.find('title').text or ''
    duration_el = item.find('{http://www.itunes.com/dtds/podcast-1.0.dtd}duration')
    if duration_el is not None and duration_el.text:
        # duration may be in seconds or HH:MM:SS
        parts = duration_el.text.split(':')
        seconds = sum(int(x) * 60**i for i, x in enumerate(reversed(parts)))
        assert seconds <= 43080, f"Overlength episode in podcast.xml: {title} ({seconds}s)"
```

### Step 3: Catalog Merge Integrity
Check that `public/clips/clips_catalog.json` was not overwritten with a truncated set:
```bash
git diff --stat public/clips/clips_catalog.json
```
Ensure total clip count did not unexpectedly drop.
