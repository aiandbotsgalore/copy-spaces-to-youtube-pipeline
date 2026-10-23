#!/usr/bin/env python3
import re
import json
from pathlib import Path

with open('ANGELA_AUDIO_CUE_SHEET.md', 'r', encoding='utf-8') as f:
    cue_md = f.read()

lines = [l for l in cue_md.splitlines() if l.startswith('|') and 'Cue #' not in l and '|---|' not in l]

with open('public/clips/angela/manifest.json', 'r', encoding='utf-8') as f:
    man = json.load(f)
with open('angela_quotes_master.json', 'r', encoding='utf-8') as f:
    master = json.load(f)
qmap = {q['quote_id']: q for q in master}
man_files = {m.get('filename') for m in man}

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

to_extract = []
already_done = []

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
        m_match = next((m for m in man if qid.lower() in m.get('filename', '').lower() or qid.lower() in m.get('id', '').lower()), None)
        if m_match:
            existing_file = m_match.get('filename')
    
    if existing_file:
        already_done.append((c_num, qid, existing_file))
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
    
    to_extract.append({
        'cue_num': c_num,
        'scene': scene,
        'qid': qid,
        'speaker': spk,
        'ep_id': ep_id,
        'audio_url': audio_url,
        'start_sec': start_sec,
        'end_sec': end_sec,
        'duration': round(end_sec - start_sec, 2),
        'filename': out_filename,
        'desc': desc,
        'verbatim': q.get('exact_quote', desc)
    })

print(f"Total Cues in Sheet: {len(lines)}")
print(f"Already on disk: {len(already_done)}")
print(f"To extract: {len(to_extract)}")
print()
print(f"{'Cue':<6} {'Quote ID':<10} {'Start':<8} {'End':<8} {'Dur':<6} {'Filename':<35} {'Episode'}")
print("-" * 95)
for it in to_extract[:20]:
    print(f"{it['cue_num']:<6} {it['qid']:<10} {it['start_sec']:<8.1f} {it['end_sec']:<8.1f} {it['duration']:<6.1f} {it['filename']:<35} {it['ep_id']}")
