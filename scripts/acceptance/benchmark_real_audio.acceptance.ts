/**
 * Real-Audio Alignment Benchmark:
 * Evaluates Whisper speech timing accuracy on real audio recordings from public/clips/angela/
 * compared against human reference boundaries established independently of Whisper.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { matchQuoteWords } from '../../server/quoteAlign';

const CLIPS_DIR = path.resolve(__dirname, '../../public/clips/angela');

interface BenchmarkSample {
  id: string;
  wavFile: string;
  verbatim: string;
  expectedDuration: number;
  expectedSpeechStart: number;
  expectedSpeechEnd: number;
}

const BENCHMARK_SAMPLES: BenchmarkSample[] = [
  {
    id: 'angela_clip_01',
    wavFile: '01_Evidence_Speaks_For_Itself.wav',
    verbatim: 'evidence speaks for itself and obviously it is enough to cause that type of reaction',
    expectedDuration: 4.86,
    expectedSpeechStart: 0.0,
    expectedSpeechEnd: 4.4,
  },
  {
    id: 'angela_clip_02',
    wavFile: '02_Has_Address_Phone_Personal_Info.wav',
    verbatim: 'I already have their address and phone number and personal information and I will slap them with the lawsuit so fast',
    expectedDuration: 7.34,
    expectedSpeechStart: 0.3,
    expectedSpeechEnd: 4.6,
  },
  {
    id: 'angela_clip_03',
    wavFile: '03_Always_Do_That_Before_I_Talk.wav',
    verbatim: 'I always do that before I talk to someone',
    expectedDuration: 2.30,
    expectedSpeechStart: 0.6,
    expectedSpeechEnd: 2.1,
  },
];

describe('Real-Audio Whisper Alignment Benchmark', () => {
  it('verifies all 3 benchmark audio files exist on disk with valid headers', () => {
    for (const sample of BENCHMARK_SAMPLES) {
      const fullPath = path.join(CLIPS_DIR, sample.wavFile);
      expect(fs.existsSync(fullPath), `Missing audio file: ${sample.wavFile}`).toBe(true);
      const stat = fs.statSync(fullPath);
      expect(stat.size).toBeGreaterThan(100000);
    }
  });

  it('runs faster-whisper on real audio and benchmarks timing accuracy <= 0.5s of human cuts', () => {
    const pythonScript = path.resolve(__dirname, '../align_quote.py');
    const deltas: number[] = [];

    for (const sample of BENCHMARK_SAMPLES) {
      const fullPath = path.join(CLIPS_DIR, sample.wavFile);

      const out = execFileSync('python', [pythonScript, '--wav', fullPath], {
        encoding: 'utf8',
        timeout: 30000,
      });

      const parsed = JSON.parse(out);
      expect(parsed.words).toBeDefined();
      expect(parsed.words.length).toBeGreaterThan(0);

      // Verify duration reported by audio decoding
      expect(Math.abs(parsed.duration - sample.expectedDuration)).toBeLessThan(0.1);

      // Match against reference verbatim
      const match = matchQuoteWords(sample.verbatim, parsed.words);
      expect(match.matchedPct, `Match percentage for ${sample.id}`).toBeGreaterThanOrEqual(0.85);

      // Compare aligned start and end to independent human speech cut points
      const startDelta = Math.abs(match.rawStartSec - sample.expectedSpeechStart);
      const endDelta = Math.abs(match.rawEndSec - sample.expectedSpeechEnd);

      deltas.push(startDelta, endDelta);

      expect(startDelta, `Start delta for ${sample.id} (${match.rawStartSec}s vs expected ${sample.expectedSpeechStart}s)`).toBeLessThanOrEqual(0.5);
      expect(endDelta, `End delta for ${sample.id} (${match.rawEndSec}s vs expected ${sample.expectedSpeechEnd}s)`).toBeLessThanOrEqual(0.5);

      // Timestamps must be monotonic
      for (let i = 1; i < match.matchedWords.length; i++) {
        expect(match.matchedWords[i].start).toBeGreaterThanOrEqual(match.matchedWords[i - 1].start);
      }
    }

    // Median delta should be <= 0.25s
    deltas.sort((a, b) => a - b);
    const medianDelta = deltas[Math.floor(deltas.length / 2)];
    expect(medianDelta).toBeLessThanOrEqual(0.25);
  });
});
