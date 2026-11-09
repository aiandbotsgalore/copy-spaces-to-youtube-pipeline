# SpacePipe Studio — Narrative Intelligence Roadmap

**Status:** Proposed implementation plan. The goals and direction are agreed; these implementation details are not yet implemented or verified.  
**Project:** THE PAPER TRAIL / SpacePipe Studio (personal, single-user)  
**Scope:** Investigative story discovery → narrative architecture → full-script drafting → editorial revision → audio-first evaluation → evidence-grounded documentary.  
**Out of scope:** Phase 5.2 legacy retirement; an unrelated new app, framework or database; automatic claims of historical truth; mandatory episode runtimes; coding-agent prompts; automatic Git changes.

## North star

Given an investigative question and accessible recordings/research, Script Studio should discover the strongest **evidence-supported** story, articulate what is known and disputed, select a deliberate narrative arc, write narration for the ear with canonical tape references, critique and improve the complete script, and help assemble an audio rough cut. It should require as little manual rewriting as possible, while leaving final editorial judgment with the user.

A valid output can be nuanced, unresolved, quiet, funny, uncomfortable or critical of the narrator. Interesting is not synonymous with sensational. The system must not invent discoveries, quotations, sources, motivations, chronology or speaker identities to make a story dramatic.

## What already exists (verified in current checkout)

- BM25-style question-led recording discovery via `server/scriptSearch.ts`; source reading and the project Evidence Board / shared quote library.
- Evidence-grounded outline and whole-script drafting via `server/scriptEngine.ts` and `server/scriptPrompts.ts`, with output-size fallback into multiple acts.
- Canonical archival quote and audio references, Phase 5.1 evidence pairing, optional semantic review, script gates, and promotion protection.
- Per-scene rewriting, scene critiques, a whole-episode structural pass, spoken-audio checks, Vox narration takes, compile/render/Montage paths.
- Existing Phase 0–5 acceptance tests, plus Experiment 02 (Arm A scene-by-scene, Arm C whole-script).

**Current constraints to improve:** The outline principally specifies titles/purposes/clip IDs; the episode critique sees only scene title/purpose/first/last lines; whole-draft and rewrite budgeting use an equal per-scene allocation and `targetRuntimeSec || 900` fallback. These are implementation observations, not a recommendation to remove useful pacing guidance entirely.

**Worktree safeguard:** Phase 5.1 changes are currently uncommitted. Preserve them and their test baseline. Do not alter branches, commit, stash, reset or push as part of this roadmap.

## Phase 0 — Establish a real editorial baseline (small prerequisite)

**Deliverable:** A repeatable local comparison fixture and review sheet, not a new feature.

- Preserve current Experiment 02 Arm A/Arm C scripts and findings as frozen reference material. Record their known factual/attribution faults; neither is a gold-standard truth source.
- Run or capture a current Script Studio output from the same available evidence, plus one different investigation if practical. Save outputs and model/cost metadata; do not overwrite existing candidates.
- Use a compact human-interpretable **story scorecard**, not an invented universal AI quality score: central question, key turning points, dramatic progression, distinct human perspectives, support and counterevidence, listener clarity, natural spoken narration, quality of tape placement, amount of corrective rewriting, and length/pacing. Explicitly distinguish subjective judgments from technical failures.
- Verify the local Node tests, Phase 5.1 source checks and known real-audio benchmark dependency status. Do not make fixing an unrelated Python installation a precondition of story-design work.

**Exit gate:** We have a real baseline and a way to compare output quality. No major user-facing behavior changes.

## Phase 1 — Investigative Story Discovery

**Deliverable:** An editable, source-linked **Story Brief**, using existing project storage and the Evidence Board.

Extend the existing question → BM25 candidate recording → selective read flow. For a project, produce:

1. **Central investigative question**, with subsidiary questions worth answering.
2. **Established timeline** of significant statements/events, each linked to recording/utterance/quote or documentary source.
3. **People and perspectives**: what each source says, what is independently corroborated, possible incentives and conflicts. Motive speculation stays explicitly labelled as interpretation.
4. **Turning-point candidates**: overlooked statements, contradicting accounts, reversals, omissions, changed accounts, consequential silences, and counterevidence.
5. **Story candidates**: one recommended narrative throughline and, only when materially different, one credible alternate. Each includes its audience hook, what evidence makes it viable, uncertainties, and major risk of overstating the material.
6. **Research gaps**: questions that cannot be answered from the available archive, never fabricated as resolved.

**Implementation approach:** Reuse `scriptSearch`, `readRecording`, quote library and `EvidenceBoard`. Add a modest optional Story Brief record under the existing per-project storage convention; avoid a second knowledge database. Support bounded, targeted follow-up queries across the archive when BM25 alone misses paraphrases or connections. Reuse already-read transcripts/verified quotations and cache by the question plus source/transcript revisions. No mandatory archive-wide AI reread.

**Exit gate:** Every asserted discovery resolves to evidence or is explicitly marked hypothesis/unresolved; at least one overlooked or cross-source insight can be surfaced when supported by a fixture, without hallucinating one when absent. Search ranking does not stand in for editorial importance.

## Phase 2 — Narrative Architecture Before Drafting

**Deliverable:** A richer, editable **Narrative Blueprint** (an extension of the existing outline, not a parallel workflow).

For each scene, carry a compact editorial beat:
- What the listener believes or wonders **before** this scene.
- The investigative question this scene asks.
- The person, event or archival moment that makes it concrete.
- The tape/document refs supporting the reveal and the strongest complication/counterevidence.
- **What changes** in the listener's understanding by the end.
- What question, emotional consequence or setup pulls us into the next scene; and whether it eventually pays off.
- Whether the scene is essential, redundant, or awaiting stronger evidence.

An episode-level pass checks the sequence for escalation, clarity, fairness, surprises that are **earned**, unresolved threads, repetitive setup, and a satisfying conclusion even if the mystery remains unsolved. It should preserve ambiguity and human complexity instead of forcing a five-act formula or manufactured twist.

**Implementation approach:** Extend the existing `outlinePrompt` / typed outline response and reuse the scene IDs, Board refs and editor. Keep the UI light: the current Outline/Board screen can show an optional Story Brief and beat notes. Allow editorial reordering without losing canonical quote links. Preserve backward compatibility for projects with old scene formats.

**Exit gate:** Every included scene has a distinct narrative function and source connection, setups can be matched to later payoffs or intentionally open questions, and one removal/reorder test shows that the blueprint can detect and repair a redundant or badly placed scene. No unsupported invented beat is accepted.

## Phase 3 — Whole-Document Drafting for the Ear

**Deliverable:** A compelling first draft that follows the approved blueprint while letting the source material determine length and pacing.

- Keep **whole-script drafting as the preferred path** when the model's safe output budget permits. For longer stories, use the existing controlled multi-act fallback but pass a compact global Story Brief, blueprint and continuity ledger through every act. Verify all intended scenes are returned and context is not silently dropped.
- Improve the existing writing rules: dialogue-like narration, specific scenes, character complexity, purposeful silence, meaningful archival tape, honest transitions, restraint in exposition, and no repetitive AI-sounding suspense cues or formulaic endings.
- Use the deliberate investigative quality we appreciated in Experiment 02 Arm A as an **editorial reference**, and Arm C's whole-story visibility as a workflow advantage. Do not treat either sample as factually correct.
- Canonical tape words and approved audio boundaries remain deterministic; source names are not inferred from diarization labels; the Phase 5.1 Checks Panel remains authoritative for technical defects.
- **Length policy:** No arbitrary required episode runtime. An optional runtime target may guide planning; it must be advisory, with naturally variable scene lengths based on evidence and dramatic need. Replace the unconditional 900-second fallback and equal per-scene budget with scene-specific estimates and optional target guidance, while preserving older project data.
- Reuse approved voice passages and existing style-card support; no new voice-cloning system.

**Exit gate:** Full scene coverage, no invented/modified archival quotations, no automatic promotion of a script with hard gate failures, distinct scene rhythms, demonstrably different tape-led and narration-led treatments when requested, and a draft that does not mechanically expand or compress to fit an unspecified time.

## Phase 4 — Whole-Episode Documentary Editor

**Deliverable:** An **editorial memo + minimal-change revisions**, integrated into the existing critique/refine flow.

The current episode critique inspects scene titles and only first/last lines. Replace that restricted view with sufficient **actual complete narration, tape text, evidence references and scene transitions** to evaluate:

- Whether the central question remains alive and understandable.
- Where the listener gets lost, bored, rushed, or misled.
- Whether each reveal is earned and counterevidence handled fairly.
- Repetition, missing context, premature explanations and inconsistent character treatment.
- Setup/payoff, ending, natural spoken rhythm, timing around archival tape and silence.

On a script too large for one model call, use per-act analyses **plus a global continuity summary**, not a misleading declaration that a truncated script was fully reviewed. Prioritize a handful of consequential changes; give the reason and projected listener effect for each. One optional spoken pass uses the existing `spokenSceneView` and measured Vox takes when available, clearly labeling word-count estimates.

Apply **targeted** scene revisions that preserve unchanged scenes and locked blocks. Re-run affected evidence checks, then assess whether the edit improved its stated weakness without introducing unsupported claims, broken scene bridges or new repetition. Keep alternate drafts as candidates. Avoid automated endless critique → rewrite loops: initially one editorial pass and one targeted correction pass, with additional work only when supported by a concrete remaining problem.

**Exit gate:** The editor catches seeded structural defects that a first-line/last-line summary misses; revisions preserve untouched scenes and canonical tape, maintain provenance and improve specific weaknesses. Factual and stylistic judgments remain separately labeled.

## Phase 5 — Hear It, Judge It, Improve It

**Deliverable:** A usable, economical **audio rough-cut review** and an evidence-based comparative demonstration.

Reuse `scriptAudioService`, cached Vox takes, `scriptCompile`, Montage and current render paths. Prefer a quick scratch narration/tape sequence before production mastering; use existing Vox/take cache where viable and a clearly labelled draft playback mechanism otherwise. Do not play unverified tape or bypass audio-review restrictions. Account for actual speech and tape durations when available rather than trusting fixed words-per-minute estimates.

Present a short set of actionable listening notes: inaudible/awkward transitions, long unbroken exposition, repeated musical cues, rushed reveals, excessive narration over strong tape, and scenes that need space. Avoid auto-applying sound design or sentimental musical prescriptions.

**Real-world acceptance:** On the frozen Experiment 02 material and at least one different investigation:
- Produce a complete, traceable narrative from central question through documentary draft.
- Show a defensible narrative progression, including contradiction/counterevidence where supported.
- Compare against the previous Script Studio output and Arm A/Arm C **without claiming a statistical quality victory from one recording**.
- Track substantive editorial corrections, unsupported claims, narration rewriting required and listener-facing pacing issues.
- Confirm the final technical gates pass, model-cost records are available, and the user can audition the rough cut.
- Final creative sign-off belongs to the user; a successful automated test alone cannot establish that an episode is emotionally compelling.

**Exit gate:** Demonstrate a noticeable, documented improvement to story coherence and spoken experience without new attribution errors, fabrication or excessive manual structural rewriting. If there is no compelling improvement, revisit the relevant earlier phase instead of adding new complexity.

## Implementation sequencing and rules

1. Phase 0 baseline; then Phases 1 → 2 → 3 → 4 → 5, each one built on current code. Do not launch all phases as one enormous Gemini prompt.
2. The local AI coordinator may delegate bounded changes, obtain independent code reviews, run checks and correct defects without asking the user to adjudicate engineering details. The orchestrator's current headless Gemini CLI has stalled on oversized tasks; use small agent-sized increments and a working executor fallback instead of treating CLI stalls as success.
3. At each change: inspect current code; keep all existing data and source archives intact; preserve uncommitted user work and Git history; run typecheck, relevant unit/integration/acceptance tests and build. Check real outputs, not only an agent's summary.
4. Use the existing model roles, budgets and provider registry. Prefer deterministic retrieval/gates, cached transcript reads, one purposeful model call per major editorial operation, and selective revisions; show estimated/spent costs where supported.
5. Keep current Phase 5.1 verification protections. Keep Phase 5.2 legacy retirement deferred until specifically authorized, and never delete active paths merely because a newer one exists.
6. **No fabricated certainty:** Source assertions, speaker identities and quoted words require verification. Narrative hypotheses, editorial possibilities and disputed interpretations are clearly marked. No automatic final publication.

## The final user experience to aim for

**Ask a question → Discover the most promising evidence → Review a concise Story Brief → Get a narrative outline → Generate the whole documentary → Receive a meaningful editorial critique → Improve weak scenes → Listen to a rough cut → Approve the documentary.**

Default to making progress autonomously with existing source selections and engineering settings. Bring choices back to the user for consequential editorial decisions, not for repeated implementation plans. The measure of success is **a documentary worth hearing**, not the number of features, API calls or automated scores.
