# THE PAPER TRAIL — deterministic sentence & word-level editorial score map
# This is a provisional timing map based on the existing narration guide, NOT verified recorded word timing.
import csv,json,re,math,hashlib
from pathlib import Path
from collections import Counter
base=Path(__file__).resolve().parent
with (base/'cue_sheet.csv').open(encoding='utf-8-sig',newline='') as f: cues=list(csv.DictReader(f))
report=json.loads((base/'assembly_report.json').read_text(encoding='utf-8'))
sections=report['sections']
tracks={
 'motif':str(base/'SCORE_Unsent_Fourth_Note.wav'),
 'investigation':str(base/'SCORE_Archive_Breathes.wav'),
 'human':str(base/'SCORE_What_Trust_Cost.wav')
}
for name,path in tracks.items():
    if not Path(path).is_file(): raise RuntimeError(f"Missing original Suno score WAV: {name}: {path}")
def section_at(t):
    chosen=sections[0]['name']
    for q in sections:
        if t>=q['pos']: chosen=q['name']
        else: break
    return chosen
def sentences(text):
    text=re.sub(r'(?<!\w)\*([^*]+)\*',r'\1',text).strip()
    parts=re.split(r'(?<=[.!?])\s+(?=[“"\'(]?[A-Z0-9])',text)
    return [x.strip() for x in parts if x.strip()]
def words(x):
    return list(re.finditer(r"[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*",x))
def classify(text,section):
    z=text.lower()
    if 'prologue' in section.lower() and ('this is the paper trail' not in z):
        return ('silence',0,'PROLOGUE: real words and archive exposed until the signature reveal')
    if any(x in z for x in ['suicide', 'rape', 'baby', 'sexual assault', 'child protective', 'cps', 'self-harm','dead child','welfare check']):
        return ('silence',0,'WITHHOLD MUSIC: sensitive account needs unforced space')
    if any(x in z for x in ['confid', 'friend', 'trust', 'sav ', "sav's", 'mother', 'daughter', 'children', 'vulnerab', 'hurt', 'loved', 'family', 'cry', 'alone', 'worry']):
        return ('human',0.075,'HUMAN: restrained felt-piano memory motif')
    if any(x in z for x in ['record', 'archiv', 'message', 'screenshot', 'fact', 'evidence', 'contradic', 'truth', 'claim', 'investigat', 'timeline', 'document', 'paper trail', 'listen']):
        return ('investigation',0.090,'INVESTIGATION: low unresolved fragment with dialogue space')
    if any(x in z for x in ['accus', 'threat', 'weapon', 'retaliat', 'expos', 'predator', 'attacked', 'confront', 'humiliat', 'lawsuit']):
        return ('investigation',0.062,'CONFLICT: low harmonic pressure; leave allegations audible and contextual')
    if 'scene 5:' in section.lower() or 'scene 9:' in section.lower():
        return ('human',0.068,'RELATIONSHIP / HUMAN CONSEQUENCES: muted fragile cue')
    if 'act iii' in section.lower() or 'scene 7:' in section.lower():
        return ('investigation',0.070,'PUBLIC CONFRONTATION: low restrained cue')
    if 'epilogue' in section.lower():
        return ('motif',0.078,'EPILOGUE: signature motif returns with a different meaning')
    if 'scene 2:' in section.lower() or 'scene 4:' in section.lower():
        return ('human',0.064,'HUMAN STORY: light bed')
    return ('investigation',0.055,'NEUTRAL SCORING: near-subconscious investigative texture')
silence_words=('suicide','suicidal','rape','rapist','baby','daughter','child','children','predator','threat','police','violence','death','died','killing','killed','dead','cps','welfare')
accent_words=('trust','trusted','friends','friend','confide','betrayal','betrayed','weaponize','weaponized','retaliate','receipts','recording','paper','trail','evidence','infiltrate','document','expose','vulnerability','vulnerable','panic','truth','names','dates','times','silence')
sfx=[str(base/'SCRATCH_phone_send_click.wav'),str(base/'SCRATCH_mic_unmute_click.wav')]
music_items=[];sentences_map=[];words_map=[];sfx_items=[];key_spans=[]
word_count=0;sentence_count=0
last_accent_t=-999.
for ci,entry in enumerate(cues):
    kind=entry['kind']
    t=float(entry['pos']);dur=float(entry['dur'])
    if kind not in ('narration','reading'):
        if kind in ('archive_angela','archive_other'):
            key_spans.append({'from':t-.12,'to':t+dur+.2,'why':'ARCHIVAL CLIP: default dry and forward'})
        if kind=='reading':
            sfx_items.append({'kind':'phone','pos':max(0,t-.11),'dur':.23,'source':sfx[0],'gain':.15,'name':'WRITTEN MESSAGE — sound cue'})
        continue
    if kind=='reading':
        key_spans.append({'from':max(0,t-.15),'to':t+dur+.2,'why':'PERFORMED MESSAGE: no score unless intentional exception'})
        sfx_items.append({'kind':'phone','pos':max(0,t-.17),'dur':.25,'source':sfx[0],'gain':.10,'name':'PERFORMED READING MESSAGE SEND'})
    text=entry['text']
    parts=sentences(text)
    totalweight=sum(max(1,len(words(part))) for part in parts)
    cursor=t
    for pi,part in enumerate(parts):
        weight=max(1,len(words(part)))
        sentence_duration=dur*weight/totalweight
        if pi==len(parts)-1:sentence_duration=max(.05,t+dur-cursor)
        section=section_at(cursor)
        typ,gain,why=classify(part,section)
        if kind=='reading':typ,gain,why='silence',0,'WRITTEN MESSAGE — performative reading should stay dry, attribution audible'
        sent={"cue_index":ci,"sentence_index":pi,"section":section,"start":round(cursor,3),"end":round(cursor+sentence_duration,3),"text":part,"bed":typ,"gain":gain,"decision":why,
              "timing":"provisional based on manuscript and guide; must snap to recorded voice"}
        sentences_map.append(sent);sentence_count+=1
        wrds=words(part)
        spans=[]
        for wi,match in enumerate(wrds):
            w=match.group()
            wstart=cursor+sentence_duration*(wi+.1)/max(1,len(wrds))
            wend=cursor+sentence_duration*(wi+.88)/max(1,len(wrds))
            wl=w.lower().replace('’',"'")
            action='follow narration / maintain or withhold score'
            if wl in silence_words:
                action='music retreat / expose word';spans.append((max(cursor,wstart-.16),min(cursor+sentence_duration,wend+.45)))
            elif wl in accent_words and wstart-last_accent_t>18.0 and (kind=='narration') and t>210:
                action='subtle motif accent / stress-word'
                sfx_items.append({'kind':'motif','pos':round(wstart,3),'dur':1.65,'source':tracks['motif'],'offset':9.,'gain':.09,
                      'name':f"WORD CUE: {w} | motif echo, restraint"})
                last_accent_t=wstart
            words_map.append({"cue_index":ci,"sentence_index":pi,"word":w,"time_est":round(wstart,3),"end_est":round(wend,3),"action":action,"section":section})
            word_count+=1
        if typ!='silence':
            # A sentence can be scored while a particular word is deliberately left unscored.
            # Subtract reserved silent windows from the sentence's continuous bed.
            spans=sorted(spans)
            merged=[]
            for a,b in spans:
                if merged and a<=merged[-1][1]: merged[-1]=(merged[-1][0],max(b,merged[-1][1]))
                else:merged.append((a,b))
            intervals=[];beg=cursor
            for a,b in merged:
                if a-beg>.35:intervals.append((beg,a))
                beg=max(beg,b)
            if cursor+sentence_duration-beg>.35:intervals.append((beg,cursor+sentence_duration))
            for a,b in intervals:
                length=b-a
                # source offset advances with episode time so adjacent sentences do not loop the same intro.
                source_offset= (max(8.0,a*0.52)%73)+12
                music_items.append({'kind':typ,'pos':round(a,3),'dur':round(length,3),'source':tracks[typ],'offset':round(source_offset,3),
                  'gain':gain,'fadein':min(.30,length*.16),'fadeout':min(.30,length*.16),
                  'name':f"SENTENCE SCORE {ci}.{pi+1} | {why[:52]}",
                  'note':part})
        cursor+=sentence_duration
# Important pre/post motif and transitions.
for ci,e in enumerate(cues):
    if e['kind']=='music':
        music_items.append({'kind':'motif','pos':float(e['pos']),'dur':8.7,'source':tracks['motif'],'offset':8.2,'gain':.25,
               'fadein':.02,'fadeout':1.7,'name':'SIGNATURE REVEAL | The Unsent Fourth Note | ACTUAL SUNO SCORE','note':'After the real walking paper trail archival statement'})
# Sound-only entrances with natural mic/unmute sound, not synthetic reverb under sources.
for q in sections:
    if 'SCENE' in q['name'] and q['pos']>0:
        sfx_items.append({'kind':'mic','pos':max(0,float(q['pos'])+.01),'dur':.19,'source':sfx[1],'gain':.06,'name':'ACT SCENE TRANSITION: quiet mic click'})
# Lua table escaping and data output.
def lua_value(v):
    if v is None:return 'nil'
    if isinstance(v,str):return json.dumps(v,ensure_ascii=False)
    if isinstance(v,bool):return 'true' if v else 'false'
    if isinstance(v,(int,float)):return str(round(v,5))
    if isinstance(v,list):return '{'+','.join(lua_value(x) for x in v)+'}'
    if isinstance(v,dict):return '{'+','.join('['+lua_value(k)+']='+lua_value(x) for k,x in v.items())+'}'
    return lua_value(str(v))
payload={"music":music_items,"fx":sfx_items,"sentences":sentences_map,"word_cues":words_map,"archive_spans":key_spans,
         "source_tracks":tracks,"project_length":4890.149}
# Full word map lives in external JSON, Lua uses only curated word cue hits and sentence markers.
lua_payload={"music":music_items,"fx":sfx_items,"sentences":sentences_map,"source_tracks":tracks,
             "project_length":4890.149}
(base/'FULL_EPISODE_SENTENCE_WORD_SCORE_DATA.lua').write_text('return '+lua_value(lua_payload),encoding='utf-8')
(base/'FULL_EPISODE_SENTENCE_WORD_CUE_MAP.json').write_text(json.dumps(payload,indent=2,ensure_ascii=False),encoding='utf-8')
print(json.dumps({"sentence_decisions":len(sentences_map),"word_decisions":len(words_map),
  "music_items":len(music_items),"word_accent_and_transitions":len(sfx_items),"archival_dry_spans":len(key_spans),
  "full_episode_draft_sec":4890.149,"output_lua_bytes":(base/'FULL_EPISODE_SENTENCE_WORD_SCORE_DATA.lua').stat().st_size}))
