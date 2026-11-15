"""THE PAPER TRAIL v6 — audible, continuous Suno underscoring, shaped at every narrated sentence & word.

Reuses three already downloaded original Suno score WAVs without new generations.
Creates three lossless editable FLAC stems and a full timing/automation report.
Never changes original source audio, previous RPP projects or narrator.
"""
import csv,subprocess,json,math,pathlib,re,collections
import numpy as np
root=pathlib.Path(__file__).resolve().parent
R=48000; END=4436.899; STEP=.05
mapping=json.loads((root/'FULL_EPISODE_WORD_CUE_MAP_ELEVENLABS_v5.json').read_text(encoding='utf-8'))
with (root/'ELEVENLABS_V5_ALL_AUDIO_MIX_ITEMS.tsv').open(encoding='utf-8-sig',newline='') as f:media=list(csv.DictReader(f,delimiter='\t'))
wordlist=[w for w in mapping['word_cues'] if w.get('time_final') is not None]
groups=collections.defaultdict(list)
for w in wordlist:groups[(w['cue_index'],w['sentence_index'])].append(w)
sentences=[]
for s in mapping['sentences']:
    ws=groups.get((s['cue_index'],s['sentence_index']),[])
    if not ws:continue
    first=min(float(w['time_final']) for w in ws)
    last=max(float(w.get('end_final',w['time_final']+.10)) for w in ws)
    sentences.append({**s,'measured_start':first,'measured_end':last})
sentences.sort(key=lambda s:s['measured_start'])
if len(sentences)<395 or len(wordlist)<5600:raise RuntimeError('Measured sentence / word mappings missing')
tgrid=np.arange(int(END/STEP)+3,dtype=np.float64)*STEP
raw_source={
'investigation':root/'SCORE_Archive_Breathes.wav',
'human':root/'SCORE_What_Trust_Cost.wav',
'motif':root/'SCORE_Unsent_Fourth_Note.wav'}
for key,path in raw_source.items():
    if not path.is_file():raise FileNotFoundError(path)

def palette(s):
    text=s['text'].lower()
    bed=s['bed']
    if s['measured_start']<422:
        if any(z in text for z in ("friends","friend","sav","trusted","trust","confide","understood","children","cost her","mother","struggles")):
            bed='human'
        else:bed='investigation'
    if bed=='human':return np.array([.055,.240,.013],dtype=np.float64), 'HUMAN/TENDER'
    if bed=='motif':return np.array([.050,.065,.225],dtype=np.float64), 'SIGNATURE/REFLECTION'
    if bed=='silence':return np.array([.102,.025,.005],dtype=np.float64), 'SENSITIVE/RESTRAINT'
    # More forward at accusation/revelation; still ducked beneath narration
    if any(z in text for z in ("releasing","weaponiz","retaliat","screenshot","exposed","vault","threat","recording","contradict")):
        return np.array([.245,.017,.018],dtype=np.float64), 'TENSION/REVELATION'
    return np.array([.215,.025,.015],dtype=np.float64), 'INVESTIGATIVE'
# Full-episode musical arc defined from actual spoken sentence start/end (not manuscript estimate).
knots=[(0.0,np.array([.10,.01,.01])),(2.0,np.array([.16,.015,.008])),(6.0,np.array([.205,.02,.012]))]
score_decisions=[]
for s in sentences:
    gain,mood=palette(s)
    t0=s['measured_start']
    t1=s['measured_end']
    knots.append((t0,gain))
    if t1-t0>2.5:knots.append((t1-.35,gain))
    score_decisions.append({'cue':s['cue_index'],'sentence':s['sentence_index']+1,
         'start':round(t0,3),'end':round(t1,3),'style':mood,
         'score_gain':{k:round(float(v),3) for k,v in zip(raw_source,gain)},
         'words':len(groups[(s['cue_index'],s['sentence_index'])]),
         'spoken_text':s['text']})
knots.append((END-12,np.array([.055,.078,.20])))
knots.append((END-1,np.array([.025,.025,.16])))
knots.append((END,np.zeros(3)))
knots.sort(key=lambda p:p[0])
# Duplicate timestamp knots merged with last-write-wins so interpolation is stable.
ks=collections.OrderedDict()
for t,v in knots:ks[round(t,3)]=v
k_times=np.array(list(ks),dtype=np.float64)
k_vals=np.array(list(ks.values()),dtype=np.float64)
palette_env=np.stack([np.interp(tgrid,k_times,k_vals[:,i]) for i in range(3)],axis=-1)
# Exact-word actuation: each of the 5,756 recorded words gets a subtle dynamic mix response.
# Deliberate micro-ducking follows word onset and release, smoothed to avoid syllabic pumping.
wordduck=np.ones(len(tgrid),dtype=np.float32)
for w in wordlist:
    a=max(0,int((float(w['time_final'])-.045)/STEP))
    b=min(len(tgrid),int((float(w.get('end_final',float(w['time_final'])+.16))+.055)/STEP)+1)
    if b>a:wordduck[a:b]=np.minimum(wordduck[a:b],.86)
# Smooth 180 ms to preserve natural breath and not produce audible amplitude flutter.
smooth_n=5
kernel=np.ones(smooth_n,dtype=np.float32)/smooth_n
wordduck=np.convolve(wordduck,kernel,mode='same').astype(np.float32)
# Keep the music under genuine archive as a music bed rather than exploding between narrated paragraphs.
archive_gain=np.ones(len(tgrid),dtype=np.float32)
archive_intervals=[]
for m in media:
    if "ARCHIVE" not in m['trackname'].upper():continue
    a=float(m['pos']);b=a+float(m['dur'])
    archive_intervals.append([a,b])
    ia=max(0,int(a/STEP)); ib=min(len(tgrid),int(b/STEP)+1)
    if ib>ia:archive_gain[ia:ib]=np.minimum(archive_gain[ia:ib],.84)
archive_gain=np.convolve(archive_gain,np.ones(21,dtype=np.float32)/21,mode='same')
palette_env*=wordduck[:,None]
palette_env*=archive_gain[:,None]
# Actual word-level score changes on selected strong semantic words (restraint + signature motif).
accent_words={'friends','friend','trusted','trust','betrayal','betrayed','confide','vulnerable',
 'weaponized','weaponizing','weaponize','screenshot','receipts','paper','trail','sav','vault','retaliation','truth'}
last_time=-1000.0
accents=[]
for w in wordlist:
    t=float(w['time_final'])
    key=''.join(c for c in w['word'].casefold() if c.isalnum())
    if key not in accent_words or t-last_time<9.0:continue
    last_time=t
    accents.append({'time':round(t,3),'word':w['word'],'cue_index':w['cue_index']})
    # Shape motifs and shade investigative tension around the WORD, not the estimated sentence.
    ix=np.flatnonzero((tgrid>=t-.65)&(tgrid<=t+3.15))
    if ix.size:
        bump=np.exp(-.5*((tgrid[ix]-(t+.48))/.83)**2)
        palette_env[ix,2]+=bump*.125
        palette_env[ix,0]*=(1-.16*bump)
        if key in {'friends','friend','sav','trusted','trust','confide','betrayal','vulnerable'}:
            palette_env[ix,1]+=bump*.052
# Maintain a deliberate near-silence on just the sharpest *individual* source words,
# instead of inappropriately leaving entire scenes / prologue unscored.
quiet_words={'suicide','suicidal','rape','raped','baby','dead','died','death'}
quiet_marks=[]
for w in wordlist:
    key=''.join(c for c in w['word'].casefold() if c.isalnum())
    if key in quiet_words:
        t=float(w['time_final'])
        quiet_marks.append({'time':round(t,3),'word':w['word']})
        ix=np.flatnonzero((tgrid>=t-.55)&(tgrid<=t+1.2))
        if ix.size:
            dip=np.exp(-.5*((tgrid[ix]-(t+.17))/.37)**2)
            palette_env[ix,:]*=(1-.57*dip[:,None])
# Protect the opening title and final tail from sudden entries; otherwise bed stays audible.
fade_in=np.clip((tgrid-.35)/3.0,0,1)
fade_out=np.clip((END-tgrid)/4.,0,1)
palette_env*=np.minimum(fade_in,fade_out)[:,None]
palette_env=np.clip(palette_env,0,.36)
# Auditable score coverage: first 60s, first 7 minutes, each remainder hour.
coverage={}
for key,i in zip(raw_source,range(3)):
    coverage[key]={"avg_gain":round(float(np.mean(palette_env[:,i])),4),
        "peak_gain":round(float(np.max(palette_env[:,i])),4),
        "first_60s_avg":round(float(np.mean(palette_env[:int(60/STEP),i])),4),
        "first_420s_avg":round(float(np.mean(palette_env[:int(420/STEP),i])),4)}
combined=np.max(palette_env,axis=1)
coverage["timeline"]={"first_min_with_music_s":round(float(tgrid[next(i for i,v in enumerate(combined) if v>.045)]),2),
        "fraction_with_audible_underbed":round(float(np.mean(combined>.095)),4),
        "estimated_total_s":END}
if coverage['timeline']['first_min_with_music_s']>4.0:raise RuntimeError('Opening score remains too late')
if coverage['timeline']['fraction_with_audible_underbed']<.8:raise RuntimeError('Continuity score coverage too low')
def decode_src(path):
    p=subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-i',str(path),
      '-ac','2','-ar',str(R),'-f','f32le','pipe:1'],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if p.returncode:raise RuntimeError('Source decode error: '+p.stderr.decode('utf-8','replace')[-700:])
    x=np.frombuffer(p.stdout,dtype='<f4').reshape(-1,2).copy()
    return x
starts={'investigation':11,'human':29,'motif':36}
def loop_source(audio,times,offset=10,crossfade=7.0):
    # Seamless crossfade between endings and starts of the very same ORIGINAL Suno score.
    # Not a new melody; soundtrack variations emerge from scoring/orchestration.
    begin=int(offset*R)
    cut_len=len(audio)-begin
    xfade=int(crossfade*R)
    stride=cut_len-xfade
    frame=np.asarray(times*R,dtype=np.int64)
    phase=(frame%stride)
    indices=begin+phase
    out=audio[indices].copy()
    loc=(phase<xfade)
    if np.any(loc):
        alpha=(phase[loc]/xfade).astype(np.float32)
        prev=audio[begin+phase[loc]+stride]
        out[loc]=prev*(1-alpha[:,None])+out[loc]*alpha[:,None]
    return out
def render_stem(kind,i):
    src=decode_src(raw_source[kind])
    path=root/f'THE_PAPER_TRAIL_SUNO_{kind.upper()}_CONTINUOUS_WORD_SCORE_v6.flac'
    cmd=['ffmpeg','-y','-nostdin','-hide_banner','-loglevel','error','-f','f32le',
       '-ar',str(R),'-ac','2','-i','pipe:0','-c:a','flac','-sample_fmt','s16',
       '-compression_level','3',str(path)]
    p=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    BLOCK=R*4;total=int(math.ceil(END*R))
    try:
        for j,k in enumerate(range(0,total,BLOCK)):
            n=min(BLOCK,total-k)
            t=(np.arange(n,dtype=np.float64)+k)/R
            audio=loop_source(src,t,starts[kind])
            gain=np.interp(t,tgrid,palette_env[:,i]).astype(np.float32)
            audio*=gain[:,None]
            p.stdin.write(np.asarray(audio,dtype='<f4').tobytes())
            if j%60==0:print(kind,'COMPOSED',round(t[-1],1),'/',END,flush=True)
        p.stdin.close()
        err=p.stderr.read()
        p.wait()
        if p.returncode:raise RuntimeError(f'{kind} export error: '+err.decode('utf-8','replace')[-800:])
    except Exception:
        p.kill()
        raise
    if not path.is_file() or path.stat().st_size<100000:
        raise RuntimeError(f'{kind} output invalid')
    print('SCORE FILE READY',kind,path.stat().st_size,flush=True)
    return str(path)
stems={}
for i,kind in enumerate(raw_source):
    stems[kind]=render_stem(kind,i)
report={
 'status':'complete','method':'Continuous original Suno score stems, with per-sentence palette, word-aware ducking and exact-word signature accents',
 'source_compositions':{k:str(v) for k,v in raw_source.items()},
 'stems':stems,'voice_source':'ElevenLabs Logan, same as v5',
 'timing_source':'Actual ElevenLabs Scribe word alignment',
 'scored_sentences':len(score_decisions),'words_with_mix_response':len(wordlist),
 'expressive_word_accents':len(accents),'sensitive_word_music_retreats':len(quiet_marks),
 'archive_media_intervals_ducked':len(archive_intervals),'coverage':coverage,
 'sentences':score_decisions,'accents':accents,'quiet_marks':quiet_marks,
 'note':'New score uses original 3 x 2-minute Suno compositions as evolving looped beds; further unique cues can be composed later. These are editorial stems, not a publication master.'}
(root/'THE_PAPER_TRAIL_WORD_SCORE_v6_AUTOMATION_REPORT.json').write_text(
    json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print('COMPLETE',json.dumps({k:v for k,v in report.items() if k not in ('sentences','accents','quiet_marks')},ensure_ascii=False),flush=True)
