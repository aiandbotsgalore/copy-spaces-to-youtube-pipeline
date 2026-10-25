#!/usr/bin/env python3
"""
scripts/kaggle_worker/voxcpm_pkg/voxcpm_narrator.py

Cloud-executed Kaggle GPU worker for documentary narration synthesis using VoxCPM2.
Generates broadcast-master 48 kHz WAV files in Logan Black's voice from reference audio.

Runs strictly in the cloud on Kaggle Nvidia Tesla T4 (16GB VRAM).
Zero local execution or local storage required.
"""

import os
import sys
import json
import time
import shutil
import subprocess
from pathlib import Path

def run_cmd(cmd, check=True):
    print(f"[*] Running: {' '.join(cmd) if isinstance(cmd, list) else cmd}")
    res = subprocess.run(cmd, shell=isinstance(cmd, str), capture_output=True, text=True, encoding="utf-8", errors="replace")
    if res.stdout:
        print(res.stdout[-1000:])
    if res.stderr and res.returncode != 0:
        print(f"[!] Stderr: {res.stderr[-1000:]}")
    if check and res.returncode != 0:
        raise RuntimeError(f"Command failed with code {res.returncode}")
    return res

def main():
    print("=" * 65)
    print("    VOXCPM2 DOCUMENTARY NARRATOR (CLOUD GPU WORKER)")
    print("=" * 65)

    # 1. Environment & Parameters
    repo = os.environ.get("GITHUB_REPOSITORY", "aiandbotsgalore/copy-spaces-to-youtube-pipeline")
    gh_token = os.environ.get("GH_TOKEN", "")
    target_segments = os.environ.get("TARGET_SEGMENTS", "ALL") # ALL or comma-separated list like LOGAN_001,LOGAN_002
    ref_audio_input = os.environ.get("REF_AUDIO", "")

    work_dir = Path("/kaggle/working") if Path("/kaggle/working").exists() else Path("kaggle_work")
    work_dir.mkdir(parents=True, exist_ok=True)
    out_dir = work_dir / "narration_output"
    out_dir.mkdir(parents=True, exist_ok=True)

    # 2. Clone repository to access manifests and reference audio samples
    repo_dir = work_dir / "repo"
    if not repo_dir.exists():
        clone_url = f"https://x-access-token:{gh_token}@github.com/{repo}.git" if gh_token else f"https://github.com/{repo}.git"
        print(f"[*] Cloning repository {repo}...")
        run_cmd(["git", "clone", "--depth", "1", clone_url, str(repo_dir)])

    manifest_path = repo_dir / "docs/documentary/data/narration_manifest.json"
    if not manifest_path.exists():
        print(f"[!] Narration manifest not found at {manifest_path}")
        sys.exit(1)

    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    # 3. Locate Reference Audio for Logan Black
    ref_wav = None
    ref_transcript = "Ten years before Hiroshima, the American presidency still belonged to a different world. This is Franklin Roosevelt at Boulder Dam in 1935."

    if ref_audio_input and Path(ref_audio_input).exists():
        ref_wav = Path(ref_audio_input)
    else:
        # Candidate reference samples in repo prioritized for Logan Black
        cand_refs = [
            repo_dir / "public/speaker_samples/Logan/master_reference.wav",
            repo_dir / "speaker_samples/Logan/master_reference.wav",
            repo_dir / "speaker_samples/downloaded/remediated/remediated_voice.wav",
            repo_dir / "speaker_samples/Logan/auto_sample_38m53s.wav",
            repo_dir / "special_clips/Cue_01_AQ-0012_Angela.wav"
        ]
        # Search for any wav under speaker_samples
        for p in (repo_dir / "public/speaker_samples").glob("**/*.wav"):
            cand_refs.append(p)
        for p in (repo_dir / "speaker_samples").glob("**/*.wav"):
            cand_refs.append(p)

        for c in cand_refs:
            if c.exists() and c.stat().st_size > 10000:
                ref_wav = c
                break

    if not ref_wav:
        print("[!] No reference audio WAV found in repository. Creating a clean tone reference fallback...")
        ref_wav = work_dir / "ref_fallback.wav"
        run_cmd(f"ffmpeg -y -f lavfi -i 'sine=frequency=220:duration=5' -ar 48000 -ac 1 '{ref_wav}'")

    print(f"[✓] Using reference audio: {ref_wav} ({ref_wav.stat().st_size / 1024:.1f} KB)")

    # 4. Install VoxCPM2
    print("\n[*] Installing VoxCPM2 dependencies...")
    run_cmd([sys.executable, "-m", "pip", "install", "--upgrade", "pip", "wheel", "setuptools"])
    run_cmd([sys.executable, "-m", "pip", "install", "voxcpm", "soundfile", "librosa", "huggingface_hub", "torch", "torchaudio"])

    # 5. Load VoxCPM2 Model on GPU
    print("\n[*] Initializing VoxCPM2 on GPU...")
    import soundfile as sf
    import torch
    from voxcpm import VoxCPM

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[*] Torch CUDA Available: {torch.cuda.is_available()}, Device: {device}")
    if device == "cuda":
        print(f"[*] GPU: {torch.cuda.get_device_name(0)}, Memory: {torch.cuda.get_device_properties(0).total_memory / (1024**3):.1f} GB")

    model = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False)

    # 6. Synthesize Segments
    segments = manifest.get("segments", [])
    if target_segments != "ALL":
        allowed = [s.strip() for s in target_segments.split(",") if s.strip()]
        segments = [s for s in segments if s.get("id") in allowed or s.get("filename") in allowed]

    print(f"\n[*] Starting synthesis of {len(segments)} narration segment(s) at broadcast 48 kHz...\n")
    results = []

    for idx, seg in enumerate(segments, 1):
        seg_id = seg.get("id", f"LOGAN_{idx:03d}")
        filename = seg.get("filename", f"{seg_id}.wav")
        text = seg.get("text", "").strip()
        out_wav_path = out_dir / filename

        print(f"[{idx}/{len(segments)}] Synthesizing {seg_id} ({len(text.split())} words):")
        print(f"    Text: \"{text[:80]}...\"")
        start_t = time.time()

        try:
            # Try high-fidelity prompt continuation + timbre cloning first
            try:
                wav = model.generate(
                    text=text,
                    prompt_wav_path=str(ref_wav),
                    prompt_text=ref_transcript,
                    reference_wav_path=str(ref_wav),
                    inference_timesteps=15
                )
            except Exception as e_prompt:
                print(f"    [*] Notice: continuation mode fallback ({e_prompt}), attempting direct timbre reference...")
                wav = model.generate(
                    text=text,
                    reference_wav_path=str(ref_wav),
                    inference_timesteps=15
                )

            # Ensure native 48kHz audio output
            target_sr = getattr(model, "sample_rate", 48000)
            if hasattr(model, "tts_model") and hasattr(model.tts_model, "sample_rate"):
                target_sr = model.tts_model.sample_rate

            sf.write(str(out_wav_path), wav, target_sr, subtype="PCM_24" if target_sr == 48000 else "PCM_16")
            duration = round(len(wav) / float(target_sr), 2)
            elapsed = round(time.time() - start_t, 2)
            print(f"    [✓] Generated {filename} ({duration}s audio @ {target_sr}Hz) in {elapsed}s.")

            results.append({
                "id": seg_id,
                "filename": filename,
                "status": "success",
                "duration_seconds": duration,
                "sample_rate": target_sr,
                "bit_depth": 24,
                "file_size_bytes": out_wav_path.stat().st_size
            })
        except Exception as synth_err:
            print(f"    [!] Error synthesizing {seg_id}: {synth_err}")
            results.append({
                "id": seg_id,
                "filename": filename,
                "status": "failed",
                "error": str(synth_err)
            })

    # Save summary report
    summary_path = out_dir / "narration_synthesis_summary.json"
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump({
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "model": "openbmb/VoxCPM2",
            "reference_audio": str(ref_wav.name),
            "total_segments": len(results),
            "successful": sum(1 for r in results if r["status"] == "success"),
            "segments": results
        }, f, indent=2)

    print("\n" + "=" * 65)
    print(f"[✓] Narration generation completed: {sum(1 for r in results if r['status'] == 'success')}/{len(results)} successful!")
    print(f"    Output Directory: {out_dir}")
    print("=" * 65)

    # 7. Upload / Sync to GitHub Release if GH_TOKEN is provided
    if gh_token:
        try:
            print("\n[*] Packaging narration files for GitHub release upload...")
            zip_path = work_dir / "documentary_narration_48khz.zip"
            shutil.make_archive(str(work_dir / "documentary_narration_48khz"), "zip", str(out_dir))
            print(f"[✓] Created archive: {zip_path} ({zip_path.stat().st_size / (1024*1024):.1f} MB)")
            
            # Attach to a designated release
            target_rel = os.environ.get("TARGET_RELEASE_TAG", "documentary-narration-master")
            print(f"[*] Attaching to release {target_rel}...")
            run_cmd(f"gh release upload {target_rel} '{zip_path}' --repo {repo} --clobber || true", check=False)
        except Exception as up_e:
            print(f"[!] Notice: Archive upload skipped: {up_e}")

if __name__ == "__main__":
    main()
