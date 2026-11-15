# Create time-warp for real Suno narrator selections; do not overwrite manuscript or old assemblies.
import csv,json,re
from pathlib import Path
base=Path(__file__).resolve().parent
with (base/'cue_sheet.csv').open(encoding='utf-8-sig',newline='') as f:cues=list(csv.DictReader(f))
aligned=json.loads((base/'SELECTED_OCT4_VOICE_CUE_ALIGNMENTS.json').read_text(encoding='utf-8'))
word_map=json.loads((base/'FULL_EPISODE_SENTENCE_WORD_CUE_MAP.json').read_text(encoding='utf-8'))
segmap={int(s['cue_index']):s for s in aligned['segments']}
adjust=[]
for idx,s in segmap.items():
    c=cues[idx]
    if c['kind']!='narration':raise ValueError('not narrator cue')
    adjust.append({'cue_index':idx,'old_start':float(c['pos']),'old_end':float(c['pos'])+float(c['dur']),
      'old_dur':float(c['dur']),'new_dur':s['duration_s'],
      'path':s['audio_path'],'source_offs':s['offset_s'],
      'source_id':s['audio_id'],'name':c['name'],'text':c['text']})
adjust.sort(key=lambda z:z['old_start'])
# Verify no overlapping narrator replacements.
for a,b in zip(adjust,adjust[1:]):
    if b['old_start']+0.001<a['old_end']:
        print('WARNING overlapping narration guides',a['cue_index'],b['cue_index'],a['old_end'],b['old_start'])
def warped(t):
    shift=0.
    for a in adjust:
        if t<a['old_start']:break
        if t<a['old_end']:
            return t+shift+(t-a['old_start'])*(a['new_dur']/a['old_dur']-1)
        shift+=a['new_dur']-a['old_dur']
    return t+shift
def canon(s):return ''.join(c for c in s.casefold() if c.isalnum())
# Update each individual scored word to exact alignment when its Suno clip is available.
word_by_cue={}
for w in word_map['word_cues']:word_by_cue.setdefault(w['cue_index'],[]).append(w)
corrections=[]
misalign=[]
for jid in ['NARR_01','NARR_07','NARR_09','NARR_10','NARR_15','NARR_17']:
    job=json.loads((base/(jid.replace('NARR_','NARR_JOB_')+'.json')).read_text(encoding='utf-8'))
    align=json.loads((base/(jid+'_selected_alignment.json')).read_text(encoding='utf-8'))
    script=job['script']
    ch=[]
    for x in align['words']:
        ch.extend([x['start_s']]*len(canon(x['word'])))
    for seg in job['segments']:
        ci=seg['cue_index']
        if ci not in segmap:continue
        text=seg['text']
        orig=word_by_cue.get(ci,[])
        tok=list(re.finditer(r"[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*",text))
        if len(orig)!=len(tok):
            misalign.append({'cue':ci,'expected':len(orig),'tokens':len(tok)})
            continue
        for w,match in zip(orig,tok):
            if canon(w['word'])!=canon(match.group()):
                misalign.append({'cue':ci,'word':w['word'],'actual':match.group()})
                continue
            globalpos=seg['start_char']+match.start()
            ix=len(canon(script[:globalpos]))
            if ix>=len(ch):continue
            exact=warped(float(cues[ci]['pos']))+(ch[ix]-segmap[ci]['offset_s'])
            w['time_final']=round(exact,3);w['timing']='Suno recording word alignment'
            corrections.append({'cue_index':ci,'word':w['word'],'old_estimate':w['time_est'],'new_time':round(exact,3)})
# Build keyword hit snap: name contains exact word; original event time_est near word estimated
for fx in word_map['fx']:
    if not fx['name'].startswith('WORD CUE:'):continue
    label=fx['name'].split('WORD CUE:',1)[1].split('|')[0].strip().casefold()
    matches=[w for w in word_map['word_cues'] if w['word'].casefold()==label and 'time_final' in w]
    if not matches:continue
    closest=min(matches,key=lambda w:abs(w['time_est']-fx['pos']))
    if abs(closest['time_est']-fx['pos'])<.6:
        fx['time_final']=closest['time_final']
# Serialize REAPER v3 Lua payload.
def to_lua(v):
    if v is None:return 'nil'
    if isinstance(v,str):return json.dumps(v,ensure_ascii=False)
    if isinstance(v,bool):return 'true' if v else 'false'
    if isinstance(v,(int,float)):return str(round(v,4))
    if isinstance(v,list):return '{'+','.join(to_lua(x) for x in v)+'}'
    if isinstance(v,dict):return '{'+','.join('['+to_lua(k)+']='+to_lua(x) for k,x in v.items())+'}'
    return to_lua(str(v))
lua={'adjustments':adjust,'aligned_word_hits':[x for x in word_map['fx'] if x.get('time_final')],
     'project_end':warped(4890.149)}
(base/'SELECTED_OCT4_REAPER_V3_DATA.lua').write_text('return '+to_lua(lua),encoding='utf-8')
(base/'FULL_EPISODE_WORD_CUE_MAP_ALIGNED.json').write_text(json.dumps(word_map,indent=2,ensure_ascii=False),encoding='utf-8')
(base/'SELECTED_OCT4_REALIGNED_REPORT.json').write_text(json.dumps({
 'selected_voice':aligned['voice_name'],'selected_cues':len(adjust),'all_narration_cues':233,
 'remaining_unrecorded':233-len(adjust),'word_timings_updated':len(corrections),
 'word_match_warnings':misalign[:50],'estimated_final_episode_seconds':round(warped(4890.149),2),
 'original_episode_seconds':4890.149,'source_mp3s':[x['path'] for x in aligned['clips']],
 'cues':[{k:v for k,v in x.items() if k not in ('text',)} for x in adjust]
},indent=2,ensure_ascii=False),encoding='utf-8')
print(json.dumps({'replaced_narrator_cues':len(adjust),'word_timings_corrected':len(corrections),
 'match_warnings':len(misalign),'time_warp_final_duration_s':round(warped(4890.149),2),
 'payload_bytes':(base/'SELECTED_OCT4_REAPER_V3_DATA.lua').stat().st_size}))
