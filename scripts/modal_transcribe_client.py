#!/usr/bin/env python3
"""
scripts/modal_transcribe_client.py

Client runner and batch orchestrator for SpacePipe Modal WhisperX Neural Transcriber.
Transcribes Twitter Space audio on Modal NVIDIA L4 GPUs with:
- faster-whisper large-v3 + Silero VAD v5
- wav2vec2 millisecond word-level forced alignment
- pyannote.audio 3.1 neural speaker diarization
- SpeechBrain ECAPA-TDNN biometric voiceprint recognition
- Automatic sync to public/transcripts/ and GitHub Release assets
- Automatic highlight clip extraction trigger
"""

import os
import sys
import json
import time
import shutil
import base64
import argparse
import subprocess
import urllib.parse
import urllib.request
from pathlib import Path
from typing import List, Dict, Any, Optional

try:
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)
except Exception:
    pass

DEFAULT_MODAL_ENDPOINT = "https://blackreceiptemail--spacepipe-transcribe-transcribe-endpoint.us-east.modal.run"


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


def fetch_release_info(repo: str, tag: str, token: Optional[str] = None) -> Dict[str, Any]:
    url = f"https://api.github.com/repos/{repo}/releases/tags/{tag}"
    headers = {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "SpacePipe-ModalClient"
    }
    if token:
        headers["Authorization"] = f"token {token}"

    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def upload_asset_to_release(repo: str, tag: str, file_path: Path, token: Optional[str] = None):
    """Uploads a single asset to a GitHub release using gh CLI or REST API."""
    if not file_path.exists():
        return

    print(f"[*] Uploading {file_path.name} to GitHub Release {tag}...")
    # 1. Try gh release upload
    try:
        env = os.environ.copy()
        if token:
            env["GH_TOKEN"] = token
            env["GITHUB_TOKEN"] = token
        cmd = ["gh", "release", "upload", tag, str(file_path), "--repo", repo, "--clobber"]
        res = subprocess.run(cmd, env=env, capture_output=True, text=True)
        if res.returncode == 0:
            print(f"[✓] Uploaded {file_path.name} via gh CLI.")
            return
    except Exception:
        pass

    # 2. REST API Fallback
    try:
        rel = fetch_release_info(repo, tag, token)
        rel_id = rel.get("id")
        upload_url = f"https://uploads.github.com/repos/{repo}/releases/{rel_id}/assets?name={urllib.parse.quote(file_path.name)}"
        content_type = "application/json" if file_path.suffix == ".json" else "text/plain"
        headers = {
            "Content-Type": content_type,
            "User-Agent": "SpacePipe-ModalClient"
        }
        if token:
            headers["Authorization"] = f"token {token}"

        data = file_path.read_bytes()
        req = urllib.request.Request(upload_url, data=data, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=60) as resp:
            print(f"[✓] Uploaded {file_path.name} via REST API.")
    except Exception as e:
        print(f"[!] Warning: Could not upload {file_path.name}: {e}")


def sync_to_local_transcripts(release_tag: str, payload: Dict[str, Any], title: str, audio_url: str):
    """Saves transcript to public/transcripts/episodes/<tag>.json and updates summary manifest."""
    repo_root = Path(__file__).resolve().parent.parent
    episodes_dir = repo_root / "public" / "transcripts" / "episodes"
    episodes_dir.mkdir(parents=True, exist_ok=True)

    dest_json = episodes_dir / f"{release_tag}.json"
    full_payload = {
        "release_tag": release_tag,
        "title": title,
        "audio_url": audio_url,
        "duration_sec": payload.get("duration_sec", 0),
        "speakers": payload.get("speakers", []),
        "segments": payload.get("segments", [])
    }

    with open(dest_json, "w", encoding="utf-8") as f:
        json.dump(full_payload, f, indent=2, ensure_ascii=False)
    print(f"[✓] Saved local transcript to: {dest_json.relative_to(repo_root)}")

    # Update episodes_summary.json
    summary_path = repo_root / "public" / "transcripts" / "episodes_summary.json"
    summaries = []
    if summary_path.exists():
        try:
            with open(summary_path, "r", encoding="utf-8") as f:
                summaries = json.load(f)
        except Exception:
            summaries = []

    # Update or insert
    updated = False
    new_entry = {
        "release_tag": release_tag,
        "title": title,
        "audio_url": audio_url,
        "segment_count": len(payload.get("segments", [])),
        "duration_sec": payload.get("duration_sec", 0),
        "speakers": payload.get("speakers", [])
    }
    for idx, s in enumerate(summaries):
        if s.get("release_tag") == release_tag:
            summaries[idx] = {**s, **new_entry}
            updated = True
            break
    if not updated:
        summaries.append(new_entry)

    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summaries, f, indent=2, ensure_ascii=False)
    print(f"[✓] Synchronized episode summary manifest.")


def transcribe_single(
    release_tag: Optional[str] = None,
    audio_file: Optional[str] = None,
    audio_url: Optional[str] = None,
    title: Optional[str] = None,
    language: str = "en",
    repo: str = "aiandbotsgalore/copy-spaces-to-youtube-pipeline",
    modal_endpoint: str = DEFAULT_MODAL_ENDPOINT,
    upload_assets: bool = True,
    cut_clips: bool = True,
    gh_token: Optional[str] = None
) -> Dict[str, Any]:
    t0 = time.time()
    active_token = gh_token or os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or ""
    active_title = title or "Twitter Space"
    resolved_audio_url = audio_url or ""
    host_handle = ""

    # 1. Resolve Audio URL and Metadata from Release Tag if provided
    if release_tag and not audio_file and not resolved_audio_url:
        print(f"[*] Inspecting GitHub Release: {release_tag}...")
        rel_data = fetch_release_info(repo, release_tag, active_token)
        active_title = title or rel_data.get("name") or release_tag
        body = rel_data.get("body") or ""

        # Extract host handle if present
        import re
        m = re.search(r"@([a-zA-Z0-9_]{1,15})", body)
        if m:
            host_handle = m.group(1)

        # Find MP3 or M4A asset
        mp3_assets = [a for a in rel_data.get("assets", []) if a["name"].lower().endswith((".mp3", ".m4a"))]
        if not mp3_assets:
            raise RuntimeError(f"No audio asset (.mp3/.m4a) found in release {release_tag}.")
        resolved_audio_url = mp3_assets[0]["browser_download_url"]
        print(f"[*] Found audio asset: {mp3_assets[0]['name']} ({resolved_audio_url})")

    # 2. Build Request Payload for Modal
    post_data: Dict[str, Any] = {
        "title": active_title,
        "release_tag": release_tag or "ad-hoc",
        "host_handle": host_handle,
        "language": language
    }

    if audio_file:
        p = Path(audio_file)
        if not p.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_file}")
        print(f"[*] Reading local audio file: {p.resolve()} ({p.stat().st_size / (1024*1024):.1f} MB)")
        raw_bytes = p.read_bytes()
        post_data["audio_base64"] = base64.b64encode(raw_bytes).decode("ascii")
    elif resolved_audio_url:
        post_data["audio_url"] = resolved_audio_url
    else:
        raise ValueError("Must provide either --release-tag, --audio-file, or --audio-url.")

    # Include local voice profiles if available
    vp_path = Path(__file__).resolve().parent.parent / "voice_profiles.json"
    if vp_path.exists():
        try:
            with open(vp_path, "r", encoding="utf-8") as f:
                post_data["enrolled_profiles"] = json.load(f).get("profiles", {})
        except Exception:
            pass

    # 3. Call Modal Transcribe Endpoint
    print(f"\n=================================================================")
    print(f"[*] Submitting to SpacePipe Modal Cloud GPU...")
    print(f"    Endpoint: {modal_endpoint}")
    print(f"    Episode:  {active_title}")
    print(f"=================================================================")

    json_bytes = json.dumps(post_data).encode("utf-8")
    req = urllib.request.Request(
        modal_endpoint,
        data=json_bytes,
        headers={"Content-Type": "application/json", "User-Agent": "SpacePipe-ModalClient"},
        method="POST"
    )

    call_start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=3600) as resp:
            resp_body = resp.read().decode("utf-8")
            result = json.loads(resp_body)
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"Modal Endpoint returned HTTP {e.code}: {err_msg}") from e

    if "error" in result:
        raise RuntimeError(f"Modal Transcription Error: {result['error']}")

    dur = result.get("duration_sec", 0.0)
    elapsed = time.time() - call_start
    print(f"\n[✓] Modal Cloud GPU finished in {elapsed:.1f}s (Audio Duration: {dur:.1f}s, {dur/60:.1f} min)")
    print(f"    Segments: {len(result.get('segments', []))}")
    print(f"    Speakers: {result.get('speakers', [])}")

    # 4. Save Artifacts Locally
    out_dir = Path("public/output/transcripts")
    out_dir.mkdir(parents=True, exist_ok=True)
    tag_stem = release_tag or f"transcript_{int(time.time())}"

    json_file = out_dir / f"{tag_stem}.json"
    srt_file = out_dir / f"{tag_stem}.srt"
    txt_file = out_dir / f"{tag_stem}.txt"

    with open(json_file, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    with open(srt_file, "w", encoding="utf-8") as f:
        f.write(result.get("srt_content", ""))
    with open(txt_file, "w", encoding="utf-8") as f:
        f.write(result.get("txt_content", ""))

    print(f"[✓] Saved artifacts:")
    print(f"    • {json_file}")
    print(f"    • {srt_file}")
    print(f"    • {txt_file}")

    # 5. Sync to public/transcripts/
    if release_tag:
        sync_to_local_transcripts(release_tag, result, active_title, resolved_audio_url)

    # 6. Upload Assets to GitHub Release
    if release_tag and upload_assets:
        upload_asset_to_release(repo, release_tag, json_file, active_token)
        upload_asset_to_release(repo, release_tag, srt_file, active_token)
        upload_asset_to_release(repo, release_tag, txt_file, active_token)

    # 7. Extract Highlight Clips
    if release_tag and cut_clips:
        print("\n[*] Triggering automated Highlight Clip extraction...")
        clipper_script = Path(__file__).resolve().parent / "find_and_cut_best_clips.py"
        if clipper_script.exists():
            cmd = [sys.executable, str(clipper_script), "--release-tag", release_tag, "--repo", repo, "--limit", "5"]
            subprocess.run(cmd, env=os.environ.copy())

    total_time = time.time() - t0
    print(f"\n[🎉] Complete pipeline finished successfully in {total_time:.1f}s!")
    return result


def main():
    parser = argparse.ArgumentParser(description="SpacePipe Modal Cloud GPU Transcriber Client")
    parser.add_argument("--release-tag", type=str, help="GitHub release tag to transcribe")
    parser.add_argument("--audio-file", type=str, help="Path to local audio file")
    parser.add_argument("--audio-url", type=str, help="Direct audio URL")
    parser.add_argument("--title", type=str, help="Optional title for the space")
    parser.add_argument("--repo", type=str, default="aiandbotsgalore/copy-spaces-to-youtube-pipeline", help="GitHub repo")
    parser.add_argument("--endpoint", type=str, default=DEFAULT_MODAL_ENDPOINT, help="Modal Webhook Endpoint URL")
    parser.add_argument("--language", type=str, default="en", help="Language code (default: 'en')")
    parser.add_argument("--no-upload", action="store_true", help="Do not upload assets to GitHub release")
    parser.add_argument("--no-clips", action="store_true", help="Do not auto-generate highlight clips")
    parser.add_argument("--gh-token", type=str, help="GitHub token for API and release upload")

    args = parser.parse_args()

    transcribe_single(
        release_tag=args.release_tag,
        audio_file=args.audio_file,
        audio_url=args.audio_url,
        title=args.title,
        language=args.language,
        repo=args.repo,
        modal_endpoint=args.endpoint,
        upload_assets=not args.no_upload,
        cut_clips=not args.no_clips,
        gh_token=args.gh_token
    )


if __name__ == "__main__":
    main()
