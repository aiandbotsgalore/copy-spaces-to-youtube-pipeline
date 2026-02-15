import sys
import argparse
import subprocess
import json
import shutil

def check_yt_dlp():
    """Verify yt-dlp is installed and accessible."""
    if not shutil.which("yt-dlp"):
        print("Error: yt-dlp not found in PATH")
        return False
    return True

def preflight_check(url, timeout=45):
    """
    Run a strict pre-flight check on the URL using yt-dlp simulation.
    Returns:
        0 if healthy/downloadable
        1 if permanently failed/invalid
        2 if transiently failed (network/timeout)
    """
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
        # Run with timeout to prevent hanging on stuck connections
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout
        )
        
        if result.returncode == 0:
            # Success! Parse JSON to double-check duration/availability
            try:
                data = json.loads(result.stdout)
                if data.get('is_live') is True:
                     # Live spaces are technically valid, but might be empty. 
                     # For now, we treat them as valid.
                     return 0
                return 0
            except json.JSONDecodeError:
                # If we can't parse JSON but return code was 0, it's risky.
                print("Warning: yt-dlp matched but returned invalid JSON")
                return 0

        # Analyze stderr for specific failure reasons
        stderr = result.stderr.lower()
        
        if "video unavailable" in stderr:
            print(f"Permanent: Video unavailable for {url}")
            return 1
        if "private video" in stderr:
            print(f"Permanent: Private video for {url}")
            return 1
        if "account is suspended" in stderr:
            print(f"Permanent: Account suspended for {url}")
            return 1
        
        # Default to transient failure for other non-zero codes
        print(f"Transient: yt-dlp exited with {result.returncode}\nStderr:\n{stderr}")
        return 2

    except subprocess.TimeoutExpired:
        print(f"Transient: Pre-flight check timed out after {timeout}s")
        return 2
    except Exception as e:
        print(f"Transient: Unexpected error: {str(e)}")
        return 2

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Strict pre-flight check for Twitter Spaces")
    parser.add_argument("--url", required=True, help="URL to check")
    parser.add_argument("--timeout", type=int, default=45, help="Timeout in seconds")
    
    args = parser.parse_args()
    
    if not check_yt_dlp():
        sys.exit(2)
        
    exit_code = preflight_check(args.url, args.timeout)
    sys.exit(exit_code)
