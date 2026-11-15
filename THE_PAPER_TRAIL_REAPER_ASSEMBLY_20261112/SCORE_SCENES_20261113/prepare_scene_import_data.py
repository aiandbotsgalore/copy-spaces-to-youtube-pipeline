from pathlib import Path
import json
root=Path(__file__).resolve().parent
folder=root/'SCORE_SCENES_20261113'
manifest=json.loads((folder/'SELECTED_SCENE_CUES_AND_PLACEMENTS.json').read_text(encoding='utf-8'))
def lua(x):
 if x is None:return 'nil'
 if isinstance(x,str):return json.dumps(x,ensure_ascii=False)
 if isinstance(x,bool):return 'true' if x else 'false'
 if isinstance(x,(int,float)):return str(x)
 if isinstance(x,list):return '{'+','.join(lua(y) for y in x)+'}'
 if isinstance(x,dict):return '{'+','.join('['+lua(k)+']='+lua(y) for k,y in x.items())+'}'
 return lua(str(x))
(folder/'SCORE_SCENE_IMPORT_DATA.lua').write_text('return '+lua(manifest['cues']),encoding='utf-8')
print('CREATED',len(manifest['cues']),'Suno scene-music import-ready descriptors')
