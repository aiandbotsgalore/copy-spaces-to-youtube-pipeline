#!/usr/bin/env python3
"""
scripts/relabel_speakers.py

Retroactively resolves generic speaker labels ('Speaker 1', 'Speaker A', etc.)
in existing episode JSON files using Free Cohere and Free OpenRouter LLMs
plus conversational heuristics, without re-transcribing the audio.
"""

import os
import sys
import json
import time
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.transcribe_and_diarize import resolve_speakers_intelligently


def main():
    parser = argparse.ArgumentParser(description="Retroactively resolve generic speaker names in episode transcripts")
    parser.add_argument("--limit", type=int, default=15, help="Max episodes to process in one batch")
    parser.add_argument("--episode", type=str, default="", help="Specific release tag to process")
    args = parser.parse_args()

    cohere_key = os.environ.get("COHERE_API_KEY", "")
    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "")

    episodes_dir = Path("public/transcripts/episodes")
    summary_path = Path("public/transcripts/transcripts_summary_index.json")

    if not episodes_dir.exists():
        print(f"[!] Episodes directory not found: {episodes_dir}")
        return

    summary_data = []
    summary_map = {}
    if summary_path.exists():
        try:
            summary_data = json.load(open(summary_path, encoding="utf-8"))
            for item in summary_data:
                tag = item.get("release_tag")
                if tag:
                    summary_map[tag] = item
        except Exception as e:
            print(f"[!] Could not load summary index: {e}")

    if args.episode:
        ep_files = [episodes_dir / f"{args.episode}.json"]
    else:
        ep_files = sorted(episodes_dir.glob("*.json"), reverse=True)

    processed = 0
    updated = 0

    for ep_file in ep_files:
        if not ep_file.exists():
            continue
        if processed >= args.limit:
            break

        try:
            ep_data = json.load(open(ep_file, encoding="utf-8"))
        except Exception:
            continue

        segments = ep_data.get("segments", [])
        if not segments:
            continue

        speakers = sorted(list({s.get("speaker", "") for s in segments if s.get("speaker")}))
        generic_speakers = [s for s in speakers if s.lower().startswith("speaker")]

        if not generic_speakers:
            continue

        title = ep_data.get("title") or ep_file.stem
        print(f"\n[*] Resolving speakers for {ep_file.stem} ('{title}') — {len(generic_speakers)} generic speaker(s)...")
        processed += 1

        new_segments, mappings = resolve_speakers_intelligently(
            segments=segments,
            title=title,
            cohere_key=cohere_key,
            openrouter_key=openrouter_key
        )

        if mappings:
            ep_data["segments"] = new_segments
            new_speaker_list = sorted(list({s.get("speaker", "") for s in new_segments if s.get("speaker")}))
            ep_data["speakers"] = new_speaker_list

            tmp_ep = ep_file.with_suffix(".json.tmp")
            with open(tmp_ep, "w", encoding="utf-8") as f:
                json.dump(ep_data, f, ensure_ascii=False, indent=2)
            os.replace(tmp_ep, ep_file)

            if ep_file.stem in summary_map:
                summary_map[ep_file.stem]["speakers"] = new_speaker_list

            updated += 1
            print(f"[✓] Updated {ep_file.stem}: {mappings}")
        else:
            print(f"[-] No high-confidence speaker mappings found for {ep_file.stem}")

        time.sleep(1.5)

    if updated > 0 and summary_data:
        tmp_sum = summary_path.with_suffix(".json.tmp")
        with open(tmp_sum, "w", encoding="utf-8") as f:
            json.dump(summary_data, f, ensure_ascii=False, indent=2)
        os.replace(tmp_sum, summary_path)
        print(f"\n[🎉] Updated {updated}/{processed} episode(s) and synced {summary_path}!")
    else:
        print(f"\n[*] Completed scan of {processed} episode(s) ({updated} updated).")


if __name__ == "__main__":
    main()
