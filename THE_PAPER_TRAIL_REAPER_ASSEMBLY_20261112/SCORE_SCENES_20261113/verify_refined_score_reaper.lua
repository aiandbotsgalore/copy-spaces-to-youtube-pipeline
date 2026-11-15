local self=debug.getinfo(1,'S').source:sub(2)
local base=self:match('^(.*)[/\\]') or '.'
local target=base..'\\SCORE_SCENES_20261113\\FINAL_REAPER_MUSIC_VERIFICATION.txt'
local log=assert(io.open(target,'w'))
local _,path=reaper.EnumProjects(-1,'')
log:write('OPEN_PROJECT '..tostring(path)..'\n')
log:write('TRACKS '..reaper.CountTracks(0)..'\n')
local sceneItems=0;local realScoreTracks=0;local missing=0
for ti=0,reaper.CountTracks(0)-1 do
 local tr=reaper.GetTrack(0,ti)
 local _,name=reaper.GetSetMediaTrackInfo_String(tr,'P_NAME','',false)
 local n=reaper.CountTrackMediaItems(tr)
 if name:find('SUNO INSTRUMENTAL SCORE',1,true) or name:find('SUNO ORIGINAL SCENE SCORE',1,true) then
  log:write('MUSIC_TRACK '..ti..' '..name..' items='..n..' muted='..reaper.GetMediaTrackInfo_Value(tr,'B_MUTE')..'\n')
  realScoreTracks=realScoreTracks+1
 end
 if name:find('SUNO ORIGINAL SCENE SCORE',1,true) then
  local env=reaper.GetTrackEnvelopeByName(tr,'Volume')
  log:write('EDITABLE_VOLUME_ENV '..tostring(env~=nil)..' points='..(env and reaper.CountEnvelopePoints(env) or 0)..'\n')
  for i=0,n-1 do
   local item=reaper.GetTrackMediaItem(tr,i)
   local tk=reaper.GetActiveTake(item)
   local src=tk and reaper.GetMediaItemTake_Source(tk)
   local _,file=src and reaper.GetMediaSourceFileName(src,'')
   local _,title=tk and reaper.GetSetMediaItemTakeInfo_String(tk,'P_NAME','',false)
   local f=file and io.open(file,'rb')
   if f then f:close() else missing=missing+1 end
   sceneItems=sceneItems+1
   log:write('SCENE_ITEM '..i..' pos='..reaper.GetMediaItemInfo_Value(item,'D_POSITION')..' dur='..reaper.GetMediaItemInfo_Value(item,'D_LENGTH')..' '..tostring(title)..' file='..tostring(file)..'\n')
  end
 end
end
local ok=(reaper.CountTracks(0)==18 and realScoreTracks==4 and sceneItems==21 and missing==0)
log:write('SCENE_ITEMS '..sceneItems..' MISSING_SOURCES '..missing..' STATUS '..(ok and 'PASS' or 'FAIL')..'\n')
log:close()
