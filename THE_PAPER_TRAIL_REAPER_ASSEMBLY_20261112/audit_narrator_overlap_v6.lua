local file=debug.getinfo(1,'S').source:sub(2)
local folder=file:match('^(.*)[/\\]')..'\\'
reaper.Main_openProject(folder..'THE_PAPER_TRAIL_ELEVENLABS_LOGAN_AUDIBLE_SUNO_SCORE_v6.RPP')
local f=assert(io.open(folder..'V6_NARRATOR_500_TO_590_AUDIT.tsv','w'))
f:write('TRACK\tP\tEND\tOFFS\tNAME\tSOURCE\n')
local cuts={{531.784,534.219},{545.804,548.564},{555.373,560.273},{565.213,568.148}}
for ti=0,reaper.CountTracks(0)-1 do
 local tr=reaper.GetTrack(0,ti)
 local _,trname=reaper.GetSetMediaTrackInfo_String(tr,'P_NAME','',false)
 for i=0,reaper.CountTrackMediaItems(tr)-1 do
  local it=reaper.GetTrackMediaItem(tr,i)
  local p=reaper.GetMediaItemInfo_Value(it,'D_POSITION')
  local fin=p+reaper.GetMediaItemInfo_Value(it,'D_LENGTH')
  if fin>505 and p<583 then
   local take=reaper.GetActiveTake(it)
   local _,nm=take and reaper.GetSetMediaItemTakeInfo_String(take,'P_NAME','',false)
   local off=take and reaper.GetMediaItemTakeInfo_Value(take,'D_STARTOFFS') or 0
   local count=0
   for _,c in ipairs(cuts)do if p<c[2] and fin>c[1] then count=count+1 end end
   if ti==1 or count>0 then
    f:write(table.concat({tostring(ti),tostring(p),tostring(fin),tostring(off),
    (nm or ''):gsub('[\t\n]',' '),trname..' (CUT OVERLAP '..count..')'},'\t')..'\n')
   end
  end
 end
end
f:close()
