#!/usr/bin/env python3
"""Speaker-aware avatar rendering primitives.

The module is intentionally dependency-light.  It is used by the local test
harness and copied into the Kaggle package by the experimental workflow.
Integer frame positions are the authoritative representation after manifest
validation; seconds are retained only for auditability and source mapping.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

SCHEMA_VERSION = "spacepipe.avatar.timeline.v1"
DEFAULT_SETTINGS = {
    "merge_gap_seconds": 0.45,
    "pre_roll_seconds": 0.12,
    "post_roll_seconds": 0.16,
    "idle_mode": "still",
    "transition_frames": 3,
}


def _number(value: Any, field: str) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field} must be numeric") from None
    if not math.isfinite(result):
        raise ValueError(f"{field} must be finite")
    return result


def frame_bounds(start_seconds: float, end_seconds: float, fps: int) -> Tuple[int, int]:
    if fps <= 0:
        raise ValueError("fps must be positive")
    start = max(0.0, _number(start_seconds, "start_seconds"))
    end = max(start, _number(end_seconds, "end_seconds"))
    return math.floor(start * fps + 1e-9), math.ceil(end * fps - 1e-9)


def stable_speaker_id(name: str, index: int = 0) -> str:
    normalized = "".join(ch.lower() if ch.isalnum() else "-" for ch in str(name).strip()).strip("-")
    return normalized or f"speaker-{index + 1}"


def clip_relative_intervals(
    turns: Iterable[Mapping[str, Any]],
    clip_start: float,
    clip_end: float,
    fps: int,
    speakers: Sequence[Mapping[str, Any]],
) -> List[Dict[str, Any]]:
    """Clip episode turns without inventing timing for missing speakers."""
    clip_start = max(0.0, _number(clip_start, "clip_start"))
    clip_end = max(clip_start, _number(clip_end, "clip_end"))
    by_name = {str(s.get("name", "")).casefold(): str(s["id"]) for s in speakers}
    out: List[Dict[str, Any]] = []
    for index, turn in enumerate(turns):
        name = str(turn.get("speaker", turn.get("speaker_name", ""))).strip()
        speaker_id = str(turn.get("speaker_id", "")) or by_name.get(name.casefold())
        if not speaker_id:
            continue
        start = max(clip_start, _number(turn.get("start", 0), "turn.start"))
        end = min(clip_end, _number(turn.get("end", start), "turn.end"))
        if end <= start:
            continue
        rel_start, rel_end = start - clip_start, end - clip_start
        start_frame, end_frame = frame_bounds(rel_start, rel_end, fps)
        if end_frame <= start_frame:
            continue
        out.append({
            "id": str(turn.get("id") or f"turn-{index + 1}"),
            "speaker_id": speaker_id,
            "speaker": name or speaker_id,
            "start_seconds": round(rel_start, 6),
            "end_seconds": round(rel_end, 6),
            "start_frame": start_frame,
            "end_frame": end_frame,
            "confidence": turn.get("confidence"),
            "verified": bool(turn.get("verified", False)),
        })
    return sorted(out, key=lambda x: (x["start_frame"], x["end_frame"], x["speaker_id"]))


def _merge_frame_intervals(intervals: Sequence[Tuple[int, int]], max_gap_frames: int) -> List[Tuple[int, int]]:
    merged: List[Tuple[int, int]] = []
    for start, end in sorted(intervals):
        if end <= start:
            continue
        if merged and start - merged[-1][1] <= max_gap_frames:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def build_render_schedule(
    timeline: Mapping[str, Any],
    settings: Optional[Mapping[str, Any]] = None,
) -> Dict[str, List[Dict[str, Any]]]:
    """Build deterministic padded/merged segment plans by stable speaker id."""
    cfg = dict(DEFAULT_SETTINGS)
    cfg.update(settings or timeline.get("render", {}).get("settings", {}))
    fps = int(timeline["fps"])
    duration_frames = int(timeline["duration_frames"])
    merge_gap = max(0, round(float(cfg["merge_gap_seconds"]) * fps))
    pre = max(0, round(float(cfg["pre_roll_seconds"]) * fps))
    post = max(0, round(float(cfg["post_roll_seconds"]) * fps))
    by_speaker: Dict[str, List[Dict[str, Any]]] = {str(s["id"]): [] for s in timeline["speakers"]}
    for interval in timeline["intervals"]:
        by_speaker.setdefault(str(interval["speaker_id"]), []).append(interval)
    schedule: Dict[str, List[Dict[str, Any]]] = {}
    for speaker_id in [str(s["id"]) for s in timeline["speakers"]]:
        source = by_speaker.get(speaker_id, [])
        merged = _merge_frame_intervals(
            [(int(item["start_frame"]), int(item["end_frame"])) for item in source],
            merge_gap,
        )
        plans: List[Dict[str, Any]] = []
        for index, (visible_start, visible_end) in enumerate(merged):
            render_start = max(0, visible_start - pre)
            render_end = min(duration_frames, visible_end + post)
            plans.append({
                "segment_id": f"{speaker_id}-segment-{index + 1}",
                "speaker_id": speaker_id,
                "visible_start_frame": visible_start,
                "visible_end_frame": visible_end,
                "render_start_frame": render_start,
                "render_end_frame": render_end,
                "render_start_seconds": render_start / fps,
                "render_end_seconds": render_end / fps,
                "visible_start_seconds": visible_start / fps,
                "visible_end_seconds": visible_end / fps,
                "source_turn_ids": [item["id"] for item in source if int(item["end_frame"]) > visible_start and int(item["start_frame"]) < visible_end],
            })
        schedule[speaker_id] = plans
    return schedule


def build_timeline(
    *,
    duration_seconds: float,
    fps: int,
    source_audio: Mapping[str, Any],
    speakers: Sequence[Mapping[str, Any]],
    intervals: Sequence[Mapping[str, Any]],
    layout: str = "stage_grid",
    output: Optional[Mapping[str, Any]] = None,
    model: Optional[Mapping[str, Any]] = None,
    render: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    duration_seconds = _number(duration_seconds, "duration_seconds")
    if duration_seconds <= 0 or fps <= 0:
        raise ValueError("duration_seconds and fps must be positive")
    duration_frames = math.ceil(duration_seconds * fps - 1e-9)
    normalized_speakers = []
    seen = set()
    for index, speaker in enumerate(speakers):
        name = str(speaker.get("name", "")).strip()
        speaker_id = str(speaker.get("id") or stable_speaker_id(name, index))
        if not name or speaker_id in seen:
            raise ValueError("speakers require unique ids and non-empty names")
        seen.add(speaker_id)
        normalized_speakers.append({"id": speaker_id, "name": name, "avatar": speaker.get("avatar", {})})
    normalized_intervals = []
    for index, value in enumerate(intervals):
        speaker_id = str(value.get("speaker_id", ""))
        if speaker_id not in seen:
            raise ValueError(f"interval {index} references unknown speaker {speaker_id}")
        start = max(0.0, _number(value.get("start_seconds", value.get("start", 0)), "interval.start"))
        end = min(duration_seconds, _number(value.get("end_seconds", value.get("end", 0)), "interval.end"))
        if end <= start:
            raise ValueError(f"interval {index} must have end > start")
        start_frame, end_frame = frame_bounds(start, end, fps)
        normalized_intervals.append({
            "id": str(value.get("id") or f"turn-{index + 1}"),
            "speaker_id": speaker_id,
            "speaker": str(value.get("speaker", next(s["name"] for s in normalized_speakers if s["id"] == speaker_id))),
            "start_seconds": start,
            "end_seconds": end,
            "start_frame": start_frame,
            "end_frame": min(duration_frames, end_frame),
            "confidence": value.get("confidence"),
            "verified": bool(value.get("verified", False)),
        })
    timeline = {
        "schema": SCHEMA_VERSION,
        "duration_seconds": duration_seconds,
        "duration_frames": duration_frames,
        "fps": int(fps),
        "source_audio": dict(source_audio),
        "speakers": normalized_speakers,
        "intervals": sorted(normalized_intervals, key=lambda x: (x["start_frame"], x["speaker_id"])),
        "layout": layout,
        "output": dict(output or {"width": 1080, "height": 1920, "pix_fmt": "yuv420p"}),
        "render": {
            "model": dict(model or {"id": "wav2lip", "version": "baseline"}),
            "settings": {**DEFAULT_SETTINGS, **dict(render or {})},
        },
    }
    validate_timeline(timeline)
    timeline["schedule"] = build_render_schedule(timeline)
    return timeline


def validate_timeline(timeline: Mapping[str, Any]) -> None:
    if timeline.get("schema") != SCHEMA_VERSION:
        raise ValueError(f"unsupported timeline schema: {timeline.get('schema')}")
    fps = int(timeline.get("fps", 0))
    duration_frames = int(timeline.get("duration_frames", 0))
    duration = float(timeline.get("duration_seconds", 0))
    if fps <= 0 or duration <= 0 or duration_frames != math.ceil(duration * fps - 1e-9):
        raise ValueError("duration/fps/frame contract is invalid")
    ids = [str(s.get("id", "")) for s in timeline.get("speakers", [])]
    if not ids or len(ids) != len(set(ids)):
        raise ValueError("timeline requires unique speakers")
    for interval in timeline.get("intervals", []):
        start_frame, end_frame = int(interval["start_frame"]), int(interval["end_frame"])
        expected = frame_bounds(interval["start_seconds"], interval["end_seconds"], fps)
        if (start_frame, end_frame) != (expected[0], min(duration_frames, expected[1])):
            raise ValueError(f"interval {interval.get('id')} has inconsistent frame bounds")
        if not (0 <= start_frame < end_frame <= duration_frames):
            raise ValueError(f"interval {interval.get('id')} is outside clip frame range")
    for speaker in timeline["speakers"]:
        avatar = speaker.get("avatar", {})
        if not avatar or not avatar.get("url") and not avatar.get("path"):
            raise ValueError(f"speaker {speaker['id']} has no avatar reference")


def validate_manifest_input(manifest: Mapping[str, Any]) -> None:
    """Validate the small dispatch manifest before normalization or GPU work."""
    if manifest.get("schema") != SCHEMA_VERSION:
        raise ValueError("unsupported avatar manifest schema")
    duration = _number(manifest.get("duration_seconds"), "duration_seconds")
    fps = int(manifest.get("fps", 0))
    if duration <= 0 or fps <= 0:
        raise ValueError("manifest duration_seconds and fps must be positive")
    speakers = manifest.get("speakers")
    if not isinstance(speakers, list) or not speakers:
        raise ValueError("manifest requires speakers")
    ids = [str(item.get("id", "")) for item in speakers]
    if any(not item for item in ids) or len(ids) != len(set(ids)):
        raise ValueError("manifest speaker ids must be unique")
    if any(not (item.get("avatar", {}).get("url") or item.get("avatar", {}).get("path")) for item in speakers):
        raise ValueError("manifest requires an avatar reference for every speaker")
    intervals = manifest.get("intervals")
    if not isinstance(intervals, list) or not intervals:
        raise ValueError("manifest requires at least one verified speaking interval")
    for item in intervals:
        start = _number(item.get("start_seconds"), "interval.start_seconds")
        end = _number(item.get("end_seconds"), "interval.end_seconds")
        if item.get("speaker_id") not in ids or start < 0 or end <= start or end > duration:
            raise ValueError("manifest interval is invalid or references an unknown speaker")


def _run(cmd: Sequence[str], *, capture: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, text=True, capture_output=capture)


def ffprobe_duration(path: Path) -> float:
    result = _run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)], capture=True)
    return float(result.stdout.strip())


def ffprobe_frames(path: Path) -> int:
    result = _run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "default=nw=1:nk=1", str(path)], capture=True)
    return int(result.stdout.strip())


def stream_hash(path: Path) -> str:
    result = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-map", "0:a:0", "-c", "copy", "-f", "data", "-"], check=True, capture_output=True)
    return hashlib.sha256(result.stdout).hexdigest()


class ModelAdapter:
    model_id = "adapter"

    def initialize(self) -> None:
        pass

    def render_segment(self, avatar: Path, audio: Path, output: Path, frames: int, fps: int, settings: Mapping[str, Any]) -> None:
        raise NotImplementedError

    def close(self) -> None:
        pass


class MockModelAdapter(ModelAdapter):
    """Deterministic local adapter: moving mouth bar proves animation occurred."""

    model_id = "mock-avatar"

    def render_segment(self, avatar: Path, audio: Path, output: Path, frames: int, fps: int, settings: Mapping[str, Any]) -> None:
        color = settings.get("color", "0x5b21b6")
        duration = frames / fps
        _run([
            "ffmpeg", "-y", "-v", "error", "-loop", "1", "-i", str(avatar), "-f", "lavfi", "-i",
            f"color=c={color}:s=512x512:r={fps}:d={duration:.6f}", "-filter_complex",
            "[0:v]scale=512:512,format=yuv420p[portrait];[1:v]drawbox=x='180+80*sin(2*PI*t)':y=330:w=150:h=35:color=white@0.85:t=fill[bar];[portrait][bar]blend=all_mode=overlay:all_opacity=0.7[v]",
            "-map", "[v]", "-frames:v", str(frames), "-an", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(output),
        ])


def _make_idle(image: Path, output: Path, frames: int, fps: int) -> None:
    _run(["ffmpeg", "-y", "-v", "error", "-loop", "1", "-i", str(image), "-vf", f"scale=512:512,format=yuv420p", "-frames:v", str(frames), "-r", str(fps), "-an", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(output)])


def _slice_video(source: Path, output: Path, start_frame: int, frames: int, fps: int) -> None:
    _run(["ffmpeg", "-y", "-v", "error", "-i", str(source), "-vf", f"select='between(n,{start_frame},{start_frame + frames - 1})',setpts=PTS-STARTPTS", "-frames:v", str(frames), "-r", str(fps), "-an", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(output)])


def _slice_audio(source: Path, output: Path, start_frame: int, frames: int, fps: int) -> None:
    _run(["ffmpeg", "-y", "-v", "error", "-ss", f"{start_frame / fps:.6f}", "-t", f"{frames / fps:.6f}", "-i", str(source), "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(output)])


def _concat_video(parts: Sequence[Path], output: Path, frames: int, fps: int) -> None:
    list_path = output.with_suffix(".concat.txt")
    list_path.write_text("\n".join(f"file '{part.as_posix()}'" for part in parts), encoding="utf-8")
    _run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(list_path), "-frames:v", str(frames), "-r", str(fps), "-an", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(output)])
    list_path.unlink(missing_ok=True)


def assemble_speaker_timeline(
    timeline: Mapping[str, Any], speaker: Mapping[str, Any], plans: Sequence[Mapping[str, Any]], adapter: ModelAdapter, work_dir: Path,
) -> Path:
    fps = int(timeline["fps"])
    total_frames = int(timeline["duration_frames"])
    speaker_id = str(speaker["id"])
    image_ref = speaker["avatar"].get("path") or speaker["avatar"].get("url")
    image = Path(str(image_ref))
    if not image.exists():
        raise ValueError(f"local render requires avatar path for {speaker_id}: {image}")
    idle = work_dir / f"idle_{speaker_id}.mp4"
    _make_idle(image, idle, total_frames, fps)
    parts: List[Path] = []
    cursor = 0
    for plan in plans:
        start, end = int(plan["visible_start_frame"]), int(plan["visible_end_frame"])
        if start > cursor:
            gap = work_dir / f"idle_{speaker_id}_{cursor}_{start}.mp4"
            _slice_video(idle, gap, cursor, start - cursor, fps)
            parts.append(gap)
        render_start, render_end = int(plan["render_start_frame"]), int(plan["render_end_frame"])
        audio = work_dir / f"audio_{speaker_id}_{render_start}_{render_end}.wav"
        _slice_audio(Path(str(timeline["source_audio"]["path"])), audio, render_start, render_end - render_start, fps)
        active = work_dir / f"active_{speaker_id}_{render_start}_{render_end}.mp4"
        adapter.render_segment(image, audio, active, render_end - render_start, fps, timeline["render"]["settings"])
        # Context is generated for continuity but only visible frames enter the timeline.
        visible = work_dir / f"visible_{speaker_id}_{start}_{end}.mp4"
        _slice_video(active, visible, start - render_start, end - start, fps)
        parts.append(visible)
        cursor = end
    if cursor < total_frames:
        gap = work_dir / f"idle_{speaker_id}_{cursor}_{total_frames}.mp4"
        _slice_video(idle, gap, cursor, total_frames - cursor, fps)
        parts.append(gap)
    output = work_dir / f"speaker_{speaker_id}.mp4"
    _concat_video(parts or [idle], output, total_frames, fps)
    if ffprobe_frames(output) != total_frames:
        raise RuntimeError(f"speaker {speaker_id} frame count mismatch")
    return output


def compose_stage_grid(timeline: Mapping[str, Any], speaker_videos: Sequence[Path], output: Path, prompt: str = "Spaces Live Stage") -> None:
    fps = int(timeline["fps"])
    frames = int(timeline["duration_frames"])
    width, height = int(timeline["output"].get("width", 1080)), int(timeline["output"].get("height", 1920))
    cols = 2 if len(speaker_videos) <= 4 else 3
    rows = max(1, math.ceil(len(speaker_videos) / cols))
    tile_w = max(160, (width // cols) // 2 * 2)
    tile_h = max(140, ((height - 140) // rows) // 2 * 2)
    inputs: List[str] = ["-f", "lavfi", "-i", f"color=c=0x0b0f19:s={width}x{height}:r={fps}:d={frames / fps:.6f}"]
    for video in speaker_videos:
        inputs += ["-i", str(video)]
    filters = ["[0:v]format=yuv420p[base]"]
    last = "base"
    for index, _video in enumerate(speaker_videos):
        row, col = divmod(index, cols)
        tile = f"tile{index}"
        speaker_id = str(timeline["speakers"][index]["id"])
        active_windows = [f"between(t,{float(item['start_seconds']):.6f},{float(item['end_seconds']):.6f})" for item in timeline.get("intervals", []) if str(item.get("speaker_id")) == speaker_id]
        active = "+".join(active_windows) or "0"
        filters.append(f"[{index + 1}:v]fps={fps},scale={tile_w}:{tile_h}:force_original_aspect_ratio=decrease,pad={tile_w}:{tile_h}:(ow-iw)/2:(oh-ih)/2:color=0x111827,drawbox=x=0:y=0:w=iw-1:h=ih-1:color=0x10b981:t=8:enable='{active}'[{tile}]")
        filters.append(f"[{last}][{tile}]overlay={col * tile_w}:{row * tile_h}:shortest=1[stage{index}]")
        last = f"stage{index}"
    font_candidates = [os.environ.get("AVATAR_FONT_FILE", ""), "C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
    font = next((candidate for candidate in font_candidates if candidate and Path(candidate).exists()), "")
    caption = f"[{last}]drawbox=y={height - 140}:w={width}:h=140:color=0x020617@0.95:t=fill"
    if font:
        safe_prompt = prompt.replace("\\", "\\\\").replace("'", "\\'").replace(":", "\\:")
        ff_font = font.replace('\\', '/').replace(':', '\\:')
        caption += f",drawtext=fontfile='{ff_font}':text='{safe_prompt}':fontcolor=white:fontsize=28:x=(w-text_w)/2:y={height - 90}"
    filters.append(caption + "[outv]")
    # Master audio is mapped separately by render_job; this function creates video only.
    _run(["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", ";".join(filters), "-map", "[outv]", "-frames:v", str(frames), "-r", str(fps), "-an", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(output)])
    if ffprobe_frames(output) != frames:
        raise RuntimeError("stage grid frame count mismatch")


def render_job(timeline: Mapping[str, Any], adapter: ModelAdapter, work_dir: Path) -> Dict[str, Any]:
    validate_timeline(timeline)
    work_dir.mkdir(parents=True, exist_ok=True)
    schedule = timeline.get("schedule") or build_render_schedule(timeline)
    started = time.perf_counter()
    adapter.initialize()
    speaker_outputs: List[Path] = []
    segment_count = 0
    try:
        for speaker in timeline["speakers"]:
            speaker_id = str(speaker["id"])
            plans = schedule.get(speaker_id, [])
            segment_count += len(plans)
            speaker_outputs.append(assemble_speaker_timeline(timeline, speaker, plans, adapter, work_dir))
    finally:
        adapter.close()
    video_only = work_dir / "stage_grid_video.mp4"
    compose_stage_grid(timeline, speaker_outputs, video_only, timeline.get("prompt", "Spaces Live Stage"))
    source_audio = Path(str(timeline["source_audio"].get("path", "")))
    if not source_audio.exists():
        raise ValueError("render_job requires source_audio.path for local execution")
    output = work_dir / "talking_avatar_smart.mp4"
    _run(["ffmpeg", "-y", "-v", "error", "-i", str(video_only), "-i", str(source_audio), "-map", "0:v:0", "-map", "1:a:0", "-frames:v", str(timeline["duration_frames"]), "-c:v", "copy", "-c:a", "copy", "-shortest", str(output)])
    report = {
        "schema": SCHEMA_VERSION,
        "output": str(output),
        "duration_seconds": ffprobe_duration(output),
        "frame_count": ffprobe_frames(output),
        "target_frames": int(timeline["duration_frames"]),
        "segment_count": segment_count,
        "active_speaker_seconds": sum(float(item["end_seconds"]) - float(item["start_seconds"]) for item in timeline["intervals"]),
        "full_length_baseline_seconds": len(timeline["speakers"]) * float(timeline["duration_seconds"]),
        "elapsed_seconds": time.perf_counter() - started,
        "audio_stream_hash": stream_hash(output),
        "source_audio_stream_hash": stream_hash(source_audio),
        "audio_preserved": stream_hash(output) == stream_hash(source_audio),
    }
    (work_dir / "render_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--validate", type=Path)
    parser.add_argument("--schedule", type=Path)
    args = parser.parse_args()
    if args.validate:
        data = json.loads(args.validate.read_text(encoding="utf-8"))
        validate_timeline(data) if "duration_frames" in data else validate_manifest_input(data)
        target_frames = data.get("duration_frames") or math.ceil(float(data["duration_seconds"]) * int(data["fps"]))
        print(json.dumps({"ok": True, "schema": data["schema"], "target_frames": target_frames}))
    elif args.schedule:
        data = json.loads(args.schedule.read_text(encoding="utf-8"))
        validate_timeline(data)
        print(json.dumps(build_render_schedule(data), indent=2))


if __name__ == "__main__":
    main()
