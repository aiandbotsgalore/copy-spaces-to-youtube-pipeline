import sys
import argparse
import subprocess
import json
import shutil
import time

def check_yt_dlp():
    """Verify yt-dlp is installed and accessible."""
    if not shutil.which("yt-dlp"):
        print("Error: yt-dlp not found in PATH")
        return False
    return True

PERMANENT_PATTERNS = (
    "video unavailable",
    "private video",
    "account is suspended",
    "twitter space ended and replay is disabled",
    "replay is disabled",
    "space ended and replay is disabled",
    "login required",
    "this space is unavailable",
)


def classify_failure(stderr_text):
    stderr = (stderr_text or "").lower()
    for pattern in PERMANENT_PATTERNS:
        if pattern in stderr:
            return "permanent"
    return "transient"


def preflight_check(url, timeout=45, retries=3, retry_delay=4):
    """
    Run a strict pre-flight check on the URL using yt-dlp simulation.
    Returns:
        0 if healthy/downloadable
        1 if permanently failed/invalid
        2 if transiently failed (network/timeout)
    """
    attempts = max(1, retries)
    last_reason = ""
    transient_seen = False

    for attempt in range(1, attempts + 1):
        cmd = [
            "yt-dlp",
            "--simulate",
            "--quiet",
            "--no-warnings",
            "--dump-json",
            "--socket-timeout", str(timeout),
            url
        ]

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout
            )

            if result.returncode == 0:
                try:
                    json.loads(result.stdout)
                    if attempt > 1:
                        print(f"Recovered after transient errors on attempt {attempt}/{attempts}")
                    return 0
                except json.JSONDecodeError:
                    # Some extractor outputs can still succeed without strict JSON parse.
                    if attempt > 1:
                        print(f"Recovered after transient errors on attempt {attempt}/{attempts}")
                    return 0

            failure_class = classify_failure(result.stderr)
            if failure_class == "permanent":
                print(
                    f"Permanent: yt-dlp exited with {result.returncode} on attempt {attempt}/{attempts}\n"
                    f"Stderr:\n{(result.stderr or '').strip()}"
                )
                return 1

            transient_seen = True
            last_reason = (
                f"Transient: yt-dlp exited with {result.returncode} on attempt {attempt}/{attempts}\n"
                f"Stderr:\n{(result.stderr or '').strip()}"
            )
            if attempt < attempts:
                time.sleep(max(0, retry_delay))

        except subprocess.TimeoutExpired:
            transient_seen = True
            last_reason = f"Transient: Pre-flight check timed out after {timeout}s on attempt {attempt}/{attempts}"
            if attempt < attempts:
                time.sleep(max(0, retry_delay))
        except Exception as e:
            transient_seen = True
            last_reason = f"Transient: Unexpected error on attempt {attempt}/{attempts}: {str(e)}"
            if attempt < attempts:
                time.sleep(max(0, retry_delay))

    if transient_seen:
        print(last_reason)
    return 2

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Strict pre-flight check for Twitter Spaces")
    parser.add_argument("--url", required=True, help="URL to check")
    parser.add_argument("--timeout", type=int, default=45, help="Timeout in seconds")
    parser.add_argument("--retries", type=int, default=3, help="Number of preflight attempts")
    parser.add_argument("--retry-delay", type=int, default=4, help="Seconds between retries")
    
    args = parser.parse_args()
    
    if not check_yt_dlp():
        sys.exit(2)
        
    exit_code = preflight_check(args.url, args.timeout, args.retries, args.retry_delay)
    sys.exit(exit_code)
