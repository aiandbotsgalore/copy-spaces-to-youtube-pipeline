#!/usr/bin/env python3
"""
scripts/enroll_speaker.py

Universal automated voice enrollment script for SpacePipe Studio.
Given a speaker name and an audio file:
1. Loads audio (16kHz mono).
2. Extracts 192-dimensional ECAPA-TDNN embedding via SpeechBrain.
3. Updates voice_profiles.json and public/voice_profiles.json with the embedding and sample metadata.
4. Auto-syncs the audio sample to Cloudflare R2 CDN.
5. Returns JSON result with ok, embedding, and URLs.

Usage:
    python scripts/enroll_speaker.py --speaker "Mary" --file "path/to/sample.mp3" [--role "Co-Host"]
"""

import os
import sys
import json
import argparse
import datetime
import urllib.request
from pathlib import Path

try:
    import librosa
    import torch
    import soundfile as sf
    from speechbrain.inference.speaker import EncoderClassifier
except ImportError as e:
    print(json.dumps({"ok": False, "error": f"Missing dependency: {e}"}))
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
                        k = k.strip()
                        v = v.strip().strip("'").strip('"')
                        if k not in os.environ:
                            os.environ[k] = v


load_env()


def enroll(speaker_name: str, file_path: str, role: str = None, start_sec: float = None, end_sec: float = None) -> dict:
    clean_speaker = "".join(c for c in speaker_name if c.isalnum() or c in "._ -").strip() or "Speaker"
    target_dir = Path("speaker_samples") / clean_speaker
    target_dir.mkdir(parents=True, exist_ok=True)
    public_target_dir = Path("public/speaker_samples") / clean_speaker
    public_target_dir.mkdir(parents=True, exist_ok=True)

    # Handle HTTP/HTTPS URLs
    temp_download = None
    if file_path.startswith(("http://", "https://")):
        ext = ".mp3"
        if ".wav" in file_path.lower():
            ext = ".wav"
        temp_download = target_dir / f"download_{int(datetime.datetime.now().timestamp())}{ext}"
        try:
            req = urllib.request.Request(file_path, headers={"User-Agent": "SpacePipe-Studio/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp, open(temp_download, "wb") as out_f:
                out_f.write(resp.read())
            p = temp_download
        except Exception as e:
            return {"ok": False, "error": f"Failed to download audio from {file_path}: {e}"}
    else:
        # Strip leading slash if present
        clean_path = file_path.lstrip("/\\")
        p = Path(clean_path)
        if not p.exists():
            p = Path(file_path)
        if not p.exists():
            return {"ok": False, "error": f"File not found: {file_path}"}

    try:
        sig, sr = librosa.load(str(p), sr=16000, mono=True)
    except Exception as e:
        return {"ok": False, "error": f"Failed to load audio: {e}"}

    # Slice if start_sec / end_sec specified
    sliced = False
    if start_sec is not None or end_sec is not None:
        s_idx = max(0, int((start_sec or 0.0) * sr))
        e_idx = min(len(sig), int(end_sec * sr)) if end_sec is not None else len(sig)
        if e_idx > s_idx:
            sig = sig[s_idx:e_idx]
            sliced = True

    duration_sec = len(sig) / 16000.0
    if duration_sec < 0.5:
        return {"ok": False, "error": f"Audio clip too short ({duration_sec:.2f}s). Need at least 0.5s."}

    classifier = EncoderClassifier.from_hparams(
        source="speechbrain/spkrec-ecapa-voxceleb",
        savedir="tmp_model"
    )

    wav = torch.tensor(sig).float().unsqueeze(0)
    emb = classifier.encode_batch(wav).squeeze().detach().cpu().numpy().tolist()
    if len(emb) != 192:
        return {"ok": False, "error": f"Expected 192 dimensions, got {len(emb)}"}

    now_iso = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    sample_id = f"sample_{int(datetime.datetime.now().timestamp())}"

    # Determine final stored filename
    if sliced or temp_download:
        dest_filename = f"{sample_id}.wav"
        dest_file = target_dir / dest_filename
        public_dest_file = public_target_dir / dest_filename
        sf.write(str(dest_file), sig, 16000)
        sf.write(str(public_dest_file), sig, 16000)
        if temp_download and temp_download.exists() and temp_download != dest_file:
            try:
                temp_download.unlink()
            except Exception:
                pass
    else:
        dest_file = target_dir / p.name
        public_dest_file = public_target_dir / p.name
        if str(p.resolve()) != str(dest_file.resolve()):
            import shutil
            shutil.copy2(str(p), str(dest_file))
            shutil.copy2(str(p), str(public_dest_file))

    rel_key = f"speaker_samples/{clean_speaker}/{dest_file.name}".replace("\\", "/")
    cdn_base = os.environ.get("R2_PUBLIC_BASE_URL", "https://pub-b492226ab4ed45d692e9f14794366106.r2.dev").rstrip("/")
    cdn_url = f"{cdn_base}/{rel_key}"

    # Sync to Cloudflare R2
    try:
        uploader = Path("scripts/upload_slice_to_r2.py")
        if uploader.exists():
            import subprocess
            subprocess.run(
                [sys.executable, str(uploader), "--file", str(dest_file), "--key", rel_key],
                check=False,
                capture_output=True
            )
    except Exception as e:
        print(f"[!] Warning syncing to R2: {e}", file=sys.stderr)

    # Update catalogs
    for ppath in ["voice_profiles.json", "public/voice_profiles.json"]:
        if not os.path.exists(ppath):
            continue
        try:
            with open(ppath, "r", encoding="utf-8") as f:
                catalog = json.load(f)

            profiles = catalog.setdefault("profiles", {})
            prof = profiles.setdefault(speaker_name, {})
            prof["name"] = speaker_name
            if role:
                prof["role"] = role
            elif not prof.get("role"):
                prof["role"] = "Speaker"

            prof["sample_audio_url"] = rel_key
            prof["sample_audio_url_cdn"] = cdn_url
            prof["embedding"] = emb
            prof["embedding_model"] = "speechbrain/spkrec-ecapa-voxceleb"
            prof["embedding_dim"] = 192
            prof["identity_verified"] = True
            prof["enrolled_sample_id"] = sample_id
            prof["last_updated"] = now_iso

            samples = prof.get("samples") or []
            existing = next((s for s in samples if s.get("audio_url") == rel_key), None)
            if not existing:
                samples.append({
                    "id": sample_id,
                    "source": "upload",
                    "audio_url": rel_key,
                    "audio_url_cdn": cdn_url,
                    "label": dest_file.name
                })
            prof["samples"] = samples
            prof["sample_count"] = len(samples)

            catalog["updated_at"] = now_iso

            with open(ppath, "w", encoding="utf-8") as f:
                json.dump(catalog, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"[!] Error updating {ppath}: {e}", file=sys.stderr)

    return {
        "ok": True,
        "speaker": speaker_name,
        "sample_audio_url": rel_key,
        "sample_audio_url_cdn": cdn_url,
        "embedding_dim": 192,
        "duration_sec": round(duration_sec, 2),
        "last_updated": now_iso
    }


def main():
    parser = argparse.ArgumentParser(description="Automated voice profile enrollment")
    parser.add_argument("--speaker", required=True, help="Speaker name (e.g. Mary)")
    parser.add_argument("--file", required=True, help="Audio file path or URL")
    parser.add_argument("--role", default=None, help="Speaker role (e.g. Co-Host)")
    parser.add_argument("--start_sec", type=float, default=None, help="Start time in seconds")
    parser.add_argument("--end_sec", type=float, default=None, help="End time in seconds")
    args = parser.parse_args()

    result = enroll(args.speaker, args.file, args.role, args.start_sec, args.end_sec)
    print(json.dumps(result, indent=2))
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
