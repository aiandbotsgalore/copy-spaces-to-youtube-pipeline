import { describe, expect, it } from 'vitest';
import { parseUploadedScript, createEvidenceDoc } from '../scriptUpload';

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
});
