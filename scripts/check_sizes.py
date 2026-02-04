#!/usr/bin/env python3
"""
Twitter Space Size Checker

Checks duration of spaces to identify which exceed GitHub's 2GB limit.
MP3 at 192kbps ≈ 86 MB/hour → Max ~20 hours for 2GB

Usage:
    python check_sizes.py valid_spaces.txt
"""

import subprocess
import sys
import os
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
import argparse
import re

MAX_WORKERS = 10
TIMEOUT_SECONDS = 30
MAX_HOURS = 20  # ~1.7GB at 192kbps


def extract_space_id(url: str) -> str | None:
    patterns = [
        r'twitter\.com/i/spaces/([a-zA-Z0-9]+)',
        r'x\.com/i/spaces/([a-zA-Z0-9]+)',
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def check_duration(url: str) -> dict:
    """Get duration without downloading."""
    url = url.strip()
    if not url:
        return {"url": url, "error": "Empty URL", "space_id": None}

    space_id = extract_space_id(url)
    if not space_id:
        return {"url": url, "error": "Invalid URL", "space_id": None}

    try:
        result = subprocess.run(
            ["yt-dlp", "--dump-json", "--no-download", "--no-warnings", url],
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS
        )

        if result.returncode == 0:
            info = json.loads(result.stdout)
            duration_seconds = info.get("duration", 0) or 0
            duration_hours = duration_seconds / 3600
            title = info.get("title", "Unknown")
            estimated_mb = duration_hours * 86  # 192kbps ≈ 86MB/hour

            return {
                "url": url,
                "space_id": space_id,
                "title": title,
                "duration_seconds": duration_seconds,
                "duration_hours": round(duration_hours, 2),
                "estimated_mb": round(estimated_mb, 1),
                "oversized": duration_hours > MAX_HOURS,
                "error": None
            }
        else:
            return {"url": url, "space_id": space_id, "error": "Failed to fetch info"}

    except subprocess.TimeoutExpired:
        return {"url": url, "space_id": space_id, "error": "Timeout"}
    except Exception as e:
        return {"url": url, "space_id": space_id, "error": str(e)[:50]}


def format_duration(hours: float) -> str:
    h = int(hours)
    m = int((hours - h) * 60)
    return f"{h}h{m:02d}m"


def main():
    parser = argparse.ArgumentParser(description="Check Twitter Space sizes")
    parser.add_argument("input_file", help="Text file with URLs")
    parser.add_argument("--workers", type=int, default=MAX_WORKERS)
    parser.add_argument("--output-dir", default=".")
    parser.add_argument("--max-hours", type=float, default=MAX_HOURS)
    args = parser.parse_args()

    if not os.path.exists(args.input_file):
        print(f"Error: '{args.input_file}' not found")
        sys.exit(1)

    with open(args.input_file, 'r', encoding='utf-8') as f:
        urls = [line.strip() for line in f if line.strip()]

    total = len(urls)
    print(f"\n{'='*60}")
    print(f"Twitter Space Size Checker")
    print(f"{'='*60}")
    print(f"URLs to check: {total}")
    print(f"Max allowed: {args.max_hours}h (~{int(args.max_hours * 86)}MB)")
    print(f"{'='*60}\n")

    safe = []
    oversized = []
    errors = []

    completed = 0
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {executor.submit(check_duration, url): url for url in urls}

        for future in as_completed(futures):
            completed += 1
            result = future.result()

            if result.get("error"):
                errors.append(result)
                status = "ERROR"
                detail = result["error"][:30]
            elif result.get("oversized"):
                oversized.append(result)
                status = "OVERSIZED"
                detail = f"{format_duration(result['duration_hours'])} (~{result['estimated_mb']:.0f}MB)"
            else:
                safe.append(result)
                status = "OK"
                detail = format_duration(result.get('duration_hours', 0))

            pct = (completed / total) * 100
            safe_detail = detail.encode('ascii', 'replace').decode('ascii')
            print(f"[{completed}/{total}] ({pct:.1f}%) {status}: {result.get('space_id', 'N/A')} - {safe_detail}")

    # Sort by duration
    safe.sort(key=lambda x: x.get('duration_hours', 0))
    oversized.sort(key=lambda x: x.get('duration_hours', 0), reverse=True)

    # Write outputs
    os.makedirs(args.output_dir, exist_ok=True)

    safe_file = os.path.join(args.output_dir, "safe_spaces.txt")
    oversized_file = os.path.join(args.output_dir, "oversized_spaces.txt")
    report_file = os.path.join(args.output_dir, "size_report.txt")

    with open(safe_file, 'w', encoding='utf-8') as f:
        for r in safe:
            f.write(r["url"] + "\n")

    with open(oversized_file, 'w', encoding='utf-8') as f:
        for r in oversized:
            f.write(r["url"] + "\n")

    with open(report_file, 'w', encoding='utf-8') as f:
        f.write(f"Size Check Report - {datetime.now().isoformat()}\n")
        f.write(f"{'='*60}\n\n")
        f.write(f"Safe: {len(safe)} | Oversized: {len(oversized)} | Errors: {len(errors)}\n\n")

        if oversized:
            f.write(f"OVERSIZED (>{args.max_hours}h):\n")
            for r in oversized:
                f.write(f"  {r['space_id']}: {format_duration(r['duration_hours'])} - {r.get('title', '')[:40]}\n")
            f.write("\n")

        if safe:
            total_hours = sum(r.get('duration_hours', 0) for r in safe)
            f.write(f"SAFE SPACES: {len(safe)} totaling {total_hours:.1f} hours\n")

    print(f"\n{'='*60}")
    print(f"Safe: {len(safe)} | Oversized: {len(oversized)} | Errors: {len(errors)}")
    print(f"Output: {safe_file}")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
