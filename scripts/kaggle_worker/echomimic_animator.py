#!/usr/bin/env python3
"""
scripts/kaggle_worker/echomimic_animator.py

Entry point kept for callers that still reach for this path. The worker that actually renders the
Spaces Live Stage is echomimic_pkg/echomimic_animator.py, because Kaggle receives that folder as its
kernel. This file used to be a separate EchoMimicV3 implementation with its own hardcoded "primary
speaker" highlight and no transcript timing, so the two had drifted apart. It now runs the packaged
worker, so there is exactly one implementation and no stale copy for a job to pick up.
"""

import runpy
from pathlib import Path

PACKAGED_WORKER = Path(__file__).resolve().parent / "echomimic_pkg" / "echomimic_animator.py"

if __name__ == "__main__":
    runpy.run_path(str(PACKAGED_WORKER), run_name="__main__")
