-- Independent word-scoring pilot. Starts in a new empty REAPER instance.
local self=debug.getinfo(1,'S').source:sub(2)
local dir=self:match('^(.*)[/\\]') or '.'
local data=dofile(dir..'\\prologue_score_pilot_data.lua')
local save_as=dir..'\\THE_PAPER_TRAIL_PROLOGUE_WORD_SCORE_PILOT.RPP'
if reaper.CountTracks(0)>0 then
  reaper.ShowMessageBox('Start with an empty REAPER project to protect existing work.','THE PAPER TRAIL',0)
  return
end

local tracks={
  archive={name='01 | AUTHENTIC ARCHIVE — DRY',color={194,128,84}},
  narration={name='02 | LOGAN NARRATION — SUNO WAV DOWNLOAD PENDING',color={75,146,212}},
  music={name='03 | PROVISIONAL WORD-SYNC MUSIC (ALT TEST)',color={128,116,175}},
  fx={name='04 | SOUND DESIGN — RESERVED',color={114,155,136}},
  notes={name='05 | DIRECTOR NOTES — MARKERS',color={143,142,138}}
}
local order={'archive','narration','music','fx','notes'}
reaper.PreventUIRefresh(1)
reaper.Undo_BeginBlock()
for i,k in ipairs(order) do
  reaper.InsertTrackAtIndex(i-1,true)
  local tr=reaper.GetTrack(0,i-1)
  tracks[k].tr=tr
  reaper.GetSetMediaTrackInfo_String(tr,'P_NAME',tracks[k].name,true)
  local c=tracks[k].color
  reaper.SetTrackColor(tr,reaper.ColorToNative(c[1],c[2],c[3]))
end
local load_ok,missing,guide=0,0,0
for _,x in ipairs(data.events) do
  local tr=tracks[x.track].tr
  local item=reaper.AddMediaItemToTrack(tr)
  reaper.SetMediaItemInfo_Value(item,'D_POSITION',x.pos)
  reaper.SetMediaItemInfo_Value(item,'D_LENGTH',x.dur)
  reaper.SetMediaItemInfo_Value(item,'D_FADEINLEN',x.fadein)
  reaper.SetMediaItemInfo_Value(item,'D_FADEOUTLEN',x.fadeout)
  reaper.SetMediaItemInfo_Value(item,'B_LOOPSRC',0)
  local take=reaper.AddTakeToMediaItem(item)
  reaper.GetSetMediaItemTakeInfo_String(take,'P_NAME',x.name,true)
  if x.path~='' then
    local src=reaper.PCM_Source_CreateFromFile(x.path)
    if src then
      reaper.SetMediaItemTake_Source(take,src)
      reaper.SetMediaItemTakeInfo_Value(take,'D_STARTOFFS',x.offset)
      reaper.SetMediaItemTakeInfo_Value(take,'D_VOL',x.volume)
      load_ok=load_ok+1
    else
      missing=missing+1
    end
  else
    guide=guide+1
  end
  reaper.GetSetMediaItemInfo_String(item,'P_NOTES',x.notes,true)
end
for _,m in ipairs(data.markers) do
  reaper.AddProjectMarker2(0,false,m.pos,0,m.name,-1,0)
end
reaper.AddProjectMarker2(0,true,0,237.899,'THE PAPER TRAIL / PROLOGUE WORD-SCORE PILOT',-1,0)
reaper.SetEditCurPos(0,false,false)
reaper.Undo_EndBlock('Build word-aligned prologue scoring pilot',-1)
reaper.TrackList_AdjustWindows(false)
reaper.UpdateArrange()
reaper.Main_SaveProjectEx(0,save_as,8)
reaper.PreventUIRefresh(-1)
local f=io.open(dir..'\\REAPER_PROLOGUE_WORD_SCORE_RESULT.txt','w')
if f then
  f:write('PROLOGUE WORD-SCORE PILOT\nProject: '..save_as..'\n')
  f:write('Audio sources loaded: '..load_ok..'\nMissing audio sources: '..missing..'\nEmpty narration guide items: '..guide..'\n')
  f:write('Word-level markers: '..#data.markers..'\n')
  f:write('Narration Suno files are generated but not yet downloaded; track 2 guides are EMPTY.\n')
  f:write('Music is a downloaded older Suno instrumental, NOT the new signature cue.\n')
  f:write('No source scripts and no prior RPP projects were overwritten.\n')
  f:close()
end
reaper.ShowConsoleMsg('Word-scoring pilot saved: '..save_as..' | '..load_ok..' linked audio items, '..guide..' narration guides.\n')
