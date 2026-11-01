import os
import sys
import time
import subprocess
import shutil
import base64
import io
from typing import Optional
import modal

app = modal.App("spacepipe-liveportrait")
vol = modal.Volume.from_name("avatar-models-cache", create_if_missing=True)

liveportrait_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "ffmpeg", "libgl1", "libglib2.0-0", "build-essential")
    .pip_install(
        "torch==2.3.1",
        "torchvision==0.18.1",
        "torchaudio==2.3.1",
        index_url="https://download.pytorch.org/whl/cu121"
    )
    .pip_install(
        "numpy==1.26.4",
        "pyyaml==6.0.1",
        "opencv-python-headless==4.10.0.84",
        "scipy==1.13.1",
        "imageio==2.34.2",
        "lmdb==1.4.1",
        "tqdm==4.66.4",
        "rich==13.7.1",
        "ffmpeg-python==0.2.0",
        "onnx==1.16.1",
        "scikit-image==0.24.0",
        "albumentations==1.4.10",
        "matplotlib==3.9.0",
        "imageio-ffmpeg==0.5.1",
        "tyro==0.8.5",
        "gradio==5.1.0",
        "pykalman==0.9.7",
        "pillow>=10.2.0",
        "onnxruntime-gpu",
        "huggingface_hub",
        "requests",
        "fastapi[standard]"
    )
    .run_commands(
        "git clone https://github.com/KlingAIResearch/LivePortrait.git /opt/LivePortrait"
    )
)

def _ensure_weights(volume: modal.Volume) -> None:
    from huggingface_hub import snapshot_download
    pw_cache = "/models/liveportrait_weights"
    if not os.path.exists(os.path.join(pw_cache, "liveportrait", "base_models", "spade_generator.pth")):
        print("[LivePortrait Service] Weights missing from volume. Downloading from KlingTeam/LivePortrait...")
        snapshot_download(
            repo_id="KlingTeam/LivePortrait",
            local_dir=pw_cache,
            max_workers=8
        )
        volume.commit()
        print("[LivePortrait Service] Weights successfully cached in volume.")

    target_pw = "/opt/LivePortrait/pretrained_weights"
    if os.path.exists(target_pw):
        if os.path.islink(target_pw):
            os.unlink(target_pw)
        else:
            shutil.rmtree(target_pw)
    os.symlink(pw_cache, target_pw)

def _sanitize_portrait(raw_bytes: bytes, out_path: str) -> None:
    """Corrects EXIF rotation, ensures standard RGB, limits excessive resolution to avoid OOM."""
    from PIL import Image, ImageOps
    try:
        img = Image.open(io.BytesIO(raw_bytes))
        img = ImageOps.exif_transpose(img)
        img = img.convert("RGB")
        max_dim = 2048
        if max(img.size) > max_dim:
            img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
        img.save(out_path, "JPEG", quality=95)
    except Exception as e:
        raise ValueError(f"Invalid portrait image format: {e}")

def _probe_duration(file_path: str) -> float:
    """Robustly extracts audio duration via ffprobe with ffmpeg duration fallback."""
    try:
        probe = subprocess.run([
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", file_path
        ], capture_output=True, text=True, check=True)
        dur = float(probe.stdout.strip())
        if dur > 0:
            return dur
    except Exception:
        pass

    # Fallback to stream duration
    try:
        probe2 = subprocess.run([
            "ffprobe", "-v", "error", "-select_streams", "a:0",
            "-show_entries", "stream=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", file_path
        ], capture_output=True, text=True, check=True)
        dur2 = float(probe2.stdout.strip())
        if dur2 > 0:
            return dur2
    except Exception:
        pass

    raise ValueError("Unable to determine audio duration from provided media.")

def _sanitize_audio(raw_bytes: bytes, raw_in_path: str, clean_out_path: str) -> float:
    """Normalizes any audio container (WAV, MP3, AAC, FLAC, M4A, OGG) to standard 16kHz mono PCM."""
    with open(raw_in_path, "wb") as f:
        f.write(raw_bytes)

    res = subprocess.run([
        "ffmpeg", "-y", "-i", raw_in_path,
        "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
        clean_out_path
    ], capture_output=True, text=True)

    if res.returncode != 0:
        raise ValueError(f"FFmpeg failed to decode audio track: {res.stderr[-300:]}")

    duration = _probe_duration(clean_out_path)
    if duration < 0.3:
        raise ValueError(f"Audio duration is too short ({duration:.2f}s). Minimum 0.3s required.")
    if duration > 1800:
        raise ValueError(f"Audio duration is too long ({duration:.1f}s). Maximum 30 minutes supported.")
    return duration

@app.function(
    image=liveportrait_image,
    gpu="A100-80GB",
    volumes={"/models": vol},
    timeout=600,
    scaledown_window=300,  # Keep container warm for 5 minutes for sub-15s response times
)
def render_avatar(
    portrait_bytes: bytes,
    audio_bytes: bytes,
    driving_bytes: Optional[bytes] = None,
    driving_multiplier: float = 1.15,
    make_side_by_side: bool = False,
) -> dict:
    """
    Renders high-fidelity talking avatar video using LivePortrait on Modal GPU.
    Preserves 100% photographic facial hair, skin texture, and lighting.
    """
    t0 = time.time()
    print("=== LIVEPORTRAIT GPU WORKER INVOCATION STARTED ===")
    
    _ensure_weights(vol)

    in_dir = "/tmp/liveportrait_in"
    out_dir = "/tmp/liveportrait_out"
    if os.path.exists(in_dir):
        shutil.rmtree(in_dir)
    if os.path.exists(out_dir):
        shutil.rmtree(out_dir)
    os.makedirs(in_dir, exist_ok=True)
    os.makedirs(out_dir, exist_ok=True)

    source_img = os.path.join(in_dir, "portrait.jpg")
    raw_audio = os.path.join(in_dir, "raw_audio_input")
    clean_audio = os.path.join(in_dir, "clean_audio.wav")

    # 1. Image preprocessing (EXIF, RGB, bounds check)
    _sanitize_portrait(portrait_bytes, source_img)

    # 2. Audio normalization (16kHz mono WAV + duration probe)
    audio_dur = _sanitize_audio(audio_bytes, raw_audio, clean_audio)
    print(f"[LivePortrait] Normalized audio duration: {audio_dur:.2f}s")

    # 3. Driving video selection & framerate lock
    raw_driving = os.path.join(in_dir, "raw_driving.mp4")
    if driving_bytes and len(driving_bytes) > 1024:
        with open(raw_driving, "wb") as f:
            f.write(driving_bytes)
    else:
        volume_template = "/models/motion_templates/talking_host.mp4"
        if os.path.exists(volume_template):
            shutil.copyfile(volume_template, raw_driving)
        else:
            internal_sample = "/opt/LivePortrait/assets/examples/driving/d13.mp4"
            if os.path.exists(internal_sample):
                shutil.copyfile(internal_sample, raw_driving)
            else:
                shutil.copyfile("/opt/LivePortrait/assets/examples/driving/d0.mp4", raw_driving)

    # 4. Loop driving video to exact audio length at locked 30.0 fps
    driving_looped = os.path.join(in_dir, "driving_looped.mp4")
    subprocess.run([
        "ffmpeg", "-y", "-stream_loop", "-1",
        "-i", raw_driving,
        "-t", f"{audio_dur:.3f}",
        "-r", "30",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        driving_looped
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # 5. Run LivePortrait inference with error isolation
    cmd = [
        "python3", "inference.py",
        "-s", source_img,
        "-d", driving_looped,
        "-o", out_dir,
        "--driving_multiplier", str(driving_multiplier)
    ]
    env = os.environ.copy()
    env["CUDA_VISIBLE_DEVICES"] = "0"
    env["PYTHONPATH"] = "/opt/LivePortrait:" + env.get("PYTHONPATH", "")

    print(f"[LivePortrait] Executing: {' '.join(cmd)}")
    infer_start = time.time()
    proc = subprocess.run(cmd, cwd="/opt/LivePortrait", env=env, capture_output=True, text=True)
    if proc.returncode != 0:
        err_msg = proc.stderr[-2000:]
        print("[LivePortrait STDERR]:", err_msg)
        if "No face detected" in err_msg or "Cannot detect" in err_msg:
            raise ValueError("No human face detected in the portrait. Please upload a clear, front-facing portrait photo.")
        if "out of memory" in err_msg.lower():
            raise RuntimeError("GPU memory exhausted during LivePortrait deformation.")
        raise RuntimeError(f"LivePortrait inference failed with code {proc.returncode}: {err_msg[:300]}")
    print(f"[LivePortrait] Inference completed in {time.time() - infer_start:.2f}s")

    # 6. Locate outputs sorted by newest mtime
    out_files = [os.path.join(out_dir, f) for f in os.listdir(out_dir)]
    standalone_candidates = [
        f for f in out_files
        if f.endswith(".mp4") and not f.endswith("_concat.mp4") and not f.endswith("final_talking_avatar.mp4")
    ]
    concat_candidates = [f for f in out_files if f.endswith("_concat.mp4")]

    if not standalone_candidates:
        raise FileNotFoundError(f"No standalone animated video generated in {out_dir}")

    standalone_candidates.sort(key=lambda x: os.path.getmtime(x), reverse=True)
    standalone_raw = standalone_candidates[0]
    final_mp4 = os.path.join(out_dir, "final_talking_avatar.mp4")

    # 7. Mux clean audio with web-optimized +faststart flags
    subprocess.run([
        "ffmpeg", "-y",
        "-i", standalone_raw,
        "-i", clean_audio,
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "192k",
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-movflags", "+faststart",
        "-shortest",
        final_mp4
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    side_by_side_mp4 = None
    if make_side_by_side and concat_candidates:
        concat_candidates.sort(key=lambda x: os.path.getmtime(x), reverse=True)
        concat_raw = concat_candidates[0]
        side_by_side_mp4 = os.path.join(out_dir, "final_side_by_side.mp4")
        subprocess.run([
            "ffmpeg", "-y",
            "-i", concat_raw,
            "-i", clean_audio,
            "-c:v", "copy",
            "-c:a", "aac",
            "-b:a", "192k",
            "-map", "0:v:0",
            "-map", "1:a:0",
            "-movflags", "+faststart",
            "-shortest",
            side_by_side_mp4
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    total_elapsed = round(time.time() - t0, 2)
    print(f"=== LIVEPORTRAIT GENERATION FINISHED IN {total_elapsed}s ===")

    with open(final_mp4, "rb") as f:
        video_bytes = f.read()

    comparison_bytes = None
    if side_by_side_mp4 and os.path.exists(side_by_side_mp4):
        with open(side_by_side_mp4, "rb") as f:
            comparison_bytes = f.read()

    return {
        "ok": True,
        "video_bytes": video_bytes,
        "comparison_bytes": comparison_bytes,
        "duration_sec": audio_dur,
        "elapsed_sec": total_elapsed,
        "fps": 30,
        "resolution": "512x512",
        "render_mode": "Modal LivePortrait (A100 GPU)",
    }

# FastAPI Web Endpoint for Avatar Studio and external microservices
@app.function(
    image=liveportrait_image,
    gpu="A100-80GB",
    volumes={"/models": vol},
    timeout=600,
    scaledown_window=300,
)
@modal.fastapi_endpoint(method="POST")
def render_endpoint(payload: dict) -> dict:
    """
    Fortified REST API endpoint for Avatar Studio.
    Payload:
      - avatar_base64: Base64 image data
      - audio_base64: Base64 audio wav/mp3/aac data
      - driving_multiplier: float (default: 1.15)
      - side_by_side: bool (default: False)
    """
    avatar_b64 = payload.get("avatar_base64", "")
    audio_b64 = payload.get("audio_base64", "")

    if not avatar_b64 or not audio_b64:
        return {"ok": False, "code": "MISSING_INPUTS", "message": "avatar_base64 and audio_base64 are required."}

    try:
        raw_avatar = avatar_b64.split(",")[-1]
        raw_audio = audio_b64.split(",")[-1]
        portrait_bytes = base64.b64decode(raw_avatar)
        audio_bytes = base64.b64decode(raw_audio)
    except Exception as b64_err:
        return {"ok": False, "code": "INVALID_BASE64", "message": f"Malformed base64 payload: {b64_err}"}

    driving_bytes = None
    if payload.get("driving_base64"):
        try:
            driving_bytes = base64.b64decode(payload["driving_base64"].split(",")[-1])
        except Exception:
            driving_bytes = None

    driving_multiplier = float(payload.get("driving_multiplier", 1.15))
    make_side_by_side = bool(payload.get("side_by_side", False))

    try:
        res = render_avatar.local(
            portrait_bytes=portrait_bytes,
            audio_bytes=audio_bytes,
            driving_bytes=driving_bytes,
            driving_multiplier=driving_multiplier,
            make_side_by_side=make_side_by_side,
        )

        return {
            "ok": True,
            "jobId": f"modal_lp_{int(time.time())}",
            "video_base64": "data:video/mp4;base64," + base64.b64encode(res["video_bytes"]).decode("ascii"),
            "durationSec": res["duration_sec"],
            "elapsedSec": res["elapsed_sec"],
            "fps": res["fps"],
            "resolution": res["resolution"],
            "renderMode": res["render_mode"],
        }
    except ValueError as ve:
        return {"ok": False, "code": "VALIDATION_ERROR", "message": str(ve)}
    except Exception as exc:
        return {"ok": False, "code": "INFERENCE_ERROR", "message": f"LivePortrait failed: {exc}"}

@app.local_entrypoint()
def main(
    portrait: str = r"public\output\comparison_source\logan_portrait.jpg",
    audio: str = r"public\output\comparison_source\logan_15s.wav",
    output: str = r"public\output\episodes\liveportrait_avatar.mp4",
    driving: Optional[str] = None,
    multiplier: float = 1.15,
):
    print(f"=== Modal LivePortrait Local Trigger ===")
    print(f"Portrait: {portrait}")
    print(f"Audio:    {audio}")
    print(f"Output:   {output}")

    if not os.path.exists(portrait):
        raise FileNotFoundError(f"Portrait file not found: {portrait}")
    if not os.path.exists(audio):
        raise FileNotFoundError(f"Audio file not found: {audio}")

    with open(portrait, "rb") as f:
        p_bytes = f.read()
    with open(audio, "rb") as f:
        a_bytes = f.read()

    d_bytes = None
    if driving and os.path.exists(driving):
        with open(driving, "rb") as f:
            d_bytes = f.read()

    res = render_avatar.remote(
        portrait_bytes=p_bytes,
        audio_bytes=a_bytes,
        driving_bytes=d_bytes,
        driving_multiplier=multiplier,
    )

    os.makedirs(os.path.dirname(os.path.abspath(output)), exist_ok=True)
    with open(output, "wb") as f:
        f.write(res["video_bytes"])

    print(f"SUCCESS: Rendered in {res['elapsed_sec']}s ({res['duration_sec']}s video).")
    print(f"Saved to: {os.path.abspath(output)}")
