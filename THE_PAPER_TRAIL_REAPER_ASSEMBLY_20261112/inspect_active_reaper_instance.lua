local self=debug.getinfo(1,'S').source:sub(2)
local folder=self:match('^(.*)[/\\]') or '.'
local _,path=reaper.EnumProjects(-1,'')
local f=io.open(folder..'\\CURRENT_REAPER_INSTANCE_CHECK.txt','w')
if f then
 f:write('ACTIVE PROJECT: '..tostring(path)..'\n')
 f:write('TRACKS: '..reaper.CountTracks(0)..'\n')
 for i=0,math.min(reaper.CountTracks(0)-1,7)do
  local tr=reaper.GetTrack(0,i)
  local _,name=reaper.GetSetMediaTrackInfo_String(tr,'P_NAME','',false)
  f:write(i..'  '..name..'\n')
 end
 f:close()
end
