import csv,json,re,math
from pathlib import Path
base=Path(__file__).resolve().parent
with (base/'cue_sheet.csv').open(encoding='utf-8-sig',newline='') as f: cues=list(csv.DictReader(f))
for i,c in enumerate(cues): c['cue_index']=i
voice="ae6cd7ee-670a-4757-905b-08c31640cd29"
def text_clean(s):
    s=re.sub(r'\*([^*]+)\*',r'\1',s)
    s=re.sub(r'\s+',' ',s).strip()
    return s
narr=[x for x in cues if x['kind']=='narration']
jobs=[]
group=[]; n=0
maxsize=2160
for x in narr:
    text=text_clean(x['text'])
    if group and n+len(text)+2>maxsize:
        jobs.append(group);group=[];n=0
    group.append((x,text));n+=len(text)+2
if group:jobs.append(group)
result=[]
for i,group in enumerate(jobs):
    passages=[]
    cursor=0
    segments=[]
    for c,t in group:
        if passages: cursor+=2
        start=cursor
        passages.append(t);cursor+=len(t)
        segments.append({"cue_index":c['cue_index'],"text":t,"start_char":start,"end_char":cursor,"orig_pos":float(c['pos'])})
    full="\n\n".join(passages)
    row={"job_id":f"NARR_{i+1:02d}","kind":"narration","voice_id":voice,"script":full,
         "title":f"THE PAPER TRAIL - Logan Narration Part {i+1:02d} of {len(jobs):02d}",
         "segments":segments,"char_count":len(full),"word_count":len(full.split())}
    result.append(row)
    (base/f'NARR_JOB_{i+1:02d}.json').write_text(json.dumps(row,ensure_ascii=False,indent=2),encoding='utf-8')
readings=[x for x in cues if x['kind']=='reading']
# keep all readings exactly as separate passages; synthetic characters will be performed readings, not historical voice recordings.
rjobs=[]
rg=[];rn=0
for x in readings:
    t=text_clean(x['text'])
    if rg and rn+len(t)+2>1650:
        rjobs.append(rg);rg=[];rn=0
    rg.append((x,t));rn+=len(t)+2
if rg:rjobs.append(rg)
for i,group in enumerate(rjobs):
    segs=[];texts=[];cursor=0
    for c,t in group:
        if texts:cursor+=2
        segs.append({"cue_index":c['cue_index'],"text":t,"start_char":cursor,"end_char":cursor+len(t),"orig_pos":float(c['pos'])})
        texts.append(t);cursor+=len(t)
    row={"job_id":f"READ_{i+1:02d}","kind":"reading","script":"\n\n".join(texts),"title":f"THE PAPER TRAIL - Performed Written Messages {i+1:02d}","segments":segs,"char_count":cursor,"word_count":sum(len(x.split()) for x in texts)}
    (base/f'READ_JOB_{i+1:02d}.json').write_text(json.dumps(row,ensure_ascii=False,indent=2),encoding='utf-8')
    result.append(row)
manifest={"voice_id":voice,"jobs":[{k:v for k,v in x.items() if k!="script" and k!="segments"} for x in result],
          "job_count":len(result),"narration_count":len(jobs),"reading_count":len(rjobs),
          "total_words":sum(x['word_count'] for x in result),"total_chars":sum(x['char_count'] for x in result)}
(base/'FULL_NARRATION_JOB_MANIFEST.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(manifest,ensure_ascii=False))
