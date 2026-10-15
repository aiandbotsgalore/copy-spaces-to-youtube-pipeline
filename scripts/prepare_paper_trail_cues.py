#!/usr/bin/env python3
import re
import json
from pathlib import Path

with open('ANGELA_AUDIO_CUE_SHEET.md', 'r', encoding='utf-8') as f:
    cue_md = f.read()

lines = cue_md.splitlines()
cues = []
for l in lines:
    if not l.startswith('|') or 'Cue #' in l or '|---|' in l:
        continue
    parts = [p.strip() for p in l.split('|')[1:-1]]
    if len(parts) >= 8:
        cue_num = parts[0].replace('*', '').strip()
        scene = parts[1]
        qid = parts[2].replace('`', '').strip()
        spk = parts[3]
        ep_raw = parts[4]
        tc = parts[5]
        dur = parts[6]
        desc = parts[7]
        cues.append({
            'cue_num': cue_num,
            'scene': scene,
            'quote_id': qid,
            'speaker': spk,
            'ep_raw': ep_raw,
            'timecode': tc,
            'duration': dur,
            'description': desc
        })

print(f"Total rows in cue sheet: {len(cues)}")

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

already_done = []
needs_cut = []

for c in cues:
    qid = c['quote_id']
    q = qmap.get(qid)
    mf = q.get('master_clip_filename') if q else None
    if mf and mf in man_files:
        already_done.append((c['cue_num'], qid, mf))
        continue
    m_match = next((m for m in man if qid.lower() in m.get('filename', '').lower() or qid.lower() in m.get('id', '').lower()), None)
    if m_match:
        already_done.append((c['cue_num'], qid, m_match.get('filename')))
        continue
    
    # Needs cut: find episode audio and timestamps
    ep_id = q.get('episode_id') if q else None
    if not ep_id:
        m = re.search(r'2026\d{4}_[A-Za-z0-9]+', c['ep_raw'])
        if m: ep_id = m.group(0)
    
    audio_url = summary_map.get(ep_id) if ep_id else None
    needs_cut.append({
        'cue': c,
        'master_quote': q,
        'episode_id': ep_id,
        'audio_url': audio_url
    })

print(f"Already done: {len(already_done)}")
print(f"Needs cut: {len(needs_cut)}")
print()

# Group needs_cut by unique quote_id
unique_needs = {}
for item in needs_cut:
    qid = item['cue']['quote_id']
    if qid not in unique_needs:
        unique_needs[qid] = item

print(f"Unique quotes to extract: {len(unique_needs)}")
for qid, item in list(unique_needs.items())[:15]:
    c = item['cue']
    q = item['master_quote']
    ep = item['episode_id']
    tc = c['timecode']
    dur = c['duration']
    cut_in = q.get('cut_in') if q else None
    cut_out = q.get('cut_out') if q else None
    print(f"[{c['cue_num']}] {qid} | Ep: {ep} | TC: {tc} | Dur: {dur} | Pre-cut: {cut_in}-{cut_out}")
