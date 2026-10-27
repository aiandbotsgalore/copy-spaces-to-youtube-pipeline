# SpacePipe Gen — Architecture & Agent Guidelines

## 1. System Overview

**SpacePipe Gen** is a full-stack media production and archiving suite that automates the downloading, transcription, clip extraction, and RSS syndication of Twitter Spaces and long-form audio.

The application operates across three integrated runtimes:
```
┌────────────────────────────────────────────────────────────────────────┐
│ 1. Frontend SPA (React 19, TypeScript, Tailwind CSS v4, Lucide)        │
│    • Studios: Command Center, Ingest, Library, Transcripts, Radar,    │
│      Best Clips, Montage Studio, Script Studio, Vox Studio, Avatar     │
│    • Routing: Hash-based URL routing synchronized with STUDIO_REGISTRY  │
│    • Contracts: Zod runtime validation at all ingestion boundaries     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ /api/* endpoints
┌───────────────────────────────────▼────────────────────────────────────┐
│ 2. Backend Middleware & Local Services (Vite Node.js Middlewares)       │
│    • server/scriptStudioMiddleware.ts & scriptEngine.ts (LLM pipeline)  │
│    • server/scriptProviders.ts (Open provider adapters & CLIs)         │
│    • server/transcriptSearchService.ts (Lexical & Vector search)       │
│    • server/audioProxy.ts & server/voxSynthesize.ts                    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ subprocess / GitHub Actions dispatch
┌───────────────────────────────────▼────────────────────────────────────┐
│ 3. Audio Processing & Asynchronous Pipeline (Python 3 & Shell)         │
│    • scripts/ingest.sh: Multi-platform yt-dlp downloader               │
│    • scripts/split_marathon_releases.py: 10h YouTube marathon chunker  │
│    • scripts/generate_rss.py: Tri-feed RSS 2.0 generator               │
│    • scripts/find_and_cut_best_clips.py: Viral clip extractor          │
│    • scripts/kaggle_worker/: Free cloud GPU Whisper transcription       │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Critical Domain Invariants (NEVER VIOLATE)

Any autonomous agent or human developer modifying this repository must uphold these four non-negotiable invariants:

### Invariant 1: YouTube 12-Hour Ceiling & 10-Hour Chunking
- **The Rule:** YouTube strictly rejects video uploads exceeding 12 hours (43,200 seconds).
- **Enforcement:**
  - Any single episode exceeding 10 hours (36,000 seconds) must be sliced into sequential parts labeled `(Part 1)`, `(Part 2)`, `(Part 3)` via `scripts/split_marathon_releases.py`.
  - In `scripts/generate_rss.py` and `utils/templates/pythonRss.ts`, `MAX_YOUTUBE_DURATION_SECONDS = 11 * 3600 + 58 * 60` (11h 58m buffer). Any single audio file exceeding this limit is **strictly excluded** from `podcast.xml`.

### Invariant 2: Multi-Feed RSS Isolation
The platform serves three distinct feeds from GitHub Pages:
1. `podcast.xml`: YouTube Podcasts compliant feed. Contains only approved episodes $\le$ 11h 58m. Multi-part chunks are included; raw marathon files and highlight clips are excluded.
2. `podcast_archive.xml`: Complete unconstrained archive. Contains all recorded spaces, including marathon runs.
3. `clips.xml`: Short highlight clips and editorial moments (from `public/clips/clips_catalog.json`). Highlights must never contaminate `podcast.xml`.

### Invariant 3: Non-Destructive Catalog Merging
- Clip extraction scripts (`find_and_cut_best_clips.py`, `cut_special_clips.py`, `sync_clips_catalog.py`) must **never overwrite** `public/clips/clips_catalog.json` with only the newly cut clips.
- Existing clips must be read and merged non-destructively using a deterministic clip key: `file_path.name.lower()` or `f"{episode}_{round(start_seconds)}"`.

### Invariant 4: No Dual-Source Template Drift
- GitHub Actions workflow templates (`utils/templates.ts`) must never duplicate shell or Python scripts as out-of-sync inline heredocs.
- Generated workflows must execute repository scripts (`scripts/generate_rss.py --all`, `scripts/ingest.sh`) when present, falling back to versioned templates only in bare repositories.

---

## 3. Data Contracts & Schema Validation

All data entering the TypeScript frontend from disk, network, or GitHub Releases must pass through validated Zod contracts in [`utils/contracts/`](file:///c:/Users/Logan/copy-spaces-to-youtube-pipeline/utils/contracts/):

### Universal Clip Schema (`utils/contracts/clipCatalog.ts`)
- **Schema:** `ClipItemSchema` & `ClipCatalogSchema`
- **Type:** `ClipItem`
- **Validation:** Coerces string durations to numbers, guarantees positive bounds, cleans whitespace, clamps viral scores (0–10), and validates that `end_seconds > start_seconds`.
- **Parsing Helper:** `parseClipCatalog(raw)` safely parses clip catalogs, skipping corrupt entries without breaking the UI.

### Transcript & Summary Schemas (`utils/contracts/transcript.ts`)
- **Schema:** `TranscriptSegmentSchema`, `EpisodeSummarySchema`
- **Timestamps:** Timestamps must be normalized to float seconds (`0.000`). If a legacy millisecond timestamp (> 86,400) is detected, `normalizeTimestampToSeconds` divides by 1000.

---

## 4. UI Architecture & Studio Decomposition

To prevent browser memory bloat and maintenance bottlenecks:

### Studio Plugin Registry (`components/registry/studios.tsx`)
- All primary studios are registered in `STUDIO_REGISTRY` with `id`, `label`, `tier` (`studio` | `pipeline`), and `icon`.
- **Navigation:** Synchronized with `window.location.hash` (`#clips`, `#transcripts`, `#montage`, etc.) via `getActivePanelFromHash()` and `syncHashWithPanel()`. This ensures browser reloads and back/forward navigation preserve active views.

### Studio Decomposition Standard
Monolithic Studio components must be broken into single-responsibility modules:
- Filter & search controls: `components/{studio}/{Studio}FilterBar.tsx`
- Item cards: `components/{studio}/{Studio}Card.tsx`
- Modals & wizards: `components/{studio}/{Studio}Modal.tsx`
- Utilities & formatters: `components/{studio}/{studio}Utils.ts`

### DOM Memory Safeguards
- In `ClipsPanel` and other high-volume studios, never render hundreds of rich interactive cards simultaneously without pagination or chunking.
- In `grouped` accordion mode, render the first 16 clips per episode with an explicit "Show all X clips" expansion trigger.

---

## 5. LLM Provider Registry (`server/scriptProviders.ts`)

Script Studio uses multi-agent debate and consensus across models.

### Open Provider Architecture
`ProviderId` and `Family` support:
- `claude_cli`: Official Claude Code CLI (`claude -p`).
- `codex_cli`: ChatGPT / Codex CLI (`codex exec`).
- `cheaperinference`: HTTP provider for cost-capped runs.
- `ollama`: Local open models (`ollama:llama3`, `ollama:mistral`, etc.).
- `groq`: Fast inference API (`groq:llama-3.3-70b`).
- `openai_compatible`: Generic OpenAI API endpoints.

### Cross-Family Review Rule
`verifyCrossFamily(roleMap)` guarantees the `judge` or `factcheck` role is never in the same model family as the `reviser`. When using open-source models, `familyOf()` assigns `'open_source'`, allowing open models to pair with proprietary models for unbiased consensus.

---

## 6. Testing & Quality Verification

Before submitting any code change:
1. **Typecheck:** Run `npm run typecheck` (`tsc --noEmit`). Must exit with 0 errors.
2. **Unit Tests:** Run `npm test` (`vitest run`). All unit tests must pass.
3. **Template Parity Test:** Run `npx vitest run utils/__tests__/templates.test.ts` to verify YAML escaping and multi-feed RSS generator priority.
4. **Contracts Test:** Run `npx vitest run utils/__tests__/contracts.test.ts` to verify Zod schema validation.
