# SpacePipe Gen — Audio Pipeline Generator

## Overview
A React + Vite frontend app that generates and deploys fully automated audio ingestion pipelines (Twitter/X Spaces, YouTube, Clubhouse, LinkedIn Audio, etc.) to GitHub Actions, with RSS feed publishing to GitHub Pages for podcast distribution.

## Architecture
- **Frontend**: React 19 + TypeScript + Vite, served on port 5000
- **Styling**: Tailwind CSS (via CDN), dark slate theme
- **No backend**: Pure frontend SPA — all GitHub interactions use the GitHub REST API directly from the browser via a Personal Access Token

## Key Files

### Core
- `App.tsx` — Main application shell with sidebar navigation and panel routing
- `index.tsx` — React entry point
- `index.html` — HTML shell with Tailwind CDN and ES module import maps
- `index.css` — Empty CSS file (referenced by index.html)
- `types.ts` — TypeScript types: `EnhancedConfig`, `PipelineFile`, `GitHubUser`, `WorkflowRun`, `DeployStep`
- `vite.config.ts` — Vite config: port 5000, host 0.0.0.0, allowedHosts: true

### Utils
- `utils/templates.ts` — Template generators for all pipeline files (YAML workflows, shell scripts, README, queue files). NOTE: `${{ }}` GitHub Actions syntax must be escaped as `\${{ }}` inside JS template literals to avoid esbuild parse errors.
- `utils/github.ts` — GitHub REST API utilities (validate token, create repo, push files, enable Pages, fetch run history)

### Components
- `components/FileViewer.tsx` — Syntax-highlighted file viewer with copy + download buttons
- `components/GitHubConnect.tsx` — GitHub PAT connection UI with validation
- `components/FeaturePanel.tsx` — Feature toggles: Whisper AI transcription, Slack/Discord webhooks, scheduled batch monitoring
- `components/BatchUrlEditor.tsx` — Multi-URL batch queue editor with platform auto-detection
- `components/ArtworkUpload.tsx` — Drag-and-drop artwork upload with file-to-dataURL conversion
- `components/RSSPreview.tsx` — Live podcast feed preview with mock episodes and platform submission links
- `components/RunHistory.tsx` — GitHub Actions workflow run history dashboard (fetches live from GitHub API)
- `components/DeployWizard.tsx` — One-click multi-step deploy wizard that pushes all files to GitHub

## Navigation Structure
```
ACCOUNT
  └─ GitHub (connect with PAT)
SETUP
  ├─ Configuration (repo, podcast metadata, artwork, platforms)
  ├─ Features (transcription, webhooks, scheduling)
  └─ Batch Queue (multi-URL management)
PIPELINE FILES
  ├─ Workflow (.github/workflows/ingest.yml)
  ├─ Ingest Script (scripts/ingest.sh)
  ├─ Batch Queue (batch_queue.txt)
  ├─ Documentation (README.md)
  ├─ Test Workflow (.github/workflows/test_audio.yml)
  └─ Monitor Workflow (optional, .github/workflows/monitor.yml)
ACTIONS
  ├─ RSS Preview (podcast feed preview UI)
  ├─ Run History (GitHub Actions API)
  └─ Deploy to GitHub (one-click wizard)
```

## Generated Pipeline Features
- **Multi-platform**: yt-dlp supports Twitter/X, YouTube, Clubhouse, LinkedIn, SoundCloud, 1000+ more
- **Whisper AI transcription**: Optional step using openai-whisper (runs on GitHub Actions runner)
- **Slack/Discord notifications**: Webhook alerts on publish or failure
- **Scheduled batch processing**: Cron-driven monitor workflow that promotes URLs from batch queue
- **One-click GitHub deploy**: Pushes all files, creates repo, enables Pages via API

## Development
```
npm install
npm run dev
```
App runs at http://localhost:5000

## Deployment
Configured as a static site:
- Build: `npm run build`
- Public dir: `dist`
