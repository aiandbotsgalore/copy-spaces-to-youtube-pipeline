import json,pathlib,re,csv
p=pathlib.Path(__file__).resolve().parent
for i in range(1,18):
 x=json.loads((p/f"NARR_JOB_{i:02}.json").read_text(encoding="utf-8"))
 for s in x["segments"]:
  if s["cue_index"] in (53,54):
   print("MATCH",x["job_id"],"seg",s,"scriptchars",len(x['script']))
d=json.loads((p/'ELEVENLABS_V5_ALIGNMENT_QA.json').read_text(encoding="utf-8"))
print("REPORT KEYS",d.keys())
m=json.loads((p/'FULL_EPISODE_WORD_CUE_MAP_ELEVENLABS_v5.json').read_text(encoding="utf-8"))
for w in m['word_cues']:
 if w['cue_index'] in (53,54) and (re.search(r'AQ|0011|0195|0206|0209|0056',w['word'],re.I)):print("BAD WORD DATA",w)
