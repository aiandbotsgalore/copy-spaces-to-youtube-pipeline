# Experiment 01: initial validation (2026-10-28)

Two small tests, run against a scratch copy of the data with the app's own engine code (no app source or data changed). Model: Sonnet via the Claude subscription CLI for every arm.

## Retrieval: existing analysis (R1) vs question first extraction (R2)

Recordings: 20260908_1wxWjlrwXokJQ, 20260908_1nGeLMjONkAKX, 20260913_1lJQRWAWpvVxE, 20260903_1dKrPrbywDkJX. Reference: the 20 verified AQ quotes in those recordings (`reference.json`).

| | R1 existing analysis | R2 question first |
|---|---|---|
| Logan quotes found word for word (of 11) | 5 | 9 |
| Same, right transcript line only | 9 | 10 |
| All 20 quotes, word for word | 7 | 14 |
| Average quote length | 8 to 16 words | 35 to 38 words |
| Calls | 4 | 4 |

9 of the 20 corpus quotes are not about Logan (1dKr is about other people), so they measure general coverage, not the question.

## Drafting: three scenes from 20260908_1wxWjlrwXokJQ

| | A existing segmented | B whole script | C hybrid |
|---|---|---|---|
| Calls / time | 6 / 195 s | 1 / 102 s | 2 / 162 s |
| Tape blocks | 6 | 12 | 12 |
| Original audio share | 16% | 38% | 35% |
| Estimated runtime (target 300 s) | 441 s | 393 s | 373 s |
| Invented facts (manual check) | 0 | 0 | 0 |

The blind Codex judge (`judge_1.json`, `judge_2.json`) was not usable: its ranking followed presentation order.

## Bug found

The trim resolver removes at most 35% of a clip automatically (`utils/trimResolver.ts`), and the fallback in `utils/scriptGates.ts` swaps in the whole segment. Every short transcript excerpt became the full segment (C: 131 s intended, 2,670 s resolved). Tape was scored from intended excerpts (`raw_calls.jsonl`, `raw` fields).

## Files

`*_readable.md` drafts, `report.json` metrics, `R1_analysis.json` and `R2_question_first.json` retrieval outputs, `calls.jsonl` and `engine_calls.jsonl` call timings, `harness/` scripts (they expect a `root/` folder holding copies of the transcripts, memory.json and style-card.json).
