from pathlib import Path
import json,csv,unicodedata
base=Path(__file__).resolve().parent
job=json.loads((base/'PROLOGUE_MISSING_JOB.json').read_text(encoding='utf-8'))
align=json.loads((base/'PROLOGUE_MISSING_selected_alignment.json').read_text(encoding='utf-8'))
old=json.loads((base/'SELECTED_OCT4_REALIGNED_REPORT.json').read_text(encoding='utf-8'))
with (base/'cue_sheet.csv').open(encoding='utf-8-sig',newline='') as f:cues=list(csv.DictReader(f))
v3adj=sorted(old['cues'],key=lambda x:x['old_start'])
def warp(t):
    shift=0.
    for e in v3adj:
        if t<e['old_start']:break
        if t<e['old_end']:
            return t+shift+(t-e['old_start'])*(e['new_dur']/e['old_dur']-1)
        shift+=e['new_dur']-e['old_dur']
    return t+shift
def canon(s):return ''.join(c for c in s.casefold() if c.isalnum())
scriptnorm=canon(job['script'])
audionorm=canon(''.join(w['word'] for w in align['words']))
if scriptnorm!=audionorm:
    import difflib
    ratio=difflib.SequenceMatcher(None,scriptnorm,audionorm,autojunk=False).ratio()
    if ratio<.96:raise ValueError(f'Script/align mismatch: {ratio:.3f}')
tc=[]
for x in align['words']:
    tc.extend([(x['start_s'],x['end_s'])]*len(canon(x['word'])))
out=[]
for s in job['segments']:
    c=cues[s['cue_index']]
    a=len(canon(job['script'][:s['start_char']]))
    b=len(canon(job['script'][:s['end_char']]))-1
    offs=tc[a][0];end=tc[b][1]+.06
    start_old=float(c['pos']);end_old=start_old+float(c['dur'])
    out.append({'cue_index':s['cue_index'],'old_start':round(warp(start_old),4),
      'old_end':round(warp(end_old),4),'old_dur':round(warp(end_old)-warp(start_old),4),
      'new_dur':round(max(.2,end-offs),4),'offset_s':round(offs,4),
      'path':str(base/'PROLOGUE_MISSING_Selected_Oct4_Narration.mp3'),
      'text':s['text'],'source_id':align['clip_id']})
out.sort(key=lambda x:x['old_start'])
def finalwarp(t):
    shift=0.
    for x in out:
        if t<x['old_start']:break
        if t<x['old_end']:return t+shift+(t-x['old_start'])*(x['new_dur']/x['old_dur']-1)
        shift+=x['new_dur']-x['old_dur']
    return t+shift
def to_lua(v):
    if v is None:return 'nil'
    if isinstance(v,str):return json.dumps(v,ensure_ascii=False)
    if isinstance(v,bool):return 'true' if v else 'false'
    if isinstance(v,(int,float)):return str(round(v,5))
    if isinstance(v,list):return '{'+','.join(to_lua(x) for x in v)+'}'
    if isinstance(v,dict):return '{'+','.join('['+to_lua(k)+']='+to_lua(x) for k,x in v.items())+'}'
    return to_lua(str(v))
result={'adjustments':out,'prologue_end_s':round(finalwarp(warp(465.571)),3),'episode_end_s':round(finalwarp(old['estimated_final_episode_seconds']),3),
 'new_voice_segments':len(out),'total_oct4_voice_cues':85+len(out)}
(base/'PROLOGUE_RETIME_V4_DATA.lua').write_text('return '+to_lua(result),encoding='utf-8')
(base/'PROLOGUE_RETIME_V4_REPORT.json').write_text(json.dumps(result,indent=2,ensure_ascii=False),encoding='utf-8')
print(json.dumps({'aligned_additional':len(out),'prologue_end_s':result['prologue_end_s'],'episode_end_s':result['episode_end_s'],
 'total_narration_cues':result['total_oct4_voice_cues'],'durations':[x['new_dur'] for x in out]}))
