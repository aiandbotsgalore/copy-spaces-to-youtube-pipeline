import type { Release, VoiceProfile, VoiceProfilesCatalog, VoiceSample } from '../types';
import { getEpisodeRecordedDate } from './dates';
import { formatSeconds, parseTimeToSeconds, pickAudioMp3Asset } from './transcriptData';

export const VOICE_CATALOG_KEY = 'spacepipe_voice_profiles_catalog';
const CONFIRMATIONS_KEY = 'spacepipe_voice_profile_confirmations';

export type SpeakerAssignments = Record<string, { name: string; profileId?: string }>;

export function getVoiceSamples(profile: VoiceProfile): VoiceSample[] {
  if (Array.isArray(profile.samples)) return profile.samples;
  return profile.sample_audio_url
    ? [{ id: 'legacy', audio_url: profile.sample_audio_url, source: 'legacy' }]
    : [];
}

export function updateVoiceSamples(profile: VoiceProfile, samples: VoiceSample[]): VoiceProfile {
  const learnedSamples = getVoiceSamples(profile).filter(sample => !profile.enrolled_sample_id || sample.id === profile.enrolled_sample_id);
  const changed = learnedSamples.some(previous => !samples.some(sample =>
    sample.id === previous.id && sample.audio_url === previous.audio_url
    && sample.start_sec === previous.start_sec && sample.end_sec === previous.end_sec));
  return {
    ...profile,
    ...(changed ? { embedding: undefined, identity_verified: false, enrolled_sample_id: undefined } : {}),
    samples,
    sample_audio_url: samples.find(sample => sample.start_sec === undefined && sample.end_sec === undefined)?.audio_url,
    sample_count: !changed && profile.embedding ? profile.sample_count : samples.length,
  };
}

export type VoiceMatchingStatus = 'empty' | 'needs-preparation' | 'needs-verification' | 'ready' | 'paused';

export function voiceMatchingStatus(profile: VoiceProfile): VoiceMatchingStatus {
  const embedding = profile.embedding;
  const isEcapa = !profile.embedding_model || profile.embedding_model === 'speechbrain/spkrec-ecapa-voxceleb';
  const prepared = isEcapa
    && Array.isArray(embedding) && embedding.length === 192
    && embedding.every(Number.isFinite) && Math.hypot(...embedding) > 1e-6;
  if (prepared && profile.identity_verified !== false) {
    return profile.suggestions_paused === true ? 'paused' : 'ready';
  }
  const samples = getVoiceSamples(profile);
  if (!samples.length) return 'empty';
  if (prepared && samples.some(sample => sample.id === profile.enrolled_sample_id)) return 'needs-verification';
  return 'needs-preparation';
}

export function searchVoiceEpisodes(releases: Release[], query: string): Release[] {
  const terms = query.trim().toLowerCase().split(/[\s,_]+/).filter(Boolean);
  return releases.filter(release => {
    if (!pickAudioMp3Asset(release)?.browser_download_url) return false;
    if (!terms.length) return true;
    const date = getEpisodeRecordedDate(release);
    const searchable = [release.name, release.tag_name, date.displayDate, date.rawDateStr, release.published_at]
      .join(' ').toLowerCase().replace(/_/g, ' ');
    return terms.every(term => searchable.includes(term));
  });
}

export function parseVoiceTimestamp(value: string): number | null {
  const input = value.trim();
  if (!/^(?:\d+:)?(?:\d+:)?\d+(?:\.\d+)?$/.test(input)) return null;
  const parts = input.split(':');
  if (parts.slice(1).some(part => Number(part) >= 60)) return null;
  if (parts.some(part => !Number.isFinite(Number(part)))) return null;
  const seconds = parseTimeToSeconds(input);
  return Number.isFinite(seconds) ? seconds : null;
}

export function formatVoiceTimestamp(seconds: number): string {
  const millis = Math.round(seconds * 1000);
  const fraction = String(millis % 1000).padStart(3, '0').replace(/0+$/, '');
  return `${formatSeconds(millis / 1000)}${fraction ? `.${fraction}` : ''}`;
}

export function updateVoiceProfile(catalog: VoiceProfilesCatalog, id: string, profile: VoiceProfile): VoiceProfilesCatalog {
  const now = new Date().toISOString();
  return {
    ...catalog,
    updated_at: now,
    profiles: { ...catalog.profiles, [id]: { ...profile, last_updated: now } },
  };
}

export function readVoiceCatalog(): VoiceProfilesCatalog | null {
  try {
    const data = JSON.parse(localStorage.getItem(VOICE_CATALOG_KEY) ?? 'null');
    return data?.profiles && !Array.isArray(data.profiles) ? data : null;
  } catch {
    return null;
  }
}

export function mergeVoiceCatalog(remote: VoiceProfilesCatalog, local: VoiceProfilesCatalog | null): VoiceProfilesCatalog {
  if (!local) return remote;
  const profiles = { ...remote.profiles };
  const removed = { ...remote.removed_profiles };
  for (const [id, timestamp] of Object.entries(local.removed_profiles ?? {})) {
    if (!removed[id] || timestamp > removed[id]) removed[id] = timestamp;
  }
  for (const [id, profile] of Object.entries(local.profiles)) {
    const previous = profiles[id];
    // An enrollment job can update the fingerprint while this browser holds a catalog.
    if (!previous || (profile.last_updated ?? '') > (previous.last_updated ?? '')) profiles[id] = profile;
  }
  for (const [id, timestamp] of Object.entries(removed)) {
    const profile = profiles[id];
    if (profile && timestamp >= (profile.last_updated ?? '')) delete profiles[id];
    else if (profile) delete removed[id];
  }
  return { ...remote, profiles, ...(Object.keys(removed).length ? { removed_profiles: removed } : {}) };
}

export function readSpeakerAssignments(raw: string | null): SpeakerAssignments {
  try {
    const data = JSON.parse(raw ?? '{}');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).flatMap(([speaker, value]) => {
      if (typeof value === 'string') return [[speaker, { name: value }]];
      if (!value || typeof value !== 'object' || !('name' in value) || typeof value.name !== 'string') return [];
      const profileId = 'profileId' in value && typeof value.profileId === 'string' ? value.profileId : undefined;
      return [[speaker, profileId ? { name: value.name, profileId } : { name: value.name }]];
    }));
  } catch {
    return {};
  }
}

export function resolveSpeakerName(profiles: Record<string, VoiceProfile>, name: string, profileId?: string): string {
  return profileId && Object.hasOwn(profiles, profileId) ? profiles[profileId].name : name;
}

export function collectConfirmedProfiles(
  turns: Array<{ rawSpeaker: string; speakerVerified?: boolean; attribution?: Record<string, unknown> }>,
  assignments: SpeakerAssignments,
): string[] {
  const ids = new Set<string>();
  for (const turn of turns) {
    const assignment = Object.hasOwn(assignments, turn.rawSpeaker) ? assignments[turn.rawSpeaker] : undefined;
    const confirmed = turn.speakerVerified || turn.attribution?.method === 'human_verified';
    const id = assignment ? assignment.profileId : confirmed ? turn.attribution?.profile_id : undefined;
    if (typeof id === 'string' && id) ids.add(id);
  }
  return [...ids].sort();
}

function readEpisodeConfirmations(): Record<string, Record<number, string[]>> {
  try {
    const data = JSON.parse(localStorage.getItem(CONFIRMATIONS_KEY) ?? '{}');
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

export function recordConfirmedProfiles(episode: string, ids: string[], part = 1): void {
  try {
    const episodes = readEpisodeConfirmations();
    const existing = episodes[episode]?.[part] ?? [];
    if (JSON.stringify(existing) === JSON.stringify(ids)) return;
    episodes[episode] = { ...episodes[episode], [part]: ids };
    localStorage.setItem(CONFIRMATIONS_KEY, JSON.stringify(episodes));
  } catch {
    // An unavailable browser store must not prevent transcript review.
  }
}

export function getConfirmationCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const parts of Object.values(readEpisodeConfirmations())) {
    if (!parts || typeof parts !== 'object') continue;
    const ids = new Set(Object.values(parts).flatMap(part => Array.isArray(part) ? part : []));
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}
