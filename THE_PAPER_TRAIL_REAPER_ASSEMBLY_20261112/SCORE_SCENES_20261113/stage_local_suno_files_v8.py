from pathlib import Path
import json,re,shutil,subprocess,hashlib
base=Path(__file__).resolve().parent.parent
src=Path(r'G:\paperTrailSoundtrack')
dst=base/'SCORE_SCENES_20261113'
dst.mkdir(parents=True,exist_ok=True)
catalog=json.loads((dst/'SELECTED_SCENE_CUES_AND_PLACEMENTS.json').read_text(encoding='utf-8'))
expected=[c['id'] for c in catalog['cues']]
assert expected==['P00','S01','S02','S03','S04','S05','S06','S07','S08','S09','S10','EPI']
matched={}
for p in src.iterdir():
    if not p.is_file() or p.suffix.lower() not in ('.wav','.mp3','.flac'):continue
    m=re.search(r'\b(P00|S\d{2}|EPI)\b',p.name,re.I)
    if not m:continue
    key=m.group(1).upper()
    if key in matched:raise ValueError(f'Duplicate source for {key}: {p} / {matched[key]}')
    matched[key]=p
assert sorted(matched)==sorted(expected),f'Missing/extra: {sorted(matched)} vs {sorted(expected)}'
report=[]
for cue in catalog['cues']:
    key=cue['id']
    original=matched[key]
    target=dst/('SUNO_SCENE_'+key+original.suffix.lower())
    if target.exists():
        if target.stat().st_size!=original.stat().st_size or hashlib.sha256(target.read_bytes()).digest()!=hashlib.sha256(original.read_bytes()).digest():
            raise RuntimeError(f'An existing staging file differs. Refusing overwrite: {target}')
    else:
        shutil.copy2(original,target)
    probe=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',str(target)],capture_output=True,text=True,check=True)
    duration=float(probe.stdout.strip())
    if duration<cue['offset']+20:raise RuntimeError(f'Audio too short: {key}, {duration}s')
    # Use path relative to REAPER project base; preserve the actual downloaded MP3 / WAV format.
    cue['filename']=str(target.relative_to(base)).replace('\\','/')
    cue['verified_duration']=round(duration,3)
    cue['source_original']=str(original)
    cue['audio_size_bytes']=target.stat().st_size
    report.append({'cue':key,'file':str(target),'source':str(original),'bytes':target.stat().st_size,'duration':round(duration,3),'song_url':cue['song_url']})
catalog['status']='LOCAL_AUDIO_COPIED_AND_VERIFIED'
catalog['match_method']='Twelve unique P00/S01-S10/EPI markers in user-downloaded filenames, cross-checked with listed titles and ffprobe durations; no Suno requests.'
catalog['new_download_credits_spent']=0
(dst/'SELECTED_SCENE_CUES_AND_PLACEMENTS.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2),encoding='utf-8')
def lua(x):
    if x is None:return 'nil'
    if isinstance(x,str):return json.dumps(x,ensure_ascii=False)
    if isinstance(x,bool):return 'true' if x else 'false'
    if isinstance(x,(int,float)):return str(x)
    if isinstance(x,list):return '{'+','.join(lua(y) for y in x)+'}'
    if isinstance(x,dict):return '{'+','.join('['+lua(k)+']='+lua(v) for k,v in x.items())+'}'
    return lua(str(x))
(dst/'SCORE_SCENE_IMPORT_DATA.lua').write_text('return '+lua(catalog['cues']),encoding='utf-8')
(dst/'STAGED_LOCAL_SUNO_SCENE_AUDIO_REPORT.json').write_text(json.dumps({'count':len(report),'files':report},indent=2,ensure_ascii=False),encoding='utf-8')
print('STAGING COMPLETE: 12 VERIFIED FILES, 0 DOWNLOAD CREDITS')
for e in report:print(e['cue'],e['duration'],e['bytes'],Path(e['file']).name)

