#!/bin/bash
set -euo pipefail

# ==============================================================================
# TWITTER SPACE INGEST SCRIPT
# ==============================================================================

QUEUE_FILE="space_queue.txt"
WORK_DIR="work"
TARGET_URL=""

# 1. Determine Input Source
if [[ -n "${MANUAL_URL:-}" ]]; then
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
RELEASE_TAG="${BASENAME:0:8}_$(date +%s)"
SPACE_TITLE="${BASENAME:20}" 
if [[ -z "$SPACE_TITLE" ]]; then SPACE_TITLE="$BASENAME"; fi

# 7. Set GitHub Output Variables
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "mp3_path=$MP3_FILE" >> "$GITHUB_OUTPUT"
    echo "release_tag=$RELEASE_TAG" >> "$GITHUB_OUTPUT"
    echo "space_title=$SPACE_TITLE" >> "$GITHUB_OUTPUT"
fi

echo "Done."
