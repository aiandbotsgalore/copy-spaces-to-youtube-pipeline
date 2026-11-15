-- THE PAPER TRAIL - final-pass editable music/voice assembly v5.
-- Voice: user's ElevenLabs cloned "Logan", 17 generated audio batches, 233 timed narration passages.
-- Original v1/v2/v3/v4 projects and archive files are unchanged.
local script=debug.getinfo(1,"S").source:sub(2)
local folder=script:match("^(.*)[/\\]") or "."
local original=folder.."\\THE_PAPER_TRAIL_FULL_SENTENCE_WORD_SCORE_v2.RPP"
local target=folder.."\\THE_PAPER_TRAIL_ELEVENLABS_LOGAN_FULL_ASSEMBLY_v5.RPP"
if reaper.CountTracks(0)>0 then
 reaper.ShowMessageBox("Run from a new empty REAPER instance; existing work will not be overwritten.","THE PAPER TRAIL",0)
 return
end
local data=dofile(folder.."\\ELEVENLABS_V5_REAPER_DATA.lua")
reaper.Main_openProject(original)
if reaper.CountTracks(0)<13 then
 reaper.ShowMessageBox("Expected 13-track full score v2 did not load. No changes made.","THE PAPER TRAIL",0)
 return
end
local adjustments=data.segments
table.sort(adjustments,function(x,y) return x.old_pos<y.old_pos end)
local function warp(t)
 local shift=0
 for _,x in ipairs(adjustments) do
  if t<x.old_pos then break end
  if t<x.old_pos+x.old_dur then
   return t+shift+(t-x.old_pos)*(x.duration/x.old_dur-1)
  end
  shift=shift+x.duration-x.old_dur
 end
 return t+shift
end
local sentence_lookup={}
for _,s in ipairs(data.sentences) do
 sentence_lookup[tostring(s.cue_index).."."..tostring(s.sentence_index)]=s
end
local hits={}
for _,x in ipairs(data.word_hits) do
 local key=tostring(math.floor(x.old_pos*1000+.5)).."|"..x.name
 hits[key]=x.new_pos
end
local function clamp(v,a,b)return math.max(a,math.min(b,v))end
reaper.PreventUIRefresh(1)
reaper.Undo_BeginBlock()
local moved,snapped_sentences,snapped_words=0,0,0
for ti=0,reaper.CountTracks(0)-1 do
 local track=reaper.GetTrack(0,ti)
 local _,trname=reaper.GetSetMediaTrackInfo_String(track,"P_NAME","",false)
 for i=0,reaper.CountTrackMediaItems(track)-1 do
  local item=reaper.GetTrackMediaItem(track,i)
  local p=reaper.GetMediaItemInfo_Value(item,"D_POSITION")
  local dur=reaper.GetMediaItemInfo_Value(item,"D_LENGTH")
  local np=warp(p)
  local ne=warp(p+dur)
  local take=reaper.GetActiveTake(item)
  if take then
   local _,nm=reaper.GetSetMediaItemTakeInfo_String(take,"P_NAME","",false)
   -- Within a scored sentence, use actual spoken start/end rather than rough guide timing.
   local ci,si=nm:match("^SENTENCE SCORE (%d+)%.(%d+)")
   if ci and si then
    local s=sentence_lookup[ci.."."..si]
    if s and s.old_end>s.old_start and s.new_end>s.new_start then
     local ratio0=clamp((p-s.old_start)/(s.old_end-s.old_start),0,1)
     local ratio1=clamp((p+dur-s.old_start)/(s.old_end-s.old_start),0,1)
     np=s.new_start+ratio0*(s.new_end-s.new_start)
     ne=s.new_start+ratio1*(s.new_end-s.new_start)
     snapped_sentences=snapped_sentences+1
    end
   elseif nm:find("WORD CUE:",1,true) then
    local key=tostring(math.floor(p*1000+.5)).."|"..nm
    if hits[key] then
      np=hits[key]
      ne=np+math.max(.08,ne-warp(p))
      snapped_words=snapped_words+1
    end
   end
  end
  reaper.SetMediaItemInfo_Value(item,"D_POSITION",np)
  reaper.SetMediaItemInfo_Value(item,"D_LENGTH",math.max(.065,ne-np))
  moved=moved+1
 end
end
-- Keep original chapter and scene markers alongside the new spoken duration.
local marks={}
local idx=0
while true do
 local ok,isrgn,p,last,name,id,color=reaper.EnumProjectMarkers3(0,idx)
 if ok==0 then break end
 marks[#marks+1]={isrgn=isrgn,p=p,last=last,name=name,id=id,color=color}
 idx=idx+1
end
for _,x in ipairs(marks) do
 reaper.SetProjectMarker3(0,x.id,x.isrgn,warp(x.p),x.isrgn and warp(x.last) or 0,x.name,x.color)
end
-- Preserve all narration manuscript items/notes on guide track 1 but mute them.
local guide=reaper.GetTrack(0,0)
reaper.GetSetMediaTrackInfo_String(guide,"P_NAME",
  "01  LOGAN | ORIGINAL NARRATION TEXT GUIDE (MUTED)",true)
reaper.SetMediaTrackInfo_Value(guide,"B_MUTE",1)
-- Add actual selected narrator media on a separate track, without replacing archive source.
reaper.InsertTrackAtIndex(1,true)
local voice=reaper.GetTrack(0,1)
reaper.GetSetMediaTrackInfo_String(voice,"P_NAME",
  "02  LOGAN | ELEVENLABS CLONE - ALL 233 SPOKEN CUES",true)
local col=reaper.ColorToNative(60,180,195) | 0x1000000
reaper.SetTrackColor(voice,col)
local loaded,missing=0,0
local previous_job=""
for _,x in ipairs(adjustments) do
 local src=reaper.PCM_Source_CreateFromFile(x.path)
 if src then
  local item=reaper.AddMediaItemToTrack(voice)
  local pos=warp(x.old_pos)
  reaper.SetMediaItemInfo_Value(item,"D_POSITION",pos)
  reaper.SetMediaItemInfo_Value(item,"D_LENGTH",x.duration)
  reaper.SetMediaItemInfo_Value(item,"B_LOOPSRC",0)
  reaper.SetMediaItemInfo_Value(item,"D_FADEINLEN",.014)
  reaper.SetMediaItemInfo_Value(item,"D_FADEOUTLEN",.052)
  reaper.SetMediaItemInfo_Value(item,"I_CUSTOMCOLOR",col)
  local take=reaper.AddTakeToMediaItem(item)
  reaper.SetMediaItemTake_Source(take,src)
  reaper.SetMediaItemTakeInfo_Value(take,"D_STARTOFFS",x.offset)
  reaper.SetMediaItemTakeInfo_Value(take,"D_VOL",.87)
  reaper.GetSetMediaItemTakeInfo_String(take,"P_NAME",
   "LOGAN ELEVENLABS | CUE "..x.cue_index.." | "..x.script:sub(1,70),true)
  reaper.GetSetMediaItemInfo_String(item,"P_NOTES",
   "USER'S ELEVENLABS CUSTOM CLONE: Logan\n"..
   "Narrator text: "..x.script.."\n"..
   "Recorded batch: "..x.job_id.."\n"..
   "Scribe word agreement: "..x.ratio.."\n"..
   "Source offset: "..x.offset.." sec.\n"..
   "Aligned word-level timing; still needs human editorial performance review.",true)
  loaded=loaded+1
  if x.job_id~=previous_job then
   reaper.AddProjectMarker2(0,false,pos,0,
    "ELEVENLABS LOGAN BATCH "..x.job_id,-1,col)
   previous_job=x.job_id
  end
 else
  missing=missing+1
 end
end
reaper.GetSetProjectNotes(0,true,
 "THE PAPER TRAIL - ELEVENLABS LOGAN COMPLETE NARRATION ASSEMBLY, V5\n"..
 "Source: THE_PAPER_TRAIL_FULL_SENTENCE_WORD_SCORE_v2.RPP\n"..
 "NARRATOR: Existing user-owned ElevenLabs cloned voice Logan (GDqvTqQdsHV3ND6SiEZP)\n"..
 "Music: three original Suno instrumentals, carefully timed to sentences and words.\n"..
 "Narration: "..loaded.."/233 voice cues populated, 17 ElevenLabs audio files.\n"..
 "Word-level timings: ElevenLabs Scribe speech transcripts, 5708 spoken words, checked against current script.\n"..
 "Archival recordings remain ORIGINAL dry source clips, not recreated.\n"..
 "Written messages remain performed reading placeholders, not actual author voice recordings.\n"..
 "MISSING SOURCES: AQ-0048, AQ-0220. Do not fake or silently fill them.\n"..
 "IMPORTANT: This is a full production draft. Editorial listening, corrections, mix automation, and master still needed before publication.\n"..
 "Original v1-v4 projects remain preserved; source files unchanged.")
reaper.SetEditCurPos(0,false,false)
reaper.TrackList_AdjustWindows(false)
reaper.UpdateArrange()
reaper.Undo_EndBlock("Replace all 233 narration guides with ElevenLabs Logan and word-realign full score",-1)
reaper.Main_SaveProjectEx(0,target,8)
reaper.PreventUIRefresh(-1)
local f=io.open(folder.."\\REAPER_ELEVENLABS_LOGAN_V5_RESULT.txt","w")
if f then
 f:write("THE PAPER TRAIL ElevenLabs LOGAN v5\n")
 f:write("Saved: "..target.."\n")
 f:write("Original guide/media items retimed: "..moved.."\n")
 f:write("Recorded narrator items loaded: "..loaded.."/233\n")
 f:write("Narrator source files missing: "..missing.."\n")
 f:write("Sentence music intervals exactly re-aligned: "..snapped_sentences.."\n")
 f:write("Word-level musical accents re-aligned: "..snapped_words.."\n")
 f:write("Original scene markers migrated: "..#marks.."\n")
 f:write("Final approximate project duration: "..data.final_end.." seconds\n")
 f:write("Prologue end: "..data.prologue_end.." seconds\n")
 f:write("All v1-v4 REAPER files preserved.\n")
 f:write("Do not publish without auditioning and editorial review.\n")
 f:close()
end
reaper.ShowConsoleMsg("ELEVENLABS LOGAN V5 SAVED: "..target..
 "\nNarrator audio cues loaded: "..loaded..
 "; sentence score syncs "..snapped_sentences..
 "; word syncs "..snapped_words.."\n")
