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
3. The ingest workflow processes them in order

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

## How it works

Everything runs as GitHub Actions on `master`. In short: Spaces are found, downloaded, published as GitHub releases, transcribed, cut into clips, and listed in RSS feeds that YouTube Podcasts and other apps read. Nothing uploads videos to YouTube directly; YouTube picks episodes up from `podcast.xml`.

| Workflow | When it runs | What it does |
|----------|--------------|--------------|
| `auto_detect_spaces.yml` | Every 2 hours, or by hand | Scans a list of X accounts for new recorded Spaces and starts an ingest for each one |
| `ingest.yml` | Push to `space_queue.txt` / `batch_queue.txt`, by hand, or webhook | Downloads the audio with yt-dlp and publishes it as a GitHub release |
| `batch_transcribe.yml` | Every 3 hours | Transcribes episodes that have no transcript yet, newest first |
| `transcribe_episode.yml` | By hand | Transcribes one release |
| `update_rss.yml` | Every push to `master` | Rebuilds the RSS feeds and deploys the web app to GitHub Pages |
| `manage_youtube_approval.yml` | By hand | Marks an episode APPROVED (goes into the YouTube feed) or UNLISTED |
| `dlq_retry.yml` | After failures, or a `/retry` comment | Opens a `[DLQ]` issue for a failed ingest and re-runs it on `/retry` |
| `health_sentinel.yml` | Every 6 hours | Records pipeline health |
| `spacesdashboard_sync.yml` | Every 6 hours | Syncs the speaker queue |
| `batch_rediarize.yml`, `rescan_archive.yml`, `enroll_voice.yml` | By hand | Speaker identification and voice profile tools |
| `generate_narration.yml`, `sync_knowledge_base.yml` | By hand | Documentary narration and knowledge base sync |
| `transcript-ui-check.yml`, `transcript-workbench.yml` | Push to `master` | Tests for the transcript screens |
| `build_runner_image.yml`, `keep_alive.yml` | Push / monthly | Build the runner image and keep scheduled workflows enabled |

Episodes longer than 10 hours are split into parts, because YouTube rejects uploads over 12 hours. See `ARCHITECTURE.md` for the rules every change must keep.

### Feeds

- `podcast.xml`: approved episodes, under 11h 58m each, for YouTube Podcasts
- `podcast_archive.xml`: every recorded Space, including marathon runs
- `clips.xml`: short highlight clips

### The studio app

The repository also contains SpacePipe Studio, a React app (`App.tsx`, `components/`, `server/`) for browsing transcripts and clips and for producing documentaries with Script Studio, Vox Studio and Avatar Studio. Run it locally with `npm install` and `npm run dev`, or on Windows with `launch-app.ps1`. Tests: `npm test`.

## Directory Structure

```
/
├─ .github/workflows/   # The pipeline (see table above)
├─ scripts/             # Download, transcription, RSS and clip scripts (shell + Python)
├─ components/, server/ # SpacePipe Studio app (React front end, Vite middleware)
├─ public/clips/        # Highlight clips catalog
├─ transcripts/         # Transcript index and status
├─ space_queue.txt      # Paste one URL here and push to ingest it
├─ batch_queue.txt      # One URL per line for several at once
└─ artwork.jpg          # Podcast cover art
```

## Configuration

`GITHUB_TOKEN` is built in. Other workflows use repository secrets, depending on which features you use:

| Secret | Used for |
|--------|----------|
| `X_AUTH_TOKEN`, `X_CT0`, `TWITTER_COOKIES` | Reading X to find and download Spaces |
| `HF_TOKEN`, `HF_TRANSCRIBE_ENDPOINT` | Transcription on Hugging Face ZeroGPU |
| `KAGGLE_API_TOKEN` | Transcription on Kaggle GPUs |
| `GEMINI_API_KEY`, `OPENROUTER_API_KEY` | AI summaries and studio features |
| `QDRANT_URL`, `QDRANT_API_KEY` | Knowledge base search |
| `SPACE_API_KEY` | Speaker dashboard sync |
| `DISCORD_WEBHOOK_URL` | Health alerts |

## Author

Logan Black · loganblack0@gmail.com
