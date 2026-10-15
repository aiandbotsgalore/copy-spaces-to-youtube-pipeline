"""
Direct Local Extractor for Angela Maggard Quotes from D:\\Angela Project\\audio_source
Extracts verbatim audio clips directly from local Space MP3s using accurate transcript timecodes,
applying 18ms anti-click micro-fades, and registering them directly in public/clips/angela/manifest.json.
Zero network downloads.
"""

import json
import re
import subprocess
from pathlib import Path

FFMPEG_BIN = r"C:\Hydrus Network\bin\ffmpeg.exe"
AUDIO_SOURCE_DIR = Path(r"D:\Angela Project\audio_source")
OUT_DIR = Path("public/clips/angela")
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Episode ID to local MP3 mapping
EPISODE_FILE_MAP = {
    "20260906_1nGnRBnpYdXGO": "20260906_1nGnRBnpYdXGO_Uncensored_Truth.mp3",
    "20260907_1OxwbneDwBqJB": "20260907_1OxwbneDwBqJB_Crackheads.mp3",
    "20260908_1nGeLMjONkAKX": "20260908_1nGeLMjONkAKX_Hook_Line_Sinker.mp3",
    "20260908_1wxWjlrwXokJQ": "20260908_1wxWjlrwXokJQ_Petty_Space.mp3",
    "20260913_1lJQRWAWpvVxE": "20260913_1lJQRWAWpvVxE_Oor_Brought_a_Chipper.mp3",
    "20260916_1YxNrbXNjQLxw": "20260916_1YxNrbXNjQLxw_Space_Invaders.mp3",
    "20260918_1AxRnZMeZNYxl": "20260918_1AxRnZMeZNYxl_Angela_Maggard_fan_club.mp3",
    "20260918_1MJgNbdaAPlGL": "20260918_1MJgNbdaAPlGL_Logan_Unmasked.mp3",
}

with open("angela_quotes_master.json", "r", encoding="utf-8") as f:
    master_quotes = json.load(f)

with open("public/clips/angela/manifest.json", "r", encoding="utf-8") as f:
    manifest = json.load(f)

existing_filenames = {m.get("filename") for m in manifest}
existing_ids = {m.get("id") for m in manifest}

# Filter to the 8 local episodes
target_quotes = [q for q in master_quotes if q.get("episode_id") in EPISODE_FILE_MAP]

print(f"Total quotes in 8 local episodes: {len(target_quotes)}")

extracted_count = 0
added_manifest_entries = []

for idx, q in enumerate(target_quotes, 1):
    qid = q["quote_id"]
    ep_id = q["episode_id"]
    speaker = q.get("speaker", "Angela")
    exact_quote = q.get("exact_quote", "")
    ep_title = q.get("episode_title", "Twitter Space")
    
    mp3_name = EPISODE_FILE_MAP.get(ep_id)
    if not mp3_name:
        continue
    source_mp3 = AUDIO_SOURCE_DIR / mp3_name
    if not source_mp3.exists():
        print(f"[{idx}/{len(target_quotes)}] Missing source MP3: {source_mp3}")
        continue

    # Load transcript for precise timecodes
    transcript_path = Path(f"public/transcripts/episodes/{ep_id}.json")
    if not transcript_path.exists():
        print(f"[{idx}/{len(target_quotes)}] Missing transcript: {transcript_path}")
        continue
    with open(transcript_path, "r", encoding="utf-8") as tf:
        transcript = json.load(tf)

    st_time, end_time = None, None

    # Priority 1: Verified explicit cut_in / cut_out
    if q.get("cut_in") is not None and q.get("cut_out") is not None:
        st_time = float(q["cut_in"])
        end_time = float(q["cut_out"])
    else:
        # Priority 2: Verbatim transcript alignment
        sw = q.get("transcript_search_window", "")
        sw_sec = None
        m_win = re.findall(r"(\d+):(\d+):(\d+)", sw)
        if len(m_win) == 2:
            st = float(int(m_win[0][0]) * 3600 + int(m_win[0][1]) * 60 + int(m_win[0][2]))
            en = float(int(m_win[1][0]) * 3600 + int(m_win[1][1]) * 60 + int(m_win[1][2]))
            sw_sec = (st, en)

        words = re.findall(r"\b\w+\b", exact_quote.lower())
        candidates = transcript.get("segments", [])
        if sw_sec:
            # narrow candidate segments to search window with 60s padding
            narrowed = [s for s in candidates if not (s["end"] < sw_sec[0] - 60 or s["start"] > sw_sec[1] + 60)]
            if narrowed:
                candidates = narrowed

        for n in [8, 6, 5, 4, 3, 2]:
            first_n = " ".join(words[:n])
            for s in candidates:
                s_clean = " ".join(re.findall(r"\b\w+\b", s["text"].lower()))
                pos = s_clean.find(first_n)
                if pos != -1:
                    frac = pos / max(1, len(s_clean))
                    st_time = s["start"] + frac * (s["end"] - s["start"])
                    break
            if st_time is not None:
                break

        for n in [8, 6, 5, 4, 3, 2]:
            last_n = " ".join(words[-n:])
            for s in candidates:
                s_clean = " ".join(re.findall(r"\b\w+\b", s["text"].lower()))
                pos = s_clean.find(last_n)
                if pos != -1:
                    frac = (pos + len(last_n)) / max(1, len(s_clean))
                    end_time = s["start"] + frac * (s["end"] - s["start"])
                    break
            if end_time is not None:
                break

        if st_time is not None and (end_time is None or end_time <= st_time):
            end_time = st_time + max(4.0, len(words) / 2.5)

        if st_time is None and sw_sec:
            st_time, end_time = sw_sec

    if st_time is None or end_time is None:
        print(f"[{idx}/{len(target_quotes)}] Could not resolve timecodes for {qid}")
        continue

    # Add small lead-in and lead-out padding (0.15s) for natural speech cadences
    st_time = max(0.0, st_time - 0.15)
    end_time = end_time + 0.15
    duration = round(end_time - st_time, 2)

    # Sanity checks
    if duration < 0.5:
        print(f"[{idx}/{len(target_quotes)}] Duration too short for {qid}: {duration}s")
        continue

    # Filename format: e.g. AQ-0001_Angela_Maggard.wav
    speaker_slug = "".join(c for c in speaker if c.isalnum() or c in (" ", "_")).strip().replace(" ", "_")[:20]
    out_filename = f"{qid}_{speaker_slug}.wav"
    out_path = OUT_DIR / out_filename

    # Check if already exists in manifest and on disk
    entry_id = f"angela_quote_{qid.lower().replace('-', '_')}"
    if out_filename in existing_filenames and out_path.exists():
        # Ensure it has all required fields in manifest
        continue

    # Extract with FFmpeg locally with 18ms anti-click micro-fades
    fade_dur = 0.018
    fade_out_st = max(0.0, duration - fade_dur)
    af_filter = f"afade=t=in:ss=0:d={fade_dur:.3f},afade=t=out:st={fade_out_st:.3f}:d={fade_dur:.3f}"

    cmd = [
        FFMPEG_BIN,
        "-y",
        "-ss", f"{st_time:.2f}",
        "-i", str(source_mp3),
        "-t", f"{duration:.2f}",
        "-af", af_filter,
        "-c:a", "pcm_s16le",
        "-ar", "44100",
        str(out_path)
    ]

    res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if res.returncode == 0 and out_path.exists():
        sz = out_path.stat().st_size
        extracted_count += 1
        print(f"[{idx}/{len(target_quotes)}] Extracted {out_filename} ({duration}s, {sz:,} bytes)")

        # Prepare manifest entry
        category = q.get("category", "Retaliation & Disclosure")
        manifest_item = {
            "id": entry_id,
            "filename": out_filename,
            "title": f"[{qid}] {q.get('category', 'Quote')}",
            "quote": exact_quote,
            "speaker": speaker,
            "space_tag": ep_id,
            "space_title": ep_title.replace("_", " "),
            "timestamp": f"{int(st_time // 60)}:{int(st_time % 60):02d}",
            "size_bytes": sz,
            "format": "wav",
            "url": f"clips/angela/{out_filename}",
            "quote_id": qid,
            "category": category
        }
        added_manifest_entries.append(manifest_item)
        existing_filenames.add(out_filename)
        existing_ids.add(entry_id)
    else:
        print(f"[{idx}/{len(target_quotes)}] ERROR: FFmpeg failed on {out_filename}")

# Update manifest.json
if added_manifest_entries:
    manifest.extend(added_manifest_entries)
    with open("public/clips/angela/manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    print(f"\nSuccessfully added {len(added_manifest_entries)} clips to public/clips/angela/manifest.json")

print(f"\nAll done! Extracted {extracted_count} local verbatim clips.")
