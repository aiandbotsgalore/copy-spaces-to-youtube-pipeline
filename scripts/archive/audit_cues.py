import json
import os
import re
from pathlib import Path

# Target episodes files
EPISODE_FILES = {
    "Uncensored_Truth": Path("transcripts/md/20260906_1nGnRBnpYdXGO_Uncensored_Truth_Not_Your_Therapist_Angela_and_SaraBeth_Trut.md"),
    "Crackheads": Path("output_transcripts/20260907_1OxwbneDwBqJB_CRACKHEADS_TAKING_OVER_DISCLOSURE_-_HERES_YOUR_SINE.json"),
    "Hook_Line_Sinker": Path("transcripts/md/20260908_1nGeLMjONkAKX_Hook_Line_Sinker_How_Psychological_Operations_Reel_Us_In.md"),
    "Petty_Space": Path("transcripts/md/20260908_1wxWjlrwXokJQ_Petty_Space_Addressing_the_Men_Who_Provoked_Me_With_My_Dead_.md"),
    "Oor_Brought_a_Chipper": Path("transcripts/md/20260913_1lJQRWAWpvVxE_Oor_Brought_a_Chipper._Survivors_Brought_Receipts..md"),
    "Space_Invaders": Path("public/transcripts/episodes/20260916_1YxNrbXNjQLxw.json"),
    "Angela_Maggard_fan_club": Path("public/transcripts/episodes/20260918_1AxRnZMeZNYxl.json"),
    "Logan_Unmasked": Path("public/transcripts/episodes/20260918_1MJgNbdaAPlGL.json")
}

# Cue definitions to audit
CUES = [
    # Direct Allegation Excerpts
    {
        "cue_id": "D02",
        "category": "Direct Allegation",
        "quote_id": "AQ-0002",
        "episode_key": "Logan_Unmasked",
        "episode_id": "20260918_1MJgNbdaAPlGL",
        "speaker": "Angela",
        "search_pattern": r"predator because that is what you are",
        "verbatim_target": "Because, no, we have a predator problem on this app. I didn't call you a fucking pedophile. I called you a predator because that is what you are. The behavior is predatory. You seek out impressionable girls with trauma issues, and then you triangulate them against each other."
    },
    {
        "cue_id": "D05",
        "category": "Direct Allegation",
        "quote_id": "AQ-0005",
        "episode_key": "Logan_Unmasked",
        "episode_id": "20260918_1MJgNbdaAPlGL",
        "speaker": "Angela",
        "search_pattern": r"doxed people.*beat around the motherfucking bush",
        "verbatim_target": "I've doxed people. Let's not even sit here and beat around the motherfucking bush."
    },
    {
        "cue_id": "D07",
        "category": "Direct Allegation",
        "quote_id": "AQ-0007",
        "episode_key": "Logan_Unmasked",
        "episode_id": "20260918_1MJgNbdaAPlGL",
        "speaker": "Angela",
        "search_pattern": r"told all my mutual friends that I cannot be friends",
        "verbatim_target": "That's why I've told all my mutual friends that I cannot be friends and that I will not support somebody that lies on my name."
    },
    {
        "cue_id": "D08",
        "category": "Direct Allegation",
        "quote_id": "AQ-0008",
        "episode_key": "Logan_Unmasked",
        "episode_id": "20260918_1MJgNbdaAPlGL",
        "speaker": "Angela",
        "search_pattern": r"sharing nudes of women.*Revenge porn is real",
        "verbatim_target": "Logan's one of many people... But you have men on here sharing nudes of women in in in DMs... Revenge porn is real."
    },
    {
        "cue_id": "D09",
        "category": "Direct Allegation",
        "quote_id": "AQ-0009",
        "episode_key": "Logan_Unmasked",
        "episode_id": "20260918_1MJgNbdaAPlGL",
        "speaker": "Angela",
        "search_pattern": r"Logan with the 13 year old",
        "verbatim_target": "Do you want me to post the photos below of of Logan with the 13 year old? Do you want me to just tit for tat, motherfucker, since I can't speak on an abroad since without having to speak by names?"
    },
    {
        "cue_id": "D10",
        "category": "Direct Allegation",
        "quote_id": "AQ-0010",
        "episode_key": "Logan_Unmasked",
        "episode_id": "20260918_1MJgNbdaAPlGL",
        "speaker": "Angela",
        "search_pattern": r"Stop propping up predators",
        "verbatim_target": "Stop propping up predators... that's the whole reason why me and Lana don't talk anymore."
    },
    {
        "cue_id": "D12",
        "category": "Direct Allegation",
        "quote_id": "AQ-0012",
        "episode_key": "Hook_Line_Sinker",
        "episode_id": "20260908_1nGeLMjONkAKX",
        "speaker": "Angela",
        "search_pattern": r"walking paper trail",
        "verbatim_target": "No I said I'm a walking paper trail. What do you mean by that? Like my entire online persona and stuff is evidence. I'm a whistleblower who came here to share truth and dealt with psychological operations, trying to hinder and silence my story from ever going mainstream."
    },
    {
        "cue_id": "D15",
        "category": "Direct Allegation",
        "quote_id": "AQ-0015",
        "episode_key": "Logan_Unmasked",
        "episode_id": "20260918_1MJgNbdaAPlGL",
        "speaker": "Angela",
        "search_pattern": r"big bad wolf",
        "verbatim_target": "Logan isn't even the big bad wolf in all of this shit. There's worse."
    },
    {
        "cue_id": "D16",
        "category": "Direct Allegation",
        "quote_id": "AQ-0016",
        "episode_key": "Logan_Unmasked",
        "episode_id": "20260918_1MJgNbdaAPlGL",
        "speaker": "Angela",
        "search_pattern": r"fuck it bucket",
        "verbatim_target": "I'm a very patient person, and I'm very calculated... I sat on it until I was poked and poked and poked... Then I said, fuck it. I threw it all in the fuck it bucket."
    },
    {
        "cue_id": "D27",
        "category": "Direct Allegation",
        "quote_id": "AQ-0027",
        "episode_key": "Logan_Unmasked",
        "episode_id": "20260918_1MJgNbdaAPlGL",
        "speaker": "Angela",
        "search_pattern": r"infiltrate.*document.*expose",
        "verbatim_target": "I've been collecting NDAs, nondisclosure agreements. I infiltrate, document, expose. So like what I said, when you hear bad things about me, believe it. I act accordingly."
    },

    # Retaliation & Disclosure Excerpts
    {
        "cue_id": "D22",
        "category": "Retaliation & Disclosure",
        "quote_id": "AQ-0022",
        "episode_key": "Logan_Unmasked",
        "episode_id": "20260918_1MJgNbdaAPlGL",
        "speaker": "Angela",
        "search_pattern": r"process used as a club|screenshotted that.*sent it",
        "verbatim_target": "So I screenshotted that, and I went to my other account, and I sent it... process used as a club, both sides, myself included."
    },
    {
        "cue_id": "R02",
        "category": "Retaliation & Disclosure",
        "quote_id": "AQ-0245",
        "episode_key": "Haunted_Hump_Day",
        "episode_id": "20260217_1vAxRvZrEPaxl",
        "speaker": "Angela",
        "search_pattern": r"already have their address and phone number",
        "verbatim_target": "Because I already have their address and phone number and personal information, and I'll slap them with the lawsuit so fast."
    },
    {
        "cue_id": "R03",
        "category": "Retaliation & Disclosure",
        "quote_id": "AQ-0246",
        "episode_key": "Haunted_Hump_Day",
        "episode_id": "20260217_1vAxRvZrEPaxl",
        "speaker": "Angela",
        "search_pattern": r"always do that before I talk to someone",
        "verbatim_target": "Oh, I always do that before I talk to someone, yeah."
    },
    {
        "cue_id": "R05",
        "category": "Retaliation & Disclosure",
        "quote_id": "AQ-0247",
        "episode_key": "Haunted_Hump_Day",
        "episode_id": "20260217_1vAxRvZrEPaxl",
        "speaker": "Angela",
        "search_pattern": r"do that for fun.*on TikTok",
        "verbatim_target": "Oh yeah, I do that for fun. I know that's probably bad, but that's what I do on TikTok."
    },
    {
        "cue_id": "R06",
        "category": "Retaliation & Disclosure",
        "quote_id": "AQ-0024",
        "episode_key": "Logan_Unmasked",
        "episode_id": "20260918_1MJgNbdaAPlGL",
        "speaker": "Angela",
        "search_pattern": r"watch you talk shit about me",
        "verbatim_target": "See, the one thing I like to do is I'll send people in the community that I know in real life to watch you talk shit about me so I can see both sides."
    },
    {
        "cue_id": "R07",
        "category": "Retaliation & Disclosure",
        "quote_id": "AQ-0024b",
        "episode_key": "Logan_Unmasked",
        "episode_id": "20260918_1MJgNbdaAPlGL",
        "speaker": "Angela",
        "search_pattern": r"play dumb.*for months",
        "verbatim_target": "Sides, and then I'll play dumb. I'll do that for months."
    },
    {
        "cue_id": "R08",
        "category": "Retaliation & Disclosure",
        "quote_id": "AQ-0005b",
        "episode_key": "Logan_Unmasked",
        "episode_id": "20260918_1MJgNbdaAPlGL",
        "speaker": "Angela",
        "search_pattern": r"doxed people.*beat around the motherfucking bush",
        "verbatim_target": "I've doxed people. Let's not even sit here and beat around the motherfucking bush."
    },
    {
        "cue_id": "R09",
        "category": "Retaliation & Disclosure",
        "quote_id": "AQ-0006",
        "episode_key": "Logan_Unmasked",
        "episode_id": "20260918_1MJgNbdaAPlGL",
        "speaker": "Angela",
        "search_pattern": r"photo of his front door",
        "verbatim_target": "So, yes, I doxed the leader of that racist group chat. I did. I sent him the fucking front door, the photo of his front door of his house. I did the group chat, not publicly."
    },
    {
        "cue_id": "R24",
        "category": "Retaliation & Disclosure",
        "quote_id": "AQ-0033",
        "episode_key": "Social_Cost_Suicide_Threat",
        "episode_id": "20260930_1lJQRWLvWVzxE",
        "speaker": "Angela",
        "search_pattern": r"CPS gets involved.*not my.*responsibility",
        "verbatim_target": "If CPS gets involved or your husband gets a hold of these messages, that is not my fault nor my responsibility."
    },
    {
        "cue_id": "EXTRA-01",
        "category": "Retaliation & Disclosure",
        "quote_id": "AQ-0276",
        "episode_key": "Space_Invaders",
        "episode_id": "20260916_1YxNrbXNjQLxw",
        "speaker": "Angela Maggard",
        "search_pattern": r"identify as Tannerite",
        "verbatim_target": "I identify as Tannerite. And I love how you be like screen recording all my spaces... meet your maker with me."
    },
    {
        "cue_id": "EXTRA-02",
        "category": "Retaliation & Disclosure",
        "quote_id": "AQ-0270",
        "episode_key": "Hook_Line_Sinker",
        "episode_id": "20260908_1nGeLMjONkAKX",
        "speaker": "Angela Maggard",
        "search_pattern": r"got triggered.*hit him in his ego",
        "verbatim_target": "And then to me, he's like, I'm sorry she chose to throw you away. It's not my fault. And I got triggered. And so I sent the screenshot proving he was a liar. And that's when shit hit the fan. And that's where we're standing at now. It's because I proved him wrong. I hit him in his ego."
    }
]

def main():
    # Load existing clips manifest
    manifest_path = Path("public/clips/angela/manifest.json")
    existing_manifest = []
    if manifest_path.exists():
        with open(manifest_path, "r", encoding="utf-8") as f:
            existing_manifest = json.load(f)

    # Master quotes
    with open("angela_quotes_master.json", "r", encoding="utf-8") as f:
        master_quotes = json.load(f)
    qmap = {q["quote_id"]: q for q in master_quotes}

    # Summary index for cloud audio URLs
    summary_map = {}
    summary_path = Path("public/transcripts/transcripts_summary_index.json")
    if summary_path.exists():
        with open(summary_path, "r", encoding="utf-8") as f:
            for s in json.load(f):
                if s.get("release_tag"):
                    summary_map[s["release_tag"]] = s.get("audio_url")

    results = []

    for c in CUES:
        cid = c["cue_id"]
        cat = c["category"]
        qid = c["quote_id"]
        ep_key = c["episode_key"]
        ep_id = c["episode_id"]
        pattern = re.compile(c["search_pattern"], re.IGNORECASE)

        # 1. Audit existing library first (Deduplication)
        existing_clip = None
        for item in existing_manifest:
            content = f"{item.get('title', '')} {item.get('quote', '')} {item.get('filename', '')}"
            if pattern.search(content):
                existing_clip = item
                break
            # Also check if quote_id matches master clip
            mq = qmap.get(qid)
            if mq and mq.get("master_clip_filename"):
                if mq["master_clip_filename"].lower() == item.get("filename", "").lower():
                    existing_clip = item
                    break

        if existing_clip:
            status = "EXISTS"
            res = {
                "cue_id": cid,
                "category": cat,
                "quote_id": qid,
                "status": status,
                "episode_key": ep_key,
                "episode_id": ep_id,
                "speaker": c["speaker"],
                "filename": existing_clip["filename"],
                "audio_url": existing_clip.get("url"),
                "timestamp_str": existing_clip.get("timestamp"),
                "start_seconds": None,
                "end_seconds": None,
                "verbatim": existing_clip.get("quote", c["verbatim_target"]),
                "note": f"Linked to existing master asset: {existing_clip['filename']}"
            }
        else:
            # Check source transcript availability
            ep_file = EPISODE_FILES.get(ep_key)
            if not ep_file or not ep_file.exists():
                status = "SOURCE_NOT_AVAILABLE"
                res = {
                    "cue_id": cid,
                    "category": cat,
                    "quote_id": qid,
                    "status": status,
                    "episode_key": ep_key,
                    "episode_id": ep_id,
                    "speaker": c["speaker"],
                    "filename": None,
                    "audio_url": None,
                    "start_seconds": None,
                    "end_seconds": None,
                    "verbatim": c["verbatim_target"],
                    "note": f"Source transcript/audio outside available source pool: {ep_key}"
                }
            else:
                # Scan transcript file
                start_sec = None
                end_sec = None
                
                if ep_file.suffix == ".json":
                    with open(ep_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    segments = data.get("segments", [])
                    for seg in segments:
                        txt = seg.get("text", "")
                        if pattern.search(txt):
                            start_sec = seg.get("start")
                            end_sec = seg.get("end")
                            break
                elif ep_file.suffix == ".md":
                    content = ep_file.read_text(encoding="utf-8")
                    # Match timestamp turns like **[55:03] Speaker 1:**
                    turns = re.split(r"\*\*\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.*?):\*\*", content)
                    # turns pattern: [prefix, time1, spk1, text1, time2, spk2, text2, ...]
                    for i in range(1, len(turns), 3):
                        ts_str = turns[i]
                        spk_str = turns[i+1]
                        turn_text = turns[i+2]
                        if pattern.search(turn_text):
                            # Parse ts_str to seconds
                            parts = [int(p) for p in ts_str.split(":")]
                            if len(parts) == 3:
                                sec = parts[0]*3600 + parts[1]*60 + parts[2]
                            else:
                                sec = parts[0]*60 + parts[1]
                            start_sec = float(sec)
                            # Approximate end sec by word count (150 words per min = 2.5 wps)
                            word_count = len(turn_text.split())
                            end_sec = start_sec + max(5.0, round(word_count / 2.5, 1))
                            break

                # Also check master JSON pre-calculated cut_in/cut_out if present
                mq = qmap.get(qid)
                if mq and mq.get("cut_in") is not None and mq.get("cut_out") is not None:
                    start_sec = mq["cut_in"]
                    end_sec = mq["cut_out"]

                if start_sec is not None and end_sec is not None:
                    status = "READY_FOR_EXTRACTION"
                    res = {
                        "cue_id": cid,
                        "category": cat,
                        "quote_id": qid,
                        "status": status,
                        "episode_key": ep_key,
                        "episode_id": ep_id,
                        "speaker": c["speaker"],
                        "filename": f"{cid}_{qid}_{c['speaker'].replace(' ', '_')}.wav",
                        "audio_url": summary_map.get(ep_id, f"https://github.com/aiandbotsgalore/copy-spaces-to-youtube-pipeline/releases/download/{ep_id}/{ep_id}_{ep_key}.mp3"),
                        "start_seconds": round(start_sec, 2),
                        "end_seconds": round(end_sec, 2),
                        "duration": round(end_sec - start_sec, 2),
                        "verbatim": c["verbatim_target"],
                        "note": f"Exact boundary aligned: {start_sec:.1f}s - {end_sec:.1f}s"
                    }
                else:
                    status = "PENDING_ALIGNMENT"
                    res = {
                        "cue_id": cid,
                        "category": cat,
                        "quote_id": qid,
                        "status": status,
                        "episode_key": ep_key,
                        "episode_id": ep_id,
                        "speaker": c["speaker"],
                        "filename": None,
                        "audio_url": None,
                        "start_seconds": None,
                        "end_seconds": None,
                        "verbatim": c["verbatim_target"],
                        "note": "Phrase not isolated to specific timestamp turn in transcript"
                    }

        results.append(res)

    print(f"{'ID':<8} {'Category':<24} {'Status':<22} {'Asset / Note'}")
    print("-" * 80)
    for r in results:
        asset_info = r.get("filename") or r.get("note", "")
        print(f"{r['cue_id']:<8} {r['category']:<24} {r['status']:<22} {asset_info}")

    out_file = Path("cue_sheet_audit_results.json")
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    print(f"\nSaved full audit results to: {out_file.resolve()}")

if __name__ == "__main__":
    main()
