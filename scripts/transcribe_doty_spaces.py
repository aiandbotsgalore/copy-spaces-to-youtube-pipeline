#!/usr/bin/env python3
"""Download known Doty release MP3s and transcribe them with AssemblyAI."""

from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DOTY_SPACES = [
    {
        "space_id": "1ZkJzXoNpLXKv",
        "title": "I Believe in Doty the Bigtoe",
    },
    {
        "space_id": "1YqGoAvArzMxv",
        "title": "The Doty Space of Legend - Hour 17 👽👨‍🎤",
    },
    {
        "space_id": "1vAxRDXmRqqGl",
        "title": "Rick Doty Live! (Reboot)",
    },
    {
        "space_id": "1lPJqBOmvlexb",
        "title": "Rick Doty 5pm PST Tonight on #perualiens & #davidgrusch",
    },
    {
        "space_id": "1PlJQpbVMrYGE",
        "title": "Richard Doty on #PeruAliens & #DavidGrusch & answering your questions!",
    },
    {
        "space_id": "1jMJgLadNWmxL",
        "title": "5-1030pm Richard Doty Q & A , then afterParty till morning🛸👽",
    },
    {
        "space_id": "1gqxvyaLkmRJB",
        "title": "Logan Is Disclosure lol With Rick Doty",
    },
]

MAX_TRANSCRIPT_SECONDS = 8 * 60 * 60
POLL_SECONDS = 15
RETRYABLE_HTTP_CODES = {408, 409, 425, 429, 500, 502, 503, 504}
RETRY_ATTEMPTS = 5


def api_json(method: str, url: str, headers: dict[str, str], payload: dict | None = None) -> dict | list:
    data = None
    req_headers = dict(headers)
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        req_headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=req_headers)
    with urllib.request.urlopen(req, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def with_retries(label: str, func):
    delay = 5
    last_error = None
    for attempt in range(1, RETRY_ATTEMPTS + 1):
        try:
            return func()
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            if error.code not in RETRYABLE_HTTP_CODES or attempt == RETRY_ATTEMPTS:
                raise RuntimeError(f"{label} failed with HTTP {error.code}: {body}") from error
            print(f"{label} retry {attempt}/{RETRY_ATTEMPTS} after HTTP {error.code}", flush=True)
            last_error = error
        except urllib.error.URLError as error:
            if attempt == RETRY_ATTEMPTS:
                raise RuntimeError(f"{label} failed after retries: {error}") from error
            print(f"{label} retry {attempt}/{RETRY_ATTEMPTS} after network error: {error}", flush=True)
            last_error = error
        time.sleep(delay)
        delay *= 2
    raise RuntimeError(f"{label} failed after retries: {last_error}")


def find_release(repo: str, github_token: str, space_id: str) -> dict:
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {github_token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    page = 1
    while True:
        url = f"https://api.github.com/repos/{repo}/releases?per_page=100&page={page}"
        releases = api_json("GET", url, headers)
        if not releases:
            break
        for release in releases:
            body = release.get("body", "") or ""
            tag_name = release.get("tag_name", "") or ""
            if re.search(rf"(^|\n)\*\*Space ID:\*\*\s*{re.escape(space_id)}($|\n)", body) or tag_name.endswith(f"_{space_id}"):
                return release
        page += 1
    raise RuntimeError(f"Could not find release for space ID {space_id}")


def download_file(url: str, destination: Path) -> None:
    req = urllib.request.Request(url, headers={"Accept": "application/octet-stream", "User-Agent": "codex-doty-transcriber"})
    with urllib.request.urlopen(req, timeout=600) as response, destination.open("wb") as output_file:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            output_file.write(chunk)


def upload_to_assemblyai(api_key: str, audio_path: Path) -> str:
    headers = {"authorization": api_key}

    def do_upload() -> str:
        req = urllib.request.Request(
            "https://api.assemblyai.com/v2/upload",
            data=audio_path.read_bytes(),
            method="POST",
            headers=headers,
        )
        with urllib.request.urlopen(req, timeout=3600) as response:
            payload = json.loads(response.read().decode("utf-8"))
        return payload["upload_url"]

    return with_retries(f"upload {audio_path.name}", do_upload)


def request_transcript(api_key: str, audio_url: str) -> str:
    headers = {
        "authorization": api_key,
        "content-type": "application/json",
    }
    payload = {
        "audio_url": audio_url,
        "speech_model": "best",
        "language_code": "en",
        "punctuate": True,
        "format_text": True,
        "speaker_labels": True,
    }

    def do_request() -> str:
        req = urllib.request.Request(
            "https://api.assemblyai.com/v2/transcript",
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers=headers,
        )
        with urllib.request.urlopen(req, timeout=120) as response:
            body = json.loads(response.read().decode("utf-8"))
        return body["id"]

    return with_retries("request transcript", do_request)


def poll_transcript(api_key: str, transcript_id: str) -> dict:
    headers = {"authorization": api_key}
    url = f"https://api.assemblyai.com/v2/transcript/{urllib.parse.quote(transcript_id)}"
    while True:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=120) as response:
            body = json.loads(response.read().decode("utf-8"))
        status = body.get("status")
        if status == "completed":
            return body
        if status == "error":
            raise RuntimeError(f"AssemblyAI transcription failed: {body.get('error', 'unknown error')}")
        time.sleep(POLL_SECONDS)


def sanitize_filename(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("_")
    return value or "transcript"


def probe_duration_seconds(audio_path: Path) -> float:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(audio_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(result.stdout.strip())


def split_audio_if_needed(audio_path: Path, chunks_dir: Path) -> list[Path]:
    duration = probe_duration_seconds(audio_path)
    if duration <= MAX_TRANSCRIPT_SECONDS:
        return [audio_path]

    chunks_dir.mkdir(parents=True, exist_ok=True)
    chunk_pattern = chunks_dir / f"{audio_path.stem}_part_%03d.mp3"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(audio_path),
            "-f",
            "segment",
            "-segment_time",
            str(MAX_TRANSCRIPT_SECONDS),
            "-reset_timestamps",
            "1",
            "-c",
            "copy",
            str(chunk_pattern),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    chunk_files = sorted(chunks_dir.glob(f"{audio_path.stem}_part_*.mp3"))
    if not chunk_files:
        raise RuntimeError(f"Failed to split long audio file: {audio_path}")
    print(
        f"Split {audio_path.name} ({math.ceil(duration / 3600)}h) into {len(chunk_files)} chunks for AssemblyAI",
        flush=True,
    )
    return chunk_files


def save_outputs(output_dir: Path, item: dict, release: dict, transcript_text: str, chunk_results: list[dict], error: str = "") -> None:
    slug = sanitize_filename(f"{item['space_id']}_{item['title']}")
    txt_path = output_dir / f"{slug}.txt"
    json_path = output_dir / f"{slug}.json"

    if transcript_text:
        txt_path.write_text(transcript_text, encoding="utf-8")
    json_path.write_text(
        json.dumps(
            {
                "space_id": item["space_id"],
                "title": item["title"],
                "release_tag": release.get("tag_name"),
                "release_url": release.get("html_url"),
                "published_at": release.get("published_at"),
                "chunk_count": len(chunk_results),
                "chunks": chunk_results,
                "text": transcript_text,
                "error": error,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def write_summary(output_dir: Path, successes: list[dict], failures: list[dict]) -> None:
    lines = ["# Doty transcription summary", "", f"- Successful: {len(successes)}", f"- Failed: {len(failures)}", ""]
    if successes:
        lines.append("## Successful")
        for success in successes:
            lines.append(f"- {success['space_id']}: {success['title']} ({success['chunk_count']} chunk(s))")
        lines.append("")
    if failures:
        lines.append("## Failed")
        for failure in failures:
            lines.append(f"- {failure['space_id']}: {failure['title']} — {failure['error']}")
        lines.append("")
    (output_dir / "SUMMARY.md").write_text("\n".join(lines), encoding="utf-8")
    (output_dir / "summary.json").write_text(
        json.dumps({"successful": successes, "failed": failures}, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Transcribe known Doty release assets with AssemblyAI.")
    parser.add_argument("--repo", required=True)
    parser.add_argument("--github-token", required=True)
    parser.add_argument("--assemblyai-api-key", required=True)
    parser.add_argument("--output-dir", default="transcripts/doty")
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    work_root = Path(".tmp_transcripts") / "doty"
    downloads_dir = work_root / "downloads"
    chunks_root = work_root / "chunks"
    downloads_dir.mkdir(parents=True, exist_ok=True)
    chunks_root.mkdir(parents=True, exist_ok=True)

    successes: list[dict] = []
    failures: list[dict] = []

    for item in DOTY_SPACES:
        release: dict = {}
        try:
            print(f"Processing {item['space_id']} - {item['title']}", flush=True)
            release = find_release(args.repo, args.github_token, item["space_id"])
            asset = next((asset for asset in release.get("assets", []) if asset.get("name", "").endswith(".mp3")), None)
            if asset is None:
                raise RuntimeError(f"No MP3 asset found for release {release.get('tag_name')}")

            audio_name = sanitize_filename(asset["name"])
            audio_path = downloads_dir / audio_name
            if not audio_path.exists():
                print(f"Downloading {asset['browser_download_url']}", flush=True)
                download_file(asset["browser_download_url"], audio_path)

            chunk_paths = split_audio_if_needed(audio_path, chunks_root / item["space_id"])
            chunk_results: list[dict] = []
            texts: list[str] = []
            for index, chunk_path in enumerate(chunk_paths, start=1):
                print(f"Uploading chunk {index}/{len(chunk_paths)}: {chunk_path.name}", flush=True)
                upload_url = upload_to_assemblyai(args.assemblyai_api_key, chunk_path)
                print(f"Requesting transcript for chunk {index}/{len(chunk_paths)}", flush=True)
                transcript_id = request_transcript(args.assemblyai_api_key, upload_url)
                print(f"Polling transcript {transcript_id}", flush=True)
                transcript = poll_transcript(args.assemblyai_api_key, transcript_id)
                chunk_text = transcript.get("text", "")
                chunk_utterances = transcript.get("utterances") or []
                chunk_results.append(
                    {
                        "chunk_index": index,
                        "file": chunk_path.name,
                        "transcript_id": transcript.get("id"),
                        "model_used": transcript.get("speech_model_used", "universal-3-5-pro"),
                        "text": chunk_text,
                        "utterances": chunk_utterances,
                    }
                )
                chunk_lines = []
                for u in chunk_utterances:
                    spk = f"Speaker {u['speaker']}" if not str(u['speaker']).startswith("Speaker") else str(u['speaker'])
                    s_sec = int(u.get("start", 0)) // 1000
                    e_sec = int(u.get("end", 0)) // 1000
                    s_fmt = f"{s_sec // 3600:02d}:{(s_sec % 3600) // 60:02d}:{s_sec % 60:02d}"
                    e_fmt = f"{e_sec // 3600:02d}:{(e_sec % 3600) // 60:02d}:{e_sec % 60:02d}"
                    chunk_lines.append(f"[{s_fmt} - {e_fmt}] {spk}: {u.get('text', '').strip()}")
                if not chunk_lines and chunk_text:
                    chunk_lines.append(chunk_text.strip())
                texts.append("\n\n".join(chunk_lines))

            transcript_text = "\n\n---\n\n".join(text.strip() for text in texts if text.strip())
            save_outputs(output_dir, item, release, transcript_text, chunk_results)
            successes.append(
                {
                    "space_id": item["space_id"],
                    "title": item["title"],
                    "chunk_count": len(chunk_results),
                }
            )
        except Exception as error:
            print(f"ERROR for {item['space_id']}: {error}", flush=True)
            save_outputs(output_dir, item, release, "", [], error=str(error))
            failures.append(
                {
                    "space_id": item["space_id"],
                    "title": item["title"],
                    "error": str(error),
                }
            )

    write_summary(output_dir, successes, failures)
    print(f"Saved transcripts to {output_dir}", flush=True)
    if failures:
        print(f"Completed with {len(failures)} failure(s)", flush=True)
        return 1
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        print(f"HTTP error: {error.code} {detail}", file=sys.stderr)
        raise
