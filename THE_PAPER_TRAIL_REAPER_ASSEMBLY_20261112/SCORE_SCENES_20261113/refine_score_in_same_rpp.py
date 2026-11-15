"""Refine THE PAPER TRAIL's existing REAPER project IN PLACE.
No new projects, no generated music/voice. Original source files unchanged.
Scene score recurring entrances + narration/archival duck automation,
with voice and other tracks untouched.
"""
from pathlib import Path
from collections import defaultdict
import re,json,uuid,hashlib,shutil,os,math,time
base=Path(__file__).resolve().parent.parent
path=base/'THE_PAPER_TRAIL_LOGAN_LABELS_REMOVED_SUNO_VISIBLE_v7.RPP'
backup=base/'SCORE_SCENES_20261113'/'ProductionBackup'/'CURRENT_PROJECT_BEFORE_SCENE_MIX_REFINEMENT_20261113.RPP'
reportpath=base/'SCORE_SCENES_20261113'/'SCENE_MIX_REFINEMENT_VERIFIED.json'
manifest=json.loads((base/'SCORE_SCENES_20261113'/'SELECTED_SCENE_CUES_AND_PLACEMENTS.json').read_text(encoding='utf8'))
raw=path.read_bytes()
text=raw.decode('utf-8','surrogateescape')
old_hash=hashlib.sha256(raw).hexdigest()
assert len(raw)>1_000_000 and len(manifest['cues'])==12
# Every score item's complete timeline - intentional reprises, not continuous looping.
# Four sensitive scene boundaries leave genuinely dry passages.
schedule={
'P00':[(17,191,0),(245,413,15)],
'S01':[(427,612,10),(639,823,18)],
'S02':[(833,1005,18)],
'S03':[(1026,1216,0),(1242,1401,39)],
'S04':[(1412,1585,11),(1745,1911,17),(2194,2367,11)],
'S05':[(2387,2508,15)], # leave the rest of Sav's worst day exceptionally restrained
'S06':[(2613,2799,10),(2907,3105,2)],
'S07':[(3117,3292,8),(3390,3560,12)],
'S08':[(3571,3723,15)],
'S09':[(3732,3892,13),(3920,4026,42)],
'S10':[(4034,4190,17),(4220,4280,72)],
'EPI':[(4284.5,4421.4,2)]
}
# Source-RMS calibrated. Per-item source gains leave about 11–16dB voice headroom
# before additional narration ducking.
nominal={'P00':.24,'S01':.245,'S02':.235,'S03':.242,'S04':.207,'S05':.135,
         'S06':.238,'S07':.22,'S08':.218,'S09':.232,'S10':.229,'EPI':.247}
def blocks(data,tag):
    # Return top-level matching REAPER section spans. May have nested source/FX/notes subblocks.
    out=[];depth=0;start=None
    for i,line in enumerate(data):
        s=line.strip()
        if s.startswith('<') and not s.startswith('<<'):
            if s.startswith('<'+tag) and depth==0:start=i
            depth+=1
        elif s=='>':
            depth-=1
            if depth==0 and start is not None:
                out.append((start,i+1))
                start=None
        if depth<0:raise ValueError('Malformed REAPER nesting at line '+str(i))
    return out
ls=text.splitlines(keepends=True)
# Locate <TRACK> blocks by scanning depth; project itself is one outer block.
depth=0;trackStart=None;tracks=[]
for i,line in enumerate(ls):
    s=line.strip()
    if s.startswith('<') and not s.startswith('<<'):
        if s.startswith('<TRACK ') or s=='<TRACK':
            trackStart=i
            level=depth+1
        depth+=1
    elif s=='>':
        if trackStart is not None and depth==level:
            tracks.append((trackStart,i+1))
            trackStart=None
        depth-=1
assert len(tracks)==18,('Expected exactly 18 tracks',len(tracks))
def head_name(chunk):
    for line in chunk[:50]:
        m=re.match(r'\s*NAME "([^"]+)"',line)
        if m:return m.group(1)
    return ''
names=[head_name(ls[a:b]) for a,b in tracks]
print('TRACK COUNT',len(names),flush=True)
for i,name in enumerate(names):print(i,name,flush=True)
id_scene=next((i for i,n in enumerate(names) if 'SUNO ORIGINAL SCENE SCORE' in n),None)
assert id_scene==5,('Unexpected scene track at',id_scene)
trackspan=tracks[id_scene]
trackls=ls[trackspan[0]:trackspan[1]]
# Child items of a track without counting track wrapper itself.
def itemspans(lines):
    out=[];depth=0;start=None
    for i,line in enumerate(lines):
        s=line.strip()
        if s.startswith('<') and not s.startswith('<<'):
            if s=='<ITEM':start=i;ilevel=depth+1
            depth+=1
        elif s=='>':
            if start is not None and depth==ilevel:
                out.append((start,i+1));start=None
            depth-=1
    return out
oldspan=itemspans(trackls)
assert len(oldspan)==12,('Expected twelve scene item sources',len(oldspan))
templates={}
for s,e in oldspan:
    blob=''.join(trackls[s:e])
    m=re.search(r'(?m)^\s*NAME "ORIGINAL SUNO SCENE (P00|S\d{2}|EPI) \|',blob)
    if not m:raise RuntimeError('Unknown original scene source')
    templates[m.group(1)]=blob
assert set(templates)==set(schedule)
cueinfo={c['id']:c for c in manifest['cues']}
def entryline_replace(blob,field,value,indent=None):
    rx=re.compile(r'(?m)^(\s*)'+re.escape(field)+r' [^\n]*$')
    match=rx.search(blob)
    if not match:raise RuntimeError('Cannot locate '+field+' in REAPER item')
    return blob[:match.start()]+match.group(1)+field+' '+value+blob[match.end():]
def make_item(cid,i,st,en,offset):
    cue=cueinfo[cid]
    limit=float(cue['verified_duration'])
    maxend=float(cue['end'])
    assert st>=float(cue['start'])-.05 and en<=maxend+0.05,(cid,st,en,maxend)
    assert en>st+15 and offset>=0 and offset+(en-st)<limit-.08,(cid,st,en,offset,limit)
    orig=templates[cid]
    blob=entryline_replace(orig,'POSITION',format(st,'.6f'))
    blob=entryline_replace(blob,'LENGTH',format(en-st,'.6f'))
    blob=entryline_replace(blob,'SOFFS',format(offset,'.6f'))
    gain=nominal[cid]*(0.88 if i>0 else 1.)
    m=re.search(r'(?m)^(\s*VOLPAN 1 0 )(\S+)( -1)\s*$',blob)
    if not m:raise RuntimeError('Cannot locate media take gain '+cid)
    blob=blob[:m.start()]+m.group(1)+format(gain,'.6f')+m.group(3)+blob[m.end():]
    fi=2.7 if cid!='S05' else 4.5
    fo=4.5 if cid!='S05' else 6.
    for kind,seconds in [('FADEIN',fi),('FADEOUT',fo)]:
        pat=re.compile(r'(?m)^(\s*'+kind+r' 1 )([0-9.]+)(.*)$')
        if not pat.search(blob):raise RuntimeError('Missing '+kind)
        blob=pat.sub(lambda m:m.group(1)+str(seconds)+m.group(3),blob,count=1)
    title=f"ORIGINAL SUNO SCENE {cid} | {cue['name']} | "+('INTRO' if i==0 else f'RETURN {i+1}')
    pat=re.compile(r'(?m)^(\s*NAME )"ORIGINAL SUNO SCENE [^"\n]*"')
    if not pat.search(blob):raise RuntimeError('Source item name not found')
    blob=pat.sub(lambda m:m.group(1)+json.dumps(title,ensure_ascii=False),blob,count=1)
    # Native notes are multi-line and escape line prefixes with '|'. Don't change citations.
    blob=re.sub(r'(?m)^(\s*\|Scene start )[^\n]+',
        lambda m:m.group(1)+f'{st:.3f}, length {en-st:.3f}, source offset {offset:.3f}, mix gain {gain:.4f}; editorially placed under narration',blob)
    # EVERY copy needs fresh item ID and take ID, without changing source paths.
    blob=re.sub(r'\{[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}\}',
                lambda m:'{'+str(uuid.uuid4()).upper()+'}',blob)
    assert cid in blob and 'SUNO_SCENE_'+cid+'.' in blob
    return blob,{'id':cid,'name':cue['name'],'pass':i+1,'position':st,'end':en,'duration':en-st,
                 'source_offset':offset,'take_gain':round(gain,4)}
newitems=[];placement=[]
for cid in schedule:
    for i,(st,en,offs) in enumerate(schedule[cid]):
        chunk,row=make_item(cid,i,st,en,offs)
        newitems.append(chunk)
        placement.append(row)
assert len(placement)==21 and len({r['id'] for r in placement})==12

# Gather real narrator/archival media windows from ORIGINAL, untouched tracks.
windows={'voice':[],'archive':[]}
def nums(s,e,trackLines):
    for a,b in itemspans(trackLines):
        item=''.join(trackLines[a:b])
        p=re.search(r'(?m)^\s*POSITION ([^\n ]+)',item)
        l=re.search(r'(?m)^\s*LENGTH ([^\n ]+)',item)
        if p and l:
            start=float(p.group(1)); end=start+float(l.group(1))
            if end>start+.001:
                yield (start,end)
for i,(a,b) in enumerate(tracks):
    name=names[i].upper()
    if 'ELEVENLABS LOGAN' in name:
        windows['voice'].extend(nums(a,b,ls[a:b]))
    if 'ARCHIVE' in name and 'MUTED' not in name:
        windows['archive'].extend(nums(a,b,ls[a:b]))
print('NARRATOR WINDOWS',len(windows['voice']),'ARCHIVE WINDOWS',len(windows['archive']),flush=True)
assert len(windows['voice'])>=230 and len(windows['archive'])>=60

# Build editable, sparse native volume automation, respecting the story and each spoken phrase.
# 0.76 musical breathing level; 0.52 under narration; 0.28 underneath original archive clips.
# Most intensely painful individual words fall to 0.15 using real Scribe alignment.
cuts=json.loads((base/'SPOKEN_AQ_ID_AUDIO_CUT_PLAN.json').read_text(encoding='utf8'))['cuts']
def current_time(old):
    dropped=0.
    for c in cuts:
        if old>=c['end']:dropped+=c['end']-c['start']
        elif old>c['start']:return c['start']-dropped
    return old-dropped
wordmap=json.loads((base/'FULL_EPISODE_WORD_CUE_MAP_ELEVENLABS_v5.json').read_text(encoding='utf8'))
sensitive={'suicide','suicidal','rape','raped','dead','death','died','baby'}
sensitive_times=[]
for w in wordmap['word_cues']:
    if w.get('time_final') is None:continue
    spelling=re.sub('[^a-z]','',w['word'].lower())
    if spelling in sensitive:
        sensitive_times.append(current_time(float(w['time_final'])))
# Use audio-item windows, not guessed script timestamps.
def event_gain(t,interval,pre,post,min_gain):
    s,e=interval
    if t<s-pre or t>e+post:return 1.
    if t<s:return 1-(1-min_gain)*(t-(s-pre))/max(pre,.001)
    if t<=e:return min_gain
    return min_gain+(1-min_gain)*(t-e)/max(post,.001)
def level_at(t):
    # base level is subtly audible when dialogue ends; source item fades still handle entries.
    v=.77
    for x in windows['voice']:
        if x[0]-0.75 <= t <= x[1]+.85:
            v=min(v,.77*event_gain(t,x,.75,.85,.63))
    for x in windows['archive']:
        if x[0]-1.1<=t<=x[1]+1.5:
            v=min(v,.77*event_gain(t,x,1.1,1.5,.33))
    for st in sensitive_times:
        dist=abs(t-st)
        if dist<.85:
            v=min(v,.77*(.19+.81*min(1.,dist/.85)))
    # No performed score under the real archival cold-open.
    if t<7.5:return 0.
    return min(.77,max(.06,v))
# Event-specific points, plus occasional broad control anchors.
timeline=[0,7.0,7.5,8.5,4423.87]
for kind,arr in windows.items():
    pre,post=(.75,.85) if kind=='voice' else (1.1,1.5)
    for s,e in arr:
        timeline.extend((max(0.,s-pre),s, min(4423.87,e),min(4423.87,e+post)))
for t in sensitive_times:
    timeline.extend((max(0.,t-.85),t,min(4423.87,t+.85)))
for c in placement:
    timeline.extend([max(0,c['position']-.1),c['position'],c['end'],min(4423.87,c['end']+.1)])
times=sorted(set(round(t,3) for t in timeline if 0<=t<=4423.87))
# More points around segment boundaries to preserve envelope as interpolated REAPER lines.
expanded=set(times)
for t in times:
    for a in (-.12,.12):
        n=round(t+a,3)
        if 0<=n<=4423.87:expanded.add(n)
t=sorted(expanded)
pairs=[(v,level_at(v)) for v in t]
# Remove redundant collinear points while keeping sharp entrances/release and precise-word dips.
compressed=[]
for v,g in pairs:
    if len(compressed)>=2:
        a,ga=compressed[-2];b,gb=compressed[-1]
        if b-a>0 and v-b>0:
            predicted=ga+(g-ga)*(b-a)/(v-a)
            if abs(predicted-gb)<.0075 and v-a<11:
                compressed[-1]=(v,g)
                continue
    compressed.append((v,g))
assert 450<len(compressed)<5000,('Unexpected envelope size',len(compressed))
# Replace ONLY the score track's existing <VOLENV2> point block, not other automation.
env_s=next((i for i,s in enumerate(trackls) if s.strip()=='<VOLENV2'),None)
assert env_s is not None
env_e=next((i for i in range(env_s+1,len(trackls)) if trackls[i].strip()=='>'),None)
assert env_e is not None
existing_env=trackls[env_s:env_e+1]
assert 500<len([x for x in existing_env if x.strip().startswith('PT ')])<1500
env_header=[x for x in existing_env[1:-1] if not x.strip().startswith('PT ')]
new_env=[trackls[env_s]]+env_header
new_env += [f'      PT {v:.3f} {g:.5f} 0\n' for v,g in compressed]
new_env += [trackls[env_e]]
# Replace original 12 media item blocks in this track with curated 21 placements.
# Track items all follow envelope and existing FX/metadata; preserve all non-item content.
remove=set()
for a,b in oldspan:remove.update(range(a,b))
newTrack=[]
for ix,s in enumerate(trackls):
    if ix==env_s:
        newTrack.extend(new_env)
        continue
    if env_s<ix<=env_e:continue
    if ix in remove:
        if ix==oldspan[0][0]:
            for chunk in newitems:newTrack.extend(chunk.splitlines(keepends=True))
        continue
    newTrack.append(s)
if len([x for x in newTrack if x.strip()=='<ITEM'])!=21:raise RuntimeError('Unexpected number of new media items')
# Leave other 17 tracks and every other source unmodified.
newls=ls[:trackspan[0]]+newTrack+ls[trackspan[1]:]
result=''.join(newls)
assert result.count('ORIGINAL SUNO SCENE P00 |')>=2
assert result.count('<TRACK {')==18
assert 'ELEVENLABS LOGAN' in result
assert result.count('<VOLENV2')==text.count('<VOLENV2')
assert len(result)>len(text)
# Ensure no other track changed.
p_before=[(''.join(ls[a:b])) for i,(a,b) in enumerate(tracks) if i!=id_scene]
newtrackspans=[]
depth=0;begin=None
newlines=result.splitlines(keepends=True)
for i,line in enumerate(newlines):
    s=line.strip()
    if s.startswith('<') and not s.startswith('<<'):
        if s.startswith('<TRACK ') or s=='<TRACK':begin=i;level=depth+1
        depth+=1
    elif s=='>':
        if begin is not None and depth==level:
            newtrackspans.append((begin,i+1));begin=None
        depth-=1
assert len(newtrackspans)==18
p_after=[(''.join(newlines[a:b])) for i,(a,b) in enumerate(newtrackspans) if i!=id_scene]
assert p_before==p_after,'Other non-score tracks changed unexpectedly'
summary={'status':'DRY_RUN_VERIFIED','same_project':str(path),'original_sha256':old_hash,
 'original_audio_items':12,'refined_audio_items':len(placement),'new_tracks':0,
 'new_songs':0,'new_download_credits':0,'narration_items_unchanged':len(windows['voice']),
 'archive_items_unchanged':len(windows['archive']),
 'score_envelope_points_old':len([x for x in existing_env if x.strip().startswith('PT ')]),
 'score_envelope_points_new':len(compressed),'sensitive_word_dips':len(sensitive_times),
 'placements':placement,'new_project_bytes':len(result.encode('utf8','surrogateescape')),
 'new_project_sha256':hashlib.sha256(result.encode('utf8','surrogateescape')).hexdigest()}
# Do not commit automatically unless explicit local flag set by importer orchestration.
dryrun=base/'SCORE_SCENES_20261113'/'MIX_REFINEMENT_DRYRUN.json'
dryrun.write_text(json.dumps(summary,indent=2,ensure_ascii=False),encoding='utf8')
if '--commit' not in __import__('sys').argv:
    print('DRY RUN SUCCESS',json.dumps({k:v for k,v in summary.items() if k!='placements'},indent=2),flush=True)
    exit(0)
if backup.exists():raise RuntimeError('Pre-refinement backup already exists. Refusing overwrite.')
if hashlib.sha256(path.read_bytes()).hexdigest()!=old_hash:raise RuntimeError('Project changed during editing. Stop.')
shutil.copy2(path,backup)
if hashlib.sha256(backup.read_bytes()).hexdigest()!=old_hash:raise RuntimeError('Backup verification failure')
# Same canonical file: atomic replace. Backup is not a competing live REAPER project.
tmp=path.with_suffix('.RPP.score_refine_temp')
tmp.write_bytes(result.encode('utf8','surrogateescape'))
if hashlib.sha256(tmp.read_bytes()).hexdigest()!=summary['new_project_sha256']:raise RuntimeError('Temp file differs')
os.replace(tmp,path)
if hashlib.sha256(path.read_bytes()).hexdigest()!=summary['new_project_sha256']:raise RuntimeError('On-disk project check failed')
summary['status']='APPLIED_IN_PLACE_AND_HASH_VERIFIED'
summary['backup']=str(backup)
reportpath.write_text(json.dumps(summary,indent=2,ensure_ascii=False),encoding='utf8')
print('APPLIED SAME REAPER PROJECT',str(path),'REPRISE ITEMS',len(placement),'NATIVE ENVELOPE POINTS',len(compressed),'NO VOICE OR ARCHIVE CHANGES',flush=True)


