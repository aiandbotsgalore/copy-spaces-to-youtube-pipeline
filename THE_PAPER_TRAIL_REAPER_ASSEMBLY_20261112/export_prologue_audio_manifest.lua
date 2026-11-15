-- Export a source-accurate list of all audible items in the completed Prologue draft.
-- Uses REAPER's own media-source paths and item parameters. Does not alter the project.
local script=debug.getinfo(1,'S').source:sub(2)
local folder=script:match('^(.*)[/\\]') or '.'
local proj=folder..'\\THE_PAPER_TRAIL_PROLOGUE_COMPLETE_DRAFT_v4.RPP'
if reaper.CountTracks(0)>0 then
 reaper.ShowMessageBox('Please launch from a new empty REAPER instance.','THE PAPER TRAIL',0)
 return
end
reaper.Main_openProject(proj)
local f=io.open(folder..'\\PROLOGUE_AUDIO_MIX_ITEM_MANIFEST.tsv','w')
if not f then
 reaper.ShowMessageBox('Cannot write Prologue mix manifest.','THE PAPER TRAIL',0)
 return
end
f:write('track\ttrackname\tpos\tdur\tsource\tsoffs\trate\titem_vol\ttake_vol\ttrack_vol\tfadein\tfadeout\n')
local n,empty,skipped=0,0,0
local stop=523.982
for ti=0,reaper.CountTracks(0)-1 do
 local tr=reaper.GetTrack(0,ti)
 local _,name=reaper.GetSetMediaTrackInfo_String(tr,'P_NAME','',false)
 local muted=reaper.GetMediaTrackInfo_Value(tr,'B_MUTE')
 if muted<.5 then
  for i=0,reaper.CountTrackMediaItems(tr)-1 do
   local item=reaper.GetTrackMediaItem(tr,i)
   local pos=reaper.GetMediaItemInfo_Value(item,'D_POSITION')
   local dur=reaper.GetMediaItemInfo_Value(item,'D_LENGTH')
   local imuted=reaper.GetMediaItemInfo_Value(item,'B_MUTE')
   if pos<stop and pos+dur>0 and imuted<.5 then
    local take=reaper.GetActiveTake(item)
    if take then
     local src=reaper.GetMediaItemTake_Source(take)
     if src then
      local rv,fn=reaper.GetMediaSourceFileName(src,'')
      local path=type(fn)=='string' and fn or (type(rv)=='string' and rv or '')
      if path~='' then
       local vals={ti,name,pos,dur,path,reaper.GetMediaItemTakeInfo_Value(take,'D_STARTOFFS'),
         reaper.GetMediaItemTakeInfo_Value(take,'D_PLAYRATE'),
         reaper.GetMediaItemInfo_Value(item,'D_VOL'),
         reaper.GetMediaItemTakeInfo_Value(take,'D_VOL'),
         reaper.GetMediaTrackInfo_Value(tr,'D_VOL'),
         reaper.GetMediaItemInfo_Value(item,'D_FADEINLEN'),
         reaper.GetMediaItemInfo_Value(item,'D_FADEOUTLEN')}
       for j,v in ipairs(vals)do vals[j]=tostring(v):gsub('[\t\n\r]',' ')end
       f:write(table.concat(vals,'\t')..'\n')
       n=n+1
      else empty=empty+1 end
     else empty=empty+1 end
    else skipped=skipped+1 end
   end
  end
 end
end
f:close()
local log=io.open(folder..'\\PROLOGUE_MIX_EXPORT_RESULT.txt','w')
if log then log:write('REAPER PROJECT: '..proj..'\nITEMS EXPORTED: '..n..'\nEMPTY: '..empty..'\nSKIPPED: '..skipped..'\nLENGTH: '..stop..'\n'); log:close()end
reaper.ShowConsoleMsg('PROLOGUE MIX MANIFEST: '..n..' audio media placements exported.\n')
