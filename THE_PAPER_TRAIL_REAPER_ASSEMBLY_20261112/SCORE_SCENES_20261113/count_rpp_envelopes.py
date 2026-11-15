from pathlib import Path
p=Path(__file__).resolve().parent.parent/'THE_PAPER_TRAIL_LOGAN_LABELS_REMOVED_SUNO_VISIBLE_v7.RPP'
ls=p.read_text(encoding='utf8',errors='replace').splitlines()
for k in [14739,15483,16227,16971]:
 n=k+1
 while n<len(ls) and ls[n].strip()!='>':n+=1
 pts=[s.strip() for s in ls[k+1:n] if s.strip().startswith('PT ')]
 print('ENV',k,'end',n,'POINTS',len(pts),'FIRST',pts[:3],'LAST',pts[-3:])
 print('BEFORE',[(i,ls[i]) for i in range(k-20,k) if 'NAME ' in ls[i] or 'VOLPAN ' in ls[i] or '<TRACK' in ls[i]])
