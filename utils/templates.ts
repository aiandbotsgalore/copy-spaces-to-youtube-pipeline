import { EnhancedConfig } from '../types';
import { escapeYamlDoubleQuote, escapeYamlSingleQuote } from './escape';
import { buildPythonRSSScript } from './templates/pythonRss';

export const generateIngestYaml = (config: EnhancedConfig): string => {
  const transcriptionStep = config.enableTranscription ? `
      - name: Trigger Transcription Workflow
        if: success() && steps.process.outputs.already_exists != 'true'
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          RELEASE_TAG: \${{ steps.process.outputs.release_tag }}
        run: |
          echo "Dispatching transcribe_episode.yml for release: $RELEASE_TAG"
          gh workflow run transcribe_episode.yml -f release_tag="$RELEASE_TAG" || echo "Workflow dispatch failed"
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
            PAYLOAD=$(python3 -c 'import os, json; print(json.dumps({"text": f"SpacePipe | {os.environ.get(\\"JOB_STATUS\\")} | {os.environ.get(\\"SPACE_TITLE\\")}"}))')
            curl -s -X POST "$SLACK_WEBHOOK_URL" \\
              -H 'Content-type: application/json' \\
              -d "$PAYLOAD" || true
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
            PAYLOAD=$(python3 -c 'import os, json; print(json.dumps({"content": f"SpacePipe | {os.environ.get(\\"JOB_STATUS\\")} | {os.environ.get(\\"SPACE_TITLE\\")}"}))')
            curl -s -X POST "$DISCORD_WEBHOOK_URL" \\
              -H 'Content-type: application/json' \\
              -d "$PAYLOAD" || true
          fi
` : '';

  const pythonScript = buildPythonRSSScript();

  return `name: Ingest Space
run-name: Ingest \${{ inputs.release_tag || inputs.space_url || 'Queue' }}

on:
  push:
    branches:
      - master
      - main
    paths:
      - 'batch_queue.txt'
      - 'space_queue.txt'
  workflow_dispatch:
    inputs:
      space_url:
        description: 'Space/Audio URL (Twitter, YouTube, Clubhouse, LinkedIn, etc.)'
        required: false
        type: string
      record_live:
        description: 'Record live stream (allow capturing in-progress Space)'
        required: false
        type: boolean
        default: false
      release_tag:
        description: 'Existing Release Tag for a pre-staged local audio upload (skips yt-dlp)'
        required: false
        type: string

permissions:
  contents: write
  pages: write
  id-token: write

jobs:
  ingest:
    runs-on: ubuntu-latest
    concurrency:
      group: ingest-\${{ inputs.release_tag || inputs.space_url || github.run_id }}
      cancel-in-progress: false
    outputs:
      mp3_path: \${{ steps.process.outputs.mp3_path }}
      release_tag: \${{ steps.process.outputs.release_tag }}
      space_title: \${{ steps.process.outputs.space_title }}
      space_id: \${{ steps.process.outputs.space_id }}
      episode_date: \${{ steps.process.outputs.episode_date }}
      duration: \${{ steps.duration.outputs.duration }}
      already_exists: \${{ steps.process.outputs.already_exists }}
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
          MANUAL_RELEASE_TAG: \${{ inputs.release_tag }}
          RECORD_LIVE: \${{ inputs.record_live }}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          GITHUB_REPOSITORY: \${{ github.repository }}
        run: bash ./scripts/ingest.sh

      - name: Extract MP3 Duration
        id: duration
        if: success() && steps.process.outputs.already_exists != 'true'
        env:
          MP3_PATH: \${{ steps.process.outputs.mp3_path }}
        run: |
          DURATION=$(ffprobe -v error -show_entries format=duration \\
            -of default=noprint_wrappers=1:nokey=1 "$MP3_PATH" \\
            | awk '{printf "%02d:%02d:%02d", ($1/3600), ($1%3600/60), ($1%60)}')
          echo "duration=$DURATION" >> "$GITHUB_OUTPUT"

      - name: Dequeue Processed Item
        if: success() && inputs.space_url == '' && inputs.release_tag == ''
        run: |
          git config --global user.name "github-actions[bot]"
          git config --global user.email "github-actions[bot]@users.noreply.github.com"
          if [ -f batch_queue.txt ]; then
            python3 -c "import sys; lines = [l for l in open('batch_queue.txt', 'r', encoding='utf-8') if l.strip()]; open('batch_queue.txt', 'w', encoding='utf-8').writelines(lines[1:]) if lines else None"
          fi
          if [ -f space_queue.txt ]; then
            echo "# SpacePipe: paste a URL here and commit to trigger the pipeline" > space_queue.txt
          fi
          git add batch_queue.txt space_queue.txt || true
          git commit -m "chore(queue): dequeue processed space [skip ci]" || echo "No changes to commit"
          git push || echo "Notice: Push skipped or no changes"

      - name: Create Release
        if: success() && steps.process.outputs.already_exists != 'true' && inputs.release_tag == ''
        uses: softprops/action-gh-release@c95fe1489396fe8a9eb87c0abf8aa5b2ef267fda # v2.2.1
        with:
          tag_name: \${{ steps.process.outputs.release_tag }}
          name: "\${{ steps.process.outputs.space_title }}"
          files: |
            \${{ steps.process.outputs.mp3_path }}
          fail_on_unmatched_files: false
          draft: false
          prerelease: false
          make_latest: true
          target_commitish: \${{ github.sha }}
          body: |
            - **Space Title:** \${{ steps.process.outputs.space_title }}
            - **Duration:** \${{ steps.duration.outputs.duration }}
            - **Processed:** \${{ steps.process.outputs.release_tag }}
            - **Source ID:** \${{ steps.process.outputs.space_id }}

            ---
            METADATA::DURATION::\${{ steps.duration.outputs.duration }}
            METADATA::SOURCE_ID::\${{ steps.process.outputs.space_id }}
            METADATA::EPISODE_DATE::\${{ steps.process.outputs.episode_date }}
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
${transcriptionStep}
${slackStep}${discordStep}

  rss:
    needs: ingest
    if: needs.ingest.result == 'success' && needs.ingest.outputs.already_exists != 'true'
    runs-on: ubuntu-latest
    concurrency:
      group: rss-update
      cancel-in-progress: false
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
          PODCAST_TITLE: "${escapeYamlDoubleQuote(config.podcastTitle)}"
          PODCAST_DESC: "${escapeYamlDoubleQuote(config.podcastDescription)}"
          PODCAST_AUTHOR: "${escapeYamlDoubleQuote(config.authorName)}"
          PODCAST_EMAIL: "${escapeYamlDoubleQuote(config.email)}"
          PODCAST_IMAGE: "${escapeYamlDoubleQuote(config.imageUrl)}"
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
    - cron: '${escapeYamlSingleQuote(config.scheduledCron || "0 */2 * * *")}'
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
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          if [[ ! -f batch_queue.txt ]] || [[ ! -s batch_queue.txt ]]; then
            echo "Batch queue is empty. Nothing to process."
            echo "promoted=false" >> "$GITHUB_OUTPUT"
            exit 0
          fi

          NEXT_URL=$(grep -v '^[[:space:]]*$' batch_queue.txt | grep -v '^[[:space:]]*#' | head -n 1 | tr -d '[:space:]')
          if [[ -z "$NEXT_URL" ]]; then
            echo "No valid URL in batch queue."
            echo "promoted=false" >> "$GITHUB_OUTPUT"
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
          git push || echo "Push skipped or no changes"
          echo "promoted=true" >> "$GITHUB_OUTPUT"
          echo "URL promoted: $NEXT_URL"

          # Explicitly trigger ingest workflow to avoid GITHUB_TOKEN push loop suppression
          gh workflow run ingest.yml -f space_url="$NEXT_URL" || echo "Direct workflow dispatch skipped"
`;

export const generateIngestScript = (_config: EnhancedConfig): string => `#!/bin/bash
set -euo pipefail

# ==============================================================================
# SPACEPIPE INGEST SCRIPT
# Supports: Twitter/X Spaces, YouTube, Clubhouse, LinkedIn Audio, and more
# Powered by yt-dlp
# Includes: duplicate detection against existing GitHub Releases
# ==============================================================================

WORK_DIR="work"
TARGET_URL=""

# 1. Determine Input Source
if [[ -n "\${MANUAL_RELEASE_TAG:-}" ]]; then
    echo "Using Manual Pre-Staged Release Tag: $MANUAL_RELEASE_TAG"
    RELEASE_TAG="$MANUAL_RELEASE_TAG"
    mkdir -p "$WORK_DIR"
    MP3_FILE=$(find "$WORK_DIR" -name "*.mp3" 2>/dev/null | head -n 1 || true)
    if [[ -z "$MP3_FILE" && -n "\${GITHUB_TOKEN:-}" && -n "\${GITHUB_REPOSITORY:-}" ]]; then
        gh release download "$RELEASE_TAG" --pattern "*.mp3" --dir "$WORK_DIR" || true
        MP3_FILE=$(find "$WORK_DIR" -name "*.mp3" 2>/dev/null | head -n 1 || true)
    fi
    if [[ -n "$MP3_FILE" ]]; then
        SPACE_TITLE="$MANUAL_RELEASE_TAG"
        SPACE_ID="\${MANUAL_RELEASE_TAG#*_}"
        EPISODE_DATE="\${MANUAL_RELEASE_TAG:0:8}"
        if [[ -n "\${GITHUB_OUTPUT:-}" ]]; then
            DELIM="EOF_$(date +%s%N)"
            {
                echo "mp3_path=$MP3_FILE"
                echo "release_tag=$RELEASE_TAG"
                echo "space_title<<$DELIM"
                echo "$SPACE_TITLE"
                echo "$DELIM"
                echo "space_id=$SPACE_ID"
                echo "episode_date=$EPISODE_DATE"
                echo "already_exists=false"
            } >> "$GITHUB_OUTPUT"
        fi
        echo "Pre-staged release processed successfully."
        exit 0
    fi
fi

if [[ -n "\${MANUAL_URL:-}" ]]; then
    echo "Using Manual URL from Workflow Input"
    TARGET_URL="$MANUAL_URL"
else
    # Prioritize space_queue.txt if it contains a non-comment URL
    if [[ -f "space_queue.txt" ]] && grep -v '^[[:space:]]*#' space_queue.txt | grep -q '[^[:space:]]'; then
        QUEUE_FILE="space_queue.txt"
    else
        QUEUE_FILE="\${QUEUE_FILE:-batch_queue.txt}"
    fi

    if [[ ! -f "$QUEUE_FILE" ]]; then
        echo "::notice::Queue file $QUEUE_FILE not found — nothing to ingest."
        if [[ -n "\${GITHUB_OUTPUT:-}" ]]; then
            echo "already_exists=true" >> "$GITHUB_OUTPUT"
        fi
        exit 0
    fi
    TARGET_URL=$(grep -v '^[[:space:]]*$' "$QUEUE_FILE" | grep -v '^[[:space:]]*#' | head -n 1 | tr -d '[:space:]' || true)
    if [[ -z "$TARGET_URL" ]]; then
        echo "::notice::Queue file $QUEUE_FILE is empty — nothing to ingest."
        if [[ -n "\${GITHUB_OUTPUT:-}" ]]; then
            echo "already_exists=true" >> "$GITHUB_OUTPUT"
        fi
        exit 0
    fi
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

# 4. Duplicate Detection
echo "--- Duplicate check ---"
SPACE_ID=$(yt-dlp --get-id "$TARGET_URL" 2>/dev/null | head -n 1 | tr -d '[:space:]' || echo "")

if [[ -n "$SPACE_ID" ]]; then
    echo "Source ID: $SPACE_ID"
    if [[ -n "\${GITHUB_TOKEN:-}" && -n "\${GITHUB_REPOSITORY:-}" ]]; then
        ALREADY_EXISTS=$(SPACE_ID="$SPACE_ID" GH_TOKEN="$GITHUB_TOKEN" REPO="$GITHUB_REPOSITORY" \\
            python3 - <<'PYEOF'
import os, urllib.request, json
token = os.environ.get("GH_TOKEN", "")
repo  = os.environ.get("REPO", "")
sid   = os.environ.get("SPACE_ID", "")
if not (token and repo and sid):
    print("no"); exit()
found = False
page = 1
while True:
    req = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/releases?per_page=100&page={page}"
    )
    req.add_header("Authorization", f"token {token}")
    req.add_header("Accept", "application/vnd.github.v3+json")
    try:
        with urllib.request.urlopen(req) as r:
            releases = json.loads(r.read())
    except Exception:
        break
    if not releases:
        break
    if any(f"SOURCE_ID::{sid}" in (rel.get("body") or "") for rel in releases):
        found = True
        break
    if len(releases) < 100:
        break
    page += 1
print("yes" if found else "no")
PYEOF
        )
        if [[ "$ALREADY_EXISTS" == "yes" ]]; then
            echo "::warning::Source $SPACE_ID is already in GitHub Releases — skipping to avoid duplicate."
            if [[ -n "\${GITHUB_OUTPUT:-}" ]]; then
                echo "already_exists=true" >> "$GITHUB_OUTPUT"
                echo "space_id=$SPACE_ID" >> "$GITHUB_OUTPUT"
            fi
            exit 0
        fi
        echo "No duplicate found — proceeding with download."
    else
        echo "::notice::No GitHub context — skipping duplicate check."
    fi
else
    echo "::notice::Could not extract source ID — skipping duplicate check."
fi
echo "--- End duplicate check ---"

# 5. Live Broadcast Check
RECORD_LIVE="\${RECORD_LIVE:-false}"
echo "Checking live stream status..."
LIVE_STATUS=$(yt-dlp --print live_status --no-warnings "$TARGET_URL" 2>/dev/null | tail -n 1 | tr -d '[:space:]' || echo "unknown")
echo "Live status: $LIVE_STATUS (RECORD_LIVE=$RECORD_LIVE)"

if [[ "$LIVE_STATUS" == "is_live" && "$RECORD_LIVE" != "true" ]]; then
    echo "::warning::Space is currently broadcasting live. Automated live ingestion is disabled."
    echo "::notice::To record an in-progress Space, trigger this workflow manually with 'Record Live Stream' enabled."
    if [[ -n "\${GITHUB_OUTPUT:-}" ]]; then
        echo "already_exists=true" >> "$GITHUB_OUTPUT"
        echo "space_id=\${SPACE_ID:-}" >> "$GITHUB_OUTPUT"
    fi
    exit 0
fi

if [[ "$LIVE_STATUS" == "is_upcoming" && "$RECORD_LIVE" != "true" ]]; then
    echo "::warning::Space is scheduled/upcoming. Ingestion deferred until broadcast completes."
    if [[ -n "\${GITHUB_OUTPUT:-}" ]]; then
        echo "already_exists=true" >> "$GITHUB_OUTPUT"
        echo "space_id=\${SPACE_ID:-}" >> "$GITHUB_OUTPUT"
    fi
    exit 0
fi

if [[ "$LIVE_STATUS" == "is_live" && "$RECORD_LIVE" == "true" ]]; then
    echo "🔴 Manual live capture requested: proceeding to record live broadcast."
fi

# 6. Prepare Work Directory & Download
mkdir -p "$WORK_DIR"
echo "Starting download..."
yt-dlp \\
    --retries 5 \\
    --fragment-retries 5 \\
    --no-playlist \\
    --restrict-filenames \\
    --extract-audio \\
    --audio-format mp3 \\
    --audio-quality 160k \\
    --postprocessor-args "ExtractAudio:-b:a 160k" \\
    --embed-metadata \\
    --embed-thumbnail \\
    --output "$WORK_DIR/%(release_date,upload_date)s_%(id)s_%(title)s.%(ext)s" \\
    "$TARGET_URL"

# 7. Verify Output
MP3_FILE=$(find "$WORK_DIR" -name "*.mp3" | head -n 1)
if [[ -z "$MP3_FILE" ]]; then
    echo "::error::No MP3 file was generated."
    exit 1
fi
echo "Successfully created: $MP3_FILE"

# 8. Extract Metadata
BASENAME=$(basename "$MP3_FILE" .mp3)
EPISODE_DATE="\${BASENAME:0:8}"
if [[ -n "$SPACE_ID" ]]; then
    RELEASE_TAG="\${BASENAME:0:8}_$SPACE_ID"
    DATE_ID_PREFIX="\${BASENAME:0:9}\${SPACE_ID}_"
    SPACE_TITLE="\${BASENAME#$DATE_ID_PREFIX}"
else
    RELEASE_TAG="\${BASENAME:0:8}_$(date +%s%N | cut -c1-13)"
    SPACE_TITLE="\${BASENAME:9}"
fi
if [[ -z "$SPACE_TITLE" ]] || [[ "$SPACE_TITLE" == "$BASENAME" ]]; then
    SPACE_TITLE="$BASENAME"
fi
# Strip carriage returns and collapse multiple spaces into clean single line
SPACE_TITLE=$(echo "$SPACE_TITLE" | tr -d '\r' | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g' | sed 's/^ //;s/ $//')

# 9. Set GitHub Output Variables with Delimiter Guard
if [[ -n "\${GITHUB_OUTPUT:-}" ]]; then
    DELIM="EOF_$(date +%s%N)"
    {
        echo "mp3_path=$MP3_FILE"
        echo "release_tag=$RELEASE_TAG"
        echo "space_title<<$DELIM"
        echo "$SPACE_TITLE"
        echo "$DELIM"
        echo "space_id=$SPACE_ID"
        echo "episode_date=$EPISODE_DATE"
        echo "already_exists=false"
    } >> "$GITHUB_OUTPUT"
fi

echo "Done."
`;

export const generateReadme = (config: EnhancedConfig): string => {
  const safeTitle = (config.podcastTitle || 'Spaces Archive').replace(/[\r\n]+/g, ' ').trim();
  const safeAuthor = (config.authorName || 'Spaces Host').replace(/[\r\n]+/g, ' ').trim();
  const safeEmail = (config.email || '').replace(/[\r\n]+/g, ' ').trim();

  return `# ${safeTitle} — SpacePipe

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
├─ requirements.txt       # Python dependencies (yt-dlp)
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

${safeAuthor}${safeEmail ? ` · ${safeEmail}` : ''}
`;
};

export const generateQueueFile = (config: EnhancedConfig): string => {
  if (config.batchUrls && config.batchUrls.filter(u => u.trim()).length > 0) {
    return config.batchUrls.filter(u => u.trim()).join('\n') + '\n';
  }
  return '';
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
