"""Final musical editorial correction: leave the authentic opening quote entirely dry.
Modify only the first 10s of volume automation in three EXISTING Suno tracks.
No other item, voice, archive, or music file changes; no new project.
"""
from pathlib import Path
import json,re,hashlib,os,shutil,bisect,sys
base=Path(__file__).resolve().parent.parent
path=base/'THE_PAPER_TRAIL_LOGAN_LABELS_REMOVED_SUNO_VISIBLE_v7.RPP'
raw=path.read_bytes()
s=raw.decode('utf8','surrogateescape')
lines=s.splitlines(keepends=True)
# Locate each named track and the first envelope within its own block.
names=('SUNO INSTRUMENTAL SCORE  |  INVESTIGATION','SUNO INSTRUMENTAL SCORE  |  TRUST','SUNO INSTRUMENTAL SCORE  |  SIGNATURE')
tracknames=[i for i,l in enumerate(lines) if any(n in l and 'NAME ' in l for n in names)]
assert len(tracknames)==3,tracknames
repl=[]
report=[]
for name_index in tracknames:
 name=lines[name_index].strip()
 envstart=next(i for i in range(name_index+1,len(lines)) if lines[i].strip()=='<VOLENV2')
 # Need to ensure this is the SAME track, not the next one.
 assert envstart-name_index<65
 envend=next(i for i in range(envstart+1,len(lines)) if lines[i].strip()=='>')
 pts=[(float(x[1]),float(x[2])) for ln in lines[envstart:envend] if (x:=ln.strip().split()) and x[0]=='PT']
 assert len(pts)>500
 first_before=pts[:12]
 # Native automation curve after 10 seconds must be unchanged.
 times=[x[0] for x in pts]
 cut=bisect.bisect_right(times,10.)
 j=max(1,cut)
 if j>=len(times):raise RuntimeError('No envelope points after 10 sec')
 p0=pts[j-1];p1=pts[j]
 orig_10=p0[1]+(p1[1]-p0[1])*(10.-p0[0])/(p1[0]-p0[0])
 new_points=[(0.,0.),(6.9,0.),(7.6,.10),(8.5,.26),(10.,orig_10)]+pts[j:]
 # preserve non-PT header metadata and original EGUID / VISIBLE flags
 env=lines[envstart:envend+1]
 header=[ln for ln in env[1:-1] if not ln.strip().startswith('PT ')]
 new_env=[env[0]]+header+[f'      PT {t:.6f} {v:.6f} 0\n' for t,v in new_points]+[env[-1]]
 repl.append((envstart,envend+1,new_env))
 report.append({'track':name,'original_points':len(pts),'after_points':len(new_points),
                'first_old':first_before,'first_new':new_points[:6]})
# Rebuild reverse to preserve stable indices.
newlines=list(lines)
for start,end,replacement in sorted(repl,reverse=True):
 newlines[start:end]=replacement
new=''.join(newlines)
assert new.count('<VOLENV2')==s.count('<VOLENV2')==4
assert new.count('<TRACK {')==s.count('<TRACK {')==18
assert new.count('ORIGINAL SUNO SCENE P00 |')==s.count('ORIGINAL SUNO SCENE P00 |')
assert new.count('LOGAN ELEVENLABS')==s.count('LOGAN ELEVENLABS')
orig_hash=hashlib.sha256(raw).hexdigest()
new_bytes=new.encode('utf8','surrogateescape')
info={'status':'DRY_RUN','input_hash':orig_hash,'output_hash':hashlib.sha256(new_bytes).hexdigest(),
      'changed_tracks':len(report),'reaper_project':str(path),'edit_reason':'Original Angela cold-open stays dry; Suno music fades in after the quote', 'envelopes':report}
q=base/'SCORE_SCENES_20261113'
(q/'COLD_OPEN_SCORE_EDIT_REPORT.json').write_text(json.dumps(info,indent=2),encoding='utf8')
if '--commit' not in sys.argv:
 print('DRY_RUN PASS',len(report),'CONTINUOUS SCORE TRACKS; voice and archive unchanged')
 exit(0)
backup=q/'ProductionBackup'/'before_cold_open_dry_fix.RPP.bak'
if backup.exists():raise RuntimeError('Existing dry-fix backup: refusing overwrite')
if hashlib.sha256(path.read_bytes()).hexdigest()!=orig_hash:raise RuntimeError('Source changed before commit')
shutil.copy2(path,backup)
if hashlib.sha256(backup.read_bytes()).hexdigest()!=orig_hash:raise RuntimeError('Backup corrupted')
tmp=path.with_suffix('.RPP.cold_open_tmp')
tmp.write_bytes(new_bytes)
if hashlib.sha256(tmp.read_bytes()).hexdigest()!=info['output_hash']:raise RuntimeError('Temp output failed verification')
os.replace(tmp,path)
if hashlib.sha256(path.read_bytes()).hexdigest()!=info['output_hash']:raise RuntimeError('Final output failed verification')
info['status']='COMMITTED_SAME_PROJECT'
info['backup']=str(backup)
(q/'COLD_OPEN_SCORE_EDIT_REPORT.json').write_text(json.dumps(info,indent=2),encoding='utf8')
print('SUCCESS: authentic cold opening dry, fade into score. SAME PROJECT.',path)
