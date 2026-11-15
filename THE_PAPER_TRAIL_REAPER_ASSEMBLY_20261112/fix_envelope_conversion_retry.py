from pathlib import Path
p=Path(__file__).resolve().parent/'FINAL_APPLY_CORRECTED_SCORE_AUTOMATION_INPLACE.lua'
s=p.read_text(encoding='utf-8')
old="points[#points+1]=string.format('PT %.3f %.5f 0',t,reaper.ScaleToEnvelopeMode(mode,linear))"
new="points[#points+1]=string.format('PT %.3f %.5f 0',t,linear)"
if old not in s:raise RuntimeError('expected scale line not found')
s=s.replace(old,new)
start=s.index("local test=io.open(backup,'rb')")
stop=s.index("reaper.PreventUIRefresh(1)",start)
newblock=r"""local existing_backup=io.open(backup,'rb')
local validBackup=false
if existing_backup then
 local n=existing_backup:seek('end')
 existing_backup:close()
 if n<150000 then
  log('ABORT: existing backup invalid. Protecting current project.')
  return
 end
 validBackup=true
end
-- If a validated backup from this exact safe retry already exists, reuse it.
-- Do not create duplicate/competing project files.
reaper.Main_SaveProject(0,false)
if not validBackup then
 local reader=io.open(expected,'rb')
 local writer=io.open(backup,'wb')
 if not reader or not writer then
  if reader then reader:close() end
  if writer then writer:close() end
  log('ABORT: unable to create private backup. No changes to music.')
  return
 end
 local nbytes=0
 while true do
  local buffer=reader:read(65536)
  if not buffer then break end
  writer:write(buffer)
  nbytes=nbytes+#buffer
 end
 reader:close();writer:close()
 if nbytes<150000 then log('ABORT: backup length invalid.');return end
end
"""
s=s[:start]+newblock+s[stop:]
p.write_text(s,encoding='utf-8')
print('CORRECTED TO RAW LINEAR PT CHUNK VALUES AND REUSE VERIFIED RECOVERY BACKUP',len(s))
