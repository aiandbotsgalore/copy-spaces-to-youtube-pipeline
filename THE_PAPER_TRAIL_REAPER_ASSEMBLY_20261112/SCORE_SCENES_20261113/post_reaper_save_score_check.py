from pathlib import Path
import re,json
p=Path(__file__).resolve().parent.parent/'THE_PAPER_TRAIL_LOGAN_LABELS_REMOVED_SUNO_VISIBLE_v7.RPP'
a=p.read_bytes().decode('utf8','surrogateescape')
print('BYTES',p.stat().st_size)
for z in ['ORIGINAL SUNO SCENE P00 |','ORIGINAL SUNO SCENE S04 |','SUNO ORIGINAL SCENE SCORE','<VOLENV2','LOGAN ELEVENLABS']:
 print(z,'COUNT',a.count(z))
idx=a.find('SUNO ORIGINAL SCENE SCORE')
st=a.find('<VOLENV2',idx)
en=a.find('\n    >',st)
env=a[st:en]
print('NATIVE_SCORE_ENVELOPE_POINTS',sum(1 for line in env.splitlines() if line.strip().startswith('PT ')))
print('SONG_FILE_EXISTS', (p.parent/'SCORE_SCENES_20261113/SUNO_SCENE_P00.wav').exists())
