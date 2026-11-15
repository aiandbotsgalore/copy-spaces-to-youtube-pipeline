local self=debug.getinfo(1,'S').source:sub(2)
local folder=self:match('^(.*)[/\\]') or '.'
local _,active=reaper.EnumProjects(-1,'')
local out=assert(io.open(folder..'\\SCORE_SCENES_20261113\\MUSIC_REFINEMENT_AFTER_REAPER_QA.tsv','w'))
out:write('type\ttrack\tvalue1\tvalue2\tvalue3\tvalue4\n')
out:write('project\t'..tostring(active)..'\t'..reaper.CountTracks(0)..'\n')
for i=0,reaper.CountTracks(0)-1 do
 local tr=reaper.GetTrack(0,i)
 local _,name=reaper.GetSetMediaTrackInfo_String(tr,'P_NAME','',false)
 if name:find('SUNO INSTRUMENTAL SCORE',1,true) or name:find('SUNO ORIGINAL SCENE SCORE',1,true) then
  local env=reaper.GetTrackEnvelopeByName(tr,'Volume')
  local n=env and reaper.CountEnvelopePoints(env) or -1
  local items=reaper.CountTrackMediaItems(tr)
  out:write('music_track\t'..name..'\t'..items..'\t'..n..'\t'..reaper.GetMediaTrackInfo_Value(tr,'B_MUTE')..'\n')
  if env then
   local mode=reaper.GetEnvelopeScalingMode(env)
   for _,t in ipairs({25,100,230,430,560,588,619,850,1070,1480,2010,2395,2475,2660,3200,3590,3740,4060,4090,4300}) do
    local ok,val=reaper.Envelope_Evaluate(env,t,0,0)
    local amp=reaper.ScaleFromEnvelopeMode(mode,val)
    out:write('sample_gain\t'..name..'\t'..t..'\t'..amp..'\n')
   end
  end
 end
end
out:close()
