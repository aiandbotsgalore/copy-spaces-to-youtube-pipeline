local self=debug.getinfo(1,'S').source:sub(2)
local root=self:match('^(.*)[/\\]') or '.'
local f=assert(io.open(root..'\\SCORE_SCENES_20261113\\ENVELOPE_SCALING_DIAG.txt','w'))
for _,ti in ipairs({2,5})do
 local tr=reaper.GetTrack(0,ti)
 local env=reaper.GetTrackEnvelopeByName(tr,'Volume')
 local mode=reaper.GetEnvelopeScalingMode(env)
 local _,chunk=reaper.GetEnvelopeStateChunk(env,'',false)
 f:write('TRACK '..ti..' SCALING MODE '..mode..'\n')
 f:write('EXISTING CHUNK '..chunk:sub(1,250)..'\n')
 for _,v in ipairs({0.05,0.3,0.5,0.66,0.94,1})do
  f:write('VAL '..v..' TO_MODE '..reaper.ScaleToEnvelopeMode(mode,v)..' FROM_MODE '..reaper.ScaleFromEnvelopeMode(mode,v)..'\n')
 end
end
f:close()
