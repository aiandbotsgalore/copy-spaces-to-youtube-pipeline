"""Render isolated audio listening checks of the CURRENT SAVED REAPER EDIT.
Follows actual item sources, source offsets, faders, fades, and the exact
native REAPER music envelope data. Technical editorial QC; not a mastering export.
"""
import csv,math,subprocess,json,pathlib,numpy as np
from collections import defaultdict
base=pathlib.Path(__file__).resolve().parent
src=base/'MUSIC_REFINEMENT_FULL_ITEM_AUDIT.tsv'
envsrc=base/'MUSIC_REFINEMENT_NATIVE_ENVELOPES.tsv'
dest=base/'ListeningChecks'
dest.mkdir(exist_ok=True)
with src.open(encoding='utf-8',errors='replace',newline='') as f:
    items=list(csv.DictReader(f,delimiter='\t'))
with envsrc.open(encoding='utf-8',errors='replace',newline='') as f:
    envelopes_rows=list(csv.DictReader(f,delimiter='\t'))
envelopes=defaultdict(list)
for row in envelopes_rows:
    envelopes[row['track']].append((float(row['point_time']),float(row['volume_linear'])))
for track in envelopes:
    envelopes[track]=np.asarray(sorted(envelopes[track]),dtype=np.float64)
assert len(envelopes)==4, f'Expected exactly 4 active Suno score envelopes, got {len(envelopes)}'
assert len([r for r in items if 'ELEVENLABS LOGAN  |  NARRATION' in r['track'] and float(r['trackmute'])<.5])>=233,'Logan narration not active in item report'
assert len([r for r in items if 'SUNO ORIGINAL SCENE SCORE' in r['track']])==12
assert len([r for r in items if 'SUNO INSTRUMENTAL SCORE' in r['track']])==15
R=48000
windows=[
    ('01_Prologue_and_First_Archive',20,90),
    ('02_Act_I_Before_Archives',480,90),
    ('03_Savs_Worst_Day',2380,90),
    ('04_Private_Messages_Released',2710,90),
    ('05_Epilogue_Unanswered_Note',4280,90)
]
def dbfs(x):
    if x.size==0:return -140.
    return round(20*math.log10(max(1e-9,float(np.sqrt(np.mean(x*x,dtype=np.float64))))),2)
def peakdb(x):
    return round(20*math.log10(max(1e-9,float(np.max(np.abs(x))))),2)
def decode_section(path,offset,dur):
    # ffmpeg's accurate seek; PCM stereo fixed 48k, not new synthesis.
    cmd=['ffmpeg','-nostdin','-hide_banner','-loglevel','error',
         '-ss',str(max(0,offset)),'-i',path,'-t',str(dur),
         '-ac','2','-ar',str(R),'-f','f32le','pipe:1']
    p=subprocess.run(cmd,capture_output=True)
    if p.returncode!=0:
        raise RuntimeError('FFmpeg decode failed '+path+': '+p.stderr.decode('utf-8','replace')[-300:])
    a=np.frombuffer(p.stdout,dtype='<f4')
    if a.size%2:a=a[:-1]
    return a.reshape(-1,2)
reports=[]
for label,start,duration in windows:
    stop=start+duration
    N=round(duration*R)
    voice=np.zeros((N,2),dtype=np.float32)
    music=np.zeros_like(voice)
    other=np.zeros_like(voice)
    voiced=np.zeros(N,dtype=bool)
    involved=0;omitted=[]
    for item in items:
        if float(item['trackmute'])>.5 or float(item['itemmute'])>.5:continue
        path=item['source']
        if not path:continue
        if not pathlib.Path(path).is_file():
            omitted.append(path)
            continue
        p=float(item['start'])
        end=float(item['end'])
        left=max(start,p);right=min(stop,end)
        if right-left<.025:continue
        fromidx=max(0,round((left-start)*R))
        n=min(N-fromidx,round((right-left)*R))
        if n<=0:continue
        sourceoffset=float(item['offset'])+(left-p)*float(item['rate'])
        playrate=float(item['rate'])
        source_duration=n/R*playrate+.01
        raw=decode_section(path,sourceoffset,source_duration)
        if raw.shape[0]<1:continue
        if abs(playrate-1)>1e-5:
            indexes=np.minimum(raw.shape[0]-1,
               np.floor(np.arange(n)*playrate).astype(np.int64))
            audio=raw[indexes].copy()
        else:
            valid=min(n,raw.shape[0])
            audio=raw[:valid].copy()
            n=valid
        if not n:continue
        times=left+np.arange(n,dtype=np.float64)/R
        fadein=float(item['fadein'])
        fadeout=float(item['fadeout'])
        if fadein>.001:
            audio*=np.minimum(1.,np.maximum(0.,(times-p)/fadein))[:,None]
        if fadeout>.001:
            audio*=np.minimum(1.,np.maximum(0.,(end-times)/fadeout))[:,None]
        gain=float(item['trackvol'])*float(item['takevol'])*float(item['itemvol'])
        if item['track'] in envelopes:
            points=envelopes[item['track']]
            vol=np.interp(times,points[:,0],points[:,1]).astype(np.float32)
            audio*=vol[:,None]
        audio*=gain
        lower=item['track'].lower()
        if 'elevenlabs logan' in lower and 'narration' in lower or 'archive' in lower:
            voice[fromidx:fromidx+n]+=audio
            voiced[fromidx:fromidx+n]=True
        elif 'suno instrumental score' in lower or 'suno original scene score' in lower:
            music[fromidx:fromidx+n]+=audio
        else:
            other[fromidx:fromidx+n]+=audio
        involved+=1
    final=voice+music+other
    mask=voiced
    voice_rms=dbfs(voice[mask]) if mask.any() else None
    music_rms=dbfs(music[mask]) if mask.any() else None
    margin=round(voice_rms-music_rms,2) if mask.any() else None
    premasterpeak=peakdb(final)
    out=dest/('THE_PAPER_TRAIL_BALANCED_SCORE_'+label+'.mp3')
    cmd=['ffmpeg','-y','-nostdin','-hide_banner','-loglevel','error',
        '-f','f32le','-ar',str(R),'-ac','2','-i','pipe:0',
        '-af','highpass=f=28,alimiter=limit=0.84:level=0',
        '-c:a','libmp3lame','-b:a','224k',str(out)]
    result=subprocess.run(cmd,input=final.astype('<f4',copy=False).tobytes(),capture_output=True)
    if result.returncode!=0:raise RuntimeError('Preview encoder failed '+result.stderr.decode('utf-8','replace')[-500:])
    meta=json.loads(subprocess.run(['ffprobe','-v','error','-show_entries','format=duration,size',
        '-of','json',str(out)],capture_output=True,text=True,check=True).stdout)
    if abs(float(meta['format']['duration'])-duration)>.25:raise RuntimeError('Preview duration incorrect')
    report={'name':label,'start_s':start,'duration_s':duration,
        'file':str(out),'size_bytes':out.stat().st_size,
        'voice_rms_dBFS':voice_rms,'music_rms_dBFS':music_rms,
        'voice_vs_music_dB':margin,
        'total_unlimited_peak_dBFS':premasterpeak,'media_items_mixed':involved,
        'silent_or_missing_media_count':len(omitted)}
    reports.append(report)
    print('LISTENING PREVIEW',json.dumps(report,ensure_ascii=False),flush=True)
    if margin is not None and margin<5:print('REVIEW REQUIRED: voice/music contrast modest in ',label,flush=True)
summary={'status':'five listening previews prepared from actual current REAPER media and native automation',
    'previews':reports,
    'project_file':'THE_PAPER_TRAIL_LOGAN_LABELS_REMOVED_SUNO_VISIBLE_v7.RPP',
    'caveats':['Audition previews are reconstructed using source media, item faders, fade length and precise REAPER envelope volumes; they do not recreate any hidden master FX/bus chain.',
      'Missing written-message readings and two absent archival clips are not represented with synthesized voices.',
      'Peak safety limiter is preview-only; original REAPER project remains fully editable and unmastered.']}
(base/'MUSIC_REFINEMENT_LISTENING_PREVIEWS_QA.json').write_text(json.dumps(summary,indent=2,ensure_ascii=False),encoding='utf-8')
print('LISTENING_QA_DONE',len(reports),'previews',flush=True)
