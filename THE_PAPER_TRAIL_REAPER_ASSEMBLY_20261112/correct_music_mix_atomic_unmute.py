from pathlib import Path
p=Path(__file__).resolve().parent/'FINAL_APPLY_CORRECTED_SCORE_AUTOMATION_INPLACE.lua'
s=p.read_text(encoding='utf-8')
old="reaper.GetMediaTrackInfo_Value(narrator,'B_MUTE')>.5 or reaper.GetMediaTrackInfo_Value(guide,'B_MUTE')<.5 then"
new="reaper.GetMediaTrackInfo_Value(guide,'B_MUTE')<.5 then"
if old not in s:raise RuntimeError('preflight anchor missing')
s=s.replace(old,new,1)
old=" reaper.Undo_DoUndo2(0)\n reaper.PreventUIRefresh(-1)"
new=" -- The prior user-visible narration unmute must NEVER be undone when a music edit fails.\n -- The actual four source envelopes have already been restored above.\n reaper.PreventUIRefresh(-1)"
if old not in s:raise RuntimeError('undo anchor missing')
s=s.replace(old,new,1)
old="reaper.UpdateArrange()\nreaper.Undo_EndBlock('Refine the ORIGINAL Suno score"
new="reaper.SetMediaTrackInfo_Value(narrator,'B_MUTE',0)\nreaper.UpdateArrange()\nreaper.Undo_EndBlock('Refine the ORIGINAL Suno score"
if old not in s:raise RuntimeError('commit anchor missing')
s=s.replace(old,new,1)
s=s.replace("'Narrator Logan unmuted, 237 speaking items retained. All original audio files unchanged.',","'Narrator Logan explicitly unmuted in THIS same successful commit; 237 speaking items retained. All original audio files unchanged.',")
p.write_text(s,encoding='utf-8')
print('ATOMIC FULL MIX+VOICE COMMIT PREPARED. NO REAPER FILE VERSIONING.')
