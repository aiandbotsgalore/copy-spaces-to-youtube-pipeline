from pathlib import Path
p=Path(__file__).resolve().parent
source=(p/'cut_spoken_aq_labels_and_show_suno_v7.lua').read_text(encoding='utf-8')
wrapper="""local debugpath=[==["""+str(p/'V7_DEBUG_EXECUTION.txt')+"""]==]
local trace=io.open(debugpath,'w')
if trace then trace:write('V7 LUA START\\n');trace:flush() end
local ok,err=xpcall(function()
"""+source+"""
end,debug.traceback)
local log=io.open(debugpath,'a')
if log then log:write('\\nLUA FINISHED ok='..tostring(ok)..'\\n'..tostring(err)..'\\n');log:close()end
if trace then trace:close()end
"""
(p/'cut_spoken_aq_labels_and_show_suno_v7_debug.lua').write_text(wrapper,encoding='utf-8')
print('DEBUG SCRIPT',len(wrapper))
