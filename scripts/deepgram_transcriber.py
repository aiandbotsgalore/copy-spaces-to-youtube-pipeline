#!/usr/bin/env python3
"""
scripts/deepgram_transcriber.py - Deepgram Nova-2 Cloud Audio Transcriber & Highlight Extractor

Transcribes Twitter Spaces 100% in the cloud via Deepgram Nova-2 with:
- Neural speech-to-text with precise millisecond word-level timestamps
- Automatic multi-speaker diarization
- Automated 2GB Workaround:
  * Auto-compression via FFmpeg (48kbps mono) for high-bitrate/uncompressed audio near 2GB
  * Lossless 2-hour chunking & timestamp offset stitching for extreme marathon spaces (>3.5 hours or >1.8 GB)
- Gemini 2.5 Flash contextual speaker discovery (identifying Logan, guests, etc.)
- AI Highlight Clip extraction & cutting (via scripts/find_and_cut_best_clips.py)
- Direct upload of .txt, .srt, .json, and clips to GitHub Release assets
- Zero local PC disk/bandwidth usage (runs in GitHub Actions cloud runners)
"""

import os
import sys
import re
import json
import time
import math
import shutil
import argparse
import tempfile
import subprocess
import urllib.parse
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple

import requests

FFMPEG_EXE = shutil.which("ffmpeg") or "ffmpeg"
FFPROBE_EXE = shutil.which("ffprobe") or "ffprobe"


def format_timestamp(seconds: float, srt: bool = False) -> str:
    """Formats seconds into HH:MM:SS or HH:MM:SS,mmm."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds - int(seconds)) * 1000)
    if srt:
        return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def get_audio_duration(file_path: Path) -> float:
    """Returns audio duration in seconds using ffprobe or ffmpeg."""
    try:
        cmd = [
            FFPROBE_EXE, "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(file_path)
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, errors="replace")
        if res.returncode == 0 and res.stdout.strip():
            return float(res.stdout.strip())
    except Exception:
        pass

    # Fallback to parsing ffmpeg stderr
    try:
        cmd = [FFMPEG_EXE, "-i", str(file_path)]
        res = subprocess.run(cmd, capture_output=True, text=True, errors="replace")
        match = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.?\d*)", res.stderr)
        if match:
            h, m, s = match.groups()
            return int(h) * 3600 + int(m) * 60 + float(s)
    except Exception:
        pass

    return 0.0


def resolve_speakers_with_gemini(segments: List[Dict[str, Any]], gemini_api_key: str) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    """Uses Gemini 2.5 Flash to resolve generic 'Speaker 0', 'Speaker 1' to real conversational names."""
    if not gemini_api_key or not segments:
        return segments, {}

    try:
        total_segs = len(segments)
        sample_candidates = segments if total_segs <= 300 else (
            segments[:100] + segments[max(100, (total_segs // 2) - 50):max(100, (total_segs // 2) + 50)] + segments[-100:]
        )
        sample_lines = [f"[{s['start']:.1f}s] {s['speaker']}: {s['text']}" for s in sample_candidates]
        transcript_sample = "\n".join(sample_lines)

        prompt = f"""You are an expert audio diarization analyst. Analyze this Twitter Space transcript sample and identify the real names of the generic speakers (e.g. Speaker 0, Speaker 1, etc.) based on:
1. Direct self-introductions (e.g. "I am [Name]", "This is [Name]")
2. How others address them in conversation (e.g. "Hey Logan", "Morning Parr", "Thanks Chan")
3. Self-descriptions and conversational roles.

Return a JSON object with this exact schema:
{{
  "speaker_mappings": [
    {{"speaker_id": "Speaker 0", "identified_name": "Logan", "confidence": 0.95}},
    ...
  ]
}}

Transcript sample:
{transcript_sample}
"""

        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={gemini_api_key}"
        headers = {"Content-Type": "application/json"}
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"responseMimeType": "application/json"}
        }

        resp = requests.post(url, headers=headers, json=payload, timeout=45)
        if resp.status_code != 200:
            return segments, {}

        data = resp.json()
        raw_text = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
        if not raw_text:
            return segments, {}

        parsed = json.loads(raw_text)
        mappings = {}
        generic_tokens = {"participant", "unknown", "listener", "guest", "someone", "unidentified", "audience", "none"}

        for m in parsed.get("speaker_mappings", []):
            spk_id = m.get("speaker_id", "")
            name = m.get("identified_name", "").strip()
            conf = float(m.get("confidence", 0.0))
            if spk_id and name and conf >= 0.70:
                if not any(token in name.lower() for token in generic_tokens) and not name.lower().startswith("speaker"):
                    mappings[spk_id] = name

        if mappings:
            print(f"[*] AI Speaker Resolution Identified:")
            for k, v in mappings.items():
                print(f"    • {k} -> {v}")
            for s in segments:
                if s["speaker"] in mappings:
                    s["speaker"] = mappings[s["speaker"]]

        return segments, mappings

    except Exception as e:
        print(f"[!] Notice: Speaker name resolution skipped: {e}")
        return segments, {}


def transcribe_audio_chunk_deepgram(
    audio_path: Path,
    deepgram_key: str,
    time_offset: float = 0.0
) -> List[Dict[str, Any]]:
    """Transcribes a single audio file/chunk with Deepgram Nova-2 with speaker diarization."""
    print(f"[*] Submitting {audio_path.name} ({audio_path.stat().st_size / (1024*1024):.1f} MB, offset: {time_offset:.1f}s) to Deepgram Nova-2...")

    endpoint = (
        "https://api.deepgram.com/v1/listen?"
        "model=nova-2&"
        "smart_format=true&"
        "diarize=true&"
        "punctuate=true&"
        "utterances=true"
    )

    headers = {
        "Authorization": f"Token {deepgram_key}",
        "Content-Type": "audio/mpeg"
    }

    start_t = time.time()
    with open(audio_path, "rb") as f:
        resp = requests.post(endpoint, headers=headers, data=f, timeout=900)

    elapsed = time.time() - start_t

    if resp.status_code != 200:
        err_detail = resp.text[:300]
        if resp.status_code == 401 or resp.status_code == 403:
            raise RuntimeError(f"Deepgram Authentication Failed: Invalid or missing API key. ({err_detail})")
        if "INSUFFICIENT_FUNDS" in resp.text or "spend limit" in resp.text.lower() or "credits" in resp.text.lower():
            raise RuntimeError(f"Deepgram Insufficient Credits: {err_detail}")
        raise RuntimeError(f"Deepgram API error {resp.status_code}: {err_detail}")

    result = resp.json()
    print(f"[✓] Deepgram transcription completed in {elapsed:.1f}s!")

    # Extract utterances
    utterances = result.get("results", {}).get("utterances", [])
    segments: List[Dict[str, Any]] = []

    if utterances:
        for u in utterances:
            text = u.get("transcript", "").strip()
            if not text:
                continue
            spk_num = u.get("speaker", 0)
            segments.append({
                "start": round(u.get("start", 0.0) + time_offset, 2),
                "end": round(u.get("end", 0.0) + time_offset, 2),
                "speaker": f"Speaker {spk_num}",
                "text": text
            })
    else:
        # Fallback to alternatives paragraphs / words if utterances not returned
        alts = result.get("results", {}).get("channels", [{}])[0].get("alternatives", [{}])[0]
        words = alts.get("words", [])
        curr_speaker = None
        curr_start = 0.0
        curr_end = 0.0
        curr_words = []

        for w in words:
            spk = f"Speaker {w.get('speaker', 0)}"
            word_text = w.get("punctuated_word") or w.get("word", "")
            w_start = w.get("start", 0.0) + time_offset
            w_end = w.get("end", 0.0) + time_offset

            if curr_speaker is None:
                curr_speaker = spk
                curr_start = w_start
                curr_end = w_end
                curr_words = [word_text]
            elif curr_speaker == spk and (w_start - curr_end) < 2.0:
                curr_words.append(word_text)
                curr_end = w_end
            else:
                if curr_words:
                    segments.append({
                        "start": round(curr_start, 2),
                        "end": round(curr_end, 2),
                        "speaker": curr_speaker,
                        "text": " ".join(curr_words).strip()
                    })
                curr_speaker = spk
                curr_start = w_start
                curr_end = w_end
                curr_words = [word_text]

        if curr_words:
            segments.append({
                "start": round(curr_start, 2),
                "end": round(curr_end, 2),
                "speaker": curr_speaker,
                "text": " ".join(curr_words).strip()
            })

    return segments


def process_audio_file(
    input_audio: Path,
    deepgram_key: str,
    gemini_key: str,
    title: str,
    output_dir: Path
) -> Tuple[Path, Path, Path, float]:
    """Processes an audio file through the 2GB Workaround Pipeline and Deepgram Nova-2."""
    file_size = input_audio.stat().st_size
    duration_sec = get_audio_duration(input_audio)
    print(f"\n[*] Audio File Inspection: {input_audio.name}")
    print(f"    • Size: {file_size / (1024*1024):.1f} MB")
    print(f"    • Duration: {format_timestamp(duration_sec)} ({duration_sec:.1f}s)")

    active_audio = input_audio

    # -------------------------------------------------------------------------
    # 2GB Workaround - Tier 1: Cloud Re-Encoding (Auto-Compression)
    # If audio is > 1.5 GB or uncompressed WAV, re-encode to 48kbps mono MP3.
    # -------------------------------------------------------------------------
    if file_size > 1.5 * (1024 ** 3) or input_audio.suffix.lower() == ".wav":
        print(f"\n[⚡ 2GB Workaround Tier 1] Large file detected ({file_size / (1024*1024):.1f} MB).")
        print(f"[*] Re-encoding to high-efficiency 48kbps mono speech stream via FFmpeg...")
        compressed_audio = input_audio.parent / f"{input_audio.stem}_compressed.mp3"
        compress_cmd = [
            FFMPEG_EXE, "-y",
            "-i", str(input_audio),
            "-ac", "1",
            "-ar", "16000",
            "-b:a", "48k",
            str(compressed_audio)
        ]
        try:
            res_comp = subprocess.run(compress_cmd, capture_output=True, text=True, errors="replace")
            if res_comp.returncode == 0 and compressed_audio.exists():
                new_size = compressed_audio.stat().st_size
                pct = (1.0 - (new_size / file_size)) * 100
                print(f"[✓] Compression Complete: {new_size / (1024*1024):.1f} MB ({pct:.1f}% size reduction!)")
                active_audio = compressed_audio
                file_size = new_size
            else:
                print(f"[!] Notice: FFmpeg compression skipped; proceeding with original audio.")
        except Exception as ffmpeg_err:
            print(f"[!] Notice: FFmpeg execution unavailable ({ffmpeg_err}); proceeding with original audio.")

    # -------------------------------------------------------------------------
    # 2GB Workaround - Tier 2: Lossless Cloud Audio Chunking & Stitching
    # If duration > 3.5 hours (12,600s) or file is still > 1.8 GB:
    # Slice into 2-hour segments, transcribe with Deepgram, and stitch timestamps.
    # -------------------------------------------------------------------------
    all_segments: List[Dict[str, Any]] = []

    if duration_sec > 12600.0 or file_size > 1.8 * (1024 ** 3):
        chunk_seconds = 7200  # 2-hour slices
        print(f"\n[⚡ 2GB Workaround Tier 2] Marathon Space detected ({format_timestamp(duration_sec)}).")
        print(f"[*] Slicing audio into 2-hour lossless segments via FFmpeg...")

        chunks_dir = input_audio.parent / "audio_chunks"
        chunks_dir.mkdir(parents=True, exist_ok=True)
        chunk_pattern = str(chunks_dir / "chunk_%03d.mp3")

        split_cmd = [
            FFMPEG_EXE, "-y",
            "-i", str(active_audio),
            "-f", "segment",
            "-segment_time", str(chunk_seconds),
            "-c", "copy",
            chunk_pattern
        ]
        try:
            res_split = subprocess.run(split_cmd, capture_output=True, text=True, errors="replace")
            chunk_files = sorted(list(chunks_dir.glob("chunk_*.mp3")))

            if res_split.returncode == 0 and chunk_files:
                print(f"[✓] Successfully sliced audio into {len(chunk_files)} segment(s).")
                current_offset = 0.0

                for idx, c_file in enumerate(chunk_files, 1):
                    c_dur = get_audio_duration(c_file)
                    print(f"\n--- Processing Chunk [{idx}/{len(chunk_files)}]: {c_file.name} ({format_timestamp(c_dur)}) ---")
                    chunk_segs = transcribe_audio_chunk_deepgram(
                        audio_path=c_file,
                        deepgram_key=deepgram_key,
                        time_offset=current_offset
                    )
                    all_segments.extend(chunk_segs)
                    current_offset += c_dur if c_dur > 0 else chunk_seconds

                shutil.rmtree(chunks_dir, ignore_errors=True)
            else:
                print(f"[!] Slicing skipped; submitting as direct audio stream.")
                all_segments = transcribe_audio_chunk_deepgram(
                    audio_path=active_audio,
                    deepgram_key=deepgram_key,
                    time_offset=0.0
                )
        except Exception as split_err:
            print(f"[!] Slicing unavailable ({split_err}); submitting as direct audio stream.")
            all_segments = transcribe_audio_chunk_deepgram(
                audio_path=active_audio,
                deepgram_key=deepgram_key,
                time_offset=0.0
            )
    else:
        # Standard Single-Pass Deepgram transcription
        all_segments = transcribe_audio_chunk_deepgram(
            audio_path=active_audio,
            deepgram_key=deepgram_key,
            time_offset=0.0
        )

    # Clean temporary compressed audio if generated
    if active_audio != input_audio and active_audio.exists():
        try:
            active_audio.unlink(missing_ok=True)
        except Exception:
            pass

    # Merge consecutive segments by the same speaker with short pauses
    merged: List[Dict[str, Any]] = []
    for s in all_segments:
        if not s["text"].strip():
            continue
        if merged and merged[-1]["speaker"] == s["speaker"] and (s["start"] - merged[-1]["end"]) < 2.5:
            merged[-1]["end"] = s["end"]
            merged[-1]["text"] += " " + s["text"].strip()
        else:
            merged.append(s)

    all_segments = merged

    # AI Contextual Speaker Resolution
    all_segments, _ = resolve_speakers_with_gemini(all_segments, gemini_key)

    # Compute speaker talk time stats
    speaker_talk_time: Dict[str, float] = {}
    for s in all_segments:
        spk = s["speaker"]
        speaker_talk_time[spk] = round(speaker_talk_time.get(spk, 0.0) + (s["end"] - s["start"]), 1)

    print(f"\n[Speaker Breakdown]")
    for spk, secs in sorted(speaker_talk_time.items(), key=lambda x: x[1], reverse=True):
        print(f"  • {spk}: {format_timestamp(secs)} ({secs/60:.1f} min)")

    # Output filenames
    safe_title = re.sub(r'[\\/*?:"<>|]', "", title).replace(" ", "_").strip(". ")
    if not safe_title:
        safe_title = "transcript"

    output_dir.mkdir(parents=True, exist_ok=True)
    txt_path = output_dir / f"{safe_title}.txt"
    srt_path = output_dir / f"{safe_title}.srt"
    json_path = output_dir / f"{safe_title}.json"

    # 1. Text transcript
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(f"=== TRANSCRIPT: {title} ===\n")
        f.write(f"Duration: {format_timestamp(duration_sec)}\n")
        f.write(f"Generated: {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}\n")
        f.write(f"Engine: Deepgram Nova-2 (Cloud Diarization)\n\n")
        for s in all_segments:
            f.write(f"[{format_timestamp(s['start'])} - {format_timestamp(s['end'])}] {s['speaker']}: {s['text']}\n\n")

    # 2. SRT transcript
    with open(srt_path, "w", encoding="utf-8") as f:
        if all_segments:
            for i, s in enumerate(all_segments, 1):
                f.write(f"{i}\n{format_timestamp(s['start'], srt=True)} --> {format_timestamp(s['end'], srt=True)}\n{s['speaker']}: {s['text']}\n\n")
        else:
            f.write("1\n00:00:00,000 --> 00:00:01,000\n[Silence]\n\n")

    # 3. JSON transcript (matches exact app schema)
    payload = {
        "title": title,
        "source": input_audio.name,
        "duration_seconds": duration_sec,
        "duration_formatted": format_timestamp(duration_sec),
        "model": "deepgram-nova-2",
        "speakers_detected": list(speaker_talk_time.keys()),
        "speaker_talk_time": speaker_talk_time,
        "segments": all_segments
    }
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    return txt_path, srt_path, json_path, duration_sec


def main():
    parser = argparse.ArgumentParser(description="Deepgram Nova-2 Cloud Audio Transcriber & Highlight Extractor")
    parser.add_argument("--release-tag", type=str, required=True, help="GitHub release tag (e.g. 20260918_1MJgNbdaAPlGL)")
    parser.add_argument("--part", type=int, default=0, help="Specific audio part (0 for all)")
    parser.add_argument("--force", action="store_true", help="Force re-transcribe even if transcript exists")
    parser.add_argument("--repo", type=str, default="aiandbotsgalore/copy-spaces-to-youtube-pipeline", help="GitHub repo")
    args = parser.parse_args()

    deepgram_key = os.environ.get("DEEPGRAM_API_KEY", "").strip()
    if not deepgram_key:
        print("[🛑] CRITICAL ERROR: DEEPGRAM_API_KEY environment variable is not set!")
        print("     Please add DEEPGRAM_API_KEY to your GitHub Secrets or environment.")
        sys.exit(1)

    gh_token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN", "")
    gemini_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY", "")

    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "SpacePipe-DeepgramTranscriber"
    }
    if gh_token:
        headers["Authorization"] = f"token {gh_token}"

    # Fetch release info
    rel_url = f"https://api.github.com/repos/{args.repo}/releases/tags/{args.release_tag}"
    print(f"[*] Fetching Release details for {args.release_tag}...")
    resp = requests.get(rel_url, headers=headers)
    if resp.status_code != 200:
        print(f"[!] Failed to fetch release {args.release_tag}: status {resp.status_code}")
        sys.exit(1)

    release_data = resp.json()
    assets = release_data.get("assets", [])
    upload_url_template = release_data.get("upload_url", "").split("{")[0]

    mp3_assets = [a for a in assets if a["name"].endswith(".mp3") and not a["name"].startswith("clip_")]
    if not mp3_assets:
        print(f"[!] No eligible MP3 assets found in release {args.release_tag}.")
        sys.exit(0)

    if args.part > 0 and args.part <= len(mp3_assets):
        mp3_assets = [mp3_assets[args.part - 1]]

    work_dir = Path(tempfile.gettempdir()) / "spacepipe_deepgram_work"
    work_dir.mkdir(parents=True, exist_ok=True)
    output_dir = work_dir / "output_transcripts"
    output_dir.mkdir(parents=True, exist_ok=True)

    processed_count = 0

    for idx, mp3_asset in enumerate(mp3_assets, 1):
        mp3_name = mp3_asset["name"]
        stem = Path(mp3_name).stem
        mp3_url = mp3_asset["browser_download_url"]

        existing_json_asset = next((a for a in assets if a["name"] == f"{stem}.json"), None)
        existing_clips_asset = next((a for a in assets if a["name"] == f"{stem}_clips.json"), None)

        if existing_json_asset and existing_clips_asset and not args.force:
            print(f"[✓] {mp3_name} already has transcript and clips. Skipping.")
            continue

        local_mp3 = work_dir / mp3_name
        print(f"\n========================================================")
        print(f"[*] [{idx}/{len(mp3_assets)}] Processing: {mp3_name}")
        print(f"[*] Downloading audio stream to cloud runner scratch disk...")
        dl_resp = requests.get(mp3_url, headers=headers, stream=True)
        dl_resp.raise_for_status()
        with open(local_mp3, "wb") as f:
            for chunk in dl_resp.iter_content(chunk_size=1048576):
                f.write(chunk)
        print(f"[✓] Download Complete: {local_mp3.stat().st_size / (1024*1024):.1f} MB")

        json_path = output_dir / f"{stem}.json"
        txt_path = output_dir / f"{stem}.txt"
        srt_path = output_dir / f"{stem}.srt"

        if existing_json_asset and not args.force:
            print(f"[*] Transcript already exists ({existing_json_asset['name']}). Downloading for highlight clips...")
            j_resp = requests.get(existing_json_asset["browser_download_url"], headers=headers)
            with open(json_path, "wb") as f:
                f.write(j_resp.content)
        else:
            txt_path, srt_path, json_path, _ = process_audio_file(
                input_audio=local_mp3,
                deepgram_key=deepgram_key,
                gemini_key=gemini_key,
                title=stem,
                output_dir=output_dir
            )

        # Highlight clip extraction via Gemini Flash
        clips_dir = work_dir / "best_saved_clips"
        shutil.rmtree(clips_dir, ignore_errors=True)
        clips_dir.mkdir(parents=True, exist_ok=True)

        if json_path.exists():
            print(f"\n[*] Extracting AI Highlight Clips via Gemini Flash...")
            clipper_script = Path("scripts/find_and_cut_best_clips.py")
            if clipper_script.exists():
                cmd_clips = [
                    sys.executable, str(clipper_script),
                    "--json", str(json_path),
                    "--audio", str(local_mp3),
                    "--limit", "5"
                ]
                try:
                    subprocess.run(cmd_clips, timeout=300)
                except Exception as e:
                    print(f"[!] Notice: Clip extraction skipped: {e}")

        # Gather files to upload
        to_upload = [p for p in [txt_path, srt_path, json_path] if p.exists() and p.stat().st_size > 0]
        if clips_dir.exists():
            for c_file in clips_dir.glob("**/*.*"):
                if c_file.is_file() and c_file.suffix.lower() in [".mp3", ".json", ".md"] and c_file.stat().st_size > 0:
                    if c_file not in to_upload:
                        to_upload.append(c_file)

        # Upload back to GitHub Release
        cur_assets_resp = requests.get(rel_url, headers=headers)
        latest_assets = cur_assets_resp.json().get("assets", []) if cur_assets_resp.status_code == 200 else assets
        existing_asset_map = {a["name"]: a["id"] for a in latest_assets}

        print(f"\n[*] Uploading {len(to_upload)} asset(s) to GitHub Release {args.release_tag}...")
        for f_path in to_upload:
            f_name = f_path.name
            if f_name in existing_asset_map:
                del_id = existing_asset_map[f_name]
                del_url = f"https://api.github.com/repos/{args.repo}/releases/assets/{del_id}"
                requests.delete(del_url, headers=headers)

            safe_name = urllib.parse.quote(f_name)
            u_headers = {
                "Content-Type": "application/octet-stream",
                "User-Agent": "SpacePipe-DeepgramTranscriber"
            }
            if gh_token:
                u_headers["Authorization"] = f"token {gh_token}"

            with open(f_path, "rb") as f_data:
                up_resp = requests.post(f"{upload_url_template}?name={safe_name}", headers=u_headers, data=f_data)
                if up_resp.status_code in [200, 201]:
                    print(f"  [✓] Uploaded: {f_name}")
                else:
                    print(f"  [!] Failed uploading {f_name}: {up_resp.status_code}")

        # Clean scratch audio & clip files
        try:
            local_mp3.unlink(missing_ok=True)
            shutil.rmtree(clips_dir, ignore_errors=True)
        except Exception:
            pass

        processed_count += 1

    print(f"\n[🎉] Deepgram Transcription Completed for {args.release_tag} ({processed_count} asset(s) processed)!")


if __name__ == "__main__":
    main()
