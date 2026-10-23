#!/usr/bin/env python3
"""
scripts/extract_cues_to_clips.py
Extracts the 9 un-extracted documentary quotes with accurate sentence-level boundaries
into standalone broadcast WAV clips in public/clips/angela/ using FFmpeg,
and updates cue_sheet_audit_results.json and manifest.json.
"""

import os
import sys
import json
import subprocess
from pathlib import Path

FFMPEG_BIN = r"C:\Hydrus Network\bin\ffmpeg.exe"
OUTPUT_DIR = Path("public/clips/angela")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

CUES_TO_EXTRACT = [
    {
        "cue_id": "D07",
        "quote_id": "AQ-0007",
        "category": "Direct Allegation",
        "episode_id": "20260918_1MJgNbdaAPlGL",
        "episode_title": "LOGAN BLACK UNMASKED - WEAPONIZING WOMEN ON UFO X",
        "source_url": "https://github.com/aiandbotsgalore/copy-spaces-to-youtube-pipeline/releases/download/20260918_1MJgNbdaAPlGL/20260918_1MJgNbdaAPlGL_LOGAN_BLACK_UNMASKED_-_WEAPONIZING_WOMEN_ON_UFO_X.mp3",
        "start_seconds": 1071.0,
        "end_seconds": 1079.5,
        "filename": "D07_AQ-0007_Angela.wav",
        "verbatim": "That's why I've told all my mutual friends that I cannot be friends anymore. Because if I'm gonna be put in the position to where I have to choose between telling the truth and being friends, I'm sorry to hurt your feelings, but I'm going to choose the truth."
    },
    {
        "cue_id": "D08",
        "quote_id": "AQ-0008",
        "category": "Direct Allegation",
        "episode_id": "20260918_1MJgNbdaAPlGL",
        "episode_title": "LOGAN BLACK UNMASKED - WEAPONIZING WOMEN ON UFO X",
        "source_url": "https://github.com/aiandbotsgalore/copy-spaces-to-youtube-pipeline/releases/download/20260918_1MJgNbdaAPlGL/20260918_1MJgNbdaAPlGL_LOGAN_BLACK_UNMASKED_-_WEAPONIZING_WOMEN_ON_UFO_X.mp3",
        "start_seconds": 1099.0,
        "end_seconds": 1117.0,
        "filename": "D08_AQ-0008_Angela.wav",
        "verbatim": "Logan's one of many people. He was not even the initial person I was talking about this. But you have men on here sharing nudes of women in in in DMs. Multiple women. Revenge porn is real."
    },
    {
        "cue_id": "D09",
        "quote_id": "AQ-0009",
        "category": "Direct Allegation",
        "episode_id": "20260918_1MJgNbdaAPlGL",
        "episode_title": "LOGAN BLACK UNMASKED - WEAPONIZING WOMEN ON UFO X",
        "source_url": "https://github.com/aiandbotsgalore/copy-spaces-to-youtube-pipeline/releases/download/20260918_1MJgNbdaAPlGL/20260918_1MJgNbdaAPlGL_LOGAN_BLACK_UNMASKED_-_WEAPONIZING_WOMEN_ON_UFO_X.mp3",
        "start_seconds": 1269.5,
        "end_seconds": 1281.0,
        "filename": "D09_AQ-0009_Angela.wav",
        "verbatim": "Do you want me to post the photos below of of Logan with the 13 year old? Do you want me to just tit for tat, motherfucker, since I can't speak on an abroad since without having to speak by names?"
    },
    {
        "cue_id": "D10",
        "quote_id": "AQ-0010",
        "category": "Direct Allegation",
        "episode_id": "20260918_1MJgNbdaAPlGL",
        "episode_title": "LOGAN BLACK UNMASKED - WEAPONIZING WOMEN ON UFO X",
        "source_url": "https://github.com/aiandbotsgalore/copy-spaces-to-youtube-pipeline/releases/download/20260918_1MJgNbdaAPlGL/20260918_1MJgNbdaAPlGL_LOGAN_BLACK_UNMASKED_-_WEAPONIZING_WOMEN_ON_UFO_X.mp3",
        "start_seconds": 1401.5,
        "end_seconds": 1410.0,
        "filename": "D10_AQ-0010_Angela.wav",
        "verbatim": "Stop propping up predators. That's the whole reason why me and Lana don't talk anymore."
    },
    {
        "cue_id": "D15",
        "quote_id": "AQ-0015",
        "category": "Direct Allegation",
        "episode_id": "20260918_1MJgNbdaAPlGL",
        "episode_title": "LOGAN BLACK UNMASKED - WEAPONIZING WOMEN ON UFO X",
        "source_url": "https://github.com/aiandbotsgalore/copy-spaces-to-youtube-pipeline/releases/download/20260918_1MJgNbdaAPlGL/20260918_1MJgNbdaAPlGL_LOGAN_BLACK_UNMASKED_-_WEAPONIZING_WOMEN_ON_UFO_X.mp3",
        "start_seconds": 3557.0,
        "end_seconds": 3564.0,
        "filename": "D15_AQ-0015_Angela.wav",
        "verbatim": "Logan isn't even the big bad wolf in all of this shit. There's worse."
    },
    {
        "cue_id": "D16",
        "quote_id": "AQ-0016",
        "category": "Direct Allegation",
        "episode_id": "20260918_1MJgNbdaAPlGL",
        "episode_title": "LOGAN BLACK UNMASKED - WEAPONIZING WOMEN ON UFO X",
        "source_url": "https://github.com/aiandbotsgalore/copy-spaces-to-youtube-pipeline/releases/download/20260918_1MJgNbdaAPlGL/20260918_1MJgNbdaAPlGL_LOGAN_BLACK_UNMASKED_-_WEAPONIZING_WOMEN_ON_UFO_X.mp3",
        "start_seconds": 3862.5,
        "end_seconds": 3896.0,
        "filename": "D16_AQ-0016_Angela.wav",
        "verbatim": "I'm a very patient person, and I'm very calculated... I sat on it until I was poked and poked and poked... Then I said, fuck it. I threw it all in the fuck it bucket."
    },
    {
        "cue_id": "D22",
        "quote_id": "AQ-0022",
        "category": "Retaliation & Disclosure",
        "episode_id": "20260918_1MJgNbdaAPlGL",
        "episode_title": "LOGAN BLACK UNMASKED - WEAPONIZING WOMEN ON UFO X",
        "source_url": "https://github.com/aiandbotsgalore/copy-spaces-to-youtube-pipeline/releases/download/20260918_1MJgNbdaAPlGL/20260918_1MJgNbdaAPlGL_LOGAN_BLACK_UNMASKED_-_WEAPONIZING_WOMEN_ON_UFO_X.mp3",
        "start_seconds": 5815.5,
        "end_seconds": 5831.0,
        "filename": "D22_AQ-0022_Angela.wav",
        "verbatim": "So I screenshotted that, and I went to my other account, and I sent it because I will have the motherfucking last word."
    },
    {
        "cue_id": "EXTRA-01",
        "quote_id": "AQ-0276",
        "category": "Retaliation & Disclosure",
        "episode_id": "20260916_1YxNrbXNjQLxw",
        "episode_title": "Space Invaders - Narrative Edition Smoke Sesh",
        "source_url": "https://github.com/aiandbotsgalore/copy-spaces-to-youtube-pipeline/releases/download/20260916_1YxNrbXNjQLxw/20260916_1YxNrbXNjQLxw_Space_Invaders_-_Narrative_Edition_Smoke_Sesh.mp3",
        "start_seconds": 2375.0,
        "end_seconds": 2385.0,
        "filename": "EXTRA-01_AQ-0276_Angela_Maggard.wav",
        "verbatim": "I identify as Tannerite. And I love how you be like screen recording all my spaces... meet your maker with me."
    },
    {
        "cue_id": "EXTRA-02",
        "quote_id": "AQ-0270",
        "category": "Retaliation & Disclosure",
        "episode_id": "20260908_1nGeLMjONkAKX",
        "episode_title": "Hook Line Sinker - How Psychological Operations Reel Us In",
        "source_url": "https://github.com/aiandbotsgalore/copy-spaces-to-youtube-pipeline/releases/download/20260908_1nGeLMjONkAKX/20260908_1nGeLMjONkAKX_Hook_Line_Sinker_-_How_Psychological_Operations_Reel_Us_In.mp3",
        "start_seconds": 3448.0,
        "end_seconds": 3468.0,
        "filename": "EXTRA-02_AQ-0270_Angela_Maggard.wav",
        "verbatim": "And then to me, he's like, I'm sorry she chose to throw you away. It's not my fault. And I got triggered. And so I sent the screenshot proving he was a liar. And that's when shit hit the fan. And that's where we're standing at now. It's because I proved him wrong. I hit him in his ego."
    }
]

def extract_clip(cue):
    out_file = OUTPUT_DIR / cue["filename"]
    dur = round(cue["end_seconds"] - cue["start_seconds"], 2)
    fade_dur = 0.018
    fade_out_st = max(0.0, dur - fade_dur)
    af_filter = f"afade=t=in:ss=0:d={fade_dur:.3f},afade=t=out:st={fade_out_st:.3f}:d={fade_dur:.3f}"
    
    cmd = [
        FFMPEG_BIN,
        "-y",
        "-ss", f"{cue['start_seconds']:.2f}",
        "-i", cue["source_url"],
        "-t", f"{dur:.2f}",
        "-af", af_filter,
        "-c:a", "pcm_s16le",
        "-ar", "44100",
        str(out_file)
    ]
    print(f"Extracting [{cue['cue_id']}] {cue['quote_id']} ({dur}s) -> {out_file.name}...")
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"  ERROR: FFmpeg failed: {res.stderr}")
        return None
    size = out_file.stat().st_size
    print(f"  SUCCESS: {out_file.name} created ({size:,} bytes)")
    return size

def main():
    extracted = {}
    for cue in CUES_TO_EXTRACT:
        size = extract_clip(cue)
        if size:
            extracted[cue["cue_id"]] = {**cue, "size_bytes": size}

    # Update cue_sheet_audit_results.json
    paths = [Path("cue_sheet_audit_results.json"), Path("public/cue_sheet_audit_results.json")]
    for p in paths:
        if p.exists():
            with open(p, "r", encoding="utf-8") as f:
                audit_list = json.load(f)
            for item in audit_list:
                cid = item.get("cue_id")
                if cid in extracted:
                    info = extracted[cid]
                    item["status"] = "EXISTS"
                    item["filename"] = info["filename"]
                    item["audio_url"] = f"clips/angela/{info['filename']}"
                    item["start_seconds"] = None
                    item["end_seconds"] = None
                    dur = round(info["end_seconds"] - info["start_seconds"], 2)
                    item["duration"] = dur
                    item["timestamp_str"] = f"{int(info['start_seconds']//60)}:{int(info['start_seconds']%60):02d}"
                    item["note"] = f"Extracted master asset: {info['filename']}"
            with open(p, "w", encoding="utf-8") as f:
                json.dump(audit_list, f, indent=2)
            print(f"Updated {p}")

    # Update public/clips/angela/manifest.json
    manifest_path = Path("public/clips/angela/manifest.json")
    manifest = []
    if manifest_path.exists():
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)

    existing_filenames = {m.get("filename") for m in manifest}
    for cid, info in extracted.items():
        if info["filename"] not in existing_filenames:
            manifest.append({
                "id": f"angela_clip_{cid.lower().replace('-', '_')}",
                "filename": info["filename"],
                "title": f"[{cid}] {info['quote_id']}: {info['category']}",
                "quote": info["verbatim"],
                "space_tag": info["episode_id"],
                "space_title": info["episode_title"],
                "timestamp": f"{int(info['start_seconds']//60)}:{int(info['start_seconds']%60):02d}",
                "size_bytes": info["size_bytes"],
                "format": "wav",
                "url": f"clips/angela/{info['filename']}"
            })
            print(f"Added {info['filename']} to manifest.json")

    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    print("Updated manifest.json")

if __name__ == "__main__":
    main()
