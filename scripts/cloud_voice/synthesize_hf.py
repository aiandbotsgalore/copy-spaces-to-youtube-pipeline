#!/usr/bin/env python3
"""
scripts/cloud_voice/synthesize_hf.py

Cloud Neural Voice Synthesizer using OpenBMB VoxCPM-2 on Hugging Face Spaces.
Defaults to Logan's dedicated ZeroGPU Space: loganblack0/voxcpm-voice-clone.
Executes 100% in the cloud on Hugging Face ZeroGPU.
Zero local GPU inference required.
Supports automatic token failover across primary and backup Hugging Face tokens.
"""

import sys
import os
import json
import time
import base64
import argparse
import shutil
import subprocess
from pathlib import Path
from gradio_client import Client, handle_file
from gradio_client.utils import QueueError

def main():
    parser = argparse.ArgumentParser(description="Generate voice clone via OpenBMB VoxCPM-2 Hugging Face Space")
    parser.add_argument("--text", default=None, help="Text to generate in cloned voice")
    parser.add_argument("--text-b64", default=None, help="Base64-encoded text to generate")
    parser.add_argument("--speaker", default="Logan", help="Speaker name")
    parser.add_argument("--instruction", default="clear, authentic podcast host tone", help="Style control instruction")
    parser.add_argument("--out", required=True, help="Output destination path (MP3/WAV)")
    parser.add_argument("--retries", type=int, default=3, help="Max retry attempts on queue congestion")
    args = parser.parse_args()

    raw_text = ""
    if args.text_b64:
        try:
            raw_text = base64.b64decode(args.text_b64).decode("utf-8")
        except Exception:
            raw_text = args.text or ""
    elif args.text:
        raw_text = args.text
    else:
        print("[!] Either --text or --text-b64 must be provided.", file=sys.stderr)
        sys.exit(1)

    project_root = Path(__file__).resolve().parent.parent.parent
    ref_wav = project_root / "public/speaker_samples/Logan/master_reference.wav"
    ref_text = "Ten years before Hiroshima, the American presidency still belonged to a different world. This is Franklin Roosevelt at Boulder Dam in 1935."

    if not ref_wav.exists():
        print(f"[!] Reference audio not found at {ref_wav}", file=sys.stderr)
        sys.exit(1)

    target_space = os.environ.get("VOXCPM_SPACE", "loganblack0/voxcpm-voice-clone")

    # Collect candidate tokens in priority order (primary, backup, comma-separated pool)
    raw_tokens = []
    if os.environ.get("HF_TOKEN"):
        raw_tokens.append(os.environ.get("HF_TOKEN").strip())
    if os.environ.get("HF_BACKUP_TOKEN"):
        raw_tokens.append(os.environ.get("HF_BACKUP_TOKEN").strip())
    if os.environ.get("HF_TOKENS"):
        raw_tokens.extend([t.strip() for t in os.environ.get("HF_TOKENS").split(",") if t.strip()])

    token_pool = []
    for t in raw_tokens:
        if t and t not in token_pool:
            token_pool.append(t)
    if not token_pool:
        token_pool = [None]

    print(f"[*] Target VoxCPM-2 Space: {target_space}")
    clean_text = raw_text.replace("[", "").replace("]", "").strip()
    print(f"[*] Generating VoxCPM-2 speech in cloud: \"{clean_text[:60]}...\"")

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    result = None
    for token_idx, current_token in enumerate(token_pool):
        masked_token = f"...{current_token[-6:]}" if current_token and len(current_token) > 6 else ("present" if current_token else "none")
        print(f"[*] Connecting to {target_space} (token {token_idx + 1}/{len(token_pool)}: {masked_token})...")

        try:
            client = Client(target_space, token=current_token)
        except Exception as init_err:
            print(f"[!] Error connecting to {target_space} with token {masked_token}: {init_err}", file=sys.stderr)
            if token_idx < len(token_pool) - 1:
                print(f"[*] Attempting next token in pool...", file=sys.stderr)
                continue
            else:
                sys.exit(1)

        token_succeeded = False
        failover_requested = False

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
                token_succeeded = True
                break
            except QueueError as qe:
                print(f"[!] Hugging Face queue is congested (attempt {attempt}): {qe}", file=sys.stderr)
                if attempt < args.retries:
                    time.sleep(3)
                else:
                    print(f"[!] Queue full after {args.retries} attempts.", file=sys.stderr)
            except Exception as e:
                err_str = str(e)
                print(f"[!] Error during synthesis (attempt {attempt}): {err_str}", file=sys.stderr)
                if "quota" in err_str.lower() or "runs limit" in err_str.lower() or "429" in err_str or "exceeded" in err_str.lower():
                    if token_idx < len(token_pool) - 1:
                        print(f"[!] Token {masked_token} exceeded quota/rate limit. Failing over to backup token immediately...", file=sys.stderr)
                        failover_requested = True
                        break
                    else:
                        print("[!] All configured Hugging Face tokens have exceeded ZeroGPU quota/limits.", file=sys.stderr)
                        sys.exit(3)
                if attempt < args.retries:
                    time.sleep(2)
                else:
                    if token_idx < len(token_pool) - 1:
                        failover_requested = True
                        break
                    else:
                        sys.exit(1)

        if token_succeeded and result:
            break
        if failover_requested:
            continue

    if not result:
        print("[!] Synthesis failed to produce audio.", file=sys.stderr)
        sys.exit(1)

    # Copy / convert to destination format using ffmpeg or soundfile
    if out_path.suffix.lower() == ".mp3":
        if str(result).lower().endswith(".mp3"):
            shutil.copy2(result, out_path)
        else:
            converted = False
            if shutil.which("ffmpeg"):
                try:
                    subprocess.run(
                        ["ffmpeg", "-y", "-i", str(result), "-codec:a", "libmp3lame", "-b:a", "192k", str(out_path)],
                        check=True,
                        capture_output=True
                    )
                    converted = True
                except Exception as ff_err:
                    print(f"[*] ffmpeg conversion notice: {ff_err}")
            if not converted:
                try:
                    import soundfile as sf
                    data, sr = sf.read(str(result))
                    sf.write(str(out_path), data, sr, format="MP3")
                    converted = True
                except Exception as sf_err:
                    print(f"[*] soundfile conversion notice: {sf_err}")
            if not converted:
                shutil.copy2(result, out_path)
    else:
        shutil.copy2(result, out_path)

    print(f"[✓] VoxCPM-2 Cloud voice synthesized: {out_path} ({out_path.stat().st_size} bytes)")

if __name__ == "__main__":
    main()
