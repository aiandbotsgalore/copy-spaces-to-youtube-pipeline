import { describe, expect, it } from 'vitest';
import {
  enrichPlaceholderClipMetadata,
  hasPlaceholderClipMetadata,
} from '../clipMetadata';

const clip = {
  title: 'The Epic Wall Ricochet',
  category: 'Highlights',
  start_seconds: 85,
  end_seconds: 145,
  duration: 60,
  speakers: ['Speaker'],
  viral_score: 8,
  reason: 'AI selected highlight moment from 1 minute of Motivational Music played 60x.',
  transcript_snippet: 'Highlight moment from 1 minute of Motivational Music played 60x',
  episode: '1 minute of Motivational Music played 60x',
} as any;

describe('clip metadata enrichment', () => {
  it('recognizes the release-title placeholder', () => {
    expect(hasPlaceholderClipMetadata(clip)).toBe(true);
    expect(hasPlaceholderClipMetadata({
      reason: 'The Epic Wall Ricochet is a 60-second highlight beginning at 1:25.',
      transcript_snippet: 'The Epic Wall Ricochet (1:25–2:25)',
    })).toBe(true);
    expect(hasPlaceholderClipMetadata({ reason: 'A real explanation', transcript_snippet: 'A real quote' })).toBe(false);
  });

  it('uses the overlapping transcript turns for the reason and quote', () => {
    const enriched = enrichPlaceholderClipMetadata(clip, [
      { start: 87.02, end: 89.28, speaker: 'Logan', text: 'I ricochet up off the walls. Nothing.' },
      { start: 118.84, end: 119.64, speaker: 'Logan', text: 'You want to see it.' },
    ]);

    expect(enriched.reason).toContain('The Epic Wall Ricochet');
    expect(enriched.reason).toContain('I ricochet up off the walls. Nothing.');
    expect(enriched.transcript_snippet).toContain('Logan: I ricochet up off the walls. Nothing.');
    expect(enriched.reason).not.toContain('Motivational Music played 60x');
  });

  it('still gives a title and timing-specific fallback when no transcript is available', () => {
    const enriched = enrichPlaceholderClipMetadata(clip, []);

    expect(enriched.reason).toBe('The Epic Wall Ricochet is a 60-second highlight beginning at 1:25.');
    expect(enriched.transcript_snippet).toBe('The Epic Wall Ricochet (1:25–2:25)');
  });
});
