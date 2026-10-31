"""
Tests for the Spaces Live Stage worker: only the speaker who is talking moves and is highlighted,
silent participants stay on stage as quiet listeners, and a clip with no transcript turns falls back
to detected speech for the primary speaker only.

Run: python -m pytest scripts/kaggle_worker/tests -q   (needs numpy and ffmpeg on PATH)
"""
import importlib.util
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

WORKER = Path(__file__).resolve().parents[1] / "echomimic_pkg" / "echomimic_animator.py"
spec = importlib.util.spec_from_file_location("echomimic_animator", WORKER)
animator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(animator)

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is not on PATH")


def tone_and_silence_wav(path: Path, pattern, rate: int = 16000, channels: int = 1):
    """pattern: list of (seconds, is_tone). Writes a WAV at the given rate and channel count."""
    chunks = []
    for seconds, is_tone in pattern:
        t = np.arange(int(seconds * rate)) / rate
        chunks.append(0.5 * np.sin(2 * np.pi * 220 * t) if is_tone else np.zeros_like(t))
    data = (np.concatenate(chunks) * 32767).astype(np.int16)
    raw = path.with_suffix(".raw")
    raw.write_bytes(data.tobytes())
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ar", str(rate), "-ac", "1", "-i", str(raw),
                    "-ac", str(channels), str(path)], check=True)
    raw.unlink()


def probe_media(path: Path) -> dict:
    """ffprobe streams plus the frame count of the first video stream."""
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    )
    return json.loads(result.stdout)


# ---------------------------------------------------------------- timing


def test_round_robin_fallback_is_gone():
    assert not hasattr(animator, "build_fallback_intervals")


def test_parse_silencedetect_reads_closed_and_trailing_silences():
    stderr = "\n".join([
        "[silencedetect @ 0x1] silence_start: 0",
        "[silencedetect @ 0x1] silence_end: 1.02 | silence_duration: 1.02",
        "[silencedetect @ 0x1] silence_start: 2.5",
        "[silencedetect @ 0x1] silence_end: 3.1 | silence_duration: 0.6",
        "[silencedetect @ 0x1] silence_start: 4.75",
    ])
    assert animator.parse_silencedetect(stderr, duration=6.0) == [(0.0, 1.02), (2.5, 3.1), (4.75, 6.0)]


def test_speech_is_the_gaps_between_silences():
    silences = [(0.0, 1.0), (2.5, 3.1), (4.75, 6.0)]
    assert animator.speech_from_silences(silences, duration=6.0) == [(1.0, 2.5), (3.1, 4.75)]


def test_speech_from_silences_drops_tiny_bursts_and_handles_no_silence():
    assert animator.speech_from_silences([(0.0, 1.0), (1.1, 6.0)], duration=6.0) == []
    assert animator.speech_from_silences([], duration=6.0) == [(0.0, 6.0)]


def test_segments_with_nan_or_missing_fields_are_ignored():
    raw = '[{"speaker": "Logan", "start": NaN, "end": 2}, {"speaker": "Logan", "start": 1.0, "end": Infinity}, {"speaker": "Logan", "start": 1.0, "end": 2.0}]'
    assert animator.parse_segments(raw, ["Logan"], 8.0) == {"Logan": [(1.0, 2.0)]}


@needs_ffmpeg
def test_detect_speech_intervals_finds_the_talking_parts(tmp_path):
    wav = tmp_path / "speech.wav"
    tone_and_silence_wav(wav, [(1.0, False), (1.0, True), (1.0, False), (0.6, True), (0.6, False)])
    found = animator.detect_speech_intervals(wav, duration=4.2)
    assert len(found) == 2
    (a0, a1), (b0, b1) = found
    assert abs(a0 - 1.0) < 0.1 and abs(a1 - 2.0) < 0.1
    assert abs(b0 - 3.0) < 0.1 and abs(b1 - 3.6) < 0.1


def test_transcript_turns_drive_each_speaker_and_silent_ones_stay_empty():
    segments = json.dumps([
        {"speaker": "Logan", "start": 0.0, "end": 2.0},
        {"speaker": "Angela", "start": 2.0, "end": 5.0},
        {"speaker": "logan", "start": 5.5, "end": 7.0},
    ])
    called = []
    intervals, source = animator.resolve_intervals(segments, ["Logan", "Angela", "Oor"], 8.0, vad=lambda: called.append(1) or [])
    assert source == "transcript"
    assert intervals == {"Logan": [(0.0, 2.0), (5.5, 7.0)], "Angela": [(2.0, 5.0)], "Oor": []}
    assert called == []


def test_no_transcript_turns_gives_detected_speech_to_the_primary_speaker_only():
    for raw in ("[]", "", "not json"):
        intervals, source = animator.resolve_intervals(raw, ["Logan", "Angela", "Oor"], 8.0, vad=lambda: [(1.0, 3.0), (4.0, 6.5)])
        assert source == "voice_activity"
        assert intervals == {"Logan": [(1.0, 3.0), (4.0, 6.5)], "Angela": [], "Oor": []}


def test_turns_for_people_not_on_stage_also_fall_back_to_the_primary_speaker():
    raw = json.dumps([{"speaker": "Somebody Else", "start": 0, "end": 3}])
    intervals, source = animator.resolve_intervals(raw, ["Logan", "Angela"], 8.0, vad=lambda: [(0.5, 2.0)])
    assert source == "voice_activity"
    assert intervals == {"Logan": [(0.5, 2.0)], "Angela": []}


# ---------------------------------------------------------------- per speaker render


class FakeRender:
    def __init__(self, scores):
        self.scores = scores          # path name -> motion score
        self.talking, self.static = [], []

    def talking_fn(self, image, audio, output):
        self.talking.append(output.name)
        output.write_bytes(b"x")

    def static_fn(self, image, output, duration):
        self.static.append(output.name)
        output.write_bytes(b"x")

    def audio_fn(self, source, output, intervals):
        output.write_bytes(b"x" * 2000)
        return bool(intervals)

    def score_fn(self, path, intervals=None):
        return self.scores.get(path.name, 0.0)


def test_silent_listener_gets_a_static_tile_and_no_lip_sync(tmp_path):
    fake = FakeRender({"talking_Logan.mp4": 5.0, "static_probe_Logan.mp4": 0.1})
    intervals = {"Logan": [(0.0, 2.0)], "Oor": []}
    avatars = {"Logan": tmp_path / "l.jpg", "Oor": tmp_path / "o.jpg"}
    videos, report = animator.render_speaker_tiles(
        ["Logan", "Oor"], intervals, avatars, tmp_path / "a.wav", tmp_path, 4.0,
        talking_fn=fake.talking_fn, static_fn=fake.static_fn, audio_fn=fake.audio_fn, score_fn=fake.score_fn,
    )
    assert [v.name for v in videos] == ["talking_Logan.mp4", "listening_Oor.mp4"]
    assert fake.talking == ["talking_Logan.mp4"]
    assert "listening_Oor.mp4" in fake.static
    assert report["Logan"]["role"] == "speaking"
    assert report["Oor"] == {"role": "listening", "speaking_seconds": 0.0, "motion_checked": False}


def test_a_speaker_with_turns_whose_video_does_not_move_still_fails(tmp_path):
    fake = FakeRender({"talking_Logan.mp4": 0.1, "static_probe_Logan.mp4": 0.1})
    with pytest.raises(RuntimeError, match="still image"):
        animator.render_speaker_tiles(
            ["Logan"], {"Logan": [(0.0, 2.0)]}, {"Logan": tmp_path / "l.jpg"}, tmp_path / "a.wav", tmp_path, 4.0,
            talking_fn=fake.talking_fn, static_fn=fake.static_fn, audio_fn=fake.audio_fn, score_fn=fake.score_fn,
        )


def test_a_clip_too_short_to_measure_is_reported_instead_of_failing(tmp_path):
    """A 0.1 s clip cannot yield two comparison frames; the render must not be declared broken."""
    def short_score(path, intervals=None):
        raise animator.MotionCheckUnavailable(f"Generated video is too short to verify motion: {path.name}")

    fake = FakeRender({})
    videos, report = animator.render_speaker_tiles(
        ["Logan"], {"Logan": [(0.0, 0.1)]}, {"Logan": tmp_path / "l.jpg"}, tmp_path / "a.wav", tmp_path, 0.1,
        talking_fn=fake.talking_fn, static_fn=fake.static_fn, audio_fn=fake.audio_fn, score_fn=short_score,
    )
    assert [v.name for v in videos] == ["talking_Logan.mp4"]
    assert report["Logan"]["role"] == "speaking"
    assert report["Logan"]["motion_checked"] is False
    assert "too short" in report["Logan"]["motion_note"]


def test_everyone_silent_renders_listeners_without_failing(tmp_path):
    fake = FakeRender({})
    videos, report = animator.render_speaker_tiles(
        ["Logan", "Angela"], {"Logan": [], "Angela": []}, {"Logan": tmp_path / "l.jpg", "Angela": tmp_path / "a.jpg"},
        tmp_path / "a.wav", tmp_path, 4.0,
        talking_fn=fake.talking_fn, static_fn=fake.static_fn, audio_fn=fake.audio_fn, score_fn=fake.score_fn,
    )
    assert fake.talking == []
    assert all(r["role"] == "listening" for r in report.values())
    assert len(videos) == 2


# ---------------------------------------------------------------- stage highlights


def test_highlight_and_badges_follow_only_that_speakers_turns(tmp_path):
    text_dir = tmp_path / "stage_text"
    graph = animator.build_stage_filtergraph(
        ["Logan", "Angela", "Oor"], {"Logan": [(0.0, 2.0)], "Angela": [(2.0, 5.0)], "Oor": []},
        prompt="Test O'Brien, 100% live", layout="stage_grid", ratio="9:16", font_option="",
        text_dir=text_dir,
    )
    tiles = [part for part in graph.split(";") if part.startswith("[1:v]") or part.startswith("[2:v]") or part.startswith("[3:v]")]
    logan, angela, oor = tiles
    assert "color=0x10b981:t=12:enable='between(t,0.000,2.000)'" in logan
    assert "text='Speaking'" in logan and "enable='between(t,0.000,2.000)'" in logan
    assert "between(t,2.000,5.000)" in angela and "between(t,0.000,2.000)" not in angela
    # The listener never lights up and always says Listening.
    assert "0x10b981" not in oor
    assert "text='Speaking'" not in oor
    assert "text='Listening'" in oor
    # Names and titles travel through textfile= so punctuation never reaches the filter parser.
    assert (text_dir / "name_0.txt").read_text(encoding="utf-8") == "Logan"
    assert (text_dir / "name_2.txt").read_text(encoding="utf-8") == "Oor"
    assert (text_dir / "prompt.txt").read_text(encoding="utf-8") == "Test O'Brien, 100% live"
    assert "textfile=" in graph and "O'Brien" not in graph


@needs_ffmpeg
def test_composite_lights_only_the_active_speakers_tile(tmp_path, monkeypatch):
    """Real FFmpeg render: at 1 s only tile 0 has the green border, at 3 s only tile 1."""
    for font in (Path("C:/Windows/Fonts/arial.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")):
        if font.exists():
            monkeypatch.setenv("AVATAR_FONT_FILE", str(font).replace("\\", "/"))
            break
    frames = []
    for i, color in enumerate(["red", "blue"]):
        img = tmp_path / f"face{i}.png"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c={color}:s=64x64", "-frames:v", "1", str(img)], check=True)
        video = tmp_path / f"tile{i}.mp4"
        animator.render_static_avatar(img, video, 4.0)
        frames.append(video)
    audio = tmp_path / "a.wav"
    tone_and_silence_wav(audio, [(4.0, True)])
    out = tmp_path / "stage.mp4"
    intervals = {"A": [(0.0, 2.0)], "B": [(2.5, 4.0)]}
    animator.compose_stage(out, audio, frames, ["A", "B"], intervals, "Test", "stage_grid", "1:1", 4.0)
    assert out.exists() and out.stat().st_size > 1000

    width, height, _, margin, cols, tile_w, tile_h = animator.layout_geometry("stage_grid", "1:1", 2)

    def border_is_green(t, index):
        raw = subprocess.run(
            ["ffmpeg", "-v", "error", "-ss", str(t), "-i", str(out), "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
            capture_output=True, check=True,
        ).stdout
        img = np.frombuffer(raw, dtype=np.uint8).reshape(height, width, 3)
        x = margin + index * (tile_w + margin) + tile_w // 2
        y = margin + 4  # inside the 12 px border, at the top edge of the tile
        r, g, b = (int(v) for v in img[y, x])
        return g > 150 and r < 80 and b < 160

    assert border_is_green(1.0, 0) and not border_is_green(1.0, 1)
    assert border_is_green(3.0, 1) and not border_is_green(3.0, 0)
    # Once A stops talking its border reverts to slate for the rest of the clip.
    assert not border_is_green(2.2, 0) and not border_is_green(3.9, 0)


@needs_ffmpeg
def test_motion_window_uses_the_longest_turn_and_ignores_pauses():
    # Two short turns with a long pause; measuring the gap would dilute the score.
    assert animator.motion_window([(1.0, 2.0), (20.0, 26.0)]) == (20.0, 23.0)
    assert animator.motion_window([(4.0, 4.5)]) == (4.0, 4.5)


@needs_ffmpeg
def test_motion_score_can_measure_one_tile_of_the_stage(tmp_path):
    """Left half moves, right half is still: the region score must tell them apart."""
    video = tmp_path / "half.mp4"
    subprocess.run([
        "ffmpeg", "-v", "error", "-y",
        "-f", "lavfi", "-i", "color=c=black:s=200x200:d=2:r=25,noise=alls=80:allf=t",
        "-f", "lavfi", "-i", "color=c=gray:s=200x200:d=2:r=25",
        "-filter_complex", "[0:v][1:v]hstack,format=yuv420p", str(video),
    ], check=True)
    assert animator.motion_score(video, region=(0, 0, 200, 200)) > 1.0
    assert animator.motion_score(video, region=(200, 0, 200, 200)) < 0.5


def test_tile_rect_matches_the_stage_grid():
    width, height, caption_height, margin, cols, tile_w, tile_h = animator.layout_geometry("stage_grid", "9:16", 3)
    assert animator.tile_rect("stage_grid", "9:16", 3, 0) == (margin, margin, tile_w, tile_h)
    assert animator.tile_rect("stage_grid", "9:16", 3, 2) == (margin, margin + tile_h + margin, tile_w, tile_h)


def test_solo_layout_fills_the_stage_instead_of_one_grid_cell():
    width, height, caption_height, margin, cols, tile_w, tile_h = animator.layout_geometry("solo", "9:16", 1)
    assert (cols, tile_w) == (1, width - margin * 2)
    assert tile_h > caption_height          # a closeup, not a half-width grid cell
    assert animator.tile_rect("solo", "9:16", 1, 0) == (margin, margin, tile_w, tile_h)


def run_main_with_fake_lip_sync(tmp_path, monkeypatch, segments, audio_rate: int = 16000, audio_channels: int = 1,
                                speakers=("Logan", "Angela", "Oor")):
    """Run the real main() end to end; only the Wav2Lip model is replaced by a moving test video."""
    for font in (Path("C:/Windows/Fonts/arial.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")):
        if font.exists():
            monkeypatch.setenv("AVATAR_FONT_FILE", str(font).replace("\\", "/"))
            break
    monkeypatch.chdir(tmp_path)
    face = tmp_path / "face.png"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=256x256,noise=alls=60", "-frames:v", "1", str(face)], check=True)
    audio = tmp_path / "clip.wav"
    tone_and_silence_wav(audio, [(0.5, False), (1.5, True), (0.5, False), (1.5, True)], rate=audio_rate, channels=audio_channels)
    lip_synced = []

    def fake_talking(wav2lip_dir, checkpoint, image, speech, output):
        lip_synced.append(output.name)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=512x512:d=4:r=25,noise=alls=80:allf=t",
                        "-pix_fmt", "yuv420p", str(output)], check=True)

    monkeypatch.setattr(animator, "prepare_wav2lip", lambda work_dir: (tmp_path, tmp_path / "ckpt"))
    monkeypatch.setattr(animator, "render_talking_avatar", fake_talking)
    monkeypatch.setenv("SPEECH_AUDIO", str(audio))
    monkeypatch.setenv("AVATAR_IMAGE", str(face))
    monkeypatch.setenv("SPEAKERS_JSON", json.dumps(list(speakers)))
    monkeypatch.setenv("SPEAKER_AVATARS_JSON", "{}")
    monkeypatch.setenv("SPEAKER_SEGMENTS_JSON", segments)
    monkeypatch.setenv("ASPECT_RATIO", "1:1")
    animator.main()
    out_dir = tmp_path / "kaggle_work" / "avatar_output"
    assert (out_dir / "talking_avatar_short.mp4").stat().st_size > 1000
    return json.loads((out_dir / "motion_report.json").read_text(encoding="utf-8")), lip_synced


@needs_ffmpeg
def test_main_with_transcript_turns_animates_only_speakers_and_keeps_the_listener(tmp_path, monkeypatch):
    segments = json.dumps([{"speaker": "Logan", "start": 0.5, "end": 2.0}, {"speaker": "Angela", "start": 2.5, "end": 4.0}])
    report, lip_synced = run_main_with_fake_lip_sync(tmp_path, monkeypatch, segments)
    assert report["timing_source"] == "transcript"
    assert sorted(lip_synced) == ["talking_Angela.mp4", "talking_Logan.mp4"]
    assert report["speakers"]["Logan"]["role"] == "speaking"
    assert report["speakers"]["Angela"]["role"] == "speaking"
    assert report["speakers"]["Oor"]["role"] == "listening"
    assert report["animated"] is True


@needs_ffmpeg
def test_main_without_turns_gives_detected_speech_to_the_primary_only(tmp_path, monkeypatch):
    report, lip_synced = run_main_with_fake_lip_sync(tmp_path, monkeypatch, "[]")
    assert report["timing_source"] == "voice_activity"
    assert lip_synced == ["talking_Logan.mp4"]
    assert report["speakers"]["Logan"]["role"] == "speaking"
    assert 2.5 < report["speakers"]["Logan"]["speaking_seconds"] < 3.5
    assert report["speakers"]["Angela"]["role"] == "listening"
    assert report["speakers"]["Oor"]["role"] == "listening"


@needs_ffmpeg
def test_special_characters_in_names_and_prompt_do_not_break_the_render(tmp_path, monkeypatch):
    """Apostrophes, double quotes, commas and emoji in names or the caption must not break drawtext."""
    for font in (Path("C:/Windows/Fonts/arial.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")):
        if font.exists():
            monkeypatch.setenv("AVATAR_FONT_FILE", str(font).replace("\\", "/"))
            break
    names = ["O'Brien, Jr.", 'Dr. "Who"', "Zoë 🚀"]
    videos = []
    for i, color in enumerate(["red", "blue", "green"]):
        img = tmp_path / f"face{i}.png"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c={color}:s=64x64", "-frames:v", "1", str(img)], check=True)
        video = tmp_path / f"tile{i}.mp4"
        animator.render_static_avatar(img, video, 2.0)
        videos.append(video)
    audio = tmp_path / "a.wav"
    tone_and_silence_wav(audio, [(2.0, True)])
    out = tmp_path / "stage.mp4"
    prompt = 'He said "no", didn\'t he? 100% sure - 5:1 ratio'
    animator.compose_stage(out, audio, videos, names, {"O'Brien, Jr.": [(0.0, 1.0)], 'Dr. "Who"': [], "Zoë": [(1.0, 2.0)]}, prompt, "stage_grid", "1:1", 2.0)
    assert out.exists() and out.stat().st_size > 1000


@needs_ffmpeg
def test_output_keeps_the_master_audio_and_matches_the_frame_count(tmp_path, monkeypatch):
    """The deliverable must carry the original clip audio at its own sample rate, in sync with the frames."""
    segments = json.dumps([{"speaker": "Logan", "start": 0.5, "end": 2.0}, {"speaker": "Angela", "start": 2.5, "end": 4.0}])
    run_main_with_fake_lip_sync(tmp_path, monkeypatch, segments, audio_rate=44100, audio_channels=2)
    out = tmp_path / "kaggle_work" / "avatar_output" / "talking_avatar_short.mp4"
    probe = probe_media(out)
    audio = next(s for s in probe["streams"] if s["codec_type"] == "audio")
    video = next(s for s in probe["streams"] if s["codec_type"] == "video")
    assert int(audio["sample_rate"]) == 44100
    assert int(audio["channels"]) == 2
    # 4.0 s of source audio stays 4.0 s, and 4.0 s at 25 fps is 100 frames (allow encoder rounding).
    assert abs(float(audio["duration"]) - 4.0) < 0.1
    assert abs(int(video["nb_read_frames"]) - 100) <= 1
    assert abs(float(video["duration"]) - 4.0) < 0.2


@needs_ffmpeg
def test_overlapping_speakers_both_keep_the_shared_audio(tmp_path):
    """Talking over each other must not mute or drop either speaker's syllables."""
    src = tmp_path / "src.wav"
    tone_and_silence_wav(src, [(4.0, True)])
    intervals = {"Logan": [(0.0, 2.0)], "Angela": [(1.5, 3.0)]}
    logan, angela = tmp_path / "logan.wav", tmp_path / "angela.wav"
    assert animator.build_speaker_audio(src, logan, intervals["Logan"])
    assert animator.build_speaker_audio(src, angela, intervals["Angela"])

    def levels(path):
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "s16le", "-ac", "1", "-ar", "16000", "-"],
                             capture_output=True, check=True).stdout
        return np.abs(np.frombuffer(raw, dtype=np.int16).astype(np.float32))

    rate = 16000
    logan_pcm, angela_pcm = levels(logan), levels(angela)
    # Both tracks carry the overlap, so neither speaker's words are cut off.
    for track in (logan_pcm, angela_pcm):
        assert track[int(1.6 * rate):int(1.9 * rate)].mean() > 1000
    # Each one is silent while the other is alone.
    assert logan_pcm[int(2.3 * rate):int(2.9 * rate)].max() == 0
    assert angela_pcm[int(0.2 * rate):int(1.3 * rate)].max() == 0

    graph = animator.build_stage_filtergraph(
        ["Logan", "Angela"], intervals, prompt="Banter", layout="stage_grid", ratio="9:16",
        font_option="", text_dir=tmp_path / "stage_text",
    )
    assert "between(t,0.000,2.000)" in graph and "between(t,1.500,3.000)" in graph


@needs_ffmpeg
def test_speaker_audio_is_muted_outside_their_turns(tmp_path):
    src = tmp_path / "src.wav"
    tone_and_silence_wav(src, [(4.0, True)])
    out = tmp_path / "logan.wav"
    assert animator.build_speaker_audio(src, out, [(1.0, 2.0)])
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(out), "-f", "s16le", "-ac", "1", "-ar", "16000", "-"], capture_output=True, check=True).stdout
    pcm = np.abs(np.frombuffer(raw, dtype=np.int16).astype(np.float32))
    rate = 16000
    assert pcm[int(0.2 * rate):int(0.8 * rate)].max() == 0
    assert pcm[int(1.2 * rate):int(1.8 * rate)].mean() > 1000
    assert pcm[int(2.2 * rate):int(3.8 * rate)].max() == 0


def test_dual_t4_parallel_gpu_dispatch(tmp_path, monkeypatch):
    """When multiple speakers have turns and >=2 GPUs exist, tasks are dispatched across GPUs."""
    import torch
    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)
    monkeypatch.setattr(torch.cuda, "device_count", lambda: 2)

    dispatched_gpus = []
    def recording_talking(image, audio, output, **kwargs):
        dispatched_gpus.append((image.name, kwargs.get("gpu_id")))
        output.write_bytes(b"video_bytes")

    fake_scores = {"talking_Logan.mp4": 5.0, "talking_Angela.mp4": 4.5, "static_probe_Logan.mp4": 0.05, "static_probe_Angela.mp4": 0.05}
    intervals = {"Logan": [(0.0, 2.0)], "Angela": [(2.0, 4.0)]}
    avatars = {"Logan": tmp_path / "logan.jpg", "Angela": tmp_path / "angela.jpg"}
    avatars["Logan"].write_bytes(b"x")
    avatars["Angela"].write_bytes(b"x")

    videos, report = animator.render_speaker_tiles(
        ["Logan", "Angela"], intervals, avatars, tmp_path / "a.wav", tmp_path, 4.0,
        talking_fn=recording_talking, static_fn=lambda img, out, dur: out.write_bytes(b"x"),
        audio_fn=lambda src, out, iv: out.write_bytes(b"a" * 2000) or True,
        score_fn=lambda path, iv=None: fake_scores.get(path.name, 0.0),
    )
    assert len(videos) == 2
    assert report["Logan"]["role"] == "speaking"
    assert report["Angela"]["role"] == "speaking"
    # Both GPUs (0 and 1) were assigned across the two speakers
    gpus_used = sorted(gpu for _, gpu in dispatched_gpus)
    assert gpus_used == [0, 1]


def test_prepare_echomimic_mounts_prebaked_dataset_instantly(tmp_path, monkeypatch):
    """When pre-baked Kaggle dataset is present, it links directly without network download."""
    mock_input = tmp_path / "kaggle" / "input" / "echomimic-pretrained-weights"
    mock_input.mkdir(parents=True)
    (mock_input / "denoising_unet_acc.pth").write_text("model_checkpoint", encoding="utf-8")

    mock_work = tmp_path / "kaggle_work"
    mock_work.mkdir(parents=True)
    repo_dir = mock_work / "echomimic"
    repo_dir.mkdir(parents=True)
    (repo_dir / "infer_audio2vid_acc.py").write_text("print('test')", encoding="utf-8")

    monkeypatch.setattr(animator, "run_cmd", lambda *args, **kwargs: None)
    monkeypatch.setenv("KAGGLE_DATASET_DIR", str(mock_input))

    echomimic_dir, acc_ckpt = animator.prepare_echomimic(mock_work)
    assert acc_ckpt.name == "denoising_unet_acc.pth"
    assert acc_ckpt.exists()

