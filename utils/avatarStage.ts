/**
 * Builds what the Spaces Live Stage avatar worker needs from a catalog clip: the source episode,
 * the speakers on stage, and each speaker's turns as clip relative offsets.
 *
 * The transcript decides who talks when. Clip speaker lists are often stale ("Speaker 1" where the
 * transcript now says "Logan") or broken (a name split into letters), so they are only used for
 * display spelling, for named people who stay quiet (shown as listeners), and when the transcript
 * has no turns inside the clip.
 */

export interface EpisodeRef { release_tag: string; title?: string; audio_url?: string }
export interface ClipRef { episode?: string; file_path?: string; download_url?: string }
export interface TranscriptTurn { speaker?: unknown; start?: unknown; end?: unknown }
export interface StageTurn { speaker: string; start: number; end: number }
export interface AvatarStagePlan { speakers: string[]; segments: StageTurn[] }

export const MAX_STAGE_SPEAKERS = 8;          // the worker renders at most 8 tiles
const DEFAULT_SPEAKERS = ['Logan', 'Guest'];

const normTitle = (s: unknown) => String(s ?? '').toLowerCase().replace(/_/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const baseName = (url: unknown) => String(url ?? '').split(/[\\/]/).pop()!.replace(/\.[a-z0-9]{2,4}$/i, '');

/** Release tag for the clip's source episode, or '' when it cannot be found. */
export function resolveClipReleaseTag(clip: ClipRef, episodes: EpisodeRef[]): string {
  const fields = [clip.episode, clip.file_path, clip.download_url].filter(Boolean).map(String);
  for (const field of fields) {
    const fromReleaseUrl = field.match(/\/releases\/download\/([^/]+)/i)?.[1];
    if (fromReleaseUrl) return fromReleaseUrl;
    const fromTag = field.match(/(\d{8}_[A-Za-z0-9]+)/)?.[1];
    if (fromTag) return fromTag;
  }
  if (!episodes.length) return '';
  // Space ID (the part of a release tag after the date).
  for (const field of fields) {
    for (const id of field.match(/\b1[A-Za-z0-9]{12}\b/g) || []) {
      const hit = episodes.find(e => e.release_tag.endsWith(`_${id}`));
      if (hit) return hit.release_tag;
    }
  }
  const title = normTitle(clip.episode);
  if (title) {
    const byTitle = episodes.find(e => normTitle(e.title) === title);
    if (byTitle) return byTitle.release_tag;
    // Some clips name the episode by its audio file (e.g. "03h05m09s_Atlantis_or_Metaphysical_Blender").
    const byAudio = episodes.find(e => e.audio_url && normTitle(baseName(e.audio_url)) === title);
    if (byAudio) return byAudio.release_tag;
  }
  return '';
}

/** Compares speaker labels ignoring case, punctuation and leading zeros ("SPEAKER_01" = "Speaker 1"). */
export const speakerKey = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').replace(/(\D)0+(?=\d)/g, '$1');

/** Placeholder labels that do not identify a person. */
const isGeneric = (name: string) => /^(speaker|spk|unknown|guest)([a-z]|\d{1,3})?$/.test(speakerKey(name));

/** Repairs a name split into letters, drops one letter junk and duplicates. */
export function cleanClipSpeakers(raw: unknown): string[] {
  let list = Array.isArray(raw) ? raw.map(v => String(v ?? '')) : [];
  if (list.length >= 3 && list.every(v => v.length <= 1)) list = [list.join('').replace(/\s+/g, ' ')];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of list) {
    const name = value.trim();
    const key = speakerKey(name);
    if (key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const num = (v: unknown) => (v === null || v === undefined || v === '' ? NaN : Number(v));

/** Stage speakers (talkers by speaking time, then quiet named participants) and clip relative turns. */
export function planAvatarStage(
  clip: { speakers?: unknown; start_seconds?: unknown; end_seconds?: unknown; duration?: unknown },
  transcript: TranscriptTurn[],
): AvatarStagePlan {
  const clipSpeakers = cleanClipSpeakers(clip.speakers);
  const named = clipSpeakers.filter(n => !isGeneric(n));
  const display = new Map(named.map(n => [speakerKey(n), n]));

  const clipStart = Math.max(0, num(clip.start_seconds) || 0);
  const end = num(clip.end_seconds);
  const clipEnd = end > clipStart ? end : clipStart + (num(clip.duration) || 0);

  const turns: StageTurn[] = [];
  if (clipEnd > clipStart) {
    for (const seg of transcript || []) {
      const label = String(seg?.speaker ?? '').trim();
      const s = num(seg?.start);
      const e = num(seg?.end ?? seg?.start);
      if (!label || !Number.isFinite(s) || !Number.isFinite(e)) continue;
      const a = Math.max(s, clipStart), b = Math.min(e, clipEnd);
      if (b <= a) continue;
      turns.push({ speaker: display.get(speakerKey(label)) ?? label, start: round3(a - clipStart), end: round3(b - clipStart) });
    }
  }
  if (!turns.length) return { speakers: (clipSpeakers.length ? clipSpeakers : DEFAULT_SPEAKERS).slice(0, MAX_STAGE_SPEAKERS), segments: [] };

  const talk = new Map<string, number>();
  for (const t of turns) talk.set(t.speaker, (talk.get(t.speaker) || 0) + (t.end - t.start));
  const talkers = [...talk.keys()].sort((a, b) => talk.get(b)! - talk.get(a)!).slice(0, MAX_STAGE_SPEAKERS);
  const onStage = new Set(talkers.map(speakerKey));
  const listeners = named.filter(n => !onStage.has(speakerKey(n)));
  const speakers = [...talkers, ...listeners].slice(0, MAX_STAGE_SPEAKERS);
  const kept = new Set(talkers);
  return { speakers, segments: turns.filter(t => kept.has(t.speaker)).sort((a, b) => a.start - b.start) };
}
