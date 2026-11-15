import json,pathlib,re
root=pathlib.Path(__file__).resolve().parent
w=json.loads((root/'ELEVENLABS_NARR_03_WORDS.json').read_text(encoding='utf-8'))
print('TYPE',type(w),'KEYS',list(w))
a=w['words']
for i,v in enumerate(a):
 if re.search('AQ|0011|0195|0206|0209|0056',v['text'],re.I) or (v['start']>7 and v['start']<50 and re.search('zero|one|two|five|six|nine|oh|cue|eight|dash|hyphen',v['text'],re.I)):
  print('W',i,v,'NEIGHBOR',''.join(x['text'] for x in a[max(0,i-8):min(len(a),i+9)]))
print('ALL FIRST 55 SEC:')
for i,v in enumerate(a):
 if v['start']>55:break
 print(i,round(v['start'],2),round(v['end'],2),repr(v['text']))
