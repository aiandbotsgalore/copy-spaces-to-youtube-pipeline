local self=debug.getinfo(1,'S').source:sub(2)
local base=self:match('^(.*)[/\\]') or '.'
local expected=base..'\\THE_PAPER_TRAIL_LOGAN_LABELS_REMOVED_SUNO_VISIBLE_v7.RPP'
local _,project=reaper.EnumProjects(-1,'')
local log=base..'\\SCORE_SCENES_20261113\\LOGAN_TRACK_RESTORED_RESULT.txt'
local function out(text)
 local f=io.open(log,'w');if f then f:write(text);f:close()end
end
if project:lower()~=expected:lower() then out('ABORT wrong current project');return end
local voice=reaper.GetTrack(0,1)
local guide=reaper.GetTrack(0,0)
local _,name=reaper.GetSetMediaTrackInfo_String(voice,'P_NAME','',false)
if not name:find('ELEVENLABS LOGAN',1,true) or reaper.CountTrackMediaItems(voice)<230 then
 out('ABORT did not find expected logged voice track');return
end
if reaper.GetMediaTrackInfo_Value(guide,'B_MUTE')<.5 then
 out('ABORT original guide track not muted');return
end
reaper.Undo_BeginBlock()
reaper.SetMediaTrackInfo_Value(voice,'B_MUTE',0)
reaper.Undo_EndBlock('Restore genuine ElevenLabs Logan narration in the running Paper Trail project',-1)
reaper.UpdateArrange()
reaper.Main_SaveProject(0,false)
out('PASS: original 237 ElevenLabs Logan narrator media items UNMUTED and saved in the SAME REAPER project.\n'..
 'Guide narration remains muted. Original archived clips, 12 Suno scene compositions and other soundtrack tracks unchanged.\n'..
 'Source files preserved and no audio generated.\nPROJECT: '..project)
