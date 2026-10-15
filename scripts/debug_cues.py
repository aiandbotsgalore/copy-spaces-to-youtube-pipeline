#!/usr/bin/env python3
import re
import json

with open('ANGELA_AUDIO_CUE_SHEET.md', 'r', encoding='utf-8') as f:
    cue_md = f.read()

line = next(l for l in cue_md.splitlines() if 'AQ-0012' in l)
parts = [p.strip() for p in line.split('|')[1:-1]]
print("parts[2]:", repr(parts[2]))
clean_qid = re.search(r'AQ-\d{4}[a-z]?', parts[2]).group(0)
print("clean_qid:", repr(clean_qid))

with open('angela_quotes_master.json', 'r', encoding='utf-8') as f:
    master = json.load(f)
qmap = {q['quote_id']: q for q in master}
print("Found in qmap?", clean_qid in qmap)
if clean_qid in qmap:
    print("Master clip filename:", qmap[clean_qid].get("master_clip_filename"))
