# THE PAPER TRAIL - full-episode editorial listening mix from native REAPER timeline export.
# Keeps the user's original archival files, ElevenLabs Logan narrator and Suno music.
# Not a mastering pass; please do not publish without final human editorial review.
import csv,subprocess,math,os,json,time
from pathlib import Path
from collections import Counter
import numpy as np
base=Path(__file__).resolve().parent
tsv=base/'ELEVENLABS_V5_ALL_AUDIO_MIX_ITEMS.tsv'
if not tsv.is_file():raise SystemExit('REAPER export manifest not found')
with tsv.open(encoding='utf-8-sig',newline='') as f:items=list(csv.DictReader(f,delimiter='\t'))
SR=48000
END=4436.899
target_samples=math.ceil(END*SR)
print('START FULL AUDIO RENDER',len(items),'audio items',END,'sec,',SR,'Hz',flush=True)
mix=np.zeros((target_samples,2),dtype=np.float32)
cache={}
sources=Counter(x['source'] for x in items)
print('UNIQUE MEDIA SOURCES',len(sources),'REUSABLE SOURCE FILES',sum(1 for n in sources.values() if n>1),flush=True)
issues=[]
def decode(path):
    if path not in cache:
        p=Path(path)
        if not p.is_file():raise FileNotFoundError('REAPER media missing: '+str(p))
        cmd=['ffmpeg','-nostdin','-hide_banner','-loglevel','error',
             '-i',str(p),'-ac','2','-ar',str(SR),'-f','f32le','pipe:1']
        done=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        if done.returncode:raise RuntimeError(f"Decoding {p.name}: "+done.stderr.decode('utf-8','replace')[-900:])
        samples=np.frombuffer(done.stdout,dtype='<f4')
        if samples.size%2:samples=samples[:-1]
        cache[path]=samples.reshape(-1,2)
        print('SOURCE',p.name,'duration',round(len(cache[path])/SR,1),'sec',flush=True)
    return cache[path]
for i,row in enumerate(items,1):
    p=int(round(float(row['pos'])*SR))
    length=int(round(float(row['dur'])*SR))
    if length<=0 or p>=target_samples:continue
    p=max(p,0); length=min(length,target_samples-p)
    audio=decode(row['source'])
    offset=max(0,int(round(float(row['soffs'])*SR)))
    if offset>=len(audio):
        issues.append({'index':i,'path':row['source'],'error':'SOURCE_OFFSET_AFTER_AUDIO_END'})
        continue
    rate=float(row['rate'])
    if abs(rate-1.0)<1e-5:
        valid=min(length,len(audio)-offset)
        chunk=audio[offset:offset+valid]
    else:
        idx=offset+np.floor(np.arange(length,dtype=np.float64)*rate).astype(np.int64)
        valid=int(np.count_nonzero(idx<len(audio)))
        idx=np.minimum(idx,len(audio)-1)
        chunk=audio[idx[:valid]]
    if valid<length:
        issues.append({'index':i,'path':row['source'],'shortfall_s':round((length-valid)/SR,3)})
    if valid<=0:continue
    envelope=np.ones(valid,dtype=np.float32)
    fi=int(float(row['fadein'])*SR)
    fo=int(float(row['fadeout'])*SR)
    if fi>0:
        f=min(fi,valid)
        envelope[:f]*=np.linspace(0,1,f,dtype=np.float32)
    if fo>0:
        f=min(fo,valid)
        envelope[-f:]*=np.linspace(1,0,f,dtype=np.float32)
    gain=float(row['item_vol'])*float(row['take_vol'])*float(row['track_vol'])
    mix[p:p+valid]+=chunk[:valid]*envelope[:,None]*gain
    if i%60==0:print('MIXED',i,'/',len(items),flush=True)
peak=float(np.max(np.abs(mix)))
if peak>0.88:mix*=0.88/peak
print('PRE-LIMITER PEAK',round(peak,3),'ADJUSTED',peak>0.88,flush=True)
raw=base/'ELEVENLABS_LOGAN_FULL_MIX_TEMP.f32le'
mix.astype('<f4',copy=False).tofile(raw)
del mix,cache
wav=base/'THE_PAPER_TRAIL_ELEVENLABS_LOGAN_ROUGH_MIX_48KHZ.wav'
mp3=base/'THE_PAPER_TRAIL_ELEVENLABS_LOGAN_ROUGH_MIX.mp3'
cmd=['ffmpeg','-y','-nostdin','-hide_banner','-loglevel','error',
     '-f','f32le','-ar',str(SR),'-ac','2','-i',str(raw),
     '-filter_complex','[0:a]loudnorm=I=-16:TP=-1.0:LRA=11:linear=false,alimiter=limit=0.89,asplit=2[w][m]',
     '-map','[w]','-c:a','pcm_s24le',str(wav),
     '-map','[m]','-codec:a','libmp3lame','-b:a','192k',str(mp3)]
print('EXPORTING MASTERING PREVIEW TO WAV AND MP3',flush=True)
res=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
if res.returncode:
    raise RuntimeError('ffmpeg output error: '+res.stderr.decode('utf-8','replace')[-1700:])
raw.unlink(missing_ok=True)
report={'status':'rough_mix_complete','project':'THE_PAPER_TRAIL_ELEVENLABS_LOGAN_FULL_ASSEMBLY_v5.RPP',
    'narrator':'ElevenLabs cloned Logan, 233/233 scripted narration cues',
    'score':'Three original Suno compositions, 370 sentence cues, 42 snapped word accents',
    'authentic_archival_clips':'Existing audio in original REAPER source',
    'audio_items':len(items),'unique_sources':len(sources),
    'duration_seconds':END,'mix_pre_limiter_peak':peak,
    'wav':str(wav),'mp3':str(mp3),
    'wav_bytes':wav.stat().st_size,'mp3_bytes':mp3.stat().st_size,
    'missing_or_short_source_fragments':issues,
    'remaining_issues':['11 performed written-message readings still placeholders',
       '2 missing genuine archival source clips AQ-0048 and AQ-0220',
       'Archive attribution and cut-context not independently audited',
       'Narrator performance/pronunciation must receive human listening edit',
       'Technical mix uses a source+fader/fades reconstruction, not the complete native REAPER bus/fx chain'],
    'publishable':False}
(base/'ELEVENLABS_LOGAN_FULL_ROUGH_MIX_REPORT.json').write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf-8')
print('FULL PREVIEW SUCCESS',json.dumps({'wav_bytes':wav.stat().st_size,'mp3_bytes':mp3.stat().st_size,
     'items':len(items),'source_shortfalls':len(issues),'duration_s':END}),flush=True)
