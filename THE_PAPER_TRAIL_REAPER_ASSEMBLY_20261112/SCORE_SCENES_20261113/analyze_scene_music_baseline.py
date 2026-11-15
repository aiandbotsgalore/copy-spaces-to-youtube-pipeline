import csv,json,collections,math,pathlib,subprocess,numpy as np
root=pathlib.Path(__file__).resolve().parent
with (root/'MUSIC_REFINEMENT_FULL_ITEM_AUDIT.tsv').open(encoding='utf-8-sig',errors='replace',newline='') as f:rows=list(csv.DictReader(f,delimiter='\t'))
with (root/'MUSIC_REFINEMENT_MARKERS.tsv').open(encoding='utf-8-sig',errors='replace',newline='') as f:markers=list(csv.DictReader(f,delimiter='\t'))
scenes=sorted([m for m in markers if m['isregion']=='1'],key=lambda x:float(x['pos']))
def ovel(a,b,c,d):return max(0,min(b,d)-max(a,c))
def type_of(row):
    tr=row['track'].lower()
    if 'elevenlabs logan' in tr and 'narration' in tr:return 'NARRATOR'
    if 'archive' in tr:return 'ARCHIVE'
    if 'suno original scene score' in tr:return 'SCENE_MUSIC'
    if 'suno instrumental score' in tr:return 'UNDER_SCORE'
    return None
major=[x for x in rows if type_of(x)]
voice=[x for x in major if type_of(x) in ('NARRATOR','ARCHIVE')]
scores=[x for x in major if type_of(x)=='SCENE_MUSIC']
under=[x for x in major if type_of(x)=='UNDER_SCORE']
report={}
for m in scenes:
    a=float(m['pos']);b=float(m['finish'])
    items=[]
    for x in scores:
        c=float(x['start']);e=float(x['end'])
        ov=ovel(a,b,c,e)
        if ov>.1:items.append({'name':x['name'],'start':round(c,1),'length':round(e-c,1),'scene_coverage_pct':round(ov/(b-a)*100,1),
                              'eff_gain_db':round(20*math.log10(max(1e-10,float(x['trackvol'])*float(x['takevol'])*float(x['itemvol']))),1)})
    total_narr=sum(ovel(a,b,float(x['start']),float(x['end'])) for x in voice if type_of(x)=='NARRATOR')
    total_arch=sum(ovel(a,b,float(x['start']),float(x['end'])) for x in voice if type_of(x)=='ARCHIVE')
    report[m['name']]={'start':round(a,1),'end':round(b,1),'duration_s':round(b-a,1),
         'narrator_seconds':round(total_narr,1),'archive_seconds':round(total_arch,1),
         'narrator_pct':round(total_narr/(b-a)*100,1),'archive_pct':round(total_arch/(b-a)*100,1),
         'distinct_scene_cues':items}
def inspect_audio(src,offset,duration=50):
    p=subprocess.run(['ffmpeg','-nostdin','-v','error','-ss',str(offset),'-i',src,'-t',str(duration),
        '-ar','16000','-ac','1','-f','f32le','pipe:1'],capture_output=True)
    if p.returncode:raise RuntimeError(src+': '+p.stderr.decode('utf-8','replace')[-300:])
    arr=np.frombuffer(p.stdout,dtype='<f4')
    if arr.size<16000:raise ValueError('empty source '+src)
    return {'rms_dbfs':round(20*math.log10(max(1e-9,float(np.sqrt(np.mean(arr*arr,dtype=np.float64))))),2),
           'peak_dbfs':round(20*math.log10(max(1e-9,float(np.max(np.abs(arr))))),2)}
rms=[]
for s in scores:
    v=inspect_audio(s['source'],float(s['offset']),min(float(s['length']),65))
    gain=20*math.log10(max(1e-10,float(s['trackvol'])*float(s['takevol'])*float(s['itemvol'])))
    rms.append({'name':s['name'],'start':round(float(s['start']),1),'length':round(float(s['length']),1),
                'dry_rms':v['rms_dbfs'],'effective_rms':round(v['rms_dbfs']+gain,1),
                'dry_peak':v['peak_dbfs'],'effective_peak':round(v['peak_dbfs']+gain,1),'gain_db':round(gain,1)})
voices=[]
for v in voice:
    if 'elevenlabs' not in v['source'].lower():continue
    if len(voices)>=9:break
    amp=inspect_audio(v['source'],float(v['offset']),min(float(v['length']),18))
    gain=20*math.log10(max(1e-9,float(v['trackvol'])*float(v['takevol'])*float(v['itemvol'])))
    voices.append({'name':v['name'][:75],'start':round(float(v['start']),1),'rms':round(amp['rms_dbfs']+gain,1),
                   'peak':round(amp['peak_dbfs']+gain,1),'gain':round(gain,1)})
out={'scene_placement':report,'scene_music_rms':rms,'voice_examples':voices,
     'count':{'source_audio_items':len(rows),'voice_items':len(voice),'under_score_items':len(under),'new_score_items':len(scores)},
     'notes':['Audio RMS dBFS are objective sample measurements, not integrated LUFS or subjective listening checks.',
              'Scene cues shorter than long chapters; continuous original score stems handle intervals.']}
(root/'MUSIC_REFINEMENT_BASELINE.json').write_text(json.dumps(out,indent=2,ensure_ascii=False),encoding='utf-8')
print('BASELINE COUNTS',out['count'])
print('SCENES:')
for k,v in report.items():print(k[:48], 'duration',v['duration_s'],'narr',v['narrator_pct'],'archive',v['archive_pct'],
 'cue coverage',[(i['name'].split('|')[0][-12:],i['scene_coverage_pct']) for i in v['distinct_scene_cues']])
print('NEW SUNO MUSIC RMS:')
for s in rms:print(s)
print('NARRATOR EXAMPLES:')
for s in voices:print(s)


