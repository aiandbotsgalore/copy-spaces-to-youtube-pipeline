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
    # Check "123.4s – 567.8s"
    m_sec = re.findall(r'(\d+(?:\.\d+)?)\s*s', clean)
    if len(m_sec) >= 2:
        return float(m_sec[0]), float(m_sec[1])
    # Check "HH:MM:SS–HH:MM:SS"
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

cues_data = []
already_done_count = 0
needs_extract_count = 0

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
        already_done_count += 1
        cues_data.append({
            'cue_num': c_num,
            'scene': scene,
            'qid': qid,
            'speaker': spk,
            'status': 'EXISTS',
            'filename': existing_file,
            'audio_url': f"clips/angela/{existing_file}",
            'desc': desc
        })
        continue
    
    # Needs extraction: resolve start_sec and end_sec
    start_sec, end_sec = parse_timecode(tc_raw)
    if start_sec is None and q:
        cin = q.get('cut_in')
        cout = q.get('cut_out')
        if cin is not None and cout is not None:
            start_sec = float(cin)
            end_sec = float(cout)
    
    audio_url = summary_map.get(ep_id)
    needs_extract_count += 1
    cues_data.append({
        'cue_num': c_num,
        'scene': scene,
        'qid': qid,
        'speaker': spk,
        'status': 'NEEDS_EXTRACTION',
        'ep_id': ep_id,
        'audio_url': audio_url,
        'start_sec': start_sec,
        'end_sec': end_sec,
        'duration': round(end_sec - start_sec, 2) if (start_sec is not None and end_sec is not None) else None,
        'tc_raw': tc_raw,
        'desc': desc,
        'verbatim': q.get('exact_quote', '')
    })

print(f"Total Cues in Sheet: {len(cues_data)}")
print(f"Already Exists on Disk: {already_done_count}")
print(f"Needs Extraction: {needs_extract_count}")

missing_times = [c for c in cues_data if c['status'] == 'NEEDS_EXTRACTION' and (c['start_sec'] is None or c['end_sec'] is None)]
print(f"Needs Extraction with Valid Timestamps: {needs_extract_count - len(missing_times)}")
print(f"Missing Timestamps: {len(missing_times)}")
for m in missing_times:
    print(f"  Missing: Cue {m['cue_num']} | {m['qid']} | Ep: {m['ep_id']} | TC: {m['tc_raw']}")
