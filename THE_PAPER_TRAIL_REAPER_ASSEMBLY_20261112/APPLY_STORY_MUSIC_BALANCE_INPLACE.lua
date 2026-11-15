-- THE PAPER TRAIL — EDIT ONE CANONICAL REAPER PROJECT: narration-first soundtrack balancing.
-- No new projects, no new voice/audio, no scene item deletions. Four music-track volume
-- envelopes. Measured speech/archives, exact important-word moments, deliberate silences.
local self=debug.getinfo(1,'S').source:sub(2)
local folder=self:match('^(.*)[/\\]') or '.'
local expected=folder..'\\THE_PAPER_TRAIL_LOGAN_LABELS_REMOVED_SUNO_VISIBLE_v7.RPP'
local backup=folder..'\\SCORE_SCENES_20261113\\ProductionBackup\\THE_PAPER_TRAIL_Before_Music_Balance_20261113.RPP'
local data=dofile(folder..'\\SCORE_SCENES_20261113\\MUSIC_REFINEMENT_AUTOMATION_DATA.lua')
local logpath=folder..'\\SCORE_SCENES_20261113\\MUSIC_REFINEMENT_REAPER_RESULT.txt'
local function log(message)
 local f=io.open(logpath,'w')
 if f then f:write(message);f:close()end
 reaper.ShowConsoleMsg(message..'\n')
end
local _,active=reaper.EnumProjects(-1,'')
if tostring(active):lower()~=expected:lower() then
 log('ABORT: wrong project loaded: '..tostring(active)..'. No changes made.')
 return
end
if reaper.CountTracks(0)~=18 then
 log('ABORT: expected 18 tracks, found '..reaper.CountTracks(0)..'. No changes made.')
 return
end
if reaper.GetPlayState()~=0 then
 log('ABORT: REAPER playback or recording is active. No changes made. Stop playback before mixing.')
 return
end
local patterns={
  {key='SUNO ORIGINAL SCENE SCORE',name='12 NEW STORY COMPOSITIONS'},
  {key='SUNO INSTRUMENTAL SCORE  |  INVESTIGATION',name='INVESTIGATION'},
  {key='SUNO INSTRUMENTAL SCORE  |  TRUST',name='TRUST / SAV'},
  {key='SUNO INSTRUMENTAL SCORE  |  SIGNATURE',name='SIGNATURE MOTIF'}
}
local originals={}
local tracks={}
for i=0,reaper.CountTracks(0)-1 do
 local tr=reaper.GetTrack(0,i)
 local _,name=reaper.GetSetMediaTrackInfo_String(tr,'P_NAME','',false)
 if reaper.IsTrackSelected(tr) then originals[#originals+1]=tr end
 for _,spec in ipairs(patterns) do
  if name:find(spec.key,1,true) then
   if tracks[spec.key] then
    log('ABORT: duplicate music track '..spec.key..'. No changes made.')
    return
   end
   tracks[spec.key]=tr
   if reaper.GetTrackEnvelopeByName(tr,'Volume') then
    log('ABORT: volume envelope already present on '..name..'. Refusing to overwrite existing user automation.')
    return
   end
  end
 end
end
for _,spec in ipairs(patterns)do
 local tr=tracks[spec.key]
 if not tr or not data.curves[spec.key] then
  log('ABORT: cannot locate '..spec.key..' track or prepared envelope. No changes made.')
  return
 end
 local n=reaper.CountTrackMediaItems(tr)
 if spec.key=='SUNO ORIGINAL SCENE SCORE' and n~=12 then
  log('ABORT: original scene track has '..n..' items, expected 12. No changes made.')
  return
 end
end
local working=io.open(expected,'rb')
if not working then log('ABORT: cannot read canonical project. No modifications.');return end
working:close()
local existing=io.open(backup,'rb')
if existing then
 existing:close()
 log('ABORT: backup path already exists; refusing to overwrite it. No modifications.')
 return
end
-- First save the currently open user session into its EXISTING RPP.
reaper.Main_SaveProject(0,false)
local source=io.open(expected,'rb')
local dest=io.open(backup,'wb')
if not source or not dest then
 if source then source:close() end
 if dest then dest:close() end
 log('ABORT: cannot create private recovery backup. No track edits made.')
 return
end
local nbytes=0
while true do
 local chunk=source:read(65536)
 if not chunk then break end
 dest:write(chunk)
 nbytes=nbytes+#chunk
end
source:close()
dest:close()
if nbytes<150000 then
 log('ABORT: backup too small. No edits made.')
 return
end
local selected_before=originals
local cursor=reaper.GetCursorPosition()
reaper.PreventUIRefresh(1)
reaper.Undo_BeginBlock()
local summary={}
local successes=0
local message=nil
for _,spec in ipairs(patterns) do
 local tr=tracks[spec.key]
 -- REAPER stock action: Track: Toggle track volume envelope visible.
 -- It creates one new editable track-volume envelope.
 reaper.SetOnlyTrackSelected(tr)
 reaper.Main_OnCommand(40406,0)
 local env=reaper.GetTrackEnvelopeByName(tr,'Volume')
 if not env then
  message='Could not create track-volume envelope on '..spec.name
  break
 end
 local curpoints=reaper.CountEnvelopePoints(env)
 if curpoints>1 then
  message='Unexpected preexisting envelope points on '..spec.name
  break
 end
 if curpoints>0 then reaper.DeleteEnvelopePointRange(env,-0.01,0.01) end; local mode=reaper.GetEnvelopeScalingMode(env)
 for _,pair in ipairs(data.curves[spec.key]) do
  local t=tonumber(pair[1])
  local linear=tonumber(pair[2])
  reaper.InsertEnvelopePoint(env,t,reaper.ScaleToEnvelopeMode(mode,linear),0,0,false,true)
 end
 reaper.Envelope_SortPoints(env)
 local found=reaper.CountEnvelopePoints(env)
 if found<#data.curves[spec.key] then
  message='After inserting automation points, '..spec.name..' returned only '..found..' points'
  break
 end
 summary[#summary+1]=spec.name..' : '..found..' editable gain-envelope points.'
 successes=successes+1
end
for i=0,reaper.CountTracks(0)-1 do reaper.SetTrackSelected(reaper.GetTrack(0,i),false) end
for _,t in ipairs(selected_before) do
 if reaper.ValidatePtr2(0,t,'MediaTrack*') then reaper.SetTrackSelected(t,true) end
end
reaper.SetEditCurPos(cursor,false,false)
if successes~=#patterns then
 reaper.Undo_EndBlock('Aborted music automation creation',-1)
 reaper.Undo_DoUndo2(0)
 reaper.PreventUIRefresh(-1)
 log('ABORT: '..tostring(message)..'. Reverted the attempted edit; original project retained.\nBackup: '..backup)
 return
end
reaper.UpdateArrange()
reaper.Undo_EndBlock('Documentary scene score balancing with actual dialogue duck and spoken-word emphasis',-1)
reaper.PreventUIRefresh(-1)
-- Save THE SAME RPP. No new competing versions created.
reaper.Main_SaveProject(0,false)
local report='MUSIC PASS COMPLETE — IN PLACE, ONE CANONICAL REAPER PROJECT\n'..
 'PROJECT: '..expected..'\n'..
 'BACKUP ONLY: '..backup..'\n'..
 'SOURCE FILES: no changes, 12 new scene cues still present, original 3 score stems still present.\n'..
 'NARRATOR: ElevenLabs Logan unchanged; five previously edited spoken AQ labels remain removed.\n'..
 'AUTOMATION: '..table.concat(summary,'\n')..'\n'..
 'STORY: '..#data.words..' significant spoken-word clarity dips, '..#data.holds..' deliberate/editorial silence windows.\n'..
 'Music sits under recorded narration and retreats further during actual archival voices.\n'..
 'Quality status: objective source/level/timing work. Final listening is required before release.\n'
log(report)

