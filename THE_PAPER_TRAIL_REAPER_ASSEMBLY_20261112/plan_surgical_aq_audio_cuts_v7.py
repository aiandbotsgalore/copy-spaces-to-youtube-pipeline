import pathlib,json,csv,re
base=pathlib.Path(__file__).resolve().parent
aud=base/'V6_TRACKS_AND_SOURCE_TIMING_AUDIT.tsv'
rows=list(csv.DictReader(aud.open(encoding='utf-8-sig',newline=''),delimiter='\t'))
cue={}
for x in rows:
 if x['TYPE']=='ITEM' and 'LOGAN ELEVENLABS' in x['NAME']:
  m=re.search(r'\bCUE\s+(53|54)\s*\|',x['NAME'])
  if m:
   cue[int(m.group(1))]={'timeline':float(x['T_POS']),'offset':float(x['OFFSET']),'length':float(x['DUR']),'name':x['NAME']}
src_segments=[
 {'cue':53,'source_start':10.78,'source_end':13.215,'label':'AQ-0011'},
 {'cue':53,'source_start':24.80,'source_end':27.56,'label':'AQ-0195'},
 {'cue':54,'source_start':34.04,'source_end':38.94,'label':'AQ-0206 and AQ-0209'},
 {'cue':54,'source_start':43.88,'source_end':46.815,'label':'AQ-0056'}
]
for s in src_segments:
 c=cue[s['cue']]
 s['start']=round(c['timeline']+s['source_start']-c['offset'],5)
 s['end']=round(c['timeline']+s['source_end']-c['offset'],5)
 assert c['timeline']<=s['start']<s['end']<=c['timeline']+c['length']+.001
assert all(a['end']<b['start'] for a,b in zip(src_segments,src_segments[1:]))
originals=list(csv.DictReader((base/'cue_sheet.csv').open(encoding='utf-8-sig',newline='')))
scrub=lambda t:re.sub(r'\s*\(\s*\x60AQ-\d+\x60(?:\s*,\s*\x60AQ-\d+\x60)*\s*\)','',t).replace('  ',' ').strip()
clean={i:scrub(originals[i]['text']) for i in (53,54)}
for i in (53,54):
 assert 'AQ-' not in clean[i]
 assert len(clean[i])<len(originals[i]['text'])
for i,s in enumerate(src_segments):
 if i:assert src_segments[i-1]['end']<s['start']
out={'source_file':'ELEVENLABS_LOGAN_NARR_03.mp3','method':'Timeline-native REAPER splits and removes internal spoken labels; no ElevenLabs calls or credits',
'cuts':src_segments,'total_seconds_cut':round(sum(x['end']-x['start'] for x in src_segments),3),
'corrected_spoken_cues':clean,'cue_offsets':cue}
(base/'SPOKEN_AQ_ID_AUDIO_CUT_PLAN.json').write_text(json.dumps(out,indent=2,ensure_ascii=False),encoding='utf-8')
narr=[(i,scrub(x['text'])) for i,x in enumerate(originals) if x['kind']=='narration']
bad=[(i,m.group()) for i,t in narr for m in re.finditer(r'\b(?:AQ-\d+|CLIP-\d+)\b',t)]
if bad:raise ValueError('NARRATION still has source ID '+str(bad))
text='THE PAPER TRAIL — NARRATION ONLY (NO SOURCE IDS)\n'
text+='PRODUCTION NOTE: Do not read internal cue numbers aloud. Archival IDs remain in original source/cue files.\n\n'
for i,t in narr:text+=f'--- Narration cue {i} (EDITORIAL LABEL, NOT FOR TTS) ---\n{t}\n\n'
(base/'THE_PAPER_TRAIL_NARRATION_ONLY_NO_SOURCE_IDS.txt').write_text(text,encoding='utf-8')
print(json.dumps(out,indent=2,ensure_ascii=False))
print('NARRATION_ONLY_OK',len(narr),'spoken cues','ZERO remaining inline AQ IDs')
