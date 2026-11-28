#!/usr/bin/env python3
"""
scripts/cloud_transcribe_client.py

Client runner and batch orchestrator for SpacePipe ZeroGPU Cloud Transcriber.
Connects to Hugging Face ZeroGPU Space endpoint (via gradio_client or HTTP REST)
to transcribe and re-diarize Twitter Spaces audio with:
- Zero local GPU requirement (runs in GitHub Actions or locally)
- Quota-aware rate limiting with clean exit 0 on 429
- Atomic sync to public/transcripts/transcripts_summary_index.json
- Deterministic .srt and .txt artifact generation
- Direct asset upload to GitHub Releases
"""

import os
import sys
import json
import time
import shutil
import tempfile
import datetime
import subprocess
import urllib.request
from pathlib import Path
from typing import List, Dict, Any, Optional

try:
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)
except Exception:
    pass

DEFAULT_SPACE_ENDPOINT = (os.environ.get("HF_TRANSCRIBE_ENDPOINT") or "").strip() or "loganblack0/spacepipe-transcriber"


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


def is_quota_error(msg: str) -> bool:
    """Detects whether an error string represents a ZeroGPU / API quota exhaustion."""
    if not msg:
        return False
    lower = msg.lower()
    return any(p in lower for p in [
        "429",
        "quota exceeded",
        "quota_exceeded",
        "zerogpu quota",
        "exceeded your gpu quota",
        "rate limit",
        "too many requests"
    ])


def format_timestamp_srt(seconds: float) -> str:
    """Formats float seconds to SRT time format: HH:MM:SS,mmm"""
    ms = int(round((seconds - int(seconds)) * 1000))
    s = int(seconds) % 60
    m = (int(seconds) // 60) % 60
    h = int(seconds) // 3600
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def format_timestamp_txt(seconds: float) -> str:
    """Formats float seconds to TXT time format: [HH:MM:SS]"""
    s = int(seconds) % 60
    m = (int(seconds) // 60) % 60
    h = int(seconds) // 3600
    return f"[{h:02d}:{m:02d}:{s:02d}]"


def generate_srt_content(segments: List[Dict[str, Any]]) -> str:
    """Generates valid SubRip (.srt) transcript content."""
    lines = []
    idx = 1
    for s in segments:
        st = format_timestamp_srt(float(s.get("start", 0.0)))
        et = format_timestamp_srt(float(s.get("end", 0.0)))
        spk = s.get("speaker", "Speaker")
        txt = str(s.get("text", "")).strip()
        lines.append(f"{idx}\n{st} --> {et}\n{spk}: {txt}\n")
        idx += 1
    return "\n".join(lines)


def generate_txt_content(segments: List[Dict[str, Any]]) -> str:
    """Generates plain text (.txt) transcript content with timestamp headers."""
    lines = []
    for s in segments:
        st = format_timestamp_txt(float(s.get("start", 0.0)))
        spk = s.get("speaker", "Speaker")
        txt = str(s.get("text", "")).strip()
        lines.append(f"{st} {spk}: {txt}")
    return "\n".join(lines)


def build_summary_entry(
    release_tag: str,
    title: str,
    audio_url: str,
    segments: List[Dict[str, Any]],
    release_id: int = 0,
    published_at: Optional[str] = None,
    episode_date: Optional[str] = None,
    host_handle: Optional[str] = None,
    body: Optional[str] = None
) -> Dict[str, Any]:
    """Builds a summary entry adhering strictly to EpisodeSummary."""
    speakers_set = set()
    total_duration = 0.0
    for s in segments:
        spk = s.get("speaker")
        if spk:
            speakers_set.add(spk)
        e = float(s.get("end", 0.0))
        if e > total_duration:
            total_duration = e

    speakers = sorted(list(speakers_set))
    now_iso = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    return {
        "release_id": release_id or int(time.time()),
        "release_tag": release_tag,
        "title": title,
        "published_at": published_at or now_iso,
        "episode_date": episode_date or (release_tag[:8] if len(release_tag) >= 8 and release_tag[:8].isdigit() else None),
        "audio_url": audio_url,
        "segment_count": len(segments),
        "duration_sec": int(round(total_duration)),
        "host_handle": host_handle,
        "speakers": speakers,
        "body": body or f"- **Title:** {title}\n- **Duration:** {int(round(total_duration))}s"
    }


def atomic_update_summary_index(index_path: str, new_entry: Dict[str, Any]):
    """
    Atomically updates transcripts_summary_index.json using a tempfile and os.replace
    to prevent file corruption during concurrent operations or CI interruptions.
    """
    index_file = Path(index_path)
    existing_entries: List[Dict[str, Any]] = []

    if index_file.exists():
        try:
            with open(index_file, "r", encoding="utf-8") as f:
                content = f.read().strip()
                if content:
                    existing_entries = json.loads(content)
        except Exception as e:
            raise ValueError(f"Cannot safely update unreadable summary index: {e}") from e

    # Upsert new_entry by release_tag
    updated = False
    for i, item in enumerate(existing_entries):
        if item.get("release_tag") == new_entry.get("release_tag"):
            # Merge fields while preserving original published_at / release_id if not supplied
            merged = dict(item)
            merged.update({k: v for k, v in new_entry.items() if v is not None})
            existing_entries[i] = merged
            updated = True
            break

    if not updated:
        existing_entries.append(new_entry)

    # Sort by release_tag descending
    existing_entries.sort(key=lambda x: str(x.get("release_tag", "")), reverse=True)

    # Atomic write via tempfile in same directory
    dir_name = os.path.dirname(os.path.abspath(index_path))
    os.makedirs(dir_name, exist_ok=True)
    temp_fd, temp_path = tempfile.mkstemp(dir=dir_name, prefix="summary_idx_", suffix=".tmp")
    try:
        with open(temp_fd, "w", encoding="utf-8") as f:
            json.dump(existing_entries, f, indent=2, ensure_ascii=False)
        os.replace(temp_path, index_path)
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass


def sync_to_local_transcripts(
    tag: str,
    title: str,
    segments: List[Dict[str, Any]],
    turns: Optional[List[Dict[str, Any]]] = None,
    audio_url: str = "",
    base_dir: str = "public/transcripts"
) -> Dict[str, str]:
    """
    Writes verified transcript JSON, SRT, and TXT artifacts and updates summary index.
    """
    ep_dir = Path(base_dir) / "episodes"
    ep_dir.mkdir(parents=True, exist_ok=True)

    json_path = ep_dir / f"{tag}.json"
    srt_path = ep_dir / f"{tag}.srt"
    txt_path = ep_dir / f"{tag}.txt"

    # Save full transcript JSON
    full_data = json.loads(json_path.read_text(encoding="utf-8")) if json_path.exists() else {}
    if not isinstance(full_data, dict):
        full_data = {}
    full_data.update({
        "release_tag": tag,
        "title": title,
        "audio_url": audio_url,
        "segments": segments,
        "turns": turns or []
    })
    contents = {
        json_path: json.dumps(full_data, indent=2, ensure_ascii=False, allow_nan=False),
        srt_path: generate_srt_content(segments),
        txt_path: generate_txt_content(segments),
    }
    staged = []
    try:
        # Stage every artifact before replacing any source file.
        for path, content in contents.items():
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=ep_dir,
                                             suffix=".tmp", delete=False) as handle:
                staged.append((Path(handle.name), path))
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
        for temporary, destination in staged:
            os.replace(temporary, destination)
    finally:
        for temporary, _ in staged:
            temporary.unlink(missing_ok=True)

    # Update index
    summary_path = Path(base_dir) / "transcripts_summary_index.json"
    existing_summary = {}
    if summary_path.exists():
        entries = json.loads(summary_path.read_text(encoding="utf-8"))
        existing_summary = next((item for item in entries if item.get("release_tag") == tag), {})
    entry = build_summary_entry(tag, title, audio_url, segments,
                                **{key: existing_summary.get(key) for key in
                                   ("release_id", "published_at", "episode_date", "host_handle", "body")})
    atomic_update_summary_index(str(summary_path), entry)

    # Keep existing search-index rows consistent with the repaired canonical episode.
    search_path = Path(base_dir) / "transcripts_search_index.json"
    if search_path.exists():
        search_entries = json.loads(search_path.read_text(encoding="utf-8"))
        for episode in search_entries:
            if episode.get("release_tag") == tag:
                episode.update({"segments": segments, "segment_count": len(segments),
                                "speakers": entry["speakers"]})
        temporary = search_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(search_entries, ensure_ascii=False), encoding="utf-8")
        os.replace(temporary, search_path)
    if Path(base_dir).resolve() == Path("public/transcripts").resolve():
        dist = Path("dist/transcripts")
        if dist.exists():
            (dist / "episodes").mkdir(exist_ok=True)
            for source in (json_path, srt_path, txt_path):
                shutil.copy2(source, dist / "episodes" / source.name)
            shutil.copy2(summary_path, dist / summary_path.name)
            if search_path.exists():
                shutil.copy2(search_path, dist / search_path.name)

    return {
        "json": str(json_path),
        "srt": str(srt_path),
        "txt": str(txt_path)
    }


def create_gradio_client(endpoint, token=None):
    import inspect
    from gradio_client import Client
    params = inspect.signature(Client).parameters
    kwargs = {}
    if "httpx_kwargs" in params:
        kwargs["httpx_kwargs"] = {"timeout": 180.0}
    if token:
        if "token" in params:
            kwargs["token"] = token
        elif "hf_token" in params:
            kwargs["hf_token"] = token
        else:
            raise RuntimeError("Installed gradio_client has no supported token authentication parameter")
    return Client(endpoint, **kwargs)


def clobber_upload_to_github_release(repo, tag, file_paths, token=None):
    env = os.environ.copy()
    if token:
        env["GH_TOKEN"] = token
    subprocess.run(["gh", "release", "upload", tag, *file_paths, "--repo", repo, "--clobber"],
                   env=env, check=True, capture_output=True)


def _candidate_hf_tokens(explicit_token: Optional[str] = None) -> List[Optional[str]]:
    tokens: List[Optional[str]] = []
    for t in (explicit_token, os.environ.get("HF_TOKEN"), os.environ.get("HF_BACKUP_TOKEN")):
        cleaned = (t or "").strip()
        if cleaned and cleaned not in tokens:
            tokens.append(cleaned)
    return tokens or [None]


def _invoke_zerogpu_once(
    action: str,
    audio_url: str,
    target_endpoint: str,
    token: Optional[str],
    api_key: str,
    existing_segments: Optional[List[Dict[str, Any]]] = None,
    enrolled_profiles: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    client = create_gradio_client(target_endpoint, token)

    if action == "transcribe":
        result = client.predict(
            audio_url=audio_url,
            api_key=api_key,
            min_speakers=1,
            max_speakers=15,
            api_name="/transcribe"
        )
    elif action == "rediarize":
        segs_json = json.dumps(existing_segments or [])
        profiles_json = json.dumps(enrolled_profiles or {})
        result = client.predict(
            audio_url=audio_url,
            existing_segments_json=segs_json,
            api_key=api_key,
            enrolled_profiles_json=profiles_json,
            min_speakers=1,
            max_speakers=15,
            api_name="/rediarize"
        )
    else:
        raise ValueError(f"Unknown action: {action}")

    if isinstance(result, str):
        return json.loads(result)
    return result


def call_zerogpu_space(
    action: str,
    audio_url: str,
    endpoint: Optional[str] = None,
    existing_segments: Optional[List[Dict[str, Any]]] = None,
    enrolled_profiles: Optional[Dict[str, Any]] = None,
    hf_token: Optional[str] = None,
    space_api_key: Optional[str] = None
) -> Dict[str, Any]:
    """
    Calls the Hugging Face ZeroGPU Space endpoint with HF_TOKEN -> HF_BACKUP_TOKEN rotation.
    Passes SPACE_API_KEY as an explicit api_key parameter to the endpoint function.
    """
    api_key = space_api_key or os.environ.get("SPACE_API_KEY", "")
    target_endpoint = (endpoint or DEFAULT_SPACE_ENDPOINT or "").strip() or "loganblack0/spacepipe-transcriber"

    try:
        from gradio_client import Client  # noqa: F401
    except ImportError:
        raise RuntimeError("gradio_client is required to connect to SpacePipe ZeroGPU Space.")

    tokens = _candidate_hf_tokens(hf_token)
    last_err: Optional[Exception] = None
    last_res: Optional[Dict[str, Any]] = None

    for idx, tok in enumerate(tokens):
        try:
            res = _invoke_zerogpu_once(
                action=action,
                audio_url=audio_url,
                target_endpoint=target_endpoint,
                token=tok,
                api_key=api_key,
                existing_segments=existing_segments,
                enrolled_profiles=enrolled_profiles,
            )
            last_res = res
            if isinstance(res, dict) and res.get("error") and is_quota_error(str(res["error"])) and idx + 1 < len(tokens):
                print(f"[!] ZeroGPU quota hit on HF token #{idx + 1}; retrying with backup HF token...")
                continue
            return res
        except Exception as exc:
            last_err = exc
            if is_quota_error(str(exc)) and idx + 1 < len(tokens):
                print(f"[!] ZeroGPU quota hit on HF token #{idx + 1}; retrying with backup HF token...")
                continue
            raise

    if last_res is not None:
        return last_res
    if last_err is not None:
        raise last_err
    return {"error": "ZeroGPU call failed without response"}


def fetch_release_details(repo: str, tag: str, token: Optional[str] = None) -> Dict[str, Any]:
    """Finds primary audio download URL and release metadata for a release tag."""
    import re
    url = f"https://api.github.com/repos/{repo}/releases/tags/{tag}"
    headers = {"Accept": "application/vnd.github.v3+json", "User-Agent": "SpacePipe-ZeroGPUClient"}
    if token:
        headers["Authorization"] = f"token {token}"
    req = urllib.request.Request(url, headers=headers)
    details: Dict[str, Any] = {}
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            details["release_id"] = data.get("id")
            details["title"] = data.get("name") or tag
            details["published_at"] = data.get("published_at") or data.get("created_at")
            body = data.get("body") or ""
            details["body"] = body
            m_host = re.search(r"METADATA::HOST::@?([A-Za-z0-9_.\-]+)", body)
            if m_host:
                details["host_handle"] = m_host.group(1)
            m_date = re.search(r"METADATA::EPISODE_DATE::(\d{8})", body)
            if m_date:
                d = m_date.group(1)
                details["episode_date"] = f"{d[:4]}-{d[4:6]}-{d[6:8]}"
            for asset in data.get("assets", []):
                name = asset.get("name", "").lower()
                if name.endswith(".mp3") or name.endswith(".m4a") or name.endswith(".wav"):
                    details["audio_url"] = asset.get("browser_download_url")
                    break
    except Exception as e:
        print(f"[Warning] Could not fetch release info for {tag}: {e}")
    return details


def fetch_release_audio_url(repo: str, tag: str, token: Optional[str] = None) -> Optional[str]:
    """Finds the primary audio download URL for a release tag."""
    return fetch_release_details(repo, tag, token).get("audio_url")


def load_verified_voice_profiles() -> Dict[str, Any]:
    """Loads verified 192-dim ECAPA-TDNN voice profiles from voice_profiles.json."""
    for candidate in (
        Path("voice_profiles.json"),
        Path(__file__).resolve().parent.parent / "voice_profiles.json",
        Path("public/voice_profiles.json"),
    ):
        if candidate.exists():
            try:
                raw = json.loads(candidate.read_text(encoding="utf-8"))
                profiles = raw.get("profiles", {}) if isinstance(raw, dict) else {}
                return {
                    name: p
                    for name, p in profiles.items()
                    if isinstance(p, dict)
                    and p.get("identity_verified") is True
                    and p.get("suggestions_paused") is not True
                    and p.get("embedding_model") == "speechbrain/spkrec-ecapa-voxceleb"
                    and isinstance(p.get("embedding"), list)
                    and len(p["embedding"]) == 192
                }
            except Exception as e:
                print(f"[Warning] Could not parse {candidate}: {e}")
    return {}


def main():
    import argparse
    parser = argparse.ArgumentParser(description="SpacePipe ZeroGPU Cloud Transcriber Client")
    parser.add_argument("--release-tag", type=str, help="Release tag to transcribe")
    parser.add_argument("--audio-url", type=str, help="Direct audio URL")
    parser.add_argument("--title", type=str, help="Episode title")
    parser.add_argument("--repo", type=str, default="aiandbotsgalore/copy-spaces-to-youtube-pipeline", help="GitHub repo")
    parser.add_argument("--endpoint", type=str, help="ZeroGPU Space endpoint")
    parser.add_argument("--no-upload", action="store_true", help="Do not upload assets to release")
    parser.add_argument("--gh-token", type=str, help="GitHub token")

    args = parser.parse_args()

    token = args.gh_token or os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    rel_details: Dict[str, Any] = {}
    if args.release_tag:
        rel_details = fetch_release_details(args.repo, args.release_tag, token)
    audio_url = args.audio_url or rel_details.get("audio_url")

    if not audio_url:
        print("[Error] No audio URL provided or found on release.")
        sys.exit(1)

    tag = args.release_tag or "custom_transcription"
    title = args.title or rel_details.get("title") or tag

    print(f"[*] Calling ZeroGPU Space endpoint for {tag} ({audio_url})...")
    res = call_zerogpu_space(
        action="transcribe",
        audio_url=audio_url,
        endpoint=args.endpoint
    )

    if res.get("error"):
        print(f"[Error] ZeroGPU transcription failed: {res['error']}")
        sys.exit(1)

    segments = res.get("segments", [])
    turns = res.get("turns", [])

    # Resolve generic speaker labels ("Speaker 1", "Speaker 2", ...) against verified voiceprints
    has_generic_speakers = any(
        str(s.get("speaker", "")).strip().lower().startswith("speaker")
        for s in segments
    )
    enrolled_profiles = load_verified_voice_profiles()
    resolved_via_zerogpu = False
    if segments and has_generic_speakers and enrolled_profiles:
        print(f"[*] Matching diarized clusters against {len(enrolled_profiles)} verified voice profile(s) via /rediarize...")
        try:
            redi = call_zerogpu_space(
                action="rediarize",
                audio_url=audio_url,
                existing_segments=segments,
                enrolled_profiles=enrolled_profiles,
                endpoint=args.endpoint,
            )
            if isinstance(redi, dict) and not redi.get("error") and redi.get("segments"):
                segments = redi["segments"]
                turns = redi.get("turns") or turns
                matched = redi.get("matched_speakers") or {}
                resolved_via_zerogpu = True
                print(f"[✓] Biometric speaker matching resolved: {matched or 'no confident matches'}")
            elif isinstance(redi, dict) and redi.get("error"):
                print(f"[Warning] Biometric ZeroGPU /rediarize skipped: {redi['error']}")
        except Exception as e:
            print(f"[Warning] Biometric ZeroGPU /rediarize skipped: {e}")

        if not resolved_via_zerogpu:
            try:
                sys.path.insert(0, str(Path(__file__).resolve().parent))
                from transcribe_and_diarize import resolve_speakers_acoustically
                with tempfile.TemporaryDirectory() as tmp_audio_dir:
                    local_mp3 = Path(tmp_audio_dir) / f"{tag}.mp3"
                    print("[*] Falling back to local SpeechBrain ECAPA-TDNN matching on downloaded audio...")
                    import requests as _req
                    with _req.get(audio_url, stream=True, timeout=180) as r:
                        r.raise_for_status()
                        with open(local_mp3, "wb") as f_out:
                            for chunk in r.iter_content(chunk_size=1048576):
                                if chunk:
                                    f_out.write(chunk)
                    cpu_map = resolve_speakers_acoustically(segments, audio_path=local_mp3)
                    if cpu_map:
                        for seg in segments:
                            if seg.get("speaker") in cpu_map:
                                seg.setdefault("raw_speaker", seg["speaker"])
                                seg["speaker"] = cpu_map[seg["speaker"]]
                                seg["attribution"] = {"method": "acoustic", "model": "speechbrain/spkrec-ecapa-voxceleb"}
                        print(f"[✓] CPU biometric speaker matching resolved: {cpu_map}")
            except Exception as cpu_err:
                print(f"[Warning] CPU biometric speaker fallback unavailable: {cpu_err}")

    artifacts = sync_to_local_transcripts(tag, title, segments, turns, audio_url)
    # Enrich transcripts_summary_index.json with release metadata if available
    if rel_details:
        summary_path = Path("public/transcripts/transcripts_summary_index.json")
        entry = build_summary_entry(
            tag,
            title,
            audio_url,
            segments,
            release_id=rel_details.get("release_id") or 0,
            published_at=rel_details.get("published_at"),
            episode_date=rel_details.get("episode_date"),
            host_handle=rel_details.get("host_handle"),
            body=rel_details.get("body"),
        )
        atomic_update_summary_index(str(summary_path), entry)
    print(f"[✓] Transcribed {len(segments)} segments. Synced to {artifacts['json']}")

    if not args.no_upload and args.release_tag:
        clobber_upload_to_github_release(args.repo, tag, [artifacts["json"], artifacts["srt"], artifacts["txt"]], token)
        print(f"[✓] Uploaded assets to release {tag}")


if __name__ == "__main__":
    main()
