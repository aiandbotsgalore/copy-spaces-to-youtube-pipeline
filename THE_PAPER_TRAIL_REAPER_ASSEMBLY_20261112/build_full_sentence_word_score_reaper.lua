-- THE PAPER TRAIL: entire manuscript scene, sentence, word scoring production map.
-- Non-destructive: opens v1 and saves separate v2. All key verbal timings currently
-- estimated from v1 narration guides until final spoken recordings are selected.
local src=debug.getinfo(1,'S').source:sub(2)
local folder=src:match('^(.*)[/\\]') or '.'
local original=folder..'\\THE_PAPER_TRAIL_ASSEMBLY_v1.RPP'
local target=folder..'\\THE_PAPER_TRAIL_FULL_SENTENCE_WORD_SCORE_v2.RPP'
if reaper.CountTracks(0)>0 then
 reaper.ShowMessageBox('Run from a new empty REAPER instance to avoid touching your open project.','THE PAPER TRAIL',0)
 return
end
local data=dofile(folder..'\\FULL_EPISODE_SENTENCE_WORD_SCORE_DATA.lua')
reaper.Main_openProject(original)
if reaper.CountTracks(0)<8 then
 reaper.ShowMessageBox('Original v1 project failed to load. No changes made.','THE PAPER TRAIL',0)
 return
end
local function color(r,g,b)return reaper.ColorToNative(r,g,b) | 0x1000000 end
local specs={
 {key='motif',name='09   SUNO SCORE A  |  SIGNATURE MOTIF',col=color(138,161,111)},
 {key='investigation',name='10   SUNO SCORE B  |  INVESTIGATIVE TENSION',col=color(90,131,171)},
 {key='human',name='11   SUNO SCORE C  |  TRUST / HUMAN STORY',col=color(176,137,145)},
 {key='word',name='12   WORD-LEVEL  |  MOTIF HITS + MICRO-FX',col=color(181,139,79)},
 {key='map',name='13   EVERY SENTENCE  |  EDITOR NOTES / VOICE TIMING',col=color(91,104,112)}
}
local tr={}
reaper.PreventUIRefresh(1)
reaper.Undo_BeginBlock()
for i,spec in ipairs(specs) do
 reaper.InsertTrackAtIndex(8+i-1,true)
 local track=reaper.GetTrack(0,8+i-1)
 tr[spec.key]=track
 reaper.GetSetMediaTrackInfo_String(track,'P_NAME',spec.name,true)
 reaper.SetTrackColor(track,spec.col)
end
-- Suppress the superseded scratch theme cue only, retain original source audio on disk.
local old_music=reaper.GetTrack(0,4)
local muted_scratch=0
for i=0,reaper.CountTrackMediaItems(old_music)-1 do
 local it=reaper.GetTrackMediaItem(old_music,i)
 local tk=reaper.GetActiveTake(it)
 if tk then
  local _,nm=reaper.GetSetMediaItemTakeInfo_String(tk,'P_NAME','',false)
  if nm:find('MUSIC 06',1,true) then
    reaper.SetMediaItemInfo_Value(it,'B_MUTE',1)
    muted_scratch=muted_scratch+1
  end
 end
end
local loaded,failed,sentence_guide=0,0,0
local function add_audio(track,iteminfo,isfx)
 local item=reaper.AddMediaItemToTrack(track)
 reaper.SetMediaItemInfo_Value(item,'D_POSITION',iteminfo.pos)
 reaper.SetMediaItemInfo_Value(item,'D_LENGTH',iteminfo.dur)
 reaper.SetMediaItemInfo_Value(item,'B_LOOPSRC',0)
 reaper.SetMediaItemInfo_Value(item,'D_FADEINLEN',iteminfo.fadein or (isfx and .006 or .22))
 reaper.SetMediaItemInfo_Value(item,'D_FADEOUTLEN',iteminfo.fadeout or (isfx and .07 or .22))
 local take=reaper.AddTakeToMediaItem(item)
 local pcm=reaper.PCM_Source_CreateFromFile(iteminfo.source)
 if not pcm then
  failed=failed+1
  reaper.GetSetMediaItemInfo_String(item,'P_NOTES','MISSING AUDIO: '..iteminfo.source,true)
 else
  loaded=loaded+1
  reaper.SetMediaItemTake_Source(take,pcm)
  reaper.SetMediaItemTakeInfo_Value(take,'D_STARTOFFS',iteminfo.offset or 0)
  reaper.SetMediaItemTakeInfo_Value(take,'D_VOL',iteminfo.gain or .1)
 end
 reaper.GetSetMediaItemTakeInfo_String(take,'P_NAME',iteminfo.name or 'Precision-scored segment',true)
 reaper.GetSetMediaItemInfo_String(item,'P_NOTES',(iteminfo.note or iteminfo.name or '')..
 '\nPRECISE AUDIO SOURCE: '..iteminfo.source..
 '\nTIMING: PROVISIONAL against draft narrator guide; re-time after actual word-alignment.',true)
end
for _,x in ipairs(data.music) do
 add_audio(tr[x.kind] or tr.investigation,x,false)
end
for _,x in ipairs(data.fx) do
 add_audio(tr.word,x,true)
 if x.name:find('WORD CUE',1,true) then
  reaper.AddProjectMarker2(0,false,x.pos,0,x.name,-1,color(186,149,91))
 end
end
for _,s in ipairs(data.sentences) do
 local len=math.max(.07,s['end']-s.start)
 local item=reaper.AddMediaItemToTrack(tr.map)
 reaper.SetMediaItemInfo_Value(item,'D_POSITION',s.start)
 reaper.SetMediaItemInfo_Value(item,'D_LENGTH',len)
 reaper.SetMediaItemInfo_Value(item,'B_LOOPSRC',0)
 local take=reaper.AddTakeToMediaItem(item)
 reaper.GetSetMediaItemTakeInfo_String(take,'P_NAME',
   'SENTENCE '..s.cue_index..'.'..s.sentence_index..' | '..s.bed..' | '..s.text:sub(1,65),true)
 reaper.GetSetMediaItemInfo_String(item,'P_NOTES',
   'Spoken sentence:\n'..s.text..
   '\n\nScore decision: '..s.decision..
   '\nMusical bed: '..s.bed..' at gain '..s.gain..
   '\nAct/scene: '..s.section..
   '\nTiming: rough source guide, not final alignment. Update from performed narrator clip.',true)
 sentence_guide=sentence_guide+1
end
-- Make notes track non-audible, not media. Keep item labels navigable.
reaper.SetMediaTrackInfo_Value(tr.map,'B_MUTE',1)
reaper.GetSetProjectNotes(0,true,
 'THE PAPER TRAIL - FULL SENTENCE AND WORD SCORING EDIT\\n'..
 'Source: original v1 assembly + three user-owned original Suno WAV scores.\\n'..
 'Every narration sentence has an explicit score decision and editorial guide.\\n'..
 'Every spoken word has a provisional timestamp and action in FULL_EPISODE_SENTENCE_WORD_CUE_MAP.json.\\n'..
 'Sensitive moments deliberately scored as silence; raw archival audio remains dry.\\n'..
 'All vocal timings are PROVISIONAL until correct custom voice recordings are auditioned, downloaded and aligned.\\n'..
 'Three original score recordings were imported; no source WAV or v1 project overwritten.\\n'..
 'The two missing archival sources AQ-0048 and AQ-0220 are not fabricated.\\n'..
 'THIS IS NOT A FINAL PODCAST MASTER. Review all words, attribution, archival trims and mix before release.'
)
reaper.TrackList_AdjustWindows(false)
reaper.UpdateArrange()
reaper.SetEditCurPos(0,false,false)
reaper.Undo_EndBlock('Full-episode sentence/word sound design map with actual Suno score tracks',-1)
reaper.Main_SaveProjectEx(0,target,8)
reaper.PreventUIRefresh(-1)
local f=io.open(folder..'\\REAPER_FULL_SENTENCE_WORD_SCORE_RESULT.txt','w')
if f then
 f:write('THE PAPER TRAIL Full Sentence + Word Sound Design v2\n')
 f:write('Saved project: '..target..'\n')
 f:write('Original v1 unchanged: '..original..'\n')
 f:write('Original 8 tracks preserved. Five new scoring/editor tracks added.\n')
 f:write('Sentence editorial decisions: '..sentence_guide..'\n')
 f:write('Music score items: '..#data.music..'\n')
 f:write('Word/scene sound cues: '..#data.fx..'\n')
 f:write('Actual Suno music/sfx items loaded: '..loaded..'\n')
 f:write('Audio source load failures: '..failed..'\n')
 f:write('Old scratch music items muted: '..muted_scratch..'\n')
 f:write('Word-by-word map: FULL_EPISODE_SENTENCE_WORD_CUE_MAP.json\n')
 f:write('Music / word timings pending final performed narration.\n')
 f:close()
end
reaper.ShowConsoleMsg('FULL SCORE SAVED: '..target..'\n'..loaded..' music/sound items; '..sentence_guide..' scored sentence guides; '..failed..' audio failures\n')
