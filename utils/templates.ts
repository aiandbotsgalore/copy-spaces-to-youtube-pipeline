import { PipelineConfig } from '../types';

export const generateIngestYaml = (config: PipelineConfig) => `name: Ingest Space

on:
  push:
    paths:
      - 'space_queue.txt'
  workflow_dispatch:
    inputs:
      space_url:
        description: 'Twitter Space URL (Optional overrides queue file)'
        required: false
        type: string

# Prevent race conditions during RSS deployment
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: false

permissions:
  contents: write
  pages: write
  id-token: write

jobs:
  ingest:
    runs-on: ubuntu-latest
    outputs:
      mp3_path: ${{ steps.process.outputs.mp3_path }}
      release_tag: ${{ steps.process.outputs.release_tag }}
      space_title: ${{ steps.process.outputs.space_title }}
      duration: ${{ steps.duration.outputs.duration }}
    steps:
      - name: Checkout
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2

      - name: Install ffmpeg
        run: |
          sudo apt-get update
          sudo apt-get install -y ffmpeg

      - name: Set up Python
        uses: actions/setup-python@42375524e23c412d93fb67b49958b491fce71c38 # v5.4.0
        with:
          python-version: '3.10'
          cache: 'pip'

      - name: Install yt-dlp
        run: python3 -m pip install -r requirements.txt

      - name: Run Ingest Script
        id: process
        env:
          MANUAL_URL: ${{ inputs.space_url }}
        run: bash ./scripts/ingest.sh

      - name: Extract MP3 Duration
        id: duration
        if: success()
        run: |
          DURATION=$(ffprobe -v error -show_entries format=duration \
            -of default=noprint_wrappers=1:nokey=1 "${{ steps.process.outputs.mp3_path }}" \
            | awk '{printf "%02d:%02d:%02d", ($1/3600), ($1%3600/60), ($1%60)}')
          echo "duration=$DURATION" >> $GITHUB_OUTPUT
      
      - name: Clear Queue File
        if: success() && inputs.space_url == ''
        run: |
          echo "" > space_queue.txt
          git config --global user.name "github-actions[bot]"
          git config --global user.email "github-actions[bot]@users.noreply.github.com"
          git commit -am "chore: clear processed space from queue" || echo "No changes to commit"
          git push

      - name: Create Release
        if: success()
        uses: softprops/action-gh-release@c95fe1489396fe8a9eb87c0abf8aa5b2ef267fda # v2.2.1
        with:
          tag_name: ${{ steps.process.outputs.release_tag }}
          name: "${{ steps.process.outputs.space_title }}"
          files: ${{ steps.process.outputs.mp3_path }}
          body: |
            **Space Title:** ${{ steps.process.outputs.space_title }}
            **Duration:** ${{ steps.duration.outputs.duration }}
            **Processed:** ${{ steps.process.outputs.release_tag }}
            
            ---
            METADATA::DURATION::${{ steps.duration.outputs.duration }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  rss:
    needs: ingest
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
      
      - name: Generate RSS Feed
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          REPO: ${{ github.repository }}
          PODCAST_TITLE: "${config.podcastTitle}"
          PODCAST_DESC: "${config.podcastDescription}"
          PODCAST_AUTHOR: "${config.authorName}"
          PODCAST_EMAIL: "${config.email}"
          PODCAST_IMAGE: "${config.imageUrl}"
          BASE_URL: "https://github.com/${{ github.repository }}/releases/download"
        run: |
          cat <<'EOF' > generate_rss.py
          import os
          import json
          import re
          import urllib.request
          from datetime import datetime
          from xml.sax.saxutils import escape

          # Configuration
          repo = os.environ['REPO']
          token = os.environ['GH_TOKEN']
          title = os.environ.get('PODCAST_TITLE', 'Twitter Spaces Archive')
          desc = os.environ.get('PODCAST_DESC', 'Archive of Twitter Spaces')
          author = os.environ.get('PODCAST_AUTHOR', 'Logan Black')
          email = os.environ.get('PODCAST_EMAIL', 'loganblack0@gmail.com')
          image_fallback = os.environ.get('PODCAST_IMAGE', 'https://picsum.photos/1400/1400')
          
          github_pages_url = f"https://{repo.split('/')[0]}.github.io/{repo.split('/')[1]}/"
          rss_url = f"{github_pages_url}podcast.xml"

          # Artwork Logic: Use local artwork.jpg if exists, else fallback
          if os.path.exists('artwork.jpg'):
              image = f"{github_pages_url}artwork.jpg"
          else:
              image = image_fallback

          print(f"Fetching releases for {repo}...")

          req = urllib.request.Request(f"https://api.github.com/repos/{repo}/releases")
          req.add_header('Authorization', f'token {token}')
          req.add_header('Accept', 'application/vnd.github.v3+json')

          try:
              with urllib.request.urlopen(req) as response:
                  releases = json.loads(response.read())
          except Exception as e:
              print(f"Failed to fetch releases: {e}")
              exit(1)

          rss_items = []

          for release in releases:
              if release.get('draft') or release.get('prerelease'):
                  continue
              
              pub_date_str = release.get('published_at') # ISO 8601
              dt = datetime.strptime(pub_date_str, "%Y-%m-%dT%H:%M:%SZ")
              rfc822_date = dt.strftime("%a, %d %b %Y %H:%M:%S GMT")
              
              # Extract duration from body metadata
              body = release.get('body', '')
              duration_match = re.search(r'METADATA::DURATION::(\d{2}:\d{2}:\d{2})', body)
              duration = duration_match.group(1) if duration_match else "00:00:00"

              for asset in release.get('assets', []):
                  if asset['name'].endswith('.mp3'):
                      file_url = asset['browser_download_url']
                      file_size = asset['size']
                      guid = str(asset['id'])
                      item_title = escape(release.get('name', 'Untitled Space'))
                      
                      rss_items.append(f"""
              <item>
                <title>{item_title}</title>
                <description>{item_title} - Twitter Space Replay</description>
                <pubDate>{rfc822_date}</pubDate>
                <enclosure url="{file_url}" length="{file_size}" type="audio/mpeg"/>
                <guid isPermaLink="false">{guid}</guid>
                <itunes:duration>{duration}</itunes:duration>
                <itunes:explicit>no</itunes:explicit>
              </item>""")

          # Last Build Date
          last_build_date = datetime.now().strftime("%a, %d %b %Y %H:%M:%S GMT")

          rss_content = f"""<?xml version="1.0" encoding="UTF-8"?>
          <rss version="2.0" 
               xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" 
               xmlns:googleplay="http://www.google.com/schemas/play-podcasts/1.0"
               xmlns:podcast="https://podcastindex.org/namespace/1.0"
               xmlns:atom="http://www.w3.org/2005/Atom">
            <channel>
              <title>{escape(title)}</title>
              <link>{github_pages_url}</link>
              <description>{escape(desc)}</description>
              <language>en-us</language>
              <lastBuildDate>{last_build_date}</lastBuildDate>
              <atom:link href="{rss_url}" rel="self" type="application/rss+xml" />
              <itunes:author>{escape(author)}</itunes:author>
              <itunes:owner>
                <itunes:name>{escape(author)}</itunes:name>
                <itunes:email>{escape(email)}</itunes:email>
              </itunes:owner>
              <itunes:image href="{image}"/>
              <image>
                <url>{image}</url>
                <title>{escape(title)}</title>
                <link>{github_pages_url}</link>
              </image>
              <itunes:category text="Technology"/>
              <itunes:explicit>no</itunes:explicit>
              {''.join(rss_items)}
            </channel>
          </rss>"""

          with open('podcast.xml', 'w') as f:
              f.write(rss_content)
              
          print("Successfully generated podcast.xml")
          EOF
          python3 generate_rss.py

      - name: Validate RSS
        run: |
          if ! grep -q '<rss version="2.0"' podcast.xml; then
            echo "❌ Invalid RSS structure"
            exit 1
          fi
          echo "✅ RSS validation passed"

      - name: Upload Pages Artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: .
          # Only include necessary files for deployment
          # This ensures tarball doesn't include source code junk
          # Note: pattern matching doesn't work well here, so we rely on path: .
          # and the fact that we've generated podcast.xml in root.

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
`;
}

export const generateIngestScript = () => `#!/bin/bash
set -euo pipefail

# ==============================================================================
# TWITTER SPACE INGEST SCRIPT
# ==============================================================================

QUEUE_FILE="space_queue.txt"
WORK_DIR="work"
TARGET_URL=""

# 1. Determine Input Source
# Priority: Environment Variable (Manual Run) > Queue File
if [[ -n "	MANUAL_URL:-" ]]; then
    echo "Using Manual URL from Workflow Input"
    TARGET_URL="$MANUAL_URL"
else
    if [[ ! -f "$QUEUE_FILE" ]]; then
        echo "::error::Queue file $QUEUE_FILE not found!"
        exit 1
    fi
    # Read first non-empty line
    TARGET_URL=$(grep -v '^[[:space:]]*$' "$QUEUE_FILE" | head -n 1 | tr -d '[:space:]')
fi

# 2. Validate URL
if [[ -z "$TARGET_URL" ]]; then
    echo "::error::No URL found in input or queue file!"
    exit 1
fi

echo "Processing URL: $TARGET_URL"

# 3. Prepare Work Directory
mkdir -p "$WORK_DIR"

# 4. Download and Convert
echo "Starting download..."

yt-dlp \
    --retries 3 \
    --fragment-retries 3 \
    --no-playlist \
    --restrict-filenames \
    --extract-audio \
    --audio-format mp3 \
    --audio-quality 0 \
    --embed-metadata \
    --embed-thumbnail \
    --output "$WORK_DIR/%(upload_date)s_%(id)s_%(title)s.%(ext)s" \
    "$TARGET_URL"

# 5. Verify Output
MP3_FILE=$(find "$WORK_DIR" -name "*.mp3" | head -n 1)

if [[ -z "$MP3_FILE" ]]; then
    echo "::error::No MP3 file was generated."
    exit 1
fi

echo "Successfully created: $MP3_FILE"

# 6. Extract Metadata for GitHub Actions
BASENAME=$(basename "$MP3_FILE" .mp3)
# Format: YYYYMMDD_UNIXTIMESTAMP
RELEASE_TAG="	${BASENAME:0:8}_	$(date +%s)"
# Clean title heuristic
SPACE_TITLE="	${BASENAME:20}" 
if [[ -z "$SPACE_TITLE" ]]; then SPACE_TITLE="$BASENAME"; fi

# 7. Set GitHub Output Variables
if [[ -n "	GITHUB_OUTPUT:-" ]]; then
    echo "mp3_path=$MP3_FILE" >> "$GITHUB_OUTPUT"
    echo "release_tag=$RELEASE_TAG" >> "$GITHUB_OUTPUT"
    echo "space_title=$SPACE_TITLE" >> "$GITHUB_OUTPUT"
fi

echo "Done."
`;

export const generateReadme = (config: PipelineConfig) => `# ${config.podcastTitle} Pipeline

Automated ingestion pipeline for Twitter Spaces.

## How to Use

### Option A: Quick Run (Recommended)
1. Go to the **Actions** tab in your repository.
2. Select **Ingest Space**.
3. Click **Run workflow**.
4. Paste the Twitter Space URL in the input box.

### Option B: Queue File
1. Paste a URL into 	space_queue.txt	.
2. Commit and push the change.
3. The pipeline will process it and clear the file automatically.

## RSS Feed

Your podcast feed is available at:
	https://${config.ownerName}.github.io/${config.repoName}/podcast.xml

Submit this URL to YouTube Podcast ingestion.

## Directory Structure

	```
	/
	├─ .github/
	│  └─ workflows/
	│     ├─ ingest.yml      # Main pipeline logic
	│     └─ test_audio.yml  # (Optional) Audio checks
	├─ scripts/
	│  └─ ingest.sh         # Download & Process script
	├─ space_queue.txt      # Input queue
	└─ README.md
	```

## Configuration

Update 	.github/workflows/ingest.yml	 environment variables to change podcast metadata (Title, Author, Image).
`;

export const generateQueueFile = () => `https://twitter.com/i/spaces/1DXxyvjZpZQKM
`;

export const generateTestAudioYaml = () => `name: Test Audio Tools

on: [workflow_dispatch]

jobs:
  test-env:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
      - name: Check ffmpeg
        run: ffmpeg -version
      - name: Check yt-dlp
        run: |
          python3 -m pip install yt-dlp
          yt-dlp --version
`;