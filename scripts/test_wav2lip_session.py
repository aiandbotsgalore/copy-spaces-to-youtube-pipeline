#!/usr/bin/env python3
"""CPU smoke test for the in-process adapter seam.

It uses a tiny fake Wav2Lip module, but writes real MP4 segments through the
same OpenCV/FFmpeg path. The assertion that no command contains inference.py
guards against accidentally regressing to the old subprocess design.
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import cv2
import numpy as np
import torch

from kaggle_worker.echomimic_pkg.smart_avatar_worker import PersistentWav2LipAdapter


class FakeModel:
    def __call__(self, mel, images):
        # A deterministic moving-color output keeps the generated clip visibly non-static.
        batch = images.shape[0]
        value = torch.linspace(0.1, 0.9, batch, dtype=torch.float32).reshape(batch, 1, 1, 1)
        return value.expand(batch, 3, 96, 96)


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="spacepipe-wav2lip-session-") as temp:
        root = Path(temp)
        avatar = root / "avatar.jpg"
        cv2.imwrite(str(avatar), np.full((128, 128, 3), 180, dtype=np.uint8))
        audio = root / "segment.wav"
        audio.write_bytes(b"fake-audio")
        calls = []
        fake_args = SimpleNamespace(static=True, fps=25.0, wav2lip_batch_size=2, img_size=96, pads=[0, 10, 0, 0])
        fake_audio = SimpleNamespace(load_wav=lambda *_args: np.zeros(16000, dtype=np.float32), melspectrogram=lambda _wav: np.zeros((80, 16 * 25 + 16), dtype=np.float32))
        fake_inference = SimpleNamespace(
            cv2=cv2,
            np=np,
            torch=torch,
            args=fake_args,
            device="cpu",
            audio=fake_audio,
            mel_step_size=16,
            face_detect=lambda frames: [(frames[0], (0, frames[0].shape[0], 0, frames[0].shape[1]))],
        )
        adapter = PersistentWav2LipAdapter(root)
        adapter.inference = fake_inference
        adapter.model = FakeModel()
        adapter.device = "cpu"

        def recording_run(cmd, cwd=None):
            calls.append(list(cmd))
            import subprocess
            return subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, text=True)

        first = root / "first.mp4"
        second = root / "second.mp4"
        with patch("kaggle_worker.echomimic_pkg.smart_avatar_worker.run", side_effect=recording_run):
            adapter.render_segment(avatar, audio, first, 8, 25, {})
            adapter.render_segment(avatar, audio, second, 8, 25, {})
        assert first.exists() and second.exists()
        assert adapter.model is not None
        assert not any("inference.py" in str(call) for call in calls)
        print(f"[OK] in-process adapter rendered 2 clips with one model object; ffmpeg calls={len(calls)}")


if __name__ == "__main__":
    main()
