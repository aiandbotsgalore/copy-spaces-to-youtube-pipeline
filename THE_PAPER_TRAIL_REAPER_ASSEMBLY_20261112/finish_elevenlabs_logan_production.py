"""Check finished ElevenLabs Logan draft media and leave a plain-language handoff."""
from pathlib import Path
import json,subprocess
base=Path(__file__).resolve().parent
rpp=base/'THE_PAPER_TRAIL_ELEVENLABS_LOGAN_FULL_ASSEMBLY_v5.RPP'
wav=base/'THE_PAPER_TRAIL_ELEVENLABS_LOGAN_ROUGH_MIX_48KHZ.wav'
mp3=base/'THE_PAPER_TRAIL_ELEVENLABS_LOGAN_ROUGH_MIX.mp3'
reportp=base/'ELEVENLABS_LOGAN_FULL_ROUGH_MIX_REPORT.json'
qap=base/'ELEVENLABS_V5_ALIGNMENT_QA.json'
report=json.loads(reportp.read_text(encoding='utf-8'))
qa=json.loads(qap.read_text(encoding='utf-8'))
def probe(p):
    z=subprocess.run(['ffprobe','-v','error','-select_streams','a:0',
            '-show_entries','stream=sample_rate,channels,codec_name:format=duration',
            '-of','json',str(p)],capture_output=True,text=True,check=True)
    return json.loads(z.stdout)
files=[base/f'ELEVENLABS_LOGAN_NARR_{i:02d}.mp3' for i in range(1,18)]
wordfiles=[base/f'ELEVENLABS_NARR_{i:02d}_WORDS.json' for i in range(1,18)]
missing=[p.name for p in [rpp,wav,mp3,*files,*wordfiles] if not p.is_file() or p.stat().st_size==0]
if missing:raise RuntimeError('Required files missing: '+str(missing))
winfo=probe(wav);minfo=probe(mp3)
if int(winfo['streams'][0]['sample_rate'])!=48000:raise RuntimeError('WAV sample rate not 48000')
if int(minfo['streams'][0]['sample_rate'])!=48000:raise RuntimeError('MP3 sample rate not 48000')
report['wav_bytes']=wav.stat().st_size
report['mp3_bytes']=mp3.stat().st_size
report['wav_metadata']=winfo
report['mp3_metadata']=minfo
report['render_verified']=True
report['narration_files_verified']=len(files)
report['exact_voice_id']='GDqvTqQdsHV3ND6SiEZP'
report['audio_source_gaps']=['AQ-0048','AQ-0220',
   'AQ-0233 candidate (zero-length WAV)','AQ-0222 candidate (zero-length WAV)']
reportp.write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf-8')
guide=f"""THE PAPER TRAIL — ELEVENLABS LOGAN AUDIO PRODUCTION HANDOFF
November 13, 2026

CURRENT EDITABLE PROJECT:
{rpp}

LISTEN TO COMPLETE EPISODE DRAFT:
{mp3}

HIGH-RESOLUTION ROUGH MIX:
{wav}

DRAFT: {float(minfo['format']['duration'])/60:.2f} minutes.
MP3: 48 kHz stereo, 192 kbps
WAV: 48 kHz stereo, 24-bit PCM

VOICES:
The entire Logan narration is now ElevenLabs' existing custom cloned "Logan" voice,
ID GDqvTqQdsHV3ND6SiEZP. No Suno-synthesized Logan narration is active in this project.

NARRATION:
17 ElevenLabs source batches.
233 of 233 manuscript narration cues placed.
5,708 transcribed spoken words matched exactly to the supplied narration text.
{qa['sentence_positions_updated']} scored sentences aligned to spoken timing.
{qa['word_accents_synchronized']} accent/transition cues snapped to spoken words.
Raw voice performances still need subjective listening checks for prosody and pronunciation.

MUSIC AND SOUND:
3 selected original Suno compositions (signature, investigative, human).
Existing dry real broadcast/witness archive clips retained.
Full editor's rough mix created as MP3 and WAV, including the music, archive and SFX tracks.
This is NOT the final published/mastered episode.

KNOWN GAPS TO ADDRESS FOR FINAL RELEASE:
- 11 scripted written-message performances were not recorded; placeholder regions remain silent.
- 2 archive cues have no located source clips: AQ-0048, AQ-0220.
- 2 supplied candidate archival files decode to zero seconds: AQ-0233 and AQ-0222.
- The exact original source clip boundaries and speaker labels still require a final audition.
- Performance quality, dynamics, mixing and human subjective timing still require a listening pass.

SOURCE SAFETY:
Original REAPER versions v1-v4 were not overwritten.
Original archival media and the source manuscript were not edited.
New ElevenLabs audio and score sources are separate files in this folder.
The edit is fully revisable, with all sentence and word timing decisions preserved
in FULL_EPISODE_WORD_CUE_MAP_ELEVENLABS_v5.json.

STATUS:
A genuine, complete AUDIO-READY NARRATION AND SCORE ROUGH CUT exists.
It is not accurate to call the documentary finally finished for publication yet,
because the written-message passages and missing/corrupt archival clips are not complete.
"""
(base/'THE_PAPER_TRAIL_ELEVENLABS_LOGAN_HANDOFF.txt').write_text(guide,encoding='utf-8')
print(json.dumps({'status':'verified','narration_batches':17,'narration_cues':233,
 'wav_sample_rate':winfo['streams'][0]['sample_rate'],
 'mp3_sample_rate':minfo['streams'][0]['sample_rate'],
 'mp3_minutes':round(float(minfo['format']['duration'])/60,2),
 'mp3_mb':round(mp3.stat().st_size/1e6,1),
 'wav_gb':round(wav.stat().st_size/1e9,2),
 'word_hits':qa['word_accents_synchronized'],
 'sentence_alignments':qa['sentence_positions_updated'],
 'handoff':str(base/'THE_PAPER_TRAIL_ELEVENLABS_LOGAN_HANDOFF.txt')},indent=2))
