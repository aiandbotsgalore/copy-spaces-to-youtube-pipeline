-- THE PAPER TRAIL v6: FIX the inaudible and missing Suno narration scoring.
-- This does not change the ElevenLabs Logan voice or the authentic archive.
-- It mutes incorrectly attenuated/chopped score A/B/C from v5 and adds three
-- fully audible long-form Suno original instrumental stems with sentence/word-level automation.
local self=debug.getinfo(1,'S').source:sub(2)
local folder=self:match('^(.*)[/\\]') or '.'
local input=folder..'\\THE_PAPER_TRAIL_ELEVENLABS_LOGAN_FULL_ASSEMBLY_v5.RPP'
local output=folder..'\\THE_PAPER_TRAIL_ELEVENLABS_LOGAN_AUDIBLE_SUNO_SCORE_v6.RPP'
if reaper.CountTracks(0)>0 then
 reaper.ShowMessageBox('Open in a new empty REAPER instance. Original project will not be changed.','THE PAPER TRAIL',0)
 return
end
reaper.Main_openProject(input)
if reaper.CountTracks(0)<14 then
 reaper.ShowMessageBox('Could not load the full v5 project; no changes made.','THE PAPER TRAIL',0)
 return
end
local sources={
 {key='investigation',name='15  SUNO SCORE  |  INVESTIGATION (AUDIBLE WORD-SYNC V6)',
  filename='THE_PAPER_TRAIL_SUNO_INVESTIGATION_CONTINUOUS_WORD_SCORE_v6.flac',col={87,148,185}},
 {key='human',name='16  SUNO SCORE  |  TRUST AND HUMAN STORY (V6)',
  filename='THE_PAPER_TRAIL_SUNO_HUMAN_CONTINUOUS_WORD_SCORE_v6.flac',col={182,130,145}},
 {key='motif',name='17  SUNO SCORE  |  SIGNATURE WORD MOTIF (V6)',
  filename='THE_PAPER_TRAIL_SUNO_MOTIF_CONTINUOUS_WORD_SCORE_v6.flac',col={182,155,102}}
}
local muted=0
local oldscore={}
for ti=0,reaper.CountTracks(0)-1 do
 local tr=reaper.GetTrack(0,ti)
 local _,name=reaper.GetSetMediaTrackInfo_String(tr,'P_NAME','',false)
 if name:find('SUNO SCORE A',1,true) or name:find('SUNO SCORE B',1,true) or name:find('SUNO SCORE C',1,true) then
   oldscore[#oldscore+1]=tr
 end
end
if #oldscore~=3 then
 reaper.ShowMessageBox('Expected three superseded music tracks, found '..#oldscore..'. Aborting without edits.','THE PAPER TRAIL',0)
 return
end
local loaded=0;local bad={}
reaper.PreventUIRefresh(1)
reaper.Undo_BeginBlock()
for _,tr in ipairs(oldscore) do
 local _,name=reaper.GetSetMediaTrackInfo_String(tr,'P_NAME','',false)
 reaper.GetSetMediaTrackInfo_String(tr,'P_NAME',name..' [MUTED SUPERSEDED]',true)
 reaper.SetMediaTrackInfo_Value(tr,'B_MUTE',1)
 muted=muted+1
end
for i,s in ipairs(sources) do
 reaper.InsertTrackAtIndex(reaper.CountTracks(0),true)
 local tr=reaper.GetTrack(0,reaper.CountTracks(0)-1)
 reaper.GetSetMediaTrackInfo_String(tr,'P_NAME',s.name,true)
 local c=s.col
 reaper.SetTrackColor(tr,reaper.ColorToNative(c[1],c[2],c[3])|0x1000000)
 reaper.SetMediaTrackInfo_Value(tr,'D_VOL',1.0)
 local path=folder..'\\'..s.filename
 local src=reaper.PCM_Source_CreateFromFile(path)
 if not src then
  bad[#bad+1]=path
 else
  local length=4436.899
  local item=reaper.AddMediaItemToTrack(tr)
  reaper.SetMediaItemInfo_Value(item,'D_POSITION',0)
  reaper.SetMediaItemInfo_Value(item,'D_LENGTH',length)
  reaper.SetMediaItemInfo_Value(item,'B_LOOPSRC',0)
  local take=reaper.AddTakeToMediaItem(item)
  reaper.SetMediaItemTake_Source(take,src)
  reaper.SetMediaItemTakeInfo_Value(take,'D_VOL',1.0)
  reaper.GetSetMediaItemTakeInfo_String(take,'P_NAME',
     'CONTINUOUS SUNO '..s.key..' - aligned to all spoken words and scored sentences',true)
  reaper.GetSetMediaItemInfo_String(item,'P_NOTES',
   'A lossless instrumental score stem using an original previously downloaded Suno composition.\n'..
   'Full original soundtrack file: '..path..'\n'..
   'Source voices are NOT in this track. Voice is 100% ElevenLabs Logan.\n'..
   'Volume and instrumental changes are baked from word-by-word/ sentence-by-sentence timing analysis.\n'..
   'Automation report: THE_PAPER_TRAIL_WORD_SCORE_v6_AUTOMATION_REPORT.json\n'..
   'Use this track fader to fine-tune the score. Original Suno musical WAVs retained separately.',true)
  loaded=loaded+1
 end
end
reaper.GetSetProjectNotes(0,true,
 'THE PAPER TRAIL | FULL AUDIO ASSEMBLY v6 | AUDIBLE INSTRUMENTAL SCORE\n\n'..
 'VOICE: ElevenLabs existing user-owned cloned Logan; 233 of 233 passages.\n'..
 'MUSIC: Three original SUNO compositions rebuilt into continuous, audible instrumental scoring stems.\n'..
 'STORY: All 406 measured narration sentences and 5,756 spoken words influence orchestration / ducking.\n'..
 'PUNCTUATION/WORDS: Expression changes and words like friends, trust, paper trail, Sav trigger motifs.\n'..
 'SOURCE AUDIO: Original public archived recordings and witness voices; none synthesized or modified.\n'..
 'V5 PROBLEM: old music started 6m57s and was attenuated ~22dB below narrator; old items were repeatedly faded.\n'..
 'V6 FIX: begins scoring in opening seconds, continuous crossfaded instrumental source loops, adaptive gain envelopes and dynamic word response.\n'..
 'READING GAPS: 11 written-message performances still needed.\n'..
 'ARCHIVAL GAPS: AQ-0048, AQ-0220 missing, AQ-0233 and AQ-0222 candidate files decode to zero seconds.\n'..
 'THIS IS A PRODUCTION ROUGH CUT, not an approved final documentary release.\n'..
 'All prior v1-v5 REAPER projects and original media remain unchanged.')
reaper.AddProjectMarker2(0,false,0,0,'SCORE v6 START — MUSIC UNDER PROLOGUE',-1,reaper.ColorToNative(154,172,134)|0x1000000)
reaper.SetEditCurPos(0,false,false)
reaper.TrackList_AdjustWindows(false)
reaper.UpdateArrange()
reaper.Undo_EndBlock('Repair SUNO instrumental bed: audible continuous sentence/word-level scoring',-1)
reaper.Main_SaveProjectEx(0,output,8)
reaper.PreventUIRefresh(-1)
local f=io.open(folder..'\\REAPER_SUNO_SCORE_V6_RESULT.txt','w')
if f then
 f:write('THE PAPER TRAIL AUDIBLE SUNO INSTRUMENTAL SCORE v6\n')
 f:write('Saved: '..output..'\n')
 f:write('Continuous Suno FLAC stems inserted: '..loaded..'/3\n')
 f:write('Old weakly mixed Suno score tracks muted: '..muted..'/3\n')
 f:write('Missing new stem sources: '..#bad..'\n')
 for _,path in ipairs(bad) do f:write('MISSING '..path..'\n') end
 f:write('Voice unchanged: ElevenLabs Logan (GDqvTqQdsHV3ND6SiEZP)\n')
 f:write('Full project duration: 4436.899 seconds\n')
 f:write('Prior v1-v5 unaffected.\n')
 f:close()
end
reaper.ShowConsoleMsg('SUNO SCORE v6 saved: '..output..' | '..loaded..' continuous music stems; '..muted..' superseded tracks muted.\n')
