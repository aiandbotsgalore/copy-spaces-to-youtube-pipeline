/**
 * Avatar stage dispatch: find the clip's source episode even when the catalog only has a title,
 * and build the stage speakers and clip relative turns from the transcript, so only the person
 * talking animates and people who stay quiet remain on stage as listeners.
 */
import { describe, it, expect } from 'vitest';
import { cleanClipSpeakers, planAvatarStage, resolveClipReleaseTag, speakerKey } from '../avatarStage';

const episodes = [
  { release_tag: '20260907_1yGBePOjLBMKN', title: 'Jason_Sands_speaks_his_mind_The_Un-Bamboozling_of_UFO_disclosure', audio_url: 'https://x/releases/download/20260907_1yGBePOjLBMKN/01h00m32s_Deceived.mp3' },
  { release_tag: '20260903_1XxygwbXBzvGM', title: 'TRANSCENDENTAL GENETICISTS', audio_url: 'https://github.com/o/r/releases/download/20260903_1XxygwbXBzvGM/03h05m09s_Atlantis_or_Metaphysical_Blender.mp3' },
  { release_tag: '20260903_1dJrPrbyedXKX', title: 'Inside "The Biggest Military Computer Hack of All Time"-TEST⚠️', audio_url: '' },
  { release_tag: '20260216_1kvJpMAdvPZxE', title: 'Portals?', audio_url: '' },
];

describe('resolveClipReleaseTag', () => {
  it('keeps the existing release URL and tag matches', () => {
    expect(resolveClipReleaseTag({ episode: 'x', download_url: 'https://github.com/o/r/releases/download/20260101_1abcDEF123456/clip.mp3' }, [])).toBe('20260101_1abcDEF123456');
    expect(resolveClipReleaseTag({ episode: '20260916_1aJbdEmBBvrKX' }, [])).toBe('20260916_1aJbdEmBBvrKX');
  });

  it('matches the catalog episode title to the summary index title', () => {
    expect(resolveClipReleaseTag({ episode: 'Jason Sands speaks his mind The Un-Bamboozling of UFO disclosure', file_path: 'https://pub.r2.dev/03m08s_If_This.mp3' }, episodes)).toBe('20260907_1yGBePOjLBMKN');
    expect(resolveClipReleaseTag({ episode: 'Inside "The Biggest Military Computer Hack of All Time"-TEST⚠️' }, episodes)).toBe('20260903_1dJrPrbyedXKX');
    expect(resolveClipReleaseTag({ episode: 'portals' }, episodes)).toBe('20260216_1kvJpMAdvPZxE');
  });

  it('matches an episode named after the episode audio file', () => {
    expect(resolveClipReleaseTag({ episode: '03h05m09s_Atlantis_or_Metaphysical_Blender' }, episodes)).toBe('20260903_1XxygwbXBzvGM');
  });

  it('matches a bare Space ID', () => {
    expect(resolveClipReleaseTag({ episode: 'space 1kvJpMAdvPZxE' }, episodes)).toBe('20260216_1kvJpMAdvPZxE');
  });

  it('returns empty when nothing matches', () => {
    expect(resolveClipReleaseTag({ episode: '01m27s_Ricocheting_Off_The_Walls' }, episodes)).toBe('');
  });
});

describe('speaker names', () => {
  it('compares labels without case, punctuation or leading zeros', () => {
    expect(speakerKey('SPEAKER_01')).toBe(speakerKey('Speaker 1'));
    expect(speakerKey('Speaker 10')).not.toBe(speakerKey('Speaker 1'));
  });

  it('repairs a name split into letters and drops junk entries', () => {
    expect(cleanClipSpeakers(['S', 'p', 'e', 'a', 'k', 'e', 'r', ' ', '1'])).toEqual(['Speaker 1']);
    expect(cleanClipSpeakers(['C', 'B'])).toEqual([]);
    expect(cleanClipSpeakers(['Logan', 'logan ', 'Angela'])).toEqual(['Logan', 'Angela']);
  });

  it('survives catalogs that are missing, empty or full of holes', () => {
    expect(cleanClipSpeakers(null)).toEqual([]);
    expect(cleanClipSpeakers(undefined)).toEqual([]);
    expect(cleanClipSpeakers('Logan, Angela')).toEqual([]);
    expect(cleanClipSpeakers([null, 'Logan', '', '  ', undefined, 'Angela'])).toEqual(['Logan', 'Angela']);
  });
});

describe('planAvatarStage', () => {
  const clip = (speakers: string[], start = 100, end = 130) => ({ speakers, start_seconds: start, end_seconds: end });

  it('turns transcript turns into clip relative offsets, clipped to the clip', () => {
    const plan = planAvatarStage(clip(['Logan', 'Angela']), [
      { speaker: 'Logan', start: 90, end: 105 },
      { speaker: 'Angela', start: 105, end: 112.5 },
      { speaker: 'Logan', start: 120, end: 140 },
      { speaker: 'Angela', start: 150, end: 160 },
    ]);
    expect(plan.segments).toEqual([
      { speaker: 'Logan', start: 0, end: 5 },
      { speaker: 'Angela', start: 5, end: 12.5 },
      { speaker: 'Logan', start: 20, end: 30 },
    ]);
    expect(plan.speakers).toEqual(['Logan', 'Angela']);
  });

  it('keeps turns when the clip says "Speaker 1" but the transcript now names the person', () => {
    const plan = planAvatarStage(clip(['Speaker 1']), [
      { speaker: 'Logan', start: 100, end: 110 },
      { speaker: 'God Sauce', start: 110, end: 112 },
    ]);
    expect(plan.speakers).toEqual(['Logan', 'God Sauce']);
    expect(plan.segments.map(s => s.speaker)).toEqual(['Logan', 'God Sauce']);
  });

  it('uses the clip spelling of a name the transcript also has', () => {
    const plan = planAvatarStage(clip(['Logan']), [{ speaker: 'LOGAN', start: 100, end: 110 }]);
    expect(plan.speakers).toEqual(['Logan']);
    expect(plan.segments).toEqual([{ speaker: 'Logan', start: 0, end: 10 }]);
  });

  it('keeps named participants who stay quiet as listeners, after the talkers', () => {
    const plan = planAvatarStage(clip(['Oor', 'Logan', 'Speaker 2']), [
      { speaker: 'Logan', start: 100, end: 104 },
      { speaker: 'Angela', start: 104, end: 125 },
    ]);
    // Talkers first by speaking time, then Oor as a quiet listener; the stale "Speaker 2" label is dropped.
    expect(plan.speakers).toEqual(['Angela', 'Logan', 'Oor']);
    expect(plan.segments.some(s => s.speaker === 'Oor')).toBe(false);
  });

  it('falls back to the clip speakers with no turns when the transcript has nothing in the clip', () => {
    expect(planAvatarStage(clip(['Logan', 'Angela']), [{ speaker: 'Logan', start: 10, end: 20 }])).toEqual({ speakers: ['Logan', 'Angela'], segments: [] });
    expect(planAvatarStage(clip([]), [])).toEqual({ speakers: ['Logan', 'Guest'], segments: [] });
  });

  it('caps the stage at 8 speakers, keeping the ones who talk most', () => {
    const segs = Array.from({ length: 10 }, (_, i) => ({ speaker: `Speaker ${i + 1}`, start: 100 + i * 2, end: 100 + i * 2 + (i + 1) * 0.1 }));
    const plan = planAvatarStage(clip([], 100, 140), segs);
    expect(plan.speakers).toHaveLength(8);
    expect(plan.speakers).not.toContain('Speaker 1');
    expect(plan.speakers).not.toContain('Speaker 2');
    expect(plan.segments.every(s => plan.speakers.includes(s.speaker))).toBe(true);
  });

  it('handles a single speaker and a missing speaker list', () => {
    expect(planAvatarStage(clip(['Logan']), [{ speaker: 'Logan', start: 100, end: 110 }])).toEqual({
      speakers: ['Logan'],
      segments: [{ speaker: 'Logan', start: 0, end: 10 }],
    });
    // No usable speakers list: the transcript still decides the cast.
    expect(planAvatarStage({ speakers: null, start_seconds: 0, end_seconds: 10 }, [
      { speaker: 'Logan', start: 0, end: 4 },
      { speaker: 'Angela', start: 4, end: 8 },
    ])).toEqual({
      speakers: ['Logan', 'Angela'],
      segments: [{ speaker: 'Logan', start: 0, end: 4 }, { speaker: 'Angela', start: 4, end: 8 }],
    });
  });

  it('falls back to the clip speakers when the clip has no usable time range', () => {
    // A zero-length or inverted range yields no turns at all, so the worker must detect speech itself.
    expect(planAvatarStage({ speakers: ['Logan', 'Angela'], start_seconds: 30, end_seconds: 30 }, [
      { speaker: 'Logan', start: 30, end: 40 },
    ])).toEqual({ speakers: ['Logan', 'Angela'], segments: [] });
    expect(planAvatarStage({ speakers: ['Logan'], start_seconds: 0, duration: 0 }, [])).toEqual({
      speakers: ['Logan'],
      segments: [],
    });
  });

  it('ignores malformed segments', () => {
    const plan = planAvatarStage(clip(['Logan']), [
      { speaker: '', start: 100, end: 110 },
      { speaker: 'Logan', start: 'x' as any, end: 110 },
      { speaker: 'Logan', start: 108, end: 104 },
      { speaker: 'Logan', start: '101.25' as any, end: '103' as any },
    ]);
    expect(plan.segments).toEqual([{ speaker: 'Logan', start: 1.25, end: 3 }]);
  });
});
