from pathlib import Path
base=Path(__file__).resolve().parent
p=base/'cut_spoken_aq_labels_and_show_suno_v7.lua'
s=p.read_text(encoding='utf-8')
s=s.replace('-- Process from the end of the timeline backwards, keeping each original source timestamp valid.','-- Process from earliest to latest, translating every later edit by the time already cut.')
before="for ci=#cuts,1,-1 do\n local x=cuts[ci]"
after="for ci=1,#cuts do\n local x={a=cuts[ci].a-total_removed,b=cuts[ci].b-total_removed,tag=cuts[ci].tag}"
if before not in s:raise RuntimeError('Loop not found')
s=s.replace(before,after)
p.write_text(s,encoding='utf-8')
print('CORRECTED V7 CHRONOLOGICAL CUT ALGORITHM')
