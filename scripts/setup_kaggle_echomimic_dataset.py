#!/usr/bin/env python3
"""Build and upload the pre-baked Kaggle dataset for EchoMimic model weights and wheel dependencies.

This implements Optimization #1 and #2:
1. Model weights mounted at /kaggle/input/echomimic-pretrained-weights (0s download overhead).
2. Wheels cached for offline pip install (facenet-pytorch, omegaconf).
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


def run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
    print(f"[*] Running: {' '.join(cmd)}")
    return subprocess.run(cmd, check=check, text=True)


def setup_dataset(staging_dir: Path, dataset_id: str = "loganblackjbjb/echomimic-pretrained-weights", upload: bool = False):
    staging_dir = staging_dir.resolve()
    staging_dir.mkdir(parents=True, exist_ok=True)
    print(f"[*] Staging EchoMimic pre-baked dataset in: {staging_dir}")

    # 1. Download Model Weights via huggingface_hub snapshot
    print("[*] Downloading EchoMimic accelerated model weights from Hugging Face (BadToBest/EchoMimic)...")
    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        run([sys.executable, "-m", "pip", "install", "huggingface_hub"])
        from huggingface_hub import snapshot_download

    snapshot_download(
        repo_id="BadToBest/EchoMimic",
        local_dir=str(staging_dir),
        allow_patterns=[
            "denoising_unet_acc.pth",
            "motion_module_acc.pth",
            "reference_unet.pth",
            "face_locator.pth",
            "audio_processor/whisper_tiny.pt",
            "sd-image-variations-diffusers/*",
            "sd-vae-ft-mse/*",
        ],
        ignore_patterns=["*.safetensors", "*.bin", "denoising_unet.pth", "motion_module.pth"],
        local_dir_use_symlinks=False,
    )

    # 2. Pre-package Python Wheels Cache for Offline Install
    wheels_dir = staging_dir / "wheels"
    wheels_dir.mkdir(parents=True, exist_ok=True)
    print("[*] Pre-downloading binary wheels for facenet-pytorch and omegaconf into wheels/...")
    run([
        sys.executable, "-m", "pip", "download",
        "--only-binary=:all:",
        "--dest", str(wheels_dir),
        "facenet-pytorch", "omegaconf",
    ], check=False)

    # 3. Create dataset-metadata.json
    metadata = {
        "title": "EchoMimic Pretrained Weights & Wheels",
        "id": dataset_id,
        "licenses": [{"name": "apache-2.0"}],
    }
    meta_path = staging_dir / "dataset-metadata.json"
    meta_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(f"[✓] Created dataset metadata at {meta_path}")

    # 4. Upload to Kaggle if requested
    if upload:
        print(f"[*] Pushing dataset {dataset_id} to Kaggle...")
        # Check if dataset already exists
        check = subprocess.run(["kaggle", "datasets", "status", dataset_id], capture_output=True, text=True)
        if "ready" in check.stdout.lower() or check.returncode == 0:
            print("[*] Dataset already exists on Kaggle. Creating a new version...")
            run(["kaggle", "datasets", "version", "-p", str(staging_dir), "-m", "Update model weights and wheels", "-r", "zip"])
        else:
            print("[*] Creating new dataset on Kaggle...")
            run(["kaggle", "datasets", "create", "-p", str(staging_dir), "-r", "zip"])
        print(f"[✓] Dataset {dataset_id} uploaded successfully!")
    else:
        print("[*] Staging complete. To upload to Kaggle, run:")
        print(f"    kaggle datasets create -p {staging_dir} -r zip")


def main():
    parser = argparse.ArgumentParser(description="EchoMimic Kaggle Dataset Setup")
    parser.add_argument("--staging-dir", type=Path, default=Path("echomimic_dataset_staging"), help="Local staging directory")
    parser.add_argument("--dataset-id", type=str, default="loganblackjbjb/echomimic-pretrained-weights", help="Kaggle dataset slug")
    parser.add_argument("--upload", action="store_true", help="Automatically push to Kaggle via Kaggle CLI")
    args = parser.parse_args()

    setup_dataset(args.staging_dir, args.dataset_id, upload=args.upload)


if __name__ == "__main__":
    main()
