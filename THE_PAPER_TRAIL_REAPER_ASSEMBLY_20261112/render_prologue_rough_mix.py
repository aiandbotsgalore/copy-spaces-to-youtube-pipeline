# Prologue rough listening reference rendered from REAPER-exported item placements.
# Mixes the ACTUAL archival / selected October 4 narrator / Suno original score sources.
# This is NOT the final mastered podcast. Intended for editorial listening and word-level refinement.
import csv,subprocess,math,os,json
from pathlib import Path
import numpy as np
base=Path(__file__).resolve().parent
src=base/'PROLOGUE_AUDIO_MIX_ITEM_MANIFEST.tsv'
if not src.is_file(): raise SystemExit('Missing exported REAPER item manifest')
with src.open(encoding='utf-8-sig',newline='') as f:
    items=list(csv.DictReader(f,delimiter='\t'))
SR=48000
END=523.982
out=np.zeros((math.ceil(END*SR),2),dtype=np.float32)
paths=sorted({x['source'] for x in items})
print('RENDER START',len(items),'items',len(paths),'unique source recordings',flush=True)
cache={}
def decode_audio(path):
    path=str(Path(path))
    if path not in cache:
        if not Path(path).is_file():raise FileNotFoundError(path)
        cmd=['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-i',path,'-ac','2','-ar',str(SR),'-f','f32le','pipe:1']
        r=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        if r.returncode!=0:raise RuntimeError(f"Audio decode failed {path}: {r.stderr[:1200]!r}")
        data=np.frombuffer(r.stdout,dtype='<f4')
        if len(data)%2:data=data[:len(data)-1]
        cache[path]=data.reshape(-1,2)
        print('DECODED',Path(path).name,'seconds',round(len(data)/(2*SR),1),flush=True)
    return cache[path]
issues=[]
for i,row in enumerate(items,1):
    track=row['trackname']
    start=round(float(row['pos'])*SR)
    n=round(float(row['dur'])*SR)
    if n<=0 or start>=len(out):continue
    audio=decode_audio(row['source'])
    rate=float(row.get('rate') or 1)
    offs=round(float(row.get('soffs') or 0)*SR)
    n=min(n,len(out)-start)
    # Always validate that the source excerpt actually exists. No looping or fabricated audio.
    avail=max(0,len(audio)-offs)
    if avail<=0:
        issues.append({'row':i,'file':row['source'],'problem':'source starts past end'})
        continue
    if rate==1: chunk=audio[offs:offs+min(n,avail)]
    else:
        idx=offs+np.floor(np.arange(n)*rate).astype(np.int64)
        good=idx<len(audio)
        idx=np.clip(idx,0,len(audio)-1)
        chunk=audio[idx]*good[:,None]
    actual=min(n,len(chunk))
    fadein=max(0,int(float(row['fadein'])*SR))
    fadeout=max(0,int(float(row['fadeout'])*SR))
    gain=float(row['item_vol'])*float(row['take_vol'])*float(row['track_vol'])
    # Prevent abrupt clicks at editorial cuts; mix with REAPER's specified item fades.
    envelope=np.ones(actual,dtype=np.float32)
    if fadein>0:
        fs=min(actual,fadein)
        envelope[:fs]*=np.linspace(0,1,fs,dtype=np.float32)
    if fadeout>0:
        fs=min(actual,fadeout)
        envelope[-fs:]*=np.linspace(1,0,fs,dtype=np.float32)
    out[start:start+actual]+=chunk[:actual]*envelope[:,None]*gain
    if actual<n:issues.append({'row':i,'file':row['source'],'problem':'source ends before item end','short_s':round((n-actual)/SR,2)})
    if i%10==0:print('MIXED',i,'/',len(items),flush=True)
peak=float(np.abs(out).max())
print('PRE-MASTER PEAK',peak,'SOURCE_END_ISSUES',len(issues),flush=True)
# Avoid hard clipping and leave peak headroom before the integrated preview limiter.
if peak>.83:out*=.83/peak
raw=base/'PROLOGUE_ROUGH_MIX_INTERMEDIATE.s16le'
(np.clip(out,-1,1)*32767).astype('<i2').tofile(raw)
del out,cache
wav=base/'THE_PAPER_TRAIL_PROLOGUE_ROUGH_MIX_48KHZ.wav'
mp3=base/'THE_PAPER_TRAIL_PROLOGUE_ROUGH_MIX.mp3'
cmd=['ffmpeg','-y','-nostdin','-hide_banner','-loglevel','error',
    '-f','s16le','-ar',str(SR),'-ac','2','-i',str(raw),
    '-af','loudnorm=I=-16:TP=-1.0:LRA=11:linear=false,alimiter=limit=0.89',
    '-c:a','pcm_s24le',str(wav)]
r=subprocess.run(cmd,capture_output=True)
if r.returncode:raise RuntimeError('WAV render failed '+r.stderr.decode('utf-8','replace')[-900:])
r=subprocess.run(['ffmpeg','-y','-nostdin','-hide_banner','-loglevel','error','-i',str(wav),'-codec:a','libmp3lame','-b:a','256k',str(mp3)],capture_output=True)
if r.returncode:raise RuntimeError('MP3 render failed '+r.stderr.decode('utf-8','replace')[-900:])
try:raw.unlink()
except OSError:pass
report={'status':'rough_mix_exported','audio_items':len(items),'unique_source_files':len(paths),
        'wav':str(wav),'mp3':str(mp3),'duration_s':END,'pre_master_peak':peak,
        'replay_wav_bytes':wav.stat().st_size,'replay_mp3_bytes':mp3.stat().st_size,
        'source_duration_issues':issues,
        'limitations':'This is a provisional editorial mix, not the final master. Uses source/offset, fader and fades, but not complete REAPER effects or bus automation. Suno performance errors remain. Finale not included.'}
(base/'PROLOGUE_ROUGH_MIX_EXPORT_REPORT.json').write_text(json.dumps(report,indent=2,ensure_ascii=False))
print('RENDER SUCCESS WAV',wav.stat().st_size,'MP3',mp3.stat().st_size,'DURATION',END,'seconds',flush=True)
