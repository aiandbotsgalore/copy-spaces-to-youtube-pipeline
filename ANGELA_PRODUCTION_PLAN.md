# THE PAPER TRAIL: MASTER PRODUCTION & ENGINEERING PLAN
### An Investigative Audio Special on Angela Maggard
**Lead Investigator & Executive Producer:** Logan Black  
**Editorial Architecture:** 13-Phase Quote-First Evidentiary Order  
**Audio Standards:** 24-bit / 48 kHz Master | -16.0 LUFS Integrated Distribution Target | -1.0 dBTP Ceiling  
**Runtime:** Organic (Determined by story completeness, pacing, and evidentiary rigor; target < 60 mins)  
**Governing Rule:** IF ANGELA CAN SAY IT HERSELF, LOGAN SHOULD GENERALLY NOT SAY IT FOR HER.

---

## 1. Technical Standards & Audio Engineering Specifications

### 1.1 Loudness & Headroom Architecture
- **Distribution Format Target:** **-16.0 LUFS integrated** ($\pm 0.5$ LUFS) across the completed stereo master.
  - *Engineering Note:* -16.0 LUFS is the standard for commercial podcast and spoken-word digital streaming (Apple Podcasts, Spotify, YouTube). It is **not** the EBU R128 broadcast reference level (which is **-23.0 LUFS**). We adhere to -16 LUFS for modern online listening environments while preserving dynamic range.
- **Maximum True Peak:** **-1.0 dBTP** to prevent inter-sample clipping and distortion during lossy MP3/AAC transcoding.
- **Tracking Headroom:** Host voiceover must be tracked with peaks between -12 dBFS and -6 dBFS (RMS approximately -20 dBFS to -18 dBFS) to ensure zero pre-amp clipping and ample mixing headroom. (Note: LUFS and RMS are distinct metrics and are never conflated).
- **Loudness Range (LRA):** Target 7.0 to 10.0 LU. Preserves the natural acoustic contrast between intimate archival dialogue and high-energy Space exchanges.

### 1.2 Sound Design & Acoustic Philosophy
- **Anti-Melodrama Mandate:** Score strictly to support intelligibility, pacing, and temporal transitions. Zero generic "true crime trailer" tropes. No constant sub-bass drones or manufactured stingers designed to tell the listener how to feel about disputed claims.
- **Dynamic Silence as an Investigative Tool:** Major contradictions, admissions, and witness testimony must land **completely dry**, followed by 2 to 4 seconds of natural room tone or silence. Silence forces the evidentiary weight to register.
- **Dynamic, Non-Rigid Music Ducking:** Music bus attenuation is **never automated to a universal formula** (such as "-14 dB ducking"). Ducking depth, attack, and release must be tuned **by ear on a scene-by-scene basis** depending on the vocal frequency balance, intelligibility requirements, and dramatic stillness of each moment.

---

## 2. The 13-Phase Investigative Production Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                 13-PHASE MASTER WORKFLOW                                │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  PHASE 1: Source & Quote Audit (Comprehensive review of 283-quote database by function)  │
│                                            ▼                                            │
│  PHASE 2: Factual Timeline (Neutral, source-backed chronological timeline)              │
│                                            ▼                                            │
│  PHASE 3: Quote-Driven Story Map (Scenes built around primary audio blocks)             │
│                                            ▼                                            │
│  PHASE 4: Contradiction & Callback Map (Side-by-side pre- vs post-fallout matrix)       │
│                                            ▼                                            │
│  PHASE 5: Evidence Stress Test (8-point forensic audit of all allegations & gaps)       │
│                                            ▼                                            │
│  PHASE 6: Natural Structure & Runtime (Organically determining scenes and duration)     │
│                                            ▼                                            │
│  PHASE 7: Write the Narration (Restrained, conversational Logan connective voice)       │
│                                            ▼                                            │
│  PHASE 8: Final Production Cue Sheet (Comprehensive timecode markers & cut windows)     │
│                                            ▼                                            │
│  PHASE 9: Audio Extraction & Restoration (Dynamic FFmpeg extraction; gentle conditioning)│
│                                            ▼                                            │
│  PHASE 10: Narration Recording & DAW Assembly (Voice tracking; primary audio assembly)   │
│                                            ▼                                            │
│  PHASE 11: Sound Design & Dynamic Mix (Scoring only what survives dry; ear-tuned mix)  │
│                                            ▼                                            │
│  PHASE 12: Final Fact Check & Verification Audit (Zero misattributions or drift)        │
│                                            ▼                                            │
│  PHASE 13: Mastering & Packaging (24-bit WAV master, 320k MP3, chapters, web player)   │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Detailed Phase Execution Protocols

### Phase 1: Source & Quote Audit
- **Objective:** Screen the entire 283-quote master database (`AQ-0001` through `AQ-0283`) across 35 recorded episodes.
- **Execution:** Categorize quotes by the 22 core narrative functions defined in `ANGELA_QUOTE_FUNCTION_MAP.md`. Prioritize primary Angela audio over secondary commentary. Verify speaker attribution confidence for all candidate audio.

### Phase 2: Factual Timeline Construction
- **Objective:** Establish the undisputed sequence of events independent of personal narratives.
- **Execution:** Populate `ANGELA_NEUTRAL_TIMELINE.md`, rigorously classifying every data point as `[FACT]`, `[ANGELA CLAIM]`, `[LOGAN CLAIM]`, `[SAV CLAIM]`, `[WITNESS TESTIMONY]`, `[INFERENCE]`, or `[UNKNOWN]`.

### Phase 3: Quote-Driven Story Mapping
- **Objective:** Construct the narrative from primary archival blocks.
- **Execution:** For every sequence, evaluate whether Angela can establish the point in her own words. Arrange multi-clip archival suites where Angela speaks for 30 to 90+ seconds uninterrupted.

### Phase 4: Contradiction & Callback Matrix
- **Objective:** Pair earlier ethical standards with later actions.
- **Execution:** Update and maintain `ANGELA_CONTRADICTION_CALLBACK_MATRIX.md`. Pair statements directly (e.g., February's "modern day male witch hunt" against September's "I called you a predator"). Plan silent edits for each pairing.

### Phase 5: Evidence Stress Testing & Gap Analysis
- **Objective:** Subject every major allegation and claim to an 8-point evidentiary stress test.
- **Execution:** Execute `ANGELA_EVIDENTIARY_GAP_ANALYSIS.md`. Downgrade or excise any claim lacking primary documentation or firsthand corroboration.

### Phase 6: Natural Structure & Runtime Consolidation
- **Objective:** Allow the program length to emerge organically from the verified scenes.
- **Execution:** Finalize scene boundaries in `ANGELA_SPECIAL_BEAT_SHEET.md`. Confirm that pacing is brisk, repetitive clips are pruned, and the presentation flows naturally without rushing or dragging.

### Phase 7: Spoken Narration Scripting
- **Objective:** Draft Logan's spoken connective bridges strictly around the ten authorized narration functions.
- **Execution:** Narration must sound natural, calm, and conversational. Ban AI-generated clichés, rhetorical flourishes, and melodramatic posturing.

### Phase 8: Definitive Production Cue Sheet
- **Objective:** Generate a flexible, non-capped cue sheet mapping every archival cut to its source file, timecode window, and duration.
- **Execution:** Maintain `ANGELA_AUDIO_CUE_SHEET.md` with dynamic indexing.

### Phase 9: Audio Extraction & Conditioning
- **Objective:** Extract lossless 24-bit / 48 kHz production WAV clips from source audio.
- **Execution:** Utilize the refactored `scripts/cut_special_clips.py` CLI tool. Apply gentle dialogue conditioning:
  1. *High-Pass Filter:* 18 dB/octave slope at 75 Hz (eliminates handling noise and sub-bass rumble).
  2. *Spectral Noise Suppression:* Gentle -4 dB to -6 dB dialogue isolate to attenuate severe mobile room hiss without introducing phase chirping.
  3. *De-Essing:* Targeted reduction between 5.5 kHz and 7.5 kHz on harsh sibilance.
  4. *Leveling:* Consistent conversational dialogue leveling.

### Phase 10: Narration Recording & DAW Assembly
- **Objective:** Track Logan's voiceover in a clean studio environment and assemble the multi-track timeline.
- **Execution:** Import extracted WAVs into DAW tracks organized by speaker:
  - Track 1: Logan Narration (VO)
  - Track 2: Angela Archival Speech
  - Track 3: Witness Statements (Sav, Sian, Glow Baby, Timmy)
  - Track 4: Dialogue Ambience / Room Tone
  - Track 5: Minimal Music Beds
  - Track 6: Structural Foley & Sound Design

### Phase 11: Dynamic Mix & Sound Design
- **Objective:** Finalize the mix balance by ear.
- **Execution:** Audit the presentation with all music muted. Verify that the spoken narrative holds complete attention on its own. Re-introduce sparse score beds only where they assist temporal transitions. Adjust music ducking by ear on a scene-by-scene basis.

### Phase 12: Final Evidentiary Verification Audit
- **Objective:** Conduct a line-by-line verification check against the master timeline.
- **Execution:** Confirm that every clip matches its verified transcript, that no context was distorted, that the Sav address relay matches Section 1.1 facts, that deleted quote `AQ-0276` is absent, and that loudness meters confirm -16.0 LUFS integrated and -1.0 dBTP ceiling.

### Phase 13: Mastering & Packaging
- **Objective:** Render distribution masters across all release vectors.
- **Execution:**
  - *Vector A:* 24-bit / 48 kHz Stereo WAV Master Archive.
  - *Vector B:* 320 kbps Constant Bitrate (CBR) MP3 with embedded ID3v2.4 chapter markers.
  - *Vector C:* Companion video rendered via FFmpeg featuring waveform visualizer and verbatim text overlays.
  - *Vector D:* Interactive Web Player embedded in the SpacePipe Gen application on port 5000.
