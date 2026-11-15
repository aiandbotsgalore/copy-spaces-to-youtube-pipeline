from __future__ import annotations
import csv,json,math,re,wave
from array import array
from collections import defaultdict,Counter
from pathlib import Path
ROOT=Path(r'C:\Users\Logan\copy-spaces-to-youtube-pipeline')
OUT=ROOT/'THE_PAPER_TRAIL_REAPER_ASSEMBLY_20261112'
MANUSCRIPT=ROOT/'THE_PAPER_TRAIL_ARGON_REVIEW_CONTEXT_20261112'/'01_CURRENT_MANUSCRIPT.md'
CLIPS=ROOT/'papertrail_archival_audio_ordered'
manifest=json.loads((CLIPS/'manifest.json').read_text(encoding='utf-8'))
lines=MANUSCRIPT.read_text(encoding='utf-8-sig').splitlines()
GROUPS=[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,57,58,59]
assert len(GROUPS)==55
bygroup=defaultdict(list)
for x in manifest['items']:bygroup[x['cue_index']].append(x)
def create_wav(name,samples):
    with wave.open(str(OUT/name),'wb') as w:
        w.setnchannels(1);w.setsampwidth(2);w.setframerate(48000)
        w.writeframes(array('h',(int(max(-1,min(1,z))*32767) for z in samples)).tobytes())
def make_scratch():
    sr=48000; notes=[(.20,293.665,.22),(1.03,349.228,.20),(2.09,220.0,.19)]
    def sample(i):
        t=i/sr;v=0.
        for start,f,a in notes:
            d=t-start
            if d>=0:
                env=(1-math.exp(-d*170))*math.exp(-d*1.7)
                v+=a*env*(.68*math.sin(2*math.pi*f*d)+.20*math.sin(2*math.pi*2.005*f*d)+.09*math.sin(2*math.pi*3.01*f*d))
        if t>=.17:
            d=t-.17;v+=.085*(1-math.exp(-d*14))*math.exp(-d*.78)*math.sin(2*math.pi*73.416*d)
        return v
    create_wav('SCRATCH_three_notes_D_minor.wav',(sample(i) for i in range(int(sr*6.25))))
    for name,amp,rate in [('SCRATCH_phone_send_click.wav',.18,91),('SCRATCH_mic_unmute_click.wav',.12,67)]:
        create_wav(name,(amp*math.exp(-(i/sr)*rate)*(math.sin(2*math.pi*410*i/sr)+.32*math.sin(2*math.pi*790*i/sr)) for i in range(int(sr*.12))))
make_scratch()
events=[];sections=[];t=0.;cue=0;narr=0;read=0;sfx=0;mode=None;paragraph=[]
def add(kind,pos,dur,name,text='',path='',status='',line=0):
    events.append(dict(kind=kind,pos=round(pos,3),dur=round(max(.08,dur),3),name=name[:110],text=text,path=str(path),status=status,line=line))
def duration(s,wpm=148):
    return max(1.9,len(re.findall(r'\b[\w’]+(?:-[\w]+)*\b',s))*60/wpm+min(2,(s.count('.')+s.count('!')+s.count('?'))*.08)+.55)
def flush(line):
    global t,narr,read,paragraph
    if not paragraph:return
    txt=' '.join(y.strip() for y in paragraph).strip();paragraph=[]
    if not txt or mode not in ('narration','reading'):return
    d=duration(txt,145 if mode=='reading' else 148)
    if mode=='narration':
        narr+=1;name=f'NARRATION {narr:03d} | {txt[:58]}'
    else:
        read+=1;name=f'WRITTEN READING {read:03d} | {txt[:58]}'
    add(mode,t,d,name,txt,status='RECORDING REQUIRED' if mode=='reading' else 'NARRATION RECORDING REQUIRED',line=line)
    t+=d+.30
for i,raw in enumerate(lines,1):
    line=raw.strip()
    if i < 14:continue  # Do not turn manuscript header metadata into narration.
    if 'SOURCE HOLDS BEFORE RECORDING' in line:flush(i);break
    if not line:flush(i);continue
    if line.startswith('### '):
        flush(i);heading=line[4:].strip()
        if heading!='Master Broadcast Script' and any(z in heading for z in ['PROLOGUE','ACT ','EPILOGUE']):
            sections.append(dict(name=heading,pos=round(t,3)));t+=.50
        mode=None;continue
    if line=='---':flush(i);continue
    clean=line.strip(chr(96)).strip()
    if clean.startswith('[CLIP '):
        flush(i);cue+=1
        assert cue<=55,f'Unexpected cue {cue}'
        grp=bygroup[GROUPS[cue-1]]
        ac=set(re.findall(r'AQ-\d{4}',clean))
        ag=set().union(*(set(re.findall(r'AQ-\d{4}',str(z.get('cue_id','')))) for z in grp))
        if ac and not ac.intersection(ag):raise ValueError(f'Cue #{cue} at line {i}: source tag mismatch {ac} {ag}')
        for x in grp:
            candidate=CLIPS/x.get('output_filename','');status=x.get('status','')
            if not candidate.exists() or candidate.suffix.lower() not in ('.wav','.mp3','.flac','.m4a','.aiff'):
                aq=re.search(r'AQ-\d{4}',x.get('cue_id',''))
                alternatives=list((ROOT/'special_clips').glob('*'+aq.group()+'*.wav')) if aq else []
                if alternatives:candidate=alternatives[0];status='UNVERIFIED SECONDARY CLIP'
                else:candidate=None;status='MISSING SOURCE AUDIO'
            length=float(x.get('duration_seconds') or 0)
            if candidate and length<.1:
                try:
                    with wave.open(str(candidate),'rb') as wf:length=wf.getnframes()/wf.getframerate()
                except Exception:length=12.
            if not candidate:length=9.
            label=f'ARCHIVE C{cue:02d} {x.get("cue_id","")} | {x.get("output_filename","")}'
            note=f'Manuscript line {i}\n{clean}\nManifest status: {status}\nAudio cut boundaries/context and speaker NOT independently verified. Audition before publication.\nOriginal source: {x.get("source_path","")}'
            is_angela='angela' in str(x.get('speakers','')).lower()
            kind=('archive_angela' if is_angela else 'archive_other') if candidate else 'missing_archive'
            add(kind,t,length,label,note,candidate or '',status,i)
            t+=length+(.10 if 2<=cue<=8 else .28)
        mode=None;continue
    if clean.startswith(('[SFX:','[THEME','[MUSIC:')):
        flush(i);sfx+=1;desc=clean.lstrip('[').rstrip(']');lower=desc.lower();sound=None
        kind='sfx';length=3.;status='CUE ONLY - AUDIO NOT SELECTED'
        if 'phone' in lower and 'click' in lower:sound=OUT/'SCRATCH_phone_send_click.wav';length=.12;status='SCRATCH - replace before release'
        elif 'microphone unmuting' in lower or 'mic unmuting' in lower:sound=OUT/'SCRATCH_mic_unmute_click.wav';length=.12;status='SCRATCH - replace before release'
        elif clean.startswith('[THEME'):
            kind='music';sound=OUT/'SCRATCH_three_notes_D_minor.wav';length=6.25;status='TEMP SYNTH MOTIF - not finished felt piano'
        elif any(w in lower for w in ['ambien','room tone','atmos']):kind='ambience'
        add(kind,t,length,f'{kind.upper()} {sfx:02d} | {desc[:74]}',desc,sound or '',status,i)
        if kind=='music':t+=2.6
        continue
    if re.match(r'^\[(Silence|Pause|beat|Beat)\b',clean,re.I):
        flush(i);m=re.search(r'(\d+(?:\.\d+)?)\s*(seconds?|beats?)',clean,re.I)
        d=(float(m.group(1))*(.5 if 'beat' in m.group(2).lower() else 1.)) if m else .5
        add('direction',t,d,'PAUSE | '+clean,clean,status='TIMING GUIDE',line=i);t+=d;continue
    if clean.startswith(('[WRITTEN','[PERFORMED','[TEXT READING')):
        flush(i);mode='reading';continue
    if clean.startswith('[') and clean.endswith(']'):
        flush(i);continue
    role=re.match(r'^\*\*([^*]+)\*\*\s*:?\s*(.*)$',line)
    if role:
        flush(i);lab=role.group(1).strip().upper().rstrip(':');rest=role.group(2).strip()
        mode='narration' if lab=='LOGAN' else 'reading' if ('WRITTEN' in lab or 'READING' in lab) else None
        if rest and mode and not rest.startswith('['):paragraph.append(rest)
        continue
    if line.startswith(('# ','## ')):continue
    if mode in ('narration','reading'):paragraph.append(clean)
flush(len(lines))
assert cue==55,f'Found {cue} expected 55'
sections.append(dict(name='END OF DOCUMENTARY',pos=round(t,3)))
def q(s):return json.dumps(str(s),ensure_ascii=False)
out=['return {',' metadata={source='+q(str(MANUSCRIPT))+'},',' sections={']
out += ['  {name='+q(s['name'])+',pos='+str(s['pos'])+'},' for s in sections]
out += [' },',' events={']
for e in events:
    out.append('  {'+','.join(k+'='+(str(v) if isinstance(v,(int,float)) else q(v)) for k,v in e.items())+'},')
out += [' }','}']
(OUT/'assembly_data.lua').write_text('\n'.join(out),encoding='utf-8')
with (OUT/'cue_sheet.csv').open('w',newline='',encoding='utf-8-sig') as f:
    w=csv.DictWriter(f,fieldnames=['kind','pos','dur','name','text','path','status','line']);w.writeheader();w.writerows(events)
report={'manuscript':str(MANUSCRIPT),'cue_count':cue,'draft_minutes':round(t/60,1),'items':len(events),
        'counts':dict(Counter(x['kind'] for x in events)),
        'missing_archives':[{'name':x['name'],'line':x['line']} for x in events if x['kind']=='missing_archive'],
        'sections':sections}
(OUT/'assembly_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print('ASSEMBLY_DATA_READY',report)
