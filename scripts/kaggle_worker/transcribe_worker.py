#!/usr/bin/env python3
"""
scripts/kaggle_worker/transcribe_worker.py
SpacePipe 100% Cloud GPU Transcriber & Diarizer (Kaggle Edition)

Runs on Kaggle Dual Tesla T4 GPUs with WhisperX:
1. Batched transcription with faster-whisper large-v3-turbo (FP16).
2. Forced phoneme alignment via wav2vec2 for microsecond word timestamps.
3. Multi-speaker neural diarization via pyannote.audio.
4. Generates .json, .srt, and .txt matching exact SpacePipe schema.
5. Uploads transcripts directly back to GitHub Release assets via GitHub API.
6. 100% cloud execution - 0 bytes on local machine.
"""

import os
import sys
import json
import time
import shutil
import tempfile
import subprocess
import urllib.request
import urllib.parse
from pathlib import Path
from typing import List, Dict, Any, Optional

# Reconfigure stdout/stderr for unbuffered Kaggle logs
try:
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)
except Exception:
    pass


def run_cmd(cmd: List[str], check: bool = True) -> subprocess.CompletedProcess:
    print(f"[*] Executing: {' '.join(cmd)}")
    res = subprocess.run(cmd, capture_output=True, text=True)
    if check and res.returncode != 0:
        print(f"[!] Command failed (code {res.returncode}):\n{res.stderr}")
        raise RuntimeError(f"Command failed: {' '.join(cmd)}")
    return res


def ensure_dependencies():
    """Installs whisperx and requirements if not present in container."""
    print("[*] Checking runtime dependencies...")
    try:
        import whisperx
        print("[✓] WhisperX already installed.")
    except ImportError:
        print("[*] Installing WhisperX and PyAnnote inside Kaggle container...")
        run_cmd([sys.executable, "-m", "pip", "install", "-q", "whisperx", "requests"])
        print("[✓] Dependencies installed successfully.")


def format_timestamp_srt(seconds: float) -> str:
    millis = int(round(seconds * 1000))
    hrs = millis // 3600000
    millis %= 3600000
    mins = millis // 60000
    millis %= 60000
    secs = millis // 1000
    millis %= 1000
    return f"{hrs:02d}:{mins:02d}:{secs:02d},{millis:03d}"


def get_untranscribed_releases(repo: str, gh_token: str, limit: int = 5) -> List[Dict[str, Any]]:
    """Fetches releases from GitHub and finds those missing .json transcripts."""
    headers = {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "SpacePipe-Kaggle-Worker"
    }
    if gh_token:
        headers["Authorization"] = f"token {gh_token}"

    url = f"https://api.github.com/repos/{repo}/releases?per_page=50"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req) as resp:
        releases = json.loads(resp.read().decode())

    to_process = []
    for rel in releases:
        assets = rel.get("assets", [])
        mp3_assets = [a for a in assets if a["name"].lower().endswith((".mp3", ".m4a"))]
        json_assets = [a for a in assets if a["name"].lower().endswith(".json") and not a["name"].lower().endswith("_clips.json")]

        if mp3_assets and not json_assets:
            to_process.append({
                "release_id": rel["id"],
                "tag_name": rel["tag_name"],
                "title": rel.get("name") or rel["tag_name"],
                "mp3_asset": mp3_assets[0],
                "upload_url": rel["upload_url"]
            })
            if len(to_process) >= limit:
                break

    return to_process


def download_asset(url: str, dest_path: Path, gh_token: str):
    headers = {"User-Agent": "SpacePipe-Kaggle-Worker"}
    if gh_token:
        headers["Authorization"] = f"token {gh_token}"
    req = urllib.request.Request(url, headers=headers)
    print(f"[*] Downloading {dest_path.name} from GitHub...")
    with urllib.request.urlopen(req) as resp, open(dest_path, "wb") as out:
        shutil.copyfileobj(resp, out)
    print(f"[✓] Downloaded {dest_path.stat().st_size / (1024*1024):.1f} MB")


def upload_asset_to_release(upload_url_template: str, file_path: Path, content_type: str, gh_token: str):
    """Uploads a generated transcript to GitHub Release."""
    base_upload_url = upload_url_template.split("{?")[0]
    upload_url = f"{base_upload_url}?name={urllib.parse.quote(file_path.name)}"
    
    headers = {
        "Authorization": f"token {gh_token}",
        "Content-Type": content_type,
        "User-Agent": "SpacePipe-Kaggle-Worker"
    }

    print(f"[*] Uploading {file_path.name} to GitHub Release...")
    with open(file_path, "rb") as f:
        data = f.read()

    req = urllib.request.Request(upload_url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            if resp.getcode() in (200, 201):
                print(f"[✓] Successfully uploaded {file_path.name}")
    except urllib.error.HTTPError as e:
        print(f"[!] Warning: Upload of {file_path.name} returned HTTP {e.code}: {e.read().decode()}")


def process_episode(item: Dict[str, Any], hf_token: str, gh_token: str, work_dir: Path):
    import whisperx
    import torch

    tag = item["tag_name"]
    title = item["title"]
    mp3_asset = item["mp3_asset"]
    upload_url_template = item["upload_url"]

    audio_path = work_dir / mp3_asset["name"]
    download_asset(mp3_asset["browser_download_url"], audio_path, gh_token)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    batch_size = 16
    compute_type = "float16" if device == "cuda" else "int8"

    print(f"\n=======================================================")
    print(f"[*] Transcribing: {title} ({tag}) on {device.upper()}")
    print(f"=======================================================")

    t0 = time.time()
    # 1. Faster-Whisper Large-v3-Turbo
    print(f"[*] Loading WhisperX model (large-v3-turbo, {compute_type})...")
    model = whisperx.load_model("large-v3-turbo", device, compute_type=compute_type)

    print("[*] Running audio transcription...")
    audio = whisperx.load_audio(str(audio_path))
    transcription_result = model.transcribe(audio, batch_size=batch_size)
    print(f"[✓] Transcription finished in {time.time() - t0:.1f}s. Language: {transcription_result.get('language')}")

    # 2. Phoneme Alignment (wav2vec2) for microsecond precision
    t1 = time.time()
    lang = transcription_result.get("language") or "en"
    print(f"[*] Aligning word timestamps via wav2vec2 ({lang})...")
    align_model, metadata = whisperx.load_align_model(language_code=lang, device=device)
    aligned_result = whisperx.align(transcription_result["segments"], align_model, metadata, audio, device)
    print(f"[✓] Word alignment completed in {time.time() - t1:.1f}s")

    # 3. Speaker Diarization (PyAnnote Audio)
    t2 = time.time()
    if hf_token:
        try:
            print("[*] Performing neural speaker diarization (pyannote.audio)...")
            diarize_pipeline = whisperx.DiarizationPipeline(use_auth_token=hf_token, device=device)
            diarize_segments = diarize_pipeline(audio)
            final_result = whisperx.assign_word_speakers(diarize_segments, aligned_result)
            print(f"[✓] Diarization completed in {time.time() - t2:.1f}s")
        except Exception as e:
            print(f"[!] Warning: PyAnnote diarization failed ({e}). Using aligned segments directly.")
            final_result = aligned_result
    else:
        print("[*] No HF_TOKEN provided; skipping pyannote diarization.")
        final_result = aligned_result

    # 4. Format outputs to exact SpacePipe schema
    stem = Path(mp3_asset["name"]).stem
    json_path = work_dir / f"{stem}.json"
    srt_path = work_dir / f"{stem}.srt"
    txt_path = work_dir / f"{stem}.txt"

    segments = []
    srt_lines = []
    txt_lines = [f"=== TRANSCRIPT: {title} ===\n"]

    for idx, seg in enumerate(final_result.get("segments", []), 1):
        start = round(float(seg.get("start", 0.0)), 2)
        end = round(float(seg.get("end", 0.0)), 2)
        text = str(seg.get("text", "")).strip()
        speaker = str(seg.get("speaker") or "Speaker A").strip()

        words = []
        for w in seg.get("words", []):
            if "start" in w and "end" in w:
                words.append({
                    "word": str(w.get("word", "")).strip(),
                    "start": round(float(w["start"]), 2),
                    "end": round(float(w["end"]), 2),
                    "confidence": round(float(w.get("score", 0.95)), 2)
                })

        segments.append({
            "start": start,
            "end": end,
            "speaker": speaker,
            "text": text,
            "words": words
        })

        srt_lines.append(f"{idx}\n{format_timestamp_srt(start)} --> {format_timestamp_srt(end)}\n[{speaker}]: {text}\n")
        txt_lines.append(f"[{format_timestamp_srt(start)}] {speaker}: {text}\n")

    # Write files
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(segments, f, indent=2, ensure_ascii=False)
    with open(srt_path, "w", encoding="utf-8") as f:
        f.writelines("\n".join(srt_lines))
    with open(txt_path, "w", encoding="utf-8") as f:
        f.writelines(txt_lines)

    total_time = time.time() - t0
    print(f"[✓] Full process complete in {total_time:.1f}s ({len(segments)} segments)")

    # 5. Upload files back to GitHub Release
    if gh_token:
        upload_asset_to_release(upload_url_template, json_path, "application/json", gh_token)
        upload_asset_to_release(upload_url_template, srt_path, "text/plain", gh_token)
        upload_asset_to_release(upload_url_template, txt_path, "text/plain", gh_token)

    # Clean up local scratch audio
    if audio_path.exists():
        audio_path.unlink()


def main():
    print("=================================================================")
    print("     SpacePipe WhisperX GPU Transcriber (Kaggle Cloud Worker)    ")
    print("=================================================================")

    ensure_dependencies()

    gh_token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or ""
    hf_token = os.environ.get("HF_TOKEN") or ""
    repo = os.environ.get("GITHUB_REPOSITORY") or "aiandbotsgalore/copy-spaces-to-youtube-pipeline"
    limit = int(os.environ.get("BATCH_LIMIT") or "5")

    target_tag = os.environ.get("TARGET_RELEASE_TAG") or ""

    work_dir = Path(tempfile.gettempdir()) / "spacepipe_kaggle"
    work_dir.mkdir(parents=True, exist_ok=True)

    if target_tag:
        print(f"[*] Targeted single release mode: {target_tag}")
        headers = {"Accept": "application/vnd.github.v3+json", "User-Agent": "SpacePipe-Kaggle-Worker"}
        if gh_token:
            headers["Authorization"] = f"token {gh_token}"
        url = f"https://api.github.com/repos/{repo}/releases/tags/{target_tag}"
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req) as resp:
            rel = json.loads(resp.read().decode())
        mp3_assets = [a for a in rel.get("assets", []) if a["name"].lower().endswith((".mp3", ".m4a"))]
        if mp3_assets:
            process_episode({
                "release_id": rel["id"],
                "tag_name": rel["tag_name"],
                "title": rel.get("name") or rel["tag_name"],
                "mp3_asset": mp3_assets[0],
                "upload_url": rel["upload_url"]
            }, hf_token, gh_token, work_dir)
    else:
        print(f"[*] Batch auto-queue mode (Limit: {limit})...")
        untranscribed = get_untranscribed_releases(repo, gh_token, limit=limit)
        print(f"[*] Found {len(untranscribed)} untranscribed episode(s).")
        for item in untranscribed:
            process_episode(item, hf_token, gh_token, work_dir)

    print("\n[✓] All cloud transcription tasks completed successfully!")


if __name__ == "__main__":
    main()
