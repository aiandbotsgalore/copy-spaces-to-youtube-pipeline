# Full-Archive Narrative Memory & Global Thematic Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a comprehensive, multi-tier narrative memory engine powered by Inception Labs' Mercury-3 model that digests all 784+ Twitter Space transcripts into per-episode ledgers and a master chronological story graph (`archive_story_ledger.json`), giving the Copilot and Script Studio instant, omniscient recall of 4-year character arcs, community debates, and investigative evidence for ~$3.50 total.

**Architecture:**
1. **Tier 1: Per-Episode Deep Narrative Distillation (`scripts/build_archive_narrative_ledger.py`):**
   - Ingests full episode transcripts (`public/transcripts/episodes/<tag>.json`).
   - Calls Mercury-3 using a strict JSON schema (`EPISODE_LEDGER_SCHEMA`) to extract 2-paragraph executive narrative summaries, character postures and dynamics, timestamped key turning points (`revelation`, `accusation`, `falling_out`, `threat`, `admission`, `fundraiser`), thematic tags, and unresolved setups.
   - Saves persistent sidecars to `public/transcripts/narrative_ledgers/<tag>_ledger.json` with checkpoint tracking in `public/transcripts/narrative_ledger_checkpoint.json`.
2. **Tier 2: Global Cross-Episode Story Synthesizer (Reducer Engine):**
   - Chronologically aggregates all individual episode ledgers into `public/transcripts/archive_story_ledger.json`.
   - Compiles master character dossiers (tracking evolving alliances, grievances, and stance shifts across 4 years), thematic story threads, date-ordered timeline milestones, and setup-to-payoff linkages.
3. **Tier 3: In-Memory Runtime Narrative Memory Service (`server/narrativeLedgerService.ts`):**
   - High-speed, in-memory query engine supporting lexical, chronological, and thematic indexing.
   - Exposes `queryNarrativeStory()`, `getCharacterArc()`, `getStoryThread()`, and `getTimelineAround()`.
4. **Tier 4: Copilot Director & Micro-Search Synergy (`server/directorMiddleware.ts` & `server/copilotPrompt.ts`):**
   - Connects Macro narrative recall with Micro verbatim audio playback.
   - When Copilot detects narrative, relationship, or timeline queries, it queries `narrativeLedgerService`, injects story context into `=== ARCHIVE NARRATIVE STORY MEMORY ===`, and triggers micro-searches for the cited episodes so users get instant answers with playable audio soundbites.

**Tech Stack:**
- Inception Labs Mercury-3 (`https://api.inceptionlabs.ai/v1`, 60k-token context, $0.10/1M in, $0.25/1M out)
- Python 3.10+ (Batch distillation CLI, rate pacing, atomic JSON serialization)
- TypeScript / Node.js (Vite server middleware, fast in-memory query engine)
- Pytest & Vitest (Comprehensive unit test coverage)

**Spec:**
- `server/scriptPrompts.ts` (`ANALYSIS_SCHEMA`, `REDUCE_SCHEMA`, `UNTRUSTED_OPEN`)
- `server/scriptProviders.ts` (`createInceptionAdapter`, `DEFAULT_DIRECTOR_MODEL = 'mercury-3'`)
- `server/directorMiddleware.ts` (`runCopilot`, `handleSearchTranscripts`, `detectSearchIntent`)
- `docs/superpowers/plans/2026-11-13-transcription-optimization-and-rediarization.md`

---

## Global Constraints

1. **Zero Text Mutation:** Original transcribed words, text segments, and word-level timestamps in `public/transcripts/episodes/*.json` must remain 100% immutable.
2. **Economic Efficiency:** All LLM operations must use Mercury-3 (`mercury-3`) via Inception Labs API ($0.10/1M tokens) with strict token budgets to keep total cost across 784+ episodes under $4.00.
3. **Strict Citation Fidelity:** Narrative moments and key quotes must cite exact utterance IDs or segment timestamps. The generator must verify that quoted text exists in the source transcript before saving.
4. **Editorial Neutrality & Factual Guardrails:** Maintain strict attribution accuracy: Logan and Shane organized the May eviction fundraiser (do not turn Angela's messages into claims of financial help). Unverified allegations must be explicitly classified as `unverified_allegation` or `disputed_claim`.
5. **Atomic Checkpointing & Quota Resilience:** The batch engine must write per-episode ledgers atomically and persist checkpoints after each episode. If the script is paused or encounters an HTTP 429/503, it resumes cleanly without re-processing completed episodes.

---

## Review Focus

The five input classes or failure modes most likely to impact system reliability:

1. **Mercury Reasoning Token & Output Truncation:** Mercury outputs `reasoning_details` before the final content. If `max_tokens` is configured too low (<2048), the JSON string is abruptly truncated, causing JSON parse failure. *Covered in Task 1 test: verify `max_tokens` is set to 4096 and response handles trailing tokens.*
2. **Rate Limits & Upstream HTTP 429/503:** Batching hundreds of transcripts could trigger rate limit bursts. *Covered in Task 1 test: verify exponential backoff, jitter, and automatic retry in the HTTP client.*
3. **Empty or Truncated Source Transcripts:** Episodes with 0–2 segments or corrupt files must not crash the batch runner. *Covered in Task 1 test: verify graceful handling of degenerate/empty transcripts producing minimal valid empty ledgers.*
4. **Speaker Inversion & Attribution Confusions:** Unassigned clusters (`Speaker 1`, `SPEAKER_00`) or reversed message labels could contaminate the global character ledger. *Covered in Task 2 test: verify unassigned speakers are categorized under unresolved clusters and not conflated with verified profiles.*
5. **Node.js Memory Bloat & Stale Cache:** In-memory caching of `archive_story_ledger.json` in Node dev server must not leak memory or serve stale data when the ledger is recompiled. *Covered in Task 3 test: verify atomic cache reload with file mtime checking.*

---

### Task 1: Episode Narrative Ledger Distillation Engine

**Files:**
- Create: `scripts/build_archive_narrative_ledger.py`
- Create: `tests/test_narrative_ledger.py`
- Reference: `server/scriptPrompts.ts`, `scripts/poc_mercury_eval.ts`

**Interfaces:**
- Consumes: `public/transcripts/episodes/<tag>.json`
- Produces: `public/transcripts/narrative_ledgers/<tag>_ledger.json` conforming to `EPISODE_LEDGER_SCHEMA`
- Produces: `public/transcripts/narrative_ledger_checkpoint.json`

- [ ] **Step 1: Write failing unit tests for episode distillation and schema validation**

Create `tests/test_narrative_ledger.py`:
- Test schema adherence for `EPISODE_LEDGER_SCHEMA`.
- Test transcript prompt builder formats segments with speaker names, timestamps, and untrusted data delimiters.
- Test client retries on HTTP 429 with exponential backoff.
- Test handling of degenerate/empty transcript files.
- Test checkpoint state save and resume.

```python
# tests/test_narrative_ledger.py
import pytest
from unittest.mock import MagicMock, patch
from scripts.build_archive_narrative_ledger import (
    format_transcript_for_prompt,
    validate_episode_ledger,
    distill_episode,
    CheckpointManager,
    EPISODE_LEDGER_SCHEMA,
)

def test_format_transcript_for_prompt():
    transcript = {
        "release_tag": "test_tag",
        "title": "Test Episode",
        "segments": [
            {"start": 10.0, "end": 15.0, "speaker": "Logan", "text": "Hello world."},
            {"start": 15.5, "end": 20.0, "speaker": "Angela", "text": "Testing 123."}
        ]
    }
    formatted = format_transcript_for_prompt(transcript)
    assert "<<<TRANSCRIPT_DATA" in formatted
    assert "[10.0s - 15.0s] Logan: Hello world." in formatted
    assert "[15.5s - 20.0s] Angela: Testing 123." in formatted

def test_validate_episode_ledger_valid():
    sample = {
        "release_tag": "test_tag",
        "title": "Test Title",
        "summary": "This is a detailed summary.",
        "themes": [{"id": "t1", "label": "Topic 1", "summary": "Theme summary"}],
        "dynamics": [{"speaker": "Logan", "role": "Host", "stance": "Inquiring"}],
        "moments": [{
            "id": "m1", "kind": "revelation", "why": "Important point",
            "start_sec": 10.0, "end_sec": 15.0, "speakers": ["Logan"],
            "quote": "Hello world."
        }],
        "setups_and_open_questions": ["What happens next?"]
    }
    assert validate_episode_ledger(sample) is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_narrative_ledger.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.build_archive_narrative_ledger'`

- [ ] **Step 3: Implement `scripts/build_archive_narrative_ledger.py`**

Implement:
1. `EPISODE_LEDGER_SCHEMA` defining strict JSON schema for Mercury-3.
2. `format_transcript_for_prompt(transcript_dict: dict, max_tokens: int = 45000) -> str`.
3. `call_mercury_with_retry(api_key: str, system_prompt: str, user_prompt: str, schema: dict, max_retries: int = 5) -> dict`.
4. `distill_episode(transcript_path: Path, output_dir: Path, api_key: str) -> dict`.
5. `CheckpointManager` class handling thread-safe JSON checkpointing in `public/transcripts/narrative_ledger_checkpoint.json`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_narrative_ledger.py -v`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/build_archive_narrative_ledger.py tests/test_narrative_ledger.py
git commit -m "feat(ledger): implement episode narrative ledger distillation engine"
```

---

### Task 2: Global Cross-Episode Story Synthesizer (Reducer Engine)

**Files:**
- Modify: `scripts/build_archive_narrative_ledger.py`
- Modify: `tests/test_narrative_ledger.py`

**Interfaces:**
- Consumes: All `public/transcripts/narrative_ledgers/*_ledger.json` files
- Produces: `public/transcripts/archive_story_ledger.json` conforming to `GLOBAL_STORY_LEDGER_SCHEMA`

- [ ] **Step 1: Write failing unit test for global story reduction**

In `tests/test_narrative_ledger.py`:
- Test chronological aggregation of multiple episode ledgers.
- Test character dossier compilation (aggregating speaker appearances, relationship stances across time).
- Test thematic thread clustering (grouping episodes under shared themes like `eviction_fundraiser`, `angela_allegations`).
- Test chronological timeline sorting and milestone deduplication.
- Test atomic write to `public/transcripts/archive_story_ledger.json`.

```python
def test_compile_global_story_ledger():
    episodes = [
        {
            "release_tag": "ep1",
            "title": "Episode 1",
            "date": "2025-07-01T12:00:00Z",
            "summary": "Summary 1",
            "themes": [{"id": "t1", "label": "Fundraiser", "summary": "May fundraiser discussion"}],
            "dynamics": [{"speaker": "Logan", "role": "Organizer", "stance": "Neutral"}],
            "moments": [{
                "id": "m1", "kind": "fundraiser", "why": "Announced fundraiser",
                "start_sec": 100.0, "end_sec": 120.0, "speakers": ["Logan"],
                "quote": "Shane and I started this fundraiser."
            }],
            "setups_and_open_questions": ["Will Angela comment?"]
        },
        {
            "release_tag": "ep2",
            "title": "Episode 2",
            "date": "2025-07-15T12:00:00Z",
            "summary": "Summary 2",
            "themes": [{"id": "t1", "label": "Fundraiser", "summary": "Fundraiser aftermath"}],
            "dynamics": [{"speaker": "Logan", "role": "Host", "stance": "Frustrated"}],
            "moments": [{
                "id": "m2", "kind": "revelation", "why": "Clarification on funds",
                "start_sec": 50.0, "end_sec": 80.0, "speakers": ["Logan"],
                "quote": "Every dollar was accounted for."
            }],
            "setups_and_open_questions": []
        }
    ]
    global_ledger = compile_global_story_ledger(episodes)
    assert "Logan" in global_ledger["characters"]
    assert len(global_ledger["characters"]["Logan"]["episode_appearances"]) == 2
    assert len(global_ledger["timeline_milestones"]) == 2
    assert global_ledger["timeline_milestones"][0]["release_tag"] == "ep1"
    assert global_ledger["timeline_milestones"][1]["release_tag"] == "ep2"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_narrative_ledger.py::test_compile_global_story_ledger -v`
Expected: FAIL with `NameError: name 'compile_global_story_ledger' is not defined`

- [ ] **Step 3: Implement `compile_global_story_ledger` and reducer command in `scripts/build_archive_narrative_ledger.py`**

Implement:
1. `compile_global_story_ledger(episode_ledgers: list[dict]) -> dict`:
   - Builds `characters`: dossier per speaker with timeline of stances, key conflicts, and episode appearances.
   - Builds `story_threads`: inverted index of themes mapping to timeline occurrences.
   - Builds `timeline_milestones`: date-sorted key turning points with quotes and episode links.
   - Builds `setups_and_payoffs`: unresolved community claims and questions.
2. CLI flag `--rebuild-global` that reads all existing `public/transcripts/narrative_ledgers/*.json` and compiles `public/transcripts/archive_story_ledger.json` atomically via temporary file rename.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_narrative_ledger.py -v`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/build_archive_narrative_ledger.py tests/test_narrative_ledger.py
git commit -m "feat(ledger): implement global cross-episode story synthesizer"
```

---

### Task 3: Runtime Narrative Memory Service (`server/narrativeLedgerService.ts`)

**Files:**
- Create: `server/narrativeLedgerService.ts`
- Create: `tests/test_narrative_ledger_service.ts`

**Interfaces:**
- Consumes: `public/transcripts/archive_story_ledger.json`
- Produces: Exported query functions:
  - `queryNarrativeStory(options: NarrativeQueryOptions): NarrativeStoryResult`
  - `getCharacterArc(characterName: string): CharacterArc | null`
  - `getStoryThread(threadKey: string): StoryThread | null`
  - `getTimelineAround(releaseTag: string, windowCount?: number): TimelineMilestone[]`

- [ ] **Step 1: Write failing unit test for narrative query service**

Create `tests/test_narrative_ledger_service.ts`:
- Test loading mock `archive_story_ledger.json`.
- Test `queryNarrativeStory` with keywords ("fundraiser", "Angela", "Wright-Patt").
- Test `getCharacterArc` for "Angela" returning chronological stances and key episodes.
- Test `getTimelineAround` returning preceding and succeeding episodes.
- Test graceful fallback when ledger file does not yet exist.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/test_narrative_ledger_service.ts`
Expected: FAIL with `Cannot find module '../server/narrativeLedgerService'`

- [ ] **Step 3: Implement `server/narrativeLedgerService.ts`**

Implement:
1. In-memory cache with file mtime detection to reload automatically if the ledger is recompiled.
2. `queryNarrativeStory({ query, characters, topic, startDate, endDate, limit = 5 })`:
   - Tokenizes query into keywords and checks matching character dossiers, story threads, and timeline milestones.
   - Computes weighted score based on keyword match in milestone summary, theme labels, and verbatim quotes.
   - Returns matched milestones, involved characters, and recommended episode tags for audio playback.
3. `getCharacterArc(name: string)`.
4. `getStoryThread(themeIdOrLabel: string)`.
5. `getTimelineAround(releaseTag: string, windowCount = 3)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/test_narrative_ledger_service.ts`
Expected: PASS with 0 errors.

- [ ] **Step 5: Commit**

```bash
git add server/narrativeLedgerService.ts tests/test_narrative_ledger_service.ts
git commit -m "feat(ledger): implement in-memory runtime narrative memory service"
```

---

### Task 4: Copilot Director & Micro-Search Synergy

**Files:**
- Modify: `server/copilotPrompt.ts`
- Modify: `server/directorMiddleware.ts`
- Modify: `utils/copilotTypes.ts`
- Test: `tests/test_copilot_narrative_memory.ts`

**Interfaces:**
- Consumes: `narrativeLedgerService.ts`
- Produces: Enhanced `CopilotContextPayload` with `narrativeStoryContext`, injected into `buildCopilotSystemPrompt` and linking to `handleSearchTranscripts`.

- [ ] **Step 1: Write failing test for Copilot narrative injection**

Create `tests/test_copilot_narrative_memory.ts`:
- Test that `detectSearchIntent` identifies narrative / timeline questions (e.g. "How did the relationship between Angela and Logan change?", "Who started the fundraiser?").
- Test that `runCopilot` enriches `context` with `narrativeStoryContext` when narrative intent is detected.
- Test that `buildCopilotSystemPrompt` renders `=== ARCHIVE NARRATIVE STORY MEMORY ===` with character dynamics and timeline milestones.
- Test that cited episodes from narrative milestones are automatically passed to micro-transcript search to pull exact audio player snippets.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/test_copilot_narrative_memory.ts`
Expected: FAIL

- [ ] **Step 3: Implement Copilot narrative integration**

1. In `utils/copilotTypes.ts`: Add `narrativeStoryContext?: NarrativeStoryResult` to `CopilotContextPayload`.
2. In `server/copilotPrompt.ts`: Add prompt section `=== ARCHIVE NARRATIVE STORY MEMORY ===` rendering character arcs, high-level timeline, and relevant story threads when present.
3. In `server/directorMiddleware.ts`:
   - In `runCopilot`: When `searchIntent.isSearchQuery` or `searchIntent.isEditorialQuery` is true, query `queryNarrativeStory(latestUserMsg)`.
   - If narrative milestones are found, append them to `enrichedContext.narrativeStoryContext`.
   - Add the milestone `release_tag`s to the candidate episodes for `handleSearchTranscripts` so the frontend Copilot receives both macro story synthesis AND playable audio clips in a single turn.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/test_copilot_narrative_memory.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add utils/copilotTypes.ts server/copilotPrompt.ts server/directorMiddleware.ts tests/test_copilot_narrative_memory.ts
git commit -m "feat(copilot): wire narrative memory ledger and multi-tier story recall into Copilot Director"
```

---

### Task 5: End-to-End Real Transcript Verification & Batch CLI Testing

**Files:**
- Modify: `scripts/build_archive_narrative_ledger.py`
- Test: Live CLI execution with `--tag` on historical transcripts:
  - `20250716_1mnGegRZvDnxX` ("Well Angela Maggard you are definitely a piece of work")
  - `20260826_1AxRnZYBVdrxl` ("Gothic Milkshake")

- [ ] **Step 1: Run dry-run and single-episode distillation on real transcripts**

Run:
```bash
python scripts/build_archive_narrative_ledger.py --tag 20250716_1mnGegRZvDnxX
python scripts/build_archive_narrative_ledger.py --tag 20260826_1AxRnZYBVdrxl
python scripts/build_archive_narrative_ledger.py --rebuild-global
```
Verify:
1. `public/transcripts/narrative_ledgers/20250716_1mnGegRZvDnxX_ledger.json` is generated.
2. `public/transcripts/narrative_ledgers/20260826_1AxRnZYBVdrxl_ledger.json` is generated.
3. `public/transcripts/archive_story_ledger.json` contains valid character dossiers, story threads, and timeline milestones.
4. Total cost logged is < $0.05 for both test episodes.

- [ ] **Step 2: Test live Copilot narrative response via HTTP endpoint**

Call `/api/director/copilot` with a narrative query:
"What was said in July 2025 regarding Angela Maggard and Wright-Patterson Air Force Base?"
Verify:
- Copilot returns detailed story context with character dynamics.
- Response includes exact audio timestamps and transcript matches for instant playback in the web player.

- [ ] **Step 3: Run full verification suite**

Run:
```bash
pytest tests/test_transcribe_core.py tests/test_zerogpu_app.py tests/test_narrative_ledger.py -v
npm run typecheck
```
Expected: All Python tests pass, TypeScript compiles with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/build_archive_narrative_ledger.py
git commit -m "feat(ledger): verify end-to-end narrative memory on real transcripts"
```
