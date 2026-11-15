from pathlib import Path
p=Path(__file__).resolve().parent/'cut_spoken_aq_labels_and_show_suno_v7.lua'
s=p.read_text(encoding='utf-8')
a=s.index('local splits,removed,shifted,voice_sections_removed=0,0,0,0')
b=s.index('-- Update the narration item notes so the visible draft',a)
new=r"""local splits,removed,shifted,voice_sections_removed=0,0,0,0
local per_cut={}
local total_removed=0
for _,c in ipairs(cuts) do
 total_removed=total_removed+c.b-c.a
end
local function warp(t)
 local shift=0
 for _,c in ipairs(cuts) do
  if t>=c.b-.00001 then
   shift=shift+c.b-c.a
  elseif t>c.a+.00001 then
   return c.a-shift
  else
   break
  end
 end
 return t-shift
end
reaper.PreventUIRefresh(1)
reaper.Undo_BeginBlock()
-- Split at every ORIGINAL timeline boundary BEFORE moving any item.
-- This eliminates ripple feedback into later time coordinates.
local boundaries={}
for _,c in ipairs(cuts) do
 boundaries[#boundaries+1]=c.a
 boundaries[#boundaries+1]=c.b
 per_cut[#per_cut+1]={tag=c.tag,removed=0,voice=0,score=0,from=c.a,to=c.b}
end
table.sort(boundaries,function(x,y)return x>y end)
for _,p in ipairs(boundaries) do
 splits=splits+split_at(p)
end
for ti=0,reaper.CountTracks(0)-1 do
 local tr=reaper.GetTrack(0,ti)
 local is_voice=tr==voice
 local is_score=(tr==investigations or tr==human or tr==motif)
 for i=reaper.CountTrackMediaItems(tr)-1,0,-1 do
  local item=reaper.GetTrackMediaItem(tr,i)
  local oldpos=reaper.GetMediaItemInfo_Value(item,'D_POSITION')
  local ci=nil
  for j,c in ipairs(cuts) do
   if oldpos>=c.a-.0001 and oldpos<c.b-.0001 then ci=j;break end
  end
  if ci then
   local v=per_cut[ci]
   v.removed=v.removed+1
   if is_voice then v.voice=v.voice+1;voice_sections_removed=voice_sections_removed+1 end
   if is_score then v.score=v.score+1 end
   reaper.DeleteTrackMediaItem(tr,item)
   removed=removed+1
  else
   local oldend=oldpos+reaper.GetMediaItemInfo_Value(item,'D_LENGTH')
   for _,c in ipairs(cuts) do
    if math.abs(oldend-c.a)<.00011 then
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
end
local marker_count=0
local markers={}
local idx=0
while true do
 local valid,isrgn,pos,last,name,id,color=reaper.EnumProjectMarkers3(0,idx)
 if valid==0 then break end
 markers[#markers+1]={isrgn=isrgn,pos=pos,last=last,name=name,id=id,color=color}
 idx=idx+1
end
for _,m in ipairs(markers) do
 reaper.SetProjectMarker3(0,m.id,m.isrgn,warp(m.pos),m.isrgn and warp(m.last) or 0,m.name,m.color)
 marker_count=marker_count+1
end
-- Always log the cut counts to allow verification even if saving is withheld.
local cutlog=io.open(folder..'\\V7_PRE_SAVE_CUT_COUNTS.txt','w')
if cutlog then
 cutlog:write('Total source duration excised: '..total_removed..'\n')
 cutlog:write('Voice items cut '..voice_sections_removed..'\n')
 for _,x in ipairs(per_cut) do
  cutlog:write(x.tag..' voice '..x.voice..' music '..x.score..' total '..x.removed..'\n')
 end
 cutlog:close()
end
"""
s=s[:a]+new+s[b:]
p.write_text(s,encoding='utf-8')
print("REWROTE V7 WITH ONE-PASS COORDINATE REMAPPING",len(s))
