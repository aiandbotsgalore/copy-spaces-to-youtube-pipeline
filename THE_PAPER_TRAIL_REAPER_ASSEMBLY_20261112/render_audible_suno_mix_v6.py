"""THE PAPER TRAIL v6 native-layout full audio preview.
Mix all genuine original archival / ElevenLabs Logan / SFX media placements from v6,
then add the 3 new fully audible continuous Suno stems.
No fake archive, no re-generation, no prior project overwrite.
"""
import csv,json,math,subprocess,pathlib,os,numpy as np
from collections import Counter
root=pathlib.Path(__file__).resolve().parent
f=root/'ELEVENLABS_V6_ALL_AUDIO_MIX_ITEMS.tsv'
with f.open(encoding='utf-8-sig',newline='') as file:items=list(csv.DictReader(file,delimiter='\t'))
R=48000; END=4436.899
score=[x for x in items if 'CONTINUOUS_WORD_SCORE_v6.flac' in x['source']]
nonscore=[x for x in items if x not in score]
if len(score)!=3 or len(nonscore)<350:raise RuntimeError(f'Unexpected v6 layout: {len(score)} stems, {len(nonscore)} original items')
dry_path=root/'THE_PAPER_TRAIL_V6_ORIGINAL_VOICES_AND_ARCHIVES_DRY_REFERENCE.flac'
final=root/'THE_PAPER_TRAIL_ELEVENLABS_LOGAN_AUDIBLE_SUNO_SCORE_v6.mp3'
nonscore.sort(key=lambda m:float(m['pos']))
cache={}
problems=[]
def decode(path):
    if path not in cache:
        src=pathlib.Path(path)
        if not src.is_file():raise FileNotFoundError(path)
        cmd=['ffmpeg','-nostdin','-hide_banner','-loglevel','error',
             '-i',str(src),'-ac','2','-ar',str(R),'-f','f32le','pipe:1']
        p=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        if p.returncode:raise RuntimeError('Decode failed '+src.name)
        a=np.frombuffer(p.stdout,dtype='<f4')
        if a.size%2:a=a[:-1]
        cache[path]=a.reshape(-1,2).copy()
        print('SOURCE',src.name,'length',round(len(cache[path])/R,1),'sec',flush=True)
    return cache[path]
# Encode the multi-source archive/narration assembly to compressed lossless FLAC,
# in short blocks so the full 74 minute output does not fill 4GB memory at once.
cmd=['ffmpeg','-y','-nostdin','-hide_banner','-loglevel','error',
    '-f','f32le','-ar',str(R),'-ac','2','-i','pipe:0','-c:a','flac',
    '-sample_fmt','s16','-compression_level','2',str(dry_path)]
p=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
BLOCK=R*8;N=math.ceil(R*END)
active=[];idx=0
peak=0;maxactive=0
try:
 for blocknum,start in enumerate(range(0,N,BLOCK)):
    stop=min(N,start+BLOCK)
    s0=start/R;s1=stop/R
    while idx<len(nonscore) and float(nonscore[idx]['pos'])<s1:
        active.append(nonscore[idx]);idx+=1
    active=[x for x in active if float(x['pos'])+float(x['dur'])>s0]
    buf=np.zeros((stop-start,2),dtype=np.float32)
    maxactive=max(maxactive,len(active))
    for item in active:
        pos=int(round(float(item['pos'])*R))
        dur=int(round(float(item['dur'])*R))
        left=max(start,pos);right=min(stop,pos+dur)
        if right<=left:continue
        audio=decode(item['source'])
        off=int(round(float(item['soffs'])*R))
        rate=float(item.get('rate') or 1.)
        f0=left-pos;f1=right-pos
        idx1=off+int(f0*rate)
        if idx1>=len(audio):
            if not any(x.get('file')==item['source'] for x in problems):
                problems.append({'file':item['source'],'reason':'source starts past end'})
            continue
        n=right-left
        if abs(rate-1)<.00001:
            valid=min(n,len(audio)-idx1)
            chunk=audio[idx1:idx1+valid]
        else:
            ixs=off+(np.arange(f0,f1)*rate).astype(np.int64)
            valid=int(np.count_nonzero(ixs<len(audio)))
            chunk=audio[np.clip(ixs[:valid],0,len(audio)-1)]
        if valid<=0:continue
        env=np.ones(valid,dtype=np.float32)
        fi=max(0,int(float(item['fadein'])*R))
        fo=max(0,int(float(item['fadeout'])*R))
        if fi:
            z=min(valid,max(0,fi-f0))
            if z:env[:z]*=(f0+np.arange(z,dtype=np.float32))/fi
        if fo:
            rel=dur-(f0+np.arange(valid,dtype=np.float32))
            env*=np.clip(rel/fo,0,1)
        gain=float(item['item_vol'])*float(item['take_vol'])*float(item['track_vol'])
        loc=left-start
        buf[loc:loc+valid]+=chunk[:valid]*env[:,None]*gain
    peak=max(peak,float(np.max(np.abs(buf))))
    p.stdin.write(buf.tobytes())
    if blocknum%35==0:print('DRY MIX',round(s1,1),'/',END,'peak',round(peak,3),'active',maxactive,flush=True)
 p.stdin.close()
 err=p.stderr.read()
 p.wait()
 if p.returncode:raise RuntimeError('Dry mix FLAC encoder '+err.decode('utf-8','replace')[-900:])
except Exception:
 p.kill()
 raise
del cache
print('DRY REFERENCE COMPLETE',dry_path.stat().st_size,flush=True)
# Reassemble the REAL score tracks via ffmpeg at the song's mix level.
mix_input=[str(dry_path)]+[x['source'] for x in score]
mix=['ffmpeg','-y','-nostdin','-hide_banner','-loglevel','error']
for v in mix_input:mix+=['-i',v]
mix+=['-filter_complex',
  '[0:a][1:a][2:a][3:a]amix=inputs=4:duration=first:dropout_transition=0:normalize=0,'
  'alimiter=limit=0.91,highpass=f=35,lowpass=f=18000[a]',
  '-map','[a]','-ar','48000','-ac','2','-c:a','libmp3lame','-b:a','224k',str(final)]
print('MIXING ORIGINAL VOICE + THREE ACTUAL SUNO STEMS',flush=True)
done=subprocess.run(mix,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
if done.returncode:raise RuntimeError('Final audio export failed: '+done.stderr.decode('utf-8','replace')[-1400:])
meta=json.loads(subprocess.run(['ffprobe','-v','error','-show_entries','format=duration,size:stream=sample_rate,codec_name,channels',
                                '-of','json',str(final)],capture_output=True,text=True,check=True).stdout)
if not(4435<float(meta['format']['duration'])<4439):
    raise RuntimeError('Final duration unexpected '+str(meta['format']['duration']))
report={'status':'v6_audible_suno_mix_exported','mp3':str(final),
  'duration_seconds':float(meta['format']['duration']),
  'mp3_bytes':final.stat().st_size,'sampling_hz':48000,
  'source_audio_items':len(nonscore),'music_stems':len(score),
  'new_score_compositions':[pathlib.Path(x['source']).name for x in score],
  'dry_reference':str(dry_path),'dry_mix_pre_limiter_peak':peak,
  'note':'A full editorial preview based on the actual v6 REAPER item placements, without its plugin/bus effects. Audition before final publication.',
  'skipped_or_invalid_audio_sources':problems}
(root/'THE_PAPER_TRAIL_SUNO_SCORE_V6_RENDER_REPORT.json').write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf-8')
print('FULL NEW MIX DONE',json.dumps({k:v for k,v in report.items() if k not in ('skipped_or_invalid_audio_sources','new_score_compositions')},ensure_ascii=False),flush=True)
