#!/usr/bin/env python3
"""
scripts/spacepipe_transcribe_core.py

Re-export shim pointing to the canonical core module at
spaces/zerogpu-transcriber/spacepipe_transcribe_core.py.

Because 'spaces/zerogpu-transcriber' contains a hyphen (-), it cannot be imported
via dotted notation, and self-named imports in scripts/ can cause circular resolution.
Using importlib.util.spec_from_file_location directly loads and re-exports all
symbols cleanly.
"""

import sys
import importlib.util
from pathlib import Path

_canonical_path = Path(__file__).resolve().parents[1] / "spaces" / "zerogpu-transcriber" / "spacepipe_transcribe_core.py"
_spec = importlib.util.spec_from_file_location("spacepipe_transcribe_core_canonical", str(_canonical_path))
if _spec is None or _spec.loader is None:
    raise ImportError(f"Could not load canonical core from {_canonical_path}")

_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)

# Export all public symbols to module namespace
for _k, _v in _mod.__dict__.items():
    if not _k.startswith("_"):
        globals()[_k] = _v
