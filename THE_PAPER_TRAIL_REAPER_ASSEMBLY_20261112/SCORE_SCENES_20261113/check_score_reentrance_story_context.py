from pathlib import Path
import json
b=Path(__file__).resolve().parent.parent
m=json.loads((b/'FULL_EPISODE_WORD_CUE_MAP_ELEVENLABS_v5.json').read_text(encoding='utf8'))
targets=[17,245,427,640,832,1025,1244,1412,1745,2194,2387,2613,2909,3117,3390,3571,3732,3918,4034,4221,4285]
s=[x for x in m['sentences'] if 'text' in x]
for t in targets:
 c=min(s,key=lambda x:abs(x['start']-t))
 print(t,'AT',(round(c['start'],1)),c['text'][:210].replace('\n',' '))
