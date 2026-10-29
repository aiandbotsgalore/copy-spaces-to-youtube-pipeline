# Experiment 02: segmented vs whole script drafting, multi speaker (2026-10-28)

Recording 20260918_1AxRnZMeZNYxl (3.4 hours, 12 speaker labels). One evidence board (`board.json`, 36 of 37 quotes verified) and one three scene outline (`outline.json`) were built once and fed identically to both arms, with the same evidence text, clips, the app's draft prompt and Sonnet. A drafted one scene per call; C drafted all three in one call. No LLM judge.

| | A segmented | C whole script |
|---|---|---|
| Calls / time (plus 2 shared calls, 144 s) | 3 / 113 s | 1 / 72 s |
| Tape blocks | 15 | 15 |
| Original audio share | 30% | 36% |
| Verbatim: tape / narrated quotes / claims | 15/15, 2/2, 13/13 | 15/15, 5/5, 7/7 |
| Speaker attribution errors | 1 confirmed by content | 1 probable (see below) |
| Duplicate quotations | 0 | 1 minor (4 words) |
| Cross scene contradictions | 0 | 0 |
| Continuity errors | 1 repeated setup | 1 minor wording inconsistency |
| Raw labels read out ("Speaker 1") | 6 | 0 |
| Estimated runtime (target 300 s) | 385 s | 316 s |

## Corrections to the first report

The automated checker's attribution flags were all false positives. The two attribution entries in the table came from manual reading and were reported as "verified". On review:

- **A, scene 3: confirmed by content.** The narration says Logan only read a transcript, ends "He says so himself.", then plays u659 ("You're being libeled, uh, in public. You can sue her..."). That line gives advice to someone being libeled; whoever spoke it, it is not Logan saying he read a transcript. The error does not depend on speaker labels. It also repeats a point scene 1 already made with Logan's own tape (u698).
- **C, scene 1: probable, not proven.** C introduces u5 ("private screenshots being paraded as public evidence") as "another unidentified speaker" after the u13 tape. Matching "Speaker 1" labels prove nothing on their own, but the content does: u4 Logan asks "what's on your mind there, Snuggles?", u5 answers, and u8, u10 and u13 continue the same back and forth with Logan in the same voice. u29 and u30 describe this speaker's context window and token cost, so Speaker 1 appears to be an AI persona. Same speaker is very likely, not certain.
- **Both drafts (shared issue):** the scene 1 allegation about photos (u13) comes from that apparent AI persona summarising material Logan gave it, and both drafts present it as an unidentified person's account.

## The rejected board quote

u732, labelled Speaker 8: "...appointment with my attorney today for Orr and Logan and Sav because of all that shot..." The transcript says "shit"; the model changed one word, so the app's verbatim check rejected it. It was left off the board given to the drafts, and neither draft uses it (no mention of the attorney, appointment or triangulation). The board itself noted it may be a played clip of Angela. The same Speaker 8 label also covers u734 and u684, which illustrates that one label can cover more than one voice.

## Files

`A_readable.md`, `C_readable.md` drafts; `report.json` metrics; `A.json`, `C.json` full outputs; `calls.jsonl` timings; `harness/` scripts (they expect a `root/` folder holding copies of the transcript, memory.json and style-card.json).
