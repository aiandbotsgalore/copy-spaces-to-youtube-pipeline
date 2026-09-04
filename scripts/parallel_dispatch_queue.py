#!/usr/bin/env python3
"""
scripts/parallel_dispatch_queue.py

High-Concurrency Cloud GPU Ingest Dispatcher (Option B)

Maintains a concurrency pool of N simultaneous cloud workers in GitHub Actions / Modal GPU.
Dispatches episodes from processing_queue.json strictly chronologically (most recent to oldest).
Zero local disk space: all audio downloading, Faster-Whisper transcription,
SpeechBrain diarization, and Gemini clip cutting run 100% in cloud GPUs.
"""

import os
import sys
import time
import json
import argparse
import subprocess
from pathlib import Path
from typing import Dict, Any, List, Set

QUEUE_FILE = Path("processing_queue.json")
STATE_FILE = Path("parallel_queue_state.json")


def load_queue() -> List[Dict[str, Any]]:
    if not QUEUE_FILE.exists():
        print("[!] processing_queue.json not found. Run scripts/audit_queue.py first.")
        sys.exit(1)
    with open(QUEUE_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def load_state() -> Dict[str, Any]:
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "completed": [],
        "failed": {},
        "active": {},
        "dispatched_count": 0,
        "completed_count": 0
    }


def save_state(state: Dict[str, Any]):
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)


def get_active_github_runs() -> List[Dict[str, Any]]:
    """Fetches recent workflow runs for transcribe_episode.yml from GitHub Actions."""
    cmd = [
        "gh", "run", "list",
        "--workflow=transcribe_episode.yml",
        "--limit", "30",
        "--json", "databaseId,status,conclusion,displayTitle,createdAt,updatedAt"
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"[!] Warning: Could not fetch workflow runs: {res.stderr.strip()}")
        return []
    try:
        return json.loads(res.stdout)
    except Exception:
        return []


def dispatch_tag(tag: str) -> bool:
    """Dispatches a single episode run on GitHub Actions."""
    cmd = ["gh", "workflow", "run", "transcribe_episode.yml", "-f", f"release_tag={tag}"]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode == 0:
        return True
    else:
        print(f"  [!] Dispatch error for {tag}: {res.stderr.strip()}")
        return False


def run_index_update():
    """Triggers search index rebuild to keep web app up to date."""
    print("\n[*] Updating global transcript search index...")
    try:
        cmd = [sys.executable, "scripts/build_transcripts_index.py"]
        subprocess.run(cmd, check=True)
        print("[✓] Global transcript search index updated successfully.\n")
    except Exception as e:
        print(f"[!] Warning updating search index: {e}\n")


def main():
    parser = argparse.ArgumentParser(description="Parallel Cloud GPU Ingest Dispatcher (Option B)")
    parser.add_argument("--concurrency", type=int, default=5, help="Number of concurrent cloud GPU workers (default: 5)")
    parser.add_argument("--poll-interval", type=int, default=25, help="Seconds between status checks (default: 25)")
    parser.add_argument("--index-interval", type=int, default=5, help="Update search index every N completions (default: 5)")
    parser.add_argument("--max-episodes", type=int, default=None, help="Maximum number of episodes to process in this run")
    parser.add_argument("--dry-run", action="store_true", help="Print actions without dispatching")

    args = parser.parse_args()

    queue = load_queue()
    state = load_state()

    completed_set: Set[str] = set(state.get("completed", []))
    failed_dict: Dict[str, int] = state.get("failed", {})
    active_dict: Dict[str, Dict[str, Any]] = state.get("active", {})

    print("=" * 70)
    print(" 🚀 SPACEPIPE PARALLEL CLOUD GPU DISPATCHER (OPTION B)")
    print("=" * 70)
    print(f"[*] Queue Size:        {len(queue)} episodes (Reverse Chronological)")
    print(f"[*] Max Concurrency:   {args.concurrency} parallel cloud workers")
    print(f"[*] Poll Interval:     {args.poll_interval}s")
    print(f"[*] Index Interval:    Every {args.index_interval} completed episodes")
    print(f"[*] Already Completed: {len(completed_set)}")
    print(f"[*] Currently Active:  {len(active_dict)}")
    print("=" * 70)

    completed_since_last_index = 0
    total_processed_this_session = 0

    try:
        while True:
            # 1. Fetch current runs from GitHub Actions
            runs = get_active_github_runs()

            # Map runs by ID and title
            run_by_id = {r["databaseId"]: r for r in runs}
            live_running_count = 0

            # 2. Check active jobs
            finished_tags = []
            for tag, info in list(active_dict.items()):
                run_id = info.get("run_id")
                tag_run = None
                if run_id and run_id in run_by_id:
                    tag_run = run_by_id[run_id]
                else:
                    # Look for run matching this tag in title
                    for r in runs:
                        title = r.get("displayTitle", "")
                        if tag in title:
                            tag_run = r
                            info["run_id"] = r["databaseId"]
                            break

                if tag_run:
                    status = tag_run.get("status")
                    conclusion = tag_run.get("conclusion")
                    if status == "completed":
                        finished_tags.append((tag, conclusion))
                    else:
                        live_running_count += 1
                else:
                    # If dispatched recently (< 60s ago), give GitHub Actions time to register
                    dispatched_at = info.get("dispatched_at", 0)
                    if time.time() - dispatched_at > 180:
                        # Timeout waiting for run to appear
                        print(f"[!] Run for {tag} never appeared after 3m. Marking for retry.")
                        finished_tags.append((tag, "timeout"))
                    else:
                        live_running_count += 1

            # 3. Process finished jobs
            for tag, conclusion in finished_tags:
                del active_dict[tag]
                if conclusion == "success":
                    print(f"\n[🎉 SUCCESS] Episode {tag} finished cloud processing!")
                    completed_set.add(tag)
                    state["completed"] = list(completed_set)
                    state["completed_count"] = state.get("completed_count", 0) + 1
                    completed_since_last_index += 1
                    total_processed_this_session += 1
                else:
                    retries = failed_dict.get(tag, 0) + 1
                    failed_dict[tag] = retries
                    state["failed"] = failed_dict
                    print(f"\n[⚠️ FAILURE] Episode {tag} finished with: {conclusion} (attempt {retries})")
                    if retries >= 2:
                        print(f"  [-] Reached max retries for {tag}. Skipping.")
                    else:
                        print(f"  [-] Will retry {tag} in next cycle.")

            # Save state update
            state["active"] = active_dict
            save_state(state)

            # 4. Trigger index update if needed
            if completed_since_last_index >= args.index_interval:
                run_index_update()
                completed_since_last_index = 0

            # Check stop condition
            if args.max_episodes and total_processed_this_session >= args.max_episodes:
                print(f"[*] Reached target maximum episodes for this session ({args.max_episodes}). Exiting.")
                break

            # 5. Fill available worker slots up to concurrency limit
            available_slots = args.concurrency - len(active_dict)
            if available_slots > 0:
                # Find next items in queue
                for item in queue:
                    if available_slots <= 0:
                        break
                    tag = item["tag"]
                    title = item.get("title", tag)

                    if tag in completed_set:
                        continue
                    if tag in active_dict:
                        continue
                    if failed_dict.get(tag, 0) >= 2:
                        continue  # Skip permanently failed

                    print(f"\n[⚡ DISPATCHING] {tag} -> '{title[:40]}'")
                    print(f"  Slot: {len(active_dict) + 1}/{args.concurrency}")
                    if args.dry_run:
                        print("  [DRY RUN] Skipped actual dispatch.")
                        active_dict[tag] = {"dispatched_at": time.time(), "title": title}
                    else:
                        ok = dispatch_tag(tag)
                        if ok:
                            print(f"  [✓] Dispatched to GitHub Actions + Modal GPU!")
                            active_dict[tag] = {
                                "dispatched_at": time.time(),
                                "title": title,
                                "run_id": None
                            }
                            state["dispatched_count"] = state.get("dispatched_count", 0) + 1
                            # Stagger dispatches by 4 seconds
                            time.sleep(4)
                        else:
                            print(f"  [!] Failed to dispatch {tag}")
                    
                    available_slots -= 1
                    save_state(state)

            # Status heartbeat
            print(f"[{time.strftime('%H:%M:%S')}] Active Cloud Workers: {len(active_dict)}/{args.concurrency} | "
                  f"Completed: {len(completed_set)}/{len(queue)} | "
                  f"Failed: {len(failed_dict)}", end="\r", flush=True)

            time.sleep(args.poll_interval)

    except KeyboardInterrupt:
        print("\n\n[!] Interrupted by user. Saving state...")
        save_state(state)
        print("[✓] State saved cleanly. You can resume anytime by re-running the script.")


if __name__ == "__main__":
    main()
