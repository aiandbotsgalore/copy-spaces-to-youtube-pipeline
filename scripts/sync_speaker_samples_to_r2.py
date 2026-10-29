#!/usr/bin/env python3
"""
scripts/sync_speaker_samples_to_r2.py

Uploads speaker reference voice samples directly to Cloudflare R2,
enabling ultra-fast playback and direct Web Audio inspection in VoiceProfileLibrary.
"""

import os
import sys
import json
import mimetypes
import urllib.parse
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    import boto3
    from botocore.config import Config
except ImportError:
    print("[!] boto3 is required: pip install boto3")
    sys.exit(1)

def load_env():
    for fn in [".env.local", ".env"]:
        p = Path(fn)
        if p.exists():
            with open(p, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        if k.strip() not in os.environ:
                            os.environ[k.strip()] = v.strip().strip("'\"")

load_env()

ACCOUNT_ID = os.environ.get("R2_ACCOUNT_ID", "")
ENDPOINT = os.environ.get("R2_ENDPOINT_URL", f"https://{ACCOUNT_ID}.r2.cloudflarestorage.com" if ACCOUNT_ID else "")
ACCESS_KEY = os.environ.get("R2_ACCESS_KEY_ID", "")
SECRET_KEY = os.environ.get("R2_SECRET_ACCESS_KEY", "")
BUCKET = os.environ.get("R2_BUCKET_NAME", "documentary-audio-clips")
CDN_BASE = os.environ.get("R2_PUBLIC_BASE_URL", "https://pub-b492226ab4ed45d692e9f14794366106.r2.dev").rstrip("/")

def main():
    if not ACCESS_KEY or not SECRET_KEY:
        print("[!] R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY environment variables are required.")
        print("    Please set them in your environment or in .env / .env.local.")
        sys.exit(1)

    print(f"[*] Connecting to Cloudflare R2: {BUCKET} via {ENDPOINT}")
    s3 = boto3.client(
        "s3",
        endpoint_url=ENDPOINT,
        aws_access_key_id=ACCESS_KEY,
        aws_secret_access_key=SECRET_KEY,
        config=Config(signature_version="s3v4")
    )

    # Collect existing keys
    paginator = s3.get_paginator("list_objects_v2")
    existing_keys = set()
    for page in paginator.paginate(Bucket=BUCKET, Prefix="speaker_samples/"):
        for obj in page.get("Contents", []):
            existing_keys.add(obj["Key"])

    print(f"[✓] Found {len(existing_keys)} speaker sample files already in R2.")

    # Find local files
    files = []
    for root, dirs, fnames in os.walk("speaker_samples"):
        for f in fnames:
            if f.lower().endswith((".mp3", ".wav", ".ogg")):
                full = os.path.join(root, f)
                rel = os.path.relpath(full, "speaker_samples").replace("\\", "/")
                key = f"speaker_samples/{rel}"
                files.append((full, key))

    to_upload = [(fp, k) for fp, k in files if k not in existing_keys]
    print(f"[*] {len(files)} total local speaker samples ({len(to_upload)} need upload).")

    def upload_one(full_path, key):
        content_type = "audio/mpeg" if key.endswith(".mp3") else "audio/wav"
        with open(full_path, "rb") as f:
            data = f.read()
        s3.put_object(
            Bucket=BUCKET,
            Key=key,
            Body=data,
            ContentType=content_type,
            CacheControl="public, max-age=31536000, immutable"
        )
        return key

    if to_upload:
        with ThreadPoolExecutor(max_workers=8) as ex:
            futures = {ex.submit(upload_one, fp, k): k for fp, k in to_upload}
            for fut in as_completed(futures):
                k = futures[fut]
                try:
                    fut.result()
                    print(f"  [✓] Uploaded: {k}")
                except Exception as e:
                    print(f"  [!] Failed {k}: {e}")

    # Update public/voice_profiles.json Logan audio references to CDN
    vp_path = Path("public/voice_profiles.json")
    if vp_path.exists():
        with open(vp_path, "r", encoding="utf-8") as f:
            vp = json.load(f)
        profiles = vp.get("profiles", {})
        if "Logan" in profiles:
            profiles["Logan"]["sample_audio_url"] = f"{CDN_BASE}/speaker_samples/Logan/master_reference.wav"
            profiles["Logan"]["sample_audio_mp3"] = f"{CDN_BASE}/speaker_samples/Logan/master_reference.mp3"
        with open(vp_path, "w", encoding="utf-8") as f:
            json.dump(vp, f, indent=2)
        print("[✓] Updated public/voice_profiles.json with Cloudflare R2 speaker sample URLs.")

    print("[🎉] Speaker samples sync complete!")

if __name__ == "__main__":
    main()
