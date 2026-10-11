#!/bin/bash
set -euo pipefail

# ==============================================================================
# SPACEPIPE INGEST SCRIPT
# Supports: Twitter/X Spaces, YouTube, Clubhouse, LinkedIn Audio, and more
# Powered by yt-dlp
# Includes: duplicate detection against existing GitHub Releases
# ==============================================================================

QUEUE_FILE="${QUEUE_FILE:-batch_queue.txt}"
if [[ ! -f "$QUEUE_FILE" && -f "space_queue.txt" ]]; then
    QUEUE_FILE="space_queue.txt"
fi
WORK_DIR="work"
TARGET_URL=""

# 0. Handle Pre-Staged Local Audio Upload Release (if MANUAL_RELEASE_TAG is set)
if [[ -n "${MANUAL_RELEASE_TAG:-}" ]]; then
    echo "Processing Staged Local Upload Release: $MANUAL_RELEASE_TAG"
    mkdir -p "$WORK_DIR"

    eval "$(MANUAL_RELEASE_TAG="$MANUAL_RELEASE_TAG" GH_TOKEN="${GITHUB_TOKEN:-}" REPO="${GITHUB_REPOSITORY:-}" WORK_DIR="$WORK_DIR" \
        python3 - <<'PYEOF'
import os, sys, re, json, shlex, urllib.request

tag = os.environ["MANUAL_RELEASE_TAG"].strip()
token = os.environ.get("GH_TOKEN", "").strip()
repo = os.environ.get("REPO", "").strip()
work_dir = os.environ.get("WORK_DIR", "work")

if not repo:
    print('echo "::error::GITHUB_REPOSITORY is required for release_tag ingestion."; exit 1')
    sys.exit(0)

headers = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "SpacePipe-Ingest"
}
if token:
    headers["Authorization"] = f"Bearer {token}"

rel_url = f"https://api.github.com/repos/{repo}/releases/tags/{tag}"
req = urllib.request.Request(rel_url, headers=headers)
try:
    with urllib.request.urlopen(req, timeout=30.0) as r:
        rel = json.loads(r.read())
except Exception as e:
    print(f'echo "::error::Could not fetch release for tag {tag}: {e}"; exit 1')
    sys.exit(0)

body = rel.get("body") or ""
title = rel.get("name") or tag

m_sid = re.search(r"METADATA::SOURCE_ID::(\S+)", body)
space_id = m_sid.group(1) if m_sid else (tag.split("_", 1)[1] if "_" in tag else tag)

m_date = re.search(r"METADATA::EPISODE_DATE::(\d{8})", body)
ep_date = m_date.group(1) if m_date else (tag[:8] if len(tag) >= 8 and tag[:8].isdigit() else "")

audio_exts = (".mp3", ".m4a", ".wav", ".flac", ".ogg", ".aac", ".mp4", ".webm")
assets = rel.get("assets") or []
audio_assets = [
    a for a in assets
    if a.get("name", "").lower().endswith(audio_exts)
    and not re.match(r"^\d+(?:h\d+)?m\d+s_", a.get("name", ""))
    and not a.get("name", "").startswith("clip_")
]

if not audio_assets:
    print(f'echo "::error::No audio asset found on release {tag}"; exit 1')
    sys.exit(0)

primary = max(audio_assets, key=lambda a: a.get("size", 0))
asset_name = primary["name"]
asset_id = str(primary["id"])
dl_url = primary.get("url") or primary["browser_download_url"]
local_path = os.path.join(work_dir, asset_name)

dl_headers = dict(headers)
if primary.get("url"):
    dl_headers["Accept"] = "application/octet-stream"

dl_req = urllib.request.Request(dl_url, headers=dl_headers)
with urllib.request.urlopen(dl_req, timeout=300.0) as resp, open(local_path, "wb") as out_f:
    while True:
        chunk = resp.read(1024 * 1024)
        if not chunk:
            break
        out_f.write(chunk)

print(f"RAW_FILE={shlex.quote(local_path)}")
print(f"RAW_ASSET_ID={shlex.quote(asset_id)}")
print(f"RELEASE_TAG={shlex.quote(tag)}")
print(f"SPACE_TITLE={shlex.quote(title)}")
print(f"SPACE_ID={shlex.quote(space_id)}")
print(f"EPISODE_DATE={shlex.quote(ep_date)}")
PYEOF
    )"

    echo "Downloaded staged audio file: $RAW_FILE"
    NEEDS_RELEASE_UPLOAD="false"
    EXT="${RAW_FILE##*.}"
    EXT_LOWER=$(echo "$EXT" | tr '[:upper:]' '[:lower:]')
    STEM=$(basename "$RAW_FILE" ".$EXT")

    if [[ "$EXT_LOWER" != "mp3" ]]; then
        echo "Converting .$EXT_LOWER audio to 160k CBR MP3 via ffmpeg..."
        MP3_FILE="${WORK_DIR}/${STEM}.mp3"
        ffmpeg -y -i "$RAW_FILE" -vn -acodec libmp3lame -b:a 160k "$MP3_FILE" </dev/null
        rm -f "$RAW_FILE"
        NEEDS_RELEASE_UPLOAD="true"
        if [[ -n "${GITHUB_TOKEN:-}" && -n "${GITHUB_REPOSITORY:-}" && -n "${RAW_ASSET_ID:-}" ]]; then
            curl -s -X DELETE \
              -H "Authorization: Bearer $GITHUB_TOKEN" \
              -H "Accept: application/vnd.github+json" \
              "https://api.github.com/repos/$GITHUB_REPOSITORY/releases/assets/$RAW_ASSET_ID" || true
        fi
    else
        MP3_FILE="$RAW_FILE"
    fi

    BASENAME=$(basename "$MP3_FILE" .mp3)

    # Check duration for YouTube length limit (12 hours max)
    if command -v ffprobe >/dev/null 2>&1 && command -v ffmpeg >/dev/null 2>&1; then
        DURATION_SECS=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$MP3_FILE" 2>/dev/null | cut -d. -f1 || echo "0")
        if [[ -n "$DURATION_SECS" && "$DURATION_SECS" -gt 41400 ]]; then
            echo "::warning::Audio duration ($DURATION_SECS s) exceeds 11.5 hours. Splitting into YouTube-compliant multi-part episodes..."
            CHUNK_SECS=36000 # 10 hours per part
            PART=1
            START=0
            while [ "$START" -lt "$DURATION_SECS" ]; do
                PART_FILE="${WORK_DIR}/${BASENAME}_Part${PART}.mp3"
                ffmpeg -y -ss "$START" -i "$MP3_FILE" -t "$CHUNK_SECS" -c copy "$PART_FILE" </dev/null
                PART=$((PART + 1))
                START=$((START + CHUNK_SECS))
            done
            rm -f "$MP3_FILE"
            MP3_FILE="${WORK_DIR}/${BASENAME}_Part1.mp3"
            NEEDS_RELEASE_UPLOAD="true"
            if [[ "$EXT_LOWER" == "mp3" && -n "${GITHUB_TOKEN:-}" && -n "${GITHUB_REPOSITORY:-}" && -n "${RAW_ASSET_ID:-}" ]]; then
                curl -s -X DELETE \
                  -H "Authorization: Bearer $GITHUB_TOKEN" \
                  -H "Accept: application/vnd.github+json" \
                  "https://api.github.com/repos/$GITHUB_REPOSITORY/releases/assets/$RAW_ASSET_ID" || true
            fi
            echo "Successfully split into $((PART - 1)) parts for YouTube compliance."
        fi
    fi

    if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
        echo "mp3_path=$MP3_FILE" >> "$GITHUB_OUTPUT"
        echo "release_tag=$RELEASE_TAG" >> "$GITHUB_OUTPUT"
        echo "space_title=$SPACE_TITLE" >> "$GITHUB_OUTPUT"
        echo "space_id=$SPACE_ID" >> "$GITHUB_OUTPUT"
        echo "episode_date=$EPISODE_DATE" >> "$GITHUB_OUTPUT"
        echo "already_exists=false" >> "$GITHUB_OUTPUT"
        echo "needs_release_upload=$NEEDS_RELEASE_UPLOAD" >> "$GITHUB_OUTPUT"
    fi
    echo "Done processing staged local upload."
    exit 0
fi

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
# We look for git tags or METADATA::SOURCE_ID::<id> in existing releases.
echo "--- Duplicate check ---"
SPACE_ID=$(yt-dlp --get-id "$TARGET_URL" 2>/dev/null | head -n 1 | tr -d '[:space:]' || echo "")

if [[ -n "$SPACE_ID" ]]; then
    echo "Source ID: $SPACE_ID"
    # Fast-check 1: Check local or fetched git tags (instant O(1), zero API requests)
    if git tag -l "*_${SPACE_ID}" | grep -q "${SPACE_ID}"; then
        echo "::warning::Source $SPACE_ID is already tagged in git — skipping to avoid duplicate."
        if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
            echo "already_exists=true" >> "$GITHUB_OUTPUT"
            echo "space_id=$SPACE_ID" >> "$GITHUB_OUTPUT"
        fi
        exit 0
    fi

    if [[ -n "${GITHUB_TOKEN:-}" && -n "${GITHUB_REPOSITORY:-}" ]]; then
        ALREADY_EXISTS=$(SPACE_ID="$SPACE_ID" GH_TOKEN="$GITHUB_TOKEN" REPO="$GITHUB_REPOSITORY" \
            python3 - <<'PYEOF'
import os, urllib.request, json
token = os.environ.get("GH_TOKEN", "")
repo  = os.environ.get("REPO", "")
sid   = os.environ.get("SPACE_ID", "")
if not (token and repo and sid):
    print("no"); exit()
found = False
page = 1
while page <= 5:  # Check recent 500 releases with strict timeout
    req = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/releases?per_page=100&page={page}"
    )
    req.add_header("Authorization", f"token {token}")
    req.add_header("Accept", "application/vnd.github.v3+json")
    try:
        with urllib.request.urlopen(req, timeout=15.0) as r:
            releases = json.loads(r.read())
    except Exception:
        break
    if not releases:
        break
    if any(f"SOURCE_ID::{sid}" in (rel.get("body") or "") or sid in (rel.get("tag_name") or "") for rel in releases):
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

# 5. Live Broadcast Check
# Automated ingest must only process concluded broadcasts/replays.
# Live stream capture will only proceed if RECORD_LIVE is explicitly set to true.
RECORD_LIVE="${RECORD_LIVE:-false}"
echo "Checking live stream status..."
LIVE_STATUS=$(yt-dlp --print live_status --no-warnings "$TARGET_URL" 2>/dev/null | tail -n 1 | tr -d '[:space:]' || echo "unknown")
echo "Live status: $LIVE_STATUS (RECORD_LIVE=$RECORD_LIVE)"

if [[ "$LIVE_STATUS" == "is_live" && "$RECORD_LIVE" != "true" ]]; then
    echo "::warning::Space is currently broadcasting live. Automated live ingestion is disabled."
    echo "::notice::To record an in-progress Space, trigger this workflow manually from GitHub Actions or the web app with 'Record Live Stream' enabled."
    if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
        echo "already_exists=true" >> "$GITHUB_OUTPUT"
        echo "space_id=${SPACE_ID:-}" >> "$GITHUB_OUTPUT"
    fi
    exit 0
fi

if [[ "$LIVE_STATUS" == "is_upcoming" && "$RECORD_LIVE" != "true" ]]; then
    echo "::warning::Space is scheduled/upcoming. Ingestion deferred until broadcast completes."
    if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
        echo "already_exists=true" >> "$GITHUB_OUTPUT"
        echo "space_id=${SPACE_ID:-}" >> "$GITHUB_OUTPUT"
    fi
    exit 0
fi

if [[ "$LIVE_STATUS" == "is_live" && "$RECORD_LIVE" == "true" ]]; then
    echo "🔴 Manual live capture requested: proceeding to record live broadcast."
fi

# 6. Prepare Work Directory
mkdir -p "$WORK_DIR"

# 6. Download and Convert
echo "Starting download..."
yt-dlp \
    --retries 5 \
    --fragment-retries 5 \
    --socket-timeout 30 \
    --no-playlist \
    --restrict-filenames \
    --extract-audio \
    --audio-format mp3 \
    --audio-quality 160k \
    --postprocessor-args "ExtractAudio:-b:a 160k" \
    --embed-metadata \
    --embed-thumbnail \
    --output "$WORK_DIR/%(release_date,upload_date)s_%(id)s_%(title)s.%(ext)s" \
    "$TARGET_URL"

# 7. Verify Output
MP3_FILE=$(find "$WORK_DIR" -name "*.mp3" | head -n 1)
if [[ -z "$MP3_FILE" ]]; then
    echo "::error::No MP3 file was generated."
    exit 1
fi
echo "Successfully created: $MP3_FILE"

# 8. Extract Metadata Base
BASENAME=$(basename "$MP3_FILE" .mp3)

# Check duration for YouTube length limit (12 hours max)
# If duration exceeds 11.5 hours (41400s), auto-split into YouTube-compliant parts (<= 10h each)
if command -v ffprobe >/dev/null 2>&1 && command -v ffmpeg >/dev/null 2>&1; then
    DURATION_SECS=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$MP3_FILE" 2>/dev/null | cut -d. -f1 || echo "0")
    if [[ -n "$DURATION_SECS" && "$DURATION_SECS" -gt 41400 ]]; then
        echo "::warning::Audio duration ($DURATION_SECS s) exceeds 11.5 hours. Splitting into YouTube-compliant multi-part episodes..."
        CHUNK_SECS=36000 # 10 hours per part
        PART=1
        START=0
        while [ "$START" -lt "$DURATION_SECS" ]; do
            PART_FILE="${WORK_DIR}/${BASENAME}_Part${PART}.mp3"
            ffmpeg -y -ss "$START" -i "$MP3_FILE" -t "$CHUNK_SECS" -c copy "$PART_FILE" </dev/null
            PART=$((PART + 1))
            START=$((START + CHUNK_SECS))
        done
        rm -f "$MP3_FILE"
        MP3_FILE="${WORK_DIR}/${BASENAME}_Part1.mp3"
        echo "Successfully split into $((PART - 1)) parts for YouTube compliance."
    fi
fi

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
