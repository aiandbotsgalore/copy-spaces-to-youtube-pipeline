#!/usr/bin/env python3
"""
scripts/batch_transcribe_queue.py

Discovers all untranscribed episodes across the GitHub repository,
sorts them chronologically in order of MOST RECENTLY RELEASED to OLDEST,
and executes Modal Cloud GPU transcription sequentially or in batches.
"""

import os
import sys
import re
import json
import time
import argparse
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Dict, Any, Optional
import urllib.request

# Ensure repository root is in path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def get_episode_recorded_timestamp(rel: Dict[str, Any]) -> tuple[int, str]:
    """
    Extracts the true live recorded timestamp (ms) and display string for a release.
    Priority identically matching utils/dates.ts:
      1. METADATA::EPISODE_DATE:: or METADATA::DATE::
      2. **Recorded:** field
      3. Tag name YYYYMMDD prefix
      4. Release name date regex
      5. Fallback to published_at / created_at
    """
    body = rel.get("body") or ""

    # 1. METADATA::EPISODE_DATE:: or METADATA::DATE::
    m = re.search(r"METADATA::(?:EPISODE_DATE|DATE)::(\d{4})[-/]?(\d{2})[-/]?(\d{2})", body)
    if m:
        try:
            y, mth, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if 2000 <= y <= 2099 and 1 <= mth <= 12 and 1 <= d <= 31:
                dt = datetime(y, mth, d, 12, 0, 0, tzinfo=timezone.utc)
                return int(dt.timestamp() * 1000), f"{MONTH_NAMES[mth - 1]} {d}, {y}"
        except Exception:
            pass

    # 2. **Recorded:**
    m = re.search(r"\*\*Recorded:\*\*\s*(\d{4})[-/]?(\d{2})[-/]?(\d{2})", body)
    if m:
        try:
            y, mth, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if 2000 <= y <= 2099 and 1 <= mth <= 12 and 1 <= d <= 31:
                dt = datetime(y, mth, d, 12, 0, 0, tzinfo=timezone.utc)
                return int(dt.timestamp() * 1000), f"{MONTH_NAMES[mth - 1]} {d}, {y}"
        except Exception:
            pass

    # 3. tag_name prefix YYYYMMDD (e.g. 20260909_1pKkOXAZPMZKj)
    tag = rel.get("tag_name") or ""
    m = re.match(r"^(?:v)?(\d{4})[-_]?(\d{2})[-_]?(\d{2})", tag)
    if m:
        try:
            y, mth, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if 2000 <= y <= 2099 and 1 <= mth <= 12 and 1 <= d <= 31:
                dt = datetime(y, mth, d, 12, 0, 0, tzinfo=timezone.utc)
                return int(dt.timestamp() * 1000), f"{MONTH_NAMES[mth - 1]} {d}, {y}"
        except Exception:
            pass

    # 4. Release name date regex
    name = rel.get("name") or ""
    m = re.search(r"\b(\d{4})[-/](\d{2})[-/](\d{2})\b", name)
    if m:
        try:
            y, mth, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if 2000 <= y <= 2099 and 1 <= mth <= 12 and 1 <= d <= 31:
                dt = datetime(y, mth, d, 12, 0, 0, tzinfo=timezone.utc)
                return int(dt.timestamp() * 1000), f"{MONTH_NAMES[mth - 1]} {d}, {y}"
        except Exception:
            pass

    # 5. Fallback to published_at / created_at
    fallback = rel.get("published_at") or rel.get("created_at") or datetime.now(timezone.utc).isoformat()
    try:
        dt = datetime.fromisoformat(fallback.replace("Z", "+00:00"))
        return int(dt.timestamp() * 1000), f"{MONTH_NAMES[dt.month - 1]} {dt.day}, {dt.year}"
    except Exception:
        return 0, "Unknown Date"


def fetch_all_releases(repo: str, github_token: Optional[str] = None) -> List[Dict[str, Any]]:
    """Fetches all repository releases with pagination using gh api or requests."""
    print(f"[*] Fetching releases for {repo}...")
    # 1. Try gh api if available
    cmd = ["gh", "api", f"repos/{repo}/releases?per_page=100", "--paginate"]
    env = os.environ.copy()
    if github_token:
        env["GH_TOKEN"] = github_token
        env["GITHUB_TOKEN"] = github_token

    try:
        res = subprocess.run(cmd, capture_output=True, text=True, check=True, env=env)
        raw = res.stdout
        releases = []
        decoder = json.JSONDecoder()
        pos = 0
        while pos < len(raw.strip()):
            while pos < len(raw) and raw[pos].isspace():
                pos += 1
            if pos >= len(raw):
                break
            obj, idx = decoder.raw_decode(raw[pos:])
            pos += idx
            if isinstance(obj, list):
                releases.extend(obj)
            elif isinstance(obj, dict):
                releases.append(obj)
        if releases:
            print(f"[✓] Retrieved {len(releases)} total releases via gh CLI.")
            return releases
    except Exception:
        pass

    # 2. Fallback: direct HTTP requests via urllib with pagination
    headers = {"Accept": "application/vnd.github.v3+json", "User-Agent": "SpacePipe-BatchQueue"}
    if github_token:
        headers["Authorization"] = f"token {github_token}"

    releases = []
    page = 1
    while True:
        url = f"https://api.github.com/repos/{repo}/releases?per_page=100&page={page}"
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=20.0) as resp:
                batch = json.loads(resp.read().decode("utf-8"))
                if not batch:
                    break
                releases.extend(batch)
                if len(batch) < 100:
                    break
                page += 1
        except Exception as e:
            print(f"[!] Warning: HTTP release fetch stopped on page {page}: {e}")
            break

    print(f"[✓] Retrieved {len(releases)} total releases via GitHub REST API.")
    return releases


def analyze_releases(releases: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Identifies transcribed vs untranscribed episodes and sorts untranscribed from newest to oldest."""
    transcribed = []
    untranscribed = []
    no_audio = []

    for rel in releases:
        tag = rel.get("tag_name", "")
        name = rel.get("name") or tag
        assets = rel.get("assets", [])

        mp3_assets = [
            a for a in assets 
            if a.get("name", "").endswith(".mp3") and not re.match(r"^\d+(?:h\d+)?m\d+s_", a.get("name", ""))
        ]
        if not mp3_assets:
            mp3_assets = [a for a in assets if a.get("name", "").endswith(".mp3")]

        has_audio = len(mp3_assets) > 0
        transcript_assets = [
            a for a in assets 
            if (a.get("name", "").endswith(".json") and not a.get("name", "").endswith("_clips.json") and a.get("name") != "clips_catalog.json") 
            or a.get("name", "").endswith(".txt")
        ]
        has_transcript = any(a.get("size", 0) > 100 for a in transcript_assets)

        clip_assets = [
            a for a in assets 
            if ((a.get("name", "").endswith("_clips.json") or a.get("name") == "clips_catalog.json") and a.get("size", 0) > 100)
            or (a.get("name", "").endswith(".mp3") and not re.match(r"^20\d{6}_", a.get("name", "")) and re.match(r"^(?:(\d+)h)?(\d+)m(\d+)s", a.get("name", "")))
        ]
        has_clips = len(clip_assets) > 0

        timestamp_ms, date_display = get_episode_recorded_timestamp(rel)

        total_audio_bytes = sum(a.get("size", 0) for a in mp3_assets)
        is_placeholder = tag.startswith("test-placeholder") or "placeholder" in name.lower() or total_audio_bytes < 5000

        info = {
            "tag": tag,
            "name": name,
            "timestamp_ms": timestamp_ms,
            "date_display": date_display,
            "mp3_count": len(mp3_assets),
            "total_audio_bytes": total_audio_bytes,
            "has_audio": has_audio and not is_placeholder,
            "has_transcript": has_transcript,
            "has_clips": has_clips,
        }

        if not has_audio or is_placeholder:
            no_audio.append(info)
        elif has_transcript:
            transcribed.append(info)
        else:
            untranscribed.append(info)

    # Missing clips: transcribed episodes that have no highlight clips generated yet
    missing_clips = [item for item in transcribed if not item["has_clips"]]

    # Load known failure history to deprioritize stubborn poison pills (>= 3 failures)
    status_file = Path("public/transcripts/transcription_status.json")
    failed_history = {}
    if status_file.exists():
        try:
            with open(status_file, "r", encoding="utf-8") as f:
                prev_data = json.load(f)
                failed_history = prev_data.get("failed_episodes", {})
        except Exception:
            pass

    # Sort strictly from newest (most recently released/aired) to oldest
    untranscribed.sort(key=lambda x: x["timestamp_ms"], reverse=True)
    transcribed.sort(key=lambda x: x["timestamp_ms"], reverse=True)
    missing_clips.sort(key=lambda x: x["timestamp_ms"], reverse=True)

    # Separate healthy untranscribed from repeated failures (>= 3 attempts)
    healthy_untranscribed = []
    deprioritized = []
    for item in untranscribed:
        attempts = failed_history.get(item["tag"], {}).get("attempts", 0)
        if attempts >= 3:
            deprioritized.append(item)
        else:
            healthy_untranscribed.append(item)

    # Place deprioritized at the very end so they never block the queue
    ordered_untranscribed = healthy_untranscribed + deprioritized

    return {
        "total_releases": len(releases),
        "transcribed": transcribed,
        "untranscribed": ordered_untranscribed,
        "missing_clips": missing_clips,
        "no_audio": no_audio,
        "failed_history": failed_history
    }


def save_status_manifest(analysis: Dict[str, Any], failed_history: Optional[Dict[str, Any]] = None):
    """Saves live progress summary to public/transcripts/transcription_status.json."""
    status_file = Path("public/transcripts/transcription_status.json")
    status_file.parent.mkdir(parents=True, exist_ok=True)

    total_with_audio = len(analysis["transcribed"]) + len(analysis["untranscribed"])
    pct = round((len(analysis["transcribed"]) / total_with_audio * 100), 1) if total_with_audio else 100.0

    history = failed_history if failed_history is not None else analysis.get("failed_history", {})
    
    fatal_error = None
    for item in history.values():
        err = item.get("last_error", "")
        if "spend limit" in err.lower():
            fatal_error = "Modal workspace has exceeded its spend limit. Please update billing/credits at https://modal.com/settings/billing."
            break
        elif "not authenticated" in err.lower() or "authentication failed" in err.lower():
            fatal_error = "Modal authentication failed. Please verify MODAL_TOKEN_ID and MODAL_TOKEN_SECRET in GitHub secrets."
            break

    data = {
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "total_episodes_with_audio": total_with_audio,
        "transcribed_count": len(analysis["transcribed"]),
        "untranscribed_count": len(analysis["untranscribed"]),
        "percent_complete": pct,
        "auto_chain_active": len(analysis["untranscribed"]) > 0 and not fatal_error,
        "is_queue_complete": len(analysis["untranscribed"]) == 0,
        "fatal_error": fatal_error,
        "failed_episodes": history,
        "next_in_queue": [
            {
                "tag": item["tag"],
                "name": item["name"],
                "date": item["date_display"]
            }
            for item in analysis["untranscribed"][:20]
        ]
    }
    with open(status_file, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(f"[✓] Status manifest updated: {status_file} ({pct}% complete, {len(analysis['untranscribed'])} remaining)")


def main():
    parser = argparse.ArgumentParser(description="Batch Transcribe Episodes in order from newest to oldest")
    parser.add_argument("--repo", type=str, default="aiandbotsgalore/copy-spaces-to-youtube-pipeline", help="GitHub repo")
    parser.add_argument("--limit", type=int, default=10, help="Number of episodes to transcribe (0 for all)")
    parser.add_argument("--missing-clips", action="store_true", help="Process transcribed episodes that are missing highlight clips")
    parser.add_argument("--dry-run", action="store_true", help="Preview queue and exit without running Modal")
    parser.add_argument("--token", type=str, default=os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN"))
    args = parser.parse_args()

    releases = fetch_all_releases(args.repo, args.token)
    if not releases:
        print("[!] No releases found.")
        sys.exit(1)

    analysis = analyze_releases(releases)
    save_status_manifest(analysis)

    total_with_audio = len(analysis["transcribed"]) + len(analysis["untranscribed"])
    pct = (len(analysis["transcribed"]) / total_with_audio * 100) if total_with_audio else 0

    print("\n" + "=" * 65)
    print("           EPISODE TRANSCRIPTION STATUS & QUEUE               ")
    print("=" * 65)
    print(f"  • Total Releases:           {analysis['total_releases']}")
    print(f"  • Episodes with Audio:      {total_with_audio}")
    print(f"  • Already Transcribed:      {len(analysis['transcribed'])} ({pct:.1f}%)")
    print(f"  • Untranscribed Remaining:  {len(analysis['untranscribed'])}")
    print(f"  • Transcribed Missing Clips:{len(analysis['missing_clips'])}")
    print("=" * 65)

    if args.missing_clips:
        queue = analysis["missing_clips"]
        if not queue:
            print("\n[🎉] All transcribed episodes already have highlight clips generated!")
            sys.exit(0)
    else:
        queue = analysis["untranscribed"]
        if not queue:
            print("\n[🎉] All episodes in the repository are already transcribed!")
            sys.exit(0)

    to_process = queue if args.limit <= 0 else queue[:args.limit]

    print(f"\n[*] Processing Order: Most Recently Released -> Oldest")
    print(f"[*] Batch size for this run: {len(to_process)} episode(s)\n")

    for i, item in enumerate(to_process, 1):
        mb = item["total_audio_bytes"] / (1024 * 1024)
        print(f"  {i:2d}. [{item['date_display']}] {item['tag']} - {item['name']} ({mb:.1f} MB, {item['mp3_count']} part(s))")

    if args.dry_run:
        github_output = os.environ.get("GITHUB_OUTPUT")
        if github_output:
            remaining_count = len(queue)
            has_more = remaining_count > 0
            try:
                with open(github_output, "a", encoding="utf-8") as f:
                    f.write(f"has_more={'true' if has_more else 'false'}\n")
                    f.write(f"remaining_count={remaining_count}\n")
                    f.write(f"transcribed_count={len(analysis['transcribed'])}\n")
                    f.write(f"success_count=0\n")
            except Exception as e:
                print(f"[!] Notice: Failed to write GITHUB_OUTPUT: {e}")
        print("\n[✓] Dry-run complete. Exiting without dispatching transcription jobs.")
        sys.exit(0)

    # Execute Modal transcription for each item in the batch sequentially
    print("\n" + "=" * 65)
    print("              STARTING MODAL GPU TRANSCRIPTION BATCH            ")
    print("=" * 65)

    success_count = 0
    failed_items = []

    for idx, item in enumerate(to_process, 1):
        tag = item["tag"]
        name = item["name"]
        print(f"\n>>> [{idx}/{len(to_process)}] Transcribing: {tag} ({name})...")

        cmd = ["modal", "run", "modal_transcriber.py", "--release-tag", tag]
        start_time = time.time()
        try:
            res = subprocess.run(cmd, capture_output=True, text=True)
            elapsed = time.time() - start_time
            if res.returncode == 0:
                print(f"[✓] Completed {tag} in {elapsed:.1f}s!")
                if res.stdout.strip():
                    for line in res.stdout.strip().splitlines()[-4:]:
                        print(f"    {line}")
                success_count += 1
            else:
                combined_output = (res.stdout or "") + "\n" + (res.stderr or "")
                error_summary = f"Modal exited with code {res.returncode}"
                if "exceeded its spend limit" in combined_output:
                    error_summary = "Modal workspace has exceeded its spend limit"
                elif "Not authenticated" in combined_output:
                    error_summary = "Modal authentication failed (invalid or missing tokens)"
                elif res.stderr.strip():
                    non_empty = [l.strip() for l in res.stderr.strip().splitlines() if l.strip()]
                    if non_empty:
                        error_summary = non_empty[-1][:120]

                print(f"[!] Failed transcribing {tag} ({error_summary}) after {elapsed:.1f}s.")
                if res.stdout.strip():
                    print(f"--- MODAL STDOUT ---\n{res.stdout.strip()}\n--------------------")
                if res.stderr.strip():
                    print(f"--- MODAL STDERR ---\n{res.stderr.strip()}\n--------------------")

                failed_items.append({"tag": tag, "error": error_summary})

                if "exceeded its spend limit" in combined_output or "Not authenticated" in combined_output:
                    print("\n" + "!" * 65)
                    print(f"[🛑] FATAL MODAL INFRASTRUCTURE ERROR: {error_summary}")
                    print("     Halting remaining batch queue immediately to prevent wasted runs.")
                    print("!" * 65 + "\n")
                    break
        except Exception as e:
            elapsed = time.time() - start_time
            print(f"[!] Error processing {tag}: {e}. Continuing queue...")
            failed_items.append({"tag": tag, "error": str(e)})

    # Update failure history
    failed_history = analysis.get("failed_history", {})
    for f in failed_items:
        t = f["tag"]
        prev = failed_history.get(t, {"attempts": 0})
        failed_history[t] = {
            "attempts": prev.get("attempts", 0) + 1,
            "last_error": str(f["error"]),
            "last_attempt": datetime.now(timezone.utc).isoformat()
        }
    for item in to_process:
        if item["tag"] not in [f["tag"] for f in failed_items]:
            failed_history.pop(item["tag"], None)

    # Post-batch tasks: rebuild search index
    print("\n[*] Rebuilding transcript search index with all newly uploaded transcripts...")
    try:
        subprocess.run([sys.executable, "scripts/build_transcripts_index.py"], check=True)
        print("[✓] Search index rebuild complete!")
    except Exception as e:
        print(f"[!] Notice: build_transcripts_index.py failed: {e}")

    # Re-analyze to update status file
    fresh_analysis = analysis
    try:
        fresh_releases = fetch_all_releases(args.repo, args.token)
        fresh_analysis = analyze_releases(fresh_releases)
        save_status_manifest(fresh_analysis, failed_history)
    except Exception as e:
        print(f"[!] Notice: failed to update final status manifest: {e}")

    # Emit outputs to GitHub Actions runner
    remaining_count = len(fresh_analysis["missing_clips"] if args.missing_clips else fresh_analysis["untranscribed"])
    # Crucial safeguard: only auto-chain if at least one episode was successfully transcribed
    has_more = (remaining_count > 0) and (success_count > 0)
    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        try:
            with open(github_output, "a", encoding="utf-8") as f:
                f.write(f"has_more={'true' if has_more else 'false'}\n")
                f.write(f"remaining_count={remaining_count}\n")
                f.write(f"transcribed_count={len(fresh_analysis['transcribed'])}\n")
                f.write(f"success_count={success_count}\n")
            print(f"[✓] Emitted GitHub Action outputs: has_more={has_more}, remaining_count={remaining_count}, success_count={success_count}")
        except Exception as e:
            print(f"[!] Notice: Failed to write GITHUB_OUTPUT: {e}")

    print("\n" + "=" * 65)
    print("                    BATCH TRANSCRIPTION SUMMARY                 ")
    print("=" * 65)
    print(f"  • Successfully Transcribed: {success_count} / {len(to_process)}")
    print(f"  • Remaining Untranscribed:  {remaining_count}")
    print(f"  • Auto-Chain Eligible:      {'Yes (has_more=true)' if has_more else 'No (queue complete!)'}")
    if failed_items:
        print(f"  • Failed: {len(failed_items)}")
        for f in failed_items:
            print(f"      - {f['tag']}: {f['error']}")
    print("=" * 65 + "\n")


if __name__ == "__main__":
    main()
