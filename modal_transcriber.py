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
import re
import json
import time
import math
import subprocess
import requests
import urllib.parse
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
        "torch==2.5.1",
        "torchaudio==2.5.1",
        "nvidia-cublas-cu12",
        "nvidia-cudnn-cu12",
        "faster-whisper",
        "speechbrain",
        "soundfile",
        "scikit-learn",
        "numpy",
        "imageio-ffmpeg",
        "requests",
        "google-genai",
        "pydantic",
    )
    .env({
        "LD_LIBRARY_PATH": "/usr/local/lib/python3.11/site-packages/nvidia/cublas/lib:/usr/local/lib/python3.11/site-packages/nvidia/cudnn/lib"
    })
    # Pre-cache Whisper & SpeechBrain neural weights during image build so the GPU never pays download time
    .run_commands(
        "python -c 'from faster_whisper import WhisperModel; WhisperModel(\"large-v3-turbo\", device=\"cpu\", compute_type=\"int8\")'",
        "python -c 'import os; from speechbrain.inference.speaker import EncoderClassifier; EncoderClassifier.from_hparams(source=\"speechbrain/spkrec-ecapa-voxceleb\", savedir=os.path.join(os.path.expanduser(\"~\"), \".cache\", \"speechbrain\", \"spkrec-ecapa-voxceleb\"), run_opts={\"device\": \"cpu\"})'"
    )
    .add_local_dir(
        ".",
        remote_path="/root/workspace",
        ignore=[".git", "node_modules", "dist", ".gemini", "work", "*.mp3", "*.wav", "best_saved_clips", ".cache", "scratch"]
    )
)


@app.function(
    image=modal_image,
    gpu=["L4", "A10G"],
    timeout=3600,
    secrets=[
        modal.Secret.from_dict({
            "GH_TOKEN": os.environ.get("GH_TOKEN", os.environ.get("GITHUB_TOKEN", "")),
            "GEMINI_API_KEY": os.environ.get("GEMINI_API_KEY", os.environ.get("GOOGLE_API_KEY", "")),
        })
    ]
)
def run_cloud_transcription(release_tag: str, part: int = 0):
    """Executes Faster-Whisper transcription & AI clip extraction on Modal cloud GPU."""
    os.chdir("/root/workspace")
    gh_token = os.environ.get("GH_TOKEN", "")
    gemini_key = os.environ.get("GEMINI_API_KEY", "")

    # Set up CUDA LD_LIBRARY_PATH dynamically for CTranslate2
    try:
        import nvidia.cublas.lib
        import nvidia.cudnn.lib
        cublas_dir = os.path.dirname(nvidia.cublas.lib.__file__)
        cudnn_dir = os.path.dirname(nvidia.cudnn.lib.__file__)
        curr_ld = os.environ.get("LD_LIBRARY_PATH", "")
        os.environ["LD_LIBRARY_PATH"] = f"{cublas_dir}:{cudnn_dir}:{curr_ld}"
    except Exception as e:
        print(f"[!] Notice loading CUDA library paths: {e}")

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
    release_id = release_data.get("id")
    assets = release_data.get("assets", [])

    # Find full episode MP3 assets (excluding short cut clips starting with timing patterns)
    mp3_assets = [
        a for a in assets 
        if a.get("name", "").endswith(".mp3") and not re.match(r"^\d+(?:h\d+)?m\d+s_", a.get("name", ""))
    ]
    if not mp3_assets:
        mp3_assets = [a for a in assets if a.get("name", "").endswith(".mp3")]
    if not mp3_assets:
        raise RuntimeError(f"No .mp3 asset found in release {release_tag}")

    mp3_assets.sort(key=lambda a: a.get("name", ""))

    if part > 0:
        filtered = [a for a in mp3_assets if f"Part{part}" in a.get("name", "") or f"part{part}" in a.get("name", "").lower()]
        if filtered:
            mp3_assets = filtered
        else:
            print(f"[!] Warning: Could not find Part {part} specifically, processing available assets: {[a['name'] for a in mp3_assets]}")

    upload_url_template = release_data.get("upload_url", "").split("{")[0]
    py_exe = sys.executable
    sub_env = os.environ.copy()

    processed_count = 0

    for mp3_asset in mp3_assets:
        mp3_url = mp3_asset["browser_download_url"]
        mp3_name = mp3_asset["name"]
        stem = Path(mp3_name).stem

        # Check if already transcribed
        existing_json_asset = next((a for a in assets if a.get("name") == f"{stem}.json" and a.get("size", 0) > 1000), None)
        if existing_json_asset and not os.environ.get("FORCE_RETRANSCRIBE"):
            print(f"[✓] {mp3_name} already has transcript: {existing_json_asset['name']} ({existing_json_asset['size']} bytes). Skipping.")
            continue

        print(f"\n[*] Processing Audio Asset: {mp3_name} ({mp3_asset.get('size', 0) / (1024*1024):.1f} MB)")
        container_work_dir = Path("/tmp/work")
        container_work_dir.mkdir(parents=True, exist_ok=True)
        local_mp3 = container_work_dir / mp3_name
        
        print(f"[*] Downloading {mp3_name} to cloud scratch disk...")
        dl_resp = requests.get(mp3_url, headers=headers, stream=True)
        dl_resp.raise_for_status()
        with open(local_mp3, "wb") as f:
            for chunk in dl_resp.iter_content(chunk_size=1048576):
                f.write(chunk)
                
        print(f"[✓] Download Complete: {local_mp3.stat().st_size / (1024*1024):.1f} MB")

        output_dir = Path("/tmp/output_transcripts")
        output_dir.mkdir(parents=True, exist_ok=True)
        json_path = output_dir / f"{stem}.json"

        cmd_transcribe = [
            py_exe, "batch_transcriber.py",
            "--file", str(local_mp3),
            "--output-dir", str(output_dir),
            "--non-interactive"
        ]
        print(f"[*] Running batch_transcriber on cloud NVIDIA A10G GPU for {mp3_name}...")
        res = subprocess.run(cmd_transcribe, env=sub_env)
        if res.returncode != 0:
            raise RuntimeError(f"batch_transcriber failed for {mp3_name} with exit code {res.returncode}")
        print(f"[✓] GPU Transcription & Diarization Complete for {mp3_name}!")

        # 4. Extract Best & Funniest Highlights using Gemini 2.5 Flash
        clips_dir = Path("best_saved_clips")
        if json_path.exists():
            print(f"[*] Extracting AI Highlight Clips with Gemini 2.5 Flash for {stem}...")
            cmd_clips = [
                py_exe, "scripts/find_and_cut_best_clips.py",
                "--json", str(json_path),
                "--audio", str(local_mp3),
                "--limit", "5"
            ]
            try:
                res_clips = subprocess.run(cmd_clips, env=sub_env, timeout=300)
                if res_clips.returncode != 0:
                    print(f"[!] Clip extraction returned code {res_clips.returncode}. Proceeding with transcript upload...")
            except subprocess.TimeoutExpired:
                print("[!] Clip extraction reached 300s timeout. Proceeding with transcript upload...")
            except Exception as e:
                print(f"[!] Clip extraction notice: {e}. Proceeding with transcript upload...")

        # 5. Gather Files to Upload
        txt_path = output_dir / f"{stem}.txt"
        srt_path = output_dir / f"{stem}.srt"
        
        to_upload = [p for p in [txt_path, srt_path, json_path] if p.exists() and p.stat().st_size > 0]
        
        if clips_dir.exists():
            for clip_file in clips_dir.glob("**/*.mp3"):
                if clip_file.stat().st_size > 0 and clip_file not in to_upload:
                    to_upload.append(clip_file)
            for json_clip_file in clips_dir.glob("*.json"):
                if json_clip_file.stat().st_size > 0 and json_clip_file not in to_upload:
                    to_upload.append(json_clip_file)
            catalog_file = clips_dir / "CLIPS_CATALOG.md"
            if catalog_file.exists() and catalog_file.stat().st_size > 0 and catalog_file not in to_upload:
                to_upload.append(catalog_file)

        # 6. Upload Assets Back to GitHub Release
        cur_assets_resp = requests.get(rel_url, headers=headers)
        latest_assets = cur_assets_resp.json().get("assets", []) if cur_assets_resp.status_code == 200 else assets
        existing_asset_map = {a["name"]: a["id"] for a in latest_assets}
        
        for file_path in to_upload:
            fname = file_path.name
            if fname in existing_asset_map:
                del_id = existing_asset_map[fname]
                print(f"  [-] Replacing existing asset: {fname} (ID {del_id})...")
                del_url = f"https://api.github.com/repos/aiandbotsgalore/copy-spaces-to-youtube-pipeline/releases/assets/{del_id}"
                requests.delete(del_url, headers=headers)
                
            print(f"[*] Uploading {fname} ({file_path.stat().st_size} bytes) to GitHub Release {release_tag}...")
            u_headers = {
                "Content-Type": "application/octet-stream",
                "User-Agent": "SpacePipe-ModalTranscriber"
            }
            if gh_token:
                u_headers["Authorization"] = f"token {gh_token}"
                
            safe_fname = urllib.parse.quote(fname)
            with open(file_path, "rb") as f:
                up_resp = requests.post(f"{upload_url_template}?name={safe_fname}", headers=u_headers, data=f)
                if up_resp.status_code in [200, 201]:
                    print(f"  [✓] Successfully uploaded {fname}")
                else:
                    print(f"  [!] Upload status ({up_resp.status_code}): {up_resp.text}")

        # Clean scratch mp3
        try:
            local_mp3.unlink(missing_ok=True)
        except Exception:
            pass

        processed_count += 1

    print(f"[🎉] Modal Cloud GPU Transcription Job Finished ({processed_count} parts processed) for {release_tag}!")
    return True


@app.local_entrypoint()
def main(release_tag: str, part: int = 0):
    print(f"Submitting Modal Cloud GPU transcription job for: {release_tag} (part: {part if part > 0 else 'all'})")
    run_cloud_transcription.remote(release_tag, part)
