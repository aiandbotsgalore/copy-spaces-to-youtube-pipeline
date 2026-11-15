# Align selected correct Oct 4 Suno narrator takes against each original script cue.
# Source speaker is the user's authorized custom Suno voice.
import json,re,unicodedata,difflib,subprocess
from pathlib import Path
from bisect import bisect_left
base=Path(__file__).resolve().parent
jobs=['NARR_01','NARR_07','NARR_09','NARR_10','NARR_15','NARR_17']
def canon(s): return ''.join(c for c in s.casefold() if c.isalnum())
allclips=[];allsegs=[];stats=[]
for j in jobs:
    job=json.loads((base/(j.replace('NARR_','NARR_JOB_')+'.json')).read_text(encoding='utf-8'))
    align=json.loads((base/(j+'_selected_alignment.json')).read_text(encoding='utf-8'))
    mp3=base/(j+'_Selected_Oct4_Narration.mp3')
    if not mp3.is_file() or mp3.stat().st_size<10000:
        raise RuntimeError('MP3 not ready '+str(mp3))
    script=job['script']
    a=''.join(w['word'] for w in align['words'])
    scriptnorm=canon(script);audionorm=canon(a)
    ratio=difflib.SequenceMatcher(None,scriptnorm,audionorm,autojunk=False).ratio()
    timing=[]
    for w in align['words']:
        timing.extend([(w['start_s'],w['end_s'],bool(w.get('success',True)))] * len(canon(w['word'])))
    if len(timing)!=len(audionorm):raise ValueError('alignment mismatch '+j)
    mapidx={}
    matching=difflib.SequenceMatcher(None,scriptnorm,audionorm,autojunk=False)
    for typ,i1,i2,j1,j2 in matching.get_opcodes():
        if typ=='equal':
            for ix in range(i1,i2):mapidx[ix]=j1+ix-i1
    matched=sorted(mapidx)
    if not matched:continue
    def ix_to_time(ix,kind='start'):
        pos=min(range(len(matched)),key=lambda k:abs(matched[k]-ix))
        aidx=mapidx[matched[pos]]
        aidx=max(0,min(len(timing)-1,aidx))
        return timing[aidx][0 if kind=='start' else 1]
    segments=[]
    for seg in job['segments']:
        s0=len(canon(script[:seg['start_char']]))
        s1=len(canon(script[:seg['end_char']]))-1
        t0=ix_to_time(s0)
        t1=ix_to_time(s1,'end')
        if t1-t0<.10:t1=t0+max(.50,len(seg['text'].split())*.36)
        # Preserve a small natural breath after each passage; cap to next passage boundary in source.
        t1=t1+.10
        segments.append({"cue_index":seg['cue_index'],"job_id":j,"audio_path":str(mp3),
             "audio_id":align['clip_id'],"offset_s":round(t0,3),"end_s":round(t1,3),
             "duration_s":round(t1-t0,3),"script_text":seg['text'],
             "source_time_est":round(seg['orig_pos'],3),"ratio":round(ratio,4)})
    stats.append({"job":j,"ratio":round(ratio,4),"cue_count":len(segments),"duration_end_s":round(segments[-1]['end_s'],3),
                  "last_alignment_s":align['words'][-1]['end_s']})
    allsegs.extend(segments)
    allclips.append({"job_id":j,"audio_id":align['clip_id'],"path":str(mp3),"segments":len(segments),"ratio":round(ratio,4)})
out={"voice_name":"My Podcast Voice - Oct 4","voice_id":"ae6cd7ee-670a-4757-905b-08c31640cd29",
     "segments":allsegs,"clips":allclips,"stats":stats,
     "verification":"Suno automatic lyric alignment; exact word positions are best-effort; final listening inspection needed"}
(base/'SELECTED_OCT4_VOICE_CUE_ALIGNMENTS.json').write_text(json.dumps(out,indent=2,ensure_ascii=False),encoding='utf-8')
print(json.dumps({"clips":len(allclips),"aligned_cues":len(allsegs),"stats":stats},ensure_ascii=False))
