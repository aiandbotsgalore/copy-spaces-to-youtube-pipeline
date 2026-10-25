#!/usr/bin/env python3
"""
scripts/cloud_voice/synthesize_hf.py

Free Cloud Neural Voice Synthesizer using Hugging Face Spaces (E2-F5-TTS).
Executes 100% in the cloud on Hugging Face ZeroGPU / Cloud T4 pool.
Zero local GPU inference required.
"""

import sys
import json
import argparse
import shutil
import subprocess
from pathlib import Path
from gradio_client import Client, handle_file

def main():
    parser = argparse.ArgumentParser(description="Generate voice clone via free Hugging Face Space")
    parser.add_argument("--text", required=True, help="Text to generate in cloned voice")
    parser.add_argument("--speaker", default="Logan", help="Speaker name")
    parser.add_argument("--out", required=True, help="Output WAV/MP3 destination path")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent.parent.parent
    ref_wav = project_root / "public/speaker_samples/Logan/master_reference.wav"
    ref_text = "Ten years before Hiroshima, the American presidency still belonged to a different world. This is Franklin Roosevelt at Boulder Dam in 1935."

    if not ref_wav.exists():
        print(f"[!] Reference audio not found at {ref_wav}", file=sys.stderr)
        sys.exit(1)

    print(f"[*] Connecting to free Hugging Face E2-F5-TTS Space for {args.speaker}...")
    client = Client("mrfakename/E2-F5-TTS")

    clean_text = args.text.replace("[", "").replace("]", "")
    print(f"[*] Generating speech in the cloud: \"{clean_text[:60]}...\"")

    result = client.predict(
        ref_audio=handle_file(str(ref_wav)),
        ref_text=ref_text,
        gen_text=clean_text,
        remove_silence=True,
        api_name="/predict"
    )

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Convert to destination format (MP3 or WAV) using ffmpeg
    if out_path.suffix.lower() == ".mp3":
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(result), "-codec:a", "libmp3lame", "-b:a", "192k", str(out_path)],
            check=True,
            capture_output=True
        )
    else:
        shutil.copy2(result, out_path)

    print(f"[✓] Cloud voice synthesized: {out_path} ({out_path.stat().st_size} bytes)")

if __name__ == "__main__":
    main()
