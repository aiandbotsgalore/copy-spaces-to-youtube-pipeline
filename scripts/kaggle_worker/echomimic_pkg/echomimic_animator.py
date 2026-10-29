#!/usr/bin/env python3
"""
Cloud worker for the Spaces Live Stage avatar render.

The workflow dispatches this packaged worker (rather than the older root-level
prototype). It renders one Wav2Lip stream per participating speaker, mutes that
stream outside the speaker's transcript turns, and composites all streams into
a stage grid or split-screen layout.
"""

import json
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


def run_cmd(cmd, check=True, cwd=None):
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


def escape_drawtext(value: str) -> str:
    """Escape text for ffmpeg's drawtext=text='...' expression."""
    return (
        str(value or "")
        .replace("\\", r"\\")
        .replace("'", r"\'")
        .replace(":", r"\:")
        .replace("%", r"\%")
        .replace("[", r"\[")
        .replace("]", r"\]")
        .replace("\n", " ")
    )


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
                start = max(0.0, min(duration, float(value.get("start", 0))))
                end = max(0.0, min(duration, float(value.get("end", start))))
            except (TypeError, ValueError):
                continue
            if end > start:
                intervals[canonical].append((start, end))
    for name in intervals:
        intervals[name].sort()
    return intervals


def build_fallback_intervals(speakers: List[str], duration: float) -> Dict[str, List[Tuple[float, float]]]:
    """Keep every participant visible when the source transcript is unavailable."""
    if not speakers or duration <= 0:
        return {name: [] for name in speakers}
    slice_length = duration / len(speakers)
    return {
        name: [(index * slice_length, duration if index == len(speakers) - 1 else (index + 1) * slice_length)]
        for index, name in enumerate(speakers)
    }


def run_ffprobe_duration(path: Path) -> float:
    result = run_cmd(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        check=False,
    )
    try:
        return max(0.1, float(result.stdout.strip()))
    except (TypeError, ValueError):
        return 1.0


def patch_wav2lip(repo_dir: Path):
    """Patch modern PyTorch and NumPy compatibility issues in Wav2Lip."""
    for py_file in repo_dir.rglob("*.py"):
        try:
            content = py_file.read_text(encoding="utf-8")
            modified = False
            for old, new in {
                "from torchvision.models.utils import load_state_dict_from_url": "from torch.hub import load_state_dict_from_url",
                "checkpoint = torch.load(checkpoint_path)": "checkpoint = torch.load(checkpoint_path, weights_only=False)",
                "librosa.filters.mel(hp.sample_rate, hp.n_fft, n_mels=hp.num_mels,": "librosa.filters.mel(sr=hp.sample_rate, n_fft=hp.n_fft, n_mels=hp.num_mels,",
            }.items():
                if old in content:
                    content = content.replace(old, new)
                    modified = True
            for pattern, replacement in (
                (r"\bnp\.float\b", "float"),
                (r"\bnp\.int\b", "int"),
                (r"\bnp\.complex\b", "complex"),
            ):
                patched = re.sub(pattern, replacement, content)
                modified = modified or patched != content
                content = patched
            if modified:
                py_file.write_text(content, encoding="utf-8")
        except OSError:
            continue


def prepare_wav2lip(work_dir: Path) -> Tuple[Path, Path]:
    wav2lip_dir = work_dir / "Wav2Lip"
    if not wav2lip_dir.exists():
        run_cmd(["git", "clone", "--depth", "1", "https://github.com/Rudrabha/Wav2Lip.git", str(wav2lip_dir)])
    patch_wav2lip(wav2lip_dir)

    checkpoints_dir = wav2lip_dir / "checkpoints"
    checkpoints_dir.mkdir(parents=True, exist_ok=True)
    face_detect_dir = wav2lip_dir / "face_detection/detection/sfd"
    face_detect_dir.mkdir(parents=True, exist_ok=True)
    wav2lip_model = checkpoints_dir / "wav2lip_gan.pth"
    s3fd_model = face_detect_dir / "s3fd.pth"
    download_file("https://huggingface.co/camenduru/Wav2Lip/resolve/main/checkpoints/wav2lip_gan.pth", wav2lip_model, min_size=100_000_000)
    download_file("https://www.adrianbulat.com/downloads/python-fan/s3fd-619a316812.pth", s3fd_model, min_size=1_000_000)
    return wav2lip_dir, wav2lip_model


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


def render_talking_avatar(wav2lip_dir: Path, checkpoint: Path, image: Path, audio: Path, output: Path):
    command = [
        sys.executable, "inference.py", "--checkpoint_path", str(checkpoint),
        "--face", str(image), "--audio", str(audio), "--outfile", str(output),
        "--pads", "0", "10", "0", "0", "--resize_factor", "1",
    ]
    run_cmd(command, cwd=str(wav2lip_dir))
    if not output.exists() or output.stat().st_size < 10_000:
        raise RuntimeError(f"Wav2Lip produced no usable video for {image.name}")


def motion_score(path: Path, active_intervals: List[Tuple[float, float]] | None = None) -> float:
    """Return mouth-region frame change during speaking time."""
    trim = ""
    if active_intervals:
        start = min(interval[0] for interval in active_intervals)
        end = max(interval[1] for interval in active_intervals)
        trim = f"trim=start={start:.3f}:end={end:.3f},setpts=PTS-STARTPTS,"
    result = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-vf", f"{trim}fps=5,crop=iw*0.6:ih*0.35:iw*0.2:ih*0.42,scale=96:56,format=gray", "-f", "rawvideo", "-"],
        capture_output=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Could not inspect generated motion in {path.name}")
    frames = np.frombuffer(result.stdout, dtype=np.uint8)
    frame_size = 96 * 56
    if frames.size < frame_size * 2:
        raise RuntimeError(f"Generated video is too short to verify motion: {path.name}")
    frames = frames[: frames.size // frame_size * frame_size].reshape(-1, 56, 96)
    return float(np.abs(np.diff(frames.astype(np.float32), axis=0)).mean())


def canvas_for_ratio(ratio: str) -> Tuple[int, int]:
    return {"1:1": (1080, 1080), "16:9": (1920, 1080)}.get(ratio, (1080, 1920))


def layout_geometry(layout: str, ratio: str, speaker_count: int):
    width, height = canvas_for_ratio(ratio)
    caption_height = max(180, round(height * 0.22))
    stage_height = height - caption_height
    margin = max(20, round(width * 0.025))
    if layout == "split_screen":
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


def compose_stage(output: Path, audio: Path, videos: List[Path], speakers: List[str], intervals: Dict[str, List[Tuple[float, float]]], prompt: str, layout: str, ratio: str, duration: float):
    width, height, caption_height, margin, cols, tile_width, tile_height = layout_geometry(layout, ratio, len(speakers))
    font_file = os.environ.get("AVATAR_FONT_FILE", "")
    if not font_file:
        linux_font = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
        if linux_font.exists():
            font_file = str(linux_font)
    font_option = f"fontfile='{escape_drawtext(font_file)}':" if font_file else ""
    inputs = ["-f", "lavfi", "-i", f"color=c=0x0b0f19:s={width}x{height}:r=25:d={duration:.3f}"]
    for video in videos:
        inputs.extend(["-i", str(video)])
    inputs.extend(["-i", str(audio)])

    filters = ["[0:v]format=yuv420p[base]"]
    last = "base"
    for index, speaker in enumerate(speakers):
        row, col = divmod(index, cols)
        x = margin + col * (tile_width + margin)
        y = margin + row * (tile_height + margin)
        active = "+".join(f"between(t,{start:.3f},{end:.3f})" for start, end in intervals.get(speaker, [])) or "0"
        tile = f"tile{index}"
        filters.append(
            f"[{index + 1}:v]fps=25,scale={tile_width}:{tile_height}:force_original_aspect_ratio=decrease,"
            f"pad={tile_width}:{tile_height}:(ow-iw)/2:(oh-ih)/2:color=0x111827,"
            f"drawbox=x=0:y=0:w=iw-1:h=ih-1:color=0x334155:t=8,"
            f"drawbox=x=0:y=0:w=iw-1:h=ih-1:color=0x10b981:t=12:enable='{active}',"
            f"drawtext=text='{escape_drawtext(speaker)}':{font_option}fontcolor=white:fontsize={max(18, tile_width // 22)}:x=(w-text_w)/2:y=h-45:shadowcolor=black:shadowx=2:shadowy=2[{tile}]"
        )
        filters.append(f"[{last}][{tile}]overlay={x}:{y}:shortest=1[stage{index}]")
        last = f"stage{index}"

    filters.append(
        f"[{last}]drawbox=y={height - caption_height}:w={width}:h={caption_height}:color=0x020617@0.92:t=fill,"
        f"drawtext=text='SPACES LIVE STAGE':{font_option}fontcolor=0xa855f7:fontsize={max(22, width // 45)}:x=(w-text_w)/2:y={height - caption_height + 28}:shadowcolor=black:shadowx=2:shadowy=2,"
        f"drawtext=text='{escape_drawtext(prompt[:90])}':{font_option}fontcolor=white:fontsize={max(20, width // 52)}:x=(w-text_w)/2:y={height - caption_height + 85}:shadowcolor=black:shadowx=2:shadowy=2[outv]"
    )

    run_cmd([
        "ffmpeg", "-y", *inputs, "-filter_complex", ";".join(filters),
        "-map", "[outv]", "-map", f"{len(videos) + 1}:a", "-t", f"{duration:.3f}",
        "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-shortest", str(output),
    ])


def main():
    print("=" * 70)
    print("    SPACES LIVE STAGE MULTI-SPEAKER AVATAR GENERATOR")
    print("    Wav2Lip streams + transcript-timed stage compositing")
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
    intervals = parse_segments(raw_segments, speakers, duration)
    if not any(intervals.values()):
        print("[!] No transcript turns were supplied; using round-robin speaker timing fallback.")
        intervals = build_fallback_intervals(speakers, duration)
    print(f"[*] Rendering {len(speakers)} speakers across {duration:.2f}s ({layout}, {ratio})")

    wav2lip_dir, checkpoint = prepare_wav2lip(work_dir)

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
                print(f"[!] Avatar download failed for {speaker}: {error}")
        elif isinstance(url, str) and Path(url).exists():
            shutil.copy2(url, avatar)
        if not avatar.exists() or avatar.stat().st_size < 1000:
            raise RuntimeError(f"No valid avatar image was available for {speaker}")
        face = work_dir / f"face_{index}_{slug(speaker)}.jpg"
        run_cmd(["ffmpeg", "-y", "-i", str(avatar), "-vf", "scale=512:512:force_original_aspect_ratio=increase,crop=512:512", "-frames:v", "1", str(face)])
        avatar_files[speaker] = face

    rendered_videos: List[Path] = []
    motion_report = {"animated": False, "speakers": {}, "composite_score": None}
    for speaker in speakers:
        speaker_audio = work_dir / f"audio_{slug(speaker)}.wav"
        video = work_dir / f"talking_{slug(speaker)}.mp4"
        if not build_speaker_audio(norm_audio, speaker_audio, intervals.get(speaker, [])):
            raise RuntimeError(f"No speaking audio interval was created for {speaker}")
        render_talking_avatar(wav2lip_dir, checkpoint, avatar_files[speaker], speaker_audio, video)
        score = motion_score(video, intervals.get(speaker, []))
        static_probe = work_dir / f"static_probe_{slug(speaker)}.mp4"
        render_static_avatar(avatar_files[speaker], static_probe, duration)
        baseline = motion_score(static_probe, intervals.get(speaker, []))
        print(f"[*] Verified motion for {speaker}: {score:.3f} (static baseline {baseline:.3f})")
        if score <= baseline + 0.01:
            raise RuntimeError(
                f"Generated video for {speaker} appears to be a still image "
                f"(motion {score:.3f}, static baseline {baseline:.3f})"
            )
        motion_report["speakers"][speaker] = {"motion_score": score, "static_baseline": baseline}
        rendered_videos.append(video)

    output = out_dir / "talking_avatar_short.mp4"
    compose_stage(output, norm_audio, rendered_videos, speakers, intervals, prompt, layout, ratio, duration)
    composite_score = motion_score(output)
    print(f"[*] Verified composite stage motion: frame-change score {composite_score:.3f}")
    if composite_score <= 0.01:
        raise RuntimeError(f"Composite stage video appears to be static (motion score {composite_score:.3f})")
    motion_report["animated"] = True
    motion_report["composite_score"] = composite_score
    (out_dir / "motion_report.json").write_text(json.dumps(motion_report, indent=2), encoding="utf-8")
    print(f"[✓] Multi-speaker Spaces Live Stage video rendered: {output} ({output.stat().st_size / (1024 * 1024):.2f} MB)")

if __name__ == "__main__":
    main()

