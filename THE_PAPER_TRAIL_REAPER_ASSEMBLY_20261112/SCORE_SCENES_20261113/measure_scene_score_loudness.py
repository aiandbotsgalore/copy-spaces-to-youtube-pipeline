from pathlib import Path
import subprocess,json,math,numpy as np
root=Path(__file__).resolve().parent.parent
m=json.loads((root/'SCORE_SCENES_20261113/SELECTED_SCENE_CUES_AND_PLACEMENTS.json').read_text(encoding='utf8'))
rows=[]
for c in m['cues']:
 path=root/c['filename']
 t=min(40, max(0,c['verified_duration']-55))
 z=subprocess.run(['ffmpeg','-nostdin','-v','error','-ss',str(t),'-i',str(path),'-t','38','-ac','1','-ar','24000','-f','f32le','pipe:1'],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 a=np.frombuffer(z.stdout,dtype='<f4')
 if len(a)==0:raise RuntimeError('bad '+c['id'])
 rms=float(np.sqrt(np.mean(a*a,dtype=np.float64)));p=float(np.max(abs(a)))
 rows.append({'id':c['id'],'source_rms_db':round(20*math.log10(max(rms,1e-9)),2),'source_peak_db':round(20*math.log10(max(p,1e-9)),2),'current_gain_db':round(20*math.log10(c['gain']),1)})
 print(rows[-1],flush=True)
(root/'SCORE_SCENES_20261113/SCENE_SCORE_SOURCE_LOUDNESS.json').write_text(json.dumps(rows,indent=2),encoding='utf-8')
