#!/usr/bin/env python3
"""
Twitter Space URL Validator

Checks a list of Twitter Space URLs to determine which ones are still available
for download. Uses yt-dlp's simulation mode to verify without downloading.

Usage:
    python validate_spaces.py input_urls.txt

Outputs:
    - valid_spaces.txt: URLs that can be downloaded
    - invalid_spaces.txt: URLs that are unavailable (deleted, expired, etc.)
    - validation_report.txt: Detailed report with error messages
"""

import subprocess
import sys
import os
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
import argparse
import re

# Configuration
MAX_WORKERS = 10  # Concurrent validation threads (conservative to avoid rate limits)
TIMEOUT_SECONDS = 30  # Timeout per URL check


def extract_space_id(url: str) -> str | None:
    """Extract the Space ID from a Twitter Space URL."""
    patterns = [
        r'twitter\.com/i/spaces/([a-zA-Z0-9]+)',
        r'x\.com/i/spaces/([a-zA-Z0-9]+)',
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def validate_url(url: str) -> dict:
    """
    Check if a Twitter Space URL is valid and available.

    Returns a dict with:
        - url: the original URL
        - valid: True/False
        - space_id: extracted space ID
        - title: space title (if valid)
        - error: error message (if invalid)
        - duration: duration in seconds (if available)
    """
    url = url.strip()
    if not url:
        return {"url": url, "valid": False, "error": "Empty URL", "space_id": None}

    space_id = extract_space_id(url)
    if not space_id:
        return {"url": url, "valid": False, "error": "Invalid URL format", "space_id": None}

    try:
        # Use yt-dlp to extract info without downloading
        result = subprocess.run(
            [
                "yt-dlp",
                "--dump-json",
                "--no-download",
                "--no-warnings",
                url
            ],
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS
        )

        if result.returncode == 0:
            try:
                info = json.loads(result.stdout)
                return {
                    "url": url,
                    "valid": True,
                    "space_id": space_id,
                    "title": info.get("title", "Unknown"),
                    "duration": info.get("duration"),
                    "error": None
                }
            except json.JSONDecodeError:
                return {
                    "url": url,
                    "valid": True,  # yt-dlp succeeded, assume valid
                    "space_id": space_id,
                    "title": "Unknown",
                    "duration": None,
                    "error": None
                }
        else:
            # Extract error message from stderr
            error_msg = result.stderr.strip()

            # Categorize common errors
            if "has ended" in error_msg.lower() or "not available" in error_msg.lower():
                error_type = "Space ended/unavailable"
            elif "does not exist" in error_msg.lower() or "404" in error_msg:
                error_type = "Space deleted/not found"
            elif "private" in error_msg.lower():
                error_type = "Private space"
            elif "rate limit" in error_msg.lower():
                error_type = "Rate limited - retry later"
            else:
                error_type = error_msg[:100] if error_msg else "Unknown error"

            return {
                "url": url,
                "valid": False,
                "space_id": space_id,
                "title": None,
                "duration": None,
                "error": error_type
            }

    except subprocess.TimeoutExpired:
        return {
            "url": url,
            "valid": False,
            "space_id": space_id,
            "error": "Timeout - space may be very long or unavailable"
        }
    except Exception as e:
        return {
            "url": url,
            "valid": False,
            "space_id": space_id,
            "error": f"Exception: {str(e)}"
        }


def main():
    parser = argparse.ArgumentParser(description="Validate Twitter Space URLs")
    parser.add_argument("input_file", help="Text file with one URL per line")
    parser.add_argument("--workers", type=int, default=MAX_WORKERS,
                        help=f"Number of parallel workers (default: {MAX_WORKERS})")
    parser.add_argument("--output-dir", default=".", help="Output directory for results")
    args = parser.parse_args()

    # Read input URLs
    if not os.path.exists(args.input_file):
        print(f"Error: Input file '{args.input_file}' not found")
        sys.exit(1)

    with open(args.input_file, 'r', encoding='utf-8') as f:
        urls = [line.strip() for line in f if line.strip()]

    total_urls = len(urls)
    print(f"\n{'='*60}")
    print(f"Twitter Space URL Validator")
    print(f"{'='*60}")
    print(f"Input file: {args.input_file}")
    print(f"Total URLs to check: {total_urls}")
    print(f"Parallel workers: {args.workers}")
    print(f"{'='*60}\n")

    # Track results
    valid_urls = []
    invalid_urls = []
    results = []

    # Process URLs with thread pool
    completed = 0
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        future_to_url = {executor.submit(validate_url, url): url for url in urls}

        for future in as_completed(future_to_url):
            completed += 1
            result = future.result()
            results.append(result)

            if result["valid"]:
                valid_urls.append(result)
                status = "VALID"
                details = result.get("title", "")[:40]
            else:
                invalid_urls.append(result)
                status = "INVALID"
                details = result.get("error", "Unknown error")[:40]

            # Progress output (handle Unicode for Windows console)
            pct = (completed / total_urls) * 100
            # Sanitize details for console output
            safe_details = details.encode('ascii', 'replace').decode('ascii')
            print(f"[{completed}/{total_urls}] ({pct:.1f}%) {status}: {result['space_id'] or 'N/A'} - {safe_details}")

    # Write output files
    output_dir = args.output_dir
    os.makedirs(output_dir, exist_ok=True)

    valid_file = os.path.join(output_dir, "valid_spaces.txt")
    invalid_file = os.path.join(output_dir, "invalid_spaces.txt")
    report_file = os.path.join(output_dir, "validation_report.txt")

    # Write valid URLs
    with open(valid_file, 'w', encoding='utf-8') as f:
        for r in valid_urls:
            f.write(r["url"] + "\n")

    # Write invalid URLs
    with open(invalid_file, 'w', encoding='utf-8') as f:
        for r in invalid_urls:
            f.write(r["url"] + "\n")

    # Write detailed report
    with open(report_file, 'w', encoding='utf-8') as f:
        f.write(f"Twitter Space Validation Report\n")
        f.write(f"Generated: {datetime.now().isoformat()}\n")
        f.write(f"{'='*60}\n\n")
        f.write(f"SUMMARY\n")
        f.write(f"-------\n")
        f.write(f"Total URLs checked: {total_urls}\n")
        f.write(f"Valid (downloadable): {len(valid_urls)}\n")
        f.write(f"Invalid (unavailable): {len(invalid_urls)}\n")
        f.write(f"Success rate: {(len(valid_urls)/total_urls*100):.1f}%\n\n")

        # Error breakdown
        error_counts = {}
        for r in invalid_urls:
            err = r.get("error", "Unknown")
            error_counts[err] = error_counts.get(err, 0) + 1

        if error_counts:
            f.write(f"ERROR BREAKDOWN\n")
            f.write(f"---------------\n")
            for err, count in sorted(error_counts.items(), key=lambda x: -x[1]):
                f.write(f"  {count:4d} - {err}\n")
            f.write("\n")

        # Valid spaces details
        f.write(f"VALID SPACES ({len(valid_urls)})\n")
        f.write(f"{'-'*40}\n")
        total_duration = 0
        for r in valid_urls:
            duration_str = ""
            if r.get("duration"):
                total_duration += r["duration"]
                hours = r["duration"] // 3600
                mins = (r["duration"] % 3600) // 60
                duration_str = f" [{hours}h{mins:02d}m]"
            f.write(f"  {r['space_id']}: {r.get('title', 'Unknown')[:50]}{duration_str}\n")

        if total_duration:
            total_hours = total_duration // 3600
            total_mins = (total_duration % 3600) // 60
            f.write(f"\nTotal duration of valid spaces: {total_hours}h {total_mins}m\n")

        f.write(f"\nINVALID SPACES ({len(invalid_urls)})\n")
        f.write(f"{'-'*40}\n")
        for r in invalid_urls:
            f.write(f"  {r['space_id'] or 'N/A'}: {r.get('error', 'Unknown')}\n")

    # Print summary
    print(f"\n{'='*60}")
    print(f"VALIDATION COMPLETE")
    print(f"{'='*60}")
    print(f"Valid URLs:   {len(valid_urls):,} ({len(valid_urls)/total_urls*100:.1f}%)")
    print(f"Invalid URLs: {len(invalid_urls):,} ({len(invalid_urls)/total_urls*100:.1f}%)")
    print(f"\nOutput files:")
    print(f"  {valid_file}")
    print(f"  {invalid_file}")
    print(f"  {report_file}")
    print(f"{'='*60}\n")

    return 0 if valid_urls else 1


if __name__ == "__main__":
    sys.exit(main())
