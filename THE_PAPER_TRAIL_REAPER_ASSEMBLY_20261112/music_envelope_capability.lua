local self=debug.getinfo(1,'S').source:sub(2)
local folder=self:match('^(.*)[/\\]') or '.'
local f=assert(io.open(folder..'\\SCORE_SCENES_20261113\\MUSIC_ENVELOPE_CAPABILITY.txt','w'))
for ti=0,reaper.CountTracks(0)-1 do
 local tr=reaper.GetTrack(0,ti)
 local _,name=reaper.GetSetMediaTrackInfo_String(tr,'P_NAME','',false)
 if name:find('SUNO ',1,true) then
  local env=reaper.GetTrackEnvelopeByName(tr,'Volume')
  local _,chunk=reaper.GetTrackStateChunk(tr,'',false)
  f:write('TRACK '..ti..' '..name..'\n')
  f:write('VOLUME_ENV_EXISTS '..tostring(env~=nil)..' TRACK_ENV_COUNT '..reaper.CountTrackEnvelopes(tr)..' FX '..reaper.TrackFX_GetCount(tr)..'\n')
  for j=0,reaper.TrackFX_GetCount(tr)-1 do
    local _,fxname=reaper.TrackFX_GetFXName(tr,j,'')
    f:write('FX '..j..' '..fxname..'\n')
  end
  if chunk then
    f:write('TRACK_CHUNK_FIRST_1500 '..chunk:sub(1,1500)..'\n')
  end
 end
end
for _,id in ipairs({40406,40407,40408,40409,40410,40411,40015,40016,41084,41186}) do
 f:write('ACTION '..id..' '..tostring(reaper.kbd_getTextFromCmd(id,0))..'\n')
end
f:close()
