from pathlib import Path
p=Path(__file__).resolve().parent/'cut_spoken_aq_labels_and_show_suno_v7.lua'
s=p.read_text(encoding='utf-8')
needle="reaper.PreventUIRefresh(1)\nreaper.Undo_BeginBlock()"
replacement="reaper.Main_OnCommand(40309,0) -- set ripple editing OFF for deterministic surgery\nlocal rippleOffState=reaper.GetToggleCommandState(40309)\nreaper.PreventUIRefresh(1)\nreaper.Undo_BeginBlock()"
if needle not in s:raise RuntimeError('cannot patch')
s=s.replace(needle,replacement,1)
s=s.replace("cutlog:write('Total source duration excised: '..total_removed..'\\n')","cutlog:write('Ripple off toggle state: '..rippleOffState..'\\n')\n cutlog:write('Total source duration excised: '..total_removed..'\\n')")
p.write_text(s,encoding='utf-8')
print('PATCHED RIPPLE OFF COMMAND',len(s))
