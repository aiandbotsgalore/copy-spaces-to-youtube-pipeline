#!/usr/bin/env python3
"""
Cloud worker for the Spaces Live Stage avatar render.

The workflow dispatches this packaged worker (rather than the older root-level
prototype). Each speaker with transcript turns in the clip gets a Wav2Lip stream
driven by audio muted outside those turns; speakers with no turns stay on stage
as still, quiet listeners. When no transcript turns are supplied, detected speech
is given to the primary speaker only. All tiles are composited into a stage grid
or split-screen layout, and a tile is highlighted only during its own turns.
"""

import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

import numpy as np


def run_cmd(cmd, check=True, cwd=None, env=None):
    cmd_str = " ".join(cmd) if isinstance(cmd, list) else cmd
    print(f"[*] Running: {cmd_str}")
    result = subprocess.run(
        cmd,
        shell=isinstance(cmd, str),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=cwd,
        env=env,
    )
    if result.stdout:
        print(result.stdout[-1200:])
    if result.stderr and result.returncode != 0:
        print(f"[!] Stderr: {result.stderr[-1200:]}")
    if check and result.returncode != 0:
        raise RuntimeError(f"Command failed with code {result.returncode}")
    return result


def download_file(url: str, dest_path: Path, min_size: int = 1000, attempts: int = 4):
    if dest_path.exists() and dest_path.stat().st_size >= min_size:
        print(f"[✓] File already present: {dest_path.name}")
        return
    last_error = None
    for attempt in range(1, attempts + 1):
        temp_path = dest_path.with_suffix(dest_path.suffix + ".part")
        try:
            print(f"[*] Downloading {dest_path.name} from {url} (attempt {attempt}/{attempts})...")
            request = urllib.request.Request(url, headers={"User-Agent": "SpacePipe-TalkingAvatarGenerator/2.0"})
            with urllib.request.urlopen(request, timeout=120) as response, open(temp_path, "wb") as output:
                shutil.copyfileobj(response, output)
            size = temp_path.stat().st_size
            if size < min_size:
                raise RuntimeError(f"Downloaded file is too small to be valid: {dest_path.name} ({size} bytes)")
            temp_path.replace(dest_path)
            print(f"[✓] Downloaded {dest_path.name} ({size / (1024 * 1024):.1f} MB)")
            return
        except Exception as error:
            last_error = error
            temp_path.unlink(missing_ok=True)
            if attempt < attempts:
                delay = min(30, 2 ** (attempt - 1))
                print(f"[!] Download failed: {error}; retrying in {delay}s")
                time.sleep(delay)
    raise RuntimeError(f"Could not download {dest_path.name}: {last_error}")


def parse_json(value: str, fallback):
    try:
        return json.loads(value or "")
    except (TypeError, ValueError, json.JSONDecodeError):
        return fallback


def slug(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]+", "_", value).strip("_") or "speaker"


def speaker_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def escape_option_path(value: str) -> str:
    """Escape a filesystem path for an FFmpeg filter option value.

    Paths are wrapped in single quotes at the call site, which protects every character except a
    colon (FFmpeg still splits options on an unescaped ':'), so only that needs a backslash.
    """
    return str(value or "").replace("\\", "/").replace(":", r"\:")


def write_drawtext_text(text_dir: Path, file_name: str, value: str) -> str:
    """Store caption text in a file and return the drawtext option that reads it.

    Speaker names and clip titles cannot be embedded in the filtergraph safely: an apostrophe ends
    a quoted value and a comma splits the filter chain. FFmpeg's textfile option sidesteps the
    parser entirely, so names like O'Brien, Jr. or titles full of quotes and emoji render as text.
    """
    text_dir.mkdir(parents=True, exist_ok=True)
    target = text_dir / file_name
    target.write_text(str(value or "").replace("\r", " ").replace("\n", " "), encoding="utf-8")
    return f"textfile='{escape_option_path(str(target))}'"


def parse_speakers(raw: str) -> List[str]:
    values = parse_json(raw, [])
    if not isinstance(values, list):
        return []
    result: List[str] = []
    seen = set()
    for value in values:
        name = str(value or "").strip()
        key = speaker_key(name)
        if name and key and key not in seen:
            result.append(name)
            seen.add(key)
    return result[:8]


def parse_segments(raw: str, speakers: Iterable[str], duration: float) -> Dict[str, List[Tuple[float, float]]]:
    """Normalize clip-relative transcript turns into intervals by speaker."""
    by_key = {speaker_key(name): name for name in speakers}
    intervals: Dict[str, List[Tuple[float, float]]] = {name: [] for name in speakers}
    values = parse_json(raw, [])
    if isinstance(values, list):
        for value in values:
            if not isinstance(value, dict):
                continue
            canonical = by_key.get(speaker_key(value.get("speaker", "")))
            if not canonical:
                continue
            try:
                start = float(value.get("start", 0))
                end = float(value.get("end", start))
            except (TypeError, ValueError):
                continue
            # NaN/inf (json.loads accepts NaN) would poison the FFmpeg between() expression.
            if not (math.isfinite(start) and math.isfinite(end)):
                continue
            start = max(0.0, min(duration, start))
            end = max(0.0, min(duration, end))
            if end > start:
                intervals[canonical].append((start, end))
    for name in intervals:
        intervals[name].sort()
    return intervals


MIN_RENDER_SECONDS = 0.5    # shorter clips cannot produce a meaningful stage video
SILENCE_NOISE_DB = -35      # quieter than this counts as silence
SILENCE_MIN_SEC = 0.35      # a pause must last this long to split speech
MIN_SPEECH_SEC = 0.25       # shorter bursts (clicks, breaths) are not speech


def parse_silencedetect(stderr: str, duration: float) -> List[Tuple[float, float]]:
    """Read FFmpeg silencedetect output into (start, end) silences. A silence still open at the end runs to the end."""
    silences: List[Tuple[float, float]] = []
    start = None
    for line in (stderr or "").splitlines():
        opened = re.search(r"silence_start:\s*(-?[\d.]+)", line)
        if opened:
            start = max(0.0, float(opened.group(1)))
            continue
        closed = re.search(r"silence_end:\s*([\d.]+)", line)
        if closed and start is not None:
            silences.append((start, min(duration, float(closed.group(1)))))
            start = None
    if start is not None and start < duration:
        silences.append((start, duration))
    return silences


def speech_from_silences(silences: List[Tuple[float, float]], duration: float, min_speech: float = MIN_SPEECH_SEC) -> List[Tuple[float, float]]:
    """Speech is whatever lies between the silences, ignoring bursts shorter than min_speech."""
    speech: List[Tuple[float, float]] = []
    cursor = 0.0
    for start, end in sorted(silences):
        if start - cursor >= min_speech:
            speech.append((round(cursor, 3), round(start, 3)))
        cursor = max(cursor, end)
    if duration - cursor >= min_speech:
        speech.append((round(cursor, 3), round(duration, 3)))
    return speech


def detect_speech_intervals(audio: Path, duration: float) -> List[Tuple[float, float]]:
    """Find the parts of the clip where someone is talking, using FFmpeg silencedetect."""
    result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(audio),
         "-af", f"silencedetect=noise={SILENCE_NOISE_DB}dB:d={SILENCE_MIN_SEC}", "-f", "null", "-"],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if result.returncode != 0:
        print("[!] Speech detection failed; treating the whole clip as speech for the primary speaker.")
        return [(0.0, round(duration, 3))]
    return speech_from_silences(parse_silencedetect(result.stderr, duration), duration)


def resolve_intervals(raw_segments: str, speakers: List[str], duration: float, vad) -> Tuple[Dict[str, List[Tuple[float, float]]], str]:
    """Speaking turns per stage speaker.

    Transcript turns are used when any of them belong to someone on stage. Otherwise the detected
    speech (vad) goes to the primary speaker only; everyone else stays a quiet listener.
    Returns (intervals, source) where source is "transcript" or "voice_activity".
    """
    intervals = parse_segments(raw_segments, speakers, duration)
    if any(intervals.values()):
        return intervals, "transcript"
    result: Dict[str, List[Tuple[float, float]]] = {name: [] for name in speakers}
    if speakers:
        result[speakers[0]] = list(vad())
    return result, "voice_activity"


def run_ffprobe_duration(path: Path) -> float:
    result = run_cmd(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        check=False,
    )
    try:
        return max(0.1, float(result.stdout.strip()))
    except (TypeError, ValueError):
        return 1.0


def patch_echomimic(repo_dir: Path):
    """Patch EchoMimic to eliminate slow moviepy dependency and use native FFmpeg stream copying."""
    target_py = repo_dir / "infer_audio2vid_acc.py"
    if not target_py.exists():
        return
    content = target_py.read_text(encoding="utf-8")

    # 0. Monkey-patch huggingface_hub for diffusers 0.24 compatibility
    hf_compat = (
        "import huggingface_hub\n"
        "import huggingface_hub.constants\n"
        "if not hasattr(huggingface_hub.constants, 'hf_cache_home'):\n"
        "    huggingface_hub.constants.hf_cache_home = getattr(huggingface_hub.constants, 'HF_HOME', '/root/.cache/huggingface')\n"
        "if not hasattr(huggingface_hub, 'hf_cache_home'):\n"
        "    huggingface_hub.hf_cache_home = getattr(huggingface_hub.constants, 'hf_cache_home', '/root/.cache/huggingface')\n"
        "if not hasattr(huggingface_hub, 'HfFolder'):\n"
        "    huggingface_hub.HfFolder = type('HfFolder', (), {'get_token': staticmethod(lambda: None), 'save_token': staticmethod(lambda t: None), 'delete_token': staticmethod(lambda: None)})\n"
        "if not hasattr(huggingface_hub, 'cached_download'):\n"
        "    huggingface_hub.cached_download = getattr(huggingface_hub, 'hf_hub_download', None)\n"
        "if not hasattr(huggingface_hub, 'is_offline_mode'):\n"
        "    huggingface_hub.is_offline_mode = getattr(huggingface_hub.constants, 'is_offline_mode', lambda: False)\n"
        "if not hasattr(huggingface_hub.constants, 'is_offline_mode'):\n"
        "    huggingface_hub.constants.is_offline_mode = lambda: False\n"
    )
    if "is_offline_mode" not in content or "huggingface_hub.HfFolder" not in content:
        content = hf_compat + content

    # Write sitecustomize.py to ensure child Python processes load the compatibility shim automatically
    sitecustomize_py = repo_dir / "sitecustomize.py"
    sitecustomize_py.write_text(hf_compat, encoding="utf-8")

    # 1. Neutralize moviepy import
    content = content.replace(
        "from moviepy.editor import VideoFileClip, AudioFileClip",
        "# from moviepy.editor import VideoFileClip, AudioFileClip",
    )

    # 2. Replace moviepy re-encoding with fast ffmpeg stream copy
    start_marker = "video_clip = VideoFileClip("
    end_marker = '_withaudio.mp4", codec="libx264", audio_codec="aac")'
    if start_marker in content and end_marker in content:
        start_idx = content.find(start_marker)
        # Backtrack to start of line to replace indent cleanly
        line_start = content.rfind("\n", 0, start_idx) + 1
        end_idx = content.find(end_marker) + len(end_marker)
        fast_mux = (
            '            raw_vid = f"{save_dir}/{ref_name}_{audio_name}_{args.H}x{args.W}_{int(args.cfg)}_{time_str}.mp4"\n'
            '            muxed_vid = f"{save_dir}/{ref_name}_{audio_name}_{args.H}x{args.W}_{int(args.cfg)}_{time_str}_withaudio.mp4"\n'
            '            subprocess.run(["ffmpeg", "-y", "-i", raw_vid, "-i", audio_path, "-c:v", "copy", "-c:a", "aac", "-shortest", muxed_vid], check=True)'
        )
        content = content[:line_start] + fast_mux + content[end_idx:]
    import ast
    ast.parse(content)
    target_py.write_text(content, encoding="utf-8")
    print("[✓] EchoMimic patched: moviepy eliminated, ultra-fast FFmpeg stream copy active (syntax verified).")

    # 3. Patch PositionNet in src/models/unet_2d_condition.py for modern diffusers compatibility
    unet_py = repo_dir / "src" / "models" / "unet_2d_condition.py"
    if unet_py.exists():
        unet_content = unet_py.read_text(encoding="utf-8")
        if "PositionNet," in unet_content:
            unet_content = unet_content.replace("    PositionNet,\n", "")
            safe_position_net = (
                "\ntry:\n"
                "    from diffusers.models.embeddings import PositionNet\n"
                "except ImportError:\n"
                "    try:\n"
                "        from diffusers.models.embeddings import GLIGENTextBoundingboxProjection as PositionNet\n"
                "    except ImportError:\n"
                "        import torch.nn as nn\n"
                "        class PositionNet(nn.Module):\n"
                "            def __init__(self, *args, **kwargs):\n"
                "                super().__init__()\n"
                "            def forward(self, *args, **kwargs):\n"
                "                return None\n"
            )
            unet_content += safe_position_net
            ast.parse(unet_content)
            unet_py.write_text(unet_content, encoding="utf-8")
            print("[✓] Patched unet_2d_condition.py: PositionNet diffusers compatibility active.")

    # 4. Patch DualTransformer2DModel in src/models/unet_2d_blocks.py
    blocks_py = repo_dir / "src" / "models" / "unet_2d_blocks.py"
    if blocks_py.exists():
        blocks_content = blocks_py.read_text(encoding="utf-8")
        if "from diffusers.models.dual_transformer_2d import DualTransformer2DModel" in blocks_content:
            safe_dual = (
                "try:\n"
                "    from diffusers.models.dual_transformer_2d import DualTransformer2DModel\n"
                "except ImportError:\n"
                "    try:\n"
                "        from diffusers.models.transformers.dual_transformer_2d import DualTransformer2DModel\n"
                "    except ImportError:\n"
                "        from diffusers.models import DualTransformer2DModel\n"
            )
            blocks_content = blocks_content.replace(
                "from diffusers.models.dual_transformer_2d import DualTransformer2DModel\n",
                safe_dual,
            )
            ast.parse(blocks_content)
            blocks_py.write_text(blocks_content, encoding="utf-8")
            print("[✓] Patched unet_2d_blocks.py: DualTransformer2DModel compatibility active.")


def prepare_echomimic(work_dir: Path) -> Tuple[Path, Path]:
    """Prepare EchoMimic repository, pre-baked weights, and optimized dependencies."""
    if os.name != "nt" and Path("/tmp").exists():
        echomimic_dir = Path("/tmp/echomimic")
    else:
        echomimic_dir = work_dir / "echomimic"
    if not echomimic_dir.exists():
        run_cmd(["git", "clone", "--depth", "1", "https://github.com/antgroup/echomimic.git", str(echomimic_dir)])
    patch_echomimic(echomimic_dir)

    # 1. Check for Pre-Packaged Wheels Cache (Optimization #2)
    wheels_installed = False
    for candidate in [
        Path("/kaggle/input/echomimic-pretrained-weights/wheels"),
        Path("/kaggle/input/echomimic-weights/wheels"),
    ]:
        if candidate.exists() and list(candidate.glob("*.whl")):
            print(f"[*] Installing pre-packaged wheels from {candidate}...")
            run_cmd([
                sys.executable, "-m", "pip", "install", "--no-index", f"--find-links={candidate}",
                "facenet-pytorch", "omegaconf", "diffusers",
            ])
            wheels_installed = True
            break

    if not wheels_installed:
        # Fast direct pip install (install facenet-pytorch with --no-deps to use Kaggle's pre-installed torch/torchvision/Pillow/numpy without source compilation)
        print("[*] Installing runtime dependencies (facenet-pytorch, omegaconf, huggingface_hub==0.25.2, diffusers==0.24.0)...")
        run_cmd([sys.executable, "-m", "pip", "install", "--no-cache-dir", "--no-deps", "facenet-pytorch"])
        run_cmd([sys.executable, "-m", "pip", "install", "--no-cache-dir", "omegaconf"])
        run_cmd([sys.executable, "-m", "pip", "install", "--no-cache-dir", "huggingface_hub==0.25.2", "diffusers==0.24.0"])

    weights_dir = echomimic_dir / "pretrained_weights"
    acc_ckpt = weights_dir / "denoising_unet_acc.pth"

    # 2. Check for Pre-Baked Kaggle Dataset for Model Weights (Optimization #1)
    if not acc_ckpt.exists():
        candidates = [
            Path("/kaggle/input/echomimic-pretrained-weights"),
            Path("/kaggle/input/echomimic-weights"),
            Path("/kaggle/input/echomimic-v3-models"),
        ]
        if "KAGGLE_DATASET_DIR" in os.environ:
            candidates.insert(0, Path(os.environ["KAGGLE_DATASET_DIR"]))
        for candidate in candidates:
            if candidate.exists() and (candidate / "denoising_unet_acc.pth").exists():
                print(f"[✓] Detected pre-baked Kaggle weights dataset at {candidate}! Linking instantly...")
                weights_dir.mkdir(parents=True, exist_ok=True)
                for item in candidate.iterdir():
                    dest = weights_dir / item.name
                    if dest.is_symlink() or dest.exists():
                        continue
                    try:
                        os.symlink(item, dest)
                    except Exception:
                        if item.is_dir():
                            shutil.copytree(item, dest)
                        else:
                            shutil.copy2(item, dest)
                acc_ckpt = weights_dir / "denoising_unet_acc.pth"
                if acc_ckpt.exists():
                    print("[✓] EchoMimic model weights mounted instantly (0s cold-start overhead).")
                    break

    # 3. Fallback: Download via huggingface_hub snapshot or git clone
    if not acc_ckpt.exists():
        weights_dir.mkdir(parents=True, exist_ok=True)
        print("[*] Downloading EchoMimic accelerated weights from Hugging Face...")
        try:
            from huggingface_hub import snapshot_download
            snapshot_download(
                repo_id="BadToBest/EchoMimic",
                local_dir=str(weights_dir),
                allow_patterns=[
                    "*acc*",
                    "audio_processor/*",
                    "face_locator.pth",
                    "reference_unet.pth",
                    "sd-image-variations-diffusers/*",
                    "sd-vae-ft-mse/*",
                ],
                resume_download=True,
            )
            print("[✓] EchoMimic weights downloaded successfully.")
        except Exception as error:
            print(f"[!] snapshot_download error: {error}; attempting direct git clone fallback...")
            if not acc_ckpt.exists():
                run_cmd(["git", "clone", "--depth", "1", "https://huggingface.co/BadToBest/EchoMimic", str(weights_dir)])

    if not acc_ckpt.exists():
        raise RuntimeError("EchoMimic accelerated model weights are missing or incomplete.")

    return echomimic_dir, acc_ckpt


# Backward-compatible alias for existing test harnesses
prepare_wav2lip = prepare_echomimic


def build_speaker_audio(source_audio: Path, output_audio: Path, intervals: List[Tuple[float, float]]):
    if not intervals:
        return False
    condition = "+".join(f"between(t,{start:.3f},{end:.3f})" for start, end in intervals)
    # Keep the original timeline and mute everything outside this speaker's turns.
    volume_filter = f"volume=0:enable='not({condition})'"
    run_cmd([
        "ffmpeg", "-y", "-i", str(source_audio), "-af", volume_filter,
        "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(output_audio),
    ])
    return output_audio.exists() and output_audio.stat().st_size > 1000


def render_static_avatar(image: Path, output: Path, duration: float):
    run_cmd([
        "ffmpeg", "-y", "-loop", "1", "-i", str(image), "-t", f"{duration:.3f}",
        "-vf", "scale=512:512:force_original_aspect_ratio=increase,crop=512:512,format=yuv420p",
        "-r", "25", "-an", str(output),
    ])


def render_talking_avatar(*args, **kwargs):
    """Render an audio-driven talking avatar using EchoMimic accelerated pipeline.

    Accepts:
      (image, audio, output)
      (echomimic_dir, checkpoint, image, audio, output)
    """
    if len(args) == 3:
        image, audio, output = args
        echomimic_dir = Path("echomimic") if Path("echomimic").exists() else Path(".")
        checkpoint = echomimic_dir / "pretrained_weights" / "denoising_unet_acc.pth"
    elif len(args) >= 5:
        echomimic_dir, checkpoint, image, audio, output = args[:5]
    else:
        raise ValueError(f"Unexpected arguments to render_talking_avatar: {args}")

    image = Path(image)
    audio = Path(audio)
    output = Path(output)
    duration = kwargs.get("duration", 0.0)
    gpu_id = kwargs.get("gpu_id", 0)
    if duration <= 0.0:
        duration = run_ffprobe_duration(audio)

    fps = 24
    frames = max(24, int(math.ceil(duration * fps)))

    # Resolution-Adaptive Latent Steps (Optimization #4: 6 standard, 4 for draft/preview mode)
    steps_env = os.environ.get("LATENT_STEPS")
    render_mode = os.environ.get("RENDER_MODE", "normal").lower()
    if steps_env and steps_env.isdigit():
        latent_steps = int(steps_env)
    elif render_mode == "draft":
        latent_steps = 4
    else:
        latent_steps = 6

    config_file = echomimic_dir / f"custom_prompt_{slug(image.stem)}_{slug(audio.stem)}.yaml"
    image_abs = str(image.resolve()).replace("\\", "/")
    audio_abs = str(audio.resolve()).replace("\\", "/")

    yaml_text = f"""## dependency models
pretrained_base_model_path: "./pretrained_weights/sd-image-variations-diffusers/"
pretrained_vae_path: "./pretrained_weights/sd-vae-ft-mse/"
audio_model_path: "./pretrained_weights/audio_processor/whisper_tiny.pt"

## echo mimic checkpoint
denoising_unet_path: "./pretrained_weights/denoising_unet_acc.pth"
reference_unet_path: "./pretrained_weights/reference_unet.pth"
face_locator_path: "./pretrained_weights/face_locator.pth"
motion_module_path: "./pretrained_weights/motion_module_acc.pth"

## denoise model configs
inference_config: "./configs/inference/inference_v2.yaml"
weight_dtype: 'fp16'

## test cases
test_cases:
  "{image_abs}":
    - "{audio_abs}"
"""
    config_file.write_text(yaml_text, encoding="utf-8")

    out_folder = echomimic_dir / "output"
    prev_videos = set(out_folder.rglob("*.mp4")) if out_folder.exists() else set()

    command = [
        sys.executable, "-u", "infer_audio2vid_acc.py",
        "--config", str(config_file.name),
        "-W", "512", "-H", "512",
        "-L", str(frames),
        "--fps", str(fps),
        "--steps", str(latent_steps),
        "--cfg", "1.0",
    ]

    # Dual-T4 GPU assignment (Optimization #3) & environment paths
    child_env = os.environ.copy()
    existing_pp = child_env.get("PYTHONPATH", "")
    child_env["PYTHONPATH"] = f"{echomimic_dir}:{existing_pp}" if existing_pp else str(echomimic_dir)
    if gpu_id is not None:
        child_env["CUDA_VISIBLE_DEVICES"] = str(gpu_id)
        print(f"[*] Running avatar inference for {image.name} on GPU #{gpu_id} ({latent_steps} latent steps)...")

    run_cmd(command, cwd=str(echomimic_dir), env=child_env)

    current_videos = set(out_folder.rglob("*.mp4")) if out_folder.exists() else set()
    new_candidates = [f for f in (current_videos - prev_videos) if "_withaudio" in f.name]
    if not new_candidates:
        new_candidates = [f for f in (current_videos - prev_videos) if f.is_file()]
    if not new_candidates:
        all_sorted = sorted(out_folder.rglob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
        if all_sorted:
            new_candidates = [all_sorted[0]]

    if not new_candidates or not new_candidates[0].exists() or new_candidates[0].stat().st_size < 10_000:
        raise RuntimeError(f"EchoMimic produced no usable video for {image.name}")

    shutil.copy2(new_candidates[0], output)
    print(f"[✓] Generated EchoMimic talking avatar video: {output.name} ({output.stat().st_size / (1024 * 1024):.2f} MB)")


MOTION_WINDOW_SEC = 3.0     # measure motion inside one turn, so pauses do not dilute the score


class MotionCheckUnavailable(RuntimeError):
    """The generated video is too short to compare frames; the motion check cannot run."""


def motion_window(active_intervals: List[Tuple[float, float]]) -> Tuple[float, float]:
    """The longest speaking turn, capped to MOTION_WINDOW_SEC.

    Trimming from the first turn's start to the last turn's end would include other speakers'
    turns and every pause, which can push a moving mouth below the still-image threshold.
    """
    start, end = max(active_intervals, key=lambda interval: interval[1] - interval[0])
    start = float(start)
    return start, min(float(end), start + MOTION_WINDOW_SEC)


def motion_score(path: Path, active_intervals: List[Tuple[float, float]] | None = None,
                 region: Tuple[int, int, int, int] | None = None) -> float:
    """Return mouth-region frame change during speaking time.

    region (x, y, w, h) limits the measurement to one tile of a composite; the mouth area is then
    taken inside that tile instead of inside the whole frame.
    """
    trim = ""
    if active_intervals:
        start, end = motion_window(active_intervals)
        trim = f"trim=start={start:.3f}:end={end:.3f},setpts=PTS-STARTPTS,"
    tile = f"crop={region[2]}:{region[3]}:{region[0]}:{region[1]}," if region else ""
    result = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-vf", f"{trim}fps=5,{tile}crop=iw*0.6:ih*0.35:iw*0.2:ih*0.42,scale=96:56,format=gray", "-f", "rawvideo", "-"],
        capture_output=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Could not inspect generated motion in {path.name}")
    frames = np.frombuffer(result.stdout, dtype=np.uint8)
    frame_size = 96 * 56
    if frames.size < frame_size * 2:
        raise MotionCheckUnavailable(f"Generated video is too short to verify motion: {path.name}")
    frames = frames[: frames.size // frame_size * frame_size].reshape(-1, 56, 96)
    return float(np.abs(np.diff(frames.astype(np.float32), axis=0)).mean())


def render_speaker_tiles(speakers: List[str], intervals: Dict[str, List[Tuple[float, float]]], avatar_files: Dict[str, Path],
                         norm_audio: Path, work_dir: Path, duration: float,
                         talking_fn, static_fn=None, audio_fn=None, score_fn=None) -> Tuple[List[Path], Dict[str, dict]]:
    """One video per stage speaker, in stage order.

    Speakers with turns get an EchoMimic video driven by audio muted outside their turns.
    Dual-T4 parallelization dispatches across GPU 0 and GPU 1 when multiple speakers talk.
    Speakers without turns are quiet listeners: a still tile with no lip sync and no motion check.
    """
    import concurrent.futures
    import torch

    num_gpus = torch.cuda.device_count() if torch.cuda.is_available() else 1
    static_fn = static_fn or render_static_avatar
    audio_fn = audio_fn or build_speaker_audio
    score_fn = score_fn or motion_score
    videos: List[Path] = []
    report: Dict[str, dict] = {}

    speaking_tasks = []
    for index, speaker in enumerate(speakers):
        turns = intervals.get(speaker, [])
        name = slug(speaker)
        if not turns:
            video = work_dir / f"listening_{name}.mp4"
            static_fn(avatar_files[speaker], video, duration)
            print(f"[*] {speaker} does not speak in this clip; showing a quiet listener tile.")
            report[speaker] = {"role": "listening", "speaking_seconds": 0.0, "motion_checked": False}
        else:
            speaking_tasks.append((index, speaker, turns))

    # Pre-render audio tracks for speaking turns
    for spk_idx, speaker, turns in speaking_tasks:
        name = slug(speaker)
        speaker_audio = work_dir / f"audio_{name}.wav"
        if not audio_fn(norm_audio, speaker_audio, turns):
            raise RuntimeError(f"Could not build the speaking audio track for {speaker}")

    # Dual-T4 Parallelization worker (Optimization #3)
    def render_one_speaking(item):
        spk_idx, speaker, turns = item
        name = slug(speaker)
        speaker_audio = work_dir / f"audio_{name}.wav"
        video = work_dir / f"talking_{name}.mp4"
        gpu_id = (spk_idx % num_gpus) if num_gpus > 1 else 0
        try:
            talking_fn(avatar_files[speaker], speaker_audio, video, gpu_id=gpu_id)
        except TypeError:
            talking_fn(avatar_files[speaker], speaker_audio, video)
        return speaker, turns, video

    if num_gpus >= 2 and len(speaking_tasks) > 1:
        print(f"[*] Dual-T4 multi-GPU parallelization active: dispatching {len(speaking_tasks)} speakers across {num_gpus} GPUs concurrently...")
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(num_gpus, len(speaking_tasks))) as executor:
            speaking_results = list(executor.map(render_one_speaking, speaking_tasks))
    else:
        speaking_results = [render_one_speaking(item) for item in speaking_tasks]

    # Verify motion on rendered videos
    for speaker, turns, video in speaking_results:
        speaking_seconds = round(sum(end - start for start, end in turns), 3)
        try:
            score = score_fn(video, turns)
            static_probe = work_dir / f"static_probe_{slug(speaker)}.mp4"
            static_fn(avatar_files[speaker], static_probe, duration)
            baseline = score_fn(static_probe, turns)
        except MotionCheckUnavailable as error:
            print(f"[!] {error}; skipping the motion check for {speaker}.")
            report[speaker] = {
                "role": "speaking",
                "speaking_seconds": speaking_seconds,
                "motion_checked": False,
                "motion_note": str(error),
            }
            continue

        print(f"[*] Verified motion for {speaker}: {score:.3f} (static baseline {baseline:.3f})")
        if score <= baseline + 0.05:
            raise RuntimeError(
                f"Generated video for {speaker} appears to be a still image "
                f"(motion {score:.3f}, static baseline {baseline:.3f})"
            )
        report[speaker] = {
            "role": "speaking",
            "speaking_seconds": speaking_seconds,
            "motion_checked": True,
            "motion_score": score,
            "static_baseline": baseline,
        }

    # Order videos in original stage layout sequence
    for speaker in speakers:
        name = slug(speaker)
        turns = intervals.get(speaker, [])
        if not turns:
            videos.append(work_dir / f"listening_{name}.mp4")
        else:
            videos.append(work_dir / f"talking_{name}.mp4")

    return videos, report


def canvas_for_ratio(ratio: str) -> Tuple[int, int]:
    return {"1:1": (1080, 1080), "16:9": (1920, 1080)}.get(ratio, (1080, 1920))


def layout_geometry(layout: str, ratio: str, speaker_count: int):
    width, height = canvas_for_ratio(ratio)
    caption_height = max(180, round(height * 0.22))
    stage_height = height - caption_height
    margin = max(20, round(width * 0.025))
    if layout == "solo":
        # One full-width closeup: the same geometry the split screen uses, with a single tile.
        cols, rows = 1, 1
    elif layout == "split_screen":
        cols = 1
        rows = max(1, min(3, speaker_count))
    else:
        cols = 2 if speaker_count <= 4 else 3
        rows = max(1, (speaker_count + cols - 1) // cols)
    # Keep tile dimensions even for yuv420p. Odd pad targets make FFmpeg reject
    # an otherwise valid portrait stream on some builds.
    tile_width = max(160, ((width - margin * (cols + 1)) // cols) // 2 * 2)
    tile_height = max(140, ((stage_height - margin * (rows + 1)) // rows) // 2 * 2)
    return width, height, caption_height, margin, cols, tile_width, tile_height


def tile_rect(layout: str, ratio: str, speaker_count: int, index: int) -> Tuple[int, int, int, int]:
    """(x, y, w, h) of a speaker's tile on the stage."""
    _, _, _, margin, cols, tile_width, tile_height = layout_geometry(layout, ratio, speaker_count)
    row, col = divmod(index, cols)
    return margin + col * (tile_width + margin), margin + row * (tile_height + margin), tile_width, tile_height


def build_stage_filtergraph(speakers: List[str], intervals: Dict[str, List[Tuple[float, float]]], prompt: str, layout: str, ratio: str, font_option: str, text_dir: Path) -> str:
    """FFmpeg filtergraph for the stage. Input 0 is the background, inputs 1..N are the speaker tiles.

    A tile gets the green border and the Speaking badge only while t is inside that speaker's own
    turns; the rest of the time it reads Listening. A speaker with no turns never lights up.
    """
    width, height, caption_height, margin, cols, tile_width, tile_height = layout_geometry(layout, ratio, len(speakers))
    badge_size = max(16, tile_width // 30)
    badge_w, badge_h = badge_size * 6, round(badge_size * 1.8)
    badge_text_y = 16 + (badge_h - badge_size) // 2
    filters = ["[0:v]format=yuv420p[base]"]
    last = "base"
    for index, speaker in enumerate(speakers):
        x, y, _, _ = tile_rect(layout, ratio, len(speakers), index)
        turns = intervals.get(speaker, [])
        active = "+".join(f"between(t,{start:.3f},{end:.3f})" for start, end in turns)
        listening = [
            f"drawbox=x=16:y=16:w={badge_w}:h={badge_h}:color=0x0f172a@0.85:t=fill",
            f"drawtext=text='Listening':{font_option}fontcolor=0xcbd5e1:fontsize={badge_size}:x=16+{badge_size // 2}:y={badge_text_y}",
        ]
        parts = [
            f"[{index + 1}:v]fps=25,scale={tile_width}:{tile_height}:force_original_aspect_ratio=decrease",
            f"pad={tile_width}:{tile_height}:(ow-iw)/2:(oh-ih)/2:color=0x111827",
            "drawbox=x=0:y=0:w=iw-1:h=ih-1:color=0x334155:t=8",
        ]
        if active:
            parts += [f"{item}:enable='not({active})'" for item in listening]
            parts += [
                f"drawbox=x=0:y=0:w=iw-1:h=ih-1:color=0x10b981:t=12:enable='{active}'",
                f"drawbox=x=16:y=16:w={badge_w}:h={badge_h}:color=0x10b981@0.9:t=fill:enable='{active}'",
                f"drawtext=text='Speaking':{font_option}fontcolor=white:fontsize={badge_size}:x=16+{badge_size // 2}:y={badge_text_y}:enable='{active}'",
            ]
        else:
            parts += listening
        name_option = write_drawtext_text(text_dir, f"name_{index}.txt", speaker)
        parts.append(
            f"drawtext={name_option}:{font_option}fontcolor=white:fontsize={max(18, tile_width // 22)}:x=(w-text_w)/2:y=h-45:shadowcolor=black:shadowx=2:shadowy=2[tile{index}]"
        )
        filters.append(",".join(parts))
        filters.append(f"[{last}][tile{index}]overlay={x}:{y}:shortest=1[stage{index}]")
        last = f"stage{index}"

    prompt_option = write_drawtext_text(text_dir, "prompt.txt", prompt[:90])
    filters.append(
        f"[{last}]drawbox=y={height - caption_height}:w={width}:h={caption_height}:color=0x020617@0.92:t=fill,"
        f"drawtext=text='SPACES LIVE STAGE':{font_option}fontcolor=0xa855f7:fontsize={max(22, width // 45)}:x=(w-text_w)/2:y={height - caption_height + 28}:shadowcolor=black:shadowx=2:shadowy=2,"
        f"drawtext={prompt_option}:{font_option}fontcolor=white:fontsize={max(20, width // 52)}:x=(w-text_w)/2:y={height - caption_height + 85}:shadowcolor=black:shadowx=2:shadowy=2[outv]"
    )
    return ";".join(filters)


def compose_stage(output: Path, audio: Path, videos: List[Path], speakers: List[str], intervals: Dict[str, List[Tuple[float, float]]], prompt: str, layout: str, ratio: str, duration: float):
    width, height, *_ = layout_geometry(layout, ratio, len(speakers))
    font_file = os.environ.get("AVATAR_FONT_FILE", "")
    if not font_file:
        linux_font = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
        if linux_font.exists():
            font_file = str(linux_font)
    font_option = f"fontfile='{escape_option_path(font_file)}':" if font_file else ""
    inputs = ["-f", "lavfi", "-i", f"color=c=0x0b0f19:s={width}x{height}:r=25:d={duration:.3f}"]
    for video in videos:
        inputs.extend(["-i", str(video)])
    inputs.extend(["-i", str(audio)])
    graph = build_stage_filtergraph(speakers, intervals, prompt, layout, ratio, font_option, text_dir=output.parent / "stage_text")

    run_cmd([
        "ffmpeg", "-y", *inputs, "-filter_complex", graph,
        "-map", "[outv]", "-map", f"{len(videos) + 1}:a", "-t", f"{duration:.3f}",
        "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-shortest", str(output),
    ])


def main():
    print("=" * 70)
    print("    SPACES LIVE STAGE MULTI-SPEAKER AVATAR GENERATOR")
    print("    EchoMimic Diffusion streams + Dual-T4 accelerated compositing")
    print("=" * 70)

    image_input = os.environ.get("AVATAR_IMAGE", "")
    audio_input = os.environ.get("SPEECH_AUDIO", "")
    prompt = os.environ.get("PROMPT", "Twitter Spaces Live Stage")
    ratio = os.environ.get("ASPECT_RATIO", "9:16")
    layout = os.environ.get("LAYOUT", "stage_grid")
    speakers = parse_speakers(os.environ.get("SPEAKERS_JSON", "[]")) or ["Logan", "Guest"]
    if layout == "solo":
        speakers = speakers[:1]
    speaker_avatars = parse_json(os.environ.get("SPEAKER_AVATARS_JSON", "{}"), {})
    speaker_avatars = speaker_avatars if isinstance(speaker_avatars, dict) else {}
    raw_segments = os.environ.get("SPEAKER_SEGMENTS_JSON", "[]")

    work_dir = Path("/kaggle/working") if Path("/kaggle/working").exists() else Path("kaggle_work")
    work_dir.mkdir(parents=True, exist_ok=True)
    out_dir = work_dir / "avatar_output"
    out_dir.mkdir(parents=True, exist_ok=True)
    local_audio = work_dir / "speech_input"

    if audio_input.startswith("http"):
        download_file(audio_input, local_audio)
    elif audio_input and Path(audio_input).exists():
        shutil.copy2(audio_input, local_audio)
    else:
        print("[!] No speech audio found; cannot render a stage video.")
        sys.exit(1)

    norm_audio = work_dir / "speech_16k.wav"
    run_cmd(["ffmpeg", "-y", "-i", str(local_audio), "-ar", "16000", "-ac", "1", str(norm_audio)])
    duration = run_ffprobe_duration(norm_audio)
    if duration < MIN_RENDER_SECONDS:
        raise RuntimeError(
            f"Clip audio is too short to render a stage video ({duration:.2f}s); "
            f"at least {MIN_RENDER_SECONDS:.1f}s is required."
        )
    intervals, timing_source = resolve_intervals(raw_segments, speakers, duration, vad=lambda: detect_speech_intervals(norm_audio, duration))
    if timing_source == "voice_activity":
        print(f"[!] No transcript turns for anyone on stage; detected speech is assigned to {speakers[0]} only, everyone else listens.")
    for speaker in speakers:
        turns = intervals.get(speaker, [])
        print(f"[*] {speaker}: {len(turns)} turns, {sum(end - start for start, end in turns):.1f}s speaking")
    print(f"[*] Rendering {len(speakers)} speakers across {duration:.2f}s ({layout}, {ratio}), timing from {timing_source}")

    echomimic_dir, checkpoint = prepare_echomimic(work_dir)

    avatar_files: Dict[str, Path] = {}
    for index, speaker in enumerate(speakers):
        avatar = work_dir / f"avatar_{index}_{slug(speaker)}.jpg"
        url = speaker_avatars.get(speaker)
        if not url:
            url = next((value for key, value in speaker_avatars.items() if speaker_key(key) == speaker_key(speaker)), "")
        if not url:
            url = image_input
        if isinstance(url, str) and url.startswith("http"):
            try:
                download_file(url, avatar)
            except Exception as error:
                print(f"[!] Avatar download failed for {speaker}: {error}; falling back to the primary portrait.")
                if image_input and image_input.startswith("http"):
                    try:
                        download_file(image_input, avatar)
                    except Exception as fallback_error:
                        print(f"[!] Primary portrait download failed too: {fallback_error}")
        elif isinstance(url, str) and Path(url).exists():
            shutil.copy2(url, avatar)
        if not avatar.exists() or avatar.stat().st_size < 1000:
            raise RuntimeError(f"No valid avatar image was available for {speaker}")
        face = work_dir / f"face_{index}_{slug(speaker)}.jpg"
        run_cmd(["ffmpeg", "-y", "-i", str(avatar), "-vf", "scale=512:512:force_original_aspect_ratio=increase,crop=512:512", "-frames:v", "1", str(face)])
        avatar_files[speaker] = face

    rendered_videos, speaker_report = render_speaker_tiles(
        speakers, intervals, avatar_files, norm_audio, work_dir, duration,
        talking_fn=lambda image, audio, output, **kw: render_talking_avatar(echomimic_dir, checkpoint, image, audio, output, duration=duration, **kw),
    )
    anyone_speaks = any(intervals.get(speaker) for speaker in speakers)
    motion_report = {"animated": False, "timing_source": timing_source, "speakers": speaker_report, "composite_score": None}

    output = out_dir / "talking_avatar_short.mp4"
    # The untouched original clip audio is the master track; speech_16k.wav exists only to drive
    # lip sync and voice activity detection, so it must never be muxed into the deliverable.
    compose_stage(output, local_audio, rendered_videos, speakers, intervals, prompt, layout, ratio, duration)
    if anyone_speaks:
        # Check each speaking tile inside the composite, during that speaker's own turns.
        composite_scores = {}
        for index, speaker in enumerate(speakers):
            turns = intervals.get(speaker, [])
            if not turns:
                continue
            try:
                score = motion_score(output, turns, region=tile_rect(layout, ratio, len(speakers), index))
            except MotionCheckUnavailable as error:
                print(f"[!] {error}; skipping the composite motion check for {speaker}.")
                continue
            composite_scores[speaker] = score
            print(f"[*] Verified composite stage motion for {speaker}: frame-change score {score:.3f}")
            if score <= 0.05:
                raise RuntimeError(f"{speaker}'s tile in the composite stage appears to be static (motion score {score:.3f})")
        motion_report["animated"] = True
        motion_report["composite_score"] = composite_scores
    else:
        print("[!] No speech was found in this clip, so every participant is shown as a quiet listener.")
    (out_dir / "motion_report.json").write_text(json.dumps(motion_report, indent=2), encoding="utf-8")
    print(f"[✓] Multi-speaker Spaces Live Stage video rendered: {output} ({output.stat().st_size / (1024 * 1024):.2f} MB)")

if __name__ == "__main__":
    main()

