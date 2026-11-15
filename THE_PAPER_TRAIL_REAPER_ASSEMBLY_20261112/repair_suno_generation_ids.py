import json
from pathlib import Path
root=Path(__file__).resolve().parent
jobs=[*(f'NARR_{i:02}' for i in range(1,18)),'READ_01','READ_02']
ids=[]
for j in jobs:
    file=root/(j+'_suno_result.json')
    a=json.loads(file.read_text(encoding='utf-8'))
    if not a.get('clip_ids') and a.get('parse_error'):
        raw=a.pop('parse_error').split('\nThis made')[0]
        a.update(json.loads(raw))
        file.write_text(json.dumps(a,ensure_ascii=False,indent=2),encoding='utf-8')
    if len(a.get('clip_ids',[]))!=2:raise ValueError(j+' missing ids')
    for k,clip in enumerate(a['clip_ids']):ids.append({'job_id':j,'take':'A' if k==0 else 'B','id':clip})
(root/'FULL_SUNO_GENERATED_ID_INDEX.json').write_text(json.dumps(ids,indent=2),encoding='utf-8')
print('ALL',len(ids),'TRACKS from',len(jobs),'jobs')
