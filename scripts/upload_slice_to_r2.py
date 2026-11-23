#!/usr/bin/env python3
"""
scripts/upload_slice_to_r2.py

Uploads an audio slice directly into Cloudflare R2 bucket (documentary-audio-clips),
allowing instant caching across Cloudflare's global edge CDN.

Usage:
    python scripts/upload_slice_to_r2.py --file <path> --key <key>
"""

import os
import sys
import argparse
from pathlib import Path

try:
    import boto3
    from botocore.config import Config
except ImportError:
    print("[!] boto3 is required for R2 upload", file=sys.stderr)
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


def upload_slice(file_path: str, key: str, bucket: str = DEFAULT_BUCKET) -> bool:
    p = Path(file_path)
    if not p.exists():
        print(f"[!] File not found: {file_path}", file=sys.stderr)
        return False

    s3 = boto3.client(
        "s3",
        endpoint_url=DEFAULT_ENDPOINT,
        aws_access_key_id=DEFAULT_ACCESS_KEY,
        aws_secret_access_key=DEFAULT_SECRET_KEY,
        config=Config(signature_version="s3v4", retries={"max_attempts": 3, "mode": "standard"})
    )

    content_type = "audio/mpeg" if p.suffix.lower() == ".mp3" else "application/octet-stream"
    try:
        s3.upload_file(
            Filename=str(p),
            Bucket=bucket,
            Key=key,
            ExtraArgs={
                "ContentType": content_type,
                "CacheControl": "public, max-age=31536000"
            }
        )
        print(f"[✓] Uploaded {file_path} to R2: s3://{bucket}/{key}")
        return True
    except Exception as e:
        print(f"[!] Upload failed: {e}", file=sys.stderr)
        return False


def main():
    parser = argparse.ArgumentParser(description="Upload audio slice to Cloudflare R2")
    parser.add_argument("--file", required=True, help="Local file path to upload")
    parser.add_argument("--key", required=True, help="Destination key in R2 bucket (e.g. slices/slice_xyz.mp3)")
    parser.add_argument("--bucket", default=DEFAULT_BUCKET, help="R2 bucket name")
    args = parser.parse_args()

    success = upload_slice(args.file, args.key, args.bucket)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
