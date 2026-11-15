-- THE PAPER TRAIL: non-destructive assembly of the current manuscript.
-- Run in a NEW EMPTY REAPER INSTANCE (the launcher does this).
-- Does not change any source clips or manuscript files.
local source = debug.getinfo(1,"S").source:sub(2)
local folder = source:match("^(.*)[/\\]") or "."
local data = dofile(folder .. "\\assembly_data.lua")
local target = folder .. "\\THE_PAPER_TRAIL_ASSEMBLY_v1.RPP"
if reaper.CountTracks(0) ~= 0 then
  reaper.ShowMessageBox("This build must run in a NEW EMPTY REAPER project to protect existing work.", "THE PAPER TRAIL", 0)
  return
end
local specs = {
  {key="narration",name="01  LOGAN  |  NARRATION GUIDE",color={55,119,157}},
  {key="archive_angela",name="02  ARCHIVE  |  ANGELA",color={175,105,66}},
  {key="archive_other",name="03  ARCHIVE  |  OTHER WITNESSES",color={142,105,162}},
  {key="reading",name="04  WRITTEN MESSAGES  |  PERFORMED READINGS",color={129,96,158}},
  {key="music",name="05  MUSIC  |  SIGNATURE AND SCORE",color={72,122,97}},
  {key="sfx",name="06  SFX  |  TRANSITIONS AND PHONE CLICKS",color={181,144,77}},
  {key="ambience",name="07  AMBIENCE  |  SPACES AND ROOM TONE",color={77,112,112}},
  {key="notes",name="08  EDITORIAL CUES  |  SILENCE / HOLDS",color={100,105,116}},
}
local function rgb(c) return reaper.ColorToNative(c[1],c[2],c[3]) | 0x1000000 end
local palette = {}
local tracks = {}
reaper.PreventUIRefresh(1)
reaper.Undo_BeginBlock()
for i,sp in ipairs(specs) do
  reaper.InsertTrackAtIndex(i-1,true)
  local tr = reaper.GetTrack(0,i-1)
  tracks[sp.key] = tr
  palette[sp.key] = rgb(sp.color)
  reaper.GetSetMediaTrackInfo_String(tr,"P_NAME",sp.name,true)
  reaper.SetTrackColor(tr,palette[sp.key])
end
local counts={audio=0,placeholders=0,missing=0,errors=0}
local note_errors={}
local function kind_track(kind)
  if kind=="missing_archive" or kind=="direction" then return "notes" end
  return tracks[kind] and kind or "notes"
end
for _,e in ipairs(data.events) do
  local k = kind_track(e.kind)
  local tr = tracks[k]
  local item = reaper.AddMediaItemToTrack(tr)
  reaper.SetMediaItemInfo_Value(item,"D_POSITION",e.pos)
  reaper.SetMediaItemInfo_Value(item,"D_LENGTH",e.dur)
  reaper.SetMediaItemInfo_Value(item,"B_LOOPSRC",0)
  reaper.SetMediaItemInfo_Value(item,"I_CUSTOMCOLOR",palette[k])
  local take = reaper.AddTakeToMediaItem(item)
  if take then reaper.GetSetMediaItemTakeInfo_String(take,"P_NAME",e.name,true) end
  local details = tostring(e.name).."\n"..tostring(e.text or "").."\nStatus: "..tostring(e.status or "").."\nScript line: "..tostring(e.line or "")
  reaper.GetSetMediaItemInfo_String(item,"P_NOTES",details,true)
  if e.path and e.path~="" then
    local test = io.open(e.path,"rb")
    if test then
      test:close()
      local audio = reaper.PCM_Source_CreateFromFile(e.path)
      if audio and take then
        reaper.SetMediaItemTake_Source(take,audio)
        if e.kind=="music" or e.kind=="sfx" then
          reaper.SetMediaItemTakeInfo_Value(take,"D_VOL",0.65)
        end
        reaper.SetMediaItemInfo_Value(item,"D_FADEINLEN",math.min(0.016,e.dur/10))
        reaper.SetMediaItemInfo_Value(item,"D_FADEOUTLEN",math.min(0.026,e.dur/10))
        counts.audio=counts.audio+1
      else
        counts.errors=counts.errors+1
        table.insert(note_errors,"Could not load: "..e.path)
      end
    else
      counts.missing=counts.missing+1
      table.insert(note_errors,"File no longer exists: "..e.path)
    end
  else
    counts.placeholders=counts.placeholders+1
  end
end
-- Regions are for listening and editing, NOT documentation exhibits.
for i,s in ipairs(data.sections) do
  if s.name~="END OF DOCUMENTARY" then
    local isAct = s.name:match("^ACT [IVX]+:") ~= nil
    if isAct then
      reaper.AddProjectMarker2(0,false,s.pos,0,s.name,-1,rgb({100,115,132}))
    else
      local ending = data.sections[#data.sections].pos
      for j=i+1,#data.sections do
        local n = data.sections[j].name
        if n:find("SCENE",1,true) or n:find("EPILOGUE",1,true) or n:find("ACT ",1,true) or n:find("END OF",1,true) then
          ending=data.sections[j].pos
          break
        end
      end
      if ending<=s.pos then ending=s.pos+.5 end
      reaper.AddProjectMarker2(0,true,s.pos,ending,s.name,-1,rgb({105,130,145}))
    end
  end
end
reaper.GetSetProjectNotes(0,true,
  "THE PAPER TRAIL - AUTOMATIC FIRST ASSEMBLY\n"..
  "Read-only source: "..tostring(data.metadata.source).."\n"..
  "Narration and written-message items are TIMING GUIDES until performed.\n"..
  "Archival audio is PLACED, not yet independently auditioned or context-verified.\n"..
  "Music and click sounds are ORIGINAL SCRATCH ASSETS only, not final sound design.\n"..
  "Placeholders and editor notes are not real audio.\n"..
  "Timing is approximate; revise after narration and archival audition.\n"..
  "DO NOT RENDER OR PUBLISH THIS AS A FINISHED EPISODE.")
reaper.Undo_EndBlock("THE PAPER TRAIL first automatic scene assembly",-1)
reaper.TrackList_AdjustWindows(false)
reaper.UpdateArrange()
reaper.SetEditCurPos(0,false,false)
reaper.Main_SaveProjectEx(0,target,8)
local log = io.open(folder.."\\REAPER_BUILD_RESULT.txt","w")
if log then
  log:write("Project: "..target.."\n")
  log:write("Audio items: "..counts.audio.."\n")
  log:write("Placeholder items: "..counts.placeholders.."\n")
  log:write("Missing file paths: "..counts.missing.."\n")
  log:write("Load errors: "..counts.errors.."\n")
  log:write("REAPER Version: "..reaper.GetAppVersion().."\n")
  for _,e in ipairs(note_errors) do log:write(e.."\n") end
  log:close()
end
reaper.ShowConsoleMsg("THE PAPER TRAIL: assembled "..#data.events.." items; "..counts.audio.." with audio, "..counts.placeholders.." guides.\nSaved: "..target.."\n")
