import { describe, it, expect } from 'vitest';
import { parseClipItem, parseClipCatalog } from '../contracts/clipCatalog';
import { normalizeTimestampToSeconds, parseTranscriptSegments, parseEpisodeSummaries } from '../contracts/transcript';

describe('Contracts: clipCatalog', () => {
  it('parses valid clip items with type coercion and duration calculation', () => {
    const raw = {
      title: 'Breaking news on tech',
      category: 'Golden Quotes',
      start_seconds: '12.5',
      end_seconds: '45.0',
      viral_score: '9',
      speakers: ['Logan', 'Guest'],
      reason: 'Key insight',
      transcript_snippet: 'This is the quote snippet',
    };
    const clip = parseClipItem(raw);
    expect(clip).not.toBeNull();
    expect(clip?.start_seconds).toBe(12.5);
    expect(clip?.end_seconds).toBe(45.0);
    expect(clip?.duration).toBe(32.5);
    expect(clip?.viral_score).toBe(9);
    expect(clip?.speakers).toEqual(['Logan', 'Guest']);
  });

  it('rejects clips where end_seconds <= start_seconds', () => {
    const invalid = {
      title: 'Bad clip',
      start_seconds: 50,
      end_seconds: 40,
    };
    expect(parseClipItem(invalid)).toBeNull();
  });

  it('parses catalog array safely skipping corrupted entries', () => {
    const catalog = [
      { title: 'Good 1', start_seconds: 1, end_seconds: 10 },
      { title: 'Corrupt', start_seconds: 50, end_seconds: 20 },
      { title: 'Good 2', start_seconds: '10', end_seconds: '25' },
    ];
    const parsed = parseClipCatalog(catalog);
    expect(parsed.length).toBe(2);
    expect(parsed[0].title).toBe('Good 1');
    expect(parsed[1].title).toBe('Good 2');
  });
});

describe('Contracts: transcript', () => {
  it('normalizes legacy millisecond timestamps correctly', () => {
    expect(normalizeTimestampToSeconds(125000)).toBe(125);
    expect(normalizeTimestampToSeconds(45.5)).toBe(45.5);
    expect(normalizeTimestampToSeconds('150000', 1000)).toBe(150);
  });

  it('parses transcript segments with speaker and text', () => {
    const segments = [
      { start: 0, end: 10, speaker: 'Host', text: 'Hello world' },
      { start: 10, end: 20, speaker: 'Guest', text: 'Thank you' },
    ];
    const parsed = parseTranscriptSegments(segments);
    expect(parsed.length).toBe(2);
    expect(parsed[0].speaker).toBe('Host');
    expect(parsed[1].text).toBe('Thank you');
  });

  it('parses episode summaries properly', () => {
    const summaries = [
      {
        release_id: 12345,
        release_tag: '20260220_1MYGNgPOMBzJw',
        title: 'Space #42',
        published_at: '2026-02-20T12:00:00Z',
        audio_url: 'https://example.com/audio.mp3',
        segment_count: 50,
        speakers: ['Host'],
      },
    ];
    const parsed = parseEpisodeSummaries(summaries);
    expect(parsed.length).toBe(1);
    expect(parsed[0].release_tag).toBe('20260220_1MYGNgPOMBzJw');
  });
});
