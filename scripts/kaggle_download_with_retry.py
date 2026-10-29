#!/usr/bin/env python3
"""Download and validate Kaggle kernel output with bounded exponential retry.

Kaggle occasionally returns transient 502/503 responses while listing or
downloading output files. This helper keeps the workflow honest: it retries
transient failures, validates JSON and MP4 artifacts, then atomically replaces
the destination directory. It exits non-zero when no usable output exists.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path


TRANSIENT_MARKERS = (
    "502", "503", "504", "bad gateway", "gateway timeout", "timed out",
    "timeout", "connection reset", "temporarily unavailable", "temporary failure",
)


def run_kaggle(kernel_id: str, output_dir: Path) -> tuple[int, str]:
    command = ["kaggle", "kernels", "output", kernel_id, "-p", str(output_dir), "--force"]
    completed = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
    text = "\n".join(part for part in (completed.stdout, completed.stderr) if part)
    return completed.returncode, text.strip()


def is_transient(message: str) -> bool:
    lowered = message.lower()
    return any(marker in lowered for marker in TRANSIENT_MARKERS)


def validate_json_files(directory: Path) -> None:
    for file in directory.rglob("*.json"):
        if file.stat().st_size == 0:
            raise RuntimeError(f"Empty JSON artifact: {file}")
        try:
            json.loads(file.read_text(encoding="utf-8"))
        except Exception as error:
            raise RuntimeError(f"Invalid JSON artifact {file}: {error}") from error


def validate_mp4_files(directory: Path, require_mp4: bool) -> list[Path]:
    files = [file for file in directory.rglob("*.mp4") if file.is_file() and file.stat().st_size > 1024]
    if not files and require_mp4:
        raise RuntimeError("Kaggle returned no non-empty MP4 artifact.")
    for file in files:
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(file)],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        if probe.returncode != 0:
            raise RuntimeError(f"MP4 integrity check failed for {file}: {probe.stderr.strip()[-500:]}")
        try:
            duration = float(probe.stdout.strip())
        except ValueError as error:
            raise RuntimeError(f"MP4 has no readable duration: {file}") from error
        if duration <= 0:
            raise RuntimeError(f"MP4 duration is zero: {file}")
    return files


def validate_motion_report(directory: Path, require_motion_report: bool) -> None:
    reports = list(directory.rglob("motion_report.json"))
    if not reports:
        if require_motion_report:
            raise RuntimeError("Kaggle output did not include motion_report.json.")
        return
    report = json.loads(reports[0].read_text(encoding="utf-8"))
    if report.get("animated") is not True:
        raise RuntimeError("motion_report.json does not confirm animated output.")
    if not report.get("speakers") or report.get("composite_score") is None:
        raise RuntimeError("motion_report.json is missing speaker or composite motion checks.")


def download_with_retry(kernel_id: str, destination: Path, attempts: int, base_delay: float, require_mp4: bool, require_motion_report: bool) -> list[Path]:
    destination.parent.mkdir(parents=True, exist_ok=True)
    last_error = "Kaggle output download did not run."
    for attempt in range(1, attempts + 1):
        temp_dir = Path(tempfile.mkdtemp(prefix="kaggle-avatar-", dir=str(destination.parent)))
        try:
            code, output = run_kaggle(kernel_id, temp_dir)
            if code != 0:
                last_error = output or f"kaggle kernels output exited with code {code}"
                raise RuntimeError(last_error)
            validate_json_files(temp_dir)
            validate_motion_report(temp_dir, require_motion_report)
            files = validate_mp4_files(temp_dir, require_mp4)
            if destination.exists():
                shutil.rmtree(destination)
            temp_dir.replace(destination)
            print(f"[OK] Kaggle output validated on attempt {attempt}: {len(files)} MP4 file(s)")
            return [destination / file.relative_to(temp_dir) for file in files]
        except Exception as error:
            last_error = str(error)
            transient = is_transient(last_error)
            if attempt >= attempts or not transient:
                print(f"[ERROR] Kaggle output retrieval failed on attempt {attempt}: {last_error}", file=sys.stderr)
                raise
            delay = min(90.0, base_delay * (2 ** (attempt - 1)))
            print(f"[!] Transient Kaggle output failure on attempt {attempt}/{attempts}: {last_error}", file=sys.stderr)
            print(f"[*] Retrying in {delay:.1f}s...", file=sys.stderr)
            time.sleep(delay)
        finally:
            if temp_dir.exists():
                shutil.rmtree(temp_dir, ignore_errors=True)
    raise RuntimeError(last_error)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--kernel-id", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--attempts", type=int, default=6)
    parser.add_argument("--base-delay", type=float, default=5.0)
    parser.add_argument("--require-mp4", action="store_true")
    parser.add_argument("--require-motion-report", action="store_true")
    args = parser.parse_args()
    if args.attempts < 1 or args.base_delay < 0:
        parser.error("--attempts must be >= 1 and --base-delay must be >= 0")
    download_with_retry(args.kernel_id, Path(args.output_dir), args.attempts, args.base_delay, args.require_mp4, args.require_motion_report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


