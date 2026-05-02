import { EnhancedConfig } from '../types';

const buildPythonRSSScript = () => [
  '          import os, json, re, urllib.request',
  '          from datetime import datetime',
  '          from xml.sax.saxutils import escape',
  '          repo = os.environ["REPO"]',
  '          token = os.environ["GH_TOKEN"]',
  '          title = os.environ.get("PODCAST_TITLE", "Twitter Spaces Archive")',
  '          desc = os.environ.get("PODCAST_DESC", "Archive of Twitter Spaces")',
  '          author = os.environ.get("PODCAST_AUTHOR", "Podcast Author")',
  '          email = os.environ.get("PODCAST_EMAIL", "author@example.com")',
  '          image_fallback = os.environ.get("PODCAST_IMAGE", "https://picsum.photos/1400/1400")',
  '          github_pages_url = f"https://{repo.split(chr(47))[0]}.github.io/{repo.split(chr(47))[1]}/"',
  '          rss_url = f"{github_pages_url}podcast.xml"',
  '          image = f"{github_pages_url}artwork.jpg" if os.path.exists("artwork.jpg") else image_fallback',
  '          req = urllib.request.Request(f"https://api.github.com/repos/{repo}/releases")',
  '          req.add_header("Authorization", f"token {token}")',
  '          req.add_header("Accept", "application/vnd.github.v3+json")',
  '          try:',
  '            with urllib.request.urlopen(req) as r: releases = json.loads(r.read())',
  '          except Exception as e:',
  '            print(f"Failed: {e}"); exit(1)',
  '          rss_items = []',
  '          for release in releases:',
  '            if release.get("draft") or release.get("prerelease"): continue',
  '            pub = release.get("published_at", "")',
  '            dt = datetime.strptime(pub, "%Y-%m-%dT%H:%M:%SZ")',
  '            rfc822 = dt.strftime("%a, %d %b %Y %H:%M:%S GMT")',
  '            body = release.get("body", "")',
  '            m = re.search(r"METADATA::DURATION::(\\d{2}:\\d{2}:\\d{2})", body)',
  '            duration = m.group(1) if m else "00:00:00"',
  '            for asset in release.get("assets", []):',
  '              if asset["name"].endswith(".mp3"):',
  '                url = asset["browser_download_url"]',
  '                size = asset["size"]',
  '                guid = str(asset["id"])',
  '                t = escape(release.get("name", "Untitled Space"))',
  '                rss_items.append(f\'\'\'',
  '              <item>',
  '                <title>{t}</title>',
  '                <description>{t} - Space Replay</description>',
  '                <pubDate>{rfc822}</pubDate>',
  '                <enclosure url="{url}" length="{size}" type="audio/mpeg"/>',
  '                <guid isPermaLink="false">{guid}</guid>',
  '                <itunes:duration>{duration}</itunes:duration>',
  '                <itunes:explicit>no</itunes:explicit>',
  '              </item>\'\'\')',
  '          lbd = datetime.now().strftime("%a, %d %b %Y %H:%M:%S GMT")',
  '          rss = f\'\'\'<?xml version="1.0" encoding="UTF-8"?>',
  '          <rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">',
  '            <channel>',
  '              <title>{escape(title)}</title>',
  '              <link>{github_pages_url}</link>',
  '              <description>{escape(desc)}</description>',
  '              <language>en-us</language>',
  '              <lastBuildDate>{lbd}</lastBuildDate>',
  '              <atom:link href="{rss_url}" rel="self" type="application/rss+xml"/>',
  '              <itunes:author>{escape(author)}</itunes:author>',
  '              <itunes:owner><itunes:name>{escape(author)}</itunes:name><itunes:email>{escape(email)}</itunes:email></itunes:owner>',
  '              <itunes:image href="{image}"/>',
  '              <image><url>{image}</url><title>{escape(title)}</title><link>{github_pages_url}</link></image>',
  '              <itunes:category text="Technology"/>',
  '              <itunes:explicit>no</itunes:explicit>',
  '              {"".join(rss_items)}',
  '            </channel>',
  '          </rss>\'\'\'',
  '          with open("podcast.xml", "w") as f: f.write(rss)',
  '          print("Successfully generated podcast.xml")',
].join('\n');

export const generateIngestYaml = (config: EnhancedConfig): string => {
  const whisperStep = config.enableTranscription ? `
      - name: Transcribe with Whisper AI
        if: success()
        id: transcribe
        env:
          MP3_PATH: \${{ steps.process.outputs.mp3_path }}
        run: |
          pip install openai-whisper
          mkdir -p transcripts
          whisper "$MP3_PATH" --output_format txt --output_dir transcripts/
          echo "Transcription complete. Files saved to transcripts/"
` : '';

  const slackStep = config.enableSlackWebhook ? `
      - name: Notify Slack
        if: always()
        env:
          SLACK_WEBHOOK_URL: \${{ secrets.SLACK_WEBHOOK_URL }}
          SPACE_TITLE: \${{ steps.process.outputs.space_title }}
          JOB_STATUS: \${{ job.status }}
        run: |
          if [[ -n "$SLACK_WEBHOOK_URL" ]]; then
            curl -s -X POST "$SLACK_WEBHOOK_URL" \\
              -H 'Content-type: application/json' \\
              -d "{\\"text\\":\\"SpacePipe | $JOB_STATUS | $SPACE_TITLE\\"}" || true
          fi
` : '';

  const discordStep = config.enableDiscordWebhook ? `
      - name: Notify Discord
        if: always()
        env:
          DISCORD_WEBHOOK_URL: \${{ secrets.DISCORD_WEBHOOK_URL }}
          SPACE_TITLE: \${{ steps.process.outputs.space_title }}
          JOB_STATUS: \${{ job.status }}
        run: |
          if [[ -n "$DISCORD_WEBHOOK_URL" ]]; then
            curl -s -X POST "$DISCORD_WEBHOOK_URL" \\
              -H 'Content-type: application/json' \\
              -d "{\\"content\\":\\"SpacePipe | $JOB_STATUS | $SPACE_TITLE\\"}" || true
          fi
` : '';

  const pythonScript = buildPythonRSSScript();

  return `name: Ingest Space

on:
  push:
    paths:
      - 'space_queue.txt'
  workflow_dispatch:
    inputs:
      space_url:
        description: 'Space/Audio URL (Twitter, YouTube, Clubhouse, LinkedIn, etc.)'
        required: false
        type: string

# Prevent race conditions during RSS deployment
concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: false

permissions:
  contents: write
  pages: write
  id-token: write

jobs:
  ingest:
    runs-on: ubuntu-latest
    outputs:
      mp3_path: \${{ steps.process.outputs.mp3_path }}
      release_tag: \${{ steps.process.outputs.release_tag }}
      space_title: \${{ steps.process.outputs.space_title }}
      duration: \${{ steps.duration.outputs.duration }}
    steps:
      - name: Checkout
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2

      - name: Install ffmpeg
        run: |
          sudo apt-get update -qq
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
          MANUAL_URL: \${{ inputs.space_url }}
        run: bash ./scripts/ingest.sh

      - name: Extract MP3 Duration
        id: duration
        if: success()
        run: |
          DURATION=$(ffprobe -v error -show_entries format=duration \\
            -of default=noprint_wrappers=1:nokey=1 "\${{ steps.process.outputs.mp3_path }}" \\
            | awk '{printf "%02d:%02d:%02d", ($1/3600), ($1%3600/60), ($1%60)}')
          echo "duration=$DURATION" >> $GITHUB_OUTPUT
${whisperStep}
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
          tag_name: \${{ steps.process.outputs.release_tag }}
          name: "\${{ steps.process.outputs.space_title }}"
          files: \${{ steps.process.outputs.mp3_path }}
          body: |
            **Space Title:** \${{ steps.process.outputs.space_title }}
            **Duration:** \${{ steps.duration.outputs.duration }}
            **Processed:** \${{ steps.process.outputs.release_tag }}
            
            ---
            METADATA::DURATION::\${{ steps.duration.outputs.duration }}
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
${slackStep}${discordStep}

  rss:
    needs: ingest
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Checkout
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2

      - name: Generate RSS Feed
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          REPO: \${{ github.repository }}
          PODCAST_TITLE: "${config.podcastTitle}"
          PODCAST_DESC: "${config.podcastDescription}"
          PODCAST_AUTHOR: "${config.authorName}"
          PODCAST_EMAIL: "${config.email}"
          PODCAST_IMAGE: "${config.imageUrl}"
        run: |
          cat <<'PYEOF' > generate_rss.py
${pythonScript}
          PYEOF
          python3 generate_rss.py

      - name: Validate RSS
        run: |
          if ! grep -q '<rss version="2.0"' podcast.xml; then
            echo "Invalid RSS structure"
            exit 1
          fi
          echo "RSS validation passed"

      - name: Upload Pages Artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: .

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
`;
};

export const generateMonitorYaml = (config: EnhancedConfig): string => `name: Monitor Batch Queue

on:
  schedule:
    - cron: '${config.scheduledCron || "0 */2 * * *"}'
  workflow_dispatch:

permissions:
  contents: write

jobs:
  process-batch-queue:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2

      - name: Check and Promote from Batch Queue
        id: promote
        run: |
          if [[ ! -f batch_queue.txt ]] || [[ ! -s batch_queue.txt ]]; then
            echo "Batch queue is empty. Nothing to process."
            echo "promoted=false" >> $GITHUB_OUTPUT
            exit 0
          fi

          NEXT_URL=$(grep -v '^[[:space:]]*$' batch_queue.txt | head -n 1 | tr -d '[:space:]')
          if [[ -z "$NEXT_URL" ]]; then
            echo "No valid URL in batch queue."
            echo "promoted=false" >> $GITHUB_OUTPUT
            exit 0
          fi

          echo "Promoting: $NEXT_URL"
          echo "$NEXT_URL" > space_queue.txt

          # Remove first non-empty line from batch queue
          grep -v '^[[:space:]]*$' batch_queue.txt | tail -n +2 > batch_queue.tmp || true
          mv batch_queue.tmp batch_queue.txt

          git config --global user.name "github-actions[bot]"
          git config --global user.email "github-actions[bot]@users.noreply.github.com"
          git add space_queue.txt batch_queue.txt
          git commit -m "chore: promote next URL from batch queue" || echo "No changes"
          git push
          echo "promoted=true" >> $GITHUB_OUTPUT
          echo "URL promoted: $NEXT_URL"
`;

export const generateIngestScript = (_config: EnhancedConfig): string => `#!/bin/bash
set -euo pipefail

# ==============================================================================
# SPACEPIPE INGEST SCRIPT
# Supports: Twitter/X Spaces, YouTube, Clubhouse, LinkedIn Audio, and more
# Powered by yt-dlp
# ==============================================================================

QUEUE_FILE="space_queue.txt"
WORK_DIR="work"
TARGET_URL=""

# 1. Determine Input Source
if [[ -n "\${MANUAL_URL:-}" ]]; then
    echo "Using Manual URL from Workflow Input"
    TARGET_URL="$MANUAL_URL"
else
    if [[ ! -f "$QUEUE_FILE" ]]; then
        echo "::error::Queue file $QUEUE_FILE not found!"
        exit 1
    fi
    TARGET_URL=$(grep -v '^[[:space:]]*$' "$QUEUE_FILE" | head -n 1 | tr -d '[:space:]')
fi

# 2. Validate URL
if [[ -z "$TARGET_URL" ]]; then
    echo "::error::No URL found in input or queue file!"
    exit 1
fi

echo "Processing URL: $TARGET_URL"

# 3. Detect Platform
if echo "$TARGET_URL" | grep -qi "twitter.com\\|x.com"; then
    echo "Platform detected: Twitter/X Spaces"
elif echo "$TARGET_URL" | grep -qi "youtube.com\\|youtu.be"; then
    echo "Platform detected: YouTube"
elif echo "$TARGET_URL" | grep -qi "clubhouse.com"; then
    echo "Platform detected: Clubhouse"
elif echo "$TARGET_URL" | grep -qi "linkedin.com"; then
    echo "Platform detected: LinkedIn Audio"
else
    echo "Platform: Generic URL (yt-dlp will attempt download)"
fi

# 4. Prepare Work Directory
mkdir -p "$WORK_DIR"

# 5. Download and Convert
echo "Starting download..."
yt-dlp \\
    --retries 5 \\
    --fragment-retries 5 \\
    --no-playlist \\
    --restrict-filenames \\
    --extract-audio \\
    --audio-format mp3 \\
    --audio-quality 0 \\
    --embed-metadata \\
    --embed-thumbnail \\
    --output "$WORK_DIR/%(upload_date)s_%(id)s_%(title)s.%(ext)s" \\
    "$TARGET_URL"

# 6. Verify Output
MP3_FILE=$(find "$WORK_DIR" -name "*.mp3" | head -n 1)
if [[ -z "$MP3_FILE" ]]; then
    echo "::error::No MP3 file was generated."
    exit 1
fi
echo "Successfully created: $MP3_FILE"

# 7. Extract Metadata
BASENAME=$(basename "$MP3_FILE" .mp3)
RELEASE_TAG="\${BASENAME:0:8}_$(date +%s)"
SPACE_TITLE="\${BASENAME:20}"
if [[ -z "$SPACE_TITLE" ]]; then SPACE_TITLE="$BASENAME"; fi

# 8. Set GitHub Output Variables
if [[ -n "\${GITHUB_OUTPUT:-}" ]]; then
    echo "mp3_path=$MP3_FILE" >> "$GITHUB_OUTPUT"
    echo "release_tag=$RELEASE_TAG" >> "$GITHUB_OUTPUT"
    echo "space_title=$SPACE_TITLE" >> "$GITHUB_OUTPUT"
fi

echo "Done."
`;

export const generateReadme = (config: EnhancedConfig): string => `# ${config.podcastTitle} — SpacePipe

Automated audio ingestion pipeline powered by GitHub Actions. Supports Twitter/X Spaces, YouTube, Clubhouse, LinkedIn Audio, and any platform supported by yt-dlp.

## Quick Start

### Option A: Single URL (Recommended)
1. Go to the **Actions** tab → **Ingest Space** → **Run workflow**
2. Paste the audio URL
3. The episode publishes automatically

### Option B: Batch Queue
1. Add URLs to \`batch_queue.txt\` (one per line)
2. Commit and push
3. The monitor workflow promotes and processes them in order

### Option C: Queue File Trigger
1. Paste a URL into \`space_queue.txt\`
2. Commit and push — the ingest pipeline starts automatically

## RSS Feed

Your podcast feed:
\`\`\`
https://${config.ownerName}.github.io/${config.repoName}/podcast.xml
\`\`\`

Submit this URL to Apple Podcasts, YouTube Podcasts, Spotify, etc.

## Supported Platforms

| Platform | Status |
|----------|--------|
| Twitter/X Spaces | ✅ Full support |
| YouTube | ✅ Full support |
| Clubhouse | ✅ Full support |
| LinkedIn Audio | ✅ Full support |
| SoundCloud | ✅ Full support |
| Any yt-dlp source | ✅ Supported |

## Directory Structure

\`\`\`
/
├─ .github/workflows/
│  ├─ ingest.yml          # Main ingest pipeline
│  ├─ monitor.yml         # Batch queue monitor (scheduled)
│  └─ test_audio.yml      # Environment verification
├─ scripts/
│  └─ ingest.sh           # Download & process script
├─ space_queue.txt        # Single URL trigger
├─ batch_queue.txt        # Multi-URL queue
└─ artwork.jpg            # Podcast cover art
\`\`\`

## Configuration

### Required Secrets (auto-configured if using SpacePipe Gen deploy)
- \`GITHUB_TOKEN\` — Built-in, no setup needed

### Optional Secrets
| Secret | Purpose |
|--------|---------|
| \`SLACK_WEBHOOK_URL\` | Slack notifications on publish |
| \`DISCORD_WEBHOOK_URL\` | Discord notifications on publish |

## Author

${config.authorName} · ${config.email}
`;

export const generateQueueFile = (config: EnhancedConfig): string => {
  if (config.batchUrls && config.batchUrls.filter(u => u.trim()).length > 0) {
    return config.batchUrls.filter(u => u.trim()).join('\n') + '\n';
  }
  return `https://twitter.com/i/spaces/1DXxyvjZpZQKM\n`;
};

export const generateTestAudioYaml = (_config: EnhancedConfig): string => `name: Test Audio Tools

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
      - name: Check yt-dlp supports key platforms
        run: |
          yt-dlp --list-extractors | grep -E "twitter|youtube|clubhouse|linkedin" | head -10
`;
