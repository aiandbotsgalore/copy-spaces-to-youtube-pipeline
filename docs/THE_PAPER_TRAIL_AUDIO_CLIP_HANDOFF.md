# THE PAPER TRAIL — archival audio retrieval and assembly handoff

## Task
Find or extract every archival audio clip required by the approved recording candidate and arrange the excerpts in exact manuscript playback order. **Logan confirms that all source recordings are already downloaded on his Windows computer. Work entirely from local files. Do NOT download recordings, use the X API, search the internet for the source audio, or ask Logan to manually find the files.** The audio may be located outside this repository, so search accessible local drives/folders as necessary. Some clips are already extracted; others may need precise trimming from full local recordings.

Do not rewrite the script or alter the approved introduction. Complete the work directly rather than returning a plan.

## Authoritative manuscript
`C:\Users\Logan\copy-spaces-to-youtube-pipeline\MasterPapertrai_RECORDING_CANDIDATE_20261111.md`

Read the whole manuscript. Follow every archival marker such as `[CLIP ...]`, `[NEW CANDIDATE CLIP ...]`, `[REPLACEMENT SOURCE ...]`, and `[ORIGINAL-AUDIO REPLACEMENT ...]`. Preserve the order of **playback in the manuscript**, including repeat uses and multiple excerpts under one cue. Original broadcast dates are not the assembly order. Keep written-message readings and testimony readings separate from genuine archival audio.

## Local search priority
1. Check already-cut recordings in `special_clips/` and `public/clips/`; match AQ IDs and quoted dialogue.
2. Check `best_saved_clips/` clip catalogs (including `Monkey_Island_clips.json`), `ACT1_CLIP_PREP_NOTES.md`, and `RECORDING_PACK_PROLOGUE_ACT1.md`.
3. Check `transcripts/`, `output_transcripts/`, and `public/transcripts/` for recording IDs, timestamps and transcript phrases.
4. Search other local audio archives and download folders on the computer, including outside the repository and on other accessible drives, using source ID, title, date and excerpt text as search keys. Reuse existing samples before cutting new ones.
5. When only a long original recording exists, extract its exact relevant audio passage locally. Approximate manuscript timestamps are search aids, not guaranteed cut points. Listen or compare surrounding transcript context rather than blindly cutting at a number.

## Deliverables
Create `papertrail_archival_audio_ordered/` in the repository (unless an existing project-specific output directory is clearly more suitable). Preserve all original source audio unchanged.
- Number files sequentially in **documentary order**: `001__...`, `002__...`, etc. When one manuscript cue contains several successive excerpts, order the sub-excerpts and name them unambiguously.
- Produce a CSV or JSON manifest mapping each placement to the manuscript cue, speaker(s), AQ/clip ID, original source recording, approximate and confirmed source time, local source path, output audio path, and status: existing / extracted / missing / needs audition.
- Produce a short report with found/extracted/missing counts and specific blockers only if something genuinely cannot be located.
- Keep excerpts as separate audio files that can be inserted between Logan's ElevenLabs narration takes. Do not replace any archival voice with AI and do not auto-build a continuous final episode without the narration.

## Specific handling
- Clip #130: Logan has already saved the correct audio sample. Find and use it as-is. Do not reopen the metadata dispute or change the locked introduction.
- Clip #056: accepted by Logan; locate and use.
- Clips #091/#092: locate the intended Deacon audio locally; reuse the already-cut correct version if it exists; otherwise extract the source passage.
- Monkey Island: find its local recording or existing excerpt using the named catalog and the quotation in the manuscript, including Angela's words about phone calls and a 'long line of destruction behind me for accountability'. Do not change its position because of a source date label.
- Do not mistake written chats and screenshots for original audio recordings.

Completion means all required archival insertions are playable in the correct documented order, or explicitly identified as genuinely missing after a local search. Do the work, don't just propose it.
