local self=debug.getinfo(1,'S').source:sub(2)
local folder=self:match('^(.*)[/\\]') or '.'
local f=assert(io.open(folder..'\\SCORE_SCENES_20261113\\ENVELOPE_POINT_TECH_AUDIT.txt','w'))
f:write('DeleteEnvelopePoint available '..tostring(reaper.APIExists('DeleteEnvelopePoint'))..'\n')
f:write('DeleteEnvelopePointRange available '..tostring(reaper.APIExists('DeleteEnvelopePointRange'))..'\n')
f:write('SetEnvelopePoint available '..tostring(reaper.APIExists('SetEnvelopePoint'))..'\n')
f:write('SetEnvelopeStateChunk available '..tostring(reaper.APIExists('SetEnvelopeStateChunk'))..'\n')
for i=0,reaper.CountTracks(0)-1 do
 local tr=reaper.GetTrack(0,i)
 local _,name=reaper.GetSetMediaTrackInfo_String(tr,'P_NAME','',false)
 if name:find('SUNO ORIGINAL SCENE SCORE',1,true) or name:find('SUNO INSTRUMENTAL SCORE',1,true) then
  local env=reaper.GetTrackEnvelopeByName(tr,'Volume')
  local count=env and reaper.CountEnvelopePoints(env) or -1
  f:write('TRACK '..name..' count '..count..'\n')
  if env and count>0 then
   for _,j in ipairs({0,math.floor(count/2),count-1})do
    local _,t,v=reaper.GetEnvelopePoint(env,j)
    f:write('PT '..j..' time '..t..' val '..v..'\n')
   end
   local ok,chunk=reaper.GetEnvelopeStateChunk(env,'',false)
   f:write('CHUNK PREFIX '..tostring(chunk):sub(1,650)..'\n')
  end
 end
end
local tr=reaper.GetTrack(0,1)
local _,name=reaper.GetSetMediaTrackInfo_String(tr,'P_NAME','',false)
f:write('VOICE '..name..' MUTED '..reaper.GetMediaTrackInfo_Value(tr,'B_MUTE')..'\n')
f:close()
