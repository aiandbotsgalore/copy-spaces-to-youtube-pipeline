# Twitter Space Ingest Pipeline Generator

## Overview
A React + Vite frontend app that generates GitHub Actions pipeline configuration files for automating the ingestion of Twitter Spaces into a YouTube Podcast feed via GitHub Pages.

## Architecture
- **Frontend**: React 19 + TypeScript + Vite, served on port 5000
- **Styling**: Tailwind CSS (via CDN in development)
- **No backend**: Pure frontend SPA

## Key Files
- `App.tsx` — Main application component with pipeline configuration UI
- `index.tsx` — React entry point
- `index.html` — HTML shell with Tailwind CDN and import maps
- `utils/templates.ts` — Template generators for GitHub Actions YAML, shell scripts, README, etc.
- `components/FileViewer.tsx` — Component for displaying generated file contents
- `types.ts` — TypeScript types (PipelineConfig, etc.)
- `vite.config.ts` — Vite config: port 5000, host 0.0.0.0, allowedHosts: true

## Python Scripts (not used by frontend)
Located in `scripts/` — these are the actual pipeline scripts that get embedded as generated content:
- `ingest.sh` — Main download script using yt-dlp
- `transcribe_doty_spaces.py`, `validate_spaces.py`, etc.
- `requirements.txt` — Python dep: yt-dlp

## Development
```
npm install
npm run dev
```
App runs at http://localhost:5000

## Deployment
Configured as a static site deployment:
- Build: `npm run build`
- Public dir: `dist`

## Notes
- `utils/templates.ts` contains GitHub Actions YAML and Python code embedded in JS template literals. The `${{ }}` GitHub Actions syntax must be escaped as `\${{ }}` to avoid esbuild parse errors.
- Python f-string expressions `{var}` inside template literals also need special handling to avoid JS template expression conflicts.
