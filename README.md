# Logan Black X Spaces — SpacePipe

Automated audio ingestion pipeline powered by GitHub Actions. Supports Twitter/X Spaces, YouTube, Clubhouse, LinkedIn Audio, and any platform supported by yt-dlp.

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
| SoundCloud | ✅ Full support |
| Any yt-dlp source | ✅ Supported |

## Directory Structure

```
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
```

## Configuration

### Required Secrets (auto-configured if using SpacePipe Gen deploy)
- `GITHUB_TOKEN` — Built-in, no setup needed

### Optional Secrets
| Secret | Purpose |
|--------|---------|
| `SLACK_WEBHOOK_URL` | Slack notifications on publish |
| `DISCORD_WEBHOOK_URL` | Discord notifications on publish |

## Author

Logan Black · loganblack0@gmail.com
