#!/usr/bin/env python3
"""
scripts/report_dlq_issue.py
SpacePipe Automated Dead-Letter Queue (DLQ) Issue Reporter & Triage

Analyzes workflow failure logs, performs root-cause diagnostics, and creates/updates
a GitHub Issue with label 'dlq-quarantine'. Enables bidirectional comment-driven re-execution (/retry).
"""

import os
import sys
import json
import argparse
import urllib.request
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(description="Report workflow failure to GitHub Issues DLQ")
    parser.add_argument("--workflow", required=True, help="Workflow name (e.g. 'Enroll Voice Profile')")
    parser.add_argument("--run-id", default=os.environ.get("GITHUB_RUN_ID", "0"), help="GitHub Actions Run ID")
    parser.add_argument("--target", default="Unknown", help="Target entity (release tag, speaker, URL)")
    parser.add_argument("--log-file", default="", help="Path to execution log file")
    parser.add_argument("--error-summary", default="", help="Direct error message summary")
    return parser.parse_args()


def diagnose_root_cause(log_path: str, fallback_error: str) -> tuple[str, str]:
    """Inspects log contents to extract root cause and remediation advice."""
    content = ""
    if log_path and os.path.exists(log_path):
        try:
            with open(log_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
        except Exception as e:
            content = f"Failed to read log file {log_path}: {e}"

    combined = (content + "\n" + fallback_error).strip()

    # Pattern Matching for Root Causes
    if "VAD < 1.0s" in combined or "All audio clips failed pre-flight" in combined:
        return (
            "Audio pre-flight rejection (VAD < 1.0s or silent audio)",
            "The source audio had insufficient continuous speech. Ensure audio contains clean vocal turns without background music, or provide larger segment windows."
        )
    if "AssemblyAI Authentication Failed" in combined or "Invalid API key" in combined:
        return (
            "AssemblyAI Authentication Failed (Invalid API Key)",
            "Check that repository secret `ASSEMBLYAI_API_KEY` is set and valid in repository settings."
        )
    if "Insufficient Credits" in combined or "spend limit" in combined.lower():
        return (
            "API Provider Credit Limit Exhausted",
            "The external transcription provider (AssemblyAI/Deepgram) reported zero balance or reached spend limit. Top up account or switch to Kaggle WhisperX worker."
        )
    if "Model initialization failed" in combined or "SpeechBrain unreachable" in combined or "429 Client Error" in combined:
        return (
            "Transient HuggingFace/SpeechBrain Rate Limit or Timeout",
            "Hugging Face hub returned 429 Too Many Requests or network timeout. Auto-remediation with cache or exponential backoff will resolve this on retry."
        )
    if "Twitter Space ended and replay is disabled" in combined or "replay is disabled" in combined:
        return (
            "Twitter Space Replay Disabled by Host (Permanent Failure)",
            "The host ended this Twitter Space without enabling recording/replay. Audio cannot be retrieved and this space should be quarantined."
        )
    if "Twitter Space not found" in combined:
        return (
            "Twitter Space Not Found (Deleted or Invalid ID - Permanent Failure)",
            "The Twitter Space has been deleted from X or the Space ID is invalid. This space should be quarantined."
        )
    if "Denied by access control" in combined or "Authorization: Denied" in combined:
        return (
            "Twitter Space Access Denied (Private / Restricted Space)",
            "The Twitter Space is restricted, private, or denied by X access control. Guest tokens cannot access this broadcast."
        )
    if "No MP3 file was generated" in combined or "yt-dlp" in combined:
        return (
            "yt-dlp Download Failure (Space Unavailable or Expired)",
            "Audio stream could not be captured. Verify that the Space URL is public, finished, or available as a recorded broadcast."
        )
    if "No such file or directory: 'ffmpeg'" in combined or "ffmpeg: command not found" in combined:
        return (
            "Missing System Dependency: FFmpeg",
            "FFmpeg was not present on the runner environment. Verify runner setup or container image."
        )

    # Fallback to last non-empty line
    lines = [l.strip() for l in combined.splitlines() if l.strip()]
    last_line = lines[-1][:200] if lines else "Unspecified workflow step execution failure"
    return (
        f"Execution Error: {last_line}",
        "Review workflow execution log in GitHub Actions to determine root cause, then comment `/retry` on this issue."
    )


def gh_api_request(method: str, path: str, token: str, repo: str, payload: dict = None) -> dict | list | None:
    url = f"https://api.github.com/repos/{repo}{path}"
    headers = {
        "Accept": "application/vnd.github.v3+json",
        "Authorization": f"token {token}",
        "User-Agent": "SpacePipe-DLQ-Triage"
    }
    data = json.dumps(payload).encode("utf-8") if payload else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30.0) as resp:
            content = resp.read().decode("utf-8")
            return json.loads(content) if content else {}
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8", errors="ignore")
        print(f"[!] GitHub API {method} {path} error {e.code}: {err_msg}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"[!] GitHub API request failed: {e}", file=sys.stderr)
        return None


def main():
    args = parse_args()
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    repo = os.environ.get("GITHUB_REPOSITORY")
    server_url = os.environ.get("GITHUB_SERVER_URL", "https://github.com")

    if not token or not repo:
        print("[!] Notice: GITHUB_TOKEN or GITHUB_REPOSITORY missing; DLQ issue reporting skipped.", file=sys.stderr)
        sys.exit(0)

    root_cause, advice = diagnose_root_cause(args.log_file, args.error_summary)
    run_url = f"{server_url}/{repo}/actions/runs/{args.run_id}" if args.run_id != "0" else "N/A"
    target_clean = args.target.strip()
    issue_title = f"[DLQ] {args.workflow}: {target_clean}"

    # Extract log excerpt
    log_snippet = ""
    if args.log_file and os.path.exists(args.log_file):
        try:
            with open(args.log_file, "r", encoding="utf-8", errors="ignore") as f:
                lines = f.readlines()
                log_snippet = "".join(lines[-35:])
        except Exception:
            pass

    body = f"""## 🚨 Dead-Letter Queue (DLQ) Quarantined Job

The automated workflow **`{args.workflow}`** encountered a fatal failure and has been quarantined.

| Parameter | Details |
| :--- | :--- |
| **Workflow** | `{args.workflow}` |
| **Target** | `{target_clean}` |
| **GitHub Run** | [View Run #{args.run_id}]({run_url}) |
| **Quarantined At** | `{datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")}` |
| **Root Cause** | **{root_cause}** |

---

### 🩺 Suggested Remediation
> {advice}

### 🔁 Self-Healing Re-Execution
To re-dispatch this job automatically, post a comment on this issue with:
```
/retry
```
Once the retried workflow run succeeds, **this issue will automatically be closed**.

<details>
<summary><b>View Failure Log Snippet (Last 35 lines)</b></summary>

```log
{log_snippet or "No additional log text recorded."}
```
</details>

<!-- SPACEPIPE_DLQ_METADATA
workflow={args.workflow}
target={target_clean}
run_id={args.run_id}
-->
"""

    # Check for existing open DLQ issue for this target to prevent duplicate spam
    print(f"[*] Checking for existing open DLQ issue for: {issue_title}...")
    existing_issues = gh_api_request("GET", f"/issues?state=open&labels=dlq-quarantine&per_page=50", token, repo)
    matched_issue = None
    if isinstance(existing_issues, list):
        for iss in existing_issues:
            if target_clean in iss.get("title", "") and args.workflow in iss.get("title", ""):
                matched_issue = iss
                break

    if matched_issue:
        issue_number = matched_issue["number"]
        print(f"[✓] Found existing open DLQ issue #{issue_number}. Appending update comment...")
        comment_payload = {
            "body": f"⚠️ **Recurring Failure Update** (Run #{args.run_id}):\n\n- **Root Cause:** {root_cause}\n- **Log Link:** {run_url}\n\nComment `/retry` to attempt execution again."
        }
        gh_api_request("POST", f"/issues/{issue_number}/comments", token, repo, comment_payload)
    else:
        print(f"[*] Opening new DLQ issue: {issue_title}...")
        issue_payload = {
            "title": issue_title,
            "body": body,
            "labels": ["dlq-quarantine", "automated-triage", f"workflow:{args.workflow.lower().replace(' ', '-')}"]
        }
        res = gh_api_request("POST", "/issues", token, repo, issue_payload)
        if res and "number" in res:
            print(f"[✓] Created DLQ Issue #{res['number']} successfully!")


if __name__ == "__main__":
    main()
