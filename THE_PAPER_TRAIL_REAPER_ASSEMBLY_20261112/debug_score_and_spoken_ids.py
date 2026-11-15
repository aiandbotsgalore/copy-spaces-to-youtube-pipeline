import csv,re,json,pathlib,collections
base=pathlib.Path(__file__).resolve().parent
rpp=base/'THE_PAPER_TRAIL_ELEVENLABS_LOGAN_AUDIBLE_SUNO_SCORE_v6.RPP'
cue=base/'cue_sheet.csv'
rows=list(csv.DictReader(cue.open(encoding='utf-8-sig',newline='')))
pat=re.compile(r'\b(?:AQ[-–_ ]?\d{2,5}|CLIP[-–_ ]?\d{2,5}|(?:SOURCE|TIMESTAMP|ARCHIVE)\s*[:#]\s*\S+)\b',re.I)
bad=[]
for i,row in enumerate(rows):
 if row['kind'] in ('narration','reading'):
  v=row['text']
  matches=[m.group() for m in pat.finditer(v)]
  if matches:bad.append({'row':i,'kind':row['kind'],'name':row['name'],'matches':matches,'text':v[:850]})
print('CUES',len(rows),'NARR',sum(x['kind']=='narration' for x in rows),'READING',sum(x['kind']=='reading' for x in rows))
print('BAD SPOKEN LABEL MATCHES',len(bad))
for x in bad[:85]:print('SPOKEN',json.dumps(x,ensure_ascii=False))
for s in ['01_CURRENT_MANUSCRIPT.md','NARR_JOB_01.json','NARR_JOB_02.json','NARR_JOB_17.json']:
 p=(base/s if s!='01_CURRENT_MANUSCRIPT.md' else base.parent/'THE_PAPER_TRAIL_ARGON_REVIEW_CONTEXT_20261112'/s)
 if not p.exists():continue
 text=p.read_text(encoding='utf-8-sig',errors='replace')
 hits=[m.group() for m in pat.finditer(text)]
 print('FILE',p.name,'LABELS',len(hits),'FIRST',hits[:25])
for suffix in ['v5.RPP','v6.RPP']:
 x=base/('THE_PAPER_TRAIL_ELEVENLABS_LOGAN_FULL_ASSEMBLY_v5.RPP' if suffix.startswith('v5') else 'THE_PAPER_TRAIL_ELEVENLABS_LOGAN_AUDIBLE_SUNO_SCORE_v6.RPP')
 print('RPP',x.name,x.stat().st_size)
 t=x.read_text(encoding='utf-8',errors='replace')
 for key in ['SUNO SCORE  |  INVESTIGATION','SUNO SCORE  |  TRUST','SUNO SCORE  |  SIGNATURE','THE_PAPER_TRAIL_SUNO_INVESTIGATION_CONTINUOUS_WORD_SCORE_v6.flac','B_MUTE 1']:
  print('KEY',key,'OCCURS',t.count(key))
for name in ['THE_PAPER_TRAIL_SUNO_INVESTIGATION_CONTINUOUS_WORD_SCORE_v6.flac','THE_PAPER_TRAIL_SUNO_HUMAN_CONTINUOUS_WORD_SCORE_v6.flac','THE_PAPER_TRAIL_SUNO_MOTIF_CONTINUOUS_WORD_SCORE_v6.flac']:
 p=base/name; print('STEM',name,'EXISTS',p.exists(),'BYTES',p.stat().st_size if p.exists() else None)
print('STORY BAD LABELS IN ALL NARRATION',sum(len(pat.findall(x['text'])) for x in rows if x['kind']=='narration'))
