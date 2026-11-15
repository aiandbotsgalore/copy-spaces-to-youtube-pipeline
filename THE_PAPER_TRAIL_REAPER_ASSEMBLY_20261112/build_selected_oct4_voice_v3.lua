-- THE PAPER TRAIL: apply usable, selected October 4 voice takes with exact word-derived cue segmentation.
-- Input v2 remains untouched. v3 is the partial recorded-voice edit.
local src=debug.getinfo(1,'S').source:sub(2)
local folder=src:match('^(.*)[/\\]') or '.'
local original=folder..'\\THE_PAPER_TRAIL_FULL_SENTENCE_WORD_SCORE_v2.RPP'
local target=folder..'\\THE_PAPER_TRAIL_FULL_SCORE_WITH_SELECTED_OCT4_VOICE_v3.RPP'
if reaper.CountTracks(0)>0 then
 reaper.ShowMessageBox('Start in a new EMPTY REAPER instance; existing projects are preserved.','THE PAPER TRAIL',0)
 return
end
local data=dofile(folder..'\\SELECTED_OCT4_REAPER_V3_DATA.lua')
reaper.Main_openProject(original)
if reaper.CountTracks(0)<13 then
 reaper.ShowMessageBox('Could not load 13-track v2 score project. No changes made.','THE PAPER TRAIL',0)
 return
end
local a=data.adjustments
table.sort(a,function(x,y)return x.old_start<y.old_start end)
local function warp(t)
 local shift=0
 for _,x in ipairs(a) do
  if t<x.old_start then break end
  if t<x.old_end then
   return t+shift+(t-x.old_start)*(x.new_dur/x.old_dur-1)
  end
  shift=shift+(x.new_dur-x.old_dur)
 end
 return t+shift
end
-- Lookup word-sync real positions for those hits whose source speech was generated and checked.
local hits={}
for _,x in ipairs(data.aligned_word_hits) do
 local k=tostring(math.floor(x.pos*1000+.5))..'|'..x.name
 hits[k]=x.time_final
end
reaper.PreventUIRefresh(1)
reaper.Undo_BeginBlock()
local moved=0;local snapped=0
for ti=0,reaper.CountTracks(0)-1 do
 local track=reaper.GetTrack(0,ti)
 for i=0,reaper.CountTrackMediaItems(track)-1 do
  local item=reaper.GetTrackMediaItem(track,i)
  local p=reaper.GetMediaItemInfo_Value(item,'D_POSITION')
  local len=reaper.GetMediaItemInfo_Value(item,'D_LENGTH')
  local newp=warp(p)
  local newlen=math.max(.065,warp(p+len)-warp(p))
  local take=reaper.GetActiveTake(item)
  if take then
   local _,nm=reaper.GetSetMediaItemTakeInfo_String(take,'P_NAME','',false)
   local k=tostring(math.floor(p*1000+.5))..'|'..nm
   if hits[k] then
    newp=hits[k]
    newlen=len
    snapped=snapped+1
   end
  end
  reaper.SetMediaItemInfo_Value(item,'D_POSITION',newp)
  reaper.SetMediaItemInfo_Value(item,'D_LENGTH',newlen)
  moved=moved+1
 end
end
-- Move existing act/scene regions and keyword markers into the revised dialogue timeline.
local existing={}
local idx=0
while true do
 local found,isrgn,pos,rgnend,name,number,color=reaper.EnumProjectMarkers3(0,idx)
 if found==0 then break end
 existing[#existing+1]={isrgn=isrgn,pos=pos,last=rgnend,name=name,id=number,color=color}
 idx=idx+1
end
for _,x in ipairs(existing) do
 reaper.SetProjectMarker3(0,x.id,x.isrgn,warp(x.pos),x.isrgn and warp(x.last) or 0,x.name,x.color)
end
-- Insert newly selected spoken narration, without overwriting empty guide text or original archive.
reaper.InsertTrackAtIndex(1,true)
local voice=reaper.GetTrack(0,1)
reaper.GetSetMediaTrackInfo_String(voice,'P_NAME','02  LOGAN | CORRECT OCT 4 VOICE (85 SOURCE-ALIGNED CUES)',true)
local col=reaper.ColorToNative(80,173,189) | 0x1000000
reaper.SetTrackColor(voice,col)
local loaded=0;local missing={}
local lastjob=nil
for _,x in ipairs(a) do
 local src=reaper.PCM_Source_CreateFromFile(x.path)
 if not src then
  missing[#missing+1]=x.path
 else
  local item=reaper.AddMediaItemToTrack(voice)
  local p=warp(x.old_start)
  reaper.SetMediaItemInfo_Value(item,'D_POSITION',p)
  reaper.SetMediaItemInfo_Value(item,'D_LENGTH',x.new_dur)
  reaper.SetMediaItemInfo_Value(item,'B_LOOPSRC',0)
  reaper.SetMediaItemInfo_Value(item,'D_FADEINLEN',.015)
  reaper.SetMediaItemInfo_Value(item,'D_FADEOUTLEN',.060)
  reaper.SetMediaItemInfo_Value(item,'I_CUSTOMCOLOR',col)
  local take=reaper.AddTakeToMediaItem(item)
  reaper.SetMediaItemTake_Source(take,src)
  reaper.SetMediaItemTakeInfo_Value(take,'D_STARTOFFS',x.source_offs)
  reaper.SetMediaItemTakeInfo_Value(take,'D_VOL',.86)
  reaper.GetSetMediaItemTakeInfo_String(take,'P_NAME',
    'LOGAN OCT 4 | '..x.name:sub(1,80),true)
  reaper.GetSetMediaItemInfo_String(item,'P_NOTES',
    'Real Suno generated vocal with user-owned My Podcast Voice - Oct 4.\n'..
    'Script cue '..x.cue_index..':\n'..x.text..
    '\nSuno ID: '..x.source_id..
    '\nSource offset: '..x.source_offs..
    '\nTiming adjusted using the Suno word-alignment. Human final audition still required.',true)
  loaded=loaded+1
  if x.source_id~=lastjob then
   reaper.AddProjectMarker2(0,false,p,0,'RECORDED OCT4 TAKE | '..x.source_id:sub(1,8),-1,col)
   lastjob=x.source_id
  end
 end
end
local oldnotes=''
local _,old=reaper.GetSetProjectNotes(0,false,'')
if old then oldnotes=old end
reaper.GetSetProjectNotes(0,true,oldnotes..
 '\n\nV3 NARRATION UPDATE:\n'..
 'Selected correct October 4 Suno voice, six editor-reviewed clips divided into '..loaded..' speaking segments.\n'..
 'Each clip is timed from the supplied-script Suno word alignment, not an independent exact-ASR audit.\n'..
 'Music, archive and act boundaries warped to follow recorded narrator timing where present.\n'..
 'Only '..loaded..'/233 narration cues have real recorded audio. The remainder are empty guides and not finished.\n'..
 'Writing read-through and two missing archival clips remain. Do not treat the episode as complete.')
reaper.SetEditCurPos(0,false,false)
reaper.TrackList_AdjustWindows(false)
reaper.UpdateArrange()
reaper.Undo_EndBlock('Spoken voice and exact word timing from October 4 Suno selections',-1)
reaper.Main_SaveProjectEx(0,target,8)
reaper.PreventUIRefresh(-1)
local f=io.open(folder..'\\REAPER_SELECTED_OCT4_VOICE_V3_RESULT.txt','w')
if f then
 f:write('REAPER V3 — SELECTED LOGAN CUSTOM VOICE (Oct 4)\n')
 f:write('Saved: '..target..'\n')
 f:write('Selected narrator WAV/MP3 media segments loaded: '..loaded..' of 85\n')
 f:write('Original project items retimed: '..moved..'\n')
 f:write('Exact word cue hits snapped: '..snapped..'\n')
 f:write('Act/scene markers migrated: '..#existing..'\n')
 f:write('Missing voice files: '..#missing..'\n')
 f:write('Narration unrecorded: '..(233-loaded)..' segments\n')
 f:write('Final projected duration: '..data.project_end..' seconds\n')
 f:write('Music timing remains editorially provisional where narration is absent.\n')
 for _,x in ipairs(missing) do f:write('MISSING '..x..'\n') end
 f:close()
end
reaper.ShowConsoleMsg('REAPER V3 saved: '..target..'\nLoaded '..loaded..' actual narrator items; '..snapped..' word accents precisely synced.\n')
