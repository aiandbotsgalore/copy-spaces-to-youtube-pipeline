from pathlib import Path
import json, csv

root=Path(__file__).resolve().parent
with (root/'cue_sheet.csv').open(encoding='utf-8-sig',newline='') as f:
    rows=list(csv.DictReader(f))
timing=json.loads((root/'prologue_word_score_alignment.json').read_text(encoding='utf-8'))
opening=timing['takes']['opening']
reveal=timing['takes']['reveal']
events=[]
markers=[]
def L(v): return json.dumps(str(v),ensure_ascii=False)
def event(track,start,duration,label,path='',offset=0,volume=1.0,fadein=0,fadeout=0,notes=''):
    events.append({'track':track,'pos':round(float(start),3),'dur':round(float(duration),3),'name':label,'path':str(path),'offset':float(offset),'volume':float(volume),'fadein':float(fadein),'fadeout':float(fadeout),'notes':notes})
def mark(t,s):
    markers.append({'pos':round(float(t),3),'name':s})
def archive(row,start):
    path=Path(row['path'])
    if not path.is_file(): raise FileNotFoundError(path)
    event('archive',start,float(row['dur']),row['name'],path,
        notes='ARCHIVAL RECORDING. Keep dry; requires final audition and speaker/cut verification.\n'+row['text'][:600])
    return start+float(row['dur'])

start=0.5
first_end=archive(rows[1],start)
mark(start,'START — real Angela archive, NO score')
mark(first_end,'HARD CUT — 1.1 sec dry silence')
opening_start=first_end+1.1
for i, idx in enumerate([3,4,6,7,8]):
    a=opening['anchors'][[0,1,2,3,5][i]]
    b=opening['anchors'][[1,2,3,5][i]] if i<4 else {'start_s':opening['last_speech_end_s']+0.65}
    p=opening_start+a['start_s']
    length=max(.5,b['start_s']-a['start_s']-0.05)
    event('narration',p,length,
        'LOGAN VOICE GUIDE: '+rows[idx]['name'].split('|',1)[1].strip()[:100],
        notes='EXACT NARRATION TEXT:\n'+rows[idx]['text']+
        '\n\nSuno pilot: '+opening['suno_url']+
        '\nSuno word alignment relative to actual speech. Audio not yet downloaded. Do not treat this guide as a recorded performance.')
for a in opening['anchors']:
    mark(opening_start+a['start_s'],'LOGAN — '+a['phrase'])
montage_start=opening_start+opening['last_speech_end_s']+1.35
mark(montage_start,'RAPID RAW ARCHIVE MONTAGE — no music')
montage_end=montage_start
for row in rows[10:19]:
    montage_end=archive(row,montage_end)+.10
mark(montage_end,'HARD STOP — 0.95 sec dry silence')
reveal_start=montage_end+0.95
for i,idx in enumerate([20,21,22]):
    a=reveal['anchors'][[0,1,3][i]]
    b=reveal['anchors'][[1,3][i]] if i<2 else {'start_s':reveal['last_speech_end_s']+.7}
    event('narration',reveal_start+a['start_s'],
      max(.5,b['start_s']-a['start_s']-.03),
      'LOGAN VOICE GUIDE: '+rows[idx]['name'].split('|',1)[1].strip()[:100],
      notes='EXACT NARRATION TEXT:\n'+rows[idx]['text']+
      '\n\nSuno pilot: '+reveal['suno_url']+
      '\nAudio not downloaded. Marker positions are based on Suno word alignment.')
for a in reveal['anchors']:
    mark(reveal_start+a['start_s'],'LOGAN — '+a['phrase'])
# A deliberately restrained alternate-score test, not an approved manuscript change.
music_start=reveal_start+reveal['anchors'][1]['start_s']-.15
music_hardcut=reveal_start+reveal['anchors'][2]['start_s']-.18
music_path=root/'Walking_Paper_Trail_Instrumental_Suno.wav'
if not music_path.is_file(): raise FileNotFoundError(music_path)
event('music',music_start,music_hardcut-music_start,
      'EXPERIMENT: distant piano begins on "What you wouldn\'t know"; dies before "friends"',
      music_path,offset=15.0,volume=.13,fadein=1.1,fadeout=.15,
      notes='TEMPORARY AVAILABLE SUNO INSTRUMENTAL (2026-10-05), NOT THE NEW APPROVED SIGNATURE CUE. Word-synchronized editorial experiment. Quietly introduce bed at "What you would not know"; CUT before "Angela and I were friends". Remove if it tells the listener what to feel. Before approval, listen against actual spoken recording.\nSource: https://suno.com/song/46194da4-b5cf-4832-a7ae-e0394a0584d0')
mark(music_start,'SCORE IN: What you wouldn\'t know — proposed')
mark(music_hardcut,'SCORE OUT before "Angela and I were friends" — silence')
friend_end=reveal_start+reveal['last_speech_end_s']+0.9
mark(friend_end,'ARCHIVE RETURNS — no score')
archive_end=archive(rows[23],friend_end)
mark(archive_end,'END OF WORD-SCORE PILOT')
metadata={'opening_suno_id':opening['audio_id'],'reveal_suno_id':reveal['audio_id'],'original_score_source':'Walking_Paper_Trail_Instrumental_Suno.wav','reveal_music_in':round(music_start,3),'reveal_music_out':round(music_hardcut,3),'montage_clips':len(rows[10:19]),'total_duration_s':round(archive_end,3)}
def dict_lua(d):
    return '{'+','.join('['+L(k)+']='+ (L(v) if isinstance(v,str) else str(v)) for k,v in d.items())+'}'
dst='return {\n events={\n'+',\n'.join(dict_lua(e) for e in events)+'\n },\n markers={\n'+',\n'.join(dict_lua(m) for m in markers)+'\n }\n}\n'
(root/'prologue_score_pilot_data.lua').write_text(dst,encoding='utf-8')
(root/'prologue_score_pilot_report.json').write_text(json.dumps({'metadata':metadata,'events':[{k:v for k,v in e.items() if k!='notes'} for e in events], 'markers':markers},indent=2,ensure_ascii=False),encoding='utf-8')
print('PILOT PREPARED',json.dumps(metadata))
print('Events',len(events),'Markers',len(markers),'Data file',len(dst),'bytes')
