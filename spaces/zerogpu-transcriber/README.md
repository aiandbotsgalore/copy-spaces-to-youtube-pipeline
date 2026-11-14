---
title: SpacePipe ZeroGPU Transcriber
emoji: 🎙️
colorFrom: blue
colorTo: indigo
sdk: gradio
sdk_version: 5.20.0
app_file: app.py
short_description: SpacePipe faster-whisper + PyAnnote 3.1 ZeroGPU service
python_version: "3.12"
---

# SpacePipe ZeroGPU Transcriber & Re-Diarizer

Hugging Face ZeroGPU transcription and speaker diarization service for Twitter Spaces:
- **Speech-to-Text:** `faster-whisper` / `whisperx` with `large-v3-turbo`
- **Diarization:** PyAnnote Audio 3.1 (`pyannote/speaker-diarization-3.1`)
- **Biometric Profiles:** SpeechBrain ECAPA-TDNN (192-dim) with 1-to-1 bipartite matching
- **Endpoints:**
  - `/transcribe`: End-to-end cloud transcription and diarization
  - `/rediarize`: Re-diarize existing transcripts with zero text/timestamp mutation
