import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  matchQuoteWords,
  decodeWavPcm16,
  alignQuoteAudio,
  reviewQuoteAudio,
  quoteToStudioClip,
  type RecognizedWord,
} from '../../server/quoteAlign';
import type { AudioBoundary, ScriptProject, ScriptVersion, StudioClip } from '../scriptTypes';
import { compileScript } from '../scriptCompile';

describe('quoteAlign - word matching and boundary calculation', () => {
  it('matches verbatim quote words in order and computes percentages', () => {
    const verbatim = 'the evidence speaks for itself and obviously it is enough';
    const recognized: RecognizedWord[] = [
      { word: 'well', start: 0.1, end: 0.3 },
      { word: 'the', start: 0.4, end: 0.6 },
      { word: 'evidence', start: 0.65, end: 1.0 },
      { word: 'speaks', start: 1.05, end: 1.3 },
      { word: 'for', start: 1.35, end: 1.5 },
      { word: 'itself', start: 1.55, end: 1.8 },
      { word: 'and', start: 1.85, end: 2.0 },
      { word: 'obviously', start: 2.05, end: 2.5 },
      { word: 'it', start: 2.55, end: 2.7 },
      { word: 'is', start: 2.75, end: 2.9 },
      { word: 'enough', start: 2.95, end: 3.4 },
      { word: 'today', start: 3.45, end: 3.8 },
    ];

    const match = matchQuoteWords(verbatim, recognized);
    expect(match.totalQuoteWords).toBe(10);
    expect(match.matchedPct).toBe(1.0);
    expect(match.matchedWords).toHaveLength(10);
    expect(match.rawStartSec).toBe(0.4);
    expect(match.rawEndSec).toBe(3.4);
    expect(match.rawDurationSec).toBe(3.0);
  });

  it('rejects jumbled word orders and only matches monotonically ascending words', () => {
    const verbatim = 'alpha beta gamma delta';
    const recognized: RecognizedWord[] = [
      { word: 'gamma', start: 0.1, end: 0.4 },
      { word: 'alpha', start: 0.5, end: 0.8 },
      { word: 'delta', start: 0.9, end: 1.2 },
      { word: 'beta', start: 1.3, end: 1.6 },
    ];

    const match = matchQuoteWords(verbatim, recognized);
    // In order subsequence can at most match 2 words (e.g. alpha -> delta or gamma -> delta)
    expect(match.matchedPct).toBeLessThan(0.85);
  });

  it('decodes 16-bit PCM WAV headers and sample data into Float32Array', () => {
    const sampleRate = 16000;
    const numSamples = 1600; // 0.1 sec
    const buf = Buffer.alloc(44 + numSamples * 2);

    // RIFF header
    buf.write('RIFF', 0);
    buf.writeUInt32LE(36 + numSamples * 2, 4);
    buf.write('WAVE', 8);

    // fmt chunk
    buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20); // PCM
    buf.writeUInt16LE(1, 22); // mono
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
    buf.writeUInt16LE(2, 32); // block align
    buf.writeUInt16LE(16, 34); // bits per sample

    // data chunk
    buf.write('data', 36);
    buf.writeUInt32LE(numSamples * 2, 40);

    for (let i = 0; i < numSamples; i++) {
      buf.writeInt16LE(16384, 44 + i * 2); // 0.5 amplitude
    }

    const decoded = decodeWavPcm16(buf);
    expect(decoded).not.toBeNull();
    expect(decoded?.sampleRate).toBe(16000);
    expect(decoded?.data.length).toBe(numSamples);
    expect(decoded?.data[0]).toBeCloseTo(0.5, 2);
  });

  it('alignQuoteAudio produces status "aligned" on confident matches with padding and snapping', async () => {
    const tempDir = path.join(process.cwd(), '.spacepipe-studio', 'test-align-' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      const mockWords: RecognizedWord[] = [
        { word: 'we', start: 1.0, end: 1.2 },
        { word: 'have', start: 1.25, end: 1.4 },
        { word: 'all', start: 1.45, end: 1.6 },
        { word: 'the', start: 1.65, end: 1.8 },
        { word: 'receipts', start: 1.85, end: 2.3 },
      ];

      const res = await alignQuoteAudio(
        {
          releaseTag: 'test_ep',
          verbatim: 'we have all the receipts',
          segStart: 10.0,
          segEnd: 15.0,
          audioUrl: 'https://github.com/test/repo/releases/download/test_ep/audio.mp3',
        },
        {
          baseCacheDir: tempDir,
          cutWindow: async () => 'mock.wav',
          runWhisper: async () => ({ words: mockWords, duration: 5.0 }),
          getAudioData: async () => ({ data: new Float32Array(16000 * 5), sampleRate: 16000 }),
        }
      );

      expect(res.status).toBe('aligned');
      expect(res.source).toBe('alignment');
      expect(res.matchedPct).toBe(1.0);
      // cutStart = segStart - 1.0 = 9.0
      // rawStart = 1.0, paddedStart = 0.85 -> epStart = 9.0 + 0.85 = 9.85
      // rawEnd = 2.3, paddedEnd = 2.45 -> epEnd = 9.0 + 2.45 = 11.45
      expect(res.startSec).toBeCloseTo(9.85, 2);
      expect(res.endSec).toBeCloseTo(11.45, 2);
      expect(res.words).toHaveLength(5);

      // Verify cached read makes 0 cuts and 0 whisper calls
      let called = false;
      const cachedRes = await alignQuoteAudio(
        {
          releaseTag: 'test_ep',
          verbatim: 'we have all the receipts',
          segStart: 10.0,
          segEnd: 15.0,
          audioUrl: 'https://github.com/test/repo/releases/download/test_ep/audio.mp3',
        },
        {
          baseCacheDir: tempDir,
          cutWindow: async () => {
            called = true;
            return 'mock.wav';
          },
          runWhisper: async () => {
            called = true;
            return { words: [], duration: 0 };
          },
        }
      );

      expect(called).toBe(false);
      expect(cachedRes).toEqual(res);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('alignQuoteAudio marks status "needs_review" when match percentage is below 85%', async () => {
    const tempDir = path.join(process.cwd(), '.spacepipe-studio', 'test-align-' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      const mockWords: RecognizedWord[] = [
        { word: 'totally', start: 0.5, end: 0.9 },
        { word: 'different', start: 1.0, end: 1.4 },
        { word: 'speech', start: 1.5, end: 2.0 },
      ];

      const res = await alignQuoteAudio(
        {
          releaseTag: 'test_ep',
          verbatim: 'an entirely different set of twelve long complex words that did not happen',
          segStart: 20.0,
          segEnd: 25.0,
          audioUrl: 'https://github.com/test/repo/releases/download/test_ep/audio.mp3',
        },
        {
          baseCacheDir: tempDir,
          cutWindow: async () => 'mock.wav',
          runWhisper: async () => ({ words: mockWords, duration: 5.0 }),
          getAudioData: async () => null,
        }
      );

      expect(res.status).toBe('needs_review');
      expect(res.startSec).toBeUndefined();
      expect(res.endSec).toBeUndefined();
      expect(res.suggestedStartSec).toBeDefined();
      expect(res.suggestedEndSec).toBeDefined();
      expect(res.reason).toContain('matched recognized audio');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('reviewQuoteAudio supports approve, nudge, and set_range actions', () => {
    const initial: AudioBoundary = {
      status: 'needs_review',
      suggestedStartSec: 10.0,
      suggestedEndSec: 15.0,
      matchedPct: 0.75,
      reason: 'Low match percentage',
    };

    // Nudge boundaries
    const nudged = reviewQuoteAudio(initial, { action: 'nudge', deltaStartSec: -0.25, deltaEndSec: 0.25 });
    expect(nudged.suggestedStartSec).toBe(9.75);
    expect(nudged.suggestedEndSec).toBe(15.25);

    // Set range
    const ranged = reviewQuoteAudio(nudged, { action: 'set_range', startSec: 9.5, endSec: 15.5 });
    expect(ranged.suggestedStartSec).toBe(9.5);
    expect(ranged.suggestedEndSec).toBe(15.5);

    // Approve
    const approved = reviewQuoteAudio(ranged, { action: 'approve' });
    expect(approved.status).toBe('verified');
    expect(approved.source).toBe('manual');
    expect(approved.startSec).toBe(9.5);
    expect(approved.endSec).toBe(15.5);
    expect(approved.reviewedAt).toBeGreaterThan(0);
  });

  it('quoteToStudioClip creates usable StudioClip only for aligned/verified quotes and rejects needs_review', () => {
    const unreviewed: AudioBoundary = {
      status: 'needs_review',
      suggestedStartSec: 12.0,
      suggestedEndSec: 16.0,
    };

    expect(
      quoteToStudioClip(
        {
          id: 'q1',
          verbatim: 'This has not been reviewed.',
          speakerName: 'Angela',
          audio: unreviewed,
          releaseTag: 'tag1',
        },
        'https://github.com/repo/releases/download/tag1/audio.mp3'
      )
    ).toBeNull();

    const aligned: AudioBoundary = {
      status: 'aligned',
      source: 'alignment',
      startSec: 12.0,
      endSec: 16.0,
    };

    const clip = quoteToStudioClip(
      {
        id: 'q1',
        verbatim: 'This is verified and aligned.',
        speakerName: 'Angela',
        audio: aligned,
        releaseTag: 'tag1',
      },
      'https://github.com/repo/releases/download/tag1/audio.mp3'
    );

    expect(clip).not.toBeNull();
    expect(clip?.clipId).toBe('bq_q1');
    expect(clip?.audioOffsetSec).toBe(12.0);
    expect(clip?.durationSec).toBe(4.0);
    expect(clip?.speaker).toBe('Angela');
  });

  it('compileScript blocks compilation if tape has needs_review audio status or exceeds duration', () => {
    const project: ScriptProject = {
      id: 'prj_test',
      title: 'Test Documentary',
      format: 'investigative',
      thesis: 'Investigative thesis',
      sourceTags: ['tag1'],
      targetRuntimeSec: 60,
      transcriptHashes: {},
      excludedClips: [],
      clips: [
        {
          clipId: 'bq_q_needs_review',
          title: 'Unreviewed Quote',
          text: 'Unreviewed quote audio',
          speaker: 'Speaker',
          releaseTag: 'tag1',
          audioUrl: 'https://github.com/repo/releases/download/tag1/audio.mp3',
          audioOffsetSec: 10,
          durationSec: 5,
          fn: 'evidence',
          audioStatus: 'needs_review',
        } as any,
        {
          clipId: 'bq_q_too_long',
          title: 'Too Long Quote',
          text: 'Too long tape block',
          speaker: 'Speaker',
          releaseTag: 'tag1',
          audioUrl: 'https://github.com/repo/releases/download/tag1/audio.mp3',
          audioOffsetSec: 20,
          durationSec: 4.0,
          fn: 'evidence',
        },
      ],
      speakerNames: {},
      headVersionId: 'v1',
      createdAt: 1,
      updatedAt: 1,
    };

    const version: ScriptVersion = {
      id: 'v1',
      parentId: null,
      projectId: 'prj_test',
      author: 'logan',
      createdAt: 1,
      segments: [
        {
          id: 'seg1',
          title: 'Act 1',
          scenes: [
            {
              id: 'sc1',
              title: 'Scene 1',
              purpose: 'test',
              blocks: [
                {
                  id: 'b1',
                  kind: 'clip',
                  clipId: 'bq_q_needs_review',
                  keptText: 'Unreviewed quote audio',
                  inSec: 0,
                  outSec: 5,
                  trimBasis: 'full',
                  rationale: '',
                  fn: 'evidence',
                },
              ],
            },
          ],
        },
      ],
    };

    const res = compileScript(project, version);
    expect(res.ok).toBe(false);
    expect(res.blocked.some(b => b.reason.includes('needs_review') || b.reason.includes('review'))).toBe(true);
  });
});
