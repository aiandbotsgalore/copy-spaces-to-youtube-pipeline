-- Prologue Suno theme candidate. Preserves the original v1 project.
local src=debug.getinfo(1,"S").source:sub(2)
local folder=src:match("^(.*)[/\\]") or "."
local existing=folder.."\\THE_PAPER_TRAIL_ASSEMBLY_v1.RPP"
local destination=folder.."\\THE_PAPER_TRAIL_ASSEMBLY_SUNO_CANDIDATE_v2.RPP"
local wav=folder.."\\Walking_Paper_Trail_Instrumental_Suno.wav"
local f=io.open(wav,"rb")
if not f then
  reaper.ShowMessageBox("Downloaded Suno WAV is missing. No changes made.", "THE PAPER TRAIL", 0)
  return
end
f:close()
reaper.Main_openProject(existing)
local updated=0
reaper.PreventUIRefresh(1)
reaper.Undo_BeginBlock()
for t=0,reaper.CountTracks(0)-1 do
  local tr=reaper.GetTrack(0,t)
  local _,trackname=reaper.GetSetMediaTrackInfo_String(tr,"P_NAME","",false)
  if trackname:find("MUSIC",1,true) then
    for j=0,reaper.CountTrackMediaItems(tr)-1 do
      local item=reaper.GetTrackMediaItem(tr,j)
      local take=reaper.GetActiveTake(item)
      if take then
        local _,takename=reaper.GetSetMediaItemTakeInfo_String(take,"P_NAME","",false)
        if takename:find("THEME",1,true) then
          local pcm=reaper.PCM_Source_CreateFromFile(wav)
          if pcm then
            reaper.SetMediaItemTake_Source(take,pcm)
            reaper.SetMediaItemTakeInfo_Value(take,"D_STARTOFFS",0)
            reaper.SetMediaItemInfo_Value(item,"D_LENGTH",8.5)
            reaper.SetMediaItemInfo_Value(item,"D_FADEOUTLEN",0.75)
            reaper.SetMediaItemTakeInfo_Value(take,"D_VOL",0.45)
            reaper.GetSetMediaItemTakeInfo_String(take,"P_NAME","SUNO CANDIDATE | Walking Paper Trail | Felt piano motif opening",true)
            reaper.GetSetMediaItemInfo_String(item,"P_NOTES",
              "Suno original instrumental, generated October 5 2026, user-owned.
"..
              "Source: Walking Paper Trail (Without Lead Vocal), song ID 46194da4-b5cf-4832-a7ae-e0394a0584d0.
"..
              "Audio uses first 8.5 seconds from 238.4-second source.
"..
              "Three piano notes at approximately 2, 4 and 6 seconds.
"..
              "Candidate only: refine musical timing and balance by ear. No source recordings changed.",true)
            updated=updated+1
          end
        end
      end
    end
  end
end
if updated==0 then
  reaper.Undo_EndBlock("No Suno theme found",0)
  reaper.PreventUIRefresh(-1)
  reaper.ShowMessageBox("No existing theme cue found. Original project remains unchanged.","THE PAPER TRAIL",0)
  return
end
reaper.Undo_EndBlock("Suno existing score candidate on music track",-1)
reaper.TrackList_AdjustWindows(false)
reaper.UpdateArrange()
reaper.SetEditCurPos(0,false,false)
reaper.Main_SaveProjectEx(0,destination,8)
reaper.PreventUIRefresh(-1)
local log=io.open(folder.."\\REAPER_SUNO_CANDIDATE_RESULT.txt","w")
if log then log:write("Saved: "..destination.."\nUpdated theme items: "..updated.."\nSuno WAV: "..wav.."\nNo credits spent and original RPP unchanged.\n");log:close() end
reaper.ShowConsoleMsg("Suno theme candidate ready: "..destination.."\n")
