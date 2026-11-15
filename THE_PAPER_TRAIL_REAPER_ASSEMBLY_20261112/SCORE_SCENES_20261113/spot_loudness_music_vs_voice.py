import json,csv,pathlib,subprocess,numpy as np,math
base=pathlib.Path(__file__).resolve().parent
with (base/'MUSIC_REFINEMENT_FULL_ITEM_AUDIT.tsv').open(encoding='utf-8',errors='replace',newline='') as f:
    rows=list(csv.DictReader(f,delimiter='\t'))
scores=[x for x in rows if 'SUNO INSTRUMENTAL SCORE' in x['track'] or 'SUNO ORIGINAL SCENE' in x['track']]
narr=[x for x in rows if 'ELEVENLABS LOGAN  |  NARRATION' in x['track']]
arch=[x for x in rows if 'ARCHIVE' in x['track']]
def slice_source(src,ss,dur=24):
    p=subprocess.run(['ffmpeg','-nostdin','-v','error','-ss',str(max(0,ss)),'-i',src,'-t',str(dur),'-ac','1','-ar','16000','-f','f32le','pipe:1'],capture_output=True)
    if p.returncode or len(p.stdout)<20000:return None
    x=np.frombuffer(p.stdout,dtype='<f4')
    return 20*math.log10(max(1e-10,float(np.sqrt(np.mean(x*x,dtype=np.float64)))))
out={}
for pos in [25,100,230,430,560,850,1070,1480,2010,2395,2660,3200,3590,3740,4060,4300]:
    lines=[]
    for x in scores:
        s=float(x['start']);e=float(x['end'])
        if s<=pos<e:
            gain=float(x['trackvol'])*float(x['itemvol'])*float(x['takevol'])
            duration=min(24,e-pos)
            val=slice_source(x['source'],float(x['offset'])+(pos-s)*float(x['rate']),duration)
            if val is not None:
                eff=val+20*math.log10(max(gain,1e-8))
                lines.append({'track':x['track'].split('|')[-1].strip()[:25],'source_rms':round(val,1),'at_gain_rms':round(eff,1)})
    vo=[]
    for x in narr+arch:
        s=float(x['start']);e=float(x['end'])
        if s<=pos<e and x['source']:
            gain=float(x['trackvol'])*float(x['itemvol'])*float(x['takevol'])
            val=slice_source(x['source'],float(x['offset'])+(pos-s)*float(x['rate']),min(12,e-pos))
            if val is not None:
                vo.append({'role':'Narrator' if x in narr else 'Archive','rms':round(val+20*math.log10(max(gain,1e-8)),1)})
            if len(vo)>3:break
    out[str(pos)]={'music':lines,'voices':vo}
(base/'MUSIC_REFINEMENT_SPOT_LOUDNESS.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
for t,v in out.items():
    print(t,'VOICE',v['voices'],'SCORE',[(i['track'],i['at_gain_rms']) for i in v['music']])
