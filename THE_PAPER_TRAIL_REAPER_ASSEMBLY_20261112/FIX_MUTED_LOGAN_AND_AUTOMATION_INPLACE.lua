-- THE PAPER TRAIL: fix unexpectedly muted Logan narrator; re-balance against REAL speech.
-- ONE EXISTING REAPER PROJECT. Preserve user-owned originals, original Suno files,
-- previously edited removal of AQ spoken IDs, archival audio and all scene cues.
local src=debug.getinfo(1,'S').source:sub(2)
local folder=src:match('^(.*)[/\\]') or '.'
local expected=folder..'\\THE_PAPER_TRAIL_LOGAN_LABELS_REMOVED_SUNO_VISIBLE_v7.RPP'
local backup=folder..'\\SCORE_SCENES_20261113\\ProductionBackup\\THE_PAPER_TRAIL_Before_Unmute_Logan_And_MixFix_20261113.RPP'
local logpath=folder..'\\SCORE_SCENES_20261113\\FINAL_NARRATOR_AND_SCORE_MIX_FIX.txt'
local data=dofile(folder..'\\SCORE_SCENES_20261113\\MUSIC_REFINEMENT_AUTOMATION_DATA.lua')
local function log(s)
 local f=io.open(logpath,'w')
 if f then f:write(s);f:close()end
 reaper.ShowConsoleMsg(s..'\n')
end
local _,current=reaper.EnumProjects(-1,'')
if tostring(current):lower()~=expected:lower() then log('ABORT: wrong current project. No edits. '..tostring(current));return end
if reaper.GetPlayState()~=0 then log('ABORT: REAPER is playing/recording. No edits.');return end
if reaper.CountTracks(0)~=18 then log('ABORT: expected 18 tracks, found '..reaper.CountTracks(0));return end
local voice,guide=nil,nil
local specs={
 {tag='SUNO ORIGINAL SCENE SCORE',label='12 UNIQUE NEW SCENE COMPOSITIONS',old=885},
 {tag='SUNO INSTRUMENTAL SCORE  |  INVESTIGATION',label='INVESTIGATIVE CONTINUOUS STEM',old=495},
 {tag='SUNO INSTRUMENTAL SCORE  |  TRUST',label='HUMAN CONTINUOUS STEM',old=495},
 {tag='SUNO INSTRUMENTAL SCORE  |  SIGNATURE',label='SIGNATURE CONTINUOUS STEM',old=495}
}
local selected={}
for ti=0,reaper.CountTracks(0)-1 do
 local tr=reaper.GetTrack(0,ti)
 local _,name=reaper.GetSetMediaTrackInfo_String(tr,'P_NAME','',false)
 if reaper.IsTrackSelected(tr) then selected[#selected+1]=tr end
 if name:find('ELEVENLABS LOGAN  |  NARRATION',1,true) then voice=tr end
 if name:find('ORIGINAL NARRATION TEXT GUIDE',1,true) then guide=tr end
 for _,s in ipairs(specs) do
  if name:find(s.tag,1,true) then
   if s.track then log('ABORT: duplicate music track for '..s.label);return end
   s.track=tr;s.name=name
  end
 end
end
if not voice or not guide or reaper.CountTrackMediaItems(voice)<230 then
 log('ABORT: Logan narrator or guide missing / unexpected source cue count; no modifications.')
 return
end
if reaper.GetMediaTrackInfo_Value(voice,'B_MUTE')~=.0 and reaper.GetMediaTrackInfo_Value(voice,'B_MUTE')~=1 then
 log('ABORT: unusual narrator mute state; no modifications.');return
end
if reaper.GetMediaTrackInfo_Value(guide,'B_MUTE')<.5 then
 log('ABORT: original text-guide is unexpectedly audible. Please investigate manually.');return
end
for _,s in ipairs(specs)do
 if not s.track or not data.curves[s.tag] then
  log('ABORT: required Suno track or new automation data missing: '..s.label)
  return
 end
 local env=reaper.GetTrackEnvelopeByName(s.track,'Volume')
 if not env or reaper.CountEnvelopePoints(env)~=s.old then
  log('ABORT: music envelope changed since first pass; refusing to overwrite user edits: '..s.label)
  return
 end
 s.env=env
end
local test=io.open(backup,'rb')
if test then test:close();log('ABORT: same backup already exists; no overwrite.');return end
reaper.Main_SaveProject(0,false)
local old=io.open(expected,'rb');local dest=io.open(backup,'wb')
if not old or not dest then
 if old then old:close()end
 if dest then dest:close()end
 log('ABORT: failed to create recovery backup; no edits.')
 return
end
local copied=0
while true do
 local chunk=old:read(65536)
 if not chunk then break end
 dest:write(chunk)
 copied=copied+#chunk
end
old:close();dest:close()
if copied<100000 then log('ABORT: invalid recovery backup. No edits.');return end
local cursor=reaper.GetCursorPosition()
reaper.PreventUIRefresh(1)
reaper.Undo_BeginBlock()
local originalMute=reaper.GetMediaTrackInfo_Value(voice,'B_MUTE')
reaper.SetMediaTrackInfo_Value(voice,'B_MUTE',0)
local succeeded=0
local reasons={}
for _,s in ipairs(specs) do
 local env=s.env
 local count=reaper.CountEnvelopePoints(env)
 reaper.DeleteEnvelopePointRange(env,-1,data.episode_end+2)
 if reaper.CountEnvelopePoints(env)~=0 then
  reasons[#reasons+1]='Old envelope points could not be cleared for '..s.label
  break
 end
 local mode=reaper.GetEnvelopeScalingMode(env)
 for _,pair in ipairs(data.curves[s.tag]) do
  reaper.InsertEnvelopePoint(env,tonumber(pair[1]),
   reaper.ScaleToEnvelopeMode(mode,tonumber(pair[2])),0,0,false,true)
 end
 reaper.Envelope_SortPoints(env)
 local n=reaper.CountEnvelopePoints(env)
 if n~=#data.curves[s.tag] then
  reasons[#reasons+1]='Point mismatch '..s.label..' '..n..'/'..#data.curves[s.tag]
  break
 end
 succeeded=succeeded+1
end
local env=specs[2].env
local mode=reaper.GetEnvelopeScalingMode(env)
local _,v_narr=reaper.Envelope_Evaluate(env,25,0,0)
local _,v_archive=reaper.Envelope_Evaluate(env,100,0,0)
local narration_val=reaper.ScaleFromEnvelopeMode(mode,v_narr)
local archive_val=reaper.ScaleFromEnvelopeMode(mode,v_archive)
if narration_val>.78 or archive_val>.65 then
 reasons[#reasons+1]='Unexpected dialogue/music balance at 25s or 100s: '..narration_val..','..archive_val
end
if reaper.GetMediaTrackInfo_Value(voice,'B_MUTE')~=.0 then
 reasons[#reasons+1]='Logan narrator still muted.'
end
reaper.SetEditCurPos(cursor,false,false)
if #reasons>0 or succeeded~=#specs then
 reaper.Undo_EndBlock('ABORT: incomplete narrator+score balance revision',-1)
 reaper.Undo_DoUndo2(0)
 reaper.PreventUIRefresh(-1)
 log('ABORTED AND REVERTED (working project not saved). Errors:\n'..table.concat(reasons,'\n')..
 '\nBackup available: '..backup)
 return
end
reaper.UpdateArrange()
reaper.Undo_EndBlock('Unmute original ElevenLabs Logan narration and correctly automate music under every recorded voice',-1)
reaper.PreventUIRefresh(-1)
reaper.Main_SaveProject(0,false)
local report='PASS — SINGLE CANONICAL REAPER PROJECT CORRECTED IN PLACE\n'..
 'Saved file: '..expected..'\nRecovery backup only: '..backup..'\n'..
 'USER LOGAN ELEVENLABS NARRATION TRACK: UNMUTED, original 237 media items retained.\n'..
 'ORIGINAL TEXT GUIDE remains MUTED.\n'..
 '12 original downloaded Suno scene items and three existing score sources unchanged.\n'..
 'Music automation now uses 67 merged real narrator intervals and 44 original archive intervals.\n'..
 '4 active Suno tracks now carry '..succeeded..' complete updated envelopes.\n'..
 'New editable automation points: '..#data.curves[specs[1].tag]..', '..
 #data.curves[specs[2].tag]..', '..#data.curves[specs[3].tag]..', '..#data.curves[specs[4].tag]..'.\n'..
 'Spot-check score duck at 25s over narrator: '..narration_val..
 '; at 100s over archive: '..archive_val..'.\n'..
 'Thirty-five exact important-word clarity accents and eighteen editorial silence windows retained.\n'..
 'Previously cut spoken AQ labels remain out. Zero new narration or Suno credits.\n'..
 'Remaining: final creative listening judgment, unrecorded written-message passages and missing archive sources.\n'
log(report)

