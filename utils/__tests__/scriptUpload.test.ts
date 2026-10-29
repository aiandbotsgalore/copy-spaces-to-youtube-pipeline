import { describe, expect, it } from 'vitest';
import {
  parseUploadedScript,
  createEvidenceDoc,
  extractClipsFromText,
  parseTimeToSeconds,
  CANONICAL_CLIP_REGEX,
  INLINE_QUOTE_REGEX,
  clipsFromBlock,
  clipDedupeKey,
} from '../scriptUpload';

describe('scriptUpload', () => {
  it('parses empty text into a fallback valid segment and scene', () => {
    const segs = parseUploadedScript('');
    expect(segs).toHaveLength(1);
    expect(segs[0].scenes).toHaveLength(1);
    expect(segs[0].scenes[0].blocks).toHaveLength(1);
    expect(segs[0].scenes[0].blocks[0].kind).toBe('narration');
  });

  it('parses plain text into paragraphs of narration', () => {
    const text = `Logan: Welcome back to the investigation.
We looked at every single angle.

Then came the unexpected revelation.`;
    const segs = parseUploadedScript(text);
    expect(segs).toHaveLength(1);
    expect(segs[0].scenes).toHaveLength(1);
    expect(segs[0].scenes[0].blocks).toHaveLength(2);
    expect(segs[0].scenes[0].blocks[0].kind).toBe('narration');
    expect((segs[0].scenes[0].blocks[0] as any).text).toContain('Welcome back to the investigation');
    expect((segs[0].scenes[0].blocks[1] as any).text).toContain('Then came the unexpected revelation');
  });

  it('parses markdown with segment and scene headings, pauses and music', () => {
    const text = `# Act 1: The Gathering Storm
## Scene 1: Introduction
We began tracking this back in September.
[Pause: 1.5s]
The evidence was hiding in plain sight.
[Music: sting - dramatic tension]

## Scene 2: The Fallout
Everything started unraveling when the first report dropped.`;

    const segs = parseUploadedScript(text);
    expect(segs).toHaveLength(1);
    expect(segs[0].title).toBe('Act 1: The Gathering Storm');
    expect(segs[0].scenes).toHaveLength(2);

    const sc1 = segs[0].scenes[0];
    expect(sc1.title).toBe('Scene 1: Introduction');
    expect(sc1.blocks).toHaveLength(4);
    expect(sc1.blocks[0].kind).toBe('narration');
    expect(sc1.blocks[1].kind).toBe('pause');
    expect((sc1.blocks[1] as any).sec).toBe(1.5);
    expect(sc1.blocks[2].kind).toBe('narration');
    expect(sc1.blocks[3].kind).toBe('music');
    expect((sc1.blocks[3] as any).cue).toBe('sting');
    expect((sc1.blocks[3] as any).note).toBe('dramatic tension');

    const sc2 = segs[0].scenes[1];
    expect(sc2.title).toBe('Scene 2: The Fallout');
    expect(sc2.blocks).toHaveLength(1);
    expect((sc2.blocks[0] as any).text).toContain('Everything started unraveling');
  });

  it('parses multiple segments', () => {
    const text = `# Segment 1: The Setup
## Scene 1
Intro text.

# Segment 2: The Climax
## Scene 2
Outro text.`;

    const segs = parseUploadedScript(text);
    expect(segs).toHaveLength(2);
    expect(segs[0].title).toBe('Segment 1: The Setup');
    expect(segs[1].title).toBe('Segment 2: The Climax');
  });

  it('parses valid JSON array of segments directly', () => {
    const json = JSON.stringify([
      {
        id: 'seg_custom1',
        title: 'Custom Act',
        scenes: [
          {
            id: 'sc_custom1',
            title: 'Custom Scene',
            purpose: 'Test',
            blocks: [
              { id: 'b_custom1', kind: 'narration', text: 'Spoken line', mode: 'polished', claims: [] }
            ]
          }
        ]
      }
    ]);

    const segs = parseUploadedScript(json);
    expect(segs).toHaveLength(1);
    expect(segs[0].id).toBe('seg_custom1');
    expect(segs[0].title).toBe('Custom Act');
    expect(segs[0].scenes[0].blocks[0].kind).toBe('narration');
    expect((segs[0].scenes[0].blocks[0] as any).mode).toBe('polished');
  });

  it('creates an evidence document with correct metadata and byte count', () => {
    const doc = createEvidenceDoc('Federal_Indictment.txt', 'Document contents for the AI to analyze.', 'text');
    expect(doc.id).toMatch(/^doc_/);
    expect(doc.name).toBe('Federal_Indictment.txt');
    expect(doc.content).toBe('Document contents for the AI to analyze.');
    expect(doc.sizeBytes).toBeGreaterThan(0);
  });

  it('correctly classifies all 5 block types and auto-splits scene/act hierarchy', () => {
    const script = `ACT I: THE EXPOSURE
PROLOGUE: THE BEGINNING

NARRATOR: Logan Paulsen
FORMAT: Investigative Documentary
AUDIO DNA: Cold atmospheric synth

[SFX: Tape clicks on, ambient hiss]
[THEME: Dark pulsing drone fades in]

In the early morning hours, the server was quietly accessed.
[Silence: 2 beats]

LOGAN (READING DM FROM SOURCE): "They are moving the funds to cold storage right now."

[CLIP #42 | *Night Shift Space*, 2023-11-04, 02:15: Alice - "Nobody will ever trace this back to us."]

[beat]

SCENE 1: THE LEDGER
### Section 1: Chain Analysis
We downloaded the full on-chain ledger records.`;

    const segs = parseUploadedScript(script);

    // Segment / Act splitting
    expect(segs).toHaveLength(1);
    expect(segs[0].title).toBe('ACT I: THE EXPOSURE');
    expect(segs[0].scenes).toHaveLength(2);

    const prologue = segs[0].scenes[0];
    expect(prologue.title).toBe('Prologue: THE BEGINNING');

    // Check blocks in Prologue
    const blocks = prologue.blocks;
    // CUE production notes (NARRATOR, FORMAT, AUDIO DNA)
    const narratorCue = blocks.find(b => b.kind === 'cue' && (b as any).cueType === 'production_note' && (b as any).text.includes('Logan Paulsen'));
    expect(narratorCue).toBeDefined();
    expect(narratorCue?.type).toBe('CUE');
    expect((narratorCue as any)?.sec).toBe(0);

    // CUE SFX
    const sfxCue = blocks.find(b => b.kind === 'cue' && (b as any).cueType === 'sfx');
    expect(sfxCue).toBeDefined();
    expect(sfxCue?.type).toBe('CUE');

    // CUE Theme
    const themeCue = blocks.find(b => b.kind === 'cue' && (b as any).cueType === 'theme');
    expect(themeCue).toBeDefined();
    expect(themeCue?.type).toBe('CUE');

    // Standard Narration
    const stdNarration = blocks.find(b => b.kind === 'narration' && b.type === 'NARRATION');
    expect(stdNarration).toBeDefined();
    expect((stdNarration as any)?.text).toContain('the server was quietly accessed');

    // CUE Silence (2 beats = 1.2s)
    const silenceCue = blocks.find(b => b.kind === 'cue' && (b as any).cueType === 'silence');
    expect(silenceCue).toBeDefined();
    expect(silenceCue?.type).toBe('CUE');
    expect((silenceCue as any)?.sec).toBe(1.2);

    // QUOTE_READ (read evidence)
    const quoteRead = blocks.find(b => b.kind === 'narration' && b.type === 'QUOTE_READ');
    expect(quoteRead).toBeDefined();
    expect((quoteRead as any)?.readEvidence).toBe(true);
    expect((quoteRead as any)?.text).toContain('LOGAN (READING DM FROM SOURCE)');

    // ARCHIVAL_CLIP
    const archivalClip = blocks.find(b => b.kind === 'clip' && b.type === 'ARCHIVAL_CLIP');
    expect(archivalClip).toBeDefined();
    expect((archivalClip as any)?.clipNumber).toBe('42');
    expect((archivalClip as any)?.speaker).toBe('Alice');
    expect((archivalClip as any)?.spaceTitle).toBe('Night Shift Space');
    expect((archivalClip as any)?.keptText).toBe('Nobody will ever trace this back to us.');
    expect((archivalClip as any)?.outSec).toBeGreaterThan(0);

    // CUE beat (0.5s)
    const beatCue = blocks.find(b => b.kind === 'cue' && (b as any).cueType === 'beat');
    expect(beatCue).toBeDefined();
    expect((beatCue as any)?.sec).toBe(0.5);

    // Scene 1 splitting & Heading block
    const scene1 = segs[0].scenes[1];
    expect(scene1.title).toBe('SCENE 1: THE LEDGER');
    const headingBlock = scene1.blocks.find(b => b.type === 'HEADING');
    expect(headingBlock).toBeDefined();
    expect((headingBlock as any)?.text).toBe('Section 1: Chain Analysis');
    expect((headingBlock as any)?.sec).toBe(0);

    const scene1Narration = scene1.blocks.find(b => b.type === 'NARRATION');
    expect(scene1Narration).toBeDefined();
    expect((scene1Narration as any)?.text).toContain('on-chain ledger records');
  });

  it('matches canonical clip tags with named capture groups and registers archival clips', () => {
    const script = `## Scene 1
[CLIP #101 | Breaking Developments, Alice 14:02 - "This is a critical turning point."]`;

    const segs = parseUploadedScript(script);
    const blocks = segs[0].scenes[0].blocks;
    const clipBlock = blocks.find(b => b.kind === 'clip' && b.type === 'ARCHIVAL_CLIP');

    expect(clipBlock).toBeDefined();
    expect((clipBlock as any).clipId).toBe('clip_101');
    expect((clipBlock as any).clipNumber).toBe('101');
    expect((clipBlock as any).spaceTitle).toBe('Breaking Developments');
    expect((clipBlock as any).speaker).toBe('Alice');
    expect((clipBlock as any).time).toBe('14:02');
    expect((clipBlock as any).keptText).toBe('This is a critical turning point.');
    expect((clipBlock as any).outSec).toBeGreaterThan(0);
  });

  it('matches inline speaker quotes and parses them into archival tape blocks', () => {
    const script = `## Scene 1
[Angela 12:34 "Nobody will ever trace this back to us."]`;

    const segs = parseUploadedScript(script);
    const blocks = segs[0].scenes[0].blocks;
    const clipBlock = blocks.find(b => b.kind === 'clip' && b.type === 'ARCHIVAL_CLIP');

    expect(clipBlock).toBeDefined();
    expect((clipBlock as any).clipId).toBe('clip_angela_12_34');
    expect((clipBlock as any).speaker).toBe('Angela');
    expect((clipBlock as any).time).toBe('12:34');
    expect((clipBlock as any).keptText).toBe('Nobody will ever trace this back to us.');
    expect((clipBlock as any).fn).toBe('evidence');
    expect((clipBlock as any).outSec).toBeGreaterThan(0);
  });

  it('handles 3-part timestamps and curly quotes in inline quotes', () => {
    const script = `## Scene 1
[Angela_Maggard 1:02:15 “We are documenting everything here.”]`;

    const segs = parseUploadedScript(script);
    const blocks = segs[0].scenes[0].blocks;
    const clipBlock = blocks.find(b => b.kind === 'clip' && b.type === 'ARCHIVAL_CLIP');

    expect(clipBlock).toBeDefined();
    expect((clipBlock as any).clipId).toBe('clip_angela_maggard_1_02_15');
    expect((clipBlock as any).speaker).toBe('Angela_Maggard');
    expect((clipBlock as any).time).toBe('1:02:15');
    expect((clipBlock as any).keptText).toBe('We are documenting everything here.');
  });

  it('extractClipsFromText scans text and returns both canonical and inline clips', () => {
    const text = `Narrator says something.
[CLIP #7 | Alpha Space, Bob 05:30 - "First canonical quote."]
And then later:
[Angela 12:34 "Nobody will ever trace this back to us."]
End of text.`;

    const clips = extractClipsFromText(text, 'Default Show');
    expect(clips).toHaveLength(2);

    expect(clips[0].clipId).toBe('clip_7');
    expect(clips[0].title).toBe('Alpha Space (#7)');
    expect(clips[0].speaker).toBe('Bob');
    expect(clips[0].time).toBe('05:30');
    expect(clips[0].episodeStartSec).toBe(330);
    expect(clips[0].quote).toBe('First canonical quote.');
    expect(clips[0].isInline).toBe(false);

    expect(clips[1].clipId).toBe('clip_angela_12_34');
    expect(clips[1].title).toBe('Angela (12:34)');
    expect(clips[1].speaker).toBe('Angela');
    expect(clips[1].time).toBe('12:34');
    expect(clips[1].episodeStartSec).toBe(754);
    expect(clips[1].quote).toBe('Nobody will ever trace this back to us.');
    expect(clips[1].isInline).toBe(true);
  });

  it('parseTimeToSeconds accurately converts MM:SS and HH:MM:SS strings', () => {
    expect(parseTimeToSeconds('12:34')).toBe(754);
    expect(parseTimeToSeconds('1:02:15')).toBe(3735);
    expect(parseTimeToSeconds('00:45')).toBe(45);
    expect(parseTimeToSeconds('02:15 pm')).toBe(135);
    expect(parseTimeToSeconds(undefined)).toBe(0);
    expect(parseTimeToSeconds('invalid')).toBe(0);
  });
});

describe('structured clip detection for Sync Clips', () => {
  const clipsById: any = {
    c_42: { clipId: 'c_42', title: 'Tape 42', speaker: 'Angela', text: "I've demonstrated the point.", durationSec: 7.5, episodeStartSec: 334 },
  };

  it('counts an engine-drafted clip block that has no type or clipNumber', () => {
    const block = { id: 'b1', kind: 'clip', clipId: 'c_42', keptText: "I've demonstrated the point.", inSec: 0, outSec: 6, trimBasis: 'full', fn: 'evidence', rationale: '' };
    const found = clipsFromBlock(block, { sceneId: 'sc1', index: 0, clipsById });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ clipId: 'c_42', speaker: 'Angela', quote: "I've demonstrated the point.", durationSec: 6, episodeStartSec: 334, isInline: false });
  });

  it('reads clip-like items spelled with type "clip", timestamp and quote', () => {
    const found = clipsFromBlock({ type: 'clip', speaker: 'Angela', timestamp: '5:34', quote: "I've demonstrated..." }, { sceneId: 'sc9', index: 3 });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ clipId: 'c_sc9_3', speaker: 'Angela', time: '5:34', quote: "I've demonstrated...", episodeStartSec: 334 });
  });

  it('reads clip-like sub-items and numeric timestamps', () => {
    const block = { id: 'b2', kind: 'narration', text: 'Intro', mode: 'live', claims: [], pills: [{ id: 'p1', speaker: 'Oor', timestamp: 125, text: 'Hello there' }] };
    const found = clipsFromBlock(block, { sceneId: 'sc1', index: 1 });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ clipId: 'p1', speaker: 'Oor', time: '2:05', quote: 'Hello there' });
  });

  it('ignores plain narration, pauses and headings', () => {
    expect(clipsFromBlock({ id: 'n', kind: 'narration', text: 'Just words.', mode: 'live', claims: [] }, { sceneId: 's', index: 0 })).toEqual([]);
    expect(clipsFromBlock({ id: 'p', kind: 'pause', sec: 2 }, { sceneId: 's', index: 1 })).toEqual([]);
    expect(clipsFromBlock({ id: 'h', kind: 'heading', text: 'Act 1' }, { sceneId: 's', index: 2 })).toEqual([]);
  });

  it('dedupes by speaker + timestamp + quote across forms and punctuation', () => {
    const a = clipDedupeKey({ speaker: 'Angela', time: '5:34', quote: '\u201cI\u2019ve demonstrated\u2026\u201d' });
    const b = clipDedupeKey({ speaker: ' angela ', episodeStartSec: 334, quote: "I've demonstrated\u2026" });
    expect(a).toBe(b);
    expect(clipDedupeKey({ speaker: 'Angela', time: '5:35', quote: "I've demonstrated\u2026" })).not.toBe(a);
  });

  it('regex fallback still finds the bracketed form and matches the structured clip key', () => {
    const found = extractClipsFromText('Here is the tape. [Angela 5:34 "I\'ve demonstrated the point."] Then more.');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ speaker: 'Angela', time: '5:34', quote: "I've demonstrated the point." });
    const structured = clipsFromBlock(
      { kind: 'clip', clipId: 'clip_angela_5_34', keptText: "I've demonstrated the point.", speaker: 'Angela', time: '5:34', inSec: 0, outSec: 5 },
      { sceneId: 'sc1', index: 0 },
    )[0];
    expect(clipDedupeKey(found[0])).toBe(clipDedupeKey(structured));
  });

  it('traverses nested pill objects with quote, speaker, and timestamp', () => {
    const scene = {
      id: 'sc_test',
      title: 'Scene with pills',
      pills: [
        {
          speaker: 'Angela',
          timestamp: '12:34',
          quote: 'Nobody will ever trace this back to us.',
        },
      ],
      quotes: [
        {
          speaker: 'Logan',
          time: '05:20',
          quote: 'We need to verify this right now.',
        },
      ],
    };

    const foundPills = clipsFromBlock(scene, { sceneId: scene.id, index: 0 });
    expect(foundPills).toHaveLength(2);
    expect(foundPills[0].speaker).toBe('Angela');
    expect(foundPills[0].time).toBe('12:34');
    expect(foundPills[0].quote).toBe('Nobody will ever trace this back to us.');
    expect(foundPills[1].speaker).toBe('Logan');
    expect(foundPills[1].time).toBe('05:20');
    expect(foundPills[1].quote).toBe('We need to verify this right now.');
  });

  it('verifies exact canonical and inline quote regexes from specification', () => {
    const canonicalText = '[CLIP #42 | Space Title, Alice 12:34 - "Quote from Alice"]';
    const canonicalRe = new RegExp(CANONICAL_CLIP_REGEX.source, 'gi');
    const cMatch = canonicalRe.exec(canonicalText);
    expect(cMatch).not.toBeNull();
    expect(cMatch?.groups?.id).toBe('42');
    expect(cMatch?.groups?.title.trim()).toBe('Space Title');
    expect(cMatch?.groups?.speaker.trim()).toBe('Alice');
    expect(cMatch?.groups?.time.trim()).toBe('12:34');
    expect(cMatch?.groups?.quote.trim()).toBe('Quote from Alice');

    const inlineText = '[Angela 12:34 "Nobody will ever trace this back to us."]';
    const inlineRe = new RegExp(INLINE_QUOTE_REGEX.source, 'gi');
    const iMatch = inlineRe.exec(inlineText);
    expect(iMatch).not.toBeNull();
    expect(iMatch?.groups?.speaker.trim()).toBe('Angela');
    expect(iMatch?.groups?.time.trim()).toBe('12:34');
    expect(iMatch?.groups?.quote.trim()).toBe('Nobody will ever trace this back to us.');
  });
});
