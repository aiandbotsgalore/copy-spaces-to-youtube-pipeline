import pathlib,subprocess,numpy as np,math
root=pathlib.Path(__file__).resolve().parent
files=['THE_PAPER_TRAIL_ELEVENLABS_LOGAN_AUDIBLE_SUNO_SCORE_v6.mp3','THE_PAPER_TRAIL_SUNO_V6_LIMITED_TEST.mp3']
for fname in files:
 for begin,dur in [(10,45),(500,60),(2500,60)]:
  p=subprocess.run(['ffmpeg','-nostdin','-v','error','-ss',str(begin),'-i',str(root/fname),'-t',str(dur),'-ac','1','-ar','24000','-f','f32le','pipe:1'],capture_output=True)
  a=np.frombuffer(p.stdout,dtype='<f4')
  peak=20*math.log10(max(1e-8,float(np.max(abs(a)))))
  rms=20*math.log10(max(1e-8,float(np.sqrt(np.mean(a*a,dtype=np.float64)))))
  print(fname,begin,round(peak,2),round(rms,2))
