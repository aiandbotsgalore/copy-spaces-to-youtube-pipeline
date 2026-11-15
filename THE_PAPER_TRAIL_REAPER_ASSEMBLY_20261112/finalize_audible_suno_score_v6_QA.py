"""Final full-length audio QC; replace the previous over-peaking v6 mix only after proof."""
import json,subprocess,pathlib,re,math,numpy as np,os
root=pathlib.Path(__file__).resolve().parent
candidate=root/'THE_PAPER_TRAIL_SUNO_SCORE_V6_QA_FINAL_TEMP.mp3'
final=root/'THE_PAPER_TRAIL_ELEVENLABS_LOGAN_AUDIBLE_SUNO_SCORE_v6.mp3'
if not candidate.is_file() or candidate.stat().st_size<80000000:raise RuntimeError('Full candidate not present')
meta=json.loads(subprocess.run(['ffprobe','-v','error','-show_entries',
    'format=duration,size:stream=sample_rate,channels,codec_name',
    '-of','json',str(candidate)],capture_output=True,text=True,check=True).stdout)
duration=float(meta['format']['duration'])
if abs(duration-4436.899)>1.0:raise RuntimeError(f'Wrong duration: {duration}')
levels={}
for off,t in [(10,45),(500,60),(2500,60),(4100,60)]:
 r=subprocess.run(['ffmpeg','-nostdin','-v','error','-ss',str(off),'-i',str(candidate),'-t',str(t),'-ac','2','-ar','48000','-f','f32le','pipe:1'],
  capture_output=True)
 if r.returncode:raise RuntimeError('Segment QC failed')
 a=np.frombuffer(r.stdout,dtype='<f4')
 peak=20*math.log10(max(1e-8,float(np.max(np.abs(a)))))
 rms=20*math.log10(max(1e-8,float(np.sqrt(np.mean(a*a,dtype=np.float64)))))
 levels[f'{off}s']={'rms_dBFS':round(rms,2),'sample_peak_dBFS':round(peak,2)}
 if peak>-.25:raise RuntimeError(f'Excessive peak {off}s {peak:.2f}')
# Full stream volume peak check, not just four samples.
volume=subprocess.run(['ffmpeg','-nostdin','-hide_banner','-i',str(candidate),'-af','volumedetect','-f','null','NUL'],
  stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
fulltext=volume.stderr
matched=re.findall(r'max_volume:\s*(-?\d+(?:\.\d+)?) dB',fulltext)
full_peak=float(matched[-1]) if matched else None
if volume.returncode!=0 or full_peak is None:raise RuntimeError('Volume scan failed: '+fulltext[-500:])
if full_peak>-.25:raise RuntimeError(f'Full episode decoded peak too high: {full_peak}')
os.replace(candidate,final)
preview=root/'THE_PAPER_TRAIL_NEW_SUNO_SCORE_OPENING_90_SECOND_PREVIEW.mp3'
r=subprocess.run(['ffmpeg','-y','-nostdin','-hide_banner','-loglevel','error',
                  '-i',str(final),'-t','90','-c:a','libmp3lame','-b:a','256k',str(preview)],capture_output=True)
if r.returncode:raise RuntimeError('Preview failed: '+r.stderr.decode('utf-8','replace')[-500:])
reportp=root/'THE_PAPER_TRAIL_SUNO_SCORE_V6_RENDER_REPORT.json'
report=json.loads(reportp.read_text(encoding='utf-8'))
report['status']='final_audio_QA_PASS'
report['final_full_episode_mp3']=str(final)
report['final_full_episode_size_bytes']=final.stat().st_size
report['full_episode_max_decoded_peak_dBFS']=full_peak
report['sampled_sections']=levels
report['opening_90s_preview']=str(preview)
report['opening_preview_size_bytes']=preview.stat().st_size
report['publishable']=False
report['note']='Audible continuous Suno score corrected and verified below 0 dBFS. This remains a documentary rough cut with missing reading and archival media.'
reportp.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
# Test files are ours; safe to remove after final is validated.
for extra in ['THE_PAPER_TRAIL_SUNO_V6_LIMITED_TEST.mp3','SUNO_V6_60_SEC_LIMITER_TEST.mp3']:
 (root/extra).unlink(missing_ok=True)
print(json.dumps({'qa':'PASS','new_mp3':str(final),'mp3_bytes':final.stat().st_size,
  'duration_s':duration,'sample_rate':meta['streams'][0]['sample_rate'],
  'whole_mix_max_peak_dBFS':full_peak,'sections':levels,
  'opening_preview':str(preview)},indent=2))

