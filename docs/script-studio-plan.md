# Script Studio Redesign: Implementation Plan

Status: awaiting Logan's approval. No application code has been changed.
Grounded in: the Script Studio audit, the architecture review, and the experiments saved in `docs/experiments/01_initial_validation` and `docs/experiments/02_multispeaker_validation`.

## Approved direction

1. The investigative question drives discovery; no manual recording selection up front.
2. A verified, source linked Evidence Board per project, built on a shared evidence library so recordings and quotes are read, verified and aligned once and reused by every project.
3. Your 283 verified AQ quotes are part of that library from the first implementation phase.
4. Whole script drafting is the default; single scene rewrite, expand, tighten and regenerate stay available.
5. Arm A of experiment 2 (`docs/experiments/02_multispeaker_validation/A_readable.md`) is the editorial reference for voice, without its segmented architecture.
6. Original tape is preferred over narrator paraphrase where strong tape exists; narration led documentaries remain possible.
7. Quote text and quote audio are verified separately. Uncertain audio is flagged for review, never silently used, and never replaced by a whole transcript segment.
8. Narration and tape introductions are checked against the evidence they cite, not only the quotes.
9. No AI persona detection or classification of any kind.

## 1. Workflow: question to rendered audio

| Step | You | System | Reuses |
|---|---|---|---|
| 1 Question | Type the question, optional names and dates, and choose tape led, balanced or narration led | | `project.thesis` |
| 2 Discover | Tick recordings from a ranked list (top 8 pre ticked, "more" for the next batch) | BM25 over all transcripts, no model call. Recordings already in the library show their existing quotes and AQ quotes at once | `server/scriptSearch.ts` |
| 3 Read | Wait | One Sonnet call per recording not yet read for a similar question. Quotes verified in code, deduplicated against the library and the AQ corpus, stored once | exp1/exp2 extraction prompt, `verifyVerbatim` |
| 4 Align | Nothing (background) | ffmpeg cuts each quote's window, faster-whisper gives word times, code matches the quote. Confident results become usable; the rest are flagged for review | `clipCut` ffmpeg pattern, `snapToSilence` |
| 5 Curate | Star or exclude quotes, listen and confirm speakers, review flagged audio, add claims and document excerpts | Optional single "propose claims" call | Evidence docs |
| 6 Outline | Accept or edit the scene outline | One call | `outlinePrompt` fed the board (as in exp2) |
| 7 Draft | Read the full script | One call, all scenes | `draftPrompt` with every scene (exp2 arm C) |
| 8 Scene tools | Rewrite, expand, tighten or regenerate one scene | One call; other scenes and their block ids untouched | `importCandidate` |
| 9 Check | Fix flagged lines | Code checks, then an evidence check of narration and tape intros against what they cite | `codeGates`, `factcheckPrompt` |
| 10 Rough cut | Listen immediately | Real tape plus timed silence for narration; tape with unreviewed audio is listed, not played as if accurate | `compileScript`, `renderCompiled` |
| 11 Voice and master | Generate narration, lock, render, download | Vox per sentence with cache; the production lock requires reviewed audio and passed checks | `voxSynthesize`, takes cache, `AudioPanel` |

## 2. Evidence architecture

Two layers, both plain JSON files under the existing `.spacepipe-studio/` folder. No database.

### Layer 1: shared evidence library (one file per recording)

`.spacepipe-studio/library/<releaseTag>.json` holds everything learned about a recording, once:

```ts
// utils/scriptTypes.ts (additions)
export interface TextCheck {
  status: 'exact' | 'differs' | 'unlocated';   // exact: passes verifyVerbatim against the transcript
  transcriptSpan?: string;                     // the matching transcript wording when status is 'differs'
  checkedAt: number; transcriptHash: string;   // re-checked in code if the transcript ever changes
}

export interface AudioBoundary {
  status: 'none' | 'aligned' | 'needs_review' | 'verified';
  // aligned: automatic, confident (>= 85% of quote words matched in order, sane length)
  // needs_review: alignment failed or was uncertain; NOT usable until you review it
  // verified: you listened and approved, or an AQ cut point the corpus marks as final
  source?: 'alignment' | 'corpus_cut' | 'manual';
  startSec?: number; endSec?: number;          // episode time; set only for aligned or verified
  suggestedStartSec?: number; suggestedEndSec?: number;  // shown while reviewing, never used for audio
  matchedPct?: number; reason?: string; reviewedAt?: number;
  words?: { w: string; s: number; e: number }[];         // word times of the aligned window
}

export interface LibraryQuote {
  id: string;                        // `${releaseTag}:${shortHash}` (stable across projects)
  releaseTag: string;
  utteranceIds: string[];            // contiguous, one transcript label
  speakerLabel: string;              // raw label as transcribed
  speakerName?: string;              // only after you confirm it by listening
  speakerConfirmed: boolean;         // per quote; a matching label is never treated as proof
  verbatim: string;                  // exact transcript text (original wording, never edited)
  segStart: number; segEnd: number;  // original utterance window, never changed
  text: TextCheck;
  audio: AudioBoundary;
  about: string; why: string;
  type: 'accusation' | 'evidence_claim' | 'motive' | 'threat_or_plan' | 'admission' | 'response' | 'other';
  status: 'checkable' | 'allegation' | 'opinion';
  foundBy: { question: string; at: number }[];
}

/** App side data for an AQ corpus quote. Corpus metadata itself is read live from the master file, never copied. */
export interface AqLink {
  aqId: string;                      // e.g. AQ-0263
  utteranceIds: string[];            // located in the transcript
  text: TextCheck;                   // 'differs' is expected for lightly cleaned corpus wording
  audio: AudioBoundary;              // corpus cut points: verified, source corpus_cut
  speakerConfirmed?: boolean; speakerName?: string;
}

export interface RecordingLibrary {
  version: 1; releaseTag: string; transcriptHash: string;
  reads: { question: string; at: number; model: string; quoteIds: string[] }[];
  notes: { at: number; question: string; text: string }[];   // context notes (who is present, label cautions)
  rejected: { verbatim: string; reason: string; at: number }[];  // failed verification, kept visible
  quotes: LibraryQuote[];
  aqLinks: AqLink[];
}
```

Reuse rules:
- A recording is read again only when you ask ("read for this question"), and new quotes that overlap existing library or AQ quotes (eight or more shared consecutive words in the same utterances) are merged, not duplicated.
- Verification, alignment and speaker confirmation happen once per quote and apply to every project.
- If a transcript is re-transcribed, the hash changes and every quote in that file is re-checked in code; failures are marked, not deleted.

### Layer 2: project Evidence Board (per documentary)

`.spacepipe-studio/projects/<id>/board.json` holds only this project's choices and references:

```ts
export interface BoardItem { ref: string; starred?: boolean; excluded?: boolean; note?: string; addedAt: number }
  // ref: a LibraryQuote id, or 'aq:AQ-0263'
export interface BoardClaim {
  id: string; text: string;
  status: 'verified' | 'allegation' | 'disputed' | 'unsupported';
  supportRefs: string[]; contradictRefs: string[];   // quote refs or source ids
  note?: string;
}
export interface BoardSource { id: string; docId: string; excerpt: string; label: string }  // exact excerpt of a ScriptEvidenceDoc
export interface EvidenceBoard {
  version: 1; question: string;
  tapeBalance: 'tape_led' | 'balanced' | 'narration_led';
  recordings: { releaseTag: string; status: 'candidate' | 'read' | 'skipped'; score?: number }[];
  items: BoardItem[]; claims: BoardClaim[]; sources: BoardSource[];
}
```

Changes to existing types are optional fields only, so old data loads unchanged: clip block gains `quoteRef?: string`; narration block gains `claimIds?: string[]`; `EvidenceRef.quoteId` (already present) points at a quote ref.

Tape needs no new block type: each starred quote with usable audio is exposed as an ordinary `StudioClip` (`clipId: bq_<ref>`, `audioUrl` = episode URL, `audioOffsetSec` = `audio.startSec`, `durationSec` = quote length), so `compileScript`, `/clip-audio`, `renderCompiled` and Montage work as they are. Where an AQ quote already has a pre cut WAV (35 linked in the master, 85 in `public/clips/angela/manifest.json`), that file is used directly.

### AQ corpus import (read only)

- `server/quoteCorpus.ts` reads `docs/documentary/data/angela_quotes_master.json` (283 quotes, 35 fields, 35 recordings) without ever writing to it, and joins `public/clips/angela/manifest.json` for existing WAVs. Its current md5 is recorded so tests can prove it is untouched.
- All 35 corpus fields are shown as they are (category, target, why it matters, verification status, context warnings, related quote ids).
- Located utterances and text checks are computed once and stored in `aqLinks`; the corpus wording is never replaced.
- Audio: 116 quotes have cut points and are marked as not needing alignment, so they become `verified` with source `corpus_cut`. The 167 marked `needs_audio_alignment` start as `none` and go through alignment like any other quote, ending `aligned` or `needs_review`.
- This replaces `server/scriptPaperTrail.ts`; `public/transcripts/investigative_knowledge_graph.json` is left on disk untouched.

### Audio boundaries

1. Cut the quote's utterance window plus or minus 1 s from the episode with ffmpeg (same approach as `clipCut`, reads only that window).
2. Run a small faster-whisper model (1.2.1 installed) with word timestamps on that WAV via a new `scripts/align_quote.py`.
3. Match the verified quote words in order against the recognised words in code.
4. Confident (at least 85% matched, length consistent with word count): `aligned`, with boundaries from the first and last matched words, padded 0.15 s and snapped with `snapToSilence`.
5. Anything else: `needs_review` with a suggested range for the review screen. It is never played in a render as if accurate. Review offers play, nudge (0.25 s) and approve, stored as `verified`/`manual` alongside, not over, the original timestamps.
6. There is no fallback to a transcript segment, ever. A quote without usable audio cannot become tape until reviewed.
7. Results are cached in `.spacepipe-studio/align-cache/` by tag, utterance range and text hash.

Verdict on `trimResolver`: for Script Studio it is replaced completely, because boundaries are fixed per quote when the quote is verified, not guessed when a draft is materialised. `utils/scriptTrim.ts` and the trim fallback in `materializeBlocks` (`utils/scriptGates.ts:209`) are removed. `utils/trimResolver.ts` stays because Montage and Director use it (`utils/directorApply.ts`, `utils/directorRuntime.ts`).

### Speaker attribution (no persona features)

- Speakers are named only from per quote confirmation by listening; labels are suggestions, never proof (exp2: the "Angela" label covered her critics; one label covered several voices).
- Code checks: no raw "Speaker N" in narration; a name next to tape or a quoted line must match that quote's confirmed speaker; unconfirmed speakers are "an unidentified speaker".

## 3. Drafting and evidence checks

- Whole script draft in one call, fed exactly what exp2 validated: board quotes, claims, document excerpts, context notes, two transcript lines either side of each quote, and the outline.
- Scene tools: one call with the full current script as read only context and one scene writable; `importCandidate` replaces only that scene.
- Voice: polished mode by default (live mode caused the filler drift in exp1 B and C and exp2 C); a cleaned Arm A excerpt added as `speaker_samples/Logan/narration_examples/00_investigative_voice.txt` so the existing style mechanism includes it first; a word budget per scene from the target runtime (Arm A ran 33% long).
- Tape balance setting changes the draft instruction and the reported target: tape led (about 40% original audio or more), balanced, narration led (narration carries the story, tape as exhibits).

Evidence checks, in order:
1. Code (deterministic): quote and claim text verbatim; tape audio usable; narration that cites an allegation or disputed claim uses attribution wording (`ATTRIBUTION_RE`); speaker names match confirmations; no raw labels; no duplicate quotes; no repeated sentences across scenes; runtime against target (advisory).
2. Evidence pairing (deterministic): every narration sentence is paired with the quotes and claims it cites, and every tape intro (the narration right before a tape block) is paired with that tape's quote.
3. Evidence check (one call, cross family, reusing `factcheckPrompt`): each pair is labelled supported, overstated, misattributed or unsupported, with the evidence shown beside the line. These are flags for you, not automatic accepts or rejects. This is the check that catches errors like Arm A's "He says so himself" before Speaker 4's tape.

## 4. Codebase triage

| File or part | Category | Change |
|---|---|---|
| `server/scriptEngine.ts` `analyze` | REPLACE | `readForQuestion` into the library |
| `scriptEngine.ts` `tagClips` | REMOVE | |
| `scriptEngine.ts` `outline`, `draft`, `toPatch`, `importCandidate`, `call` | REUSE | Draft sends all scenes in one call |
| `scriptEngine.ts` refine loop (critic, reviser, judge, episode pass, polish) | REPLACE | `rewriteScene` and the evidence check |
| `server/scriptPrompts.ts` | REUSE / REPLACE / REMOVE | Keep base rules, block rules (clip rule becomes quote refs), draft, outline, factcheck. Add read, claims, scene rewrite. Remove analysis, reduce, clip tags, critique, revise, judge, episode critique, polish |
| `server/scriptStudioMiddleware.ts` | REUSE / REPLACE / REPAIR / REMOVE | Add library, board, align, scene and check routes. Remove `/analyze`, `/run*`, `/quality`, loop `/decide`. Repair `/version` so checks run before head moves |
| `server/scriptStore.ts` | REUSE | Plus library, board and align cache paths |
| `server/quoteCorpus.ts` (new) | NEW | Read only AQ adapter |
| `server/quoteLibrary.ts` (new) | NEW | Load, merge, dedupe and save library files |
| `server/quoteAlign.ts` (new), `scripts/align_quote.py` (new) | NEW | Word alignment |
| `server/scriptPaperTrail.ts` | REPLACE | By the AQ adapter |
| `server/scriptData.ts`, `scriptCorpus.ts`, `scriptSearch.ts`, `scriptStyle.ts`, `scriptProviders.ts`, `scriptHandoff.ts` | REUSE | Haiku dropped from default roles (critic role is gone); `combineAnalyses` removed |
| `server/scriptMemory.ts` | REPAIR | Approved passages only when you save one (line 20 currently adds every accepted diff) |
| `server/scriptAudioService.ts` | REUSE | Plus alignment job |
| `server/voxSynthesize.ts`, `utils/scriptAudio.ts` | REPAIR | Per sentence synthesis with cache, then concatenate |
| `utils/scriptGates.ts` | REUSE / REPLACE / REPAIR / REMOVE | Keep `verifyVerbatim`, `findExcerpt`, factual, faithful, locks. Replace clip trim branch. Runtime check advisory. Add the checks above. Remove `judgeConsensus`, `mostConsequential` |
| `utils/scriptTrim.ts` | REMOVE | |
| `utils/trimResolver.ts` | KEEP | Montage and Director only |
| `utils/scriptQuality.ts`, `components/ScriptQuality.tsx` | REMOVE | Judge statistics |
| `utils/scriptCompile.ts` | REPAIR | Placeholder narration for the rough cut; blocks tape without usable audio |
| `utils/scriptFormats.ts` | REUSE | |
| `utils/scriptUpload.ts`, `/project/upload-script` | REPAIR (late) | Parse `[CLIP: AQ-xxxx ...]` into AQ refs; fix default episode and empty clip audio |
| `components/ScriptStudio.tsx` | REPLACE / REPAIR / REMOVE | Remove analysis, clip tag and refine leftovers; new `components/ScriptBoard.tsx` and `components/QuoteLibrary.tsx` instead of growing the 2,358 line file; unsaved changes guard; explain empty Send to Montage and Finish |
| `components/ScriptAudio.tsx` | REUSE | Rendered again |
| `utils/loudness.ts`, `renderCompiled` | REUSE | |

Legacy code is removed only after its replacement passes its phase, and nothing replaced is repaired first.

## 5. Phases

Every phase ends with: typecheck, existing vitest suite and build green; a small acceptance script run against saved data in `docs/experiments/` and the AQ corpus; your sign off in the app. One branch and commit per phase.

**Phase 0: safety (small)**
- Back up `.spacepipe-studio/` (it is gitignored, so git cannot restore it); unsaved changes guard; `/version` runs checks before moving head; stop approved passage pollution.
- Accept: backup verified byte for byte; existing projects open and save unchanged.

**Phase 1: evidence library, AQ import and Board (no model calls)**
- Library and board files; read only AQ adapter; locate all 283 quotes in their transcripts; text checks; corpus cut points as verified audio; links to existing WAVs; Board and Library views (filter by recording, speaker, category, target; star, exclude, note; play; confirm speaker); two projects referencing the same quote.
- Accept: all 283 visible with original metadata; the master file md5 (`3ff45f905a859d04779bc7578de2c96d`) and `public/clips/angela/` unchanged; every quote located or flagged unlocated with a reason; the 116 cut points preserved exactly; starring one quote in two projects stores it once; other projects' files unchanged.

**Phase 2: question first discovery and reading**
- Discovery from the question; read into the library; dedupe against library and AQ; rejected list with "use transcript wording" (code picks the exact matching span); context notes; read cache.
- Accept: on the exp1 recordings with a fresh scratch library, at least 9 of 11 on question AQ quotes found word for word (exp1 R2 level); with the real library, reading 20260908_1wxWjlrwXokJQ creates no duplicates of AQ-0261 to AQ-0268; a second read for the same question makes no call; 100% of stored quotes pass `verifyVerbatim`.

**Phase 3: audio alignment and review**
- Alignment job, review screen, quote clips.
- Accept: on the AQ quotes with corpus cut points in 20260908_1wxWjlrwXokJQ and 20260918_1AxRnZMeZNYxl (used only as a benchmark, never overwritten), every automatic `aligned` result is within 1.0 s of the corpus cut and the median is within 0.3 s; anything outside is `needs_review`; no tape item is longer than its quote; a `needs_review` quote cannot enter a final render; Script Studio no longer calls the trim path.

**Phase 4: outline, whole script draft, scene tools, voice**
- Accept: rerunning exp2's `board.json` and `outline.json` through the app gives one draft call, 100% verbatim, no raw labels, no duplicate quotes, original audio at least 30% in tape led mode, runtime within 15% of target; a scene rewrite changes only that scene's block ids; tape led and narration led modes produce visibly different tape shares; you judge the voice against Arm A.

**Phase 5: evidence checks and legacy removal**
- Code checks, evidence pairing, the evidence check call, checks panel; remove the replaced loop, judge, quality, clip tag and trim code with their tests.
- Accept: on the exp2 drafts the checks flag Arm A's six raw labels and Arm C's duplicate, pair Arm A's "He says so himself" with Speaker 4's tape and surface it, and raise no false attribution flags on lines verified correct in `docs/experiments/02_multispeaker_validation/REPORT.md`.

**Phase 6: audio production**
- Rough cut with placeholders, per sentence Vox, `AudioPanel` back with download, production lock, Montage hand off messages.
- Accept: a three scene script renders immediately with placeholders; editing one sentence regenerates one take; locked render measures -16 LUFS plus or minus 1; the lock refuses unreviewed tape audio and failed checks.

**Phase 7 (small, late): upload parser**
- Recognise `[CLIP: AQ-xxxx ...]` in uploaded scripts as AQ refs; fix the upload defaults.

## 6. Protecting existing work

- Additive only: new `library/`, `align-cache/` and `board.json` files; no existing file is rewritten or migrated.
- Projects without a board open and work as now; their saved clip blocks already store `inSec`/`outSec`, so removing the trim path does not change them.
- Transcripts, recordings, the AQ master, `public/clips/` and `docs/documentary/` are read only to this work.
- Old analysis caches stay on disk, unused.
- Backup before every phase that touches `.spacepipe-studio/`; one git branch per phase; uncommitted work in the tree is never staged, reset or stashed by this work.
- The running dev server is not restarted without asking. The three "ZZ AUDIT TEST" projects stay until you choose to delete them.

## Recommended first step

Phase 0, then Phase 1. Phase 1 needs no model calls, puts your 283 verified quotes and their cut points to work immediately, and fixes the library and board formats that every later phase builds on.
