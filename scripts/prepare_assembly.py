#!/usr/bin/env python3
"""
scripts/prepare_assembly.py - Documentary Audio Timeline Assembly Preparation Tool

Prepares the timeline assembly workflow for The Paper Trail audio special.
Integrates user-recorded / ElevenLabs narration segments from a configurable folder
with extracted archival clips into a master timeline sequence.

Usage:
  # Check status of narration audio files in default folder 'narration/':
  python scripts/prepare_assembly.py --narration-dir narration

  # Specify custom narration folder and clips folder:
  python scripts/prepare_assembly.py --narration-dir my_elevenlabs_files --clips-dir special_clips

  # Generate assembly manifest and timeline markers:
  python scripts/prepare_assembly.py --narration-dir narration --out-manifest documentary_assembly_manifest.json
"""

import os
import sys
import wave
import json
import shutil
import argparse
import subprocess
from pathlib import Path


def get_wav_info(file_path: Path) -> dict | None:
    """Reads duration and technical metadata from a WAV file."""
    if not file_path.exists():
        return None
    try:
        with wave.open(str(file_path), "rb") as wf:
            channels = wf.getnchannels()
            sample_width = wf.getsampwidth()
            framerate = wf.getframerate()
            frames = wf.getnframes()
            duration = frames / float(framerate) if framerate > 0 else 0.0
            return {
                "exists": True,
                "duration": round(duration, 3),
                "sample_rate": framerate,
                "channels": channels,
                "bit_depth": sample_width * 8
            }
    except Exception:
        # Fall back to ffprobe if wave module cannot parse (e.g. non-standard chunks)
        ffprobe = shutil.which("ffprobe")
        if ffprobe:
            try:
                cmd = [
                    ffprobe, "-v", "error",
                    "-show_entries", "format=duration:stream=sample_rate,channels",
                    "-of", "json", str(file_path)
                ]
                res = subprocess.run(cmd, capture_output=True, text=True)
                data = json.loads(res.stdout)
                dur = float(data.get("format", {}).get("duration", 0.0))
                return {
                    "exists": True,
                    "duration": round(dur, 3),
                    "sample_rate": int(data.get("streams", [{}])[0].get("sample_rate", 48000)),
                    "channels": int(data.get("streams", [{}])[0].get("channels", 2)),
                    "bit_depth": 24
                }
            except Exception:
                pass
    return None


def main():
    parser = argparse.ArgumentParser(description="Prepare documentary assembly timeline and ingest narration")
    parser.add_argument("--narration-dir", default="narration",
                        help="Configurable directory containing ElevenLabs/Logan recorded narration files (default: narration/)")
    parser.add_argument("--clips-dir", default="special_clips",
                        help="Directory containing extracted archival clips (default: special_clips/)")
    parser.add_argument("--manifest", default="narration_manifest.json",
                        help="Path to narration manifest JSON (default: narration_manifest.json)")
    parser.add_argument("--out-manifest", default="documentary_assembly_manifest.json",
                        help="Output path for complete documentary timeline assembly manifest")
    args = parser.parse_args()

    narration_dir = Path(args.narration_dir)
    clips_dir = Path(args.clips_dir)
    manifest_path = Path(args.manifest)

    if not manifest_path.exists():
        print(f"ERROR: Narration manifest not found at {manifest_path}")
        sys.exit(1)

    with open(manifest_path, "r", encoding="utf-8") as f:
        narration_manifest = json.load(f)

    narration_segments = narration_manifest.get("segments", [])
    print(f"Loaded {len(narration_segments)} narration segments from manifest: {manifest_path}")
    print(f"Narration source directory: {narration_dir.resolve()}")
    print(f"Clips directory:            {clips_dir.resolve()}\n")

    # Audit Narration Audio Files
    print("-" * 65)
    print("AUDITING ELEVENLABS / LOGAN NARRATION FILES:")
    print("-" * 65)

    narration_status = {}
    found_count = 0
    missing_count = 0
    total_narr_duration = 0.0

    for seg in narration_segments:
        fname = seg["filename"]
        target_file = narration_dir / fname
        info = get_wav_info(target_file)
        if info:
            found_count += 1
            dur = info["duration"]
            total_narr_duration += dur
            narration_status[seg["id"]] = {
                "ready": True,
                "file_path": str(target_file),
                "duration": dur,
                "sample_rate": info["sample_rate"],
                "bit_depth": info["bit_depth"]
            }
            print(f"[READY]   {fname:<16} | Duration: {dur:>6.2f}s | {info['sample_rate']}Hz {info['bit_depth']}-bit")
        else:
            missing_count += 1
            est_dur = seg.get("estimated_duration_sec", 15.0)
            total_narr_duration += est_dur
            narration_status[seg["id"]] = {
                "ready": False,
                "file_path": str(target_file),
                "duration": est_dur,
                "sample_rate": None,
                "bit_depth": None
            }
            print(f"[PENDING] {fname:<16} | Est: ~{est_dur:>5.1f}s | Needs recording in: {narration_dir.name}/")

    print(f"\nNarration Audit: {found_count}/{len(narration_segments)} files present in '{narration_dir.name}/'.")
    if missing_count > 0:
        print(f"Note: {missing_count} files pending generation in ElevenLabs.")

    # Interleaved Timeline Assembly Specification
    # Each entry represents a sequential documentary event
    timeline_sequence = [
        # PROLOGUE
        {"type": "CLIP", "id": "AQ-0012", "speaker": "Angela", "track": "Angela Archival", "label": "Walking paper trail"},
        {"type": "PAUSE", "duration": 1.5, "label": "Inter-quote breath"},
        {"type": "CLIP", "id": "AQ-0027", "speaker": "Angela", "track": "Angela Archival", "label": "Infiltrate document expose"},
        {"type": "PAUSE", "duration": 1.5, "label": "Inter-quote breath"},
        {"type": "CLIP", "id": "AQ-0031", "speaker": "Angela", "track": "Angela Archival", "label": "Evidence speaks for itself"},
        {"type": "PAUSE", "duration": 1.5, "label": "Inter-quote breath"},
        {"type": "CLIP", "id": "AQ-0271", "speaker": "Angela", "track": "Angela Archival", "label": "Believe them both"},
        {"type": "PAUSE", "duration": 2.0, "label": "Dramatic silence"},
        {"type": "NARRATION", "id": "LOGAN_001", "track": "Logan Narration", "label": "Okay. This is The Paper Trail."},
        {"type": "PAUSE", "duration": 3.0, "label": "Title stinger & pause"},

        # SCENE 1: THE PRE-FALLOUT ALLIANCE
        {"type": "NARRATION", "id": "LOGAN_002", "track": "Logan Narration", "label": "Alliance Intro"},
        {"type": "CLIP", "id": "AQ-0269", "speaker": "Angela", "track": "Angela Archival", "label": "Defended him relentlessly"},
        {"type": "CLIP", "id": "AQ-0146", "speaker": "Angela", "track": "Angela Archival", "label": "Badass as fuck"},
        {"type": "CLIP", "id": "AQ-0097", "speaker": "Angela", "track": "Angela Archival", "label": "Male witch hunt"},
        {"type": "NARRATION", "id": "LOGAN_003", "track": "Logan Narration", "label": "Contingency backup bridge"},
        {"type": "CLIP", "id": "AQ-0241", "speaker": "Angela & Logan", "track": "Angela Archival", "label": "Contingency names custody"},
        {"type": "CLIP", "id": "AQ-0242", "speaker": "Angela & Logan", "track": "Angela Archival", "label": "Logan warns on mic"},
        {"type": "PAUSE", "duration": 2.5, "label": "Scene transition"},

        # SCENE 2: THE OPERATING SYSTEM
        {"type": "NARRATION", "id": "LOGAN_004", "track": "Logan Narration", "label": "Methods Intro"},
        {"type": "CLIP", "id": "AQ-0243", "speaker": "Angela", "track": "Angela Archival", "label": "AWDTSM groups"},
        {"type": "CLIP", "id": "AQ-0247", "speaker": "Angela", "track": "Angela Archival", "label": "Discord infiltration"},
        {"type": "CLIP", "id": "AQ-0254", "speaker": "Angela", "track": "Angela Archival", "label": "Now we're burning it"},
        {"type": "CLIP", "id": "AQ-0251", "speaker": "Angela", "track": "Angela Archival", "label": "27-person target list"},
        {"type": "NARRATION", "id": "LOGAN_005", "track": "Logan Narration", "label": "Retention & litigation bridge"},
        {"type": "CLIP", "id": "AQ-0216", "speaker": "Angela", "track": "Angela Archival", "label": "Documents I shouldn't possess"},
        {"type": "CLIP", "id": "AQ-0167", "speaker": "Angela", "track": "Angela Archival", "label": "Keeping for a rainy day"},
        {"type": "CLIP", "id": "AQ-0142", "speaker": "Angela", "track": "Angela Archival", "label": "Discovery becomes public record"},
        {"type": "PAUSE", "duration": 2.5, "label": "Scene transition"},

        # SCENE 3: THE PRE-FALLOUT ETHICAL CODE
        {"type": "NARRATION", "id": "LOGAN_006", "track": "Logan Narration", "label": "Ethical rules intro"},
        {"type": "CLIP", "id": "AQ-0118", "speaker": "Angela", "track": "Angela Archival", "label": "Don't twist the knife"},
        {"type": "CLIP", "id": "AQ-0119", "speaker": "Angela", "track": "Angela Archival", "label": "Everyone's their own person"},
        {"type": "CLIP", "id": "AQ-0217", "speaker": "Angela", "track": "Angela Archival", "label": "Humility & admitting mistakes"},
        {"type": "CLIP", "id": "AQ-0101", "speaker": "Angela", "track": "Angela Archival", "label": "Doxxing is where children sleep"},
        {"type": "PAUSE", "duration": 2.5, "label": "Scene transition"},

        # SCENE 4: SAV & THE INTERPERSONAL SHIFT
        {"type": "NARRATION", "id": "LOGAN_007", "track": "Logan Narration", "label": "Sav dynamic intro"},
        {"type": "CLIP", "id": "AQ-0269", "speaker": "Angela", "track": "Angela Archival", "label": "Switched opinion over Sav"},
        {"type": "CLIP", "id": "AQ-0001", "speaker": "Angela", "track": "Angela Archival", "label": "Confronting on abuse"},
        {"type": "NARRATION", "id": "LOGAN_008", "track": "Logan Narration", "label": "Investigation shift bridge"},
        {"type": "PAUSE", "duration": 2.5, "label": "Scene transition"},

        # SCENE 5: THE CATALYST & THE FALLOUT MOMENT
        {"type": "NARRATION", "id": "LOGAN_009", "track": "Logan Narration", "label": "Welfare check & catalyst intro"},
        {"type": "CLIP", "id": "AQ-0270", "speaker": "Angela", "track": "Angela Archival", "label": "I got triggered... shit hit fan"},
        {"type": "NARRATION", "id": "LOGAN_010", "track": "Logan Narration", "label": "Comment nest leaks bridge"},
        {"type": "CLIP", "id": "AQ-0278", "speaker": "Logan", "track": "Logan Archival", "label": "Screenshots in comment nests"},
        {"type": "CLIP", "id": "AQ-0279", "speaker": "Witness", "track": "Witness Archival", "label": "Hosts terrified"},
        {"type": "PAUSE", "duration": 2.5, "label": "Scene transition"},

        # SCENE 6: THE ARCHIVE OPENS
        {"type": "NARRATION", "id": "LOGAN_011", "track": "Logan Narration", "label": "Rainy day callback intro"},
        {"type": "CLIP", "id": "AQ-0016", "speaker": "Angela", "track": "Angela Archival", "label": "Fuck it bucket"},
        {"type": "CLIP", "id": "AQ-0222", "speaker": "Angela", "track": "Angela Archival", "label": "Private Discord archive"},
        {"type": "CLIP", "id": "AQ-0225", "speaker": "Angela", "track": "Angela Archival", "label": "48-hour recording traps"},
        {"type": "CLIP", "id": "AQ-0226", "speaker": "Angela", "track": "Angela Archival", "label": "Abandoning love and light"},
        {"type": "CLIP", "id": "AQ-0228", "speaker": "Angela", "track": "Angela Archival", "label": "Screen record from start to finish"},
        {"type": "PAUSE", "duration": 2.5, "label": "Scene transition"},

        # SCENE 7: THE CASE AGAINST LOGAN
        {"type": "NARRATION", "id": "LOGAN_012", "track": "Logan Narration", "label": "Criminal allegations intro"},
        {"type": "CLIP", "id": "AQ-0261", "speaker": "Angela", "track": "Angela Archival", "label": "Petty Space monologue"},
        {"type": "CLIP", "id": "AQ-0264", "speaker": "Angela", "track": "Angela Archival", "label": "You're surrounded"},
        {"type": "CLIP", "id": "AQ-0002", "speaker": "Angela", "track": "Angela Archival", "label": "Called you a predator"},
        {"type": "CLIP", "id": "AQ-0233", "speaker": "Angela", "track": "Angela Archival", "label": "Stop sending nudes claim"},
        {"type": "CLIP", "id": "AQ-0008", "speaker": "Angela", "track": "Angela Archival", "label": "Revenge porn is real"},
        {"type": "NARRATION", "id": "LOGAN_013", "track": "Logan Narration", "label": "Kimball blackmail context & Sav bridge"},
        {"type": "PAUSE", "duration": 2.5, "label": "Scene transition"},

        # SCENE 8: THE SOURCE REVERSAL
        {"type": "NARRATION", "id": "LOGAN_014", "track": "Logan Narration", "label": "Counter-space & Sav intro"},
        {"type": "CLIP", "id": "AQ-0213", "speaker": "Sav", "track": "Witness Archival", "label": "Sav takes mic on live audio"},
        {"type": "PAUSE", "duration": 4.0, "label": "Profound silence"},
        {"type": "NARRATION", "id": "LOGAN_015", "track": "Logan Narration", "label": "Source reversal reflection"},
        {"type": "PAUSE", "duration": 2.5, "label": "Scene transition"},

        # SCENE 9: REAL-WORLD MACHINERY
        {"type": "NARRATION", "id": "LOGAN_016", "track": "Logan Narration", "label": "Institutional systems intro"},
        {"type": "CLIP", "id": "AQ-0022", "speaker": "Angela", "track": "Angela Archival", "label": "Process used as a club"},
        {"type": "CLIP", "id": "AQ-0006", "speaker": "Angela", "track": "Angela Archival", "label": "Sent photo of front door"},
        {"type": "CLIP", "id": "AQ-0024", "speaker": "Angela", "track": "Angela Archival", "label": "Send people to watch & play dumb"},
        {"type": "CLIP", "id": "AQ-0080", "speaker": "Angela", "track": "Angela Archival", "label": "Second device recording"},
        {"type": "NARRATION", "id": "LOGAN_017", "track": "Logan Narration", "label": "Third party witness bridge"},
        {"type": "CLIP", "id": "AQ-0239", "speaker": "Sian", "track": "Witness Archival", "label": "CPS swatting 4 times"},
        {"type": "CLIP", "id": "AQ-0206", "speaker": "Timmy", "track": "Witness Archival", "label": "Parole officer calls"},
        {"type": "CLIP", "id": "AQ-0210", "speaker": "Glow Baby", "track": "Witness Archival", "label": "Doxxing baby"},
        {"type": "CLIP", "id": "AQ-0211", "speaker": "Glow Baby", "track": "Witness Archival", "label": "Bloodline address dox"},
        {"type": "NARRATION", "id": "LOGAN_018", "track": "Logan Narration", "label": "Tannerite intro"},
        {"type": "CLIP", "id": "AQ-0276", "speaker": "Angela", "track": "Angela Archival", "label": "I identify as Tannerite"},
        {"type": "PAUSE", "duration": 3.0, "label": "Silence before contradiction engine"},

        # SCENE 10: THE CONTRADICTION ENGINE
        {"type": "NARRATION", "id": "LOGAN_019", "track": "Logan Narration", "label": "The record answers itself"},
        {"type": "CLIP", "id": "AQ-0097", "speaker": "Angela", "track": "Angela Archival", "label": "Male witch hunt"},
        {"type": "PAUSE", "duration": 1.5, "label": "Dry pause"},
        {"type": "CLIP", "id": "AQ-0270", "speaker": "Angela", "track": "Angela Archival", "label": "Got triggered... hit him in ego"},
        {"type": "PAUSE", "duration": 1.5, "label": "Dry pause"},
        {"type": "CLIP", "id": "AQ-0002", "speaker": "Angela", "track": "Angela Archival", "label": "Called you a predator"},
        {"type": "PAUSE", "duration": 3.0, "label": "Silence"},
        {"type": "CLIP", "id": "AQ-0118", "speaker": "Angela", "track": "Angela Archival", "label": "Don't twist the knife"},
        {"type": "PAUSE", "duration": 1.5, "label": "Dry pause"},
        {"type": "CLIP", "id": "AQ-0016", "speaker": "Angela", "track": "Angela Archival", "label": "Fuck it bucket"},
        {"type": "PAUSE", "duration": 3.0, "label": "Silence"},
        {"type": "CLIP", "id": "AQ-0119", "speaker": "Angela", "track": "Angela Archival", "label": "Everyone's their own person"},
        {"type": "PAUSE", "duration": 1.5, "label": "Dry pause"},
        {"type": "CLIP", "id": "AQ-0225", "speaker": "Angela", "track": "Angela Archival", "label": "Why give them a microphone"},
        {"type": "PAUSE", "duration": 3.0, "label": "Silence"},
        {"type": "CLIP", "id": "AQ-0101", "speaker": "Angela", "track": "Angela Archival", "label": "Doxxing is where children sleep"},
        {"type": "PAUSE", "duration": 1.5, "label": "Dry pause"},
        {"type": "CLIP", "id": "AQ-0271", "speaker": "Angela", "track": "Angela Archival", "label": "That's doxxing... believe both"},
        {"type": "PAUSE", "duration": 1.5, "label": "Dry pause"},
        {"type": "CLIP", "id": "AQ-0006", "speaker": "Angela", "track": "Angela Archival", "label": "Sent photo of front door"},
        {"type": "PAUSE", "duration": 4.0, "label": "Profound silence"},

        # SCENE 11: THE PAPER TRAIL
        {"type": "NARRATION", "id": "LOGAN_020", "track": "Logan Narration", "label": "Closing synthesis"},
        {"type": "CLIP", "id": "AQ-0271", "speaker": "Angela", "track": "Angela Archival", "label": "Final word: form your own opinion"},
        {"type": "PAUSE", "duration": 5.0, "label": "Program end silence"}
    ]

    # Assemble timeline with time offsets
    current_time = 0.0
    assembly_events = []

    for idx, item in enumerate(timeline_sequence, 1):
        ev_type = item["type"]
        ev_id = item.get("id")
        label = item.get("label", "")
        track = item.get("track", "Master")

        if ev_type == "PAUSE":
            dur = item.get("duration", 2.0)
            status = "AUTOMATED_SPACING"
            src_file = None
        elif ev_type == "NARRATION":
            n_stat = narration_status.get(ev_id, {})
            dur = n_stat.get("duration", 15.0)
            status = "AUDIO_READY" if n_stat.get("ready") else "PENDING_RECORDING"
            src_file = n_stat.get("file_path")
        elif ev_type == "CLIP":
            # Check if clip exists in clips_dir
            clip_matches = list(clips_dir.glob(f"*{ev_id}*.wav")) if clips_dir.exists() else []
            if clip_matches:
                info = get_wav_info(clip_matches[0])
                dur = info["duration"] if info else 30.0
                status = "AUDIO_READY"
                src_file = str(clip_matches[0])
            else:
                dur = 30.0 # Placeholder estimated clip duration
                status = "PENDING_EXTRACTION"
                src_file = f"{clips_dir.name}/Cue_xx_{ev_id}.wav"
        else:
            dur = 0.0
            status = "UNKNOWN"
            src_file = None

        event_record = {
            "index": idx,
            "type": ev_type,
            "id": ev_id,
            "label": label,
            "track": track,
            "timeline_in_sec": round(current_time, 2),
            "duration_sec": round(dur, 2),
            "timeline_out_sec": round(current_time + dur, 2),
            "status": status,
            "source_file": src_file
        }
        assembly_events.append(event_record)
        current_time += dur

    output_payload = {
        "project": "The Paper Trail: The Angela Maggard Primary Record",
        "narration_directory": str(narration_dir),
        "clips_directory": str(clips_dir),
        "total_events": len(assembly_events),
        "total_estimated_runtime_sec": round(current_time, 2),
        "total_estimated_runtime_min": round(current_time / 60.0, 2),
        "timeline_events": assembly_events
    }

    out_path = Path(args.out_manifest)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output_payload, f, indent=2)

    print("\n" + "=" * 65)
    print("DOCUMENTARY ASSEMBLY TIMELINE SUMMARY")
    print(f"Total Sequential Timeline Events: {len(assembly_events)}")
    print(f"Estimated Finished Runtime:       {current_time / 60.0:.1f} minutes ({current_time:.1f} seconds)")
    print(f"Narration Segments Ingested:      {found_count} of 20 ready")
    print(f"Assembly Manifest Generated:      {out_path.resolve()}")
    print("=" * 65)


if __name__ == "__main__":
    main()
