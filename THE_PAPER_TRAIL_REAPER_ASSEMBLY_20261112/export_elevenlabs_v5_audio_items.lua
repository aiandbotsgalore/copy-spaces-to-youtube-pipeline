-- Export all audible timeline media sources, sample offsets and fades from ElevenLabs v5.
-- This is a read-only conversion of REAPER's internal media placements for a preview render.
local self=debug.getinfo(1,'S').source:sub(2)
local folder=self:match('^(.*)[/\\]') or '.'
local project=folder..'\\THE_PAPER_TRAIL_ELEVENLABS_LOGAN_FULL_ASSEMBLY_v5.RPP'
if reaper.CountTracks(0)>0 then
 reaper.ShowMessageBox('Start from a new empty REAPER instance.','THE PAPER TRAIL',0)
 return
end
reaper.Main_openProject(project)
local path=folder..'\\ELEVENLABS_V5_ALL_AUDIO_MIX_ITEMS.tsv'
local f=assert(io.open(path,'w'))
f:write('track\ttrackname\tpos\tdur\tsource\tsoffs\trate\titem_vol\ttake_vol\ttrack_vol\tfadein\tfadeout\n')
local limit=4436.899
local count,skip,sourceerr=0,0,0
local names={}
for ti=0,reaper.CountTracks(0)-1 do
 local tr=reaper.GetTrack(0,ti)
 local _,name=reaper.GetSetMediaTrackInfo_String(tr,'P_NAME','',false)
 local mute=reaper.GetMediaTrackInfo_Value(tr,'B_MUTE')
 names[#names+1]=name..' (muted='..mute..')'
 if mute<.5 then
  for i=0,reaper.CountTrackMediaItems(tr)-1 do
   local item=reaper.GetTrackMediaItem(tr,i)
   local pos=reaper.GetMediaItemInfo_Value(item,'D_POSITION')
   local dur=reaper.GetMediaItemInfo_Value(item,'D_LENGTH')
   local imute=reaper.GetMediaItemInfo_Value(item,'B_MUTE')
   if pos<limit and pos+dur>0 and imute<.5 then
    local take=reaper.GetActiveTake(item)
    local src=take and reaper.GetMediaItemTake_Source(take)
    if src then
     local a,b=reaper.GetMediaSourceFileName(src,'')
     local file=type(b)=='string' and b or (type(a)=='string' and a or '')
     if file~='' then
      local vals={ti,name,pos,dur,file,
        reaper.GetMediaItemTakeInfo_Value(take,'D_STARTOFFS'),
        reaper.GetMediaItemTakeInfo_Value(take,'D_PLAYRATE'),
        reaper.GetMediaItemInfo_Value(item,'D_VOL'),
        reaper.GetMediaItemTakeInfo_Value(take,'D_VOL'),
        reaper.GetMediaTrackInfo_Value(tr,'D_VOL'),
        reaper.GetMediaItemInfo_Value(item,'D_FADEINLEN'),
        reaper.GetMediaItemInfo_Value(item,'D_FADEOUTLEN')}
      for k,v in ipairs(vals) do vals[k]=tostring(v):gsub('[\t\n\r]',' ')end
      f:write(table.concat(vals,'\t')..'\n')
      count=count+1
     else sourceerr=sourceerr+1 end
    else skip=skip+1 end
   end
  end
 end
end
f:close()
local log=assert(io.open(folder..'\\ELEVENLABS_V5_MIX_EXPORT_RESULT.txt','w'))
log:write('Project: '..project..'\n')
log:write('All audible items exported: '..count..'\n')
log:write('Empty editor/guide items: '..skip..'\n')
log:write('File path errors: '..sourceerr..'\n')
log:write('Final timeline duration: '..limit..'\n')
for _,name in ipairs(names) do log:write('TRACK '..name..'\n') end
log:close()
reaper.ShowConsoleMsg('REAPER source export completed: '..count..' audible items.\n')
