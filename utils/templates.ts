import { EnhancedConfig } from '../types';

const buildPythonRSSScript = () => [
  '          import os, json, re, urllib.request',
  '          from datetime import datetime',
  '          from xml.sax.saxutils import escape',
  '          repo = os.environ["REPO"]',
  '          token = os.environ["GH_TOKEN"]',
  '          title = os.environ.get("PODCAST_TITLE", "Logan Black\'s X-Space")',
  '          desc = os.environ.get("PODCAST_DESC", "Logan Black\'s X-Space Podcast Archive")',
  '          author = os.environ.get("PODCAST_AUTHOR", "Logan Black")',
  '          email = os.environ.get("PODCAST_EMAIL", "loganblack0@gmail.com")',
  '          image_fallback = os.environ.get("PODCAST_IMAGE", "https://picsum.photos/1400/1400")',
  '          github_pages_url = f"https://{repo.split(chr(47))[0]}.github.io/{repo.split(chr(47))[1]}/"',
  '          rss_url = f"{github_pages_url}podcast.xml"',
  '          image = f"{github_pages_url}artwork.jpg" if os.path.exists("artwork.jpg") else image_fallback',
  '          releases = []',
  '          page = 1',
  '          while True:',
  '            req = urllib.request.Request(',
  '              f"https://api.github.com/repos/{repo}/releases?per_page=100&page={page}"',
  '            )',
  '            req.add_header("Authorization", f"token {token}")',
  '            req.add_header("Accept", "application/vnd.github.v3+json")',
  '            try:',
  '              with urllib.request.urlopen(req) as r: batch = json.loads(r.read())',
  '            except Exception as e:',
  '              print(f"Failed fetching releases page {page}: {e}"); exit(1)',
  '            if not batch: break',
  '            releases.extend(batch)',
  '            if len(batch) < 100: break',
  '            page += 1',
  '          def extract_recorded_datetime(rel):',
  '            body = rel.get("body", "") or ""',
  '            tag = rel.get("tag_name", "") or ""',
  '            name = rel.get("name", "") or ""',
  '            pub = rel.get("published_at", "") or ""',
  '            m = re.search(r"METADATA::EPISODE_DATE::(\\d{4})[-/]?(\\d{2})[-/]?(\\d{2})", body)',
  '            if m:',
  '              try: return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), 12, 0, 0)',
  '              except: pass',
  '            rec = re.search(r"\\*\\*Recorded:\\*\\*\\s*(\\d{4})[-/]?(\\d{2})[-/]?(\\d{2})", body)',
  '            if rec:',
  '              try: return datetime(int(rec.group(1)), int(rec.group(2)), int(rec.group(3)), 12, 0, 0)',
  '              except: pass',
  '            t = re.search(r"^(?:v)?(\\d{4})[-_]?(\\d{2})[-_]?(\\d{2})", tag)',
  '            if t:',
  '              try: return datetime(int(t.group(1)), int(t.group(2)), int(t.group(3)), 12, 0, 0)',
  '              except: pass',
  '            n = re.search(r"\\b(\\d{4})[-/](\\d{2})[-/](\\d{2})\\b", name)',
  '            if n:',
  '              try: return datetime(int(n.group(1)), int(n.group(2)), int(n.group(3)), 12, 0, 0)',
  '              except: pass',
  '            if pub:',
  '              try: return datetime.strptime(pub, "%Y-%m-%dT%H:%M:%SZ")',
  '              except: pass',
  '            return datetime.now()',
  '          published = [r for r in releases if not r.get("draft") and not r.get("prerelease")]',
  '          sorted_releases = sorted(published, key=extract_recorded_datetime, reverse=True)',
  '          rss_items = []',
  '          for release in sorted_releases:',
  '            dt = extract_recorded_datetime(release)',
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
  const assemblyAiStep = config.enableTranscription ? `
      - name: Transcribe with AssemblyAI
        if: success() && steps.process.outputs.already_exists != 'true'
        id: transcribe
        env:
          ASSEMBLYAI_API_KEY: \${{ secrets.ASSEMBLYAI_API_KEY }}
          MP3_PATH: \${{ steps.process.outputs.mp3_path }}
          EPISODE_ID: \${{ steps.process.outputs.space_id }}
          SOURCE_URL: \${{ inputs.space_url }}
        run: |
          pip install -q assemblyai
          python3 - <<'PYEOF'
          import os, sys, json
          api_key = os.environ.get("ASSEMBLYAI_API_KEY", "")
          if not api_key:
              print("::error::ASSEMBLYAI_API_KEY secret is not set. Add it at: repo Settings -> Secrets and variables -> Actions -> New repository secret.")
              sys.exit(1)
          mp3_path = os.environ.get("MP3_PATH", "")
          episode_id = os.environ.get("EPISODE_ID", "")
          source_url = os.environ.get("SOURCE_URL", "")
          if not mp3_path or not os.path.exists(mp3_path):
              print(f"::error::MP3 file not found: {mp3_path}")
              sys.exit(1)

          file_size_mb = os.path.getsize(mp3_path) / (1024 * 1024)
          print(f"🎵 Audio file: {mp3_path} ({file_size_mb:.2f} MB)")

          import assemblyai as aai, subprocess
          aai.settings.api_key = api_key
          os.makedirs("transcripts", exist_ok=True)
          base_name = os.path.splitext(os.path.basename(mp3_path))[0]
          txt_path = f"transcripts/{base_name}.txt"
          json_path = f"transcripts/{base_name}.json"

          def fmt(sec):
              s = int(sec)
              return f"{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}"

          # Plan A: Speech-band filter & loudnorm leveling pass
          opt_path = f"work/{base_name}_speech_opt.mp3"
          print(f"🎛️ Condition audio for speech: bandpass (75Hz-8.5kHz), loudnorm leveling, 24kHz mono...")
          ffmpeg_cmd = [
              "ffmpeg", "-y", "-i", mp3_path,
              "-af", "highpass=f=75,lowpass=f=8500,loudnorm=I=-16:LRA=11:TP=-1.5",
              "-ar", "24000", "-ac", "1",
              "-c:a", "libmp3lame", "-b:a", "64k",
              opt_path
          ]
          res = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
          transcribe_input = opt_path if res.returncode == 0 and os.path.exists(opt_path) else mp3_path
          if transcribe_input == opt_path:
              orig_mb = os.path.getsize(mp3_path) / (1024 * 1024)
              opt_mb = os.path.getsize(opt_path) / (1024 * 1024)
              print(f"✨ Speech optimized: {orig_mb:.1f} MB -> {opt_mb:.1f} MB ({(1 - opt_mb/orig_mb)*100:.0f}% reduction)")
          else:
              print(f"⚠️ Warning: ffmpeg enhancement failed ({res.stderr}), using original audio.")

          print("🚀 Requesting AssemblyAI Universal-3.5 Pro transcription...")
          base_keyterms = [
              "LoganBlack", "Logan Black", "Rick Doty", "Richard Doty", "Shane", "Oor",
              "Lana", "Pants Down", "UAP", "UFO", "UFOs", "PeruAliens", "David Grusch",
              "disclosure", "extraterrestrial", "NHI", "A.I."
          ]
          try:
              cfg = aai.TranscriptionConfig(
                  speaker_labels=True,
                  speech_models=["universal-3-5-pro", "universal-2"],
                  language_code="en",
                  punctuate=True,
                  format_text=True,
                  prompt="Live X Space discussion covering UAP, UFOs, paranormal topics, science, technology, government, disclosure, and related current events.",
                  keyterms_prompt=base_keyterms
              )
              transcript = aai.Transcriber().transcribe(transcribe_input, config=cfg)
          except Exception as e:
              print(f"::error::AssemblyAI exception occurred during transcription request: {e}")
              sys.exit(1)

          if transcript.status == aai.TranscriptStatus.error:
              print(f"::error::AssemblyAI transcription failed with status 'error'!")
              print(f"  Transcript ID: {transcript.id}")
              print(f"  Error message: {transcript.error}")
              sys.exit(1)

          model_used = getattr(transcript, "speech_model_used", "universal-3-5-pro")
          print(f"✅ Transcription completed successfully!")
          print(f"  Transcript ID: {transcript.id}")
          print(f"  Model used: {model_used}")
          print(f"  Confidence: {getattr(transcript, 'confidence', 'N/A')}")
          print(f"  Audio Duration: {getattr(transcript, 'audio_duration', 'N/A')}s")

          utterances = transcript.utterances or []
          distinct_speakers = sorted(list(set(str(u.speaker) for u in utterances)))
          print(f"  Speakers detected ({len(distinct_speakers)}): {', '.join(distinct_speakers)}")
          print(f"  Total utterances: {len(utterances)}")

          lines, segments = [], []
          for u in utterances:
              spk = f"Speaker {u.speaker}" if not str(u.speaker).startswith("Speaker") else str(u.speaker)
              start_sec = round(float(getattr(u, "start", 0)) / 1000.0, 3)
              end_sec = round(float(getattr(u, "end", 0)) / 1000.0, 3)
              lines.append(f"[{fmt(start_sec)} - {fmt(end_sec)}] {spk}: {u.text.strip()}")
              segments.append({
                  "start": start_sec,
                  "end": end_sec,
                  "start_ms": getattr(u, "start", None),
                  "end_ms": getattr(u, "end", None),
                  "speaker": spk,
                  "text": u.text.strip(),
                  "confidence": getattr(u, "confidence", None)
              })

          if not lines and transcript.text:
              lines.append(transcript.text.strip())

          with open(txt_path, "w", encoding="utf-8") as f:
              f.write("\\n\\n".join(lines))

          with open(json_path, "w", encoding="utf-8") as f:
              json.dump({
                  "episode_id": episode_id,
                  "source_url": source_url,
                  "transcript_id": transcript.id,
                  "model_used": model_used,
                  "confidence": getattr(transcript, "confidence", None),
                  "audio_duration": getattr(transcript, "audio_duration", None),
                  "speakers_count": len(distinct_speakers),
                  "speakers": distinct_speakers,
                  "segments": segments,
                  "text": transcript.text or ""
              }, f, indent=2)

          print(f"📄 Transcript text saved: {txt_path} ({len(lines)} speaker turns)")
          print(f"📊 JSON data saved: {json_path}")
          PYEOF
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
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          GITHUB_REPOSITORY: \${{ github.repository }}
        run: bash ./scripts/ingest.sh

      - name: Extract MP3 Duration
        id: duration
        if: success() && steps.process.outputs.already_exists != 'true'
        run: |
          DURATION=$(ffprobe -v error -show_entries format=duration \\
            -of default=noprint_wrappers=1:nokey=1 "\${{ steps.process.outputs.mp3_path }}" \\
            | awk '{printf "%02d:%02d:%02d", ($1/3600), ($1%3600/60), ($1%60)}')
          echo "duration=$DURATION" >> $GITHUB_OUTPUT
${assemblyAiStep}
      - name: Clear Queue File
        if: success() && steps.process.outputs.already_exists != 'true' && inputs.space_url == ''
        run: |
          echo "# SpacePipe: paste a URL here and commit to trigger the pipeline" > space_queue.txt
          git config --global user.name "github-actions[bot]"
          git config --global user.email "github-actions[bot]@users.noreply.github.com"
          git commit -am "chore: clear processed space from queue [skip ci]" || echo "No changes to commit"
          git push

      - name: Clear Queue File on Duplicate Detection
        if: success() && steps.process.outputs.already_exists == 'true' && inputs.space_url == ''
        run: |
          echo "# SpacePipe: paste a URL here and commit to trigger the pipeline" > space_queue.txt
          git config --global user.name "github-actions[bot]"
          git config --global user.email "github-actions[bot]@users.noreply.github.com"
          git commit -am "chore: clear duplicate URL from queue [skip ci]" || echo "No changes to commit"
          git push

      - name: Create Release
        if: success() && steps.process.outputs.already_exists != 'true'
        uses: softprops/action-gh-release@c95fe1489396fe8a9eb87c0abf8aa5b2ef267fda # v2.2.1
        with:
          tag_name: \${{ steps.process.outputs.release_tag }}
          name: "\${{ steps.process.outputs.space_title }}"
          files: |
            \${{ steps.process.outputs.mp3_path }}
            transcripts/*.txt
            transcripts/*.json
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
${slackStep}${discordStep}

  rss:
    needs: ingest
    if: needs.ingest.result == 'success' && needs.ingest.outputs.already_exists != 'true'
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
# Includes: duplicate detection against existing GitHub Releases
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
    TARGET_URL=$(grep -v '^[[:space:]]*$' "$QUEUE_FILE" | grep -v '^[[:space:]]*#' | head -n 1 | tr -d '[:space:]')
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
# Extract the platform-specific source ID before downloading.
# We look for METADATA::SOURCE_ID::<id> in existing release bodies via the
# GitHub Releases API. If found, we skip gracefully without re-downloading.
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
# Paginate through ALL releases until the API returns an empty page
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
        break  # No more pages
    if any(f"SOURCE_ID::{sid}" in (rel.get("body") or "") for rel in releases):
        found = True
        break
    if len(releases) < 100:
        break  # Last page — no need to fetch another
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

# 5. Prepare Work Directory
mkdir -p "$WORK_DIR"

# 6. Download and Convert
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
    # Deterministic, collision-free tag using the platform source ID
    RELEASE_TAG="\${BASENAME:0:8}_$SPACE_ID"
    # Strip the YYYYMMDD_<ID>_ prefix to extract the clean title
    DATE_ID_PREFIX="\${BASENAME:0:9}\${SPACE_ID}_"
    SPACE_TITLE="\${BASENAME#$DATE_ID_PREFIX}"
else
    # Fallback when source ID could not be extracted
    RELEASE_TAG="\${BASENAME:0:8}_$(date +%s%N | cut -c1-13)"
    SPACE_TITLE="\${BASENAME:9}"
fi
if [[ -z "$SPACE_TITLE" ]] || [[ "$SPACE_TITLE" == "$BASENAME" ]]; then
    SPACE_TITLE="$BASENAME"
fi

# 9. Set GitHub Output Variables
if [[ -n "\${GITHUB_OUTPUT:-}" ]]; then
    echo "mp3_path=$MP3_FILE" >> "$GITHUB_OUTPUT"
    echo "release_tag=$RELEASE_TAG" >> "$GITHUB_OUTPUT"
    echo "space_title=$SPACE_TITLE" >> "$GITHUB_OUTPUT"
    echo "space_id=$SPACE_ID" >> "$GITHUB_OUTPUT"
    echo "episode_date=$EPISODE_DATE" >> "$GITHUB_OUTPUT"
    echo "already_exists=false" >> "$GITHUB_OUTPUT"
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
| \`ASSEMBLYAI_API_KEY\` | Diarized transcription with speaker labels (AssemblyAI) |
| \`SLACK_WEBHOOK_URL\` | Slack notifications on publish |
| \`DISCORD_WEBHOOK_URL\` | Discord notifications on publish |

## Author

${config.authorName} · ${config.email}
`;

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
