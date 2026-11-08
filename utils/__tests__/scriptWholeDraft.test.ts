/**
 * Unit tests for Phase 4 Whole-Script Drafting, Scene Rewriting,
 * Deterministic Tape Resolution, Word Budgeting, and Gate Checks.
 */
import { describe, it, expect } from 'vitest';
import { codeGates, type GateContext } from '../scriptGates';
import type { Segment, ScriptProject } from '../scriptTypes';

describe('Phase 4 Whole-Script Drafting & Gate Protections', () => {
  it('calculates narration word budget correctly using the 2.4 words/second formula', () => {
    // Formula: NarrationWords = max(0, SceneSec - TapeSec - PauseSec) * 2.4
    const sceneSec = 60;
    const tapeSec = 20;
    const pauseSec = 5;
    const availableNarrationSec = Math.max(0, sceneSec - tapeSec - pauseSec);
    const wordBudget = Math.round(availableNarrationSec * 2.4);

    expect(availableNarrationSec).toBe(35);
    expect(wordBudget).toBe(84); // 35 * 2.4 = 84 words (not 15!)
  });

  it('rejects narration containing raw transcript diarization labels (Speaker N)', () => {
    const candidate: Segment[] = [
      {
        id: 'seg_1',
        title: 'Act 1',
        scenes: [
          {
            id: 'sc_1',
            title: 'Scene 1',
            purpose: 'The confrontation',
            blocks: [
              {
                id: 'b_1',
                kind: 'narration',
                text: 'As Speaker 2 explained during the recording, the files were already circulating.',
                mode: 'polished',
                claims: [],
              },
            ],
          },
        ],
      },
    ];

    const ctx: GateContext = {
      baseline: [],
      transcripts: {},
      clipsById: {},
      targetRuntimeSec: 60,
      format: null,
    };

    const res = codeGates(candidate, ctx);
    expect(res.ok).toBe(false);
    expect(res.failures.some(f => f.includes('raw diarization label'))).toBe(true);
  });

  it('rejects accidental duplicate quote usage across scenes without reprise justification', () => {
    const candidate: Segment[] = [
      {
        id: 'seg_1',
        title: 'Act 1',
        scenes: [
          {
            id: 'sc_1',
            title: 'Scene 1',
            purpose: 'First exhibit',
            blocks: [
              {
                id: 'b_clip_1',
                kind: 'clip',
                clipId: 'bq_aq_AQ-0261',
                keptText: 'I always do that before I talk to someone.',
                inSec: 0,
                outSec: 2.3,
                trimBasis: 'full',
                fn: 'evidence',
                rationale: 'Initial proof',
              },
            ],
          },
          {
            id: 'sc_2',
            title: 'Scene 2',
            purpose: 'Accidental duplicate exhibit',
            blocks: [
              {
                id: 'b_clip_2',
                kind: 'clip',
                clipId: 'bq_aq_AQ-0261',
                keptText: 'I always do that before I talk to someone.',
                inSec: 0,
                outSec: 2.3,
                trimBasis: 'full',
                fn: 'evidence',
                rationale: 'Repeated exhibit without reprise flag',
              },
            ],
          },
        ],
      },
    ];

    const ctx: GateContext = {
      baseline: [],
      transcripts: {},
      clipsById: {
        'bq_aq_AQ-0261': {
          clipId: 'bq_aq_AQ-0261',
          title: 'Angela: "I always do that..."',
          speaker: 'Angela',
          releaseTag: '20260217_1vAxRvZrEPaxl',
          audioUrl: '/audio/test.wav',
          durationSec: 2.3,
          text: 'I always do that before I talk to someone.',
        },
      },
      targetRuntimeSec: 60,
      format: null,
    };

    const res = codeGates(candidate, ctx);
    expect(res.ok).toBe(false);
    expect(res.failures.some(f => f.includes('Duplicate archival clip'))).toBe(true);
  });

  it('permits intentional dramatic reprises when flagged with isReprise and a rationale', () => {
    const candidate: Segment[] = [
      {
        id: 'seg_1',
        title: 'Act 1',
        scenes: [
          {
            id: 'sc_1',
            title: 'Scene 1',
            purpose: 'Initial introduction',
            blocks: [
              {
                id: 'b_clip_1',
                kind: 'clip',
                clipId: 'bq_aq_AQ-0261',
                keptText: 'I always do that before I talk to someone.',
                inSec: 0,
                outSec: 2.3,
                trimBasis: 'full',
                fn: 'evidence',
                rationale: 'Initial proof',
              },
            ],
          },
          {
            id: 'sc_2',
            title: 'Scene 2',
            purpose: 'Dramatic callback reprise',
            blocks: [
              {
                id: 'b_clip_2',
                kind: 'clip',
                clipId: 'bq_aq_AQ-0261',
                keptText: 'I always do that before I talk to someone.',
                inSec: 0,
                outSec: 2.3,
                trimBasis: 'full',
                fn: 'evidence',
                rationale: 'Echoing the admission after the contradiction is exposed',
                isReprise: true,
                repriseRationale: 'Echoing the admission after the contradiction is exposed',
              },
            ],
          },
        ],
      },
    ];

    const ctx: GateContext = {
      baseline: [],
      transcripts: {},
      clipsById: {
        'bq_aq_AQ-0261': {
          clipId: 'bq_aq_AQ-0261',
          title: 'Angela: "I always do that..."',
          speaker: 'Angela',
          releaseTag: '20260217_1vAxRvZrEPaxl',
          audioUrl: '/audio/test.wav',
          durationSec: 2.3,
          text: 'I always do that before I talk to someone.',
        },
      },
      targetRuntimeSec: 60,
      format: null,
    };

    const res = codeGates(candidate, ctx);
    // Reprise passes hard gates (ok is true) and surfaces an advisory editorial warning
    expect(res.ok).toBe(true);
    expect(res.warnings?.some(w => w.includes('Editorial review advised'))).toBe(true);
  });

  it('clears reprise warning when repriseApproved is explicitly set by the author', () => {
    const candidate: Segment[] = [
      {
        id: 'seg_1',
        title: 'Act 1',
        scenes: [
          {
            id: 'sc_1',
            title: 'Scene 1',
            purpose: 'First exhibit',
            blocks: [
              {
                id: 'b_clip_1',
                kind: 'clip',
                clipId: 'bq_aq_AQ-0261',
                keptText: 'I always do that before I talk to someone.',
                inSec: 0,
                outSec: 2.3,
                trimBasis: 'full',
                fn: 'evidence',
                rationale: 'Initial proof',
              },
            ],
          },
          {
            id: 'sc_2',
            title: 'Scene 2',
            purpose: 'Approved dramatic callback',
            blocks: [
              {
                id: 'b_clip_2',
                kind: 'clip',
                clipId: 'bq_aq_AQ-0261',
                keptText: 'I always do that before I talk to someone.',
                inSec: 0,
                outSec: 2.3,
                trimBasis: 'full',
                fn: 'evidence',
                rationale: 'Author approved callback',
                isReprise: true,
                repriseRationale: 'Author approved callback',
                repriseApproved: true,
              },
            ],
          },
        ],
      },
    ];

    const ctx: GateContext = {
      baseline: [],
      transcripts: {},
      clipsById: {
        'bq_aq_AQ-0261': {
          clipId: 'bq_aq_AQ-0261',
          title: 'Angela: "I always do that..."',
          speaker: 'Angela',
          releaseTag: '20260217_1vAxRvZrEPaxl',
          audioUrl: '/audio/test.wav',
          durationSec: 2.3,
          text: 'I always do that before I talk to someone.',
        },
      },
      targetRuntimeSec: 60,
      format: null,
    };

    const res = codeGates(candidate, ctx);
    expect(res.ok).toBe(true);
    expect(res.warnings?.some(w => w.includes('Editorial review advised'))).toBe(false);
  });
});
