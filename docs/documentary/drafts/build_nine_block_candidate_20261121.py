
from pathlib import Path
import re, hashlib

root = Path(r"C:\Users\Logan\copy-spaces-to-youtube-pipeline")
source = root / "THE_PAPER_TRAIL_MASTER_WITH_VERBATIM_INTRO_20261114.md"
dest = root / "docs" / "documentary" / "drafts" / "THE_PAPER_TRAIL_NINE_BLOCK_RESTRUCTURED_CANDIDATE_20261121.md"
s = source.read_text(encoding="utf-8-sig")
beg = s.index("### PROLOGUE — LOCKED VERBATIM INTRO")
end = s.index("\n---", beg)
locked = s[beg:end].rstrip()

def clip(marker):
    p = s.find(marker)
    if p < 0: raise ValueError("Missing clip: " + marker)
    lines = s[s.rfind("\n", 0, p)+1:].splitlines()
    result = []
    for n, line in enumerate(lines):
        q = line.strip()
        if n and (q == "**LOGAN**" or q == "**LOGAN**  " or q == "---" or q == "[Silence.]" or q.startswith("### ") or q.startswith("[NON-SPOKEN") or q.startswith("[PRODUCTION NOTE") or q.startswith("[CLIP ") or q.startswith("[ARCHIVE —") or q.startswith("[WRITTEN-MESSAGE READING") or q.startswith("[PERFORMED READING") or q.startswith("[WRITTEN TESTIMONY READING") or q.startswith(chr(96)+"[CLIP ") or q.startswith("[Do not narrate") or q.startswith("[Let Sav's")):
            break
        result.append(line)
    out = "\n".join(result).strip()
    if len(out) < 35: raise ValueError("Short clip: " + marker + ": " + repr(out))
    return out

sections = []
def put(t): sections.append(t.strip("\n"))
def tape(m): sections.append(clip(m))

put("""# THE PAPER TRAIL
## The Friendship, the Files, and the People in Between
### Nine-Block Narrative Restructure — Editorial Candidate, November 21, 2026

STATUS: Proposed new working candidate, not an approved recording manuscript. The November 14 source master and its separately locked introduction remain unchanged.

PRODUCTION APPROACH: Adapt the supplied nine-block template by dramatic function, not its illustrative 22-minute clock, fixed word counts or equal act percentages. The introduction remains absolutely verbatim. Length is determined by the documentary, source clips and natural narration. Archive and written readings below are reproduced from the November 14 source, not independently reauditioned in this pass. Verify original speaker identity, dates and edit points before final recording. No music under major archival exchanges; restrained felt-piano motif, natural Spaces texture and dry conversational narration. Every written message gets an audible attribution and distinct neutral reading voice, never a synthetic imitation of Angela.

---

## BLOCK 1 — COLD OPEN: A FRIEND'S VOICE BECOMES THE ACCUSATION
[LOCKED INTRODUCTION — ORIGINAL WORDING AND ORDER, NO REWRITES]
""")
put(locked)

put("""
---

## BLOCK 2 — PRIMARY-SOURCE DROP: THE QUESTION IN THE ROOM

[DRY ARCHIVAL AUDIO ONLY. NO MUSIC, NO NARRATOR INTERRUPTION. From Haunted Hump Day. Audition the several adjacent catalog clip IDs for actual continuity. Do not falsely present an edited montage as an unbroken three-minute recording.]
""")
tape("CLIP #002 / #003 / #004 / #005")
put("""
[Let the real room tone breathe after the final line; no cinematic impact.]

---

## BLOCK 3 — MACRO PREMISE: WHEN TRUST BECOMES INFORMATION

**LOGAN**

When I met Angela, I understood why somebody might save every conversation that mattered to them. She had a story she wanted people to hear, and she said she'd kept notes since childhood.

In an X Space, you hear the same people night after night. They talk about their kids, their relationships, the things they survived. Eventually a voice you've never met in person becomes a friend.

There's a reason people say things privately that they would never say on an open microphone.

What changed for me wasn't discovering that Angela kept records. She'd told us that herself. It was listening to what she said about those records once a friendship went wrong.

And then hearing other people describe what happened when their most vulnerable moments became part of somebody else's argument.

[Three solitary felt-piano notes, barely present. Out.]

---

## BLOCK 4 — MICRO SCENE: THE LATE-NIGHT OPEN MICROPHONE

**LOGAN**

Picture an X Space late at night. A little microphone icon lights up. Someone has a question about UFOs. Somebody else wants to tell a story. A few people listen without saying a word.

That's where I knew Angela. Not in a courtroom or some investigation. In conversations that could go on for hours.

I had no reason to think that one day I'd be replaying those same voices trying to understand how we got here.

[Dry mic-open click; drop directly into Act I.]

---

## BLOCK 5 — ACT I: THE PEOPLE WHO LEARNED TO TRUST HER

### Beat 1 — The stranger we believed

**LOGAN**

Angela entered my rooms in late 2023. She used her own name and talked about her family, her history and what she believed had happened to her. This is part of what she told people.
""")
tape("CLIP #115-A")
put("""
**LOGAN**

I listened. I gave her the microphone. We talked privately. I helped search for family information and started building a website for her.

She also told us why she documented things.
""")
tape("CLIP #048-A")
put("""
**LOGAN**

The way I saw it then, she was trying to protect something important. And she seemed to value the places where people made room for her.

In February, she said this about my Spaces.
""")
tape("CLIP #006-M")
put("""
### Beat 2 — When we were still on the same side

**LOGAN**

There were moments when I knew Angela trusted me with material she considered sensitive. She brought up one of them on air, and I tried to get her to stop announcing where she'd left it.
""")
tape("CLIP #009-M & #010-M")
put("""
**LOGAN**

You can hear two friends trying to protect the same information. Whatever happened later, that part was real.

Then somebody else entered the picture.

### Beat 3 — The person who came because she knew Angela

[ARCHIVAL AUDIO — Angela, describing how Sav arrived from TikTok.]
""")
tape("Clip #170")
put("""
**LOGAN**

Sav knew Angela first. She'd come to X to help her make sense of the behavior Angela believed she was seeing in those rooms.

Sav and I started talking. Then it became more than that.

We fell for each other.

Later, when the friendship was breaking apart, Sav said something to Angela that still sounds exactly right to me.

[PERFORMED READING — Sav's written message, not original audio.]
""")
tape("PERFORMED READING — SAV'S WRITTEN MESSAGE TO ANGELA")
put("""
**LOGAN**

And I fell for her.

Angela was still my friend. She was still Sav's friend. That's why the next part matters: Sav wasn't sending things to an investigator or an enemy. She was talking to someone she trusted.

In May, when Sav was facing eviction, I organized a marathon fundraiser and asked Shane to help. People in these rooms raised around four hundred dollars. It reminded me what these friendships could mean when someone was struggling.

But disagreements were building. Somebody Angela had blocked was allowed to speak in a room I hosted. His name was Oor. I believed an open microphone didn't mean agreeing with every person who used it. Angela felt differently.

That difference would become impossible to ignore.

[End on the sound of the room, not a dramatic sting.]

---

## BLOCK 6 — ACT II: THE THINGS SHE KEPT

### Beat 1 — The principle

**LOGAN**

One thing that stayed with me was how Angela talked about accountability when we were friends.
""")
tape("CLIP #024-M")
put("""
**LOGAN**

She also said she was keeping track of people in the community.
""")
tape("CLIP #016-M")
put("""
**LOGAN**

There was a list. She said there were about twenty-seven people on it.

Then there was the way she talked about what she hadn't yet shown anybody.
""")
tape("CLIP #164")
put("""
### Beat 2 — The reserve

**LOGAN**

She described holding screenshots back for later.
""")
tape("CLIP #019-M")
put("""
**LOGAN**

By September, she had a way of describing how she could still care about someone while she tracked everything they did.
""")
tape("CLIP #177")
put("""
**LOGAN**

“I still care.” “I'm still taking notes.”

The first part is what I thought our friendship was about. The second is the part I would hear very differently later.

[All music clears. One dry silence.]

---

## BLOCK 7 — ACT III: PRIVATE MESSAGES, PUBLIC AUDIENCES

### Beat 1 — The first friction

**LOGAN**

By September, Oor had made a cruel remark about Angela's deceased baby in a room I was hosting. I told him to stop and removed him from the panel.

Angela later pointed to that confrontation as part of why she had gone public.

The same day, she spoke about Sav, her friend. First, she said she'd never make Sav choose sides.
""")
tape("Approximately 35:05")
put("""
**LOGAN**

Then she explained why Sav's relationship with me changed how much she told her.
""")
tape("Approximately 37:27")
put("""
[Silence.]

**LOGAN**

A liability.

That's the word she used about someone who'd trusted her.

### Beat 2 — The major pivot

**LOGAN**

On September 8, Angela opened a Space called Petty Space.

She told listeners what she was going to show them.
""")
tape("CLIP #104 & #105")
put("""
**LOGAN**

Four screenshots at a time.

Private exchanges between Sav and me were now being shown to an audience. Angela said she'd held other material back.
""")
tape("CLIP #179")
put("""
**LOGAN**

And she said she was prepared to go back to the earliest messages.
""")
tape("CLIP #166")
put("""
[Let the recording end. No narrator recap of the threat.]

### Beat 3 — How the screenshots got there

**LOGAN**

Here's what made that release so personal. Sav had sent Angela private conversations because Angela was her friend.

Angela said so herself.
""")
tape("Approximately 52:28–53:47")
put("""
**LOGAN**

Later, Sav sent her a message about what it felt like to see those confidences used against her.

[PERFORMED WRITTEN MESSAGE — Sav, read plainly by a separate voice, not an archive impersonation.]
""")
tape("PERFORMED READING — SAV'S WRITTEN MESSAGE]")
put("""
[One beat of silence.]

**LOGAN**

There's an exchange that shows what that change in context could do.

Sav had asked me to show her a lingerie photograph because she'd worried it might be a nude. She'd spoken to Angela privately about how insecure she felt. Later she heard it described publicly as me circulating women's nudes.

Sav tried to correct that account. Here are her words.

[PERFORMED WRITTEN MESSAGE — Sav to Angela, September 15.]
""")
tape("WRITTEN-MESSAGE READING (not original audio): SAV — DM TO ANGELA, SEPT 15")
put("""
**LOGAN**

She wasn't asking Angela to take my side. She was asking her not to change what had happened.

The next message asked a harder question.

[PERFORMED WRITTEN MESSAGE — Sav to Angela, September 16.]
""")
tape("WRITTEN-MESSAGE READING — SAV TO ANGELA, SEPTEMBER 16, 2026; PERFORMED TEXT")
put("""
**LOGAN**

Instead, Angela introduced another accusation.

[PERFORMED WRITTEN MESSAGE — Angela to Sav, September 16.]
""")
tape("WRITTEN-MESSAGE READING — ANGELA TO SAV, SEPTEMBER 16, 2026; PERFORMED TEXT")
put("""
**LOGAN**

Sav tried to find out what Angela actually wanted.

[PERFORMED WRITTEN MESSAGE — Sav to Angela, September 16.]
""")
tape("Angela what is the goal here.....?")
put("""
[Hold actual silence. No invented answer.]

[NON-SPOKEN CORRECTION — The source has conflicting assertions about who first posted Lin's photograph. Keep the real DM wording; verify source publication separately. Also do not confuse this lingerie photograph with a different AI-image incident.]

### Beat 4 — The rule she said she followed

**LOGAN**

Angela had once put a limit on what she thought people should post about someone else.
""")
tape("CLIP #022-M")
put("""
**LOGAN**

On September 15, she said something similar about a private Discord archive.
""")
tape("CLIP #165")
put("""
**LOGAN**

Three days later she described what happened when that restraint ended.
""")
tape("CLIP #051")
put("""
**LOGAN**

She said she knew what those records could do. She described holding them. And she described deciding to put them out anyway.

To Sav, the difference wasn't theoretical. Neither was it to the other people who'd trusted her.

[Drop music and leave only the source room tone.]

---

## BLOCK 8 — ACT IV: WHAT FOLLOWED PEOPLE HOME

### Beat 1 — The people who went to her for help

**LOGAN**

Sine hosted conversations about trafficking, trauma and abuse. He said he had referred people to Angela when they asked him for help.

Here is what he said after that friendship fell apart.
""")
tape("CLIP #189")
put("""
**LOGAN**

Cambian described another version of the same turning point.
""")
tape("CLIP #203-A")
put("""
**LOGAN**

Glow Baby said information about her family became part of her own conflict with Angela.
""")
tape("CLIP #052-M & #053-M")
put("""
**LOGAN**

Sine also described being at Skittles' home when child-protection workers arrived.
""")
tape("CLIP #050-M")
put("""
**LOGAN**

These were different people's experiences. What stayed with me wasn't that everyone had exactly the same story. It was how many had gone into those relationships believing they were safe.

### Beat 2 — Sav's worst day

**LOGAN**

In August, Sav was in crisis. She was raising her children while struggling through a separation and fears about losing her home.

Sara Beth helped calm her during a panic attack. I was at work when she asked me for Sav's address; I gave it to her because I wanted Sav to be safe. Angela was seeking a welfare check.

Sav later described how frightened she was when she realized an officer would come to the house.

[PERFORMED READING — Sav's written testimony. No recording of children, no simulated crisis audio.]
""")
tape("WRITTEN TESTIMONY READING — SAV")
put("""
**LOGAN**

The officer left. Sav thought that day was behind her.

But by September, private material from that part of her life was still being discussed. And on September 18 she took the microphone to speak for herself.

[ARCHIVAL AUDIO — Sav. No music and no interruptions through her final sentence.]
""")
tape("CLIP #103")
put("""
[Allow Sav's final words to land in real silence.]

**LOGAN**

The thing I remember about listening to that wasn't an online argument. It was someone trying to explain what it feels like when a friend exposes things that were never supposed to be an audience's business.

### Beat 3 — No neat resolution

**LOGAN**

The conflict continued. On September 30, Angela talked publicly about what might happen if Sav's family or child-protection authorities obtained the messages.
""")
tape("CLIP #024 | AQ-0033")
put("""
**LOGAN**

There wasn't one final moment when everything became private again. The people who had trusted one another were left dealing with what had been said, what had been released and what might still follow them beyond the room.

[NON-SPOKEN HOLD — A separate section of the source master contains messages from an account displaying “Angela's Spaces Alt.” The date and authorship are not independently authenticated. Do not use them as proof of Angela's conduct or a decisive climax without further validation, especially given the intensely personal crisis material.]

[Return to the opening room tone.]

---

## BLOCK 9 — OUTRO: WHAT A FRIEND KNOWS

**LOGAN**

There was a time when Angela joining my Space was just another late-night conversation.

I gave her a microphone because I believed she was somebody who wanted to help. I listened to her. I defended her.

Other people did, too.

That's the part I keep returning to. None of us started as enemies.

Somebody shared a private message because they trusted a friend. Somebody else sent people to her because they thought she'd help. And when those relationships went wrong, people discovered that the things they'd shared could travel far beyond the conversation where they began.

I used to hear Angela talk about keeping notes and think she was protecting a story.

Now I hear the people describing what it felt like to become part of those notes.

She once told an audience to listen to the good and the bad, and believe both.

That's how I'm going to leave this.

[ARCHIVE — Angela's original invitation; use as a deliberate callback to the locked prologue, not a second explanatory narration.]
""")
tape("CLIP #171")
put("""
[Let the recorded voice end naturally. A faint return of the three felt-piano notes in D minor, then silence. No extra sign-off.]

END OF EDITORIAL CANDIDATE

---

## NONSPOKEN PRODUCTION HOLDS

1. Opening is copied verbatim from the November 14 working master, including transcript imperfections, speaker order and sequencing.
2. All archival quotations and performed DM readings are drawn from that master. Check the original recordings, written messages and exact cut points prior to final use.
3. Speaker correction: the July 15 threat is Angela addressing Sav about Logan, not Sav speaking. It is not inserted without the original source wording.
4. Preserve the difference between the real archival voice and a performed reading of text. Never fabricate natural back-and-forth or continuous source audio from separately edited clips.
5. Verify the specific Lin photo posting history; the original source contains contradictory descriptions. Do not expand the allegations beyond what the recordings substantiate.
6. The account labelled “Angela's Spaces Alt” is not independently authenticated in the source. Its screenshot messages are not presented as conclusive in this candidate.
7. The piece does not have a 22-minute limit. Pace each section to the actual emotional and archival material rather than the template's numerical proportions.
8. The original master remains the working reference until this candidate receives explicit editorial approval.
""")

doc = "\n\n".join(sections).strip() + "\n"
assert doc.count(locked) == 1
assert len(re.findall(r"^## BLOCK \d", doc, re.M)) == 9
assert len(doc) > 26000
dest.parent.mkdir(parents=True, exist_ok=True)
if dest.exists(): raise FileExistsError(f"Refusing overwrite: {dest}")
dest.write_text(doc, encoding="utf-8")
print("CANDIDATE", dest)
print("CHARACTERS", len(doc), "WORDS", len(doc.split()))
print("NINE_BLOCKS", len(re.findall(r"^## BLOCK \d", doc, re.M)))
print("LOCKED_INTRO_SHA256", hashlib.sha256(locked.encode("utf-8")).hexdigest())
print("ORIGINAL_UNMODIFIED", source.exists())
