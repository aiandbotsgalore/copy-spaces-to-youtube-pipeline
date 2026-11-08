#!/usr/bin/env python3
"""
scripts/align_quote.py
Runs faster-whisper with word-level timestamps on an audio WAV slice.
Outputs JSON to stdout:
{
  "words": [
    {"word": "word", "start": 0.12, "end": 0.45, "prob": 0.98}
  ],
  "duration": 4.5
}
"""
import argparse
import json
import os
import sys

def main():
    parser = argparse.ArgumentParser(description="Run faster-whisper word alignment")
    parser.add_argument("--wav", required=True, help="Path to WAV audio slice")
    parser.add_argument("--model", default="small", help="Whisper model name (default: small)")
    parser.add_argument("--language", default="en", help="Language code (default: en)")
    parser.add_argument("--device", default="cpu", help="Device (default: cpu)")
    parser.add_argument("--compute_type", default="int8", help="Compute type (default: int8)")
    args = parser.parse_args()

    if not os.path.exists(args.wav):
        sys.stderr.write(f"File not found: {args.wav}\n")
        sys.exit(1)

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        sys.stderr.write("faster-whisper is not installed\n")
        sys.exit(2)

    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
    segments, info = model.transcribe(args.wav, word_timestamps=True, language=args.language)

    words = []
    for s in segments:
        for w in (s.words or []):
            clean_word = w.word.strip()
            if clean_word:
                words.append({
                    "word": clean_word,
                    "start": round(w.start, 3),
                    "end": round(w.end, 3),
                    "prob": round(w.probability, 3)
                })

    result = {
        "words": words,
        "language": getattr(info, "language", args.language),
        "duration": round(getattr(info, "duration", 0.0), 3)
    }
    print(json.dumps(result))

if __name__ == "__main__":
    main()
