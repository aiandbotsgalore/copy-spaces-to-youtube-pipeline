-- Read-only musical balance and dialogue audit of the single running Paper Trail project.
local self=debug.getinfo(1,'S').source:sub(2)
local folder=self:match('^(.*)[/\\]') or '.'
local expected=folder..'\\THE_PAPER_TRAIL_LOGAN_LABELS_REMOVED_SUNO_VISIBLE_v7.RPP'
local _,active=reaper.EnumProjects(-1,'')
if active:lower()~=expected:lower() then
 local f=io.open(folder..'\\SCORE_SCENES_20261113\\MUSIC_REFINEMENT_AUDIT_ERROR.txt','w')
 if f then f:write('Wrong active project '..active);f:close()end
 return
end
local f=assert(io.open(folder..'\\SCORE_SCENES_20261113\\MUSIC_REFINEMENT_FULL_ITEM_AUDIT.tsv','w'))
f:write('trackno\ttrack\ttrackvol\ttrackmute\ttrackpan\ti\tstart\tend\tlength\titemvol\titemmute\ttakevol\trate\toffset\tfadein\tfadeout\tname\tsource\n')
local trackcounts={}
for t=0,reaper.CountTracks(0)-1 do
 local tr=reaper.GetTrack(0,t)
 local _,tn=reaper.GetSetMediaTrackInfo_String(tr,'P_NAME','',false)
 local trackvol=reaper.GetMediaTrackInfo_Value(tr,'D_VOL')
 local trackmute=reaper.GetMediaTrackInfo_Value(tr,'B_MUTE')
 local trackpan=reaper.GetMediaTrackInfo_Value(tr,'D_PAN')
 for i=0,reaper.CountTrackMediaItems(tr)-1 do
  local item=reaper.GetTrackMediaItem(tr,i)
  local take=reaper.GetActiveTake(item)
  local p=reaper.GetMediaItemInfo_Value(item,'D_POSITION')
  local length=reaper.GetMediaItemInfo_Value(item,'D_LENGTH')
  local name,src,rate,offset,takevol='', '',1,0,1
  if take then
   local _,nm=reaper.GetSetMediaItemTakeInfo_String(take,'P_NAME','',false)
   name=nm or ''
   local s=reaper.GetMediaItemTake_Source(take)
   local a,b=reaper.GetMediaSourceFileName(s,''); local path=type(b)=='string' and b or (type(a)=='string' and a or '')
   src=path or ''
   takevol=reaper.GetMediaItemTakeInfo_Value(take,'D_VOL')
   offset=reaper.GetMediaItemTakeInfo_Value(take,'D_STARTOFFS')
   rate=reaper.GetMediaItemTakeInfo_Value(take,'D_PLAYRATE')
  end
  local vals={t,tn,trackvol,trackmute,trackpan,i,p,p+length,length,
    reaper.GetMediaItemInfo_Value(item,'D_VOL'),reaper.GetMediaItemInfo_Value(item,'B_MUTE'),
    takevol,rate,offset,
    reaper.GetMediaItemInfo_Value(item,'D_FADEINLEN'),reaper.GetMediaItemInfo_Value(item,'D_FADEOUTLEN'),
    name,src}
  for j,v in ipairs(vals)do vals[j]=tostring(v):gsub('[\r\n\t]',' ')end
  f:write(table.concat(vals,'\t')..'\n')
 end
 trackcounts[#trackcounts+1]=tostring(t)..'|'..tn..'|'..reaper.CountTrackMediaItems(tr)
end
f:close()
local g=assert(io.open(folder..'\\SCORE_SCENES_20261113\\MUSIC_REFINEMENT_MARKERS.tsv','w'))
g:write('id\tisregion\tpos\tfinish\tname\n')
local idx=0
while true do
 local found,isrgn,pos,fin,name,id=reaper.EnumProjectMarkers3(0,idx)
 if found==0 then break end
 g:write(id..'\t'..(isrgn and '1' or '0')..'\t'..pos..'\t'..fin..'\t'..tostring(name):gsub('[\r\n\t]',' ')..'\n')
 idx=idx+1
end
g:close()
local summary=assert(io.open(folder..'\\SCORE_SCENES_20261113\\MUSIC_REFINEMENT_AUDIT_SUMMARY.txt','w'))
summary:write('PROJECT '..active..'\n')
summary:write('TRACK COUNT '..reaper.CountTracks(0)..'\n')
summary:write(table.concat(trackcounts,'\n')..'\n')
summary:close()

