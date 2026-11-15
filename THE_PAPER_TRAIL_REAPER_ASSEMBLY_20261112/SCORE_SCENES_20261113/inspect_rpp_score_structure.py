from pathlib import Path
p=Path(__file__).resolve().parent.parent/'THE_PAPER_TRAIL_LOGAN_LABELS_REMOVED_SUNO_VISIBLE_v7.RPP'
lines=p.read_text(encoding='utf-8',errors='replace').splitlines()
keys=['SUNO ORIGINAL SCENE SCORE','ORIGINAL SUNO SCENE P00','ORIGINAL SUNO SCENE S04','<TRACK','<ITEM','VOLPAN']
for k in keys:
    matches=[i for i,s in enumerate(lines) if k in s]
    print('\nKEY',k,'COUNT',len(matches),'FIRST',matches[:4])
    for ix in matches[:2]:
        print('\n'.join(f'{z}: {lines[z][:240]}' for z in range(max(0,ix-3),min(len(lines),ix+21))))
