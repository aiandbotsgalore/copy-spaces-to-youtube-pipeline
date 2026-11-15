local path=debug.getinfo(1,'S').source:sub(2)
local folder=path:match('^(.*)[/\\]') or '.'
local project=folder..'\\THE_PAPER_TRAIL_LOGAN_LABELS_REMOVED_SUNO_VISIBLE_v7.RPP'
reaper.Main_openProject(project)
local f=assert(io.open(folder..'\\SCORE_SCENES_20261113\\ENVELOPE_CAPABILITY_CHECK.txt','w'))
local _,open=reaper.EnumProjects(-1,'')
f:write('ACTIVE '..open..' tracks '..reaper.CountTracks(0)..'\n')
for i=0,reaper.CountTracks(0)-1 do
 local tr=reaper.GetTrack(0,i)
 local _,name=reaper.GetSetMediaTrackInfo_String(tr,'P_NAME','',false)
 if name:find('SUNO',1,true) or name:find('ELEVENLABS',1,true) then
  local env=reaper.GetTrackEnvelopeByName(tr,'Volume')
  f:write(tostring(i)..' '..name..' volume_env='..tostring(env~=nil)..' track_vol='..reaper.GetMediaTrackInfo_Value(tr,'D_VOL')..'\n')
 end
end
f:close()
