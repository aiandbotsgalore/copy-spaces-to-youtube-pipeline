import subprocess,numpy as np,math,pathlib
root=pathlib.Path(__file__).resolve().parent
names=['SCORE_Unsent_Fourth_Note.wav','SCORE_Archive_Breathes.wav','SCORE_What_Trust_Cost.wav','ELEVENLABS_LOGAN_NARR_01.mp3']
for name in names:
 print('FILE',name)
 for off in [0,10,25,45,65,85]:
  cmd=['ffmpeg','-v','error','-ss',str(off),'-i',str(root/name),'-t','8','-ac','1','-ar','24000','-f','f32le','pipe:1']
  p=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  x=np.frombuffer(p.stdout,dtype='<f4')
  if len(x):
   rms=20*math.log10(max(1e-10,float(np.sqrt(np.mean(x*x,dtype=np.float64)))))
   peak=20*math.log10(max(1e-10,float(np.max(abs(x)))))
   print(off,'rms',round(rms,1),'peak',round(peak,1),'dBFS')
