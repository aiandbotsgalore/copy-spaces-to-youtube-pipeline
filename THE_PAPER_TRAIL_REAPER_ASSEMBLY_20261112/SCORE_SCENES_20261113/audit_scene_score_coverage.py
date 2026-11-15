import json,pathlib,csv,statistics
base=pathlib.Path(__file__).resolve().parent.parent
j=json.loads((base/'SCORE_SCENES_20261113/SELECTED_SCENE_CUES_AND_PLACEMENTS.json').read_text(encoding='utf8'))
print('SCENE SOURCE COVERAGE')
for x in j['cues']:
 duration=x['verified_duration']-x['offset']
 scene=x['end']-x['start']
 print(x['id'],'SCENE',round(scene,1),'SOURCE_AVAIL',round(duration,1),'CURRENT_COVER',round(min(scene,duration),1),'MISSING_BED',round(max(0,scene-duration),1),'GAIN',x['gain'])
print('MASTER PROJECT', (base/'THE_PAPER_TRAIL_LOGAN_LABELS_REMOVED_SUNO_VISIBLE_v7.RPP').stat().st_size)
# Read narr/archival stems and times from prior native REAPER manifest v6.
f=base/'ELEVENLABS_V6_ALL_AUDIO_MIX_ITEMS.tsv'
rows=list(csv.DictReader(f.open(encoding='utf-8-sig'),delimiter='\t'))
v=[x for x in rows if 'ELEVENLABS' in x['trackname'].upper()]
a=[x for x in rows if ('ARCHIVE' in x['trackname'].upper())]
print('NARRATION_REGIONS',len(v),'ARCHIVE',len(a))
for x in j['cues']:
 t0=x['start']; t1=x['end']
 nv=[y for y in v if float(y['pos'])<t1 and float(y['pos'])+float(y['dur'])>t0]
 av=[y for y in a if float(y['pos'])<t1 and float(y['pos'])+float(y['dur'])>t0]
 print('SPEECH',x['id'],len(nv),'narr_cues',len(av),'archive_clips')

