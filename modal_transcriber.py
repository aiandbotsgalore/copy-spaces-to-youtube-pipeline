#!/usr/bin/env python3
"""
modal_transcriber.py - Modal Cloud GPU Transcriber & Highlight Extractor

Executes high-performance neural audio transcription (Faster-Whisper on CUDA), 
SpeechBrain ECAPA-TDNN speaker diarization, and Gemini 2.5 Flash highlight clip
extraction on Modal's serverless cloud GPUs.

Zero disk space used on your local PC.
Zero home internet bandwidth consumed.
Runs 100% in the cloud on enterprise NVIDIA GPUs.
"""

import os
import sys
import json
import time
import math
import subprocess
import requests
from pathlib import Path

import modal

# ---------------------------------------------------------------------------
# Modal App & Container Image Configuration
# ---------------------------------------------------------------------------
app = modal.App("spacepipe-gpu-transcriber")

modal_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "git", "curl", "build-essential")
    .pip_install(
        "faster-whisper",
        "torch==2.5.1",
        "torchaudio==2.5.1",
        "speechbrain",
        "soundfile",
        "scikit-learn",
        "numpy",
        "imageio-ffmpeg",
        "requests",
        "google-genai",
        "pydantic",
    )
    .add_local_dir(
        ".",
        remote_path="/root/workspace",
        ignore=[".git", "node_modules", "dist", ".gemini", "work", "*.mp3", "*.wav"]
    )
)


@app.function(
    image=modal_image,
    gpu="A10G",
    timeout=3600,
    secrets=[
        modal.Secret.from_dict({
            "GH_TOKEN": os.environ.get("GH_TOKEN", os.environ.get("GITHUB_TOKEN", "")),
            "GEMINI_API_KEY": os.environ.get("GEMINI_API_KEY", os.environ.get("GOOGLE_API_KEY", "")),
        })
    ]
)
def run_cloud_transcription(release_tag: str):
    """Executes Faster-Whisper transcription & AI clip extraction on Modal cloud GPU."""
    os.chdir("/root/workspace")
    gh_token = os.environ.get("GH_TOKEN", "")
    gemini_key = os.environ.get("GEMINI_API_KEY", "")

    print(f"[*] Starting Modal Cloud GPU Transcription for Release Tag: {release_tag}")
    
    # 1. Fetch Release Info from GitHub API
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "SpacePipe-ModalTranscriber"
    }
    if gh_token:
        headers["Authorization"] = f"token {gh_token}"
        
    rel_url = f"https://api.github.com/repos/aiandbotsgalore/copy-spaces-to-youtube-pipeline/releases/tags/{release_tag}"
    resp = requests.get(rel_url, headers=headers)
    if resp.status_code != 200:
        raise RuntimeError(f"Failed to fetch release info for {release_tag}: {resp.status_code} - {resp.text}")
    
    release_data = resp.json()
    assets = release_data.get("assets", [])
    mp3_asset = next((a for a in assets if a["name"].endswith(".mp3")), None)
    
    if not mp3_asset:
        raise RuntimeError(f"No .mp3 asset found in release {release_tag}")
        
    mp3_url = mp3_asset["browser_download_url"]
    mp3_name = mp3_asset["name"]
    stem = Path(mp3_name).stem
    print(f"[✓] Found MP3 asset: {mp3_name} ({mp3_asset.get('size', 0) / (1024*1024):.1f} MB)")
    print(f"[*] Downloading audio in cloud data center...")

    # 2. Download MP3 to Cloud Scratch Disk (/tmp)
    container_work_dir = Path("/tmp/work")
    container_work_dir.mkdir(parents=True, exist_ok=True)
    local_mp3 = container_work_dir / mp3_name
    
    dl_resp = requests.get(mp3_url, headers=headers, stream=True)
    dl_resp.raise_for_status()
    with open(local_mp3, "wb") as f:
        for chunk in dl_resp.iter_content(chunk_size=1048576):
            f.write(chunk)
            
    print(f"[✓] Cloud MP3 Download Complete: {local_mp3.stat().st_size / (1024*1024):.1f} MB")

    # 3. Execute Neural Transcriber on NVIDIA A10G GPU
    output_dir = Path("/tmp/output_transcripts")
    output_dir.mkdir(parents=True, exist_ok=True)
    
    py_exe = sys.executable
    cmd_transcribe = [
        py_exe, "batch_transcriber.py",
        "--file", str(local_mp3),
        "--output-dir", str(output_dir),
        "--non-interactive"
    ]
    
    print(f"[*] Running batch_transcriber on cloud NVIDIA A10G GPU...")
    res = subprocess.run(cmd_transcribe, capture_output=True, text=True)
    print(res.stdout)
    if res.returncode != 0:
        print("STDERR:", res.stderr)
        raise RuntimeError(f"batch_transcriber failed with exit code {res.returncode}")
        
    print(f"[✓] GPU Transcription & Diarization Complete!")

    # 4. Extract Best & Funniest Highlights using Gemini 2.5 Flash
    json_path = output_dir / f"{stem}.json"
    clips_dir = Path("best_saved_clips")
    
    if json_path.exists():
        print(f"[*] Extracting AI Highlight Clips with Gemini 2.5 Flash...")
        cmd_clips = [
            py_exe, "scripts/find_and_cut_best_clips.py",
            "--json", str(json_path),
            "--audio", str(local_mp3),
            "--limit", "5"
        ]
        res_clips = subprocess.run(cmd_clips, capture_output=True, text=True)
        print(res_clips.stdout)
        if res_clips.returncode != 0:
            print("Clip Extractor Notice:", res_clips.stderr)

    # 5. Gather Files to Upload
    txt_path = output_dir / f"{stem}.txt"
    srt_path = output_dir / f"{stem}.srt"
    
    to_upload = [p for p in [txt_path, srt_path, json_path] if p.exists() and p.stat().st_size > 0]
    
    # Also collect any highlight clips created
    if clips_dir.exists():
        for clip_file in clips_dir.glob("**/*.mp3"):
            if clip_file.stat().st_size > 0 and clip_file not in to_upload:
                to_upload.append(clip_file)
                
    catalog_file = Path("CLIPS_CATALOG.md")
    if catalog_file.exists() and catalog_file.stat().st_size > 0:
        to_upload.append(catalog_file)

    # 6. Upload Assets Back to GitHub Release (with clobber support)
    upload_url_template = release_data.get("upload_url", "").split("{")[0]
    existing_asset_map = {a["name"]: a["id"] for a in assets}
    
    for file_path in to_upload:
        fname = file_path.name
        # Delete existing asset with same name if present
        if fname in existing_asset_map:
            del_id = existing_asset_map[fname]
            print(f"  [-] Deleting existing asset: {fname} (ID {del_id})...")
            del_url = f"https://api.github.com/repos/aiandbotsgalore/copy-spaces-to-youtube-pipeline/releases/assets/{del_id}"
            requests.delete(del_url, headers=headers)
            
        print(f"[*] Uploading {fname} ({file_path.stat().st_size} bytes) to GitHub Release {release_tag}...")
        u_headers = {
            "Content-Type": "application/octet-stream",
            "User-Agent": "SpacePipe-ModalTranscriber"
        }
        if gh_token:
            u_headers["Authorization"] = f"token {gh_token}"
            
        with open(file_path, "rb") as f:
            up_resp = requests.post(f"{upload_url_template}?name={fname}", headers=u_headers, data=f)
            if up_resp.status_code in [200, 201]:
                print(f"  [✓] Successfully uploaded {fname}")
            else:
                print(f"  [!] Upload status ({up_resp.status_code}): {up_resp.text}")

    print(f"[🎉] Modal Cloud GPU Transcription Job Finished Successfully for {release_tag}!")
    return True


@app.local_entrypoint()
def main(release_tag: str):
    print(f"Submitting Modal Cloud GPU transcription job for: {release_tag}")
    run_cloud_transcription.remote(release_tag)
