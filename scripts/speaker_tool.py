#!/usr/bin/env python3
"""
scripts/speaker_tool.py
Unified Speaker Operations CLI for SpacePipe

Subcommands:
  extract-samples: Extract audio samples for speaker enrollment using fast HTTP byte-range streaming.
  rescan-archive:  Perform acoustic and conversational rescan of all episode transcripts.
  relabel:         Batch relabel speaker names across one or all transcripts.

Usage:
  python scripts/speaker_tool.py extract-samples --help
  python scripts/speaker_tool.py rescan-archive --help
  python scripts/speaker_tool.py relabel --help
"""

import sys
import subprocess
import argparse
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(
        description="Unified Speaker Operations CLI for SpacePipe",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="command", help="Speaker command to run")

    # extract-samples
    p_extract = subparsers.add_parser("extract-samples", help="Harvest sample audio clips for enrollment")
    p_extract.add_argument("--release-tag", required=True, help="Release tag (e.g. 20260902_1AJEmvwnykXJL)")
    p_extract.add_argument("--speaker", required=True, help="Raw speaker label to harvest (e.g. Speaker 1)")
    p_extract.add_argument("--count", type=int, default=5, help="Number of clips to harvest")

    # rescan-archive
    p_rescan = subparsers.add_parser("rescan-archive", help="Rescan archive for enrolled speaker profiles")
    p_rescan.add_argument("--speaker", help="Target speaker name (or all if omitted)")
    p_rescan.add_argument("--dry-run", action="store_true", help="Audit matches without modifying transcripts")

    # relabel
    p_relabel = subparsers.add_parser("relabel", help="Relabel speaker turns in transcripts")
    p_relabel.add_argument("--release-tag", help="Specific release tag, or omit for all")
    p_relabel.add_argument("--from-speaker", required=True, help="Current speaker label to replace")
    p_relabel.add_argument("--to-speaker", required=True, help="New speaker label")

    args, unknown = parser.parse_known_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    scripts_dir = Path(__file__).resolve().parent

    if args.command == "extract-samples":
        cmd = [sys.executable, str(scripts_dir / "extract_speaker_clips.py"), "--release-tag", args.release_tag, "--speaker", args.speaker, "--count", str(args.count)] + unknown
        sys.exit(subprocess.call(cmd))
    elif args.command == "rescan-archive":
        cmd = [sys.executable, str(scripts_dir / "rescan_archive_speakers.py")]
        if args.speaker:
            cmd.extend(["--speaker", args.speaker])
        if args.dry_run:
            cmd.append("--dry-run")
        cmd.extend(unknown)
        sys.exit(subprocess.call(cmd))
    elif args.command == "relabel":
        cmd = [sys.executable, str(scripts_dir / "relabel_speakers.py"), "--from-speaker", args.from_speaker, "--to-speaker", args.to_speaker]
        if args.release_tag:
            cmd.extend(["--release-tag", args.release_tag])
        cmd.extend(unknown)
        sys.exit(subprocess.call(cmd))


if __name__ == "__main__":
    main()
