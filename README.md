# Logan Black X Spaces — SpacePipe

Automated audio ingestion pipeline powered by GitHub Actions. Supports Twitter/X Spaces, YouTube, Clubhouse, LinkedIn Audio, and any platform supported by yt-dlp.

## Stabilization status

This branch hardens the pipeline without changing the core mission.

## Quick Start

### Option A: Single URL (Recommended)
1. Go to the **Actions** tab → **Ingest Space** → **Run workflow**
2. Paste the audio URL
3. The episode publishes automatically

### Option B: Batch Queue
1. Add URLs to `batch_queue.txt` (one per line)
2. Commit and push
3. The monitor workflow promotes and processes them in order

### Option C: Queue File Trigger
1. Paste a URL into `space_queue.txt`
2. Commit and push — the ingest pipeline starts automatically

## RSS Feed

Your podcast feed:
```
https://aiandbotsgalore.github.io/copy-spaces-to-youtube-pipeline/podcast.xml
```

Submit this URL to Apple Podcasts, YouTube Podcasts, Spotify, etc.

## Supported Platforms

| Platform | Status |
|----------|--------|
| Twitter/X Spaces | ✅ Full support |
| YouTube | ✅ Full support |
| Clubhouse | ✅ Full support |
| LinkedIn Audio | ✅ Full support |
| SoundCloud | ✅ Supported |
| Any yt-dlp source | ✅ Supported |

## Directory Structure

```
/
├─ .github/workflows/
│  ├─ ingest.yml          # Main ingest pipeline
│  ├─ monitor.yml         # Batch queue monitor
│  └─ test_audio.yml      # Environment verification
├─ scripts/
│  └─ ingest.sh           # Download and process script
├─ space_queue.txt        # Single URL trigger
├─ batch_queue.txt        # Multi-URL queue
└─ artwork.jpg            # Podcast cover art
```

## Configuration

### Required Secrets
- Built-in GitHub Actions repository token; no manual setup needed.

### Optional Secrets
| Secret | Purpose |
|--------|---------|
| `ASSEMBLYAI_API_KEY` | Diarized transcription with speaker labels |
| `SLACK_WEBHOOK_URL` | Slack notifications on publish |
| `DISCORD_WEBHOOK_URL` | Discord notifications on publish |
