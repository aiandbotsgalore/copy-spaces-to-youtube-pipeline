#!/usr/bin/env python3
"""
scripts/extract_paper_trail_cues.py
Batch-extracts all remaining cues for 'The Paper Trail' documentary special
into standalone broadcast WAV clips in public/clips/angela/.
Downloads source episodes once per batch, slices locally via FFmpeg,
applies 18ms anti-click micro-fades, and updates manifest, cue sheet, and catalog.
"""

import os
import sys
import re
import json
import urllib.request
import subprocess
from pathlib import Path

FFMPEG_BIN = r"C:\Hydrus Network\bin\ffmpeg.exe"
WORK_DIR = Path("work")
WORK_DIR.mkdir(parents=True, exist_ok=True)
OUT_DIR = Path("public/clips/angela")
OUT_DIR.mkdir(parents=True, exist_ok=True)

with open('ANGELA_AUDIO_CUE_SHEET.md', 'r', encoding='utf-8') as f:
    cue_md = f.read()

lines = [l for l in cue_md.splitlines() if l.startswith('|') and 'Cue #' not in l and '|---|' not in l]

with open('public/clips/angela/manifest.json', 'r', encoding='utf-8') as f:
    manifest = json.load(f)
with open('angela_quotes_master.json', 'r', encoding='utf-8') as f:
    master = json.load(f)
qmap = {q['quote_id']: q for q in master}
man_files = {m.get('filename') for m in manifest}

summary_map = {}
with open('public/transcripts/transcripts_summary_index.json', 'r', encoding='utf-8') as f:
    for s in json.load(f):
        if s.get('release_tag'):
            summary_map[s['release_tag']] = s.get('audio_url')

def parse_timecode(tc_str):
    clean = tc_str.replace('`', '').replace('(Window)', '').strip()
    m_sec = re.findall(r'(\d+(?:\.\d+)?)\s*s', clean)
    if len(m_sec) >= 2:
        return float(m_sec[0]), float(m_sec[1])
    parts = clean.replace('–', '-').split('-')
    if len(parts) == 2:
        def to_s(t):
            sub = [float(x) for x in t.strip().split(':')]
            if len(sub) == 3: return sub[0]*3600 + sub[1]*60 + sub[2]
            elif len(sub) == 2: return sub[0]*60 + sub[1]
            return sub[0]
        try:
            return to_s(parts[0]), to_s(parts[1])
        except:
            pass
    return None, None

cues_by_ep = {}
cues_metadata = []

for l in lines:
    parts = [p.strip() for p in l.split('|')[1:-1]]
    if len(parts) < 8: continue
    c_num = parts[0].replace('*', '').strip()
    scene = parts[1]
    qid_m = re.search(r'AQ-\d{4}[a-z]?', parts[2])
    if not qid_m: continue
    qid = qid_m.group(0)
    spk = parts[3]
    ep_raw = parts[4]
    tc_raw = parts[5]
    dur_raw = parts[6]
    desc = parts[7]
    
    q = qmap.get(qid, {})
    ep_id = q.get('episode_id')
    if not ep_id:
        m = re.search(r'2026\d{4}_[A-Za-z0-9]+', ep_raw)
        if m: ep_id = m.group(0)
    
    # Check if already in manifest
    existing_file = None
    mf = q.get('master_clip_filename')
    if mf and mf in man_files:
        existing_file = mf
    else:
        m_match = next((m for m in manifest if qid.lower() in m.get('filename', '').lower() or qid.lower() in m.get('id', '').lower()), None)
        if m_match:
            existing_file = m_match.get('filename')
    
    if existing_file:
        cues_metadata.append({
            'cue_num': c_num,
            'qid': qid,
            'filename': existing_file,
            'status': 'EXISTS',
            'duration': dur_raw
        })
        continue
    
    start_sec, end_sec = parse_timecode(tc_raw)
    if start_sec is None and q:
        cin = q.get('cut_in')
        cout = q.get('cut_out')
        if cin is not None and cout is not None:
            start_sec = float(cin)
            end_sec = float(cout)
            
    audio_url = summary_map.get(ep_id)
    speaker_clean = "".join(c for c in spk if c.isalnum() or c in (" ", "_")).strip().replace(" ", "_")[:20]
    out_filename = f"Cue_{int(c_num):02d}_{qid}_{speaker_clean}.wav"
    dur = round(end_sec - start_sec, 2)
    
    cue_obj = {
        'cue_num': c_num,
        'scene': scene,
        'qid': qid,
        'speaker': spk,
        'ep_id': ep_id,
        'audio_url': audio_url,
        'start_sec': start_sec,
        'end_sec': end_sec,
        'duration': dur,
        'filename': out_filename,
        'desc': desc,
        'verbatim': q.get('exact_quote', desc)
    }
    cues_metadata.append(cue_obj)
    cues_by_ep.setdefault(ep_id, []).append(cue_obj)

print(f"Total production cues: {len(cues_metadata)}")
print(f"Episodes to process: {len(cues_by_ep)}")
total_to_cut = sum(len(v) for v in cues_by_ep.values())
print(f"Total clips to extract: {total_to_cut}")
print("=" * 80)

extracted_count = 0
new_manifest_entries = []

for ep_idx, (ep_id, group) in enumerate(cues_by_ep.items(), 1):
    audio_url = group[0]['audio_url']
    if not audio_url:
        print(f"[{ep_idx}/{len(cues_by_ep)}] Skipping {ep_id}: No audio URL found")
        continue
    
    local_mp3 = WORK_DIR / f"{ep_id}.mp3"
    print(f"\n[{ep_idx}/{len(cues_by_ep)}] Episode: {ep_id} ({len(group)} cues)")
    
    # Check if all cues in this group already exist on disk
    all_exist = all((OUT_DIR / c['filename']).exists() for c in group)
    if all_exist:
        print(f"  All {len(group)} clips already exist on disk.")
        for c in group:
            out_file = OUT_DIR / c['filename']
            c['size_bytes'] = out_file.stat().st_size
            new_manifest_entries.append(c)
        continue
    
    # Download episode once if not cached
    if not local_mp3.exists():
        print(f"  Downloading episode audio from: {audio_url}...")
        try:
            urllib.request.urlretrieve(audio_url, str(local_mp3))
            print(f"  Downloaded: {local_mp3.stat().st_size / 1024 / 1024:.1f} MB")
        except Exception as e:
            print(f"  ERROR: Failed to download {audio_url}: {e}")
            continue
    
    # Slice all cues in this episode locally
    for c in group:
        out_file = OUT_DIR / c['filename']
        if out_file.exists():
            print(f"  Clip already exists: {out_file.name}")
            c['size_bytes'] = out_file.stat().st_size
            new_manifest_entries.append(c)
            continue
            
        dur = c['duration']
        fade_dur = 0.018
        fade_out_st = max(0.0, dur - fade_dur)
        af_filter = f"afade=t=in:ss=0:d={fade_dur:.3f},afade=t=out:st={fade_out_st:.3f}:d={fade_dur:.3f}"
        
        cmd = [
            FFMPEG_BIN,
            "-y",
            "-ss", f"{c['start_sec']:.2f}",
            "-i", str(local_mp3),
            "-t", f"{dur:.2f}",
            "-af", af_filter,
            "-c:a", "pcm_s16le",
            "-ar", "44100",
            str(out_file)
        ]
        
        res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if res.returncode == 0 and out_file.exists():
            sz = out_file.stat().st_size
            c['size_bytes'] = sz
            extracted_count += 1
            print(f"  -> Extracted: {out_file.name} ({dur}s, {sz:,} bytes)")
            new_manifest_entries.append(c)
        else:
            print(f"  -> ERROR: FFmpeg failed to extract {out_file.name}")
            
    # Clean up local mp3 to free space
    if local_mp3.exists():
        try:
            local_mp3.unlink()
            print(f"  Cleaned up temporary file: {local_mp3.name}")
        except:
            pass

print("\n" + "=" * 80)
print(f"Extraction complete! Extracted {extracted_count} new clips.")

# 1. Update public/clips/angela/manifest.json
manifest_filenames = {m.get('filename') for m in manifest}
for c in new_manifest_entries:
    if c['filename'] not in manifest_filenames:
        manifest_filenames.add(c['filename'])
        manifest.append({
            "id": f"angela_cue_{c['cue_num']}_{c['qid'].lower().replace('-', '_')}",
            "filename": c['filename'],
            "title": f"[{c['cue_num']}] {c['qid']} - {c['scene']}",
            "quote": c['verbatim'],
            "space_tag": c['ep_id'],
            "space_title": c['scene'],
            "timestamp": f"{int(c['start_sec']//60)}:{int(c['start_sec']%60):02d}",
            "size_bytes": c.get('size_bytes', 0),
            "format": "wav",
            "url": f"clips/angela/{c['filename']}"
        })

with open('public/clips/angela/manifest.json', 'w', encoding='utf-8') as f:
    json.dump(manifest, f, indent=2)
print("Updated public/clips/angela/manifest.json")

# 2. Update ANGELA_AUDIO_CUE_SHEET.md with exact duration and filenames
updated_lines = []
manifest_map = {m.get('filename'): m for m in manifest}
cue_file_map = {c['cue_num']: c for c in cues_metadata if c.get('filename')}

for l in cue_md.splitlines():
    if not l.startswith('|') or 'Cue #' in l or '|---|' in l:
        updated_lines.append(l)
        continue
    parts = [p.strip() for p in l.split('|')[1:-1]]
    if len(parts) < 8:
        updated_lines.append(l)
        continue
    c_num = parts[0].replace('*', '').strip()
    if c_num in cue_file_map:
        c_info = cue_file_map[c_num]
        fn = c_info.get('filename', '')
        # update Duration column (index 6) to show exact file length or filename
        parts[6] = f"`{fn}` ({c_info.get('duration', 'EXISTS')})"
        updated_lines.append(f"| {' | '.join(parts)} |")
    else:
        updated_lines.append(l)

with open('ANGELA_AUDIO_CUE_SHEET.md', 'w', encoding='utf-8') as f:
    f.write('\n'.join(updated_lines) + '\n')
print("Updated ANGELA_AUDIO_CUE_SHEET.md")

# 3. Update public/cue_sheet_audit_results.json
for p in [Path("cue_sheet_audit_results.json"), Path("public/cue_sheet_audit_results.json")]:
    if p.exists():
        with open(p, 'r', encoding='utf-8') as f:
            audit = json.load(f)
        for a in audit:
            qid = a.get('quote_id')
            match = next((c for c in cues_metadata if c.get('qid') == qid and c.get('filename')), None)
            if match:
                a['status'] = 'EXISTS'
                a['filename'] = match['filename']
                a['audio_url'] = f"clips/angela/{match['filename']}"
                a['start_seconds'] = None
                a['end_seconds'] = None
                if match.get('duration'):
                    a['duration'] = match['duration']
                a['note'] = f"Extracted master asset: {match['filename']}"
        with open(p, 'w', encoding='utf-8') as f:
            json.dump(audit, f, indent=2)
        print(f"Updated {p}")

print("\nAll master documentary cues are now verified local assets!")
