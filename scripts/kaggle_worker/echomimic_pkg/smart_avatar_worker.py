"""Experimental speaker-aware Kaggle worker.

The legacy EchoMimic/Wav2Lip worker remains the default workflow entrypoint.
This worker accepts one validated metadata manifest, warms the model assets
once, renders only scheduled speaking windows, and refuses missing timing.
"""

from __future__ import annotations

import json
import importlib
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from avatar_pipeline import ModelAdapter, build_timeline, render_job, validate_manifest_input, validate_timeline


def run(cmd, cwd=None):
    return subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, text=True)


def download(url: str, target: Path) -> None:
    if target.exists() and target.stat().st_size > 1000:
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    part = target.with_suffix(target.suffix + ".part")
    last = None
    for attempt in range(1, 5):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "SpacePipe-SmartAvatar/1.0"})
            with urllib.request.urlopen(request, timeout=120) as response, part.open("wb") as output:
                shutil.copyfileobj(response, output)
            if part.stat().st_size <= 1000:
                raise RuntimeError(f"downloaded input is empty: {url}")
            part.replace(target)
            return
        except Exception as exc:
            last = exc
            part.unlink(missing_ok=True)
            if attempt < 4:
                time.sleep(2 ** (attempt - 1))
    raise RuntimeError(f"could not download {url}: {last}")


class PersistentWav2LipAdapter(ModelAdapter):
    """One job-scoped, in-process Wav2Lip model session."""

    model_id = "wav2lip"

    def __init__(self, work_dir: Path):
        self.work_dir = work_dir
        self.repo = work_dir / "Wav2Lip"
        self.checkpoint = self.repo / "checkpoints" / "wav2lip_gan.pth"
        self.initialized_at = 0.0
        self.inference = None
        self.model = None
        self.device = None
        self.face_cache = {}

    def initialize(self) -> None:
        started = time.perf_counter()
        if not self.repo.exists():
            run(["git", "clone", "--depth", "1", "https://github.com/Rudrabha/Wav2Lip.git", str(self.repo)])
        self.checkpoint.parent.mkdir(parents=True, exist_ok=True)
        download("https://huggingface.co/camenduru/Wav2Lip/resolve/main/checkpoints/wav2lip_gan.pth", self.checkpoint)
        # inference.py parses CLI arguments at import time.  Supplying a
        # harmless image path lets us reuse its preprocessing and checkpoint
        # loader without invoking its process-level main().
        placeholder = self.work_dir / "wav2lip_import_placeholder.jpg"
        if not placeholder.exists():
            run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=512x512", "-frames:v", "1", str(placeholder)])
        sys.path.insert(0, str(self.repo))
        previous_argv = sys.argv[:]
        previous_cwd = Path.cwd()
        try:
            os.chdir(self.repo)
            sys.argv = ["inference.py", "--checkpoint_path", str(self.checkpoint), "--face", str(placeholder), "--audio", str(placeholder)]
            self.inference = importlib.import_module("inference")
            self.model = self.inference.load_model(str(self.checkpoint))
            self.device = self.inference.device
        finally:
            sys.argv = previous_argv
            os.chdir(previous_cwd)
        self.initialized_at = time.perf_counter() - started

    def render_segment(self, avatar: Path, audio: Path, output: Path, frames: int, fps: int, settings) -> None:
        if self.inference is None or self.model is None:
            raise RuntimeError("PersistentWav2LipAdapter.initialize() must run before render_segment()")
        cv2 = self.inference.cv2
        np = self.inference.np
        torch = self.inference.torch
        args = self.inference.args
        args.static = True
        args.fps = float(fps)
        args.wav2lip_batch_size = int(settings.get("wav2lip_batch_size", 128))
        frame = cv2.imread(str(avatar))
        if frame is None:
            raise RuntimeError(f"could not read avatar image: {avatar}")
        cache_key = str(avatar.resolve())
        if cache_key not in self.face_cache:
            detections = self.inference.face_detect([frame])
            self.face_cache[cache_key] = detections[0]
        face, coords = self.face_cache[cache_key]
        mel = self.inference.audio.melspectrogram(self.inference.audio.load_wav(str(audio), 16000))
        mel_step_size = int(self.inference.mel_step_size)
        chunks = []
        index = 0
        multiplier = 80.0 / float(fps)
        while len(chunks) < frames:
            start = int(index * multiplier)
            if start + mel_step_size > len(mel[0]):
                chunk = mel[:, max(0, len(mel[0]) - mel_step_size):]
                if chunk.shape[1] < mel_step_size:
                    chunk = np.pad(chunk, ((0, 0), (0, mel_step_size - chunk.shape[1])), mode="edge")
                chunks.append(chunk)
                if len(chunks) >= frames:
                    break
            else:
                chunks.append(mel[:, start:start + mel_step_size])
            index += 1
        chunks = chunks[:frames]

        y1, y2, x1, x2 = coords
        face_96 = cv2.resize(face, (args.img_size, args.img_size))
        output.parent.mkdir(parents=True, exist_ok=True)
        temp_avi = output.with_suffix(".avi")
        writer = cv2.VideoWriter(str(temp_avi), cv2.VideoWriter_fourcc(*"DIVX"), float(fps), (frame.shape[1], frame.shape[0]))
        if not writer.isOpened():
            raise RuntimeError("could not open Wav2Lip in-process video writer")
        try:
            batch_size = max(1, int(args.wav2lip_batch_size))
            for offset in range(0, len(chunks), batch_size):
                mel_batch = chunks[offset:offset + batch_size]
                images = np.asarray([face_96] * len(mel_batch))
                masked = images.copy()
                masked[:, args.img_size // 2:] = 0
                image_batch = np.concatenate((masked, images), axis=3) / 255.0
                image_batch = torch.FloatTensor(np.transpose(image_batch, (0, 3, 1, 2))).to(self.device)
                mel_array = np.asarray(mel_batch)[:, :, :, None]
                mel_input = torch.FloatTensor(np.transpose(mel_array, (0, 3, 1, 2))).to(self.device)
                with torch.no_grad():
                    prediction = self.model(mel_input, image_batch)
                prediction = prediction.detach().cpu().numpy().transpose(0, 2, 3, 1) * 255.0
                for rendered in prediction:
                    canvas = frame.copy()
                    rendered = cv2.resize(rendered.astype(np.uint8), (x2 - x1, y2 - y1))
                    canvas[y1:y2, x1:x2] = rendered
                    writer.write(canvas)
        finally:
            writer.release()
        run(["ffmpeg", "-y", "-v", "error", "-i", str(temp_avi), "-frames:v", str(frames), "-an", "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p", str(output)])
        temp_avi.unlink(missing_ok=True)
        if not output.exists() or output.stat().st_size < 1000:
            raise RuntimeError(f"Wav2Lip produced no usable segment: {output.name}")

    def close(self) -> None:
        self.face_cache.clear()
        self.model = None
        if self.device == "cuda":
            try:
                import torch
                torch.cuda.empty_cache()
            except Exception:
                pass


def resolve_manifest(path: Path) -> dict:
    candidates = [path, Path("manifest.json"), Path("/kaggle/working/manifest.json")]
    for candidate in candidates:
        if candidate.exists():
            data = json.loads(candidate.read_text(encoding="utf-8"))
            validate_timeline(data) if "duration_frames" in data else validate_manifest_input(data)
            return data
    raise RuntimeError("smart renderer manifest.json was not staged")


def main() -> None:
    root = Path("/kaggle/working") if Path("/kaggle/working").exists() else Path("smart_avatar_work")
    root.mkdir(parents=True, exist_ok=True)
    out_dir = root / "avatar_output"
    out_dir.mkdir(parents=True, exist_ok=True)
    status = out_dir / "status.json"

    def write_status(stage: str, **extra):
        status.write_text(json.dumps({"stage": stage, "updated_at": time.time(), **extra}, indent=2), encoding="utf-8")
        print(f"[smart-avatar] {stage}")

    try:
        write_status("inputs_validated")
        manifest_path = Path(os.environ.get("JOB_MANIFEST_PATH", "manifest.json"))
        raw = resolve_manifest(manifest_path)
        if raw.get("schema") != "spacepipe.avatar.timeline.v1":
            raise RuntimeError("unsupported smart avatar manifest schema")
        if not raw.get("intervals"):
            raise RuntimeError("smart avatar render requires verified speaker intervals")

        audio_ref = raw["source_audio"].get("url") or raw["source_audio"].get("path")
        audio_path = root / "source_audio"
        if str(audio_ref).startswith("http"):
            download(str(audio_ref), audio_path)
        else:
            shutil.copy2(str(audio_ref), audio_path)

        speakers = []
        for index, speaker in enumerate(raw.get("speakers", [])):
            avatar_ref = speaker.get("avatar", {}).get("url") or speaker.get("avatar", {}).get("path")
            avatar_path = root / f"avatar_{index}.jpg"
            if str(avatar_ref).startswith("http"):
                download(str(avatar_ref), avatar_path)
            else:
                shutil.copy2(str(avatar_ref), avatar_path)
            speakers.append({"id": speaker["id"], "name": speaker["name"], "avatar": {"path": str(avatar_path)}})

        duration = float(raw["duration_seconds"])
        ratio = raw.get("output", {}).get("aspect_ratio", "9:16")
        dimensions = {"9:16": (1080, 1920), "1:1": (1080, 1080), "16:9": (1920, 1080)}.get(ratio, (1080, 1920))
        timeline = build_timeline(
            duration_seconds=duration, fps=int(raw.get("fps", 25)),
            source_audio={"path": str(audio_path), "reference": audio_ref}, speakers=speakers,
            intervals=raw["intervals"], layout=raw.get("layout", "stage_grid"),
            output={"width": dimensions[0], "height": dimensions[1], "pix_fmt": "yuv420p"},
            model=raw.get("render", {}).get("model"), render=raw.get("render", {}).get("settings"),
        )
        (root / "timeline.normalized.json").write_text(json.dumps(timeline, indent=2), encoding="utf-8")
        write_status("gpu_worker_started")
        adapter = PersistentWav2LipAdapter(root)
        write_status("model_initializing")
        report = render_job(timeline, adapter, root / "segments")
        write_status("speaking_segments_generated", segment_count=report["segment_count"])
        write_status("participant_timelines_assembled", frame_count=report["frame_count"])
        write_status("final_video_encoded")
        if report["frame_count"] != timeline["duration_frames"] or not report["audio_preserved"]:
            raise RuntimeError("smart renderer quality checks failed: frame or audio contract mismatch")
        write_status("quality_checks_passed")
        write_status("video_available", report=report)
        shutil.copy2(report["output"], out_dir / "talking_avatar_short.mp4")
        (out_dir / "motion_report.json").write_text(json.dumps({"verified_by": "render_job", "animated": True, "segment_count": report["segment_count"]}, indent=2), encoding="utf-8")
    except Exception as exc:
        write_status("job_failed", error=str(exc))
        raise


if __name__ == "__main__":
    main()
