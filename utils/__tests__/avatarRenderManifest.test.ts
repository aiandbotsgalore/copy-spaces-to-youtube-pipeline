import { describe, expect, it } from 'vitest';
import { buildAvatarRenderManifest } from '../avatarRenderManifest';

const clip: any = { title: 'test', category: 'Highlights', start_seconds: 10, end_seconds: 12, duration: 2, speakers: ['A', 'B'], viral_score: 8, reason: '', transcript_snippet: '' };

describe('speaker-aware avatar dispatch manifest', () => {
  it('uses stable speaker ids and clip-relative metadata references', () => {
    const manifest = buildAvatarRenderManifest({
      clip,
      audioUrl: 'https://example.test/clip.m4a',
      speakers: ['A', 'B'],
      avatarMap: { A: 'https://example.test/a.jpg', B: 'https://example.test/b.jpg' },
      turns: [{ id: 'turn-1', speaker: 'A', start: 0, end: 0.5, verified: true }],
      layout: 'stage_grid',
      aspectRatio: '9:16',
    });
    expect(manifest.schema).toBe('spacepipe.avatar.timeline.v1');
    expect(manifest.speakers.map((speaker) => speaker.id)).toEqual(['a', 'b']);
    expect(manifest.intervals[0]).toMatchObject({ speaker_id: 'a', start_seconds: 0, end_seconds: 0.5 });
  });

  it('rejects dispatch when timing is unavailable', () => {
    expect(() => buildAvatarRenderManifest({
      clip,
      audioUrl: 'https://example.test/clip.m4a',
      speakers: ['A'],
      avatarMap: { A: 'https://example.test/a.jpg' },
      turns: [],
      layout: 'stage_grid',
      aspectRatio: '9:16',
    })).toThrow(/speaker timing/);
  });
});
