local script=debug.getinfo(1,'S').source:sub(2)
local base=script:match('^(.*)[/\\]') or '.'
local _,project=reaper.EnumProjects(-1,'')
local file=assert(io.open(base..'\\SCORE_SCENES_20261113\\POST_IMPORT_REAPER_VERIFICATION.txt','w'))
local tracks=reaper.CountTracks(0)
file:write('CURRENT_OPEN_PROJECT: '..tostring(project)..'\n')
file:write('REAPER_TRACK_COUNT: '..tracks..'\n')
local count=0;local errors={};local scoreTracks=0
for i=0,tracks-1 do
 local tr=reaper.GetTrack(0,i)
 local _,name=reaper.GetSetMediaTrackInfo_String(tr,'P_NAME','',false)
 local n=reaper.CountTrackMediaItems(tr)
 local muted=reaper.GetMediaTrackInfo_Value(tr,'B_MUTE')
 file:write('TRACK '..i..' ['..name..'] items='..n..' muted='..muted..'\n')
 if name:find('SUNO ORIGINAL SCENE SCORE',1,true) then
  scoreTracks=scoreTracks+1
  if muted~=0 then errors[#errors+1]='New score track is muted' end
  for j=0,n-1 do
   local item=reaper.GetTrackMediaItem(tr,j)
   local take=reaper.GetActiveTake(item)
   local source=take and reaper.GetMediaItemTake_Source(take)
   if source then
    local _,path=reaper.GetMediaSourceFileName(source,'')
    local _,takeName=reaper.GetSetMediaItemTakeInfo_String(take,'P_NAME','',false)
    local f=io.open(path,'rb')
    if f then f:close() else errors[#errors+1]='Audio source missing: '..tostring(path) end
    count=count+1
    file:write('CUE '..j..' '..takeName..' time='..reaper.GetMediaItemInfo_Value(item,'D_POSITION')..
      ' duration='..reaper.GetMediaItemInfo_Value(item,'D_LENGTH')..' path='..tostring(path)..'\n')
   else errors[#errors+1]='Media source missing in cue '..j end
  end
 end
end
file:write('SCENE_SCORE_TRACKS: '..scoreTracks..'\nVERIFIED_SCENE_AUDIO_ITEMS: '..count..'\n')
file:write('STATUS: '..((scoreTracks==1 and count==12 and #errors==0) and 'PASS' or 'FAIL')..'\n')
for _,x in ipairs(errors)do file:write('ERROR: '..x..'\n')end
file:close()
