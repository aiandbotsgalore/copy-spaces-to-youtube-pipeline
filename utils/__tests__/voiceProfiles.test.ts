import { describe, expect, it, vi } from 'vitest';
import type { Release, VoiceProfile, VoiceProfilesCatalog } from '../../types';
import {
  getVoiceSamples, updateVoiceSamples, voiceMatchingStatus, readSpeakerAssignments,
  searchVoiceEpisodes, parseVoiceTimestamp, formatVoiceTimestamp,
  resolveSpeakerName, collectConfirmedProfiles, updateVoiceProfile, mergeVoiceCatalog, recordConfirmedProfiles, getConfirmationCounts,
} from '../voiceProfiles';

const sample = { id: 'ref', audio_url: 'https://example.org/reference.mp3', source: 'episode' as const, start_sec: 8, end_sec: 25 };
const profile: VoiceProfile = { name: 'Angela', samples: [sample], sample_count: 5, embedding: [1, 0], identity_verified: true };
const catalog: VoiceProfilesCatalog = { version: '2', updated_at: '', embedding_model: 'example', embedding_dim: 2, profiles: { original: profile } };

describe('voice profiles', () => {
  it('keeps the catalog key stable after a display name edit', () => {
    const next = updateVoiceProfile(catalog, 'original', { ...profile, name: 'Angela M.' });
    expect(resolveSpeakerName(next.profiles, 'Angela', 'original')).toBe('Angela M.');
    expect(resolveSpeakerName(next.profiles, 'Angela')).toBe('Angela');
    expect(Object.keys(next.profiles)).toEqual(['original']);
  });

  it('reads older name-only corrections without inventing a profile link', () => {
    expect(readSpeakerAssignments('{"Speaker 1":"Angela","Speaker 2":{"name":"Logan","profileId":"logan"}}')).toEqual({
      'Speaker 1': { name: 'Angela' },
      'Speaker 2': { name: 'Logan', profileId: 'logan' },
    });
  });

  it('counts only explicit links and uses the current correction over an older link', () => {
    expect(collectConfirmedProfiles([
      { rawSpeaker: 'Speaker 1', speakerVerified: true, attribution: { method: 'human_verified', profile_id: 'original' } },
      { rawSpeaker: 'Speaker 2', attribution: { method: 'acoustic', profile_id: 'different' } },
      { rawSpeaker: 'Speaker 3', speakerVerified: true, attribution: { profile_id: 'previous' } },
    ], { 'Speaker 3': { name: 'Somebody else' }, 'Speaker 4': { name: 'Angela', profileId: 'original' } })).toEqual(['original']);
  });

  it('uses playable saved clips instead of legacy counts and retains older audio links', () => {
    expect(voiceMatchingStatus({ name: 'Angela', sample_count: 5 })).toBe('empty');
    expect(getVoiceSamples({ name: 'Angela', sample_audio_url: sample.audio_url })).toMatchObject([{ audio_url: sample.audio_url }]);
    expect(voiceMatchingStatus(profile)).toBe('needs-preparation');
  });

  it('distinguishes a saved clip, a prepared voice, and a verified voice', () => {
    const prepared = {
      ...profile, enrolled_sample_id: sample.id, identity_verified: false,
      embedding: Array(192).fill(0.1), embedding_model: 'speechbrain/spkrec-ecapa-voxceleb',
    };
    expect(voiceMatchingStatus(prepared)).toBe('needs-verification');
    const ready = { ...prepared, identity_verified: true };
    expect(voiceMatchingStatus(ready)).toBe('ready');
    expect(voiceMatchingStatus({ ...ready, suggestions_paused: true })).toBe('paused');
    expect(voiceMatchingStatus({ ...ready, embedding: Array(192).fill(0) })).toBe('needs-preparation');
    expect(voiceMatchingStatus({ ...prepared, enrolled_sample_id: undefined })).toBe('needs-preparation');
  });

  it('finds recorded episodes by title words or date and skips episodes with no playable audio', () => {
    const episode = {
      id: 8, name: 'The Long Conversation', tag_name: '20261115_space',
      published_at: '2026-11-16T00:00:00Z', assets: [{
        id: 3, name: 'recording.mp3', browser_download_url: 'https://example.org/episode.mp3',
        size: 1, content_type: 'audio/mpeg',
      }],
      draft: false, prerelease: false, body: null, html_url: '',
    } satisfies Release;
    const releases = [{ ...episode, id: 9, assets: [] }, episode];
    expect(searchVoiceEpisodes(releases, 'long conversation 2026-11-16')).toEqual([episode]);
    expect(searchVoiceEpisodes(releases, 'a different episode')).toEqual([]);
  });

  it('accepts player timestamps and rejects empty or malformed clip boundaries', () => {
    expect(parseVoiceTimestamp('1:03:04.25')).toBe(3784.25);
    expect(parseVoiceTimestamp('03:04.25')).toBe(184.25);
    expect(parseVoiceTimestamp('')).toBeNull();
    expect(parseVoiceTimestamp('12:90')).toBeNull();
    expect(parseVoiceTimestamp('02:')).toBeNull();
    expect(formatVoiceTimestamp(179.9998)).toBe('03:00');
  });

  it('invalidates the old fingerprint when audio boundaries change', () => {
    const next = updateVoiceSamples(profile, [{ ...sample, end_sec: 20 }]);
    expect(next.identity_verified).toBe(false);
    expect(next.embedding).toBeUndefined();
    expect(next.samples?.[0].end_sec).toBe(20);
  });

  it('preserves a fingerprint when adding another sample', () => {
    const next = updateVoiceSamples(profile, [sample, { ...sample, id: 'another' }]);
    expect(next.embedding).toEqual([1, 0]);
  });

  it('counts each episode once, including when confirmations span several parts', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) });
    try {
      recordConfirmedProfiles('first-episode', ['original']);
      recordConfirmedProfiles('first-episode', ['original'], 2);
      recordConfirmedProfiles('second-episode', ['original']);
      expect(getConfirmationCounts().get('original')).toBe(2);
      recordConfirmedProfiles('first-episode', [], 2);
      expect(getConfirmationCounts().get('original')).toBe(2);
      recordConfirmedProfiles('first-episode', []);
      expect(getConfirmationCounts().get('original')).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not revive a profile deleted in the browser when upstream still has it', () => {
    const local = { ...catalog, profiles: {}, removed_profiles: { original: '2026-11-18T00:00:00Z' } };
    expect(mergeVoiceCatalog(catalog, local).profiles).toEqual({});
  });

  it('keeps the fingerprint associated with a different sample', () => {
    const next = updateVoiceSamples({ ...profile, enrolled_sample_id: 'ref',
      samples: [sample, { ...sample, id: 'extra' }] }, [sample, { ...sample, id: 'extra', end_sec: 20 }]);
    expect(next.embedding).toEqual([1, 0]);
    expect(next.identity_verified).toBe(true);
  });

  it('keeps a removed legacy sample removed', () => {
    const next = updateVoiceSamples({ name: 'Angela', sample_audio_url: sample.audio_url }, []);
    expect(getVoiceSamples(next)).toEqual([]);
  });
});
