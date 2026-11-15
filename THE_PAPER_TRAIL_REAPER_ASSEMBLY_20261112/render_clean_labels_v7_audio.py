"""Non-destructively render v7 audio with all four spoken metadata cuts removed.
Uses the already mixed v6 audio; no ElevenLabs generation and no Suno spending.
"""
from pathlib import Path
import subprocess,json,math
base=Path(__file__).resolve().parent
source=base/'THE_PAPER_TRAIL_ELEVENLABS_LOGAN_AUDIBLE_SUNO_SCORE_v6.mp3'
if not source.is_file():raise FileNotFoundError(source)
cuts=json.loads((base/'SPOKEN_AQ_ID_AUDIO_CUT_PLAN.json').read_text(encoding='utf-8'))['cuts']
end=4436.899
kept=[]
start=0
for c in cuts:
 if c['start']<start or c['end']<=c['start']:raise RuntimeError('Overlapping source cuts')
 kept.append([start,c['start']])
 start=c['end']
kept.append([start,end])
filters=[]
for i,(s,e) in enumerate(kept):
 n=e-s
 if n<.1:raise RuntimeError('Short segment')
 expr=f'[{i}]atrim=start={s:.6f}:end={e:.6f},asetpts=PTS-STARTPTS'
 if i>0:expr+=',afade=t=in:st=0:d=0.030'
 if i<len(kept)-1:expr+=f',afade=t=out:st={n-0.03:.6f}:d=0.030'
 expr+=f'[a{i}]'
 filters.append(expr)
# Five split streams from the same music+voice v6 source
filter_complex='[0:a]asplit=5'+''.join(f'[{i}]' for i in range(5))+';'
filter_complex+=';'.join(filters)+';'
filter_complex+=''.join(f'[a{i}]' for i in range(5))+'concat=n=5:v=0:a=1[aout]'
target=base/'THE_PAPER_TRAIL_LOGAN_NO_AQ_LABELS_SUNO_SCORE_v7.mp3'
cmd=['ffmpeg','-y','-nostdin','-hide_banner','-loglevel','error','-i',str(source),
     '-filter_complex',filter_complex,'-map','[aout]','-ar','48000','-ac','2',
     '-c:a','libmp3lame','-b:a','224k',str(target)]
print('START V7 AUDIO RENDER',len(cuts),'cuts, expected',round(end-sum(x['end']-x['start'] for x in cuts),3),'seconds',flush=True)
r=subprocess.run(cmd,stderr=subprocess.PIPE,stdout=subprocess.PIPE)
if r.returncode:raise RuntimeError(r.stderr.decode('utf-8','replace')[-2500:])
z=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration,size:stream=sample_rate,channels',
'-of','json',str(target)],capture_output=True,text=True,check=True)
meta=json.loads(z.stdout)
duration=float(meta['format']['duration'])
expected=end-sum(x['end']-x['start'] for x in cuts)
if abs(duration-expected)>.3:raise RuntimeError(f'Wrong audio duration {duration}, expected {expected}')
preview=base/'THE_PAPER_TRAIL_FIXED_AQ_IDS_ACT_I_65_SEC_PREVIEW.mp3'
r2=subprocess.run(['ffmpeg','-y','-nostdin','-v','error','-ss','515','-i',str(target),'-t','65',
'-c:a','libmp3lame','-b:a','256k',str(preview)],stderr=subprocess.PIPE)
if r2.returncode:raise RuntimeError('Preview export failed '+r2.stderr.decode('utf-8','replace')[-800:])
report={'status':'rendered_and_duration_verified','source':str(source),'corrected_mix':str(target),
 'sample_rate':int(meta['streams'][0]['sample_rate']),'channels':int(meta['streams'][0]['channels']),
 'duration_s':round(duration,3),'duration_expected_s':round(expected,3),
 'removed_audio_segments':cuts,'removed_labels':['AQ-0011','AQ-0195','AQ-0206','AQ-0209','AQ-0056'],
 'audio_preview':str(preview),'new_elevenlabs_generations':0,
 'note':'Technically accurate edit; final spoken flow at joins should still be auditioned in REAPER.'}
(base/'THE_PAPER_TRAIL_V7_AQ_LABEL_REMOVAL_AUDIO_REPORT.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print('V7 AUDIO COMPLETE',json.dumps({'duration_s':duration,'mp3_bytes':target.stat().st_size,'preview_bytes':preview.stat().st_size},indent=2),flush=True)
