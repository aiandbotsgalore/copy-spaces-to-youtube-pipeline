-- Integrate the six additional Prologue paragraphs with the correct Oct 4 narrator voice.
-- Opens v3 and saves v4. Prologue now has a performed draft for all 22 narrator cues.
local script=debug.getinfo(1,'S').source:sub(2)
local folder=script:match('^(.*)[/\\]') or '.'
local original=folder..'\\THE_PAPER_TRAIL_FULL_SCORE_WITH_SELECTED_OCT4_VOICE_v3.RPP'
local target=folder..'\\THE_PAPER_TRAIL_PROLOGUE_COMPLETE_DRAFT_v4.RPP'
if reaper.CountTracks(0)>0 then
 reaper.ShowMessageBox('Launch this script from a new empty REAPER instance.','THE PAPER TRAIL',0)
 return
end
local data=dofile(folder..'\\PROLOGUE_RETIME_V4_DATA.lua')
reaper.Main_openProject(original)
if reaper.CountTracks(0)<14 then
 reaper.ShowMessageBox('Could not load v3 scoring project.','THE PAPER TRAIL',0)
 return
end
local a=data.adjustments
table.sort(a,function(x,y)return x.old_start<y.old_start end)
local function warp(t)
 local shift=0
 for _,x in ipairs(a) do
  if t<x.old_start then break end
  if t<x.old_end then return t+shift+(t-x.old_start)*(x.new_dur/x.old_dur-1) end
  shift=shift+x.new_dur-x.old_dur
 end
 return t+shift
end
reaper.PreventUIRefresh(1)
reaper.Undo_BeginBlock()
local moved=0
for ti=0,reaper.CountTracks(0)-1 do
 local tr=reaper.GetTrack(0,ti)
 for i=0,reaper.CountTrackMediaItems(tr)-1 do
  local item=reaper.GetTrackMediaItem(tr,i)
  local p=reaper.GetMediaItemInfo_Value(item,'D_POSITION')
  local len=reaper.GetMediaItemInfo_Value(item,'D_LENGTH')
  reaper.SetMediaItemInfo_Value(item,'D_POSITION',warp(p))
  reaper.SetMediaItemInfo_Value(item,'D_LENGTH',math.max(.065,warp(p+len)-warp(p)))
  moved=moved+1
 end
end
local markers={}
local index=0
while true do
 local ok,isrgn,p,last,name,id,color=reaper.EnumProjectMarkers3(0,index)
 if ok==0 then break end
 markers[#markers+1]={isrgn=isrgn,p=p,last=last,name=name,id=id,color=color}
 index=index+1
end
for _,x in ipairs(markers) do
 reaper.SetProjectMarker3(0,x.id,x.isrgn,warp(x.p),x.isrgn and warp(x.last) or 0,x.name,x.color)
end
local voice=reaper.GetTrack(0,1)
reaper.GetSetMediaTrackInfo_String(voice,'P_NAME',
 '02  LOGAN | CORRECT OCT 4 VOICE (91 CUES; COMPLETE PROLOGUE DRAFT)',true)
local added,missing=0,0
for _,x in ipairs(a) do
 local source=reaper.PCM_Source_CreateFromFile(x.path)
 if not source then missing=missing+1
 else
  local item=reaper.AddMediaItemToTrack(voice)
  reaper.SetMediaItemInfo_Value(item,'D_POSITION',warp(x.old_start))
  reaper.SetMediaItemInfo_Value(item,'D_LENGTH',x.new_dur)
  reaper.SetMediaItemInfo_Value(item,'D_FADEINLEN',.014)
  reaper.SetMediaItemInfo_Value(item,'D_FADEOUTLEN',.055)
  reaper.SetMediaItemInfo_Value(item,'B_LOOPSRC',0)
  local take=reaper.AddTakeToMediaItem(item)
  reaper.SetMediaItemTake_Source(take,source)
  reaper.SetMediaItemTakeInfo_Value(take,'D_STARTOFFS',x.offset_s)
  reaper.SetMediaItemTakeInfo_Value(take,'D_VOL',.86)
  reaper.GetSetMediaItemTakeInfo_String(take,'P_NAME',
    'LOGAN Oct4 | PROLOGUE CUE '..x.cue_index..' | '..x.text:sub(1,65),true)
  reaper.GetSetMediaItemInfo_String(item,'P_NOTES',
    'Performed, using user-selected My Podcast Voice - Oct 4.\n'..
    'Script cue:\n'..x.text..
    '\nOriginal source: '..x.source_id..
    '\nEditorial status: DRAFT. Repeated words and phrasing require final human listening correction.\n',true)
  added=added+1
 end
end
reaper.AddProjectMarker2(0,false,data.prologue_end_s,0,'PROLOGUE END — LISTENABLE DRAFT / Act I begins',-1,reaper.ColorToNative(150,195,142)|0x1000000)
reaper.SetEditCurPos(0,false,false)
reaper.TrackList_AdjustWindows(false)
reaper.UpdateArrange()
reaper.Undo_EndBlock('Complete Prologue performed draft, exact voice timing',-1)
reaper.Main_SaveProjectEx(0,target,8)
reaper.PreventUIRefresh(-1)
local f=io.open(folder..'\\REAPER_PROLOGUE_COMPLETE_V4_RESULT.txt','w')
if f then
 f:write('PROLOGUE FULL AUDIO DRAFT V4\n')
 f:write('Saved: '..target..'\n')
 f:write('Additional narrator passages loaded: '..added..'\n')
 f:write('Additional voice media missing: '..missing..'\n')
 f:write('Total Oct 4 voice narration passages: '..data.total_oct4_voice_cues..'/233\n')
 f:write('Prologue last timestamp: '..data.prologue_end_s..' seconds\n')
 f:write('Episode estimated duration: '..data.episode_end_s..' seconds\n')
 f:write('Existing audio/music/score items retimed: '..moved..'\n')
 f:write('Existing markers migrated: '..#markers..'\n')
 f:write('This is a listenable DRAFT, not final publication mix; final lines may contain repetitions or voice artifacts.\n')
 f:close()
end
reaper.ShowConsoleMsg('PROLOGUE DRAFT v4: '..target..' | '..added..' extra passages.\n')
