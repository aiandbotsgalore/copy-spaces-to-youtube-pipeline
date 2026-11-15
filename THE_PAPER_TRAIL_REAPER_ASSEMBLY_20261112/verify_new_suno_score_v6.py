from pathlib import Path
import subprocess,json,numpy as np,math
root=Path(__file__).resolve().parent
names={
'old_mix':root/'THE_PAPER_TRAIL_ELEVENLABS_LOGAN_ROUGH_MIX.mp3',
'new_v6_mix':root/'THE_PAPER_TRAIL_ELEVENLABS_LOGAN_AUDIBLE_SUNO_SCORE_v6.mp3',
'dry_reference':root/'THE_PAPER_TRAIL_V6_ORIGINAL_VOICES_AND_ARCHIVES_DRY_REFERENCE.flac',
'new_investigation_stem':root/'THE_PAPER_TRAIL_SUNO_INVESTIGATION_CONTINUOUS_WORD_SCORE_v6.flac',
'new_human_stem':root/'THE_PAPER_TRAIL_SUNO_HUMAN_CONTINUOUS_WORD_SCORE_v6.flac',
'new_motif_stem':root/'THE_PAPER_TRAIL_SUNO_MOTIF_CONTINUOUS_WORD_SCORE_v6.flac',
}
report={}
for label,path in names.items():
 if not path.is_file():raise FileNotFoundError(path)
 p=subprocess.run(['ffmpeg','-nostdin','-v','error','-ss','10','-i',str(path),'-t','45','-ac','1','-ar','24000','-f','f32le','pipe:1'],capture_output=True)
 if p.returncode:raise RuntimeError('Decode failed '+path.name)
 a=np.frombuffer(p.stdout,dtype='<f4')
 rms=20*math.log10(max(1e-8,float(np.sqrt(np.mean(a*a,dtype=np.float64)))))
 peak=20*math.log10(max(1e-8,float(np.max(np.abs(a)))))
 report[label]={'rms_dBFS_10s_to_55s':round(rms,2),'peak_dBFS_10s_to_55s':round(peak,2),
               'bytes':path.stat().st_size}
preview=root/'THE_PAPER_TRAIL_NEW_SUNO_SCORE_OPENING_90_SECOND_PREVIEW.mp3'
r=subprocess.run(['ffmpeg','-y','-nostdin','-v','error','-i',str(names['new_v6_mix']),
    '-t','90','-c:a','libmp3lame','-b:a','256k',str(preview)],capture_output=True)
if r.returncode:raise RuntimeError(r.stderr.decode('utf-8','replace')[-400:])
meta=json.loads(subprocess.run(['ffprobe','-v','error','-show_entries',
    'stream=codec_name,sample_rate,channels:format=duration,size','-of','json',str(names['new_v6_mix'])],
   capture_output=True,text=True,check=True).stdout)
report['final_audio']={'duration_s':float(meta['format']['duration']),
 'sample_rate':int(meta['streams'][0]['sample_rate']),'channels':int(meta['streams'][0]['channels']),
 'mp3_preview':str(preview),'preview_bytes':preview.stat().st_size}
(root/'THE_PAPER_TRAIL_SUNO_SCORE_V6_AUDIO_QA.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
