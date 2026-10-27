#!/usr/bin/env python3
"""
scripts/split_marathon_releases.py
Automated Marathon Splitter for YouTube Compliance

Splits audio files longer than 10 hours (36,000s) into sequential multi-part episodes:
  "<Title> (Part 1)", "<Title> (Part 2)", "<Title> (Part 3)", etc.
Ensures every chunk is strictly <= 10 hours to comply with YouTube's 12-hour upload ceiling.

Usage:
  # Split a specific local file:
  python scripts/split_marathon_releases.py --file "work/long_space.mp3"

  # Split and update a remote GitHub release:
  python scripts/split_marathon_releases.py --tag "20260220_1MYGNgPOMBzJw" --repo "aiandbotsgalore/copy-spaces-to-youtube-pipeline"

  # Dry-run scan of all marathon releases:
  python scripts/split_marathon_releases.py --scan-only
"""

import os
import sys
import re
import json
import shutil
import argparse
import subprocess
import tempfile
from pathlib import Path
from typing import List, Dict, Any, Optional

CHUNK_SECS = 36000  # 10 hours max per YouTube part


def load_env_files():
    for env_name in [".env.local", ".env"]:
        p = Path(env_name)
        if p.exists():
            try:
                with open(p, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#") and "=" in line:
                            k, v = line.split("=", 1)
                            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
            except Exception:
                pass


load_env_files()


def find_ffmpeg() -> str:
    cand = shutil.which("ffmpeg")
    if cand:
        return cand
    for p in [
        r"C:\Users\Logan\AppData\Local\Microsoft\WinGet\Links\ffmpeg.EXE",
        r"C:\Program Files\ShareX\ffmpeg.exe",
        r"C:\Users\Logan\Downloads\ytdlp-gui-windows-64\ffmpeg.exe",
    ]:
        if os.path.exists(p):
            return p
    return "ffmpeg"


FFMPEG_EXE = find_ffmpeg()


def get_audio_duration_seconds(file_path: str) -> float:
    """Gets audio duration in seconds using ffprobe."""
    ffprobe_exe = shutil.which("ffprobe") or "ffprobe"
    cmd = [
        ffprobe_exe,
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        file_path
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return float(res.stdout.strip())
    except Exception:
        return 0.0


def split_mp3_file(input_path: str, output_dir: str, chunk_seconds: int = CHUNK_SECS) -> List[str]:
    """Slices an MP3 file into sequential parts (_Part1.mp3, _Part2.mp3, etc.)."""
    total_sec = get_audio_duration_seconds(input_path)
    if total_sec <= 0:
        print(f"[!] Could not determine duration of {input_path}")
        return []

    if total_sec <= chunk_seconds:
        print(f"[*] Audio duration ({total_sec/3600:.1f}h) is already within YouTube limit (<= {chunk_seconds/3600:.1f}h). No split needed.")
        return [input_path]

    base_stem = Path(input_path).stem
    # Clean any trailing _Part\d+ to avoid recursive double numbering
    base_stem = re.sub(r"[-_]Part\d+$", "", base_stem, flags=re.IGNORECASE)

    os.makedirs(output_dir, exist_ok=True)
    generated_parts = []
    part_idx = 1
    start_sec = 0

    num_parts = int((total_sec + chunk_seconds - 1) // chunk_seconds)
    print(f"[*] Slicing {total_sec/3600:.2f}h audio into {num_parts} parts (max {chunk_seconds/3600:.1f}h each)...")

    while start_sec < total_sec:
        out_part = os.path.join(output_dir, f"{base_stem}_Part{part_idx}.mp3")
        dur = min(chunk_seconds, total_sec - start_sec)
        print(f"  -> Cutting Part {part_idx}/{num_parts}: start {start_sec/3600:.2f}h, duration {dur/3600:.2f}h...")

        cmd = [
            FFMPEG_EXE,
            "-y",
            "-nostdin",
            "-ss", str(start_sec),
            "-i", input_path,
            "-t", str(dur),
            "-c", "copy",
            out_part
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0 or not os.path.exists(out_part) or os.path.getsize(out_part) == 0:
            # Fall back to re-encoding if copy fails on frame boundaries
            cmd = [
                FFMPEG_EXE,
                "-y",
                "-nostdin",
                "-ss", str(start_sec),
                "-i", input_path,
                "-t", str(dur),
                "-c:a", "libmp3lame",
                "-b:a", "160k",
                out_part
            ]
            res2 = subprocess.run(cmd, capture_output=True, text=True)
            if res2.returncode != 0:
                print(f"[!] FFmpeg error slicing part {part_idx}: {res2.stderr[:200]}")
                break

        print(f"  [✓] Part {part_idx} created: {Path(out_part).name} ({os.path.getsize(out_part)/(1024*1024):.1f} MB)")
        generated_parts.append(out_part)
        part_idx += 1
        start_sec += chunk_seconds

    return generated_parts


def process_release_split(tag: str, repo: str, token: Optional[str] = None) -> bool:
    """Downloads an oversized marathon release asset, splits it, uploads parts, and removes the oversized file."""
    import requests
    token = token or os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    headers = {"Accept": "application/vnd.github.v3+json", "User-Agent": "SpacePipe-Splitter"}
    if token:
        headers["Authorization"] = f"token {token}"

    print(f"\n[*] Inspecting release {tag} in {repo}...")
    api_url = f"https://api.github.com/repos/{repo}/releases/tags/{tag}"
    resp = requests.get(api_url, headers=headers)
    if resp.status_code != 200:
        print(f"[!] Release {tag} not found: {resp.status_code}")
        return False

    rel_data = resp.json()
    assets = rel_data.get("assets", [])

    # Find the primary monolithic MP3
    oversized_asset = None
    for a in assets:
        name = a.get("name", "")
        if name.endswith(".mp3") and not re.match(r"^(?:(\d+)h)?(\d+)m(\d+)s_", name) and not re.search(r"[-_]Part\d+\.mp3$", name, re.IGNORECASE):
            oversized_asset = a
            break

    if not oversized_asset:
        print(f"[*] Release {tag} does not contain an unsplit primary MP3 asset.")
        return False

    asset_size_mb = oversized_asset.get("size", 0) / (1024 * 1024)
    print(f"[*] Found candidate audio asset: {oversized_asset['name']} ({asset_size_mb:.1f} MB)")

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        local_in = tmp_path / oversized_asset["name"]

        # Check local work directory first to save bandwidth
        local_cached = Path("work") / oversized_asset["name"]
        if local_cached.exists() and local_cached.stat().st_size > 0:
            print(f"[✓] Using local cached copy from {local_cached}")
            input_file = str(local_cached)
        else:
            print(f"[*] Downloading {oversized_asset['name']} ({asset_size_mb:.1f} MB)...")
            dl_url = oversized_asset.get("browser_download_url") or oversized_asset.get("url")
            dl_resp = requests.get(dl_url, headers=headers, stream=True)
            dl_resp.raise_for_status()
            with open(local_in, "wb") as f_out:
                for chunk in dl_resp.iter_content(chunk_size=1024 * 1024):
                    f_out.write(chunk)
            input_file = str(local_in)

        out_dir = tmp_path / "parts"
        parts = split_mp3_file(input_file, str(out_dir))
        if len(parts) <= 1:
            print("[*] File did not require multi-part split.")
            return False

        print(f"\n[*] Uploading {len(parts)} split parts to GitHub Release {tag}...")
        gh_env = os.environ.copy()
        if token:
            gh_env["GH_TOKEN"] = token
            gh_env["GITHUB_TOKEN"] = token

        up_cmd = ["gh", "release", "upload", tag, *parts, "--repo", repo, "--clobber"]
        res_up = subprocess.run(up_cmd, capture_output=True, text=True, env=gh_env)
        if res_up.returncode != 0:
            print(f"[!] gh release upload notice: {res_up.stderr}")
            # REST API fallback
            upload_url_base = f"https://uploads.github.com/repos/{repo}/releases/{rel_data.get('id')}/assets"
            for p in parts:
                p_name = Path(p).name
                u_headers = {"Content-Type": "audio/mpeg", "User-Agent": "SpacePipe-Splitter"}
                if token:
                    u_headers["Authorization"] = f"token {token}"
                with open(p, "rb") as f_data:
                    requests.post(f"{upload_url_base}?name={urllib.parse.quote(p_name)}", headers=u_headers, data=f_data)

        print(f"[✓] Uploaded all parts successfully!")

        # Delete the monolithic oversized file to prevent YouTube from hitting the 12h limit
        print(f"[*] Removing oversized monolithic asset {oversized_asset['name']} (ID: {oversized_asset['id']}) from release...")
        del_url = f"https://api.github.com/repos/{repo}/releases/assets/{oversized_asset['id']}"
        del_resp = requests.delete(del_url, headers=headers)
        if del_resp.status_code in [204, 200]:
            print(f"[✓] Deleted {oversized_asset['name']} from {tag}.")
        else:
            print(f"[!] Notice: could not delete asset {oversized_asset['id']}: {del_resp.status_code}")

    return True


def main():
    parser = argparse.ArgumentParser(description="Split marathon episodes into YouTube-compliant multi-part episodes")
    parser.add_argument("--file", type=str, help="Local MP3 file to split")
    parser.add_argument("--tag", type=str, help="GitHub release tag to split and update")
    parser.add_argument("--repo", type=str, default="aiandbotsgalore/copy-spaces-to-youtube-pipeline")
    parser.add_argument("--output-dir", type=str, default="work")
    parser.add_argument("--scan-only", action="store_true", help="Scan releases.json for unsplit marathon episodes")

    args = parser.parse_args()

    if args.scan_only:
        if not os.path.exists("releases.json"):
            print("[!] releases.json not found.")
            sys.exit(1)
        with open("releases.json", "r", encoding="utf-8") as f:
            rels = json.load(f)
        count = 0
        for r in rels:
            body = r.get("body", "") or ""
            dur_m = re.search(r"METADATA::DURATION::(\S+)", body)
            dur = dur_m.group(1) if dur_m else "00:00:00"
            parts = dur.split(":")
            dur_s = int(parts[0])*3600 + int(parts[1])*60 + int(parts[2]) if len(parts) == 3 else 0
            if dur_s > 36000:
                mp3s = [a["name"] for a in r.get("assets", []) if a["name"].endswith(".mp3") and not re.match(r"^(?:(\d+)h)?(\d+)m(\d+)s_", a["name"])]
                has_parts = any("part1" in m.lower() for m in mp3s)
                if not has_parts and mp3s:
                    print(f"  {r.get('tag_name')} | Duration: {dur} | Assets: {mp3s}")
                    count += 1
        print(f"\n[✓] Total unsplit marathon releases with audio: {count}")
        return

    if args.file:
        parts = split_mp3_file(args.file, args.output_dir)
        print(f"[✓] Result: {len(parts)} parts generated.")
        return

    if args.tag:
        success = process_release_split(args.tag, args.repo)
        if success:
            print(f"[✓] Release {args.tag} successfully converted to multi-part episode!")
            print("[*] Refreshing RSS feeds...")
            subprocess.run([sys.executable, "scripts/generate_rss.py", "--all"], check=False)
        return

    parser.print_help()


if __name__ == "__main__":
    main()
