# Experimental speaker-aware avatar benchmark

Measured locally on 2026-10-28 with FFmpeg 8.1.1, the deterministic mock adapter, five synthetic portraits, a 60-second AAC fixture, and the same stage-grid assembler used by the experimental worker.

| Metric | Full-length baseline model | Speaker-aware plan |
| --- | ---: | ---: |
| Participants / clip | 5 / 60 s | 5 / 60 s |
| AI footage requested | 300 s | 42.56 s including 0.12 s pre-roll and 0.16 s post-roll |
| Visible speaking time | n/a | 41.00 s |
| Inference segments | 5 full streams | 6 merged segments |
| End-to-end local job | not run with Wav2Lip | 14.92 s with mock adapter |
| Output | n/a | 640x640, 1,500 frames, 60.00 s |
| Audio stream hash | n/a | Preserved bit-for-bit through remux |

The benchmark demonstrates the planner and assembly reduction. It does not measure neural Wav2Lip throughput, GPU memory, or photorealism. Cloud Kaggle execution was not run in this environment, so the smart worker remains experimental until a real GPU run verifies checkpoint compatibility and visual quality.
