local src=debug.getinfo(1,'S').source:sub(2)
local folder=src:match('^(.*)[/\\]')..'\\'
reaper.Main_openProject(folder..'THE_PAPER_TRAIL_LOGAN_LABELS_REMOVED_SUNO_VISIBLE_v7.RPP')
local f=assert(io.open(folder..'THE_PAPER_TRAIL_V7_SCENE_MARKERS.tsv','w'))
f:write('id\tis_region\tposition\tend_position\tname\n')
local ix=0;local n=0
while true do
 local ok,reg,pos,fin,name,id=reaper.EnumProjectMarkers3(0,ix)
 if ok==0 then break end
 f:write(id..'\t'..(reg and 1 or 0)..'\t'..pos..'\t'..fin..'\t'..(name or ''):gsub('[\t\n\r]',' ')..'\n')
 ix=ix+1;n=n+1
end
f:close()
reaper.ShowConsoleMsg('Scene/word markers exported: '..n..'\n')
