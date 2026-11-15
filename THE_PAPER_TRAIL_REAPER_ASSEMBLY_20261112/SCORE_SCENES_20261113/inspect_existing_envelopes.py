from pathlib import Path
p=Path(__file__).resolve().parent.parent/'THE_PAPER_TRAIL_LOGAN_LABELS_REMOVED_SUNO_VISIBLE_v7.RPP'
a=p.read_text(encoding='utf-8',errors='replace').splitlines()
for i,x in enumerate(a):
 if '<VOLENV2' in x:
  print('ENVELOPE at',i)
  for v in a[i:i+18]:print(v[:160])
