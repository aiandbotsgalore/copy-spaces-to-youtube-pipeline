#!/bin/bash
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
if [[ -n "${MANUAL_URL:-}" ]]; then
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
if echo "$TARGET_URL" | grep -qi "twitter.com\|x.com"; then
    echo "Platform detected: Twitter/X Spaces"
elif echo "$TARGET_URL" | grep -qi "youtube.com\|youtu.be"; then
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
    if [[ -n "${GITHUB_TOKEN:-}" && -n "${GITHUB_REPOSITORY:-}" ]]; then
        ALREADY_EXISTS=$(SPACE_ID="$SPACE_ID" GH_TOKEN="$GITHUB_TOKEN" REPO="$GITHUB_REPOSITORY" \
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
            if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
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
yt-dlp \
    --retries 5 \
    --fragment-retries 5 \
    --no-playlist \
    --restrict-filenames \
    --extract-audio \
    --audio-format mp3 \
    --audio-quality 0 \
    --embed-metadata \
    --embed-thumbnail \
    --output "$WORK_DIR/%(upload_date)s_%(id)s_%(title)s.%(ext)s" \
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
EPISODE_DATE="${BASENAME:0:8}"
if [[ -n "$SPACE_ID" ]]; then
    # Deterministic, collision-free tag using the platform source ID
    RELEASE_TAG="${BASENAME:0:8}_$SPACE_ID"
    # Strip the YYYYMMDD_<ID>_ prefix to extract the clean title
    DATE_ID_PREFIX="${BASENAME:0:9}${SPACE_ID}_"
    SPACE_TITLE="${BASENAME#$DATE_ID_PREFIX}"
else
    # Fallback when source ID could not be extracted
    RELEASE_TAG="${BASENAME:0:8}_$(date +%s%N | cut -c1-13)"
    SPACE_TITLE="${BASENAME:9}"
fi
if [[ -z "$SPACE_TITLE" ]] || [[ "$SPACE_TITLE" == "$BASENAME" ]]; then
    SPACE_TITLE="$BASENAME"
fi

# 9. Set GitHub Output Variables
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "mp3_path=$MP3_FILE" >> "$GITHUB_OUTPUT"
    echo "release_tag=$RELEASE_TAG" >> "$GITHUB_OUTPUT"
    echo "space_title=$SPACE_TITLE" >> "$GITHUB_OUTPUT"
    echo "space_id=$SPACE_ID" >> "$GITHUB_OUTPUT"
    echo "episode_date=$EPISODE_DATE" >> "$GITHUB_OUTPUT"
    echo "already_exists=false" >> "$GITHUB_OUTPUT"
fi

echo "Done."
