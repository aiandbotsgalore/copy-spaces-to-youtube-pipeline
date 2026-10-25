#!/usr/bin/env python3
"""
scripts/cloud_voice/synthesize_hf.py

Cloud Neural Voice Synthesizer using OpenBMB VoxCPM-2 on Hugging Face Spaces.
Defaults to Logan's dedicated ZeroGPU Space: loganblack0/voxcpm-voice-clone.
Executes 100% in the cloud on Hugging Face ZeroGPU.
Zero local GPU inference required.
"""

import sys
import os
import json
import time
import argparse
import shutil
import subprocess
from pathlib import Path
from gradio_client import Client, handle_file
from gradio_client.utils import QueueError

def main():
    parser = argparse.ArgumentParser(description="Generate voice clone via OpenBMB VoxCPM-2 Hugging Face Space")
    parser.add_argument("--text", required=True, help="Text to generate in cloned voice")
    parser.add_argument("--speaker", default="Logan", help="Speaker name")
    parser.add_argument("--instruction", default="clear, authentic podcast host tone", help="Style control instruction")
    parser.add_argument("--out", required=True, help="Output destination path (MP3/WAV)")
    parser.add_argument("--retries", type=int, default=3, help="Max retry attempts on queue congestion")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent.parent.parent
    ref_wav = project_root / "public/speaker_samples/Logan/master_reference.wav"
    ref_text = "Ten years before Hiroshima, the American presidency still belonged to a different world. This is Franklin Roosevelt at Boulder Dam in 1935."

    if not ref_wav.exists():
        print(f"[!] Reference audio not found at {ref_wav}", file=sys.stderr)
        sys.exit(1)

    target_space = os.environ.get("VOXCPM_SPACE", "loganblack0/voxcpm-voice-clone")
    hf_token = os.environ.get("HF_TOKEN", None)

    print(f"[*] Target VoxCPM-2 Space: {target_space}")
    clean_text = args.text.replace("[", "").replace("]", "").strip()
    print(f"[*] Generating VoxCPM-2 speech in cloud: \"{clean_text[:60]}...\"")

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    client = None
    try:
        client = Client(target_space, token=hf_token)
    except Exception as init_err:
        print(f"[!] Error connecting to {target_space}: {init_err}", file=sys.stderr)
        sys.exit(1)

    result = None
    for attempt in range(1, args.retries + 1):
        try:
            print(f"[*] Dispatching synthesis request (attempt {attempt}/{args.retries})...")
            if target_space == "openbmb/VoxCPM-Demo":
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
            else:
                # Dedicated Logan Space API
                result = client.predict(
                    text=clean_text,
                    ref_audio=handle_file(str(ref_wav)),
                    ref_text=ref_text,
                    timesteps=15,
                    api_name="/generate"
                )
            break
        except QueueError as qe:
            print(f"[!] Hugging Face queue is congested (attempt {attempt}): {qe}", file=sys.stderr)
            if attempt < args.retries:
                time.sleep(3)
            else:
                print(f"[!] Queue full after {args.retries} attempts.", file=sys.stderr)
                sys.exit(2)
        except Exception as e:
            print(f"[!] Unexpected error during synthesis: {e}", file=sys.stderr)
            if attempt < args.retries:
                time.sleep(2)
            else:
                sys.exit(1)

    if not result:
        print("[!] Synthesis failed to produce audio.", file=sys.stderr)
        sys.exit(1)

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
