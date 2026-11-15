import pathlib,csv
base=pathlib.Path(__file__).resolve().parent
with (base/'MUSIC_REFINEMENT_FULL_ITEM_AUDIT.tsv').open(encoding='utf-8',errors='replace',newline='') as f:a=list(csv.DictReader(f,delimiter='\t'))
for t0,t1 in [(1600,1700),(1980,2100),(2150,2270),(2290,2360),(2750,2880),(2960,3080),(3390,3520),(4060,4220)]:
 print('\n====',t0,'to',t1,'====')
 q=[x for x in a if 'NARRATION (NO SPOKEN' in x['track'] or 'ARCHIVE' in x['track']]
 for x in q:
  p=float(x['start']);e=float(x['end'])
  if p<t1 and e>t0:
   print(round(p,1),round(e,1),x['track'].split('|')[-1].strip()[:20],x['name'][:180])

