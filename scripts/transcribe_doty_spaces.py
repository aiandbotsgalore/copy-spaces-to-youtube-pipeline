#!/usr/bin/env python3
"""Download known Doty release MP3s and transcribe them with AssemblyAI."""

from __future__ import annotations

import argparse
import json
import re
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


def api_json(method: str, url: str, headers: dict[str, str], payload: dict | None = None) -> dict | list:
    data = None
    req_headers = dict(headers)
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        req_headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=req_headers)
    with urllib.request.urlopen(req, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


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
    req = urllib.request.Request(
        "https://api.assemblyai.com/v2/upload",
        data=audio_path.read_bytes(),
        method="POST",
        headers=headers,
    )
    with urllib.request.urlopen(req, timeout=3600) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return payload["upload_url"]


def request_transcript(api_key: str, audio_url: str) -> str:
    headers = {
        "authorization": api_key,
        "content-type": "application/json",
    }
    payload = {
        "audio_url": audio_url,
        "speaker_labels": True,
    }
    req = urllib.request.Request(
        "https://api.assemblyai.com/v2/transcript",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers=headers,
    )
    with urllib.request.urlopen(req, timeout=120) as response:
        body = json.loads(response.read().decode("utf-8"))
    return body["id"]


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
        time.sleep(15)


def sanitize_filename(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("_")
    return value or "transcript"


def save_outputs(output_dir: Path, item: dict, release: dict, transcript: dict) -> None:
    slug = sanitize_filename(f"{item['space_id']}_{item['title']}")
    txt_path = output_dir / f"{slug}.txt"
    json_path = output_dir / f"{slug}.json"

    txt_path.write_text(transcript.get("text", ""), encoding="utf-8")
    json_path.write_text(
        json.dumps(
            {
                "space_id": item["space_id"],
                "title": item["title"],
                "release_tag": release.get("tag_name"),
                "release_url": release.get("html_url"),
                "published_at": release.get("published_at"),
                "transcript_id": transcript.get("id"),
                "text": transcript.get("text", ""),
                "utterances": transcript.get("utterances", []),
            },
            indent=2,
        )
        + "\n",
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
    downloads_dir = output_dir / "_downloads"
    output_dir.mkdir(parents=True, exist_ok=True)
    downloads_dir.mkdir(parents=True, exist_ok=True)

    for item in DOTY_SPACES:
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

        print("Uploading to AssemblyAI", flush=True)
        upload_url = upload_to_assemblyai(args.assemblyai_api_key, audio_path)
        print("Requesting transcript", flush=True)
        transcript_id = request_transcript(args.assemblyai_api_key, upload_url)
        print(f"Polling transcript {transcript_id}", flush=True)
        transcript = poll_transcript(args.assemblyai_api_key, transcript_id)
        save_outputs(output_dir, item, release, transcript)

    print(f"Saved transcripts to {output_dir}", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        print(f"HTTP error: {error.code} {detail}", file=sys.stderr)
        raise
