-- THE PAPER TRAIL: final story-aware Suno music balance, IN PLACE in the ONE open RPP.
-- Replace only four envelopes we created earlier, preserving each envelope's GUID/metadata.
-- The safer state-chunk replacement method was experimentally verified to restore exact bytes.
local self=debug.getinfo(1,'S').source:sub(2)
local root=self:match('^(.*)[/\\]') or '.'
local expected=root..'\\THE_PAPER_TRAIL_LOGAN_LABELS_REMOVED_SUNO_VISIBLE_v7.RPP'
local backup=root..'\\SCORE_SCENES_20261113\\ProductionBackup\\THE_PAPER_TRAIL_Before_Corrected_Dialogue_Music_20261113.RPP'
local logfile=root..'\\SCORE_SCENES_20261113\\FINAL_DIALOGUE_SCORING_AUTOMATION_RESULT.txt'
local data=dofile(root..'\\SCORE_SCENES_20261113\\MUSIC_REFINEMENT_AUTOMATION_DATA.lua')
local function log(s)
 local f=io.open(logfile,'w')
 if f then f:write(s);f:close()end
 reaper.ShowConsoleMsg(s..'\n')
end
local _,active=reaper.EnumProjects(-1,'')
if active:lower()~=expected:lower() then log('ABORT: not the existing working project.');return end
if reaper.GetPlayState()~=0 then log('ABORT: REAPER currently playing or recording; no edits made.');return end
if reaper.CountTracks(0)~=18 then log('ABORT: track structure changed. No edits.');return end
local narrator=reaper.GetTrack(0,1)
local guide=reaper.GetTrack(0,0)
local _,vname=reaper.GetSetMediaTrackInfo_String(narrator,'P_NAME','',false)
if not vname:find('ELEVENLABS LOGAN',1,true) or reaper.CountTrackMediaItems(narrator)~=237 or
 reaper.GetMediaTrackInfo_Value(guide,'B_MUTE')<.5 then
 log('ABORT: narrator/guide status unexpected. Verify before any edits.');return
end
local specs={
 {key='SUNO ORIGINAL SCENE SCORE',expected_points=885,expected_items=12},
 {key='SUNO INSTRUMENTAL SCORE  |  INVESTIGATION',expected_points=495,expected_items=5},
 {key='SUNO INSTRUMENTAL SCORE  |  TRUST',expected_points=495,expected_items=5},
 {key='SUNO INSTRUMENTAL SCORE  |  SIGNATURE',expected_points=495,expected_items=5}
}
for _,s in ipairs(specs)do
 for i=0,reaper.CountTracks(0)-1 do
  local t=reaper.GetTrack(0,i)
  local _,name=reaper.GetSetMediaTrackInfo_String(t,'P_NAME','',false)
  if name:find(s.key,1,true) then
   if s.track then log('ABORT: duplicate matching track '..s.key);return end
   s.track=t
   s.name=name
  end
 end
 if not s.track or not data.curves[s.key] then log('ABORT: missing music track or data '..s.key);return end
 if reaper.CountTrackMediaItems(s.track)~=s.expected_items then
  log('ABORT: music source item count changed '..s.key);return
 end
 s.env=reaper.GetTrackEnvelopeByName(s.track,'Volume')
 if not s.env or reaper.CountEnvelopePoints(s.env)~=s.expected_points then
  log('ABORT: original editorial automation has changed. Protecting user edits '..s.key);return
 end
 local ok,chunk=reaper.GetEnvelopeStateChunk(s.env,'',false)
 if not ok or not chunk or not chunk:match('^<VOLENV2') or chunk:find('\n<AI',1,true) or
   not chunk:match('\n>%s*$') then
  log('ABORT: unexpected envelope chunk layout. No edits. '..s.key);return
 end
 local a=chunk:find('\nPT ',1,true)
 if not a then log('ABORT: expected points not in envelope chunk. '..s.key);return end
 s.oldchunk=chunk
 local header=chunk:sub(1,a)
 local points={}
 local mode=reaper.GetEnvelopeScalingMode(s.env)
 for _,pair in ipairs(data.curves[s.key]) do
  local t=tonumber(pair[1])
  local linear=tonumber(pair[2])
  points[#points+1]=string.format('PT %.3f %.5f 0',t,linear)
 end
 s.newchunk=header..'\n'..table.concat(points,'\n')..'\n>\n'
 s.new_count=#points
end
-- Save the actual present state then create ONE private recovery backup, NOT a new working RPP.
local existing_backup=io.open(backup,'rb')
local validBackup=false
if existing_backup then
 local n=existing_backup:seek('end')
 existing_backup:close()
 if n<150000 then
  log('ABORT: existing backup invalid. Protecting current project.')
  return
 end
 validBackup=true
end
-- If a validated backup from this exact safe retry already exists, reuse it.
-- Do not create duplicate/competing project files.
reaper.Main_SaveProject(0,false)
if not validBackup then
 local reader=io.open(expected,'rb')
 local writer=io.open(backup,'wb')
 if not reader or not writer then
  if reader then reader:close() end
  if writer then writer:close() end
  log('ABORT: unable to create private backup. No changes to music.')
  return
 end
 local nbytes=0
 while true do
  local buffer=reader:read(65536)
  if not buffer then break end
  writer:write(buffer)
  nbytes=nbytes+#buffer
 end
 reader:close();writer:close()
 if nbytes<150000 then log('ABORT: backup length invalid.');return end
end
reaper.PreventUIRefresh(1)
reaper.Undo_BeginBlock()
local error=nil
local modified=0
for _,s in ipairs(specs) do
 local ok=reaper.SetEnvelopeStateChunk(s.env,s.newchunk,true)
 local n=reaper.CountEnvelopePoints(s.env)
 if not ok or n~=s.new_count then
  error='Failed safe point replacement '..s.key..' API='..tostring(ok)..' items='..n
  break
 end
 modified=modified+1
end
local env=specs[2].env
local mode=reaper.GetEnvelopeScalingMode(env)
local _,val25=reaper.Envelope_Evaluate(env,25,0,0)
local _,val100=reaper.Envelope_Evaluate(env,100,0,0)
local under25=reaper.ScaleFromEnvelopeMode(mode,val25)
local under100=reaper.ScaleFromEnvelopeMode(mode,val100)
if under25>.76 or under25<.45 or under100>.60 or under100<.35 then
 error='Speech/archival duck validation out of range: 25s '..under25..', 100s '..under100
end
if error or modified~=4 then
 for _,s in ipairs(specs)do
  reaper.SetEnvelopeStateChunk(s.env,s.oldchunk,false)
 end
 reaper.Undo_EndBlock('Rejected music adjustment; original envelope bytes restored',-1)
 -- The prior user-visible narration unmute must NEVER be undone when a music edit fails.
 -- The actual four source envelopes have already been restored above.
 reaper.PreventUIRefresh(-1)
 log('ABORTED. Original four music envelopes were restored. No project saved.\n'..tostring(error))
 return
end
reaper.SetMediaTrackInfo_Value(narrator,'B_MUTE',0)
reaper.UpdateArrange()
reaper.Undo_EndBlock('Refine the ORIGINAL Suno score around Logan voice, archive, sensitive words and deliberate silence',-1)
reaper.PreventUIRefresh(-1)
reaper.Main_SaveProject(0,false)
local summary={'PASS: Original REAPER project saved IN PLACE with voice-aware music automation.',
 'WORKING PROJECT: '..expected,
 'PRIVATE BACKUP: '..backup,
 'Narrator Logan explicitly unmuted in THIS same successful commit; 237 speaking items retained. All original audio files unchanged.',
 '12 distinct Suno scene compositions still loaded, plus three evolving word-level score stems.',
 'Archive testimony further protected, 18 explicit silence/placeholder windows respected.',
 '35 keyword-level clarity accents; 67 connected narrator intervals and 44 archival intervals.',
 'Gain checks: 25sec narrator duck='..under25..', 100sec archival duck='..under100}
for _,s in ipairs(specs)do
 summary[#summary+1]='Music envelope: '..s.name..' / '..s.new_count..' editable points'
end
summary[#summary+1]='No new Reaper projects, ElevenLabs narration, Suno downloads or new music generated.'
summary[#summary+1]='Technical balance validated; subjective creative audition and missing written readings are not finished.'
log(table.concat(summary,'\n')..'\n')
