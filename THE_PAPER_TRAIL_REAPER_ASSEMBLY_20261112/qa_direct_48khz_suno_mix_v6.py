import pathlib,subprocess,numpy as np,math
root=pathlib.Path(__file__).resolve().parent
p=root/'THE_PAPER_TRAIL_SUNO_SCORE_V6_QA_FINAL_TEMP.mp3'
for off in [10,500,2500,4100]:
 r=subprocess.run(['ffmpeg','-nostdin','-v','error','-ss',str(off),'-i',str(p),'-t','45',
   '-ac','2','-ar','48000','-f','f32le','pipe:1'],capture_output=True)
 x=np.frombuffer(r.stdout,dtype='<f4')
 print(off,'PEAK',round(20*math.log10(max(1e-8,float(np.max(abs(x))))),3),
 'RMS',round(20*math.log10(max(1e-8,float(np.sqrt(np.mean(x*x,dtype=np.float64))))),3))
