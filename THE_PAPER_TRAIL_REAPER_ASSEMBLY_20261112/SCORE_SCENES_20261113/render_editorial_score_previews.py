"""Render sample listening checks from unchanged ElevenLabs/archives plus revised RPP original Suno scene cues.
Reference render; does not write to or change the working REAPER project.
"""
from pathlib import Path
import json,numpy as np,subprocess,math,os
base=Path(__file__).resolve().parent.parent
q=base/'SCORE_SCENES_20261113'
report=json.loads((q/'SCENE_MIX_REFINEMENT_VERIFIED.json').read_text(encoding='utf8'))
cues=json.loads((q/'SELECTED_SCENE_CUES_AND_PLACEMENTS.json').read_text(encoding='utf8'))['cues']
scene_info={x['id']:x for x in cues}
work=base/'THE_PAPER_TRAIL_LOGAN_LABELS_REMOVED_SUNO_VISIBLE_v7.RPP'
lines=work.read_bytes().decode('utf8','surrogateescape').splitlines()
idx=next(i for i,s in enumerate(lines) if 'SUNO ORIGINAL SCENE SCORE' in s and s.lstrip().startswith('NAME '))
p0=next(i for i in range(idx,len(lines)) if lines[i].strip()=='<VOLENV2')
p1=next(i for i in range(p0+1,len(lines)) if lines[i].strip()=='>')
pts=[x.strip().split() for x in lines[p0:p1] if x.strip().startswith('PT ')]
times=np.array([float(x[1]) for x in pts]);levels=np.array([float(x[2]) for x in pts])
assert len(times)==report['score_envelope_points_new']
SR=24000
# Existing v7 mix was rendered BEFORE the distinct user-downloaded music was imported.
old=base/'THE_PAPER_TRAIL_LOGAN_NO_AQ_LABELS_SUNO_SCORE_v7.mp3'
if not old.is_file():raise FileNotFoundError(old)
previews=[
 ('PROLOGUE',17,142),
 ('SAV_SCENE',2383,2518),
 ('PUBLIC_MESSAGES',2611,2746),
 ('EPILOGUE',4283,4418)]
def read(src,ss,duration):
 cmd=['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-ss',str(max(ss,0)),'-i',str(src),
 '-t',str(duration),'-ac','2','-ar',str(SR),'-f','f32le','pipe:1']
 r=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if r.returncode:raise RuntimeError(r.stderr.decode('utf8','replace')[-400:])
 z=np.frombuffer(r.stdout,dtype='<f4')
 if z.size%2:z=z[:-1]
 return z.reshape(-1,2)
def rms_peak(audio):
 a=np.abs(audio)
 return (round(20*math.log10(max(1e-9,float(np.sqrt(np.mean(audio*audio,dtype=np.float64))))),2),
         round(20*math.log10(max(1e-9,float(a.max()))),2))
out=[]
for name,start,end in previews:
 total=round((end-start)*SR)
 bed=read(old,start,end-start)
 if len(bed)<total-1000:raise RuntimeError('Missing existing base audio for '+name)
 if len(bed)>total:bed=bed[:total]
 mix=bed.astype(np.float32,copy=True)
 used=[]
 for v in report['placements']:
  if v['end']<=start or v['position']>=end:continue
  overlapstart=max(start,v['position'])
  overlapend=min(end,v['end'])
  count=int(round((overlapend-overlapstart)*SR))
  if count<=0:continue
  cue=scene_info[v['id']]
  seek=v['source_offset']+(overlapstart-v['position'])
  src=read(base/cue['filename'],seek,(overlapend-overlapstart)+.02)
  valid=min(count,len(src),len(mix)-round((overlapstart-start)*SR))
  if valid<=0:continue
  t=overlapstart+np.arange(valid,dtype=np.float32)/SR
  gain=np.interp(t,times,levels).astype(np.float32)*float(v['take_gain'])
  elapsed=t-v['position'];remaining=v['end']-t
  fin=4.5 if v['id']=='S05' else 2.7
  fout=6.0 if v['id']=='S05' else 4.5
  gain*=np.minimum(np.clip(elapsed/fin,0,1),np.clip(remaining/fout,0,1))
  at=int(round((overlapstart-start)*SR))
  mix[at:at+valid]+=src[:valid]*gain[:,None]
  used.append(v['id']+'#'+str(v['pass']))
 dry=rms_peak(bed);raw=rms_peak(mix)
 peak=float(np.abs(mix).max())
 attenuation=min(1,.88/max(peak,1e-9))
 mix*=attenuation
 outname=q/('LISTEN_'+name+'_SCORE_REFINEMENT.mp3')
 proc=subprocess.run(['ffmpeg','-y','-nostdin','-hide_banner','-loglevel','error','-f','f32le','-ac','2','-ar',str(SR),'-i','pipe:0',
  '-ar','48000','-c:a','libmp3lame','-b:a','192k',str(outname)],
  input=mix.astype('<f4').tobytes(),stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if proc.returncode:raise RuntimeError('Preview export failed: '+proc.stderr.decode('utf8','replace')[-300:])
 row={'scene':name,'range_s':[start,end],'base_rms_peak_db':dry,'with_new_cue_rms_peak_db':raw,
  'new_score_items':used,'peak_attenuation_db':round(20*math.log10(attenuation),3),
  'preview_file':str(outname),'size':outname.stat().st_size}
 out.append(row)
 print('PREVIEW_OK',json.dumps(row),flush=True)
(q/'LISTENING_PREVIEW_MIX_AUDIT.json').write_text(json.dumps({'previews':out,'caution':'Reference renders from previous three-bed MP3 plus current RPP scene music envelope. They do not include native REAPER plugin processing. Final audition recommended.'},indent=2),encoding='utf8')
