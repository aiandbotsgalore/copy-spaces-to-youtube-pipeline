# Speaker attribution repair status — November 17, 2026

## Established causes

- Current repository started at c011c18eb. The existing long single-cluster safeguard remains.
- November 16 local transcript: 614 turns labeled Angela. Original release transcript: 2,044 turns labeled Angela, faster-whisper-base, duration 7,819.050667 seconds.
- September 29 local transcript: 3,188 turns labeled Angela.
- Re-running the original conversational heuristic after restoring the generic input label reproduced {'Speaker 1': 'Angela'}.
- Run 43870115023 logged ten hf_token constructor errors and reported zero episodes processed without failing.
- Gradio client 2.7.2 uses token, not hf_token. The actual Space endpoint is reachable.
- ZeroGPU returned synthetic transcription/turns/embeddings on missing imports; chunk suffix matching mixed contexts.
- Transcript cleanup absorbed brief speakers and assigned host identities. Frontend inference also used host, roster ordering and self-introductions.
- The archive resolver treated lack of acoustic contradiction as sufficient for contextual auto-approval.
- The previous integrity hash ignored segment text when word data existed and rounded timings.

## Changes implemented

- Removed contextual automatic naming from the production resolver, legacy index mapper and frontend.
- Disabled duration-based speaker absorption during index cleanup; preserve segment metadata, raw IDs, wording and timings.
- Explicitly mark Faster-Whisper output as not diarized instead of assigning fabricated speaker confidence.
- Require identity-verified, model-compatible voice profiles for automatic matching. Existing legacy profiles are not silently grandfathered as verified.
- Scope chunk IDs and reconcile with complete-link acoustic similarity and a same-chunk cannot-link constraint; reuse in Modal.
- Preserve generic raw labels and provenance. Mark mixed segments as Multiple speakers and uncovered speech as Unknown.
- Reject missing dependencies rather than returning synthetic evidence.
- Adapt client authentication to installed signature and restore missing release upload helper.
- Validate actual returned text/timing data, reject empty output and previews, stage local artifacts before replacement, preserve metadata and original backups, and checkpoint only after persistence.
- Report batch failures with exit 1 and rate limits with exit 75. Dry runs do not checkpoint.
- Human corrections outrank automatic candidates; unchecked enrollment cannot overwrite an identity-verified reference.
- Disabled the live batch_rediarize.yml workflow; its working-copy schedule is also removed pending validation.

## Validation

44 focused Python tests passed on the Windows project. TypeScript tsc --noEmit and git diff --check passed.

The tests cover swapped chunk IDs, missing/invalid profiles, ambiguous matches, human precedence, contextual misnaming, preservation, forged hashes, failed writes, batch status, constructor compatibility, and dependency failures. They use controlled fixtures and do not certify real-world diarization accuracy.

ZeroGPU changes deployed at Hugging Face commit af6c499db6178610c53b47d7abe3f16fe3499a53.

Real source-audio previews completed:
- First 180 seconds: one cluster, 34 turns.
- First 300 seconds: two clusters, 83 turns; 27 original application segments retained with exact text/timings. Segment labels: 14 Speaker 1, 5 Speaker 2, 7 Multiple speakers, 1 Unknown.
- Cosine similarity between the two five-minute cluster centroids: 0.12116954094003346. This is a measured acoustic separation, not a probability or verified identity.
- No named profiles were submitted. No named identity was established.

## Historical repair and remaining limits

Neither complete historical episode has been repaired or relabeled. Both application JSON files remain byte-identical to their backups. Full-episode processing was not started because preview boundaries and identities have not been independently checked against trustworthy reference audio. An API success and separated centroids alone do not establish correct attribution.

Angela's legacy profile lists five samples with no identity-verification provenance. Two automatically named Angela sample WAV files were found locally. No Lana profile or Lana-named local sample was located in the inspected project/sample directories. No profile was enrolled or marked verified.

46 long single-label episodes were flagged for review, including 19 bearing person names and two labeled Angela. These are candidates, not confirmed corruption.

Backups and preview evidence are under .cache/rediarize_backups/:
- validation-20261117/: original application JSON files, original release JSON/SRT/TXT and embedding asset, sample-result.json and sample-result-300.json
- deployed-space-before-repair/: prior cloud source
- suspicious-single-cluster.json: prioritized candidates
The release embedding asset is 384-dimensional transcript data, not an ECAPA voice reference.

Repository changes are local and uncommitted; they have not been pushed to GitHub. The cloud Space changes are deployed, and the historical workflow is disabled remotely. The Modal source change has not been deployed or run. No paid GPU job or new subscription was started.
