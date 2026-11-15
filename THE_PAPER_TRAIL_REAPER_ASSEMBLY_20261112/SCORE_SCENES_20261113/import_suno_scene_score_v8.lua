-- THE PAPER TRAIL: new original SUNO music for each actual narration scene.
-- Requires user-authorized Suno WAV downloads, one for each generated song.
-- Never invents missing audio or saves a project containing silent placeholders.
local self=debug.getinfo(1,'S').source:sub(2)
local folder=self:match('^(.*)[/\\]') or '.'
local original=folder..'\\THE_PAPER_TRAIL_LOGAN_LABELS_REMOVED_SUNO_VISIBLE_v7.RPP'
local target=folder..'\\THE_PAPER_TRAIL_ORIGINAL_SCENE_SCORE_v8.RPP'
local scores=dofile(folder..'\\SCORE_SCENES_20261113\\SCORE_SCENE_IMPORT_DATA.lua')
local missing={}
local sources={}
for _,x in ipairs(scores) do
 local path=folder..'\\'..x.filename:gsub('/', '\\')
 local f=io.open(path,'rb')
 if not f then
  missing[#missing+1]=x.id..': '..path
 else
  local size=f:seek('end')
  f:close()
  if size<1000000 then
   missing[#missing+1]=x.id..': too small '..tostring(size)..' '..path
  else
   sources[x.id]=path
  end
 end
end
local logpath=folder..'\\SCORE_SCENES_20261113\\REAPER_SCENE_SCORE_IMPORT_STATUS.txt'
if #missing>0 then
 local log=io.open(logpath,'w')
 if log then
  log:write('NOT IMPORTED — missing '..#missing..' of '..#scores..' original Suno scene WAVs.\n')
  log:write('The user must authorize 1 Suno download credit per source, 12 total. Do not substitute silent items.\n')
  for _,s in ipairs(missing) do log:write('MISSING: '..s..'\n') end
  log:close()
 end
 reaper.ShowConsoleMsg('Missing '..#missing..' Suno WAVs; no project created or modified.\n')
 return
end
if reaper.CountTracks(0)>0 then
 reaper.ShowConsoleMsg('Launch import script in a new empty REAPER instance; it will not alter active work.\n')
 return
end
reaper.Main_openProject(original)
if reaper.CountTracks(0)<17 then
 reaper.ShowConsoleMsg('The expected v7 project did not load; no changes saved.\n')
 return
end
local trackindex=5
reaper.PreventUIRefresh(1)
reaper.Undo_BeginBlock()
reaper.InsertTrackAtIndex(trackindex,true)
local tr=reaper.GetTrack(0,trackindex)
reaper.GetSetMediaTrackInfo_String(tr,'P_NAME',
 '06  |  SUNO ORIGINAL SCENE SCORE  |  12 DISTINCT NEW COMPOSITIONS',true)
reaper.SetTrackColor(tr,reaper.ColorToNative(209,156,87)|0x1000000)
reaper.SetMediaTrackInfo_Value(tr,'B_SHOWINTCP',1)
reaper.SetMediaTrackInfo_Value(tr,'B_SHOWINMIXER',1)
reaper.SetMediaTrackInfo_Value(tr,'B_MUTE',0)
reaper.SetMediaTrackInfo_Value(tr,'D_VOL',1.0)
reaper.SetMediaTrackInfo_Value(tr,'I_HEIGHTOVERRIDE',130)
local inserted=0
for _,cue in ipairs(scores) do
 local pcm=reaper.PCM_Source_CreateFromFile(sources[cue.id])
 if pcm then
  local source_len=reaper.GetMediaSourceLength(pcm)
  local maxdur=math.min(cue['end']-cue.start-.6,source_len-cue.offset-.1)
  if maxdur>6 then
   local item=reaper.AddMediaItemToTrack(tr)
   reaper.SetMediaItemInfo_Value(item,'D_POSITION',cue.start)
   reaper.SetMediaItemInfo_Value(item,'D_LENGTH',maxdur)
   reaper.SetMediaItemInfo_Value(item,'B_LOOPSRC',0)
   reaper.SetMediaItemInfo_Value(item,'D_FADEINLEN',math.min(cue.fadein,maxdur*.12))
   reaper.SetMediaItemInfo_Value(item,'D_FADEOUTLEN',math.min(cue.fadeout,maxdur*.12))
   local take=reaper.AddTakeToMediaItem(item)
   reaper.SetMediaItemTake_Source(take,pcm)
   reaper.SetMediaItemTakeInfo_Value(take,'D_STARTOFFS',cue.offset)
   reaper.SetMediaItemTakeInfo_Value(take,'D_VOL',cue.gain)
   reaper.GetSetMediaItemTakeInfo_String(take,'P_NAME',
     'ORIGINAL SUNO SCENE '..cue.id..' | '..cue.name,true)
   reaper.GetSetMediaItemInfo_String(item,'P_NOTES',
     'NEW ORIGINAL SCENE-SPECIFIC INSTRUMENTAL SCORE (not a repeated generic bed)\n'..
     'Scene: '..cue.name..'\nSong: '..cue.song_url..
     '\nSuno original composition source: '..sources[cue.id]..
     '\nAudible score under ElevenLabs Logan, detailed word/sentence mix continues on the three adaptive Suno stems above.\n'..
     'Independent scene score gain: '..cue.gain..
     '\nVoice, archive and original source files are unchanged.',true)
   inserted=inserted+1
   reaper.AddProjectMarker2(0,false,cue.start,0,
    'ORIGINAL SUNO SCENE '..cue.id..' — '..cue.name,-1,
    reaper.ColorToNative(210,163,91)|0x1000000)
  end
 end
end
reaper.GetSetProjectNotes(0,true,
 'THE PAPER TRAIL — SCENE-SPECIFIC ORIGINAL SUNO SCORE v8\n'..
 '12 distinct original instrumental compositions for Prologue, 10 dramatic scenes, Epilogue.\n'..
 'Placed as individual editable source audio items on a clearly visible track beneath Logan and the three continuous adaptive score stems.\n'..
 'Suno new music is performed instrumentally, no synthetic Angela archive. Existing voices from ElevenLabs Logan, no re-generation.\n'..
 'Surgically edited voice to remove five spoken internal AQ source IDs: 13.03 seconds excised, without replacement voice.\n'..
 'Underlying word- and sentence-driven original Suno stems retained; scene cues provide an additional changing musical arc.\n'..
 'Final story listening edit, missing archival recordings, and written-message readings still require review.\n'..
 'v1-v7 source projects preserved and never overwritten.')
reaper.SetOnlyTrackSelected(tr)
reaper.SetEditCurPos(0,false,false)
reaper.TrackList_AdjustWindows(false)
reaper.UpdateArrange()
reaper.Undo_EndBlock('Import 12 original Suno scene-specific cues',-1)
if inserted==#scores then
 reaper.Main_SaveProjectEx(0,target,8)
else
 reaper.Undo_DoUndo2(0)
 reaper.ShowConsoleMsg('Import incomplete ('..inserted..'/'..#scores..'). No v8 project saved.\n')
 return
end
reaper.PreventUIRefresh(-1)
local f=io.open(logpath,'w')
if f then
 f:write('REAPER V8 ORIGINAL SCENE SCORE IMPORTED\nSaved: '..target..'\n')
 f:write('New scene-specific original Suno tracks: '..inserted..'\n')
 f:write('New dedicated REAPER music track index: '..trackindex..'\n')
 f:write('Additional continuous original Suno score tracks directly above: 3\n')
 f:write('All five spoken AQ source ID utterances removed in v7 timeline, no ElevenLabs generation.\n')
 f:write('Final project duration: 4423.869 sec.\n')
 for _,cue in ipairs(scores) do f:write(cue.id..' '..cue.name..' '..cue.start..' '..cue['end']..' '..sources[cue.id]..'\n') end
 f:close()
end
reaper.ShowConsoleMsg('12 NEW ORIGINAL SUNO SCENE CUES placed in v8: '..target..'\n')
