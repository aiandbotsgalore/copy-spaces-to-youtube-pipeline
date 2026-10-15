# TASK: Build the "AI Prompt Director" in Montage Studio (v2, grounded in the actual repo)

You are a senior engineer working in `C:\Users\Logan\copy-spaces-to-youtube-pipeline` (SpacePipe Studio).
Read sections 0 to 2 completely before writing any code. Build in the phases in section 9.
After each phase run `npm run typecheck && npm test && npm run build`, fix failures, then report in the format in section 10 before starting the next phase.
Where this prompt says "verify", produce evidence (command output, a measured value). Do not assume.

---

## 0. Ground truth (verified against the repo, 2026-10-13; trust this over your priors)

### 0.1 Runtime and tooling
- **Vite 6 + React 19 + TypeScript 5.8 SPA** (`package.json` name `spacepipe-gen`). Dev server: port 5000, `host: '0.0.0.0'`, launched by `launch-app.ps1` via `npm run dev`.
- **This is NOT Next.js.** There is no `app/` or `pages/` directory and no API routes. The only server-side code is Vite plugin middleware in `vite.config.ts` (`setupProxyMiddlewares`, with `/api/fetch-asset` and `/api/upload-asset`, registered in both `configureServer` and `configurePreviewServer`). The Director endpoint goes there, implemented in `server/directorMiddleware.ts` and imported by `vite.config.ts`.
- `package.json` scripts are only `dev`, `build`, `preview`. `vite build` does not type-check. Add `"typecheck": "tsc --noEmit"` and `"test": "vitest run"`, with `vitest` as the **only** new dependency (devDependency).
- Path alias `@/*` maps to the repo root. Shared types live in root `types.ts` (there is no `types/` directory). Put Director types in a new `utils/directorTypes.ts`.
- `vite.config.ts` already calls `loadEnv(mode, '.', '')` and has a `define` block that bakes `GEMINI_API_KEY` into the client bundle. **Do not touch that block and do not add anything to `define`.** Mention it in your final report as a pre-existing exposure.

### 0.2 Montage code that already exists
- `contexts/MontageContext.tsx` owns state and audio.
  - `MontageClipItem`: `id, title, quote, speaker, sourceTitle, sourceTag?, sourceDate?, audioUrl?, startSec, endSec, category?, severity?, quoteId?, status?, isExcluded?`.
  - Status literals use **underscores**: `'EXISTS' | 'READY_FOR_EXTRACTION' | 'SOURCE_NOT_AVAILABLE'`.
  - Persistence: localStorage `spacepipe_montage_clips_v2`. Any new `MontageClipItem` field must be **optional** so old saved timelines still load (no storage-key bump).
  - Global `gapSeconds` (default 0.35) and `targetDurationSec` (default 90).
  - Existing API you must keep working: `addClip, removeClip, moveClip, reorderClips, nudgeClipStart, nudgeClipEnd (+/-0.1 and 0.5, min 0.2 s), clearClips, autoCurate('escalation'|'chronological'|'target_fit'), isBlacklisted, toggleBlacklist, startAudition, stopAudition, skipAudition, exportStitchedWav, exportManifestJson, exportAudacityLabels`.
- **Trimming already exists: it is `startSec` / `endSec`.** There is no `trimStartSec` / `trimEndSec`. Do not add parallel fields. Add optional `origStartSec` / `origEndSec` (the window before any trim, set once) so "trimmed by" and "reset" can be derived.
- `components/MontageStudio.tsx` (about 1117 lines, **untracked in git**, lazy-loaded at `App.tsx:23`, mounted at `App.tsx:750`).
  - There is **no `SequenceTimeline` component and no `auditionSequence`**. The timeline is an inline `<section>` titled "Sequence Timeline" (about line 459).
  - Landmarks: toolbar with the three autoCurate buttons (about 476 to 490), "Master Sequence Controls" (gap slider, normalize, fades; about 509), cards rendered inline in `timelineClips.map` (about 582), Audition button (about 773), runtime math (about 299 to 310) using the global `gapSeconds` and `Math.max(0.2, ...)`.
  - The clip pool `availableClips` is merged from three sources: `cue_sheet_audit_results.json` (21 cues: 11 EXISTS, 9 READY_FOR_EXTRACTION, 1 SOURCE_NOT_AVAILABLE), `clips/angela/manifest.json` (pre-sliced WAVs), and `clips/clips_catalog.json` (432 entries).
- **Audio today:**
  - Audition = one `HTMLAudioElement` + a `timeupdate` listener + `setTimeout` for gaps. `timeupdate` fires only about every 150 to 250 ms, so clip ends overshoot. That is too coarse for 0.1 s trims.
  - Export = Web Audio: decode, `sliceAudioBuffer`, `stitchAudioBuffers(ctx, buffers, {gapSec, normalizePeak, targetLufs: -16, targetPeakDb: -1, antiClickFades, fadeMs: 18})` in `utils/wavEncoder.ts`, then `audioBufferToWav`. **There is no FFmpeg anywhere in this path.** `stitchAudioBuffers` accepts a single `gapSec`.
  - `exportAudacityLabels` clamps durations with `Math.max(0.5, ...)`, the Studio UI uses 0.2, and the slicer uses at least 1 frame, so label times drift on short clips today. The shared plan in 3.1 must unify this (`MIN_CLIP_SEC = 0.2`).

### 0.3 Data traps (these would have broken the first version of this task)
1. **Placeholder durations.** Manifest clips (`clips/angela/*.wav`) are loaded with a hard-coded `startSec: 0, endSec: 30`. Their real length is unknown. Only 9 of the 21 audit cues have `start_seconds`. The LLM must never be shown a fake 30 s.
2. **READY_FOR_EXTRACTION cues may have no playable audio yet.** Never offer a clip to the LLM unless it has a working `audioUrl` and a probed real duration.
3. **Transcripts are segment-level, not word-level.** `public/transcripts/episodes/*.json` contain `segments: [{start, end, speaker, text}]`. An LLM cannot know where a word ends, so it must not be asked for trim timestamps. Trims are resolved by code (section 5).
4. **Possible existing playback bug (verify in Phase 0, do not assume).** For catalog clips, `startSec/endSec` are mapped from episode-relative `start_seconds/end_seconds` (for example 5625.6), but `download_url` looks like a per-clip file (for example `01h33m45s_Title.mp3`, duration 68.6 s). If the asset is pre-cut, `audio.currentTime = 5625` is wrong. An unauthenticated HEAD to the asset returned 404 (private repo), so this could not be confirmed remotely. Verify with a Range request or `loadedmetadata` on 5 samples. If confirmed, normalise those clips to a file-relative window (`0..duration`), keep the episode-relative times as metadata, and report it. Do not "fix" anything else.
5. **Hard editorial exclusions already exist in code**: `HARD_EXCLUDE_PHRASE` ('defended him relentlessly'), the `AQ-0269` blacklist, the `isExcluded` flag, and `isBlacklisted()`. These clips must never reach the LLM and never appear in a returned cut. Enforce on both client and server.

### 0.4 Editorial charter (binding): read `ANGELA_EDITORIAL_CHARTER.md`
The Director edits material about real people. The rules below are not optional style:
- Quote-first: the principal speaker's own recorded words carry the story.
- **Prevent misleading edits.** Preserve context. Never trim or reorder in a way that implies something the recordings do not support. Allegations stay allegations.
- **No true-crime tropes, no loaded labels, no verdict language.** Titles, taglines and notes are descriptive and chronological ("Angela states the rule she later applies to others"), never "Legal Thriller", "Scorched Earth", "Forensic Verdict", "Hostile baseline", and so on.
- **Dynamic silence**: a pause after a significant admission carries evidentiary weight.
- Broadcast targets stay as they are: -16.0 LUFS, -1.0 dBTP, 18 ms fades.

### 0.5 Repo hygiene
- Git is dirty: `components/MontageStudio.tsx` is untracked; `contexts/MontageContext.tsx`, `utils/wavEncoder.ts`, `App.tsx` and others are modified. **First action:** `git switch -c feat/prompt-director`, then commit a checkpoint of the current work ("chore: checkpoint before prompt director"). Discard nothing.
- Line endings differ by file: `utils/wavEncoder.ts` and `App.tsx` are **CRLF**; `MontageContext.tsx` and `MontageStudio.tsx` are LF. Preserve each file's existing line endings.
- The repo root holds a 95 MB zip, `node_modules`, and large transcript trees. **Never run repo-wide recursive grep/find.** Scope searches to `components/ contexts/ utils/ hooks/ server/`.
- Do not remove or rename existing exports. Keep the three autoCurate buttons: they are the offline fallback.

---

## 1. Secrets, model and gateway

### 1.1 Already done by the human (verify, do not redo)
- `.env.local` exists at the repo root and is gitignored via `*.local`. It contains `CHEAPER_INFERENCE_API_KEY`, `CHEAPER_INFERENCE_BASE_URL=https://api.cheaperinference.com/v1`, `DIRECTOR_MODEL=claude-sonnet-5.5`. `.env.example` holds the same names with blank values and is meant to be committed.
- **Never print, log, echo, commit or embed the key** in source, tests, fixtures, docs, error messages or reports. Never prefix it with `VITE_`. Never add it to `define`. Redact `Authorization` and `x-director-key` everywhere.

### 1.2 Gateway contract
- Base URL `https://api.cheaperinference.com/v1`, OpenAI-compatible: `POST {base}/chat/completions`, `Authorization: Bearer <key>`, `GET {base}/models` for discovery.
- **Default model: `claude-sonnet-5.5`** (confirmed present in the gateway's `/models` on 2026-10-13). Define `DEFAULT_DIRECTOR_MODEL = 'claude-sonnet-5.5'` in `utils/directorProfile.ts`.
  - Model precedence: request `model` (from Settings; must start with `claude-`) > `DIRECTOR_MODEL` env > `DEFAULT_DIRECTOR_MODEL`.
  - On a model-not-found error, retry once with `claude-sonnet-5` and tell the user in a toast.
  - **Never default to, or fall back to, any "mini", "flash", "nano" or "lite" model.**
- Structured output support is **unknown**. Do not assume `response_format: json_schema` works with Claude via this gateway. Phase 0 probes it (see 9). Implementation: try `response_format: {type:'json_schema', json_schema:{name, strict:true, schema}}` first; on a 400 that mentions `response_format`/`json_schema`/unsupported, remember that for the process and retry with prompt-enforced JSON. **In every case parse robustly** (strip code fences, extract the first balanced `{...}`) **and validate with section 4.** The validator is the real guarantee, not the API flag. If `max_tokens` is rejected, retry with `max_completion_tokens`.

### 1.3 Key resolution and in-app backup
- Primary: the dev-server middleware reads the key from `.env.local` via `loadEnv(mode, '.', '')`. Server-side only.
- Backup (in the app): a **Director Settings** popover with a password input "CheaperInference API key (backup)", a model dropdown (from `GET /api/montage/direct/models`, `claude-*` only) and "Test connection".
  - Stored in localStorage via new functions in `utils/storage.ts` that mirror `saveToken / loadStoredToken / clearStoredToken` (keys `spacepipe_director_key_v1`, `spacepipe_director_model_v1`). Add them to `clearAll()`.
  - The client sends the key in header `x-director-key` **only if** `GET /api/montage/direct/status` reports `keyConfigured:false`. Server precedence: env key > header key.
  - `status` returns `{keyConfigured, keySource:'env'|'none', model, baseUrl}`. It never returns the key or any part of it. The UI shows "Key: .env.local OK" or "Key: in-app backup OK/missing".
  - Never bundle a key into client code at build time; the backup lives only in the user's browser storage.

### 1.4 Endpoint safety
The dev server binds `0.0.0.0` with `allowedHosts: true`, so any device on the LAN could otherwise call a paid endpoint.
- Reject non-loopback callers (`req.socket.remoteAddress` not in `127.0.0.1`, `::1`, `::ffff:127.0.0.1`) with 403, unless `DIRECTOR_ALLOW_REMOTE=1`.
- `/api/montage/direct` accepts POST only; JSON body limit 1 MB; per-request timeout 60 s via `AbortController`; at most 3 concurrent upstream calls.

---

## 2. Product spec (what the user wants)

An LLM-driven Director that replaces the guesswork of static presets, while keeping them as fallback:
1. Conversational prompt + suggestion pills.
2. **Three competing cuts per prompt**, generated as **three parallel requests** (one per archetype) so cuts appear as they finish and one failure does not lose the others.
3. Conversational **iterative refinement** against the current timeline, returned as **edit operations**, not a rewritten timeline.
4. **Ping-pong** interleaving heuristics and **dynamic gaps** (0.1 to 0.9 s).
5. **Micro-trims** at start/end, resolved by code against real audio/segments.
6. **Tension Arc** SVG and **liner notes** on timeline cards.
7. Trims and per-clip gaps flow through audition, WAV export, Audacity labels and the manifest JSON.

### 2.1 Archetypes (charter-aligned; replaces "Legal Thriller / Psychological Drama / Viral")
Defined in `utils/directorProfile.ts` as data, so the system prompt is assembled from a profile object, not hard-coded strings.
| id | Title | Lens |
|---|---|---|
| `cut_a` | Chronological Record | Ordered by `sourceDate`, then position. Follows the charter spine (trust, method, ethical rules, reversal, archive, public accusation, escalation, contradiction). Descriptive, no inference. |
| `cut_b` | Her Own Standards | Pairs the speaker's stated standards/rules with later statements they can be compared against (charter core question 1). Juxtaposition only; never asserts a conclusion. |
| `cut_c` | Cold Open (30 to 60 s) | Target clamped to 30 to 60 s. 4 to 7 clips, strongest self-authored lines. **Every clip must make sense standing alone.** A clip that is only intelligible with omitted context is disqualified. |
The user's prompt sets subject and runtime; the archetype sets the editorial lens.

### 2.2 System-prompt rules (shared by all cuts; put verbatim in `directorProfile.ts`)
1. Choose only from `candidates`. Never invent a `clipId`. Use each at most once.
2. Verbatim integrity: you may reorder, drop, and optionally trim a leading/trailing filler or lead-in. **Never** trim so that a negation, qualifier, condition or attribution is lost or a statement is separated from who it is about. If unsure, do not trim.
3. Language: `note` at most 18 words, descriptive and evidentiary. `title`/`tagline` descriptive. No verdict words, no characterising anyone in your own voice, no true-crime clichés, no emoji.
4. Ping-pong: with 2+ speakers, avoid more than 2 consecutive clips from one speaker unless it is a deliberate monologue. With a single-speaker pool, alternate between "stated standard" and "later statement" categories instead.
5. Gaps (`gapAfterSec`): 0.1 to 0.2 rapid rebuttal; 0.35 standard; 0.6 to 0.9 after a significant admission or before a contrasting statement. Last pick: 0.
6. `tensionScore` 1 to 10 is pacing intensity, relative within the cut. Shape an arc; do not flat-line; do not open at 8+ unless `cut_c`.
7. Runtime: estimate total = sum of clip durations (after your trims) + gaps; stay within +/-10% of `targetWindowSec`. The server recomputes; do not output durations.
8. Output JSON only, matching the schema. No prose.

---

## 3. Data contracts

### 3.1 `MontageClipItem` additions (all optional, in `MontageContext.tsx`)
```ts
origStartSec?: number;  origEndSec?: number;      // window before any trim; set once when applied
sourceDurationSec?: number;                        // real, probed
gapAfterSec?: number;                              // overrides global gapSeconds; ignored on last clip
directorNote?: string;  tensionScore?: number;     // 1..10
locked?: boolean;                                  // refinement may not touch
trimBasis?: 'segment' | 'silence' | 'estimated' | 'manual';
keptText?: string;                                 // exactly what survives a trim
director?: { cutId: CutId; model: string; promptHash: string };   // provenance
```

### 3.2 `utils/directorTypes.ts`
```ts
export type CutId = 'cut_a' | 'cut_b' | 'cut_c';

export interface DirectorCandidate {          // what the LLM sees. No fake durations, ever.
  id: string; quoteId?: string; speaker: string; category?: string;
  sourceDate?: string; sourceTitle: string;
  status: 'EXISTS' | 'READY_FOR_EXTRACTION';
  durationSec: number;                        // REAL (probed)
  text: string;                               // <= 280 chars
  textTruncated: boolean;
}

export interface DirectorPick {               // LLM output per clip (no durations!)
  clipId: string;
  keptText?: string;                          // present only if proposing a trim
  gapAfterSec: number;
  tensionScore: number;
  note: string;
}
export interface DirectorCutResponse { cutId: CutId; title: string; tagline: string; picks: DirectorPick[]; }

export type DirectorOp =
  | { op: 'drop'; clipId: string }
  | { op: 'move'; clipId: string; toIndex: number }
  | { op: 'trim'; clipId: string; keptText: string }
  | { op: 'setGap'; clipId: string; gapAfterSec: number }
  | { op: 'insert'; clipId: string; atIndex: number; gapAfterSec?: number; note?: string }
  | { op: 'replace'; clipId: string; withClipId: string }
  | { op: 'setNote'; clipId: string; note: string };
export interface DirectorRefineResponse { ops: DirectorOp[]; summary: string; }   // max 12 ops

export type DirectorErrorCode =
  | 'NO_KEY' | 'UNAUTHORIZED' | 'RATE_LIMIT' | 'TIMEOUT' | 'UPSTREAM'
  | 'MODEL_NOT_FOUND' | 'BAD_OUTPUT' | 'NO_CANDIDATES' | 'FORBIDDEN_ORIGIN' | 'SERVER_UNAVAILABLE';
```
Request: `POST /api/montage/direct` with `{mode:'generate'|'refine', cutId, userPrompt, targetWindowSec, candidates, current?, instruction?, model?}`.
Response: `{ok:true, cut|refine, warnings, usage, model, ms}` or `{ok:false, code, message, retryAfterSec?}`.

### 3.3 `utils/sequencePlan.ts` (pure; **single source of truth for timeline math**)
`buildSequencePlan(clips, defaultGapSec)` returns, per item: `index, clip, effStart, effEnd, effDur (>= MIN_CLIP_SEC 0.2), gapAfter (last = 0), timelineStart, timelineEnd`, plus `totalSec`. Used by: Studio runtime/gauge math, the sequence player, WAV export, Audacity labels, TensionArc x-positions, and the validator. Clips without playable audio are filtered **before** the plan is built for audio/export, so gaps and labels stay consistent with what is actually rendered.

---

## 4. Server: `server/directorMiddleware.ts`

Routes: `POST /api/montage/direct`, `GET /api/montage/direct/status`, `GET /api/montage/direct/models`. Register in both `configureServer` and `configurePreviewServer`.

1. Build messages: system = shared rules (2.2) + archetype lens + JSON schema; user = JSON payload. **Keep the `candidates` block first and byte-identical across the three parallel calls** so provider-side prefix caching can apply. Temperature 0.4 generate, 0.2 refine, `max_tokens` 4096.
2. Call the gateway (1.2). Map failures to error codes: 401/403 to `UNAUTHORIZED`, 429 to `RATE_LIMIT` (+retry-after), abort to `TIMEOUT`, 5xx/network to `UPSTREAM`, model errors to `MODEL_NOT_FOUND`.
3. Validate with `utils/directorValidate.ts` (shared, pure, imported by the server and tests):
   - Reject: unknown `clipId` (this doubles as the exclusion filter, since banned clips are never candidates), duplicates, locked-clip targets in refine, `keptText` that is not a contiguous (normalised) substring of the candidate text.
   - Clamp: `gapAfterSec` to [0.05, 1.5], `tensionScore` to integer 1 to 10, `note` to 140 chars.
   - Lint `note/title/tagline` against a verdict/trope word list from the profile (for example: liar, predator, monster, guilty, destroy, shocking, bombshell, scorched earth). A hit is a validation error, not a silent edit.
   - Runtime: estimate `sum(durationSec, with trims estimated proportionally by keptText length) + sum(gaps)`. Outside +/-10% of target: **one repair call** that lists the exact errors and the delta. If still out of range, apply a deterministic fix: while over +10%, drop the lowest-tension unlocked pick that is not first or last; if still under -10%, accept with a warning (never invent clips).
   - Soft warnings (not errors): consecutive same-speaker runs of 3 or more when 2+ speakers exist.
4. On `BAD_OUTPUT` after the repair call, return `{ok:false, code:'BAD_OUTPUT', message}` with a short, key-free reason.
5. Log only: route, cutId, model, ms, token usage, error code. Never log prompts' candidate text at info level, never headers.

---

## 5. Client-side core (pure where possible, all unit-tested)

### 5.1 `utils/clipProbe.ts` real durations
For each shortlisted clip, resolve `durationSec`: for `.wav`, Range-fetch the first 128 bytes and parse the RIFF header (`dataSize / byteRate`); otherwise `Audio` with `preload='metadata'` and `loadedmetadata`. Concurrency 6, 8 s timeout, cache in localStorage `spacepipe_clip_durations_v1` keyed by `audioUrl`. A clip whose duration cannot be determined is excluded from candidates (reason: "duration unknown") and counted in the NO_CANDIDATES breakdown. Set `origStartSec/origEndSec/sourceDurationSec` from the probe when a clip is applied.

### 5.2 `utils/directorCandidates.ts` shortlist (deterministic)
- Filter out: `isExcluded`, `HARD_EXCLUDE_PHRASE` in quote, `isBlacklisted(quoteId|id|quote)`, `SOURCE_NOT_AVAILABLE`, no `audioUrl`, unprobeable duration. Keep reason counts.
- Rank with no embeddings: keyword hits of the prompt against text/title/category/speaker, plus `severity`, plus `getCategoryEscalationWeight` when the prompt contains arc words ("arc", "escalat", "chronolog"). Take the top `DIRECTOR_CANDIDATE_CAP = 80`, stratified so no single category exceeds 40% of the cap. Text truncated to 280 chars. **Stable order by id** (supports prefix caching). Optional toggle in the UI: "Limit to current filters".

### 5.3 `utils/trimResolver.ts` (this replaces the v1 idea of asking the LLM for seconds)
Input: a clip, the model's `keptText`, optional episode segments. Steps:
1. Normalise (lowercase, strip punctuation, collapse whitespace). If `keptText` is not a contiguous substring of the clip's transcript, reject the trim and keep the original window.
2. Map the char range to a time estimate proportionally within `[origStartSec, origEndSec]`.
3. If transcript segments overlap the clip, snap to the nearest segment boundary (`trimBasis:'segment'`).
4. Otherwise decode the audio (shared decode cache), compute 10 ms RMS frames, and within +/-0.35 s of the estimate pick the quietest frame where energy stays within noise-floor +6 dB for at least 80 ms (`'silence'`). If none, keep the estimate (`'estimated'`).
5. Clamp: never extend beyond the original window; `effDur >= 1.5 s` (else reject); a single automatic trim may remove at most 35% (`MAX_AUTO_TRIM_FRACTION`). Manual trims in the UI have no cap and set `trimBasis:'manual'`.
6. Persist `keptText` on the clip so the UI can show exactly what was kept vs removed.

### 5.4 `applyOps(clips, ops)` in `directorValidate.ts`
Deterministic, pure, immutable. Locked clips are never changed by ops. Returns `{clips, changelog: string[]}`. The changelog drives the "Dropped #3 / Gap #2 to 0.8s" chips.

---

## 6. Audio integration

### 6.1 Playback: `utils/sequencePlayer.ts` (Web Audio, sample-accurate)
Replace the *internals* of `startAudition / stopAudition / skipAudition` in `MontageContext.tsx`; keep their public signatures and the `isAuditioning` / `currentAuditionIndex` state.
- Decode each unique `audioUrl` once (use `getCachedAudioUrl` as export does) into an LRU of decoded `AudioBuffer`s (cap by total samples, about 300 MB). Show "Decoding n/N" on first play.
- Schedule with `source.start(when, effStart, effDur)`. Gain ramps of 18 ms at both edges (respect the `antiClickFades` toggle). Next start = previous start + `effDur` + `gapAfter`. Schedule 2 clips ahead; `stop()` disconnects everything.
- Drive `currentAuditionIndex` from `ctx.currentTime`, not `setTimeout`.
- If Phase 0 finds very long source files (more than about 20 minutes or 40 MB), keep the legacy `HTMLAudio` path for those clips only and warn that end points are approximate.

### 6.2 Export
- `utils/wavEncoder.ts` (CRLF file): extend `StitchOptions` with `gapsSec?: number[]` (length n-1). It takes precedence over `gapSec`; behaviour is otherwise unchanged (18 ms fades, -16 LUFS, -1 dBTP stay exactly as they are).
- `exportStitchedWav`: slice with the plan's `effStart/effEnd` (the stored `startSec/endSec` already reflect trims; **do not apply trims twice**), pass `gapsSec` from the plan, skipping clips without audio from both clips and gaps.
- `exportAudacityLabels`: derive from the same plan; no `Math.max(0.5, ...)`; label text unchanged.
- `exportManifestJson`: add per-clip `origStartSec, origEndSec, startSec, endSec, keptText, trimBasis, gapAfterSec, directorNote, tensionScore, director`, plus top-level `directorPrompt`. This is the audit trail for "no misleading edits": every trim is reproducible and reversible.

---

## 7. UI

### 7.1 Placement and layout
Inside the Studio's left Sequence Timeline `<section>`, **between the Master Sequence Controls and the scrolling cards list**. Collapsible header; open/closed state in localStorage `spacepipe_director_open_v1`. Match the existing dark `slate/indigo/emerald/rose` Tailwind look. Must not break the `min-h-0` / `overflow-y-auto` scroll layout.

```
+----------------------------------------------------------------+
| AI PROMPT DIRECTOR                      [key OK] [settings] [v] |
| [ "90s: allegations to retaliation, her own words"     ] [Go]  |
| Pills: [static x3] [dynamic from your catalog x3]    [Cancel]  |
|----------------------------------------------------------------|
| [Cut A Chronological Record  8 clips  1:28 (-2s) *]            |
| [Cut B Her Own Standards     9 clips  1:34 (+4s)  ]  [Audition]|
| [Cut C Cold Open             5 clips  0:47        ]            |
| Tension arc ~~~~/\_/\____/\/\~~~~   68s / 90s target           |
| [ Talk back to the Director...                       ] [Undo]  |
+----------------------------------------------------------------+
```

### 7.2 `components/PromptDirector.tsx`
- Pills: 3 static (charter-neutral) such as "90s chronological: trust, reversal, escalation", "45s cold open: strongest self-authored lines", "Her own standards vs later statements"; plus up to 3 **dynamic** pills built from the loaded catalog (top categories/speakers). A click **fills and submits**; Shift-click only fills.
- States: idle, generating (three per-cut chips with elapsed timers + **Cancel** via `AbortController`), ready, partial (failed cuts show a per-cut Retry), error.
- Error copy per code (no dead ends): `NO_KEY` shows an inline "Add key" button that opens Settings; `UNAUTHORIZED` "Key rejected"; `RATE_LIMIT` countdown + retry; `TIMEOUT` retry; `BAD_OUTPUT` retry + "details"; `NO_CANDIDATES` shows the breakdown ("12 excluded, 9 not yet extracted, 3 duration unknown") and suggests removing filters; `SERVER_UNAVAILABLE` "Director needs the dev server (`npm run dev`)". The autoCurate presets stay one click away in every state.
- **Per-cut drafts (protects manual edits).** Each cut is held as a draft. Switching tabs saves the current timeline back into the previous cut's draft, then loads the new one via a new context method `replaceClips(clips)` (stops audition, does not open the drawer). Tabs show an "edited" dot when a draft diverges from the AI output. Before the first Director apply, snapshot the user's existing timeline and offer "Restore previous timeline".
- **Undo/redo** for Director actions (apply cut, refine, tab load), history depth 20, Ctrl/Cmd+Z while focus is in the panel.
- Refinement input sends `{mode:'refine', current, candidates, instruction}`, applies returned ops through `applyOps`, and shows the summary and changelog chips with Undo.
- Footer: model name and session token total from `usage`.

### 7.3 `components/DirectorSettings.tsx`
Key status line, backup key input (password, show/hide, Save/Clear), model dropdown (default `claude-sonnet-5.5`), "Test connection" (calls `/status` + a tiny completion), candidate cap, "Limit to current filters" toggle.

### 7.4 `components/TensionArc.tsx`
Props `{items: {startSec, endSec, score, label}[], activeIndex, targetSec, onHover(i), onSelect(i)}`.
- Pure SVG; monotone cubic path; x from the sequence plan.
- Stroke colour via a **vertical** `linearGradient` with `gradientUnits="userSpaceOnUse"` mapped to score (emerald 1 to 4, amber 5 to 7, rose 8 to 10), **plus** a non-colour encoding: marker shape per band (circle / diamond / triangle) and the numeric score on hover/focus.
- Each point is a focusable button: `aria-label="Clip 3, tension 8 of 10, at 0:34"`. Hover or focus highlights the matching timeline card (`data-clip-id`, scroll into view). Target-duration tick plus "68s / 90s".

### 7.5 Timeline card upgrades (in `MontageStudio.tsx`)
- Under the card header: neutral `directorNote` and tension chip (hidden when absent).
- Trim readout "In +0.4s / Out -0.6s vs original" from `orig*` vs current, a **Reset trim** button, and a `trimBasis` badge ("estimated: verify by ear" when `'estimated'`). Existing nudge controls stay and set `trimBasis:'manual'`.
- **Gap chip between cards**: shows the effective gap; click opens quick toggles (0.1 Fast, 0.35 Standard, 0.8 Dramatic) plus a numeric input (0.05 to 1.5). The existing global slider remains the default for clips with no `gapAfterSec`.
- **Lock** button per card (`locked`), honoured by refinement.
- Replace the inline runtime math (about lines 299 to 310) with `buildSequencePlan(...)`.

---

## 8. Cost and performance
Cap candidates (5.2), truncate text, keep the candidate block first and identical across the 3 calls, `max_tokens` 4096, show token usage. Three requests run in parallel; the UI renders each cut as it arrives.

---

## 9. Phases and gates

**Phase 0: recon (no feature code).**
Branch + checkpoint commit. Add `typecheck`/`test` scripts and `vitest`. Write `scripts/probe-director.mjs`, run with `node --env-file=.env.local scripts/probe-director.mjs`, which prints (never the key): `/models` contains `claude-sonnet-5.5`; whether `response_format: json_schema` works; whether `max_tokens` or `max_completion_tokens` is accepted; one tiny completion latency. Verify 0.3 item 4 with 5 catalog samples. Report findings; **stop and ask the human if item 4 is confirmed**, because it changes existing playback.

**Phase 1: pure core + tests.** `directorTypes`, `directorProfile`, `sequencePlan`, `clipProbe`, `directorCandidates`, `directorValidate` (+`applyOps`), `trimResolver` (pure parts). Vitest suites listed in 11.

**Phase 2: server.** `server/directorMiddleware.ts`, status/models routes, gateway client with fallbacks, repair call, error mapping, loopback guard. Test with a mocked `fetch`; add a `scripts/smoke-director.mjs` that hits the local endpoint (no key printed).

**Phase 3: audio.** `sequencePlayer`, `stitchAudioBuffers({gapsSec})`, labels/manifest from the plan, context wiring. Keep public API stable.

**Phase 4: UI.** `PromptDirector`, `DirectorSettings`, `TensionArc`, card upgrades, `replaceClips`, drafts, locks, gap chips.

**Phase 5: polish.** Undo/redo, a11y pass on the arc, copy review for neutrality, and stretch items (only if time remains): per-card "Alternatives" (refine returning 3 replacement candidates), display-only evidentiary badge derived from speaker (`[ANGELA CLAIM]`, `[LOGAN CLAIM]`, `[SAV CLAIM]`).

Gate for every phase: `npm run typecheck && npm test && npm run build` all green.

---

## 10. Report format (after each phase)
1. What changed (files, one line each). 2. Evidence (command output snippets, measured numbers). 3. Deviations from this prompt and why. 4. Open questions. Never include the API key or any prefix of it.

## 11. Acceptance criteria (testable)

**Unit (vitest, node env; write a tiny fake `AudioContext`/`AudioBuffer` helper for audio tests):**
- `buildSequencePlan`: `totalSec == sum(effDur) + sum(gaps)`; last gap is 0; per-clip `gapAfterSec` overrides the global; `MIN_CLIP_SEC` enforced.
- Stitch parity: `stitchAudioBuffers` output length equals `sum(round(effDur*sr)) + sum(round(gap*sr))` within 1 frame per join; Audacity label times equal the plan's timeline times.
- Validator: rejects unknown ids, duplicates, banned clips (`HARD_EXCLUDE_PHRASE`, `AQ-0269`, `isExcluded`), non-substring `keptText`, locked targets; clamps gaps/tension; flags verdict words; runtime enforcement drops lowest-tension non-edge picks deterministically; ping-pong run warning fires at 3+.
- `trimResolver`: rejects trims leaving less than 1.5 s or more than 35% removed; never extends beyond the original window; snaps to a synthetic silence; falls back to `estimated`.
- `applyOps`: locked clips unchanged; changelog accurate; ops are immutable.
- Candidates: excluded/blacklisted/no-audio/unprobed never appear; order is stable; cap and category stratification hold.
- Secrets: a test that greps `src`-like folders (`components utils contexts server scripts`, **not** the whole repo) and the built `dist/` asset text for the `ci_live_` prefix and fails if found.

**Manual QA (list results in your Phase 4 report):**
1. Fresh load with `.env.local` present: Settings shows "Key: .env.local OK"; no key appears in DevTools Network responses or the page source.
2. Rename `.env.local` temporarily: Director shows `NO_KEY` with an "Add key" action; entering a backup key makes it work; clearing it returns to `NO_KEY`.
3. Prompt generates 3 cuts in parallel; tabs fill independently; Cancel aborts all; a forced failure on one cut leaves the others usable.
4. Nudge a trim on Cut A, switch to Cut B and back: the nudge is preserved and Cut A shows the edited dot.
5. Refine "drop the second clip" and "make it about 10 seconds shorter": only those changes occur; locked clips are untouched; Undo restores exactly.
6. Audition: the 0.1 s trim is audible and the gap between clips matches the chip within about 20 ms.
7. Export a WAV and Audacity labels for a cut with mixed gaps: labels align on the waveform at every clip boundary; manifest JSON contains `orig*` vs final windows and `keptText`.
8. From another device on the LAN, `POST /api/montage/direct` returns 403.
9. `AQ-0269` and the `HARD_EXCLUDE_PHRASE` clip never appear in any cut or in the request payload (check Network tab).
10. Existing Auto-Curate buttons and old saved timelines still work.

## 12. Do not
Do not use Next.js conventions, FFmpeg, or any new dependency except `vitest`. Do not add the key to `define`, `VITE_*`, source, tests, docs or logs. Do not commit `.env.local`. Do not remove autoCurate or rename existing exports. Do not use mini/flash/nano models. Do not let the LLM output timestamps or durations. Do not alter the pre-existing `GEMINI_API_KEY` define. Do not start the next phase before the current gate passes.
