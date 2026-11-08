import { describe, it, expect } from 'vitest';
import { computePeaksFromChannelData, extractPeaksFromAudioBuffer } from '../audioPeaks';

describe('audioPeaks utility', () => {
  it('computes peaks from Float32Array channel data correctly', () => {
    // Generate dummy audio wave: alternating loud and quiet blocks
    const samples = new Float32Array(1000);
    for (let i = 0; i < 500; i++) {
      samples[i] = 0.8 * Math.sin(i * 0.1); // loud section
    }
    for (let i = 500; i < 1000; i++) {
      samples[i] = 0.05 * Math.sin(i * 0.1); // quiet section
    }

    const peaks = computePeaksFromChannelData(samples, 10);
    expect(peaks).toHaveLength(10);
    // All peaks should be bounded between 15% and 95%
    peaks.forEach(p => {
      expect(p).toBeGreaterThanOrEqual(15);
      expect(p).toBeLessThanOrEqual(95);
    });

    // First half (bars 0-4) should be higher than second half (bars 5-9)
    const firstHalfAvg = peaks.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const secondHalfAvg = peaks.slice(5).reduce((a, b) => a + b, 0) / 5;
    expect(firstHalfAvg).toBeGreaterThan(secondHalfAvg);
  });

  it('handles empty or zero-length audio gracefully', () => {
    const empty = new Float32Array(0);
    const peaks = computePeaksFromChannelData(empty, 32);
    expect(peaks).toHaveLength(32);
    peaks.forEach(p => expect(p).toBe(30));
  });

  it('extracts peaks from mocked AudioBuffer', () => {
    const mockChannel = new Float32Array(200);
    for (let i = 0; i < 200; i++) mockChannel[i] = 0.5;

    const mockBuffer = {
      length: 200,
      numberOfChannels: 1,
      sampleRate: 44100,
      duration: 200 / 44100,
      getChannelData: () => mockChannel,
    } as unknown as AudioBuffer;

    const peaks = extractPeaksFromAudioBuffer(mockBuffer, 20);
    expect(peaks).toHaveLength(20);
    expect(peaks[0]).toBeGreaterThan(50);
  });
});
