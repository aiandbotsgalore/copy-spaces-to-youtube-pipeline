from pathlib import Path
p=Path(__file__).resolve().parent/'cut_spoken_aq_labels_and_show_suno_v7.lua'
s=p.read_text(encoding='utf-8')
anchor="for ti=0,reaper.CountTracks(0)-1 do\n local tr=reaper.GetTrack(0,ti)\n local is_voice=tr==voice"
if anchor not in s:raise RuntimeError('anchor missing')
insertion="""local diag=io.open(folder..'\\\\V7_AFTER_SPLITS_SOURCE_POSITIONS.tsv','w')
if diag then
 diag:write('ROLE\\\\tP\\\\tEND\\\\tOFF\\\\n')
 for _,spec in ipairs({{voice,'VOICE'},{investigations,'INVESTIGATION'},{human,'HUMAN'},{motif,'MOTIF'}}) do
  for ix=0,reaper.CountTrackMediaItems(spec[1])-1 do
   local it=reaper.GetTrackMediaItem(spec[1],ix)
   local p=reaper.GetMediaItemInfo_Value(it,'D_POSITION')
   local fin=p+reaper.GetMediaItemInfo_Value(it,'D_LENGTH')
   if p<575 and fin>518 then
    local tk=reaper.GetActiveTake(it)
    local off=tk and reaper.GetMediaItemTakeInfo_Value(tk,'D_STARTOFFS') or 0
    diag:write(spec[2]..'\\\\t'..p..'\\\\t'..fin..'\\\\t'..off..'\\\\n')
   end
  end
 end
 diag:close()
end
"""
s=s.replace(anchor,insertion+anchor,1)
p.write_text(s,encoding='utf-8')
print('INSERTED POST SPLIT PROBE')
