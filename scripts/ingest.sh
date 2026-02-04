#!/bin/bash
set -euo pipefail

# ==============================================================================
# TWITTER SPACE INGEST SCRIPT
# Downloads Twitter Space and extracts full metadata for YouTube upload
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
    TARGET_URL=$(grep -v '^[[:space:]]*$' "$QUEUE_FILE" | head -n 1 | tr -d '[:space:]' || true)
fi

# 2. Validate URL
if [[ -z "$TARGET_URL" ]]; then
    echo "Queue is empty. Nothing to process."
    if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
        echo "skipped=true" >> "$GITHUB_OUTPUT"
    fi
    exit 0
fi

echo "Processing URL: $TARGET_URL"

# Extract Space ID from URL
SPACE_ID=$(echo "$TARGET_URL" | grep -oE '[a-zA-Z0-9]+$' | head -1)
echo "Space ID: $SPACE_ID"

# 3. Prepare Work Directory
mkdir -p "$WORK_DIR"

# 4. Download and Convert WITH full metadata JSON
echo "Starting download with metadata extraction..."

DATE=$(date +%Y%m%d)
OUTPUT_BASE="$WORK_DIR/${DATE}_${SPACE_ID}"

yt-dlp \
    --retries 3 \
    --fragment-retries 3 \
    --no-playlist \
    --restrict-filenames \
    --extract-audio \
    --audio-format mp3 \
    --audio-quality 0 \
    --embed-metadata \
    --write-info-json \
    --output "${OUTPUT_BASE}_%(title)s.%(ext)s" \
    "$TARGET_URL"

# 5. Find output files
MP3_FILE=$(find "$WORK_DIR" -name "*.mp3" | head -n 1)
JSON_FILE=$(find "$WORK_DIR" -name "*.info.json" | head -n 1)

if [[ -z "$MP3_FILE" ]]; then
    echo "::error::No MP3 file was generated."
    exit 1
fi

echo "MP3 File: $MP3_FILE"
echo "Metadata JSON: ${JSON_FILE:-none}"

# 6. Extract metadata from JSON (if available)
if [[ -n "$JSON_FILE" && -f "$JSON_FILE" ]]; then
    # Extract all the good metadata using jq or python
    SPACE_TITLE=$(python3 -c "import json; d=json.load(open('$JSON_FILE')); print(d.get('title', 'Unknown'))" 2>/dev/null || echo "Unknown")
    UPLOADER=$(python3 -c "import json; d=json.load(open('$JSON_FILE')); print(d.get('uploader', 'Unknown'))" 2>/dev/null || echo "Unknown")
    UPLOADER_ID=$(python3 -c "import json; d=json.load(open('$JSON_FILE')); print(d.get('uploader_id', ''))" 2>/dev/null || echo "")
    DESCRIPTION=$(python3 -c "import json; d=json.load(open('$JSON_FILE')); print(d.get('description', '')[:500])" 2>/dev/null || echo "")
    DURATION=$(python3 -c "import json; d=json.load(open('$JSON_FILE')); print(int(d.get('duration', 0)))" 2>/dev/null || echo "0")
    VIEW_COUNT=$(python3 -c "import json; d=json.load(open('$JSON_FILE')); print(d.get('view_count', 0) or 0)" 2>/dev/null || echo "0")
    TIMESTAMP=$(python3 -c "import json; d=json.load(open('$JSON_FILE')); print(d.get('timestamp', '') or '')" 2>/dev/null || echo "")
    RELEASE_DATE=$(python3 -c "import json; d=json.load(open('$JSON_FILE')); print(d.get('release_date', '') or d.get('upload_date', '') or '')" 2>/dev/null || echo "")
    CATEGORIES=$(python3 -c "import json; d=json.load(open('$JSON_FILE')); print(','.join(d.get('categories', [])))" 2>/dev/null || echo "")
else
    # Fallback: extract title from filename
    BASENAME=$(basename "$MP3_FILE" .mp3)
    # Remove date and ID prefix: YYYYMMDD_SPACEID_Title -> Title
    SPACE_TITLE=$(echo "$BASENAME" | sed "s/^${DATE}_${SPACE_ID}_//")
    UPLOADER="Unknown"
    UPLOADER_ID=""
    DESCRIPTION=""
    DURATION="0"
    VIEW_COUNT="0"
    TIMESTAMP=""
    RELEASE_DATE=""
    CATEGORIES=""
fi

# Clean up title (remove underscores, trim)
SPACE_TITLE=$(echo "$SPACE_TITLE" | tr '_' ' ' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
if [[ -z "$SPACE_TITLE" ]]; then SPACE_TITLE="Twitter Space $SPACE_ID"; fi

echo ""
echo "=== EXTRACTED METADATA ==="
echo "Title: $SPACE_TITLE"
echo "Host: $UPLOADER (@$UPLOADER_ID)"
echo "Duration: $DURATION seconds"
echo "Listeners: $VIEW_COUNT"
echo "Date: $RELEASE_DATE"
echo "=========================="
echo ""

# Format duration as HH:MM:SS
DURATION_FMT=$(printf '%02d:%02d:%02d' $((DURATION/3600)) $((DURATION%3600/60)) $((DURATION%60)))

# 7. Create YouTube-ready description
YOUTUBE_DESC="Originally recorded on Twitter/X Spaces

Host: ${UPLOADER}${UPLOADER_ID:+ (@$UPLOADER_ID)}
${RELEASE_DATE:+Date: $RELEASE_DATE}
Duration: $DURATION_FMT
${VIEW_COUNT:+Original Listeners: $VIEW_COUNT}

${DESCRIPTION}

---
Source: $TARGET_URL
Space ID: $SPACE_ID"

# Save YouTube metadata to file
YOUTUBE_META_FILE="$WORK_DIR/${DATE}_${SPACE_ID}_youtube_metadata.txt"
cat > "$YOUTUBE_META_FILE" << EOF
TITLE=$SPACE_TITLE
DESCRIPTION=$YOUTUBE_DESC
TAGS=Twitter Space,X Space,${UPLOADER}${CATEGORIES:+,$CATEGORIES}
ORIGINAL_URL=$TARGET_URL
SPACE_ID=$SPACE_ID
DURATION=$DURATION
DURATION_FMT=$DURATION_FMT
HOST=$UPLOADER
HOST_HANDLE=$UPLOADER_ID
LISTENERS=$VIEW_COUNT
RELEASE_DATE=$RELEASE_DATE
EOF

echo "YouTube metadata saved to: $YOUTUBE_META_FILE"

# 8. Create release tag
RELEASE_TAG="${DATE}_${SPACE_ID}"

# 9. Set GitHub Output Variables
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "mp3_path=$MP3_FILE" >> "$GITHUB_OUTPUT"
    echo "json_path=${JSON_FILE:-}" >> "$GITHUB_OUTPUT"
    echo "youtube_meta_path=$YOUTUBE_META_FILE" >> "$GITHUB_OUTPUT"
    echo "release_tag=$RELEASE_TAG" >> "$GITHUB_OUTPUT"
    echo "space_title=$SPACE_TITLE" >> "$GITHUB_OUTPUT"
    echo "space_id=$SPACE_ID" >> "$GITHUB_OUTPUT"
    echo "duration=$DURATION" >> "$GITHUB_OUTPUT"
    echo "duration_fmt=$DURATION_FMT" >> "$GITHUB_OUTPUT"
    echo "uploader=$UPLOADER" >> "$GITHUB_OUTPUT"
    echo "uploader_id=$UPLOADER_ID" >> "$GITHUB_OUTPUT"
    echo "view_count=$VIEW_COUNT" >> "$GITHUB_OUTPUT"
fi

echo "Done."
