-- THE PAPER TRAIL V7: no voice generation. Remove all FIVE spoken AQ references in FOUR
-- source-aligned intervals.  Also bring the THREE ACTUAL SUNO MUSIC TRACKS directly underneath
-- ElevenLabs Logan narration in the track panel.
local self=debug.getinfo(1,'S').source:sub(2)
local folder=self:match('^(.*)[/\\]') or '.'
local original=folder..'\\THE_PAPER_TRAIL_ELEVENLABS_LOGAN_AUDIBLE_SUNO_SCORE_v6.RPP'
local output=folder..'\\THE_PAPER_TRAIL_LOGAN_LABELS_REMOVED_SUNO_VISIBLE_v7.RPP'
if reaper.CountTracks(0)>0 then
 reaper.ShowMessageBox('Launch this script in a new empty REAPER instance. Earlier work is preserved.','THE PAPER TRAIL',0)
 return
end
reaper.Main_openProject(original)
if reaper.CountTracks(0)<17 then
 reaper.ShowMessageBox('Unable to load the correct 17-track v6 project. No edits made.','THE PAPER TRAIL',0)
 return
end
local cuts={
 {a=531.784,b=534.219,tag='AQ-0011'},
 {a=545.804,b=548.564,tag='AQ-0195'},
 {a=555.373,b=560.273,tag='AQ-0206 / AQ-0209'},
 {a=565.213,b=568.148,tag='AQ-0056'}
}
local corr53="In other recordings, Angela described further experiences that I cannot independently verify. She claimed she had been illegally adopted into a CIA mind-control program, tortured as a child at Wright-Patterson Air Force Base, and that she had personally helped law enforcement track down a kidnapped thirteen-year-old girl in New York using only a first name and an Xbox account."
local corr54="Later on, some of her former friends would allege on the record that she fabricated key parts of her personal history. Angela insisted every word was real and dared critics to prove her wrong."
local function find_track(phrase)
 for ti=0,reaper.CountTracks(0)-1 do
  local tr=reaper.GetTrack(0,ti)
  local _,name=reaper.GetSetMediaTrackInfo_String(tr,'P_NAME','',false)
  if name:find(phrase,1,true) then return tr end
 end
 return nil
end
local voice=find_track('ELEVENLABS CLONE')
local investigations=find_track('SUNO SCORE  |  INVESTIGATION')
local human=find_track('SUNO SCORE  |  TRUST')
local motif=find_track('SUNO SCORE  |  SIGNATURE WORD')
if not voice or not investigations or not human or not motif then
 reaper.ShowMessageBox('One or more voice/Suno tracks were not found in v6. No edits made.','THE PAPER TRAIL',0)
 return
end
local function split_at(t)
 local result=0
 for ti=0,reaper.CountTracks(0)-1 do
  local tr=reaper.GetTrack(0,ti)
  for i=reaper.CountTrackMediaItems(tr)-1,0,-1 do
   local item=reaper.GetTrackMediaItem(tr,i)
   local p=reaper.GetMediaItemInfo_Value(item,'D_POSITION')
   local d=reaper.GetMediaItemInfo_Value(item,'D_LENGTH')
   if p<t-.0001 and p+d>t+.0001 then
    if reaper.SplitMediaItem(item,t) then result=result+1 end
   end
  end
 end
 return result
end
local function shift_markers(a,b,dt)
 local markers={}
 local idx=0
 while true do
  local valid,isrgn,pos,last,name,id,color=reaper.EnumProjectMarkers3(0,idx)
  if valid==0 then break end
  markers[#markers+1]={isrgn=isrgn,pos=pos,last=last,name=name,id=id,color=color}
  idx=idx+1
 end
 local function warp(t)
  if t>=b then return t-dt end
  if t>a then return a end
  return t
 end
 for _,m in ipairs(markers) do
  reaper.SetProjectMarker3(0,m.id,m.isrgn,warp(m.pos),m.isrgn and warp(m.last) or 0,m.name,m.color)
 end
 return #markers
end
local splits,removed,shifted,voice_sections_removed=0,0,0,0
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
reaper.Main_OnCommand(40309,0) -- set ripple editing OFF for deterministic surgery
local rippleOffState=reaper.GetToggleCommandState(40309)
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
local diag=io.open(folder..'\\V7_AFTER_SPLITS_SOURCE_POSITIONS.tsv','w')
if diag then
 diag:write('ROLE\\tP\\tEND\\tOFF\\n')
 for _,spec in ipairs({{voice,'VOICE'},{investigations,'INVESTIGATION'},{human,'HUMAN'},{motif,'MOTIF'}}) do
  for ix=0,reaper.CountTrackMediaItems(spec[1])-1 do
   local it=reaper.GetTrackMediaItem(spec[1],ix)
   local p=reaper.GetMediaItemInfo_Value(it,'D_POSITION')
   local fin=p+reaper.GetMediaItemInfo_Value(it,'D_LENGTH')
   if p<575 and fin>518 then
    local tk=reaper.GetActiveTake(it)
    local off=tk and reaper.GetMediaItemTakeInfo_Value(tk,'D_STARTOFFS') or 0
    diag:write(spec[2]..'\\t'..p..'\\t'..fin..'\\t'..off..'\\n')
   end
  end
 end
 diag:close()
end
-- Snapshot stable media-item pointers AND original times before touching any.
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
 cutlog:write('Ripple off toggle state: '..rippleOffState..'\n')
 cutlog:write('Total source duration excised: '..total_removed..'\n')
 cutlog:write('Voice items cut '..voice_sections_removed..'\n')
 for _,x in ipairs(per_cut) do
  cutlog:write(x.tag..' voice '..x.voice..' music '..x.score..' total '..x.removed..'\n')
 end
 cutlog:close()
end
-- Update the narration item notes so the visible draft does not retain read-aloud labels.
for ti=0,reaper.CountTracks(0)-1 do
 local tr=reaper.GetTrack(0,ti)
 for j=0,reaper.CountTrackMediaItems(tr)-1 do
  local item=reaper.GetTrackMediaItem(tr,j)
  local tk=reaper.GetActiveTake(item)
  if tk then
   local _,nm=reaper.GetSetMediaItemTakeInfo_String(tk,'P_NAME','',false)
   local n=tonumber(nm:match('LOGAN ELEVENLABS | CUE (%d+) |'))
   if n==53 or n==54 then
    reaper.GetSetMediaItemInfo_String(item,'P_NOTES',
      'CLEANED SPOKEN PERFORMANCE: internal audio source ID was surgically removed with a native REAPER split.\n'..
      'Actual spoken narration (without metadata):\n'..(n==53 and corr53 or corr54)..
      '\nSource ElevenLabs recording otherwise unchanged. No new speech was generated.',true)
   end
  end
 end
end
-- Move the new unmuted SUNO tracks directly below the narrator so they are immediately visible.
local ordered={
 {tr=investigations,name='03  |  SUNO INSTRUMENTAL SCORE  |  INVESTIGATION [AUDIBLE]',color={66,158,195}},
 {tr=human,name='04  |  SUNO INSTRUMENTAL SCORE  |  TRUST / SAV [AUDIBLE]',color={202,140,157}},
 {tr=motif,name='05  |  SUNO INSTRUMENTAL SCORE  |  SIGNATURE MOTIF [AUDIBLE]',color={181,159,84}}
}
for i,s in ipairs(ordered) do
 reaper.SetOnlyTrackSelected(s.tr)
 reaper.ReorderSelectedTracks(i+1,0)
 reaper.GetSetMediaTrackInfo_String(s.tr,'P_NAME',s.name,true)
 reaper.SetTrackColor(s.tr,reaper.ColorToNative(s.color[1],s.color[2],s.color[3])|0x1000000)
 reaper.SetMediaTrackInfo_Value(s.tr,'B_MUTE',0)
 reaper.SetMediaTrackInfo_Value(s.tr,'B_SHOWINTCP',1)
 reaper.SetMediaTrackInfo_Value(s.tr,'B_SHOWINMIXER',1)
 reaper.SetMediaTrackInfo_Value(s.tr,'I_HEIGHTOVERRIDE',120)
end
reaper.SetOnlyTrackSelected(voice)
reaper.GetSetMediaTrackInfo_String(voice,'P_NAME','02  |  ELEVENLABS LOGAN  |  NARRATION (NO SPOKEN AQ LABELS)',true)
-- Hide redundant older score fragments and empty narration guides without deleting any sources.
for ti=0,reaper.CountTracks(0)-1 do
 local tr=reaper.GetTrack(0,ti)
 local _,nm=reaper.GetSetMediaTrackInfo_String(tr,'P_NAME','',false)
 if nm:find('MUTED SUPERSEDED',1,true) or nm:find('ORIGINAL NARRATION TEXT GUIDE',1,true) then
   reaper.SetMediaTrackInfo_Value(tr,'B_SHOWINTCP',0)
   reaper.SetMediaTrackInfo_Value(tr,'B_SHOWINMIXER',0)
 end
end
-- Verify all four labels actually removed from narrator source item playback.
if voice_sections_removed~=4 then
 -- Save an investigation log to explain failure; do not overwrite original or silently claim success.
 reaper.Undo_EndBlock('REVIEW: unexpected narrator cut count',-1)
 reaper.PreventUIRefresh(-1)
 reaper.ShowMessageBox('Unexpected number of cut voice items: '..voice_sections_removed..' (expected 4). Not saving.','THE PAPER TRAIL',0)
 return
end
reaper.SetEditCurPos(0,false,false)
reaper.TrackList_AdjustWindows(false)
reaper.UpdateArrange()
reaper.Undo_EndBlock('Surgically delete 5 spoken AQ metadata labels and expose actual SUNO score',-1)
reaper.Main_SaveProjectEx(0,output,8)
reaper.PreventUIRefresh(-1)
local log=io.open(folder..'\\REAPER_CLEAN_LABELS_AND_VISIBLE_SUNO_v7_RESULT.txt','w')
if log then
 log:write('FINAL: '..output..'\n')
 log:write('Four voice regions cut; five spoken AQ labels excised. NO voice generation.\n')
 log:write('Total removed timeline duration: '..total_removed..' sec.\n')
 log:write('Tracks: three original SUNO SCORE stems moved directly beneath ElevenLabs Logan.\n')
 log:write('Native item splits: '..splits..' | Removed items '..removed..' | shifted '..shifted..'\n')
 log:write('Full retained project length approx '..(4436.899-total_removed)..' sec\n')
 for _,x in ipairs(per_cut) do
  log:write(x.tag..' | Voice '..x.voice..' | Total '..x.removed..' | SUNO score '..x.score..'\n')
 end
 log:write('Original v6 unmodified. Existing ElevenLabs source MP3 unmodified.\n')
 log:close()
end
reaper.ShowConsoleMsg('V7 CLEAN LABELS + SUNO SCORE VISIBLE: '..output..'\nDeleted '..voice_sections_removed..' voice label sections. Music tracks moved to TOP.\n')
