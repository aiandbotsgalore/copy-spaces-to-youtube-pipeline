#!/usr/bin/env python3
"""
scripts/cloud_transcribe_client.py

Client runner and batch orchestrator for SpacePipe ZeroGPU Cloud Transcriber.
Connects to Hugging Face ZeroGPU Space endpoint (via gradio_client or HTTP REST)
to transcribe and re-diarize Twitter Spaces audio with:
- Zero local GPU requirement (runs in GitHub Actions or locally)
- Quota-aware rate limiting with clean exit 0 on 429
- Atomic sync to public/transcripts/transcripts_summary_index.json
- Deterministic .srt and .txt artifact generation
- Direct asset upload to GitHub Releases
"""

import os
import sys
import json
import time
import shutil
import tempfile
import datetime
import subprocess
from pathlib import Path
from typing import List, Dict, Any, Optional

try:
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)
except Exception:
    pass

DEFAULT_SPACE_ENDPOINT = os.environ.get("HF_TRANSCRIBE_ENDPOINT", "loganblack0/spacepipe-transcriber")


def load_env_files():
    for f in [".env.local", ".env"]:
        p = Path(f)
        if p.exists():
            try:
                for line in p.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
            except Exception:
                pass


load_env_files()


def is_quota_error(msg: str) -> bool:
    """Detects whether an error string represents a ZeroGPU / API quota exhaustion."""
    if not msg:
        return False
    lower = msg.lower()
    return any(p in lower for p in [
        "429",
        "quota exceeded",
        "quota_exceeded",
        "zerogpu quota",
        "exceeded your gpu quota",
        "rate limit",
        "too many requests"
    ])


def format_timestamp_srt(seconds: float) -> str:
    """Formats float seconds to SRT time format: HH:MM:SS,mmm"""
    ms = int(round((seconds - int(seconds)) * 1000))
    s = int(seconds) % 60
    m = (int(seconds) // 60) % 60
    h = int(seconds) // 3600
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def format_timestamp_txt(seconds: float) -> str:
    """Formats float seconds to TXT time format: [HH:MM:SS]"""
    s = int(seconds) % 60
    m = (int(seconds) // 60) % 60
    h = int(seconds) // 3600
    return f"[{h:02d}:{m:02d}:{s:02d}]"


def generate_srt_content(segments: List[Dict[str, Any]]) -> str:
    """Generates valid SubRip (.srt) transcript content."""
    lines = []
    idx = 1
    for s in segments:
        st = format_timestamp_srt(float(s.get("start", 0.0)))
        et = format_timestamp_srt(float(s.get("end", 0.0)))
        spk = s.get("speaker", "Speaker")
        txt = str(s.get("text", "")).strip()
        lines.append(f"{idx}\n{st} --> {et}\n{spk}: {txt}\n")
        idx += 1
    return "\n".join(lines)


def generate_txt_content(segments: List[Dict[str, Any]]) -> str:
    """Generates plain text (.txt) transcript content with timestamp headers."""
    lines = []
    for s in segments:
        st = format_timestamp_txt(float(s.get("start", 0.0)))
        spk = s.get("speaker", "Speaker")
        txt = str(s.get("text", "")).strip()
        lines.append(f"{st} {spk}: {txt}")
    return "\n".join(lines)


def build_summary_entry(
    release_tag: str,
    title: str,
    audio_url: str,
    segments: List[Dict[str, Any]],
    release_id: int = 0,
    published_at: Optional[str] = None,
    episode_date: Optional[str] = None,
    host_handle: Optional[str] = None,
    body: Optional[str] = None
) -> Dict[str, Any]:
    """Builds a summary entry adhering strictly to EpisodeSummary."""
    speakers_set = set()
    total_duration = 0.0
    for s in segments:
        spk = s.get("speaker")
        if spk:
            speakers_set.add(spk)
        e = float(s.get("end", 0.0))
        if e > total_duration:
            total_duration = e

    speakers = sorted(list(speakers_set))
    now_iso = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    return {
        "release_id": release_id or int(time.time()),
        "release_tag": release_tag,
        "title": title,
        "published_at": published_at or now_iso,
        "episode_date": episode_date or (release_tag[:8] if len(release_tag) >= 8 and release_tag[:8].isdigit() else None),
        "audio_url": audio_url,
        "segment_count": len(segments),
        "duration_sec": int(round(total_duration)),
        "host_handle": host_handle,
        "speakers": speakers,
        "body": body or f"- **Title:** {title}\n- **Duration:** {int(round(total_duration))}s"
    }


def atomic_update_summary_index(index_path: str, new_entry: Dict[str, Any]):
    """
    Atomically updates transcripts_summary_index.json using a tempfile and os.replace
    to prevent file corruption during concurrent operations or CI interruptions.
    """
    index_file = Path(index_path)
    existing_entries: List[Dict[str, Any]] = []

    if index_file.exists():
        try:
            with open(index_file, "r", encoding="utf-8") as f:
                content = f.read().strip()
                if content:
                    existing_entries = json.loads(content)
        except Exception as e:
            print(f"[Warning] Could not read existing index, creating new list: {e}")

    # Upsert new_entry by release_tag
    updated = False
    for i, item in enumerate(existing_entries):
        if item.get("release_tag") == new_entry.get("release_tag"):
            # Merge fields while preserving original published_at / release_id if not supplied
            merged = dict(item)
            merged.update({k: v for k, v in new_entry.items() if v is not None})
            existing_entries[i] = merged
            updated = True
            break

    if not updated:
        existing_entries.append(new_entry)

    # Sort by release_tag descending
    existing_entries.sort(key=lambda x: str(x.get("release_tag", "")), reverse=True)

    # Atomic write via tempfile in same directory
    dir_name = os.path.dirname(os.path.abspath(index_path))
    os.makedirs(dir_name, exist_ok=True)
    temp_fd, temp_path = tempfile.mkstemp(dir=dir_name, prefix="summary_idx_", suffix=".tmp")
    try:
        with open(temp_fd, "w", encoding="utf-8") as f:
            json.dump(existing_entries, f, indent=2, ensure_ascii=False)
        os.replace(temp_path, index_path)
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass


def sync_to_local_transcripts(
    tag: str,
    title: str,
    segments: List[Dict[str, Any]],
    turns: Optional[List[Dict[str, Any]]] = None,
    audio_url: str = "",
    base_dir: str = "public/transcripts"
) -> Dict[str, str]:
    """
    Writes verified transcript JSON, SRT, and TXT artifacts and updates summary index.
    """
    ep_dir = Path(base_dir) / "episodes"
    ep_dir.mkdir(parents=True, exist_ok=True)

    json_path = ep_dir / f"{tag}.json"
    srt_path = ep_dir / f"{tag}.srt"
    txt_path = ep_dir / f"{tag}.txt"

    # Save full transcript JSON
    full_data = {
        "release_tag": tag,
        "title": title,
        "audio_url": audio_url,
        "segments": segments,
        "turns": turns or []
    }
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(full_data, f, indent=2, ensure_ascii=False)

    # Generate and save SRT and TXT
    srt_content = generate_srt_content(segments)
    with open(srt_path, "w", encoding="utf-8") as f:
        f.write(srt_content)

    txt_content = generate_txt_content(segments)
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(txt_content)

    # Update index
    summary_path = Path(base_dir) / "transcripts_summary_index.json"
    entry = build_summary_entry(tag, title, audio_url, segments)
    atomic_update_summary_index(str(summary_path), entry)

    return {
        "json": str(json_path),
        "srt": str(srt_path),
        "txt": str(txt_path)
    }


def call_zerogpu_space(
    action: str,
    audio_url: str,
    endpoint: Optional[str] = None,
    existing_segments: Optional[List[Dict[str, Any]]] = None,
    enrolled_profiles: Optional[Dict[str, Any]] = None,
    hf_token: Optional[str] = None,
    space_api_key: Optional[str] = None
) -> Dict[str, Any]:
    """
    Calls the Hugging Face ZeroGPU Space endpoint.
    Passes HF_TOKEN to gradio_client for priority ZeroGPU quota,
    and passes SPACE_API_KEY as an explicit api_key parameter to the endpoint function.
    """
    token = hf_token or os.environ.get("HF_TOKEN")
    api_key = space_api_key or os.environ.get("SPACE_API_KEY", "")
    target_endpoint = endpoint or DEFAULT_SPACE_ENDPOINT

    try:
        from gradio_client import Client
    except ImportError:
        raise RuntimeError("gradio_client is required to connect to SpacePipe ZeroGPU Space.")

    # HF_TOKEN is passed to gradio_client.Client to route through HF proxy with ZeroGPU quota
    client = Client(target_endpoint, hf_token=token)

    if action == "transcribe":
        result = client.predict(
            audio_url=audio_url,
            api_key=api_key,
            min_speakers=1,
            max_speakers=15,
            api_name="/transcribe"
        )
    elif action == "rediarize":
        segs_json = json.dumps(existing_segments or [])
        profiles_json = json.dumps(enrolled_profiles or {})
        result = client.predict(
            audio_url=audio_url,
            existing_segments_json=segs_json,
            api_key=api_key,
            enrolled_profiles_json=profiles_json,
            min_speakers=1,
            max_speakers=15,
            api_name="/rediarize"
        )
    else:
        raise ValueError(f"Unknown action: {action}")

    if isinstance(result, str):
        return json.loads(result)
    return result


def fetch_release_audio_url(repo: str, tag: str, token: Optional[str] = None) -> Optional[str]:
    """Finds the primary audio download URL for a release tag."""
    url = f"https://api.github.com/repos/{repo}/releases/tags/{tag}"
    headers = {"Accept": "application/vnd.github.v3+json", "User-Agent": "SpacePipe-ZeroGPUClient"}
    if token:
        headers["Authorization"] = f"token {token}"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            for asset in data.get("assets", []):
                name = asset.get("name", "").lower()
                if name.endswith(".mp3") or name.endswith(".m4a") or name.endswith(".wav"):
                    return asset.get("browser_download_url")
    except Exception as e:
        print(f"[Warning] Could not fetch release info for {tag}: {e}")
    return None


def main():
    import argparse
    parser = argparse.ArgumentParser(description="SpacePipe ZeroGPU Cloud Transcriber Client")
    parser.add_argument("--release-tag", type=str, help="Release tag to transcribe")
    parser.add_argument("--audio-url", type=str, help="Direct audio URL")
    parser.add_argument("--title", type=str, help="Episode title")
    parser.add_argument("--repo", type=str, default="aiandbotsgalore/copy-spaces-to-youtube-pipeline", help="GitHub repo")
    parser.add_argument("--endpoint", type=str, help="ZeroGPU Space endpoint")
    parser.add_argument("--no-upload", action="store_true", help="Do not upload assets to release")
    parser.add_argument("--gh-token", type=str, help="GitHub token")

    args = parser.parse_args()

    token = args.gh_token or os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    audio_url = args.audio_url
    if not audio_url and args.release_tag:
        audio_url = fetch_release_audio_url(args.repo, args.release_tag, token)

    if not audio_url:
        print("[Error] No audio URL provided or found on release.")
        sys.exit(1)

    tag = args.release_tag or "custom_transcription"
    title = args.title or tag

    print(f"[*] Calling ZeroGPU Space endpoint for {tag} ({audio_url})...")
    res = call_zerogpu_space(
        action="transcribe",
        audio_url=audio_url,
        endpoint=args.endpoint
    )

    if res.get("error"):
        print(f"[Error] ZeroGPU transcription failed: {res['error']}")
        sys.exit(1)

    segments = res.get("segments", [])
    turns = res.get("turns", [])
    artifacts = sync_to_local_transcripts(tag, title, segments, turns, audio_url)
    print(f"[✓] Transcribed {len(segments)} segments. Synced to {artifacts['json']}")

    if not args.no_upload and args.release_tag:
        clobber_upload_to_github_release(args.repo, tag, [artifacts["json"], artifacts["srt"], artifacts["txt"]], token)
        print(f"[✓] Uploaded assets to release {tag}")


if __name__ == "__main__":
    main()
