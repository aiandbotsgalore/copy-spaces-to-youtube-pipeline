#!/usr/bin/env python3
"""
scripts/sync_clips_to_r2.py

Synchronizes all highlight clips from the local catalog and GitHub Releases
directly into Cloudflare R2 bucket (documentary-audio-clips), enabling ultra-low
latency audio streaming through Cloudflare's global edge CDN.

Usage:
    python scripts/sync_clips_to_r2.py [--limit N] [--workers W] [--dry-run]
"""

import os
import sys
import re
import json
import argparse
import urllib.request
import urllib.parse
from pathlib import Path
from typing import List, Dict, Any, Set
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    import boto3
    from botocore.config import Config
except ImportError:
    print("[!] boto3 is required. Install via: pip install boto3")
    sys.exit(1)


def load_env():
    """Load secrets from .env.local and .env if present."""
    for fn in [".env.local", ".env"]:
        p = Path(fn)
        if p.exists():
            with open(p, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip("'").strip('"')
                        if k not in os.environ:
                            os.environ[k] = v


load_env()

DEFAULT_ACCOUNT_ID = os.environ.get("R2_ACCOUNT_ID", "1f7e50a9492730f90d58bd1789e7d510")
DEFAULT_ENDPOINT = os.environ.get("R2_ENDPOINT_URL", f"https://{DEFAULT_ACCOUNT_ID}.r2.cloudflarestorage.com")
DEFAULT_ACCESS_KEY = os.environ.get("R2_ACCESS_KEY_ID", "60ab689af658577cc79b5fc9a97abd6c")
DEFAULT_SECRET_KEY = os.environ.get("R2_SECRET_ACCESS_KEY", "18b6c47880ea7bd053cfa747458bd4ad94f824985e20299114c2b0ac59038fab")
DEFAULT_BUCKET = os.environ.get("R2_BUCKET_NAME", "documentary-audio-clips")
DEFAULT_CDN_BASE = os.environ.get("R2_PUBLIC_BASE_URL", "https://pub-b492226ab4ed45d692e9f14794366106.r2.dev").rstrip("/")

CATALOG_PATH = Path("public/clips/clips_catalog.json")


def get_r2_client(endpoint: str, access_key: str, secret_key: str):
    """Creates authenticated S3 client configured for Cloudflare R2."""
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4", retries={"max_attempts": 3, "mode": "standard"})
    )


def list_existing_r2_keys(s3_client, bucket: str) -> Set[str]:
    """Retrieves all object keys currently stored in the R2 bucket."""
    print(f"[*] Querying existing keys from R2 bucket '{bucket}'...")
    existing = set()
    paginator = s3_client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket):
        for obj in page.get("Contents", []):
            existing.add(obj["Key"])
    print(f"[✓] Found {len(existing)} existing files in R2.")
    return existing


def load_release_assets_map() -> Dict[str, str]:
    """Builds a lookup map from filename.lower() -> browser_download_url from releases.json."""
    lookup: Dict[str, str] = {}
    if Path("releases.json").exists():
        try:
            with open("releases.json", "r", encoding="utf-8") as f:
                releases = json.load(f)
            for r in releases:
                for a in r.get("assets", []):
                    name = a.get("name", "")
                    url = a.get("browser_download_url", "")
                    if name.endswith(".mp3") and url:
                        lookup[name.lower()] = url
                        lookup[urllib.parse.unquote(name).lower()] = url
        except Exception as e:
            print(f"[!] Warning reading releases.json: {e}")
    return lookup


def extract_filename(clip: Dict[str, Any]) -> str:
    """Extracts a clean, safe filename for the clip."""
    fp = clip.get("file_path") or clip.get("download_url") or ""
    parsed = urllib.parse.urlparse(fp)
    fname = os.path.basename(parsed.path)
    if fname and fname.endswith(".mp3"):
        return urllib.parse.unquote(fname)

    start_sec = int(clip.get("start_seconds", 0))
    h = start_sec // 3600
    m = (start_sec % 3600) // 60
    s = start_sec % 60
    prefix = f"{h:02d}h{m:02d}m{s:02d}s_" if h > 0 else f"{m:02d}m{s:02d}s_"
    safe_title = re.sub(r"[^a-zA-Z0-9_\-\.]", "_", clip.get("title", "clip")).strip("_")
    return f"{prefix}{safe_title}.mp3"


def find_local_file(filename: str) -> Path | None:
    """Searches common local directories for the clip MP3."""
    candidates = [
        Path("public/clips") / filename,
        Path("best_saved_clips") / filename,
        Path("work") / filename,
        Path("scratch") / filename,
    ]
    for c in candidates:
        if c.exists() and c.stat().st_size > 0:
            return c
    return None


def download_clip_bytes(source_url: str) -> bytes | None:
    """Downloads clip audio bytes from download URL with streaming chunks."""
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SpacePipe-R2-Sync"}
    req = urllib.request.Request(source_url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30.0) as resp:
            return resp.read()
    except Exception as e:
        return None


def upload_single_clip(
    s3_client,
    bucket: str,
    key: str,
    clip: Dict[str, Any],
    cdn_base: str,
    release_map: Dict[str, str],
    dry_run: bool = False
) -> Dict[str, Any]:
    """Uploads a single clip to R2 and returns status."""
    source_url = clip.get("download_url") or clip.get("file_path") or ""

    if dry_run:
        return {"key": key, "status": "dry-run", "cdn_url": f"{cdn_base}/{urllib.parse.quote(key)}"}

    # 1. Try reading from local file
    local_path = find_local_file(key)
    body = None
    if local_path:
        with open(local_path, "rb") as f:
            body = f.read()

    # 2. Try primary source URL
    if not body and source_url and source_url.startswith("http"):
        body = download_clip_bytes(source_url)

    # 3. Fallback to release assets lookup if primary URL failed
    if not body and release_map:
        alt_url = release_map.get(key.lower()) or release_map.get(urllib.parse.quote(key).lower())
        if alt_url and alt_url != source_url:
            body = download_clip_bytes(alt_url)

    if not body:
        return {"key": key, "status": "skipped", "reason": "No live audio source found"}

    try:
        s3_client.put_object(
            Bucket=bucket,
            Key=key,
            Body=body,
            ContentType="audio/mpeg",
            CacheControl="public, max-age=31536000, immutable"
        )
        cdn_url = f"{cdn_base}/{urllib.parse.quote(key)}"
        return {"key": key, "status": "uploaded", "cdn_url": cdn_url}
    except Exception as e:
        return {"key": key, "status": "error", "reason": str(e)}


def main():
    parser = argparse.ArgumentParser(description="Sync highlight clips catalog to Cloudflare R2 CDN")
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    parser.add_argument("--bucket", default=DEFAULT_BUCKET)
    parser.add_argument("--access-key", default=DEFAULT_ACCESS_KEY)
    parser.add_argument("--secret-key", default=DEFAULT_SECRET_KEY)
    parser.add_argument("--cdn-base", default=DEFAULT_CDN_BASE)
    parser.add_argument("--limit", type=int, default=0, help="Maximum new clips to upload (0 for all)")
    parser.add_argument("--workers", type=int, default=8, help="Parallel upload threads")
    parser.add_argument("--dry-run", action="store_true", help="Preview sync actions without uploading")
    parser.add_argument("--skip-catalog-update", action="store_true", help="Do not modify local clips_catalog.json")
    args = parser.parse_args()

    print("=" * 70)
    print("🚀 SpacePipe Cloudflare R2 Clip Sync Engine")
    print(f"Bucket:   {args.bucket}")
    print(f"Endpoint: {args.endpoint}")
    print(f"CDN Base: {args.cdn_base}")
    print("=" * 70)

    if not CATALOG_PATH.exists():
        print(f"[!] Catalog file {CATALOG_PATH} not found.")
        sys.exit(1)

    with open(CATALOG_PATH, "r", encoding="utf-8") as f:
        catalog: List[Dict[str, Any]] = json.load(f)

    print(f"[*] Loaded {len(catalog)} clips from {CATALOG_PATH}.")

    s3 = get_r2_client(args.endpoint, args.access_key, args.secret_key)
    existing_keys = list_existing_r2_keys(s3, args.bucket)
    release_map = load_release_assets_map()
    print(f"[*] Indexed {len(release_map)} releases cloud MP3 assets.")

    # Prepare queue of clips to upload
    to_upload = []
    for c in catalog:
        key = extract_filename(c)
        if key not in existing_keys:
            to_upload.append((key, c))

    print(f"[*] {len(catalog) - len(to_upload)} clips already exist on R2.")
    print(f"[*] {len(to_upload)} clips need uploading.")

    if args.limit > 0 and len(to_upload) > args.limit:
        print(f"[*] Limiting sync to {args.limit} clips as requested.")
        to_upload = to_upload[:args.limit]

    # Map of key -> cdn_url
    key_to_cdn: Dict[str, str] = {}
    for k in existing_keys:
        key_to_cdn[k] = f"{args.cdn_base}/{urllib.parse.quote(k)}"

    uploaded_count = 0
    skipped_count = 0
    failed_count = 0

    if to_upload:
        print(f"[*] Starting upload of {len(to_upload)} clips using {args.workers} worker threads...")
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            future_to_key = {
                executor.submit(
                    upload_single_clip, s3, args.bucket, key, clip, args.cdn_base, release_map, args.dry_run
                ): key
                for key, clip in to_upload
            }

            for idx, future in enumerate(as_completed(future_to_key), 1):
                key = future_to_key[future]
                try:
                    res = future.result()
                    status = res.get("status")
                    if status in ("uploaded", "dry-run"):
                        uploaded_count += 1
                        key_to_cdn[key] = res["cdn_url"]
                        print(f"  [{idx}/{len(to_upload)}] [✓] {key} -> R2 ({status})")
                    elif status == "skipped":
                        skipped_count += 1
                        print(f"  [{idx}/{len(to_upload)}] [-] {key} skipped ({res.get('reason')})")
                    else:
                        failed_count += 1
                        print(f"  [{idx}/{len(to_upload)}] [!] {key} FAILED: {res.get('reason')}")
                except Exception as exc:
                    failed_count += 1
                    print(f"  [{idx}/{len(to_upload)}] [!] {key} crashed: {exc}")

    # Update catalog with fast CDN URLs
    if not args.dry_run and not args.skip_catalog_update:
        updated_catalog_count = 0
        for c in catalog:
            key = extract_filename(c)
            if key in key_to_cdn:
                cdn_url = key_to_cdn[key]
                if c.get("file_path") != cdn_url or c.get("download_url") != cdn_url:
                    c["file_path"] = cdn_url
                    c["download_url"] = cdn_url
                    updated_catalog_count += 1

        with open(CATALOG_PATH, "w", encoding="utf-8") as f:
            json.dump(catalog, f, indent=2)

        print(f"\n[✓] Successfully updated {CATALOG_PATH}: {updated_catalog_count} clips now point to Cloudflare R2!")

    print("\n" + "=" * 70)
    print(f"🎉 R2 Sync Complete!")
    print(f"   Uploaded: {uploaded_count}")
    print(f"   Skipped:  {skipped_count}")
    print(f"   Failed:   {failed_count}")
    print(f"   Total on R2 CDN: {len(key_to_cdn)}")
    print("=" * 70)


if __name__ == "__main__":
    main()
