# SpacePipe Gen — Critical Domain Invariants & Development Rules

These rules are strictly enforced across this workspace. Every code modification, generation step, and review must adhere to these invariants without exception.

---

## 1. YouTube 12-Hour Ceiling & 10-Hour Chunking

- **Hard Limit:** YouTube strictly rejects uploads exceeding 12 hours (43,200 seconds).
- **Chunking Threshold:** Any single episode exceeding 10 hours (36,000 seconds) must be sliced into sequential parts labeled `(Part 1)`, `(Part 2)`, `(Part 3)`, etc., using `scripts/split_marathon_releases.py`.
- **Feed Exclusion:** In `scripts/generate_rss.py` and `utils/templates/pythonRss.ts`, `MAX_YOUTUBE_DURATION_SECONDS = 11 * 3600 + 58 * 60` (11h 58m buffer). Any single audio file exceeding this limit is **strictly excluded** from `podcast.xml`.

---

## 2. Multi-Feed RSS Isolation

The platform serves three distinct feeds from GitHub Pages:
1. **`podcast.xml` (YouTube Podcasts Compliant):**
   - Contains only approved episodes $\le$ 11h 58m.
   - Multi-part chunks are included.
   - Raw marathon files and highlight clips are strictly excluded.
2. **`podcast_archive.xml` (Complete Unconstrained Archive):**
   - Contains all recorded spaces, including full marathon runs and uncut audio.
3. **`clips.xml` (Highlights & Social Clips):**
   - Sourced exclusively from `public/clips/clips_catalog.json`.
   - Highlights and clips must never contaminate `podcast.xml`.

---

## 3. Non-Destructive Catalog Merging

- Clip extraction and synchronization scripts (`find_and_cut_best_clips.py`, `cut_special_clips.py`, `sync_clips_catalog.py`) must **never overwrite** `public/clips/clips_catalog.json` with only the newly cut clips.
- Existing clips must always be read and merged non-destructively using a deterministic clip key: `file_path.name.lower()` or `f"{episode}_{round(start_seconds)}"`.

---

## 4. No Dual-Source Template Drift

- GitHub Actions workflow templates (`utils/templates.ts` and `utils/templates/*.ts`) must never duplicate shell or Python scripts as out-of-sync inline heredocs.
- Generated workflows must execute repository scripts (`scripts/generate_rss.py --all`, `scripts/ingest.sh`) when present, falling back to versioned templates only in bare repositories.

---

## 5. UI Architecture & Data Contracts

- **Zod Validation:** All data entering the TypeScript frontend from disk, network, or GitHub Releases must pass through validated Zod contracts in `utils/contracts/` (e.g., `ClipItemSchema`, `TranscriptSegmentSchema`).
- **Studio Decomposition:** Studio components must follow single-responsibility decomposition:
  - Filter & search controls: `components/{studio}/{Studio}FilterBar.tsx`
  - Item cards: `components/{studio}/{Studio}Card.tsx`
  - Modals & wizards: `components/{studio}/{Studio}Modal.tsx`
- **DOM Memory Safeguards:** Never render hundreds of rich interactive cards simultaneously without pagination or chunking. In grouped accordion mode, render the first 16 clips per episode with an explicit expansion trigger.
