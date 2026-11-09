import { describe, it, expect } from 'vitest';
import {
  pairEvidenceAndTape,
  groundTapeBlock,
  groundClaims,
  type PairingOptions,
} from '../evidencePairing';
import type {
  ScriptProject,
  RecordingLibrary,
  EvidenceBoard,
  Segment,
  StudioClip,
  LibraryQuote,
} from '../scriptTypes';

const TAG = '20260826_1AxRnZYBVdrxl';
const HASH = 'hash_abc123';

const mockProject: ScriptProject = {
  id: 'proj_1',
  title: 'Test Project',
  createdAt: 1000,
  updatedAt: 1000,
  format: 'investigative',
  sourceTags: [TAG],
  targetRuntimeSec: 600,
  transcriptHashes: { [TAG]: HASH },
  speakerNames: { 'Speaker 1': 'Danielle' },
  clips: [
    {
      clipId: 'c1',
      title: 'Opening Clip',
      speaker: 'Speaker 1',
      releaseTag: TAG,
      audioUrl: '/audio/test.m4a',
      durationSec: 10,
      text: 'This is the exact quote text from the tape.',
      quote: 'q1',
    },
    {
      clipId: 'c2',
      title: 'Second Clip',
      speaker: 'Speaker 2',
      releaseTag: TAG,
      audioUrl: '/audio/test2.m4a',
      durationSec: 8,
      text: 'Another tape statement here.',
      quote: 'q2',
    },
  ],
  excludedClips: [],
  headVersionId: 'v1',
};

const mockQuote1: LibraryQuote = {
  id: 'q1',
  releaseTag: TAG,
  utteranceIds: ['utt_1', 'utt_2'],
  speakerLabel: 'Speaker 1',
  speakerName: 'Danielle',
  speakerConfirmed: true,
  verbatim: 'This is the exact quote text from the tape.',
  segStart: 10,
  segEnd: 20,
  text: { status: 'exact', checkedAt: 1000, transcriptHash: HASH },
  audio: { status: 'aligned', source: 'alignment', startSec: 10, endSec: 20 },
  about: 'Test quote',
  why: 'Relevance',
  type: 'evidence_claim',
  status: 'checkable',
  foundBy: [],
};

const mockQuote2: LibraryQuote = {
  id: 'q2',
  releaseTag: TAG,
  utteranceIds: ['utt_3'],
  speakerLabel: 'Speaker 2',
  speakerConfirmed: false, // generic diarization label, not confirmed
  verbatim: 'Another tape statement here.',
  segStart: 25,
  segEnd: 33,
  text: { status: 'exact', checkedAt: 1000, transcriptHash: HASH },
  audio: { status: 'needs_review' },
  about: 'Second quote',
  why: 'Relevance',
  type: 'admission',
  status: 'checkable',
  foundBy: [],
};

const mockLibrary: RecordingLibrary = {
  version: 1,
  releaseTag: TAG,
  transcriptHash: HASH,
  reads: [],
  notes: [],
  rejected: [],
  quotes: [mockQuote1, mockQuote2],
  aqLinks: [],
};

const mockBoard: EvidenceBoard = {
  version: 1,
  question: 'What occurred?',
  tapeBalance: 'balanced',
  recordings: [{ releaseTag: TAG, status: 'read' }],
  items: [
    { ref: 'q1', addedAt: 1000 },
    { ref: 'q2', addedAt: 1000 },
  ],
  claims: [
    {
      id: 'claim_1',
      text: 'Key allegation against the system',
      status: 'verified',
      supportRefs: ['q1'],
      contradictRefs: [],
    },
  ],
  sources: [
    {
      id: 'doc_src_1',
      docId: 'doc_100',
      label: 'Financial Audit Report',
      excerpt: 'Internal records show the ledger discrepancy was intentional.',
    },
  ],
};

describe('evidencePairing utility', () => {
  it('pairs positive adjacent narration lead-in to next directly associated tape block', () => {
    const segments: Segment[] = [
      {
        id: 'seg_1',
        title: 'Act I',
        scenes: [
          {
            id: 'sc_1',
            title: 'Introduction',
            purpose: 'Set up evidence',
            blocks: [
              {
                id: 'b_narr_1',
                kind: 'narration',
                text: 'Danielle recalled the moment she discovered the discrepancy.',
                mode: 'live',
                claims: [
                  {
                    releaseTag: TAG,
                    segStart: 10,
                    segEnd: 20,
                    speaker: 'Danielle',
                    verbatim: 'This is the exact quote text from the tape.',
                    quoteId: 'q1',
                  },
                ],
              },
              {
                id: 'b_clip_1',
                kind: 'clip',
                clipId: 'c1',
                keptText: 'This is the exact quote text from the tape.',
                inSec: 0,
                outSec: 10,
                trimBasis: 'segment',
                fn: 'evidence',
                rationale: 'Primary quote',
              },
            ],
          },
        ],
      },
    ];

    const opts: PairingOptions = {
      project: mockProject,
      segments,
      board: mockBoard,
      libraries: { [TAG]: mockLibrary },
    };

    const res = pairEvidenceAndTape(opts);
    expect(res.pairings).toHaveLength(1);
    const p = res.pairings[0];
    expect(p.pairingStatus).toBe('paired');
    expect(p.narrationBlockId).toBe('b_narr_1');
    expect(p.tapeBlock).toBeDefined();
    expect(p.tapeBlock?.blockId).toBe('b_clip_1');
    expect(p.tapeBlock?.quoteId).toBe('q1');
    expect(p.tapeBlock?.speakerConfirmed).toBe(true);
    expect(p.tapeBlock?.speakerName).toBe('Danielle');
    expect(p.tapeBlock?.provenanceStatus).toBe('verified');
    expect(res.unpairedTapeBlocks).toHaveLength(0);
  });

  it('handles multiple nearby clips connecting only to directly associated tape blocks', () => {
    const segments: Segment[] = [
      {
        id: 'seg_1',
        title: 'Act I',
        scenes: [
          {
            id: 'sc_1',
            title: 'Multiple Clips Scene',
            purpose: 'Contrast perspectives',
            blocks: [
              {
                id: 'b_narr_1',
                kind: 'narration',
                text: 'Danielle noted the first anomaly.',
                mode: 'live',
                claims: [],
              },
              {
                id: 'b_clip_1',
                kind: 'clip',
                clipId: 'c1',
                keptText: 'This is the exact quote text from the tape.',
                inSec: 0,
                outSec: 10,
                trimBasis: 'segment',
                fn: 'evidence',
                rationale: '',
              },
              {
                id: 'b_clip_2',
                kind: 'clip',
                clipId: 'c2',
                keptText: 'Another tape statement here.',
                inSec: 0,
                outSec: 8,
                trimBasis: 'segment',
                fn: 'counterpoint',
                rationale: '',
              },
              {
                id: 'b_narr_2',
                kind: 'narration',
                text: 'And that concluded the segment without further tape.',
                mode: 'live',
                claims: [],
              },
            ],
          },
        ],
      },
    ];

    const opts: PairingOptions = {
      project: mockProject,
      segments,
      board: mockBoard,
      libraries: { [TAG]: mockLibrary },
    };

    const res = pairEvidenceAndTape(opts);
    expect(res.pairings).toHaveLength(2);
    // First narration connects to the next directly associated tape block (b_clip_1)
    expect(res.pairings[0].narrationBlockId).toBe('b_narr_1');
    expect(res.pairings[0].tapeBlock?.blockId).toBe('b_clip_1');

    // Second narration has no downstream tape block
    expect(res.pairings[1].narrationBlockId).toBe('b_narr_2');
    expect(res.pairings[1].tapeBlock).toBeUndefined();
    expect(res.pairings[1].pairingStatus).toBe('unpaired');

    // b_clip_2 was not the immediate next tape block for any narration, so it is reported in unpairedTapeBlocks
    expect(res.unpairedTapeBlocks.some(tb => tb.blockId === 'b_clip_2')).toBe(true);
  });

  it('does not infer confirmed identity from generic diarization label', () => {
    const clipBlock: Extract<Segment['scenes'][0]['blocks'][0], { kind: 'clip' }> = {
      id: 'b_clip_generic',
      kind: 'clip',
      clipId: 'c2',
      keptText: 'Another tape statement here.',
      inSec: 0,
      outSec: 8,
      trimBasis: 'segment',
      fn: 'evidence',
      rationale: '',
    };

    const grounded = groundTapeBlock(
      clipBlock,
      { id: 'sc_1', title: 'Scene' },
      { id: 'seg_1', title: 'Segment' },
      { project: mockProject, board: mockBoard, libraries: { [TAG]: mockLibrary } }
    );

    expect(grounded.speakerRaw).toBe('Speaker 2');
    expect(grounded.speakerConfirmed).toBe(false);
    expect(grounded.speakerName).toBeUndefined();
  });

  it('marks unresolved provenance for archival clip references not in library/project', () => {
    const clipBlock: Extract<Segment['scenes'][0]['blocks'][0], { kind: 'clip' }> = {
      id: 'b_clip_missing',
      kind: 'clip',
      clipId: 'c_ghost_archive',
      keptText: 'Unrecorded archival remark.',
      inSec: 0,
      outSec: 5,
      trimBasis: 'full',
      fn: 'evidence',
      rationale: '',
    };

    const grounded = groundTapeBlock(
      clipBlock,
      { id: 'sc_1', title: 'Scene' },
      { id: 'seg_1', title: 'Segment' },
      { project: mockProject, board: mockBoard, libraries: { [TAG]: mockLibrary } }
    );

    expect(grounded.provenanceStatus).toBe('unresolved');
    expect(grounded.warnings.some(w => w.includes('Unresolved tape clip'))).toBe(true);
  });

  it('flags deterministic hash mismatch when recording library hash differs from project transcriptHashes', () => {
    const mismatchedLibrary: RecordingLibrary = {
      ...mockLibrary,
      transcriptHash: 'different_hash_999',
    };

    const clipBlock: Extract<Segment['scenes'][0]['blocks'][0], { kind: 'clip' }> = {
      id: 'b_clip_mismatch',
      kind: 'clip',
      clipId: 'c1',
      keptText: 'This is the exact quote text from the tape.',
      inSec: 0,
      outSec: 10,
      trimBasis: 'segment',
      fn: 'evidence',
      rationale: '',
    };

    const grounded = groundTapeBlock(
      clipBlock,
      { id: 'sc_1', title: 'Scene' },
      { id: 'seg_1', title: 'Segment' },
      { project: mockProject, board: mockBoard, libraries: { [TAG]: mismatchedLibrary } }
    );

    expect(grounded.provenanceStatus).toBe('hash_mismatch');
    expect(grounded.warnings.some(w => w.includes('Transcript hash mismatch'))).toBe(true);
  });

  it('grounds EvidenceBoard document sources without fabricating transcript citations', () => {
    const docClaims = [
      {
        releaseTag: '',
        segStart: 0,
        segEnd: 0,
        speaker: '',
        verbatim: 'Internal records show the ledger discrepancy was intentional.',
        quoteId: 'doc_src_1',
      },
    ];

    const grounded = groundClaims(docClaims, {
      project: { ...mockProject, evidenceDocs: [{
        id: 'doc_100', name: 'Financial Audit Report', addedAt: 1000,
        content: 'Internal records show the ledger discrepancy was intentional.',
      }] },
      board: mockBoard,
      libraries: { [TAG]: mockLibrary },
    });

    expect(grounded).toHaveLength(1);
    expect(grounded[0].sourceDocId).toBe('doc_100');
    expect(grounded[0].sourceDocExcerpt).toBe('Internal records show the ledger discrepancy was intentional.');
    expect(grounded[0].provenanceStatus).toBe('needs_review'); // Excerpt exists; interpretation is not verified.
    expect(grounded[0].statusNote).toContain('Exact document excerpt located');
    // Ensure no transcript-specific fields were fabricated
    expect(grounded[0].speakerConfirmed).toBe(false);
  });

  it('supports pre-Phase-4 projects with no board attached', () => {
    const prePhase4Project: ScriptProject = {
      ...mockProject,
      id: 'legacy_proj',
    };

    const segments: Segment[] = [
      {
        id: 'legacy_seg',
        title: 'Legacy Segment',
        scenes: [
          {
            id: 'legacy_scene',
            title: 'Legacy Scene',
            purpose: 'Legacy test',
            blocks: [
              {
                id: 'b_narr_legacy',
                kind: 'narration',
                text: 'Narration without board.',
                mode: 'live',
                claims: [],
              },
              {
                id: 'b_clip_legacy',
                kind: 'clip',
                clipId: 'c1',
                keptText: 'This is the exact quote text from the tape.',
                inSec: 0,
                outSec: 10,
                trimBasis: 'segment',
                fn: 'evidence',
                rationale: '',
              },
            ],
          },
        ],
      },
    ];

    const res = pairEvidenceAndTape({
      project: prePhase4Project,
      segments,
      board: null,
      libraries: { [TAG]: mockLibrary },
    });

    expect(res.pairings).toHaveLength(1);
    expect(res.pairings[0].pairingStatus).toBe('paired');
    expect(res.pairings[0].tapeBlock?.clipId).toBe('c1');
  });

  it('marks unlinked claims or claims without downstream tape as needs_review', () => {
    const unlinkedClaims = [
      {
        releaseTag: '',
        segStart: 0,
        segEnd: 0,
        speaker: 'Unknown',
        verbatim: 'Uncited floating assertion',
      },
    ];

    const grounded = groundClaims(unlinkedClaims, {
      project: mockProject,
      board: mockBoard,
      libraries: { [TAG]: mockLibrary },
    });

    expect(grounded).toHaveLength(1);
    expect(grounded[0].provenanceStatus).toBe('needs_review');
  });
});

describe('canonical provenance and pairing regression controls', () => {
  const makeBlock = (clipId: string) => ({
    id: 'tape', kind: 'clip' as const, clipId,
    keptText: 'This is the exact quote text from the tape.',
    inSec: 0, outSec: 10, trimBasis: 'full' as const,
    fn: 'evidence' as const, rationale: '',
  });
  const ground = (clipId: string, options: Partial<PairingOptions> = {}) =>
    groundTapeBlock(makeBlock(clipId), { id: 'sc', title: 'Scene' }, { id: 'seg', title: 'Segment' },
      { project: mockProject, libraries: { [TAG]: mockLibrary }, ...options });

  it('does not call a known project clip verified without canonical library evidence', () => {
    const block = ground('c1', { libraries: {} });
    expect(block.provenanceStatus).toBe('unresolved');
    expect(block.quoteId).toBeUndefined();
    expect(block.speakerConfirmed).toBe(false);
  });

  it('never uses a short text substring to guess quote ID or confirmed speaker', () => {
    const project = { ...mockProject, clips: [{
      ...mockProject.clips[0], clipId: 'loose', quote: 'quote text',
      text: 'the tape.',
    }] };
    const tape = ground('loose', { project });
    expect(tape.quoteId).toBeUndefined();
    expect(tape.provenanceStatus).toBe('unresolved');
    expect(tape.speakerConfirmed).toBe(false);
  });

  it('does not treat a clip review flag as a release tag', () => {
    const tape = groundTapeBlock({ ...makeBlock('unknown'), flag: 'needs_review: failed trim' },
      { id: 'sc', title: 'Scene' }, { id: 'seg', title: 'Segment' },
      { project: { ...mockProject, clips: [] }, libraries: {} });
    expect(tape.releaseTag).toBeUndefined();
    expect(tape.provenanceStatus).toBe('unresolved');
  });

  it('flags a narrated q2 claim paired to adjacent q1 tape for editorial review', () => {
    const segments: Segment[] = [{ id: 's', title: 'S', scenes: [{
      id: 'sc', title: 'Scene', purpose: 'Test', blocks: [
        { id: 'n', kind: 'narration', mode: 'live', text: 'The witness said so.', claims: [{
          releaseTag: TAG, segStart: 25, segEnd: 33, speaker: 'Speaker 2',
          verbatim: mockQuote2.verbatim, quoteId: 'q2',
        }] },
        makeBlock('c1'),
      ],
    }] }];
    const res = pairEvidenceAndTape({ project: mockProject, segments, libraries: { [TAG]: mockLibrary } });
    expect(res.pairings[0].pairingStatus).toBe('needs_review');
    expect(res.pairings[0].pairingNote).toContain('different quote');
  });

  it('preserves unresolved BoardClaim support references without inventing tape provenance', () => {
    const board: EvidenceBoard = { ...mockBoard, claims: [{
      id: 'claim_empty', text: 'Contested account', status: 'verified',
      supportRefs: [], contradictRefs: [],
    }] };
    const refs = groundClaims([{
      releaseTag: '', segStart: 0, segEnd: 0, speaker: '',
      verbatim: 'Contested account', quoteId: 'claim_empty',
    }], { project: mockProject, board });
    expect(refs[0].boardClaimId).toBe('claim_empty');
    expect(refs[0].supportRefs).toEqual([]);
    expect(refs[0].provenanceStatus).toBe('needs_review');
    expect(refs[0].sourceDocId).toBeUndefined();
  });

  it('resolves canonical aq: quote clip IDs using exact AQ links and transcript hashes', () => {
    const aq = {
      aqId: 'AQ-0207', utteranceIds: ['u1'], speakerLabels: ['Speaker 9'],
      text: { status: 'exact' as const, checkedAt: 1, transcriptHash: HASH, transcriptSpan: 'quoted words here' },
      audio: { status: 'aligned' as const, source: 'alignment' as const, startSec: 10, endSec: 12 },
      speakerConfirmed: false,
    };
    const library: RecordingLibrary = { ...mockLibrary, aqLinks: [aq] };
    const clipId = 'bq_aq_AQ-0207';
    const clip: StudioClip = { ...mockProject.clips[0], clipId, text: 'quoted words here' };
    const tape = groundTapeBlock({ ...makeBlock(clipId), keptText: 'quoted words here' },
      { id: 'sc', title: 'Scene' }, { id: 'seg', title: 'Segment' },
      { project: { ...mockProject, clips: [clip] }, libraries: { [TAG]: library } });
    expect(tape.quoteId).toBe('aq:AQ-0207');
    expect(tape.provenanceStatus).toBe('verified');
    expect(tape.speakerConfirmed).toBe(false);
    expect(tape.utteranceIds).toEqual(['u1']);
  });

  it('treats a transcript hash mismatch as a hard provenance discrepancy, not verified', () => {
    const lib: RecordingLibrary = { ...mockLibrary, transcriptHash: 'changed_hash' };
    expect(ground('c1', { libraries: { [TAG]: lib } }).provenanceStatus).toBe('hash_mismatch');
  });
});
