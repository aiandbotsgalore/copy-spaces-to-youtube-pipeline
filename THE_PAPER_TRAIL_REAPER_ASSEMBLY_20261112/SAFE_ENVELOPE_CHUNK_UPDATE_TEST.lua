-- Safely test REAPER envelope state-chunk replacement, then immediately restore original.
local self=debug.getinfo(1,'S').source:sub(2)
local folder=self:match('^(.*)[/\\]') or '.'
local output=folder..'\\SCORE_SCENES_20261113\\ENVELOPE_CHUNK_UPDATE_TEST.txt'
local function report(msg)
 local f=io.open(output,'w')
 if f then f:write(msg);f:close()end
end
local _,path=reaper.EnumProjects(-1,'')
if not path:find('THE_PAPER_TRAIL_LOGAN_LABELS_REMOVED_SUNO_VISIBLE_v7.RPP',1,true) then report('WRONG PROJECT');return end
local tr=reaper.GetTrack(0,2)
local env=reaper.GetTrackEnvelopeByName(tr,'Volume')
if not env then report('NO ENVELOPE');return end
local before_n=reaper.CountEnvelopePoints(env)
local ok,chunk=reaper.GetEnvelopeStateChunk(env,'',false)
if not ok or not chunk or before_n~=495 then report('PRECHECK FAILED '..tostring(before_n));return end
local a=chunk:find('\nPT ',1,true)
if not a or not chunk:match('\n>%s*$') or chunk:find('\n<AI',1,true) then report('UNEXPECTED CHUNK SHAPE');return end
local prefix=chunk:sub(1,a)
local modified=prefix..'\nPT 0 0.5 0\nPT 10 0.65 0\nPT 4423.8 0.55 0\n>\n'
local applied=reaper.SetEnvelopeStateChunk(env,modified,false)
local after_n=reaper.CountEnvelopePoints(env)
local restored=reaper.SetEnvelopeStateChunk(env,chunk,false)
local restored_n=reaper.CountEnvelopePoints(env)
local _,ver=reaper.GetEnvelopeStateChunk(env,'',false)
local exact=(ver==chunk)
reaper.UpdateArrange()
report('SAFE IN-MEMORY CHUNK-REPLACEMENT TEST:\n'..
 'ORIGINAL POINT COUNT '..before_n..'\n'..
 'CHANGE API RETURN '..tostring(applied)..'\n'..
 'TEMPORARY POINT COUNT '..after_n..'\n'..
 'RESTORE API RETURN '..tostring(restored)..'\n'..
 'RESTORED POINT COUNT '..restored_n..'\n'..
 'ORIGINAL ENVELOPE BYTES EXACTLY RESTORED '..tostring(exact)..'\n'..
 'NO PROJECT SAVE WAS MADE.\n')
