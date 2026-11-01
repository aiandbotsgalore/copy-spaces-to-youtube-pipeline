#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# SpacePipe 24/7 Live Space Recorder Worker
# Executed by live_recorder_daemon.mjs when a monitored Space goes live.
# ==============================================================================

SPACE_URL="${1:-}"
SPACE_ID="${2:-}"
HOST_HANDLE="${3:-}"
FALLBACK_TITLE="${4:-}"

if [[ -z "$SPACE_URL" || -z "$SPACE_ID" ]]; then
    echo "::error::Usage: record_live_space.sh <space_url> <space_id> [host_handle] [fallback_title]"
    exit 1
fi

PID_FILE="/tmp/spacepipe_recording_${SPACE_ID}.pid"
echo "$$" > "$PID_FILE"

cleanup() {
    rm -f "$PID_FILE" || true
}
trap cleanup EXIT

echo "======================================================================"
echo "🔴 Starting Live Capture for Space: $SPACE_ID"
echo "URL: $SPACE_URL | Host: @${HOST_HANDLE:-unknown}"
echo "Started at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "======================================================================"

WORK_DIR="work"
mkdir -p "$WORK_DIR" logs

# 1. Execute ingest.sh with live capture enabled
export RECORD_LIVE="true"
export MANUAL_URL="$SPACE_URL"

# We run ingest.sh to stream the live audio
bash ./scripts/ingest.sh

# 2. Check the recorded MP3 file
MP3_FILE=$(find "$WORK_DIR" -maxdepth 1 -name "*${SPACE_ID}*.mp3" 2>/dev/null | head -n 1 || find "$WORK_DIR" -maxdepth 1 -name "*.mp3" 2>/dev/null | head -n 1 || echo "")

if [[ -z "$MP3_FILE" || ! -f "$MP3_FILE" ]]; then
    echo "::warning::No MP3 file was found after stream ended. It may have been aborted before any chunks arrived."
    exit 0
fi

# 3. Guard against short false starts / mic-checks (< 90 seconds)
DURATION_SECS="0"
if command -v ffprobe >/dev/null 2>&1; then
    DURATION_SECS=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$MP3_FILE" 2>/dev/null | cut -d. -f1 || echo "0")
fi

echo "Recorded Audio Duration: ${DURATION_SECS}s"

if [[ -n "$DURATION_SECS" && "$DURATION_SECS" -gt 0 && "$DURATION_SECS" -lt 90 ]]; then
    echo "::notice::Space duration was only ${DURATION_SECS}s (< 90s). Discarding false-start/mic-check recording."
    rm -f "$MP3_FILE"
    exit 0
fi

# Format duration as HH:MM:SS
FORMATTED_DUR=$(awk -v s="${DURATION_SECS:-0}" 'BEGIN {printf "%02d:%02d:%02d", int(s/3600), int((s%3600)/60), int(s%60)}')

# 4. Extract Title and Release Tag
BASENAME=$(basename "$MP3_FILE" .mp3)
EPISODE_DATE="${BASENAME:0:8}"
if [[ ! "$EPISODE_DATE" =~ ^[0-9]{8}$ ]]; then
    EPISODE_DATE=$(date -u +"%Y%m%d")
fi

RELEASE_TAG="${EPISODE_DATE}_${SPACE_ID}"

DATE_ID_PREFIX="${BASENAME:0:9}${SPACE_ID}_"
SPACE_TITLE="${BASENAME#$DATE_ID_PREFIX}"
if [[ -z "$SPACE_TITLE" || "$SPACE_TITLE" == "$BASENAME" ]]; then
    SPACE_TITLE="${FALLBACK_TITLE:-Twitter Space $SPACE_ID}"
fi
SPACE_TITLE=$(echo "$SPACE_TITLE" | tr '_' ' ')

echo "Creating GitHub Release: $RELEASE_TAG ($SPACE_TITLE)..."

# 5. Check if multi-part chunks exist (from ingest.sh marathon splitting)
UPLOAD_FILES=("$MP3_FILE")
PART_FILES=( "$WORK_DIR"/*_Part*.mp3 )
if [[ -f "${PART_FILES[0]:-}" ]]; then
    UPLOAD_FILES=("${PART_FILES[@]}")
fi

RELEASE_NOTES=$(cat <<EOF
- **Space Title:** ${SPACE_TITLE}
- **Duration:** ${FORMATTED_DUR}
- **Processed:** ${RELEASE_TAG}
- **Source ID:** ${SPACE_ID}

---
METADATA::DURATION::${FORMATTED_DUR}
METADATA::SOURCE_ID::${SPACE_ID}
METADATA::EPISODE_DATE::${EPISODE_DATE}
METADATA::HOST::${HOST_HANDLE:-}
METADATA::YOUTUBE_STATUS::UNLISTED
EOF
)

# 6. Publish to GitHub Releases
if command -v gh >/dev/null 2>&1; then
    gh release create "$RELEASE_TAG" "${UPLOAD_FILES[@]}" \
        --title "$SPACE_TITLE" \
        --notes "$RELEASE_NOTES" \
        --make-latest || {
            echo "::warning::Release create failed, attempting asset upload to existing release..."
            gh release upload "$RELEASE_TAG" "${UPLOAD_FILES[@]}" --clobber || true
        }

    echo "✅ Published Release $RELEASE_TAG to GitHub!"

    # 7. Dispatch downstream Kaggle GPU transcription & RSS update
    echo "[*] Triggering Kaggle GPU transcription..."
    gh workflow run kaggle_transcribe.yml -f release_tag="$RELEASE_TAG" || echo "Notice: Kaggle dispatch note"

    echo "[*] Triggering RSS feed update..."
    gh workflow run update_rss.yml --ref master || echo "Notice: RSS update dispatch note"

    # 8. Clean up local audio files to preserve disk space
    echo "[*] Cleaning up local audio files from VPS disk..."
    rm -f "${UPLOAD_FILES[@]}"
    rm -f "$WORK_DIR"/*.mp3 || true
    echo "✅ Disk cleanup complete."
else
    echo "::warning::GitHub CLI (gh) not found; audio preserved at: ${UPLOAD_FILES[*]}"
fi

echo "🎉 Live recording completed successfully for $SPACE_ID."
