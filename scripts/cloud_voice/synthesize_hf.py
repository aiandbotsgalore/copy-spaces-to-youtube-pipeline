#!/usr/bin/env python3
"""
scripts/cloud_voice/synthesize_hf.py

Free Cloud Neural Voice Synthesizer using official OpenBMB VoxCPM-2 Hugging Face Space.
Executes 100% in the cloud on Hugging Face GPU pool for openbmb/VoxCPM2.
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
    parser = argparse.ArgumentParser(description="Generate voice clone via official OpenBMB VoxCPM-2 Hugging Face Space")
    parser.add_argument("--text", required=True, help="Text to generate in cloned voice")
    parser.add_argument("--speaker", default="Logan", help="Speaker name")
    parser.add_argument("--instruction", default="clear, authentic podcast host tone", help="Style control instruction")
    parser.add_argument("--out", required=True, help="Output destination path (MP3/WAV)")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent.parent.parent
    ref_wav = project_root / "public/speaker_samples/Logan/master_reference.wav"
    ref_text = "Ten years before Hiroshima, the American presidency still belonged to a different world. This is Franklin Roosevelt at Boulder Dam in 1935."

    if not ref_wav.exists():
        print(f"[!] Reference audio not found at {ref_wav}", file=sys.stderr)
        sys.exit(1)

    print(f"[*] Connecting to official OpenBMB VoxCPM-2 Hugging Face Space for {args.speaker}...")
    client = Client("openbmb/VoxCPM-Demo")

    clean_text = args.text.replace("[", "").replace("]", "").strip()
    print(f"[*] Generating VoxCPM-2 speech in cloud: \"{clean_text[:60]}...\"")

    result = client.predict(
        text_input=clean_text,
        control_instruction=args.instruction,
        reference_wav_path_input=handle_file(str(ref_wav)),
        use_prompt_text=True,
        prompt_text_input=ref_text,
        cfg_value_input=2.0,
        do_normalize=True,
        denoise=False,
        api_name="/generate"
    )

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Copy / convert to destination format using ffmpeg if needed
    if out_path.suffix.lower() == ".mp3":
        if str(result).lower().endswith(".mp3"):
            shutil.copy2(result, out_path)
        else:
            subprocess.run(
                ["ffmpeg", "-y", "-i", str(result), "-codec:a", "libmp3lame", "-b:a", "192k", str(out_path)],
                check=True,
                capture_output=True
            )
    else:
        shutil.copy2(result, out_path)

    print(f"[✓] VoxCPM-2 Cloud voice synthesized: {out_path} ({out_path.stat().st_size} bytes)")

if __name__ == "__main__":
    main()
