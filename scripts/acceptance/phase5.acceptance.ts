import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectConsecutiveWordOverlap, hasRawDiarizationLabel } from '../../utils/scriptGates';
import type { Block, Segment } from '../../utils/scriptTypes';

// Real archived outputs are wrapped as { version: { segments } }. They are
// NOT raw ScriptVersion JSON at the file root.
type ExperimentOutput = { version: { segments: Segment[] } };
const root = path.resolve(__dirname, '../..');
const dir = path.join(root, 'docs', 'experiments', '02_multispeaker_validation');
const read = (name: string) => fs.readFileSync(path.join(dir, name), 'utf8');
const armA = JSON.parse(read('A.json')) as ExperimentOutput;
const armC = JSON.parse(read('C.json')) as ExperimentOutput;
const readableA = read('A_readable.md');
const readableC = read('C_readable.md');
const reviewNotes = read('REPORT.md');
const report = JSON.parse(read('report.json')) as {
  A: { attributionFlags: unknown[] };
  C: { duplicates: { shared: number; text: string }[] };
};
const allScenes = (output: ExperimentOutput) =>
  output.version.segments.flatMap(segment => segment.scenes);
const allBlocks = (output: ExperimentOutput): Block[] =>
  allScenes(output).flatMap(scene => scene.blocks);
const clips = (output: ExperimentOutput) =>
  allBlocks(output).filter((b): b is Extract<Block, { kind: 'clip' }> => b.kind === 'clip');
const narrations = (output: ExperimentOutput) =>
  allBlocks(output).filter((b): b is Extract<Block, { kind: 'narration' }> => b.kind === 'narration');

describe('Phase 5.1 / Experiment 02 source-grounded acceptance controls', () => {
  it('separates 7 spoken-narrator labels, 17 total raw labels, and 9 automated attribution findings', () => {
    const narratorLines = readableA.split(/\r?\n/).filter(line => /^NARRATOR:/i.test(line)).join('\n');
    const rawLabel = /\bSpeaker\s+\d+\b/gi;
    expect(narratorLines.match(rawLabel)).toHaveLength(7);
    expect(readableA.match(rawLabel)).toHaveLength(17);
    expect(report.A.attributionFlags).toHaveLength(9);
    // The nine automated findings are not confirmed speaker errors: REPORT.md
    // identifies false positives and distinguishes the manual content mismatch.
    expect(reviewNotes).toMatch(/automated checker's attribution flags were all false positives/i);
    expect(hasRawDiarizationLabel('Speaker_1 says this')).toBe(true);
    expect(hasRawDiarizationLabel('Speaker 1 says this')).toBe(true);
    expect(hasRawDiarizationLabel('An unidentified speaker says this')).toBe(false);
  });

  it('preserves Arm A scene 3 u659 as a semantic content mismatch, not proof of speaker identity', () => {
    const sceneThree = allScenes(armA)[2];
    expect(sceneThree).toBeDefined();
    const index = sceneThree.blocks.findIndex(b => b.kind === 'clip' && b.clipId.includes('_u659_u659'));
    expect(index).toBeGreaterThan(0);
    const lead = [...sceneThree.blocks.slice(0, index)].reverse()
      .find((b): b is Extract<Block, { kind: 'narration' }> => b.kind === 'narration');
    const tape = sceneThree.blocks[index] as Extract<Block, { kind: 'clip' }>;
    expect(lead?.text).toMatch(/He says so himself/i);
    expect(tape.keptText).toMatch(/You're being libeled/i);
    expect(readableA).toMatch(/\[TAPE Speaker 4, 2:15:35, u659/i);
    expect(reviewNotes).toMatch(/A, scene 3: confirmed by content/i);
    // No deterministic identity assertion follows from the raw Speaker 4 label.
  });

  it('treats Arm C four-word overlap as advisory, and the u5 speaker persona as uncertain', () => {
    const match = report.C.duplicates.find(d => d.shared >= 4);
    expect(match).toBeDefined();
    expect(match?.shared).toBe(4);
    expect(detectConsecutiveWordOverlap('the same imperative reasoning', match!.text, 4))
      .toBe('the same imperative reasoning');

    const narration = narrations(armC).find(n => n.text.includes('private screenshots being paraded'));
    expect(narration).toBeDefined();
    expect(narration?.text).toMatch(/unidentified speaker/i);
    expect(readableC).toMatch(/another unidentified speaker/i);
    expect(reviewNotes).toMatch(/C, scene 1: probable, not proven/i);
    expect(reviewNotes).toMatch(/u5/);
    // The draft paraphrases u5; it has no canonical tape block tagged u5.
    // Do not invent a source ID or mark this unidentified voice confirmed.
    expect(clips(armC).some(c => /_u5_u5(?:$|_)/.test(c.clipId))).toBe(false);
  });

  it('keeps positive archival controls traceable to their real clip IDs, not inferred identities', () => {
    const actualClips = clips(armC);
    expect(actualClips).toHaveLength(15);
    for (const utteranceId of ['u9', 'u13', 'u565', 'u566']) {
      const matches = actualClips.filter(c => c.clipId.includes('_' + utteranceId + '_' + utteranceId));
      expect(matches, utteranceId + ' must be a real canonical clip in the draft').toHaveLength(1);
      expect(matches[0].keptText.trim().length).toBeGreaterThan(0);
    }
    expect(narrations(armC).some(n => n.claims.some(c => c.releaseTag && c.verbatim))).toBe(true);
    expect(reviewNotes).toMatch(/matching "Speaker 1" labels prove nothing/i);
  });
});
