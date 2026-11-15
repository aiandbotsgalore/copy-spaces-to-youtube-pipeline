local base=debug.getinfo(1,'S').source:sub(2):match('^(.*)[/\\]')..'\\'
local proj=base..'THE_PAPER_TRAIL_ELEVENLABS_LOGAN_AUDIBLE_SUNO_SCORE_v6.RPP'
local log=base..'V6_TRACKS_AND_SOURCE_TIMING_AUDIT.tsv'
reaper.Main_openProject(proj)
local f=assert(io.open(log,'w'))
f:write('TYPE\tTRACK\tNAME\tT_POS\tDUR\tOFFSET\tVOLUME\tMUTED\tSOURCE\n')
for ti=0,reaper.CountTracks(0)-1 do
 local tr=reaper.GetTrack(0,ti)
 local _,name=reaper.GetSetMediaTrackInfo_String(tr,'P_NAME','',false)
 local muted=reaper.GetMediaTrackInfo_Value(tr,'B_MUTE')
 local vol=reaper.GetMediaTrackInfo_Value(tr,'D_VOL')
 f:write(table.concat({'TRACK',tostring(ti),name,'0','0','0',tostring(vol),tostring(muted),''},'\t')..'\n')
 for i=0,reaper.CountTrackMediaItems(tr)-1 do
  local item=reaper.GetTrackMediaItem(tr,i)
  local take=reaper.GetActiveTake(item)
  if take then
   local _,nm=reaper.GetSetMediaItemTakeInfo_String(take,'P_NAME','',false)
   if nm:find('LOGAN ELEVENLABS',1,true) and nm:find('CUE 5',1,true) or
      nm:find('LOGAN ELEVENLABS',1,true) and nm:find('CUE 6',1,true) or
      nm:find('CONTINUOUS SUNO',1,true) then
    local src=reaper.GetMediaItemTake_Source(take)
    local _,path=reaper.GetMediaSourceFileName(src,'')
    f:write(table.concat({'ITEM',tostring(ti),nm,tostring(reaper.GetMediaItemInfo_Value(item,'D_POSITION')),
      tostring(reaper.GetMediaItemInfo_Value(item,'D_LENGTH')),tostring(reaper.GetMediaItemTakeInfo_Value(take,'D_STARTOFFS')),
      tostring(reaper.GetMediaItemTakeInfo_Value(take,'D_VOL')),tostring(reaper.GetMediaItemInfo_Value(item,'B_MUTE')),path or ''},'\t')..'\n')
   end
  end
 end
end
f:close()
reaper.ShowConsoleMsg('V6 read-only audit saved: '..log..'\n')
