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
});
