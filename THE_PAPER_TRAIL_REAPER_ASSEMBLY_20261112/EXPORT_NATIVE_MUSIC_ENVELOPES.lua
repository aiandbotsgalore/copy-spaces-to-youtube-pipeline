local self=debug.getinfo(1,'S').source:sub(2)
local base=self:match('^(.*)[/\\]') or '.'
local out=assert(io.open(base..'\\SCORE_SCENES_20261113\\MUSIC_REFINEMENT_NATIVE_ENVELOPES.tsv','w'))
out:write('track\tpoint_time\tvolume_linear\n')
local n=0
for i=0,reaper.CountTracks(0)-1 do
 local tr=reaper.GetTrack(0,i)
 local _,name=reaper.GetSetMediaTrackInfo_String(tr,'P_NAME','',false)
 if name:find('SUNO ORIGINAL SCENE SCORE',1,true) or name:find('SUNO INSTRUMENTAL SCORE',1,true) then
  local env=reaper.GetTrackEnvelopeByName(tr,'Volume')
  local _,chunk=reaper.GetEnvelopeStateChunk(env,'',false)
  for line in chunk:gmatch('[^\r\n]+') do
   local t,v=line:match('^PT%s+(%S+)%s+(%S+)')
   if t and v then
    out:write(name..'\t'..t..'\t'..v..'\n')
    n=n+1
   end
  end
 end
end
out:close()
local f=assert(io.open(base..'\\SCORE_SCENES_20261113\\MUSIC_REFINEMENT_ENVELOPE_EXPORT_LOG.txt','w'))
f:write('SUCCESS: Exported '..n..' exact native REAPER score envelope points for listening QA.\n')
f:close()
