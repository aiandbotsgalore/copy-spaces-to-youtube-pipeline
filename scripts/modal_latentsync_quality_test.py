import os
import sys
import time
import subprocess
import shutil
import io
from typing import Optional
import modal

app = modal.App("spacepipe-avatar-quality-test")
vol = modal.Volume.from_name("avatar-models-cache", create_if_missing=True)

# ---------------------------------------------------------------------------
# Image: LatentSync 1.6 (Lip Sync Inpainting)
# ---------------------------------------------------------------------------
latentsync_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "ffmpeg", "libgl1", "libglib2.0-0", "build-essential", "cmake", "g++")
    .pip_install(
        "torch==2.5.1",
        "torchvision==0.20.1",
        "torchaudio==2.5.1",
        index_url="https://download.pytorch.org/whl/cu121"
    )
    .pip_install("setuptools", "wheel", "cython", "decord2")
    .pip_install(
        "diffusers==0.32.2",
        "transformers==4.48.0",
        "accelerate==0.26.1",
        "einops==0.7.0",
        "omegaconf==2.3.0",
        "opencv-python-headless==4.9.0.80",
        "mediapipe==0.10.11",
        "python_speech_features==0.6",
        "librosa==0.10.1",
        "scenedetect==0.6.1",
        "ffmpeg-python==0.2.0",
        "imageio==2.31.1",
        "imageio-ffmpeg==0.5.1",
        "lpips==0.1.4",
        "face-alignment==1.4.1",
        "huggingface-hub",
        "numpy==1.26.4",
        "kornia==0.8.0",
        "insightface==0.7.3",
        "onnxruntime-gpu",
        "DeepCache==0.1.1",
        "pillow>=10.2.0",
        "scipy"
    )
    .run_commands(
        "git clone https://github.com/bytedance/LatentSync.git /opt/LatentSync"
    )
)

# ---------------------------------------------------------------------------
# Weight Cache Helper for LatentSync 1.6
# ---------------------------------------------------------------------------
def _ensure_latentsync_weights(volume: modal.Volume) -> None:
    from huggingface_hub import snapshot_download
    ckpt_cache = "/models/latentsync_weights/checkpoints"
    os.makedirs(ckpt_cache, exist_ok=True)

    unet_path = os.path.join(ckpt_cache, "latentsync_unet.pt")
    if not os.path.exists(unet_path):
        print("[LatentSync 1.6] Downloading weights from ByteDance/LatentSync-1.6...")
        snapshot_download(
            repo_id="ByteDance/LatentSync-1.6",
            local_dir=ckpt_cache,
            max_workers=8
        )
        volume.commit()
        print("[LatentSync 1.6] Main weights successfully cached.")

    # Check for auxiliary models (s3fd, 2DFAN, etc.)
    s3fd_path = os.path.join(ckpt_cache, "auxiliary", "s3fd-619a316812.pth")
    if not os.path.exists(s3fd_path):
        print("[LatentSync] Downloading auxiliary models from ByteDance/LatentSync...")
        snapshot_download(
            repo_id="ByteDance/LatentSync",
            allow_patterns=["auxiliary/*"],
            local_dir=ckpt_cache,
            max_workers=8
        )
        volume.commit()
        print("[LatentSync] Auxiliary models cached.")

    # Ensure torch hub cache has auxiliary models
    hub_cache = "/root/.cache/torch/hub/checkpoints"
    os.makedirs(hub_cache, exist_ok=True)
    aux_dir = os.path.join(ckpt_cache, "auxiliary")
    if os.path.exists(aux_dir):
        for fname in os.listdir(aux_dir):
            src_f = os.path.join(aux_dir, fname)
            dst_f = os.path.join(hub_cache, fname)
            if not os.path.exists(dst_f):
                if os.path.isfile(src_f):
                    shutil.copyfile(src_f, dst_f)
                elif os.path.isdir(src_f):
                    shutil.copytree(src_f, dst_f)

    # Symlink checkpoints into /opt/LatentSync/checkpoints
    target = "/opt/LatentSync/checkpoints"
    if os.path.exists(target):
        if os.path.islink(target):
            os.unlink(target)
        else:
            shutil.rmtree(target)
    os.symlink(ckpt_cache, target)

# ---------------------------------------------------------------------------
# LatentSync 1.6 Cloud Function
# ---------------------------------------------------------------------------
@app.function(
    image=latentsync_image,
    gpu="A100-80GB",
    volumes={"/models": vol},
    timeout=600,
)
def run_latentsync_lipsync(
    base_video_bytes: bytes,
    audio_bytes: bytes,
    duration: float = 15.0,
) -> bytes:
    print("=== LATENTSYNC 1.6 STEP STARTED ===")
    t0 = time.time()
    _ensure_latentsync_weights(vol)

    in_dir = "/tmp/ls_in"
    out_dir = "/tmp/ls_out"
    if os.path.exists(in_dir):
        shutil.rmtree(in_dir)
    if os.path.exists(out_dir):
        shutil.rmtree(out_dir)
    os.makedirs(in_dir, exist_ok=True)
    os.makedirs(out_dir, exist_ok=True)

    input_video = os.path.join(in_dir, "base_video_raw.mp4")
    with open(input_video, "wb") as f:
        f.write(base_video_bytes)

    # Ensure base video is locked at 25 fps, 512x512, exactly duration length
    norm_video = os.path.join(in_dir, "base_video_25fps.mp4")
    subprocess.run([
        "ffmpeg", "-y", "-i", input_video,
        "-t", f"{duration:.3f}",
        "-r", "25", "-s", "512x512",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        norm_video
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    raw_audio = os.path.join(in_dir, "raw_audio.wav")
    clean_audio = os.path.join(in_dir, "clean_audio.wav")
    with open(raw_audio, "wb") as f:
        f.write(audio_bytes)

    # Normalize audio to 16kHz mono WAV
    subprocess.run([
        "ffmpeg", "-y", "-i", raw_audio,
        "-t", f"{duration:.3f}",
        "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
        clean_audio
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    output_video = os.path.join(out_dir, "latentsync_output.mp4")

    # Command line for LatentSync inference
    cmd = [
        "python3", "-m", "scripts.inference",
        "--unet_config_path", "configs/unet/stage2_512.yaml",
        "--inference_ckpt_path", "checkpoints/latentsync_unet.pt",
        "--video_path", norm_video,
        "--audio_path", clean_audio,
        "--video_out_path", output_video,
        "--inference_steps", "20",
        "--guidance_scale", "1.5",
        "--temp_dir", "/tmp/ls_temp",
    ]
    env = os.environ.copy()
    env["CUDA_VISIBLE_DEVICES"] = "0"
    env["PYTHONPATH"] = "/opt/LatentSync:" + env.get("PYTHONPATH", "")

    print(f"[LatentSync] Executing: {' '.join(cmd)}")
    infer_start = time.time()
    proc = subprocess.run(cmd, cwd="/opt/LatentSync", env=env, capture_output=True, text=True)
    if proc.returncode != 0:
        err_msg = proc.stderr[-2500:]
        print("[LatentSync STDERR]:", err_msg)
        raise RuntimeError(f"LatentSync inference failed with code {proc.returncode}: {err_msg[:500]}")
    print(f"[LatentSync] Inference finished in {time.time() - infer_start:.1f}s")

    if not os.path.exists(output_video) or os.path.getsize(output_video) < 1000:
        raise FileNotFoundError(f"LatentSync output video not found or empty at {output_video}")

    # Final mux with AAC audio and faststart flags for seamless playback
    final_mp4 = os.path.join(out_dir, "final_15s_avatar.mp4")
    subprocess.run([
        "ffmpeg", "-y",
        "-i", output_video,
        "-t", f"{duration:.3f}",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        final_mp4
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    with open(final_mp4, "rb") as f:
        final_bytes = f.read()

    print(f"=== LATENTSYNC FINISHED in {time.time() - t0:.1f}s, size: {len(final_bytes)} bytes ===")
    return final_bytes

# ---------------------------------------------------------------------------
# Local Entrypoint
# ---------------------------------------------------------------------------
@app.local_entrypoint()
def main():
    print("==================================================")
    print("  15-Second Avatar Quality Test: LivePortrait + LatentSync 1.6")
    print("==================================================")

    # 1. Inputs (Curated assets supplied by user)
    portrait_path = "public/avatars/logan.jpg"
    driving_path = "public/output/comparison_source/LoganDemoVideo2.mp4"
    audio_path = "public/output/comparison_source/logan_15s_48k.wav"

    print(f"Portrait Asset: {portrait_path}")
    print(f"Driving Motion: {driving_path}")
    print(f"Audio Asset:    {audio_path}")

    for p in [portrait_path, driving_path, audio_path]:
        if not os.path.exists(p):
            raise FileNotFoundError(f"Required input asset missing: {p}")

    with open(portrait_path, "rb") as f:
        portrait_bytes = f.read()
    with open(driving_path, "rb") as f:
        driving_bytes = f.read()
    with open(audio_path, "rb") as f:
        audio_bytes = f.read()

    print(f"\n[Step 1/2] Invoking LivePortrait on deployed Modal A100-80GB...")
    t_start = time.time()
    try:
        liveportrait_fn = modal.Function.from_name("spacepipe-liveportrait", "render_avatar")
        lp_res = liveportrait_fn.remote(
            portrait_bytes=portrait_bytes,
            audio_bytes=audio_bytes,
            driving_bytes=driving_bytes,
            driving_multiplier=1.0,
            make_side_by_side=False,
        )
        base_video_bytes = lp_res["video_bytes"]
        print(f"  LivePortrait base video generated ({len(base_video_bytes):,} bytes, elapsed: {lp_res.get('elapsed_sec')}s)")
    except Exception as e:
        print(f"  Error invoking deployed LivePortrait: {e}")
        raise

    print(f"\n[Step 2/2] Invoking LatentSync 1.6 Lip-Sync on cloud Modal A100-80GB...")
    final_video_bytes = run_latentsync_lipsync.remote(
        base_video_bytes=base_video_bytes,
        audio_bytes=audio_bytes,
        duration=15.0
    )
    print(f"  LatentSync 1.6 video generated ({len(final_video_bytes):,} bytes)")

    # 3. Save to user computer
    os.makedirs("public/output", exist_ok=True)
    out_mp4_path = os.path.abspath("public/output/avatar_quality_test_15s.mp4")
    with open(out_mp4_path, "wb") as f:
        f.write(final_video_bytes)

    total_time = time.time() - t_start
    print("==================================================")
    print(f"  COMPLETE in {total_time:.1f}s!")
    print(f"  Downloaded MP4: {out_mp4_path}")
    print(f"  File size:      {os.path.getsize(out_mp4_path):,} bytes")
    print("==================================================")
