#!/usr/bin/env python3
"""
scripts/batch_dispatch_queue.py

Reads processing_queue.json (chronological: most recent to oldest)
and dispatches transcribe_episode.yml workflow on GitHub Actions sequentially.
Monitors progress in the cloud with zero local downloads or disk usage.
"""

import sys
import time
import json
import subprocess
from pathlib import Path

QUEUE_FILE = Path("processing_queue.json")

def get_current_run_status(tag: str):
    """Checks the status of the latest run for a given release tag."""
    cmd = ["gh", "run", "list", "--workflow=transcribe_episode.yml", "--limit", "5", "--json", "databaseId,status,conclusion,displayTitle,createdAt"]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        return None
    try:
        runs = json.loads(res.stdout)
        for r in runs:
            if tag in r.get("displayTitle", ""):
                return r
    except Exception:
        pass
    return None

def main():
    if not QUEUE_FILE.exists():
        print("[!] processing_queue.json not found. Run scripts/audit_queue.py first.")
        sys.exit(1)
        
    with open(QUEUE_FILE, "r", encoding="utf-8") as f:
        queue = json.load(f)
        
    print(f"[*] Loaded {len(queue)} episodes from queue (Most Recent to Oldest).")
    
    # Optional slice / start index
    start_idx = 0
    if len(sys.argv) > 1:
        try:
            start_idx = int(sys.argv[1]) - 1
        except ValueError:
            pass
            
    items_to_process = queue[start_idx:]
    print(f"[*] Starting dispatch from item #{start_idx + 1} ({len(items_to_process)} remaining)...")
    
    for i, item in enumerate(items_to_process, start=start_idx + 1):
        tag = item["tag"]
        title = item["title"]
        mode = item["mode"]
        
        print(f"\n==================================================================")
        print(f"[{i}/{len(queue)}] Dispatching: {title}")
        print(f"Tag:    {tag}")
        print(f"Mode:   {mode}")
        print(f"Time:   {time.strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"==================================================================")
        
        # Trigger workflow
        dispatch_cmd = ["gh", "workflow", "run", "transcribe_episode.yml", "-f", f"release_tag={tag}"]
        res = subprocess.run(dispatch_cmd, capture_output=True, text=True)
        if res.returncode != 0:
            print(f"[!] Dispatch error: {res.stderr}")
            time.sleep(5)
            continue
            
        print(f"[✓] Workflow dispatched successfully in the cloud.")
        print(f"[*] Waiting for cloud run to initialize...")
        time.sleep(15)
        
        # Monitor until completion
        while True:
            run_cmd = ["gh", "run", "list", "--workflow=transcribe_episode.yml", "--limit", "1", "--json", "databaseId,status,conclusion,updatedAt"]
            run_res = subprocess.run(run_cmd, capture_output=True, text=True)
            if run_res.returncode == 0:
                try:
                    runs = json.loads(run_res.stdout)
                    if runs:
                        latest = runs[0]
                        status = latest.get("status")
                        conclusion = latest.get("conclusion")
                        run_id = latest.get("databaseId")
                        
                        if status == "completed":
                            print(f"[✓] Run {run_id} completed with status: {conclusion}")
                            break
                        else:
                            print(f"  [*] Run {run_id} is {status}... ({time.strftime('%H:%M:%S')})")
                except Exception:
                    pass
            time.sleep(20)
            
        print(f"[✓] Finished episode #{i}: {title}")
        time.sleep(5)

if __name__ == "__main__":
    main()
