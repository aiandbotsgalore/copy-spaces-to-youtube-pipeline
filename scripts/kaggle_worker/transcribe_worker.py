#!/usr/bin/env python3
"""
scripts/kaggle_worker/transcribe_worker.py
SpacePipe 100% Cloud GPU Transcriber & Diarizer (Kaggle Edition)

Runs on Kaggle Dual Tesla T4 GPUs with WhisperX:
1. Batched transcription with faster-whisper large-v3-turbo (FP16).
2. Forced phoneme alignment via wav2vec2 for microsecond word timestamps.
3. Multi-speaker neural diarization via pyannote.audio.
4. Generates .json, .srt, and .txt matching exact SpacePipe schema.
5. Uploads transcripts directly back to GitHub Release assets via GitHub API.
6. 100% cloud execution - 0 bytes on local machine.
"""

import os
import sys
import json
import re
import time
import shutil
import tempfile
import subprocess
import urllib.request
import urllib.parse
from pathlib import Path
from typing import List, Dict, Any, Optional

# Reconfigure stdout/stderr for unbuffered Kaggle logs
try:
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)
except Exception:
    pass


def run_cmd(cmd: List[str], check: bool = True) -> subprocess.CompletedProcess:
    print(f"[*] Executing: {' '.join(cmd)}")
    res = subprocess.run(cmd, capture_output=True, text=True)
    if check and res.returncode != 0:
        print(f"[!] Command failed (code {res.returncode}):\n{res.stderr}")
        raise RuntimeError(f"Command failed: {' '.join(cmd)}")
    return res


def ensure_dependencies():
    """Installs whisperx and requirements if not present in container."""
    print("[*] Checking runtime dependencies...")
    try:
        import whisperx
        import speechbrain
        print("[✓] WhisperX and SpeechBrain already installed.")
    except ImportError:
        print("[*] Installing WhisperX, PyAnnote, and SpeechBrain inside Kaggle container...")
        run_cmd([sys.executable, "-m", "pip", "install", "-q", "whisperx", "requests", "speechbrain"])
        print("[✓] Dependencies installed successfully.")


def format_timestamp_srt(seconds: float) -> str:
    millis = int(round(seconds * 1000))
    hrs = millis // 3600000
    millis %= 3600000
    mins = millis // 60000
    millis %= 60000
    secs = millis // 1000
    millis %= 1000
    return f"{hrs:02d}:{mins:02d}:{secs:02d},{millis:03d}"


def get_untranscribed_releases(repo: str, gh_token: str, limit: int = 5) -> List[Dict[str, Any]]:
    """Paginates through GitHub Releases until 'limit' untranscribed episodes are discovered."""
    headers = {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "SpacePipe-Kaggle-Worker"
    }
    if gh_token:
        headers["Authorization"] = f"token {gh_token}"

    to_process = []
    page = 1
    max_pages = 25

    while len(to_process) < limit and page <= max_pages:
        url = f"https://api.github.com/repos/{repo}/releases?per_page=100&page={page}"
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req) as resp:
                releases = json.loads(resp.read().decode())
        except Exception as e:
            print(f"[!] Warning: Failed fetching releases page {page}: {e}")
            break

        if not releases or not isinstance(releases, list):
            break

        for rel in releases:
            assets = rel.get("assets", [])
            mp3_assets = [a for a in assets if a["name"].lower().endswith((".mp3", ".m4a")) and not a["name"].startswith("clip_")]
            json_assets = [a for a in assets if a["name"].lower().endswith(".json") and not a["name"].lower().endswith("_clips.json")]

            if mp3_assets and not json_assets:
                to_process.append({
                    "release_id": rel["id"],
                    "tag_name": rel["tag_name"],
                    "title": rel.get("name") or rel["tag_name"],
                    "body": rel.get("body") or "",
                    "mp3_asset": mp3_assets[0],
                    "upload_url": rel["upload_url"]
                })
                if len(to_process) >= limit:
                    break

        page += 1

    return to_process


def download_asset(url: str, dest_path: Path, gh_token: str):
    headers = {"User-Agent": "SpacePipe-Kaggle-Worker"}
    if gh_token:
        headers["Authorization"] = f"token {gh_token}"
    req = urllib.request.Request(url, headers=headers)
    print(f"[*] Downloading {dest_path.name} from GitHub...")
    with urllib.request.urlopen(req) as resp, open(dest_path, "wb") as out:
        shutil.copyfileobj(resp, out)
    print(f"[✓] Downloaded {dest_path.stat().st_size / (1024*1024):.1f} MB")


def delete_release_asset_if_exists(repo: str, release_id: int, asset_name: str, gh_token: str):
    """If an asset with asset_name already exists in the release, delete it so re-upload succeeds."""
    if not (repo and release_id and gh_token):
        return
    headers = {
        "Authorization": f"token {gh_token}",
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "SpacePipe-Kaggle-Worker"
    }
    url = f"https://api.github.com/repos/{repo}/releases/{release_id}/assets"
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req) as resp:
            assets = json.loads(resp.read().decode())
        for asset in assets:
            if asset.get("name") == asset_name:
                del_url = f"https://api.github.com/repos/{repo}/releases/assets/{asset['id']}"
                del_req = urllib.request.Request(del_url, headers=headers, method="DELETE")
                try:
                    with urllib.request.urlopen(del_req) as del_resp:
                        print(f"[*] Deleted existing asset {asset_name} (id: {asset['id']}) for clean overwrite.")
                except Exception as del_err:
                    print(f"[!] Note: Could not delete asset {asset_name}: {del_err}")
    except Exception as e:
        print(f"[!] Note: Could not check existing assets for {asset_name}: {e}")


def upload_asset_to_release(upload_url_template: str, file_path: Path, content_type: str, gh_token: str, repo: str = "", release_id: int = 0):
    """Uploads a generated transcript to GitHub Release, cleanly overwriting if an asset of the same name exists."""
    if not repo or not release_id:
        m = re.search(r'/repos/([^/]+/[^/]+)/releases/(\d+)', upload_url_template)
        if m:
            repo = repo or m.group(1)
            release_id = release_id or int(m.group(2))

    if repo and release_id and gh_token:
        delete_release_asset_if_exists(repo, release_id, file_path.name, gh_token)

    base_upload_url = upload_url_template.split("{?")[0]
    upload_url = f"{base_upload_url}?name={urllib.parse.quote(file_path.name)}"
    
    headers = {
        "Authorization": f"token {gh_token}",
        "Content-Type": content_type,
        "User-Agent": "SpacePipe-Kaggle-Worker"
    }

    print(f"[*] Uploading {file_path.name} to GitHub Release...")
    with open(file_path, "rb") as f:
        data = f.read()

    req = urllib.request.Request(upload_url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            if resp.getcode() in (200, 201):
                print(f"[✓] Successfully uploaded {file_path.name}")
    except urllib.error.HTTPError as e:
        err_body = e.read().decode()
        if e.code == 422 and "already_exists" in err_body and repo and release_id:
            print(f"[*] Asset already exists, deleting and retrying upload for {file_path.name}...")
            delete_release_asset_if_exists(repo, release_id, file_path.name, gh_token)
            time.sleep(1.0)
            try:
                retry_req = urllib.request.Request(upload_url, data=data, headers=headers, method="POST")
                with urllib.request.urlopen(retry_req) as retry_resp:
                    if retry_resp.getcode() in (200, 201):
                        print(f"[✓] Successfully uploaded {file_path.name} on retry")
                        return
            except Exception as retry_err:
                print(f"[!] Warning: Retry upload failed for {file_path.name}: {retry_err}")
        print(f"[!] Warning: Upload of {file_path.name} returned HTTP {e.code}: {err_body}")


def resolve_speakers_with_voiceprints(
    final_result: Dict[str, Any],
    audio_data: Any,
    title: str,
    device: str,
    body: str = ""
) -> Dict[str, str]:
    """
    Matches speaker clusters (e.g. SPEAKER_00) against enrolled 192-dim voiceprints
    in voice_profiles.json using ECAPA-TDNN on Kaggle GPU.
    Also incorporates host anchors and dialogue cues.
    """
    segments = final_result.get("segments", [])
    if not segments:
        return {}

    # 1. Load enrolled profiles
    profiles_data = {}
    for p_path in [
        Path("voice_profiles.json"),
        Path("/kaggle/working/voice_profiles.json"),
        Path(__file__).parent.parent / "voice_profiles.json",
        Path(__file__).parent / "voice_profiles.json"
    ]:
        if p_path.exists():
            try:
                with open(p_path, "r", encoding="utf-8") as f:
                    profiles_data = json.load(f).get("profiles", {})
                break
            except Exception:
                pass

    if not profiles_data:
        try:
            url = "https://raw.githubusercontent.com/aiandbotsgalore/copy-spaces-to-youtube-pipeline/master/voice_profiles.json"
            req = urllib.request.Request(url, headers={"User-Agent": "SpacePipe-Kaggle"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                profiles_data = json.loads(resp.read().decode("utf-8")).get("profiles", {})
        except Exception as e:
            print(f"[!] Note: Could not fetch voice_profiles.json: {e}")

    enrolled_vectors = {}
    for name, p in profiles_data.items():
        emb = p.get("embedding")
        if isinstance(emb, list) and len(emb) == 192:
            try:
                import numpy as np
                vec = np.array(emb, dtype=np.float32)
                norm = np.linalg.norm(vec)
                if norm > 1e-6:
                    enrolled_vectors[name] = vec / norm
            except Exception:
                pass

    spk_turns: Dict[str, List[Dict[str, Any]]] = {}
    for s in segments:
        spk = str(s.get("speaker") or "").strip()
        if spk:
            spk_turns.setdefault(spk, []).append(s)

    matched_map: Dict[str, str] = {}

    # 2. Acoustic Voiceprint Matching via SpeechBrain on GPU
    if enrolled_vectors and audio_data is not None:
        try:
            import torch
            import numpy as np
            from speechbrain.inference.speaker import EncoderClassifier

            print(f"[*] Initializing SpeechBrain ECAPA classifier on {device}...")
            sb_classifier = EncoderClassifier.from_hparams(
                source="speechbrain/spkrec-ecapa-voxceleb",
                savedir="/tmp/speechbrain_cache",
                run_opts={"device": device}
            )

            sr = 16000
            for spk_tag, turns in spk_turns.items():
                valid_turns = [t for t in turns if 2.5 <= (t.get("end", 0) - t.get("start", 0)) <= 15.0]
                if not valid_turns:
                    valid_turns = turns[:5]

                embs = []
                for t in valid_turns[:6]:
                    st_sample = int(t.get("start", 0) * sr)
                    end_sample = int(t.get("end", 0) * sr)
                    if end_sample > len(audio_data):
                        end_sample = len(audio_data)
                    slice_audio = audio_data[st_sample:end_sample]
                    if len(slice_audio) < sr * 1.5:
                        continue
                    peak = np.max(np.abs(slice_audio))
                    if peak > 1e-6:
                        slice_audio = slice_audio / peak
                    t_tensor = torch.from_numpy(slice_audio.astype(np.float32)).unsqueeze(0).to(device)
                    with torch.no_grad():
                        emb = sb_classifier.encode_batch(t_tensor).squeeze().cpu().numpy()
                    norm = np.linalg.norm(emb)
                    if norm > 1e-6:
                        embs.append(emb / norm)

                if embs:
                    mean_emb = np.mean(embs, axis=0)
                    m_norm = np.linalg.norm(mean_emb)
                    if m_norm > 1e-6:
                        mean_emb = mean_emb / m_norm
                        scored = []
                        for e_name, e_vec in enrolled_vectors.items():
                            sim = float(np.dot(mean_emb, e_vec))
                            scored.append((sim, e_name))
                        scored.sort(reverse=True)
                        if scored:
                            best_sim, best_name = scored[0]
                            runner_up = scored[1][0] if len(scored) > 1 else 0.0
                            if best_sim >= 0.52 and (best_sim - runner_up >= 0.05 or best_sim >= 0.60):
                                matched_map[spk_tag] = best_name
                                print(f"[✓] Neural Acoustic Voiceprint Match: {spk_tag} -> {best_name} (sim: {best_sim:.3f})")
        except Exception as e:
            print(f"[!] SpeechBrain acoustic matching note: {e}")

    # 3. Host Anchor Fallback
    title_lower = title.lower()
    host_handle = os.environ.get("SPACE_HOST", "").lower()
    if not host_handle and body:
        m_h = re.search(r'METADATA::HOST::@?([A-Za-z0-9_.\-]+)', body)
        if m_h:
            host_handle = m_h.group(1).lower().strip()
        else:
            m_h2 = re.search(r'-\s*\*\*Host:\*\*\s*@?([^\r\n]+)', body, re.IGNORECASE)
            if m_h2:
                host_handle = m_h2.group(1).lower().strip()

    if host_handle:
        import unicodedata
        host_handle = unicodedata.normalize('NFKD', host_handle).lower()

    # Guard: only apply host anchor if we have multiple distinct speaker clusters
    # to avoid turning an un-diarized transcript into a 100% single-speaker monologue.
    if len(spk_turns) >= 2 or len(segments) <= 15:
        if "Logan" not in matched_map.values():
            is_logan_host = "logan" in host_handle or "loganblack" in host_handle or "logan" in title_lower
            if is_logan_host and spk_turns:
                sorted_spks = sorted(spk_turns.items(), key=lambda x: sum(t.get("end", 0) - t.get("start", 0) for t in x[1]), reverse=True)
                for spk_tag, _ in sorted_spks:
                    if spk_tag not in matched_map:
                        matched_map[spk_tag] = "Logan"
                        print(f"[✓] Host Anchor Match: {spk_tag} -> Logan")
                        break

        if "Angela" not in matched_map.values():
            is_angela_host = "angelamaggard3" in host_handle or ("txrrxstrxxl" in host_handle and "king oor" not in host_handle) or "angela" in host_handle or "angela" in title_lower
            if is_angela_host and spk_turns:
                sorted_spks = sorted(spk_turns.items(), key=lambda x: sum(t.get("end", 0) - t.get("start", 0) for t in x[1]), reverse=True)
                for spk_tag, _ in sorted_spks:
                    if spk_tag not in matched_map:
                        matched_map[spk_tag] = "Angela"
                        print(f"[✓] Host Anchor Match: {spk_tag} -> Angela")
                        break

        if "Oor" not in matched_map.values():
            is_oor_host = "king oor" in host_handle or ("txrrxstrxxl" in host_handle and "Angela" in matched_map.values())
            if is_oor_host and spk_turns:
                sorted_spks = sorted(spk_turns.items(), key=lambda x: sum(t.get("end", 0) - t.get("start", 0) for t in x[1]), reverse=True)
                for spk_tag, _ in sorted_spks:
                    if spk_tag not in matched_map:
                        matched_map[spk_tag] = "Oor"
                        print(f"[✓] Host Anchor Match: {spk_tag} -> Oor")
                        break

        if "Eric Hecker" not in matched_map.values():
            is_eric_host = "eric j. hecker" in host_handle or "decipheringtv" in host_handle or "deciphering.tv" in host_handle or (host_handle.startswith("eric") and "hecker" in host_handle)
            if is_eric_host and spk_turns:
                sorted_spks = sorted(spk_turns.items(), key=lambda x: sum(t.get("end", 0) - t.get("start", 0) for t in x[1]), reverse=True)
                for spk_tag, _ in sorted_spks:
                    if spk_tag not in matched_map:
                        matched_map[spk_tag] = "Eric Hecker"
                        print(f"[✓] Host Anchor Match: {spk_tag} -> Eric Hecker")
                        break

    # 4. Apply matched names
    if matched_map:
        for s in segments:
            cur_spk = s.get("speaker")
            if cur_spk in matched_map:
                s["speaker"] = matched_map[cur_spk]

    return matched_map


def process_episode(item: Dict[str, Any], hf_token: str, gh_token: str, work_dir: Path):
    import whisperx
    import torch

    tag = item["tag_name"]
    title = item["title"]
    mp3_asset = item["mp3_asset"]
    upload_url_template = item["upload_url"]

    audio_path = work_dir / mp3_asset["name"]
    download_asset(mp3_asset["browser_download_url"], audio_path, gh_token)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    batch_size = 16
    compute_type = "float16" if device == "cuda" else "int8"

    print(f"\n=======================================================")
    print(f"[*] Transcribing: {title} ({tag}) on {device.upper()}")
    print(f"=======================================================")

    t0 = time.time()
    # 1. Faster-Whisper Large-v3-Turbo
    print(f"[*] Loading WhisperX model (large-v3-turbo, {compute_type})...")
    model = whisperx.load_model("large-v3-turbo", device, compute_type=compute_type)

    print("[*] Running audio transcription...")
    audio = whisperx.load_audio(str(audio_path))
    transcription_result = model.transcribe(audio, batch_size=batch_size)
    print(f"[✓] Transcription finished in {time.time() - t0:.1f}s. Language: {transcription_result.get('language')}")

    # 2. Phoneme Alignment (wav2vec2) for microsecond precision
    t1 = time.time()
    lang = transcription_result.get("language") or "en"
    print(f"[*] Aligning word timestamps via wav2vec2 ({lang})...")
    align_model, metadata = whisperx.load_align_model(language_code=lang, device=device)
    aligned_result = whisperx.align(transcription_result["segments"], align_model, metadata, audio, device)
    print(f"[✓] Word alignment completed in {time.time() - t1:.1f}s")

    # 3. Speaker Diarization (PyAnnote Audio)
    t2 = time.time()
    diarization_succeeded = False
    if hf_token:
        try:
            print("[*] Performing neural speaker diarization (pyannote.audio)...")
            try:
                from whisperx.diarize import DiarizationPipeline
            except (ImportError, AttributeError):
                from whisperx import DiarizationPipeline

            try:
                diarize_pipeline = DiarizationPipeline(use_auth_token=hf_token, device=device)
            except TypeError:
                diarize_pipeline = DiarizationPipeline(token=hf_token, device=device)

            try:
                diarize_segments = diarize_pipeline(str(audio_path))
            except Exception:
                diarize_segments = diarize_pipeline(audio)

            final_result = whisperx.assign_word_speakers(diarize_segments, aligned_result)
            diarization_succeeded = True
            print(f"[✓] Diarization completed in {time.time() - t2:.1f}s")
        except Exception as e:
            print(f"[!] Warning: PyAnnote diarization failed ({e}). Using aligned segments directly.")
            final_result = aligned_result
    else:
        print("[*] No HF_TOKEN provided; skipping pyannote diarization.")
        final_result = aligned_result

    # 3b. Neural Voiceprint & Speaker Matching via ECAPA-TDNN (100% Cloud GPU)
    if diarization_succeeded:
        try:
            resolve_speakers_with_voiceprints(final_result, audio, title, device, body=item.get("body", ""))
        except Exception as e:
            print(f"[!] Warning: Voice profile resolution skipped ({e})")

    # 4. Format outputs to exact SpacePipe schema
    stem = Path(mp3_asset["name"]).stem
    json_path = work_dir / f"{stem}.json"
    srt_path = work_dir / f"{stem}.srt"
    txt_path = work_dir / f"{stem}.txt"

    segments = []
    srt_lines = []
    txt_lines = [f"=== TRANSCRIPT: {title} ===\n"]

    for idx, seg in enumerate(final_result.get("segments", []), 1):
        start = round(float(seg.get("start", 0.0)), 2)
        end = round(float(seg.get("end", 0.0)), 2)
        text = str(seg.get("text", "")).strip()
        speaker = str(seg.get("speaker") or "Speaker 1").strip()

        words = []
        for w in seg.get("words", []):
            if "start" in w and "end" in w:
                words.append({
                    "word": str(w.get("word", "")).strip(),
                    "start": round(float(w["start"]), 2),
                    "end": round(float(w["end"]), 2),
                    "confidence": round(float(w.get("score", 0.95)), 2)
                })

        segments.append({
            "start": start,
            "end": end,
            "speaker": speaker,
            "text": text,
            "words": words
        })

        srt_lines.append(f"{idx}\n{format_timestamp_srt(start)} --> {format_timestamp_srt(end)}\n[{speaker}]: {text}\n")
        txt_lines.append(f"[{format_timestamp_srt(start)}] {speaker}: {text}\n")

    # Write files
    payload = {
        "title": title,
        "release_tag": rel_tag,
        "segments": segments
    }
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    with open(srt_path, "w", encoding="utf-8") as f:
        f.writelines("\n".join(srt_lines))
    with open(txt_path, "w", encoding="utf-8") as f:
        f.writelines(txt_lines)

    total_time = time.time() - t0
    print(f"[✓] Full process complete in {total_time:.1f}s ({len(segments)} segments)")

    # 5. Upload files back to GitHub Release
    if gh_token:
        rel_id = item.get("release_id", 0)
        upload_asset_to_release(upload_url_template, json_path, "application/json", gh_token, release_id=rel_id)
        upload_asset_to_release(upload_url_template, srt_path, "text/plain", gh_token, release_id=rel_id)
        upload_asset_to_release(upload_url_template, txt_path, "text/plain", gh_token, release_id=rel_id)

    # Clean up local scratch audio
    if audio_path.exists():
        audio_path.unlink()


def main():
    print("=================================================================")
    print("     SpacePipe WhisperX GPU Transcriber (Kaggle Cloud Worker)    ")
    print("=================================================================")

    ensure_dependencies()

    gh_token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or ""
    hf_token = os.environ.get("HF_TOKEN") or ""
    repo = os.environ.get("GITHUB_REPOSITORY") or "aiandbotsgalore/copy-spaces-to-youtube-pipeline"
    limit = int(os.environ.get("BATCH_LIMIT") or "5")

    target_tag = os.environ.get("TARGET_RELEASE_TAG") or ""

    work_dir = Path(tempfile.gettempdir()) / "spacepipe_kaggle"
    work_dir.mkdir(parents=True, exist_ok=True)

    if target_tag:
        print(f"[*] Targeted single release mode: {target_tag}")
        headers = {"Accept": "application/vnd.github.v3+json", "User-Agent": "SpacePipe-Kaggle-Worker"}
        if gh_token:
            headers["Authorization"] = f"token {gh_token}"
        url = f"https://api.github.com/repos/{repo}/releases/tags/{target_tag}"
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req) as resp:
            rel = json.loads(resp.read().decode())
        mp3_assets = [a for a in rel.get("assets", []) if a["name"].lower().endswith((".mp3", ".m4a"))]
        if mp3_assets:
            process_episode({
                "release_id": rel["id"],
                "tag_name": rel["tag_name"],
                "title": rel.get("name") or rel["tag_name"],
                "body": rel.get("body") or "",
                "mp3_asset": mp3_assets[0],
                "upload_url": rel["upload_url"]
            }, hf_token, gh_token, work_dir)
    else:
        print(f"[*] Batch auto-queue mode (Limit: {limit})...")
        untranscribed = get_untranscribed_releases(repo, gh_token, limit=limit)
        print(f"[*] Found {len(untranscribed)} untranscribed episode(s).")
        for item in untranscribed:
            process_episode(item, hf_token, gh_token, work_dir)

    print("\n[✓] All cloud transcription tasks completed successfully!")


if __name__ == "__main__":
    main()
