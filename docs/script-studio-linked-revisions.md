# Linked narration revisions

## Changed files

- `utils/scriptTypes.ts`: optional exact narration targets and linked decision metadata.
- `utils/scriptLinkedEdits.ts`: target validation, atomic reconstruction and story context views.
- `utils/scriptGates.ts`: anonymous review views retain quote-reading attribution, cues and headings.
- `server/scriptPrompts.ts`: linked critique/revision contracts and combined review prompts.
- `server/scriptEngine.ts`: normal refinement wiring, evidence conversion, gates, fact-check and blind judgement.
- `server/scriptStudioMiddleware.ts`: prevent linked promotion over divergent manual work.
- `components/ScriptStudio.tsx`: linked critique and candidate labels in existing review controls.
- `utils/__tests__/scriptLinkedEdits.test.ts`: deterministic and HTTP regression coverage.
- `utils/__tests__/helpers/fakeCli.ts`: recognize linked revision responses.
- `utils/__tests__/scriptStyle.test.ts` and `utils/__tests__/scriptAudioApi.test.ts`: updated critique prompt-version expectations.
- `docs/script-studio-linked-revisions.md`: contract, limits and verification record.

## Contract and state

The existing scene-round critic may optionally identify one issue with 2–8 exact narration targets spanning at least two scenes. The primary scene remains `targetId`; `linkedTargets` adds scene/block IDs and current source text. Exact excerpts from the bounded story context are expanded to the full current block text before saving the critique. Every target must be editable narration within the run's selected scenes. Quote reads, headings, tape, cues and locked blocks are protected.

The reviser receives the baseline version ID, all required targets, complete affected scenes, their neighbours, the episode outline and existing evidence/style inputs. It returns one group naming that baseline and every exact target once, with replacement narration and evidence claims. The group cannot add, remove, move or modify any other block. Each target must materially change. A stale baseline, duplicate, missing, extra, unchanged or protected target rejects the entire group before persistence.

State remains: critique → one revision → deterministic gates → fact-check every changed narration block in story context → blind judgement of the reconstructed scenes in both orders → one saved candidate. An empty evidence list cannot bypass fact-checking; each index needs exactly one verdict. One best-version pointer advances only on a group win. Project head promotion, rejection, diff and rollback use existing version controls. Accepting a linked candidate cannot overwrite a divergent manual edit; earlier wins in the same ancestry remain promotable. Provider failures pause/cancel/budget-stop through existing run handling; incomplete groups never partially advance. Resume re-critiques the saved best baseline.

## Compatibility and limits

`Critique.linkedTargets` and `RefinementDecision.linkedIssue` are optional. Old saved runs and single-scene responses retain their current path. Spoken-only critique remains single-scene. The episode reorder pass and provider roles do not change. Linked issue discovery reuses existing critic calls and a bounded set of exact narration previews across eligible scenes; it is not a new whole-manuscript review. Judges and fact-checkers see complete affected scenes plus immediate neighbours and an outline, not every intervening block. No live inference or authoritative manuscript edit is required to verify this feature.

## Verification

Use deterministic target/group tests plus the real `/refine`, `/run`, `/decide` and head/rollback HTTP entry points with injected fake CLI responses. Cover a linked setup/payoff across segments, whole-group rejection, evidence failure, scope/lock/quote-read protection, stale and incomplete responses, provider pause/resume, and existing single-scene and episode-pass behavior. Run TypeScript checking and a production build.

Verified locally: 147 tests across the linked-edit, studio, gates, multi-recording, audio, save checks, handoff, quality, style and audio API suites; `npm run typecheck`; `npm run build`. Tests use temporary projects and injected CLI responses, with no live inference. The build reports dependency annotation and bundle-size warnings. A worktree-local `node_modules` junction reuses the existing checkout's installed dependencies. This implementation-stage verification made no authoritative manuscript edits or deployment; subsequent integration is recorded in Git history.

Next manual verification, when a live run is explicitly authorized: use a disposable project copy, select two scenes with a setup/payoff issue, run Refine, inspect the combined diff and both judge orders, accept the candidate and restore the prior version from history. Real model editorial quality and browser interaction remain unverified.
