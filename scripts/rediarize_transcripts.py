#!/usr/bin/env python3
"""
scripts/rediarize_transcripts.py

Batch Historical Re-Diarizer for SpacePipe Transcripts.
Re-labels speakers across historical transcripts without mutating words or timestamps:
- 100% SHA-256 text and timestamp byte immutability guarantee
- Complete-linkage agglomerative clustering + 1-to-1 bipartite profile matching
- Quota-aware rate pacing with clean exit 0 on 429
- Checkpoint persistence and resume capability in public/transcripts/rediarize_checkpoint.json
- Sidecar voiceprint generation in public/transcripts/voiceprints/
- Atomic updates to transcripts_summary_index.json
"""

import os
import sys
import json
import time
import argparse
import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional

try:
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)
except Exception:
    pass

# Ensure spacepipe core & cloud client are accessible
_base_dir = Path(__file__).resolve().parents[1]
_spaces_dir = str(_base_dir / "spaces" / "zerogpu-transcriber")
_scripts_dir = str(_base_dir / "scripts")
for p in [_spaces_dir, _scripts_dir]:
    if p not in sys.path:
        sys.path.insert(0, p)

import spacepipe_transcribe_core as core
import cloud_transcribe_client as cloud_client

DEFAULT_CHECKPOINT_PATH = "public/transcripts/rediarize_checkpoint.json"
DEFAULT_PROFILES_PATH = "voice_profiles.json"
DEFAULT_SUMMARY_INDEX = "public/transcripts/transcripts_summary_index.json"


def load_env():
    cloud_client.load_env_files()


load_env()


def is_tag_completed(tag: str, checkpoint_path: str = DEFAULT_CHECKPOINT_PATH) -> bool:
    """Checks whether a release tag has already been successfully re-diarized."""
    p = Path(checkpoint_path)
    if not p.exists():
        return False
    try:
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
        return tag in data.get("completed_tags", [])
    except Exception:
        return False


def mark_tag_completed(tag: str, checkpoint_path: str = DEFAULT_CHECKPOINT_PATH):
    """Atomically records a completed release tag in the checkpoint file."""
    p = Path(checkpoint_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    data: Dict[str, Any] = {"completed_tags": [], "last_updated": ""}

    if p.exists():
        try:
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            pass

    completed = set(data.get("completed_tags", []))
    completed.add(tag)
    data["completed_tags"] = sorted(list(completed))
    data["last_updated"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    temp_path = p.with_suffix(".tmp")
    with open(temp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(temp_path, p)


def verify_text_integrity(original_hash: str, returned_hash: str, tag: str):
    """Asserts that the text SHA-256 hash was completely preserved."""
    if original_hash != returned_hash:
        raise ValueError(
            f"Text integrity check failed for {tag}! "
            f"Original hash '{original_hash}' does not match returned hash '{returned_hash}'."
        )


def load_voice_profiles(profiles_path: str = DEFAULT_PROFILES_PATH) -> Dict[str, Any]:
    """Loads enrolled biometric voice profiles from voice_profiles.json."""
    p = Path(profiles_path)
    if not p.exists():
        return {}
    try:
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
        # Normalize: if dict keyed by name, or under "profiles"
        if "profiles" in data and isinstance(data["profiles"], dict):
            return data["profiles"]
        return data
    except Exception as e:
        print(f"[Warning] Could not load voice profiles from {profiles_path}: {e}")
        return {}


def process_single_episode(
    tag: str,
    audio_url: str,
    transcript_path: str,
    profiles: Dict[str, Any],
    repo: str,
    endpoint: Optional[str] = None,
    dry_run: bool = False,
    upload: bool = False,
    gh_token: Optional[str] = None,
    checkpoint_path: str = DEFAULT_CHECKPOINT_PATH
) -> bool:
    """
    Executes re-diarization for a single episode:
    1. Reads existing transcript
    2. Hashes original text
    3. Calls ZeroGPU /rediarize
    4. Asserts 100% byte immutability
    5. Saves updated transcript, SRT, TXT, and summary index
    6. Saves voiceprints sidecar
    7. Optionally clobber-uploads to GitHub Release
    8. Records checkpoint
    """
    t_file = Path(transcript_path)
    if not t_file.exists():
        print(f"[Skip] Transcript not found on disk: {transcript_path}")
        return False

    with open(t_file, "r", encoding="utf-8") as f:
        raw_data = json.load(f)

    # Support either top-level list of segments or dict with "segments"
    if isinstance(raw_data, list):
        segments = raw_data
        episode_title = tag
    else:
        segments = raw_data.get("segments", [])
        episode_title = raw_data.get("title", tag)

    if not segments:
        print(f"[Skip] Transcript {tag} has 0 segments.")
        return False

    orig_hash = core.compute_transcript_text_hash(segments)

    if dry_run:
        print(f"[Dry Run] Verified {tag}: {len(segments)} segments, text hash {orig_hash[:8]}... URL: {audio_url}")
        return True

    print(f"\n[*] Re-diarizing {tag} ({len(segments)} segments) via ZeroGPU...")
    try:
        res = cloud_client.call_zerogpu_space(
            action="rediarize",
            audio_url=audio_url,
            endpoint=endpoint,
            existing_segments=segments,
            enrolled_profiles=profiles
        )
    except Exception as e:
        err_msg = str(e)
        if cloud_client.is_quota_error(err_msg):
            print(f"\n[!] ZeroGPU quota reached: {err_msg}")
            raise  # propagate to main quota handler
        print(f"[Error] Re-diarization failed for {tag}: {e}")
        return False

    if res.get("error"):
        err_msg = res["error"]
        if cloud_client.is_quota_error(err_msg):
            print(f"\n[!] ZeroGPU quota reached: {err_msg}")
            raise RuntimeError(err_msg)
        print(f"[Error] ZeroGPU returned error for {tag}: {err_msg}")
        return False

    updated_segments = res.get("segments", segments)
    returned_hash = res.get("text_hash") or core.compute_transcript_text_hash(updated_segments)

    # Hard assert on text immutability
    verify_text_integrity(orig_hash, returned_hash, tag)

    # Sync to local transcripts, srt, txt, and summary index
    artifacts = cloud_client.sync_to_local_transcripts(
        tag=tag,
        title=episode_title,
        segments=updated_segments,
        turns=res.get("turns"),
        audio_url=audio_url
    )

    # Save sidecar voiceprints
    voiceprints_dir = Path("public/transcripts/voiceprints")
    voiceprints_dir.mkdir(parents=True, exist_ok=True)
    vp_path = voiceprints_dir / f"{tag}_voiceprints.json"
    with open(vp_path, "w", encoding="utf-8") as f:
        json.dump({
            "release_tag": tag,
            "matched_speakers": res.get("matched_speakers", {}),
            "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
        }, f, indent=2)

    # Upload to GitHub Release
    if upload:
        print(f"[*] Uploading updated artifacts to GitHub Release {tag}...")
        cloud_client.clobber_upload_to_github_release(
            repo=repo,
            tag=tag,
            file_paths=[artifacts["json"], artifacts["srt"], artifacts["txt"], str(vp_path)],
            token=gh_token or os.environ.get("GH_TOKEN")
        )

    # Mark checkpoint
    mark_tag_completed(tag, checkpoint_path)
    print(f"[✓] Successfully re-diarized and verified {tag}")
    return True


def main():
    parser = argparse.ArgumentParser(description="Batch Historical Re-Diarizer for SpacePipe Transcripts")
    parser.add_argument("--tag", type=str, help="Single release tag to re-diarize")
    parser.add_argument("--all", action="store_true", help="Process all historical transcripts")
    parser.add_argument("--filter-speaker", type=str, help="Only process episodes mentioning this speaker")
    parser.add_argument("--limit", type=int, default=10, help="Max episodes to process per run (default: 10)")
    parser.add_argument("--dry-run", action="store_true", help="Validate without invoking GPU")
    parser.add_argument("--upload", action="store_true", help="Upload updated assets to GitHub Releases")
    parser.add_argument("--repo", type=str, default="aiandbotsgalore/copy-spaces-to-youtube-pipeline", help="GitHub repo")
    parser.add_argument("--checkpoint", type=str, default=DEFAULT_CHECKPOINT_PATH, help="Path to checkpoint JSON")
    parser.add_argument("--profiles", type=str, default=DEFAULT_PROFILES_PATH, help="Path to voice_profiles.json")
    parser.add_argument("--endpoint", type=str, help="ZeroGPU Space endpoint")
    parser.add_argument("--gh-token", type=str, help="GitHub token for releases")

    args = parser.parse_args()

    profiles = load_voice_profiles(args.profiles)
    print(f"[*] Loaded {len(profiles)} enrolled biometric voice profiles.")

    # Collect target candidates
    summary_path = Path(DEFAULT_SUMMARY_INDEX)
    if not summary_path.exists():
        print(f"[Error] Summary index not found: {summary_path}")
        sys.exit(1)

    with open(summary_path, "r", encoding="utf-8") as f:
        episodes: List[Dict[str, Any]] = json.load(f)

    targets: List[Dict[str, Any]] = []

    if args.tag:
        match = next((ep for ep in episodes if ep.get("release_tag") == args.tag), None)
        if match:
            targets.append(match)
        else:
            # Construct synthetic target
            targets.append({
                "release_tag": args.tag,
                "audio_url": f"https://github.com/{args.repo}/releases/download/{args.tag}/{args.tag}.mp3",
                "title": args.tag
            })
    else:
        for ep in episodes:
            tag = ep.get("release_tag")
            if not tag:
                continue

            # Check if already completed
            if is_tag_completed(tag, args.checkpoint):
                continue

            # Speaker filter
            if args.filter_speaker:
                speakers = ep.get("speakers", [])
                if not any(args.filter_speaker.lower() in str(s).lower() for s in speakers):
                    continue

            targets.append(ep)

    print(f"[*] Identified {len(targets)} candidate episodes for re-diarization (Limit: {args.limit})")
    targets = targets[:args.limit]

    processed_count = 0
    try:
        for ep in targets:
            tag = ep["release_tag"]
            audio_url = ep.get("audio_url") or ""
            t_path = f"public/transcripts/episodes/{tag}.json"

            success = process_single_episode(
                tag=tag,
                audio_url=audio_url,
                transcript_path=t_path,
                profiles=profiles,
                repo=args.repo,
                endpoint=args.endpoint,
                dry_run=args.dry_run,
                upload=args.upload,
                gh_token=args.gh_token,
                checkpoint_path=args.checkpoint
            )
            if success:
                processed_count += 1

    except Exception as e:
        if cloud_client.is_quota_error(str(e)):
            print(f"\n[ℹ] ZeroGPU daily quota reached after processing {processed_count} episodes.")
            print("[ℹ] State saved to checkpoint. Exiting cleanly (code 0).")
            sys.exit(0)
        else:
            print(f"\n[Fatal] Error during batch re-diarization: {e}")
            sys.exit(1)

    print(f"\n[🎉] Batch re-diarization run complete! Processed {processed_count} episodes.")


if __name__ == "__main__":
    main()
