"""Create a dialogue-driven music balance plan for the ONE existing REAPER project.

Controls four actual music tracks. Uses real REAPER media positions for Logan,
the archived speakers, unrecorded readings and explicitly scripted silence.
Scores remain original Suno sources; this only applies editable REAPER automation.
"""
import csv,json,pathlib,math,numpy as np,re,collections
base=pathlib.Path(__file__).resolve().parent
project=base.parent
with (base/'MUSIC_REFINEMENT_FULL_ITEM_AUDIT.tsv').open(encoding='utf-8',errors='replace',newline='') as f:items=list(csv.DictReader(f,delimiter='\t'))
with (base/'MUSIC_REFINEMENT_MARKERS.tsv').open(encoding='utf-8',errors='replace',newline='') as f:markers=list(csv.DictReader(f,delimiter='\t'))
wordmap=json.loads((project/'FULL_EPISODE_WORD_CUE_MAP_ELEVENLABS_v5.json').read_text(encoding='utf-8'))
cuts=json.loads((project/'SPOKEN_AQ_ID_AUDIO_CUT_PLAN.json').read_text(encoding='utf-8'))['cuts']
total=4436.899-sum(float(c['end'])-float(c['start']) for c in cuts)
expected=4423.869
if abs(total-expected)>.06:raise RuntimeError('Unexpected episode length '+str(total))
end=expected
step=.15
N=int(end/step)+1
grid=np.arange(N,dtype=np.float64)*step
nar=np.zeros(N,dtype=bool)
archive=np.zeros(N,dtype=bool)
editorial_hold=np.zeros(N,dtype=bool)
counts=collections.Counter()
def fill(mask,a,b):
    lo=max(0,int(a/step));hi=min(N,math.ceil(b/step))
    if hi>lo:mask[lo:hi]=True
def speaking_groups(rows):
    spans=sorted((float(x['start']),float(x['end'])) for x in rows if float(x['length'])>.1 and (float(x['trackmute'])<.5 or 'ELEVENLABS LOGAN' in x['track']) and float(x['itemmute'])<.5)
    out=[]
    for a,b in spans:
        if not out or a-out[-1][1]>.72:out.append([a,b])
        else:out[-1][1]=max(b,out[-1][1])
    return out
nr=[x for x in items if 'ELEVENLABS LOGAN' in x['track'] and 'NARRATION' in x['track']]
ar=[x for x in items if 'ARCHIVE' in x['track'] and x['source'] and float(x['trackmute'])<.5]
for a,b in speaking_groups(nr):fill(nar,a,b)
for a,b in speaking_groups(ar):fill(archive,a,b)
counts['narrator_intervals']=len(speaking_groups(nr))
counts['archive_intervals']=len(speaking_groups(ar))
hold_details=[]
for x in items:
    isreading=('WRITTEN MESSAGES' in x['track'])
    ishold=('SILENCE / HOLDS' in x['track'])
    if not (isreading or ishold):continue
    a=float(x['start']);b=float(x['end'])
    if b-a<.15:continue
    fill(editorial_hold,a,b)
    hold_details.append({'start':round(a,3),'end':round(b,3),'type':'UNRECORDED_PERFORMED_READING' if isreading else 'DIRECTED_SILENCE_OR_MISSING_ARCHIVE','name':x['name'][:115]})
counts['explicit_holds']=len(hold_details)
# Listener should not hear music bridging an unrecorded written-message reading as if it were complete.
# Preserve the authentic archive and voice where present, these holds only affect music.
scene= np.where(archive,.30,np.where(nar,.44,.97)).astype(np.float64)
under= np.where(archive,.53,np.where(nar,.66,.94)).astype(np.float64)
# Gentle, editorially motivated differences in scene restraint.
region_data=sorted([m for m in markers if m['isregion']=='1'],key=lambda x:float(x['pos']))
for region in region_data:
    name=region['name'].lower()
    a=float(region['pos']);b=float(region['finish'])
    lo=max(0,int(a/step));hi=min(N,int(b/step)+1)
    if 'scene 4:' in name or 'scene 4' in name:
        scene[lo:hi]*=.80
        under[lo:hi]*=.86
    elif 'scene 5:' in name or 'scene 5' in name:
        scene[lo:hi]*=.66
        under[lo:hi]*=.79
    elif 'scene 10:' in name or 'scene 10' in name:
        scene[lo:hi]*=.85
        under[lo:hi]*=.91
    elif 'epilogue' in name:
        scene[lo:hi]*=1.04
        under[lo:hi]*=.78
# Convolve with a one-second Hann window, preventing artificial audible pumping at short cuts.
window=np.hanning(13).astype(np.float64)
window/=window.sum()
scene=np.convolve(scene,window,mode='same')
under=np.convolve(under,window,mode='same')
# The deliberate 7 silences and the 11 not-yet-performed written readings stay clear in editorial rough-cut playback.
# Smooth 0.28-second entrance and exit, with near-silence inside placeholder regions.
for h in hold_details:
    a=h['start'];b=h['end']
    if b-a<.2:continue
    idx=np.where((grid>=a-.22)&(grid<=b+.22))[0]
    if not idx.size:continue
    ds=np.maximum(0,grid[idx]-a);de=np.maximum(0,b-grid[idx])
    # fades to maximum suppression in the center; tiny 0.5s beat is a brief controlled dip.
    gain=np.ones(idx.size,dtype=np.float64)
    l=(grid[idx]>=a-.22)&(grid[idx]<a+.2)
    gain[l]=np.interp(grid[idx[l]],[a-.22,a+.2],[1,.065])
    center=(grid[idx]>=a+.2)&(grid[idx]<=b-.2)
    gain[center]=.065
    rr=(grid[idx]>b-.2)&(grid[idx]<=b+.22)
    gain[rr]=np.interp(grid[idx[rr]],[b-.2,b+.22],[.065,1])
    if b-a<=.4:gain*=.65
    scene[idx]*=gain
    under[idx]*=gain
# Exact actual-word timing: use only a few strong words so the score doesn't twitch every syllable.
def old_to_current(t):
    shift=0
    for c in cuts:
        a=float(c['start']);b=float(c['end'])
        if a<=t<b:return None
        if t>=b:shift+=b-a
    return t-shift
keyword_set={'trust','trusted','friend','friends','sav','threat','threaten','weaponized',
 'weaponizing','vulnerable','baby','suicide','suicidal','private','screenshot',
 'screenshots','welfare','confide','recordings','retaliation','betrayal'}
cue_regions=[(float(m['pos']),float(m['finish']),m['name']) for m in region_data]
word_events=[]
last=-1000
per_scene=collections.Counter()
for word in sorted(wordmap.get('word_cues',[]),key=lambda w:float(w.get('time_final',0))):
    val=word.get('time_final')
    if val is None:continue
    key=re.sub(r'[^a-z0-9]','',word['word'].casefold())
    if key not in keyword_set:continue
    t=old_to_current(float(val))
    if t is None or t-last<29:continue
    section=next((n for a,b,n in cue_regions if a<=t<b),'')
    if not section or per_scene[section]>=3:continue
    if editorial_hold[min(N-1,max(0,int(t/step)))]:continue
    word_events.append({'t':round(t,3),'word':word['word'],'section':section})
    per_scene[section]+=1
    last=t
    # Pull scene music a further 2dB down for ~0.4sec to uncover the significant spoken word.
    ix=np.flatnonzero(np.abs(grid-t)<.9)
    if ix.size:
        mask=(1-.20*np.exp(-.5*((grid[ix]-t)/.31)**2))
        scene[ix]*=mask
# The three older original score stems already have their own word-level shape baked in.
# Use matching gentle speech envelopes across them, slightly different levels to avoid phase masking.
curve={
 'SUNO ORIGINAL SCENE SCORE':scene,
 'SUNO INSTRUMENTAL SCORE  |  INVESTIGATION':under,
 'SUNO INSTRUMENTAL SCORE  |  TRUST':under,
 'SUNO INSTRUMENTAL SCORE  |  SIGNATURE':under
}
# Simplify 30,000 samples to editable REAPER points using max interpolation error.
def compress(times,values,eps=.014):
    vals=np.asarray(values,dtype=np.float64)
    pick={0,len(vals)-1}
    stack=[(0,len(vals)-1)]
    while stack:
        a,b=stack.pop()
        if b-a<2:continue
        xx=times[a+1:b]
        linear=vals[a]+(vals[b]-vals[a])*(xx-times[a])/(times[b]-times[a])
        err=np.abs(vals[a+1:b]-linear)
        idx=int(np.argmax(err))
        if err[idx]>eps:
            k=a+1+idx
            pick.add(k)
            stack.append((a,k));stack.append((k,b))
    return [[round(float(times[i]),3),round(float(vals[i]),5)] for i in sorted(pick)]
results={}
for label,values in curve.items():
    # The end-point prevents REAPER from extrapolating arbitrarily at the episode tail.
    values=np.clip(values,.005,1.10)
    points=compress(grid,values,.014 if label.startswith('SUNO ORIGINAL') else .018)
    results[label]=points
    print('CURVE',label,len(points),'points','avg_gain',round(float(np.mean(values)),3),'min',round(float(np.min(values)),3),'max',round(float(np.max(values)),3))
def to_lua(v):
    if v is None:return 'nil'
    if isinstance(v,str):return json.dumps(v,ensure_ascii=False)
    if isinstance(v,bool):return 'true' if v else 'false'
    if isinstance(v,(int,float)):return str(v)
    if isinstance(v,list):return '{'+','.join(to_lua(x) for x in v)+'}'
    if isinstance(v,dict):return '{'+','.join('['+to_lua(k)+']='+to_lua(x) for k,x in v.items())+'}'
    return to_lua(str(v))
data={'curves':results,'words':word_events,'holds':hold_details,'episode_end':end}
(base/'MUSIC_REFINEMENT_AUTOMATION_DATA.lua').write_text('return '+to_lua(data),encoding='utf-8')
report={'source':'Actual REAPER media-items audit, ElevenLabs word times, scene-marker geometry',
 'one_canonical_project':'THE_PAPER_TRAIL_LOGAN_LABELS_REMOVED_SUNO_VISIBLE_v7.RPP',
 'source_suno_recordings_unchanged':True,'narration_source_unchanged':True,
 'scene_items_still_12':True,'autogain_curve_point_counts':{k:len(v) for k,v in results.items()},
 'narrator_intervals':counts['narrator_intervals'],'archive_intervals':counts['archive_intervals'],
 'scene_scope':'Prologue plus 10 named scenes and epilogue',
 'words_selected_for_clarity':word_events,'editorial_hold_windows':hold_details,
 'music_behavior':'Under narrative approx -7dB new scene score, -4dB underlying score; under archive approx -10.5dB new score, -5.5dB under-score; up in longer speech-free transitions, quiet at unrecorded readings and directed silences.',
 'performance_caveat':'Automation driven by actual recorded timeline and word alignment, not a full subjective soundboard audition. To fine-tune listening priorities remains essential.'}
(base/'MUSIC_REFINEMENT_AUTOMATION_PLAN.json').write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf-8')
print('RESULT',json.dumps({'selected_words':len(word_events),'holds':len(hold_details),'points':report['autogain_curve_point_counts']},ensure_ascii=False),flush=True)

