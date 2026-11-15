-- THE PAPER TRAIL — ONE CANONICAL EDITABLE REAPER PROJECT
-- Import twelve VERIFIED USER-LOCAL Suno songs IN PLACE into the current open v7 project.
-- Never open/create a competing project; maintain a private backup before the change.
-- No ElevenLabs or Suno generation/download requests. No historical archive recreation.
local script=debug.getinfo(1,'S').source:sub(2)
local folder=script:match('^(.*)[/\\]') or '.'
local expected=folder..'\\THE_PAPER_TRAIL_LOGAN_LABELS_REMOVED_SUNO_VISIBLE_v7.RPP'
local data=folder..'\\SCORE_SCENES_20261113\\SCORE_SCENE_IMPORT_DATA.lua'
local backup=folder..'\\SCORE_SCENES_20261113\\ProductionBackup\\THE_PAPER_TRAIL_Before_12_Original_Suno_Scenes_20261113.RPP'
local logfile=folder..'\\SCORE_SCENES_20261113\\SCENE_IMPORT_INPLACE_RESULT.txt'
local function log(message)
 local f=io.open(logfile,'w')
 if f then f:write(message);f:close() end
 reaper.ShowConsoleMsg(message..'\n')
end
local _,current=reaper.EnumProjects(-1,'')
local function normalized(path)
 return tostring(path or ''):lower():gsub('/','\\')
end
if normalized(current)~=normalized(expected) then
 log('ABORT: wrong REAPER project is open.\nExpected: '..expected..'\nActual: '..tostring(current)..'\nNo project modified.')
 return
end
if reaper.CountTracks(0)<17 then
 log('ABORT: current project has fewer than 17 tracks. No modification.')
 return
end
local scores=dofile(data)
if #scores~=12 then
 log('ABORT: scene score manifest expected 12 tracks, found '..#scores)
 return
end
for i=0,reaper.CountTracks(0)-1 do
 local tr=reaper.GetTrack(0,i)
 local _,name=reaper.GetSetMediaTrackInfo_String(tr,'P_NAME','',false)
 if name:find('SUNO ORIGINAL SCENE SCORE',1,true) then
  log('ALREADY IMPORTED: found '..name..'. No duplicate scene score track added.')
  return
 end
end
local sources={}
local missing={}
local preflight={}
for _,cue in ipairs(scores) do
 local path=folder..'\\'..cue.filename:gsub('/','\\')
 local pcm=reaper.PCM_Source_CreateFromFile(path)
 if not pcm then
  missing[#missing+1]=cue.id..' : '..path
 else
  local duration=reaper.GetMediaSourceLength(pcm)
  local clip=math.min(cue['end']-cue.start-.6,duration-cue.offset-.10)
  if clip<6 then
   missing[#missing+1]=cue.id..' : source duration too short (can play '..clip..' seconds) '..path
  else
   sources[cue.id]={source=pcm,path=path,duration=duration,clip=clip}
   preflight[#preflight+1]=cue.id..' : '..path..' ('..duration..' seconds)'
  end
 end
end
if #missing>0 then
 log('ABORT: '..#missing..' of 12 local original Suno files failed media preflight.\n'..table.concat(missing,'\n')..'\nNo project modified.')
 return
end
if (reaper.GetPlayState() & 4)~=0 then
 log('ABORT: REAPER is recording. I will not edit during recording. No changes made.')
 return
end
-- First SAVE CURRENT UNSAVED USER WORK into the very same project; then create 1 recovery backup.
reaper.Main_SaveProject(0,false)
local sourceFile=io.open(expected,'rb')
if not sourceFile then
 log('ABORT: unable to read saved working project for backup. No score track inserted.')
 return
end
local backupFile=io.open(backup,'rb')
if backupFile then
 backupFile:close()
 sourceFile:close()
 log('ABORT: pre-import backup already exists; refusing to overwrite it. No score track inserted.')
 return
end
backupFile=io.open(backup,'wb')
if not backupFile then
 sourceFile:close()
 log('ABORT: could not create recovery backup. No score track inserted.')
 return
end
local totalCopied=0
while true do
 local buf=sourceFile:read(65536)
 if not buf then break end
 backupFile:write(buf)
 totalCopied=totalCopied+#buf
end
sourceFile:close()
backupFile:close()
if totalCopied<100000 then
 log('ABORT: recovery backup unexpectedly small ('..totalCopied..' bytes). No edit made.')
 return
end
-- Preserve current user's playback cursor and selection. Add just one real, visible audio track.
local oldCursor=reaper.GetCursorPosition()
local index=5
reaper.PreventUIRefresh(1)
reaper.Undo_BeginBlock()
reaper.InsertTrackAtIndex(index,true)
local tr=reaper.GetTrack(0,index)
reaper.GetSetMediaTrackInfo_String(tr,'P_NAME',
 '06  |  SUNO ORIGINAL SCENE SCORE  |  12 NEW STORY COMPOSITIONS',true)
reaper.SetTrackColor(tr,reaper.ColorToNative(206,150,82) | 0x1000000)
reaper.SetMediaTrackInfo_Value(tr,'B_MUTE',0)
reaper.SetMediaTrackInfo_Value(tr,'B_SHOWINTCP',1)
reaper.SetMediaTrackInfo_Value(tr,'B_SHOWINMIXER',1)
reaper.SetMediaTrackInfo_Value(tr,'I_HEIGHTOVERRIDE',145)
reaper.SetMediaTrackInfo_Value(tr,'D_VOL',1.0)
local count=0
local summary={}
for _,cue in ipairs(scores) do
 local m=sources[cue.id]
 local item=reaper.AddMediaItemToTrack(tr)
 reaper.SetMediaItemInfo_Value(item,'D_POSITION',cue.start)
 reaper.SetMediaItemInfo_Value(item,'D_LENGTH',m.clip)
 reaper.SetMediaItemInfo_Value(item,'B_LOOPSRC',0)
 reaper.SetMediaItemInfo_Value(item,'D_FADEINLEN',math.min(cue.fadein,m.clip*.12))
 reaper.SetMediaItemInfo_Value(item,'D_FADEOUTLEN',math.min(cue.fadeout,m.clip*.12))
 local take=reaper.AddTakeToMediaItem(item)
 reaper.SetMediaItemTake_Source(take,m.source)
 reaper.SetMediaItemTakeInfo_Value(take,'D_STARTOFFS',cue.offset)
 reaper.SetMediaItemTakeInfo_Value(take,'D_VOL',cue.gain)
 reaper.GetSetMediaItemTakeInfo_String(take,'P_NAME',
  'ORIGINAL SUNO SCENE '..cue.id..' | '..cue.name,true)
 reaper.GetSetMediaItemInfo_String(item,'P_NOTES',
  'ORIGINAL SUNO SCORE FOR THIS DOCUMENTARY SCENE\n'..
  'Scene: '..cue.name..'\n'..
  'User-downloaded local source: '..m.path..'\n'..
  'Original Suno song: '..cue.song_url..'\n'..
  'This source is music ONLY: existing ElevenLabs Logan and original broadcasts remain on their own tracks.\n'..
  'Per-word/sentence scoring remains in the existing three continuous Suno tracks above.\n'..
  'Scene start '..cue.start..', length '..m.clip..', relative source offset '..cue.offset..', gain '..cue.gain,true)
 count=count+1
 reaper.AddProjectMarker2(0,false,cue.start,0,'ORIGINAL SUNO SCENE '..cue.id..' — '..cue.name,-1,
    reaper.ColorToNative(201,157,89)|0x1000000)
 summary[#summary+1]=cue.id..' '..cue.name..' @ '..cue.start..' sec, duration '..m.clip..' sec, '..m.path
end
local _,existingNotes=reaper.GetSetProjectNotes(0,false,'')
reaper.GetSetProjectNotes(0,true,(existingNotes or '')..
 '\n\nNOV 13 IN-PLACE ORIGINAL SCENE SCORE IMPORT:\n'..
 'Imported 12 distinct locally downloaded Suno instrumental compositions into THIS SAME REAPER PROJECT.\n'..
 'One prominent scene-score track directly below narrator plus three continuous word- and sentence-responsive original Suno tracks.\n'..
 'No new narration/audio generation. Five spoken AQ labels were already surgically removed.\n'..
 'Same original RPP file; one recovery backup in SCORE_SCENES_20261113/ProductionBackup.\n'..
 'Editorial scene cue positions/tone remain subject to listening and musical refinement.')
reaper.UpdateArrange()
reaper.SetOnlyTrackSelected(tr)
reaper.SetEditCurPos(oldCursor,false,false)
reaper.Undo_EndBlock('Import 12 original Suno scene scores INTO CURRENT PROJECT — in place',-1)
reaper.PreventUIRefresh(-1)
if count==12 and reaper.CountTrackMediaItems(tr)==12 then
 reaper.Main_SaveProject(0,false)
 log('SUCCESS: 12 original Suno scene compositions imported INTO CURRENT REAPER PROJECT (NO NEW PROJECT).\n'..
  'Active project: '..expected..'\nRecovery backup: '..backup..'\n'..
  'Total tracks: '..reaper.CountTracks(0)..'\nScene score audio items: '..count..
  '\nOriginal 3 word-synchronized scoring tracks and ElevenLabs Logan intact.\n'..
  'No Suno credits, no ElevenLabs generation used.\n\n'..table.concat(summary,'\n'))
else
 reaper.Undo_DoUndo2(0)
 log('ERROR: attempted to insert 12 score items; got '..count..'. Reverted in-memory edit.')
end
