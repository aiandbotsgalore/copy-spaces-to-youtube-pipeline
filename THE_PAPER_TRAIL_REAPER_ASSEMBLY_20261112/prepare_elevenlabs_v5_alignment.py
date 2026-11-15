"""THE PAPER TRAIL: word-align 17 ElevenLabs Logan narration recordings to the master REAPER manuscript.

Inputs: previously generated NARR_JOB_XX.json, their corresponding ElevenLabs Logan MP3 files,
ElevenLabs Scribe per-word JSON; original cue_sheet and FULL_EPISODE_SENTENCE_WORD_CUE_MAP.json.

Outputs: new nonlinear timing map with actual speech placement, per-word sentence cues and Lua data.
Original media, v1/v2/v3/v4 projects stay untouched.
"""
import json, csv, re, math, difflib, bisect, pathlib
from collections import defaultdict
base=pathlib.Path(__file__).resolve().parent
def canon(s):
    return "".join(c for c in s.casefold() if c.isalnum())
def normword(s):
    return canon(s)
with (base/"cue_sheet.csv").open(encoding="utf-8-sig",newline="") as f: cues=list(csv.DictReader(f))
scoring=json.loads((base/"FULL_EPISODE_SENTENCE_WORD_CUE_MAP.json").read_text(encoding="utf-8"))
segments=[]
warnings=[]
stats=[]
recorded_words={}
for j in range(1,18):
    jobname=f"NARR_{j:02d}"
    job=json.loads((base/f"NARR_JOB_{j:02d}.json").read_text(encoding="utf-8"))
    rec=json.loads((base/f"ELEVENLABS_NARR_{j:02d}_WORDS.json").read_text(encoding="utf-8"))
    words=rec["words"]
    mp3=base/f"ELEVENLABS_LOGAN_NARR_{j:02d}.mp3"
    if not mp3.is_file() or mp3.stat().st_size<10000:raise RuntimeError(f"Missing voice file: {mp3}")
    script=job["script"]; s=canon(script)
    spoken=canon("".join(w["text"] for w in words))
    sim=difflib.SequenceMatcher(None,s,spoken,autojunk=False)
    ratio=sim.ratio()
    mapper={}
    for op,i1,i2,j1,j2 in sim.get_opcodes():
        if op=="equal":
            for k in range(i1,i2):mapper[k]=j1+k-i1
    matched=list(mapper)
    if ratio<.92:raise ValueError(f"{jobname} unreliable transcript/script agreement {ratio:.3f}")
    if not matched:raise ValueError(f"No aligned characters {jobname}")
    # Reverse map canonical audio character offsets to original timed spoken word.
    audioends=[]; charcount=0
    for w in words:
        charcount+=len(canon(w["text"]))
        audioends.append(charcount)
    def get_index(script_char_idx):
        if script_char_idx in mapper:
            k=mapper[script_char_idx]
        else:
            ind=bisect.bisect_left(matched,script_char_idx)
            nearest=matched[min(len(matched)-1,ind)]
            if ind and abs(matched[ind-1]-script_char_idx)<abs(nearest-script_char_idx):
                nearest=matched[ind-1]
            k=mapper[nearest]
        return min(len(words)-1,bisect.bisect_right(audioends,k))
    for seg in job["segments"]:
        b0=len(canon(script[:seg["start_char"]]))
        b1=len(canon(script[:seg["end_char"]]))-1
        word_a=get_index(b0);word_b=get_index(b1)
        if word_b<word_a:word_a,word_b=word_b,word_a
        off=float(words[word_a]["start"])
        ending=float(words[word_b]["end"])
        if ending-off<.08:
            warnings.append({"job":jobname,"cue":seg["cue_index"],"issue":"unreliable duration"})
            ending=off+.6
        c=cues[seg["cue_index"]]
        if c["kind"]!="narration":raise ValueError(f"Cue {seg['cue_index']} not narration")
        segments.append({"job_id":jobname,"cue_index":seg["cue_index"],
          "path":str(mp3),"source_id":jobname,"offset":round(off,4),"duration":round(ending-off+.11,4),
          "old_pos":float(c["pos"]),"old_dur":float(c["dur"]),
          "script":seg["text"],"word_start_ix":word_a,"word_end_ix":word_b,
          "ratio":round(ratio,5)})
        # word index by canonical char position across the original script.
        wordmap=sorted((w for w in scoring["word_cues"] if w["cue_index"]==seg["cue_index"]),key=lambda w:w["time_est"])
        wtext="".join(w["word"] for w in wordmap)
        wnorm=canon(wtext)
        segnorm=canon(seg["text"])
        if wnorm!=segnorm:
            warnings.append({"job":jobname,"cue":seg["cue_index"],"issue":"word-map text mismatch",
                "map":wnorm[:70],"script":segnorm[:70]})
        prefix=0
        for w in wordmap:
            pos=b0+prefix
            ti=get_index(min(len(s)-1,pos))
            w["source_word_time"]=float(words[ti]["start"])
            w["source_word_end"]=float(words[ti]["end"])
            w["timing"]="ElevenLabs Scribe measured word timestamp"
            recorded_words[id(w)]=seg["cue_index"]
            prefix+=len(canon(w["word"]))
    stats.append({"job":jobname,"ratio":round(ratio,5),"speak_words":len(words),
        "script_words":job["word_count"],"segments":len(job["segments"]),
        "last_word_s":round(float(words[-1]["end"]),2)})
segments.sort(key=lambda x:x["old_pos"])
if len(segments)!=233:raise ValueError(f"Expected 233 narration cues, got {len(segments)}")
for a,b in zip(segments,segments[1:]):
    if b["old_pos"]+1e-4<a["old_pos"]+a["old_dur"]:
        warnings.append({"issue":"overlapping old narration guides","left":a["cue_index"],"right":b["cue_index"]})
def warp(t):
    shift=0.
    for a in segments:
        if t<a["old_pos"]:break
        if t<a["old_pos"]+a["old_dur"]:
            return t+shift+(t-a["old_pos"])*(a["duration"]/a["old_dur"]-1)
        shift+=a["duration"]-a["old_dur"]
    return t+shift
seg_by_cue={s["cue_index"]:s for s in segments}
for word in scoring["word_cues"]:
    s=seg_by_cue.get(word["cue_index"])
    if s and "source_word_time" in word:
        word["time_final"]=round(warp(s["old_pos"])+word["source_word_time"]-s["offset"],4)
        word["end_final"]=round(warp(s["old_pos"])+word["source_word_end"]-s["offset"],4)
        word["offset"]=round(word["source_word_time"],4)
# Per-sentence real timing, for every score interval in v2 to follow accurately.
spanmap=defaultdict(list)
for w in scoring["word_cues"]:
    if "time_final" in w:spanmap[(w["cue_index"],w["sentence_index"])].append(w)
sentence_data=[]
for ss in scoring["sentences"]:
    k=(ss["cue_index"],ss["sentence_index"])
    ws=spanmap.get(k)
    if not ws:continue
    sentence_data.append({
        "cue_index":ss["cue_index"],"sentence_index":ss["sentence_index"]+1,
        "old_start":ss["start"],"old_end":ss["end"],
        "new_start":min(w["time_final"] for w in ws),
        "new_end":max(w["end_final"] for w in ws)
    })
# Source position-to-word accent lookup; add only where an exact word candidate uniquely matches.
accent_data=[]
for fx in scoring["fx"]:
    if not fx["name"].startswith("WORD CUE:"):continue
    wordname=canon(fx["name"].split("WORD CUE:",1)[1].split("|")[0].strip())
    cands=[w for w in scoring["word_cues"] if canon(w["word"])==wordname and "time_final" in w]
    if not cands:continue
    nearest=min(cands,key=lambda w:abs(w["time_est"]-fx["pos"]))
    if abs(nearest["time_est"]-fx["pos"])<1.2:
        accent_data.append({"name":fx["name"],"old_pos":fx["pos"],
                            "new_pos":nearest["time_final"]})
# Save full revised word map, with actual measured narration placements rather than estimated.
scoring["voice_provider"]="ElevenLabs";scoring["voice_name"]="Logan"
scoring["voice_id"]="GDqvTqQdsHV3ND6SiEZP"
scoring["alignment_source"]="ElevenLabs Scribe word-level transcription"
(base/"FULL_EPISODE_WORD_CUE_MAP_ELEVENLABS_v5.json").write_text(
    json.dumps(scoring,ensure_ascii=False,indent=2),encoding="utf-8")
# Lua source data.
def lua(v):
    if v is None:return 'nil'
    if isinstance(v,str):return json.dumps(v,ensure_ascii=False)
    if isinstance(v,bool):return "true" if v else "false"
    if isinstance(v,(int,float)):return str(round(v,5))
    if isinstance(v,list):return "{"+",".join(lua(x) for x in v)+"}"
    if isinstance(v,dict):return "{"+",".join("["+lua(k)+"]="+lua(x) for k,x in v.items())+"}"
    return lua(str(v))
payload={"segments":segments,"sentences":sentence_data,"word_hits":accent_data,
         "final_end":round(warp(4890.149),3),"prologue_end":round(warp(465.571),3)}
(base/"ELEVENLABS_V5_REAPER_DATA.lua").write_text("return "+lua(payload),encoding="utf-8")
audit={"voice":"Logan","voice_id":"GDqvTqQdsHV3ND6SiEZP","narration_segments":len(segments),
       "job_count":len(stats),"all_narration_cues_have_recording":len(segments)==233,
       "source_words":sum(x["speak_words"] for x in stats),
       "mapped_words":sum(1 for w in scoring["word_cues"] if "time_final" in w),
       "sentence_positions_updated":len(sentence_data),
       "word_accents_synchronized":len(accent_data),
       "warnings":warnings,"per_batch":stats,
       "old_duration":4890.149,"new_duration":payload["final_end"],
       "prologue_end":payload["prologue_end"],
       "not_finished":"Performed written messages and missing archival audio still require attention; all real archives still need editorial listening verification."}
(base/"ELEVENLABS_V5_ALIGNMENT_QA.json").write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps({k:v for k,v in audit.items() if k not in ("per_batch","warnings","not_finished")},ensure_ascii=False),flush=True)
print("WARNINGS",len(warnings),"RATIOS",[x["ratio"] for x in stats])
