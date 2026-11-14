# Transcription Optimization, ZeroGPU Migration & Lightweight Re-Diarization Implementation Plan (Revised v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernize the SpacePipe audio pipeline by creating a unified core module, deploying a secure, quota-resilient Hugging Face ZeroGPU Space (`large-v3-turbo` + PyAnnote 3.1 + ECAPA-TDNN), eliminating speaker misattribution bugs, and providing a lightweight re-diarization engine that corrects speaker labels across all 811 historical transcripts with zero text/timestamp mutations.

**Architecture:** 
1. **Self-Contained Canonical Core (`spaces/zerogpu-transcriber/spacepipe_transcribe_core.py`):**
   - Single-speaker exclusive interval extraction (overlaps subtracted prior to biometric embedding).
   - Complete-linkage agglomerative clustering with 1-to-1 bipartite profile matching (prevents duplicate identity assignment and transitive collapse).
   - Strict elimination of talk-time host dominance fallback.
   - Minimum-RMS fallback for silence slicing ensuring chunks $\le$ 1200–1800s.
   - Word-level speaker re-projection with SHA-256 text/timestamp immutability verification.
2. **ZeroGPU Space Architecture (`spaces/zerogpu-transcriber/app.py`):**
   - **Undecorated CPU Orchestrators:** Top-level `/transcribe` and `/rediarize` endpoints run on CPU to handle audio streaming, FFmpeg conditioning, slicing, and global cross-chunk agglomeration without consuming GPU lease or quota.
   - **Per-Chunk GPU Workers:** Only inner chunk functions (`_transcribe_and_diarize_chunk` and `_diarize_chunk`) are decorated with `@spaces.GPU(duration=120)`.
   - **Lazy CTranslate2 Initialization:** Model weights pre-cached to disk on container boot via `snapshot_download`; CTranslate2/CUDA loaded inside the `@spaces.GPU` context to prevent ZeroGPU container boot crashes.
   - **Token Auth & Host Allowlist:** Prevents unauthorized SSRF or external quota drainage.
   - **Disk & Quota Hygiene:** Explicit duration budget and `tempfile.TemporaryDirectory()` cleanup preventing disk exhaustion.
3. **Quota-Aware Client & Batch Orchestration:**
   - Dual-engine fallback: Can execute against the ZeroGPU Space or fall back to local/runner CPU.
   - Checkpoint-and-resume loop with per-episode atomic commits.
   - Writes directly to `public/transcripts/transcripts_summary_index.json` conforming to `EpisodeSummary`.
   - Regenerates `.srt` and `.txt` on re-diarization and clobber-uploads verified assets to GitHub Releases.

**Tech Stack:** 
- Python 3.10/3.11/3.12
- Hugging Face Spaces (ZeroGPU / Gradio / `@spaces.GPU`)
- WhisperX (`>=3.8.5`) & `faster-whisper` (`>=1.2.0`, `large-v3-turbo`)
- PyAnnote Audio 3.1 (`pyannote/speaker-diarization-3.1`)
- SpeechBrain (`speechbrain/spkrec-ecapa-voxceleb` 192-dim)
- SciPy Complete-Linkage Agglomerative Clustering (`scipy.cluster.hierarchy`)
- FFmpeg 16kHz mono PCM conditioning

---

## Global Constraints & Review Hardening Notes

1. **Zero Text Drift:** Re-diarization must NEVER alter transcribed words, text, or word-level start/end timestamps. An automated SHA-256 hash check must verify 100% byte parity before saving. Safe `.get("start")` / `.get("end")` fallbacks prevent `KeyError` on unaligned symbol tokens.
2. **No Talk-Time Bias:** Speaker attribution must strictly depend on acoustic biometrics ($\ge 0.54$ similarity, $\ge 0.06$ margin) or explicit conversational hints. No talk-time duration heuristics.
3. **1-to-1 Bipartite Matching:** Enrolled profiles (Logan, Angela, etc.) can each be claimed by at most one cluster in an episode.
4. **ZeroGPU CPU/GPU Isolation:** Downloading audio and FFmpeg slicing must NEVER occur inside `@spaces.GPU`.
5. **ZeroGPU Dependency Safety:** Do NOT pin `torch`, `torchaudio`, `gradio`, or `spaces` in `requirements.txt`—let the ZeroGPU base image supply the patched CUDA runtime.
6. **Index Target Conformance:** Updates must sync directly to `public/transcripts/transcripts_summary_index.json`, verified against the React `EpisodeSummary` TypeScript interface.
7. **Quota Safety:** Client scripts must catch ZeroGPU 429/quota-exceeded responses gracefully, persist all completed work, and exit 0.
8. **Hyphenated Directory Path in the Re-Export Shim (Task 1):**
   - Because `spaces/zerogpu-transcriber` contains a hyphen (`-`), `scripts/spacepipe_transcribe_core.py` cannot use a dotted import.
   - Insert `str(Path(__file__).resolve().parents[1] / "spaces" / "zerogpu-transcriber")` into `sys.path` (or use `importlib.util.spec_from_file_location`) before `from spacepipe_transcribe_core import *`.
9. **Pass `SPACE_API_KEY` as a Gradio Argument, Not the Authorization Header (Task 2):**
   - On Hugging Face Spaces, the HTTP `Authorization: Bearer <token>` header is consumed by Hugging Face's reverse proxy to validate `HF_TOKEN` and assign ZeroGPU quota. Overwriting `Authorization` with `SPACE_API_KEY` will cause Hugging Face's proxy to reject the request with `401 Unauthorized`.
   - Pass `HF_TOKEN` via `gradio_client.Client(endpoint, hf_token=HF_TOKEN)` and pass `SPACE_API_KEY` as an explicit function parameter (`api_key: str`) to `/transcribe` and `/rediarize`.
   - Restrict `audio_url` with a strict host allowlist check (`github.com`, `objects.githubusercontent.com`, `huggingface.co`) inside `app.py` before downloading.
10. **Move Tensors to CPU/NumPy Before Returning from `@spaces.GPU` (Task 2):**
    - ZeroGPU runs `@spaces.GPU` functions in a forked worker process and pickles return values over IPC back to the CPU parent process. Ensure `_gpu_transcribe_chunk` and `_gpu_diarize_chunk` convert all 192-dim SpeechBrain embeddings to `.detach().cpu().numpy()` (or Python `list[float]`) before returning so no CUDA tensors cross the process boundary.
11. **Add `spaces/zerogpu-transcriber/packages.txt` with ffmpeg (Task 2):**
    - Include a one-line `spaces/zerogpu-transcriber/packages.txt` containing `ffmpeg` so the Debian container is guaranteed to have the system ffmpeg binary installed regardless of base image updates.
12. **Explicit `@spaces.GPU(duration=120)` Parameter (Task 2):**
    - By default, `@spaces.GPU` assigns a default timeout of ~60 seconds per invocation. If an audio slice takes longer during a busy cluster period, ZeroGPU kills the task. Explicitly specify the duration budget on chunk workers: `@spaces.GPU(duration=120)`.
13. **`/tmp` Audio Cleanup (Disk Leaks) (Task 2):**
    - Long transcription pipelines that slice 10-hour Spaces generate hundreds of MBs of intermediate `.wav` chunks. Wrap all audio downloading and slicing operations in `tempfile.TemporaryDirectory()` context managers so files are deleted immediately after processing.

---

### Task 0: ZeroGPU Performance Spike & Dependency Benchmark

**Files:**
- Create: `tests/benchmarks/benchmark_zerogpu_chunk.py`

**Purpose:**
Empirically measure VRAM and execution time for 5, 10, 20, and 30-minute audio slices through WhisperX `large-v3-turbo` + PyAnnote 3.1 on GPU to lock in the optimal chunk size and dynamic `@spaces.GPU` duration.

- [ ] **Step 1: Write benchmark script**
  - Synthesize/slice test audio of varying lengths (5m, 15m, 30m).
  - Measure pure inference time for:
    1. Whisper-large-v3-turbo transcription + phoneme alignment.
    2. PyAnnote 3.1 diarization.
    3. ECAPA-TDNN extraction.
- [ ] **Step 2: Run benchmark & record metrics**
  - Verify that 20–30 minute chunks execute in $< 45\text{s}$ of GPU time.
- [ ] **Step 3: Document confirmed limits in `spacepipe_transcribe_core.py`**

---

### Task 1: Canonical Core Module (`spaces/zerogpu-transcriber/spacepipe_transcribe_core.py`)

**Files:**
- Create: `spaces/zerogpu-transcriber/spacepipe_transcribe_core.py`
- Create: `scripts/spacepipe_transcribe_core.py` (re-export shim)
- Create: `tests/test_transcribe_core.py`

**Purpose:** 
Consolidate all audio conditioning, silence slicing, crosstalk-stripped embedding extraction, complete-linkage clustering, 1-to-1 biometric matching, and text-immutable segment re-labeling in a self-contained module located inside the Space directory.

- [x] **Step 1: Write comprehensive unit tests in `tests/test_transcribe_core.py`**
  - Test 1: Silence slicing with minimum-RMS fallback when no silence exists.
  - Test 2: Sample-accurate global offset accumulation (`sample_idx / 16000.0`).
  - Test 3: Crosstalk subtraction (verify overlapping turns are stripped before ECAPA embedding).
  - Test 4: Complete-linkage clustering preventing transitive pairwise merge drift.
  - Test 5: 1-to-1 bipartite profile matching (two clusters cannot both claim "Logan").
  - Test 6: Elimination of talk-time host dominance fallback.
  - Test 7: `project_diarization_onto_segments` updates `segment["speaker"]` and `word["speaker"]` while asserting SHA-256 text parity with safe word `.get("start")`/`.get("end")`.
- [x] **Step 2: Run test to confirm failure**
  - Command: `python -m unittest tests/test_transcribe_core.py`
- [x] **Step 3: Implement `spaces/zerogpu-transcriber/spacepipe_transcribe_core.py`**
  - Audio conditioning via FFmpeg (16kHz mono PCM).
  - `detect_silence_cut_points(wav_path, max_chunk_sec=1800.0, lookback_sec=300.0)`.
  - `extract_speaker_embedding` with overlap subtraction and minimum 1.5s single-speaker clean window.
  - `cluster_speaker_embeddings` via `scipy.cluster.hierarchy.complete`.
  - `match_biometrics` via greedy 1-to-1 bipartite assignment with margin threshold $\ge 0.06$.
  - `project_diarization_onto_segments(segments, turns)` updating words and segments with text-hash verification.
- [x] **Step 4: Implement re-export in `scripts/spacepipe_transcribe_core.py` with `sys.path` injection**
- [x] **Step 5: Run tests to verify pass**
  - Command: `python -m unittest tests/test_transcribe_core.py`
- [x] **Step 6: Commit**
  - Message: `feat(core): implement canonical spacepipe_transcribe_core with crosstalk subtraction and 1-to-1 matching`

---

### Task 2: Production Hugging Face ZeroGPU Space (`spaces/zerogpu-transcriber/`)

**Files:**
- Create: `spaces/zerogpu-transcriber/README.md`
- Create: `spaces/zerogpu-transcriber/packages.txt`
- Create: `spaces/zerogpu-transcriber/requirements.txt`
- Create: `spaces/zerogpu-transcriber/app.py`
- Test: `tests/test_zerogpu_app.py`

**Purpose:**
Build the ZeroGPU application for `loganblack0/spacepipe-transcriber`. Uses undecorated CPU orchestrators, per-chunk `@spaces.GPU(duration=120)` workers, lazy CTranslate2 loading, `SPACE_API_KEY` argument validation, and temporary directory cleanup.

- [x] **Step 1: Write Space metadata and dependencies**
  - In `spaces/zerogpu-transcriber/README.md`, specify frontmatter (`sdk: gradio`, `app_file: app.py`).
  - In `spaces/zerogpu-transcriber/packages.txt`: `ffmpeg`.
  - In `spaces/zerogpu-transcriber/requirements.txt`:
    ```text
    whisperx>=3.8.5
    faster-whisper>=1.2.0
    pyannote.audio>=3.1.1
    speechbrain>=1.0.0
    soundfile>=0.12.1
    scipy>=1.11.0
    librosa>=0.10.1
    requests>=2.31.0
    huggingface_hub>=0.23.0
    ```
- [x] **Step 2: Implement `spaces/zerogpu-transcriber/app.py`**
  - Global scope: Pre-download model weights to local cache via `snapshot_download`.
  - Security check: Validate `api_key` argument against `SPACE_API_KEY` secret.
  - Host allowlist check: Restrict audio downloads to `github.com`, `objects.githubusercontent.com`, `huggingface.co`.
  - Audio download & FFmpeg conditioning on CPU using `tempfile.TemporaryDirectory()`.
  - Slicing on CPU in $\le 1800\text{s}$ chunks.
  - Decorated per-chunk GPU workers with `@spaces.GPU(duration=120)` returning CPU numpy/list arrays:
    - `_gpu_transcribe_chunk`
    - `_gpu_diarize_chunk`
  - Global cross-chunk clustering and biometric matching on CPU.
  - Endpoint `/transcribe`: Returns full transcript JSON.
  - Endpoint `/rediarize`: Takes audio URL + existing segments, runs `_gpu_diarize_chunk`, projects labels onto segments, asserts text hash, and returns updated transcript JSON.
- [x] **Step 3: Write and run unit test for app logic**
  - Command: `python -m unittest tests/test_zerogpu_app.py`
- [x] **Step 4: Commit**
  - Message: `feat(zerogpu): implement secure ZeroGPU app with decoupled CPU orchestrator and per-chunk GPU workers`

---

### Task 3: Modernized Cloud Client & Atomic Index Sync

**Files:**
- Create: `scripts/cloud_transcribe_client.py`
- Modify: `scripts/modal_transcribe_client.py` (backward-compat alias)
- Test: `tests/test_cloud_client.py`

**Purpose:**
Provide a unified client that connects to the ZeroGPU Space (via authenticated Gradio client / REST), streams audio by URL, handles quota exhaustion gracefully, and writes updates atomically to `transcripts_summary_index.json`.

- [x] **Step 1: Write unit tests in `tests/test_cloud_client.py`**
  - Test atomic merge: Concurrent or repeated writes preserve all existing episodes in `transcripts_summary_index.json`.
  - Test schema conformance: Generated summary entries match all required `EpisodeSummary` keys.
  - Test quota-error handling: Graceful exit code 0 with resume state saved.
- [x] **Step 2: Implement `scripts/cloud_transcribe_client.py`**
  - Connects to `HF_TRANSCRIBE_ENDPOINT` passing `HF_TOKEN` for priority quota.
  - Passes audio download URL from GitHub Release (no massive base64 payloads).
  - Implements `sync_to_local_transcripts()` targeting `public/transcripts/transcripts_summary_index.json` with atomic file swapping (`tempfile` + `os.replace`).
  - Regenerates `.srt` and `.txt` matching updated segments.
  - Clobber-uploads updated assets to GitHub Release.
- [x] **Step 3: Point `scripts/modal_transcribe_client.py` to `cloud_transcribe_client.py`**
- [x] **Step 4: Run tests**
  - Command: `python -m unittest tests/test_cloud_client.py`
- [x] **Step 5: Commit**
  - Message: `feat(client): modernize cloud transcriber client with atomic summary index sync and quota resilience`

---

### Task 4: Batch Historical Re-Diarizer (`scripts/rediarize_transcripts.py`)

**Files:**
- Create: `scripts/rediarize_transcripts.py`
- Create: `tests/test_rediarize_batch.py`

**Purpose:**
Build the batch orchestrator to systematically repair the 811 historical transcripts without re-transcribing words. Includes quota-aware rate pacing, checkpoint/resume, text integrity verification, and sidecar voiceprint caching.

- [x] **Step 1: Write unit tests in `tests/test_rediarize_batch.py`**
  - Test resume capability from `rediarize_checkpoint.json`.
  - Test text-hash verification rejecting any response that altered words or timestamps.
- [x] **Step 2: Implement `scripts/rediarize_transcripts.py`**
  - Flags: `--tag`, `--all`, `--filter-speaker`, `--limit`, `--dry-run`, `--upload`.
  - Reads existing transcript from `public/transcripts/episodes/<tag>.json`.
  - Calls `/rediarize` endpoint.
  - Asserts SHA-256 text parity.
  - Saves updated `<tag>.json` and updates `transcripts_summary_index.json`.
  - Saves sidecar `public/transcripts/voiceprints/<tag>_voiceprints.json`.
  - Checkpoint tracking: Saves completed tags in `public/transcripts/rediarize_checkpoint.json`.
  - Quota catcher: If ZeroGPU quota is exhausted, logs remaining queue, commits local updates, and exits cleanly.
- [x] **Step 3: Run tests**
  - Command: `python -m unittest tests/test_rediarize_batch.py`
- [x] **Step 4: Commit**
  - Message: `feat(rediarize): build quota-resilient batch re-diarization engine with text hash verification`

---

### Task 5: GitHub Actions Workflows & State Persistence

**Files:**
- Modify: `scripts/batch_transcribe_queue.py`
- Modify: `.github/workflows/batch_transcribe.yml`
- Create: `.github/workflows/batch_rediarize.yml`

**Purpose:**
Wire `zerogpu` into GitHub Actions batch transcription and add a recurring workflow to chip away at historical re-diarization, ensuring git commits and pushes persist state on the remote repository.

- [x] **Step 1: Update `scripts/batch_transcribe_queue.py`**
  - Add `"zerogpu"` to `--engine` choices (defaulting to `"zerogpu"` when `HF_TOKEN` is present).
  - Route `"zerogpu"` to `scripts/cloud_transcribe_client.py`.
- [x] **Step 2: Update `.github/workflows/batch_transcribe.yml`**
  - Add `zerogpu` to engine choice dropdown.
  - Pass secrets: `HF_TOKEN`, `HF_TRANSCRIBE_ENDPOINT`, `SPACE_API_KEY`.
  - Ensure git step commits and pushes `public/transcripts/` with rebase.
- [x] **Step 3: Create `.github/workflows/batch_rediarize.yml`**
  - Workflow dispatch with `limit` (default: 10), `filter_speaker`, `upload` (default: true).
  - Schedule: Optional cron to chip away at backlog daily within free quota.
  - Includes `git commit` & `git push` for `public/transcripts/`.
- [x] **Step 4: Dry-run validation**
  - Command: `python scripts/batch_transcribe_queue.py --engine zerogpu --dry-run`
- [x] **Step 5: Commit**
  - Message: `feat(ci): add ZeroGPU batch workflows with remote git persistence`

---

### Task 6: Cleanup, Deploy Space & Regression Verification

**Files:**
- Modify: `requirements-worker.txt`
- Modify: `scripts/transcribe_and_diarize.py`
- Delete: `scripts/cloud_voice/synthesize_hf.py`

**Purpose:**
Remove dead dependencies and hardcoded personal paths, deploy the Space to Hugging Face, and run full regression tests.

- [x] **Step 1: Clean dependencies & paths**
  - Remove `kaggle` from `requirements-worker.txt`.
  - Clean personal Windows paths in `find_ffmpeg()` in `scripts/transcribe_and_diarize.py`.
  - Delete orphaned `scripts/cloud_voice/synthesize_hf.py`.
- [x] **Step 2: Run complete test suite**
  - Command: `python -m unittest discover -s tests -p "test_*.py"`
  - Command: `npm test`
- [x] **Step 3: Push Space to Hugging Face**
  - Verify directory structure of `spaces/zerogpu-transcriber/`.
- [x] **Step 4: Final Commit**
  - Message: `chore(release): finalize SpacePipe ZeroGPU transcription and re-diarization stack`

---

## Plan Verification & Safety Checklist
- [x] Top-level endpoints are CPU-only; GPU holds lease only during chunk compute with `@spaces.GPU(duration=120)`.
- [x] Audio operations wrapped in `tempfile.TemporaryDirectory()`.
- [x] Overlapping crosstalk stripped prior to ECAPA-TDNN extraction.
- [x] 1-to-1 bipartite profile matching strictly enforced.
- [x] Text SHA-256 hash verified identical before and after re-diarization.
- [x] Safe `.get("start")`/`.get("end")` on unaligned words.
- [x] Atomic write to `transcripts_summary_index.json` verified.
- [x] Quota exhaustion caught cleanly with checkpoint persistence.
- [x] Workflows commit and push index updates to remote git repository.
