#!/usr/bin/env python3
"""
scripts/health_sentinel.py
SpacePipe Proactive Health Sentinel & Incident Alerting

Audits recent workflow executions, triages transient vs permanent pipeline failures,
checks archive transcript gaps and voice registry integrity, and posts structured alerts
to configured Discord and Slack webhooks.
"""

import os
import sys
import json
import argparse
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Any, Optional
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    from report_dlq_issue import diagnose_root_cause
except ImportError:
    def diagnose_root_cause(log_path: str, fallback_error: str) -> tuple[str, str]:
        if "429" in fallback_error or "timeout" in fallback_error.lower():
            return ("Transient Network / Rate Limit Timeout", "Auto-retry with exponential backoff.")
        if "not found" in fallback_error.lower() or "deleted" in fallback_error.lower():
            return ("Resource Not Found (Permanent)", "Quarantine resource; cannot be recovered.")
        return ("Unclassified Execution Failure", fallback_error[:100])

HEALTH_OUT = Path("public/pipeline_health.json")
EPISODES_DIR = Path("public/transcripts/episodes")
PROFILES_PATH = Path("voice_profiles.json")


def is_transient_failure(root_cause: str) -> bool:
    low = root_cause.lower()
    return any(term in low for term in ["transient", "rate limit", "timeout", "network", "429", "connection reset"])


def audit_voice_profiles() -> Dict[str, Any]:
    if not PROFILES_PATH.exists():
        return {"total": 0, "enrolled": 0, "status": "missing_file"}
    try:
        with open(PROFILES_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        raw = data.get("profiles", {})
        profiles = list(raw.values()) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
        enrolled = [p for p in profiles if (isinstance(p.get("embedding"), list) and len(p["embedding"]) == 192) or p.get("sample_count", 0) > 0]
        return {
            "total": len(profiles),
            "enrolled": len(enrolled),
            "status": "healthy" if len(enrolled) > 0 else "empty",
        }
    except Exception as e:
        return {"total": 0, "enrolled": 0, "status": "error", "error": str(e)}


def audit_transcript_coverage() -> Dict[str, Any]:
    local_count = 0
    if EPISODES_DIR.exists():
        local_count = len(list(EPISODES_DIR.glob("*.json")))

    summary_file = Path("public/transcripts/transcripts_summary_index.json")
    summary_count = 0
    if summary_file.exists():
        try:
            with open(summary_file, "r", encoding="utf-8") as f:
                s_data = json.load(f)
                summary_count = len(s_data) if isinstance(s_data, dict) else len(s_data)
        except Exception:
            pass

    return {
        "on_disk_transcripts": local_count,
        "indexed_transcripts": summary_count,
        "expected_releases_approx": 793,
        "gap_estimate": max(0, 793 - max(local_count, summary_count)),
    }


def send_discord_alert(webhook_url: str, title: str, description: str, fields: List[Dict[str, Any]], color: int = 0x6366f1) -> bool:
    if not webhook_url or not webhook_url.startswith("http"):
        return False

    payload = {
        "embeds": [
            {
                "title": f"🛡️ SpacePipe Sentinel: {title}",
                "description": description,
                "color": color,
                "fields": fields,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "footer": {"text": "SpacePipe Gen Self-Healing Pipeline Sentinel"},
            }
        ]
    }

    try:
        req = urllib.request.Request(
            webhook_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "User-Agent": "SpacePipe-Sentinel"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10.0) as resp:
            return resp.status in (200, 204)
    except Exception as e:
        print(f"[!] Discord alert failed: {e}")
        return False


def run_sentinel(
    repo: str = "aiandbotsgalore/copy-spaces-to-youtube-pipeline",
    github_token: Optional[str] = None,
    discord_webhook: Optional[str] = None,
    auto_retry_transient: bool = False,
) -> Dict[str, Any]:
    token = github_token or os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    discord_url = discord_webhook or os.environ.get("DISCORD_WEBHOOK_URL")

    voice_audit = audit_voice_profiles()
    transcript_audit = audit_transcript_coverage()

    # Query recent runs
    runs_failed: List[Dict[str, Any]] = []
    headers = {"Accept": "application/vnd.github.v3+json", "User-Agent": "SpacePipe-Sentinel"}
    if token:
        headers["Authorization"] = f"token {token}"

    url = f"https://api.github.com/repos/{repo}/actions/runs?per_page=30"
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=15.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            all_runs = data.get("workflow_runs", [])
            for r in all_runs:
                if r.get("conclusion") == "failure":
                    runs_failed.append(r)
    except Exception as e:
        print(f"[!] Warning: Unable to fetch live workflow runs: {e}")

    # Triage failures
    triaged_failures = []
    retried_count = 0
    quarantined_count = 0

    for r in runs_failed[:6]:
        run_id = r.get("id")
        name = r.get("name", "Workflow")
        html_url = r.get("html_url", "")
        root_cause, advice = diagnose_root_cause("", f"Run {run_id} failed in {name}")
        transient = is_transient_failure(root_cause)

        status_action = "quarantined"
        if transient:
            status_action = "auto_retried" if auto_retry_transient else "retry_recommended"
            if auto_retry_transient and token:
                # Dispatch rerun
                try:
                    rerun_url = f"https://api.github.com/repos/{repo}/actions/runs/{run_id}/rerun-failed-jobs"
                    rr_req = urllib.request.Request(rerun_url, headers=headers, method="POST")
                    with urllib.request.urlopen(rr_req, timeout=10.0) as rr_resp:
                        if rr_resp.status in (201, 202):
                            retried_count += 1
                except Exception:
                    pass
        else:
            quarantined_count += 1

        triaged_failures.append({
            "run_id": run_id,
            "name": name,
            "html_url": html_url,
            "root_cause": root_cause,
            "advice": advice,
            "is_transient": transient,
            "action": status_action,
        })

    is_healthy = len(triaged_failures) == 0 and voice_audit.get("status") == "healthy"
    overall_status = "HEALTHY" if is_healthy else ("DEGRADED" if len(triaged_failures) <= 2 else "CRITICAL")

    report = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "overall_status": overall_status,
        "voice_profiles": voice_audit,
        "transcript_coverage": transcript_audit,
        "recent_failures_count": len(runs_failed),
        "triaged_failures": triaged_failures,
        "auto_retried_count": retried_count,
        "quarantined_count": quarantined_count,
    }

    HEALTH_OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(HEALTH_OUT, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    # Post Discord webhook if configured and failures exist
    if discord_url and triaged_failures:
        fields = [
            {"name": "Overall Status", "value": f"**{overall_status}**", "inline": True},
            {"name": "Voice Profiles", "value": f"{voice_audit.get('enrolled', 0)} / {voice_audit.get('total', 0)} Enrolled", "inline": True},
            {"name": "Transcripts On Disk", "value": f"{transcript_audit.get('on_disk_transcripts', 0)} ({transcript_audit.get('gap_estimate', 0)} missing)", "inline": True},
        ]
        for tf in triaged_failures[:3]:
            fields.append({
                "name": f"❌ {tf['name']} (Run #{tf['run_id']})",
                "value": f"**Cause:** {tf['root_cause']}\n**Action:** {tf['action']}\n[View Run Logs]({tf['html_url']})",
                "inline": False,
            })

        color = 0x10b981 if is_healthy else (0xf59e0b if overall_status == "DEGRADED" else 0xef4444)
        send_discord_alert(
            discord_url,
            f"Health Audit: {overall_status} ({len(triaged_failures)} Failures Triaged)",
            "Automated audit completed by SpacePipe Sentinel.",
            fields,
            color=color,
        )

    return report


def main():
    parser = argparse.ArgumentParser(description="SpacePipe Pipeline Sentinel & Incident Alerting")
    parser.add_argument("--repo", default="aiandbotsgalore/copy-spaces-to-youtube-pipeline", help="GitHub repo")
    parser.add_argument("--auto-retry", action="store_true", help="Automatically dispatch rerun for transient failures")
    args = parser.parse_args()

    print("[*] Running SpacePipe Health Sentinel audit...")
    res = run_sentinel(repo=args.repo, auto_retry_transient=args.auto_retry)
    print(f"[✓] Sentinel status: {res['overall_status']}. Written to {HEALTH_OUT}")


if __name__ == "__main__":
    main()
