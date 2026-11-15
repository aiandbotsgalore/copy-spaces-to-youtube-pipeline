from pathlib import Path
p=Path(__file__).resolve().parent/'cut_spoken_aq_labels_and_show_suno_v7.lua'
s=p.read_text(encoding='utf-8')
start=s.index("for ti=0,reaper.CountTracks(0)-1 do\n local tr=reaper.GetTrack(0,ti)\n local is_voice=tr==voice")
end=s.index("local marker_count=0",start)
new="""-- Snapshot stable media-item pointers AND original times before touching any.
-- REAPER reorders track items when their positions change; index-based in-place
-- iteration causes skipped and duplicate removals.
local itemrecords={}
for ti=0,reaper.CountTracks(0)-1 do
 local tr=reaper.GetTrack(0,ti)
 for i=0,reaper.CountTrackMediaItems(tr)-1 do
  local item=reaper.GetTrackMediaItem(tr,i)
  local pos=reaper.GetMediaItemInfo_Value(item,'D_POSITION')
  local duration=reaper.GetMediaItemInfo_Value(item,'D_LENGTH')
  itemrecords[#itemrecords+1]={tr=tr,item=item,pos=pos,fin=pos+duration}
 end
end
for _,rec in ipairs(itemrecords) do
 local item=rec.item
 local oldpos=rec.pos
 local ci=nil
 for j,c in ipairs(cuts) do
  if oldpos>=c.a-.0001 and oldpos<c.b-.0001 then ci=j;break end
 end
 if ci then
  local v=per_cut[ci]
  v.removed=v.removed+1
  if rec.tr==voice then v.voice=v.voice+1;voice_sections_removed=voice_sections_removed+1 end
  if rec.tr==investigations or rec.tr==human or rec.tr==motif then v.score=v.score+1 end
  reaper.DeleteTrackMediaItem(rec.tr,item)
  removed=removed+1
 else
  for _,c in ipairs(cuts) do
   if math.abs(rec.fin-c.a)<.00011 then
     reaper.SetMediaItemInfo_Value(item,'D_FADEOUTLEN',
       math.max(.035,reaper.GetMediaItemInfo_Value(item,'D_FADEOUTLEN')))
   end
   if math.abs(oldpos-c.b)<.00011 then
     reaper.SetMediaItemInfo_Value(item,'D_FADEINLEN',
       math.max(.035,reaper.GetMediaItemInfo_Value(item,'D_FADEINLEN')))
   end
  end
  local newpos=warp(oldpos)
  if math.abs(newpos-oldpos)>.00001 then shifted=shifted+1 end
  reaper.SetMediaItemInfo_Value(item,'D_POSITION',newpos)
 end
end
"""
s=s[:start]+new+s[end:]
p.write_text(s,encoding='utf-8')
print('REPLACED WITH STABLE POINTER SNAPSHOTS, ALL ORIGINAL TIMES PRESERVED',len(s))
