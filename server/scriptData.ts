/**
 * Script Studio transcript and clip data, read by the server from the repo's own files
 * (public/transcripts/episodes/<releaseTag>.json, public/clips/clips_catalog.json). The browser never
 * posts transcripts; it only sends Logan's speaker renames.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { EvidenceRef, StudioClip } from '../utils/scriptTypes';
import type { TranscriptSeg } from '../utils/scriptGates';

export interface Utterance extends TranscriptSeg { id: string; index: number }
export interface LoadedTranscript { releaseTag: string; title: string; audioUrl?: string; hash: string; utterances: Utterance[] }

export const CHARS_PER_TOKEN = 4;
export const CHUNK_MAX_TOKENS = 60_000;

const TAG_RE = /^[A-Za-z0-9_.-]{3,120}$/;
export const isSafeTag = (t: string) => TAG_RE.test(t) && !t.includes('..');

export function transcriptPath(root: string, releaseTag: string) {
  return path.join(root, 'public', 'transcripts', 'episodes', `${releaseTag}.json`);
}

export function parseTranscriptJson(raw: string, releaseTag: string): LoadedTranscript {
  const j = JSON.parse(raw);
  const segs: any[] = Array.isArray(j) ? j : Array.isArray(j?.segments) ? j.segments : [];
  const utterances: Utterance[] = [];
  segs.forEach((s, i) => {
    const text = String(s?.text ?? '').trim();
    const start = Number(s?.start);
    const end = Number(s?.end);
    if (!text || !Number.isFinite(start)) return;
    utterances.push({ id: `u${i}`, index: i, start, end: Number.isFinite(end) && end >= start ? end : start, speaker: String(s?.speaker ?? 'Unknown').trim() || 'Unknown', text });
  });
  return {
    releaseTag, title: String(j?.title || releaseTag), audioUrl: typeof j?.audio_url === 'string' ? j.audio_url : undefined,
    hash: createHash('sha256').update(raw).digest('hex'), utterances,
  };
}

export function readTranscript(root: string, releaseTag: string): LoadedTranscript | null {
  if (!isSafeTag(releaseTag)) return null;
  const p = transcriptPath(root, releaseTag);
  if (!fs.existsSync(p)) return null;
  return parseTranscriptJson(fs.readFileSync(p, 'utf8'), releaseTag);
}

export function listEpisodes(root: string): { releaseTag: string; title: string }[] {
  const dir = path.join(root, 'public', 'transcripts', 'episodes');
  if (!fs.existsSync(dir)) return [];
  let titles: Record<string, string> = {};
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(root, 'public', 'transcripts', 'transcripts_summary_index.json'), 'utf8'));
    const list: any[] = Array.isArray(idx) ? idx : Array.isArray(idx?.episodes) ? idx.episodes : [];
    for (const e of list) if (e?.release_tag) titles[e.release_tag] = String(e.title || e.release_tag);
  } catch { titles = {}; }
  return fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.endsWith('.embeddings.json')).map(f => f.slice(0, -5))
    .map(tag => ({ releaseTag: tag, title: titles[tag] || tag })).sort((a, b) => b.releaseTag.localeCompare(a.releaseTag));
}

export function hhmmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export const displayName = (speaker: string, names: Record<string, string>) => names[speaker] || speaker;

export function utteranceLine(u: Utterance, names: Record<string, string>): string {
  return `[${u.id} ${hhmmss(u.start)} ${displayName(u.speaker, names)}] ${u.text}`;
}

/** Cuts at utterance boundaries into chunks of at most maxTokens (4 characters per token). */
export function chunkUtterances(utts: Utterance[], names: Record<string, string>, maxTokens = CHUNK_MAX_TOKENS): string[] {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const chunks: string[] = [];
  let cur: string[] = [];
  let size = 0;
  for (const u of utts) {
    const line = utteranceLine(u, names);
    if (size + line.length + 1 > maxChars && cur.length) {
      chunks.push(cur.join('\n'));
      cur = [];
      size = 0;
    }
    cur.push(line);
    size += line.length + 1;
  }
  if (cur.length) chunks.push(cur.join('\n'));
  return chunks;
}

export function speakerStats(utts: Utterance[], names: Record<string, string>) {
  const talk = new Map<string, number>();
  let total = 0;
  for (const u of utts) {
    const d = Math.max(0, u.end - u.start);
    const n = displayName(u.speaker, names);
    talk.set(n, (talk.get(n) || 0) + d);
    total += d;
  }
  const isUnnamed = (n: string) => /^speaker[\s_-]*\d+$/i.test(n) || /^SPEAKER_\d+$/i.test(n) || n === 'Unknown';
  const unnamed = [...talk.entries()].filter(([n]) => isUnnamed(n)).sort((a, b) => b[1] - a[1]);
  const unnamedSec = unnamed.reduce((s, [, d]) => s + d, 0);
  return {
    totalSec: total,
    unnamedShare: total > 0 ? unnamedSec / total : 0,
    topUnnamed: unnamed.slice(0, 5).map(([speaker, sec]) => ({ speaker, sec })),
    speakers: [...talk.entries()].sort((a, b) => b[1] - a[1]).map(([speaker, sec]) => ({ speaker, sec })),
  };
}

/** Model quote refs ({utteranceIds, verbatim}) -> EvidenceRefs with times and speaker filled in by code. */
export function toEvidenceRefs(
  refs: { utteranceIds: string[]; verbatim: string }[] | null | undefined,
  t: LoadedTranscript,
  names: Record<string, string>
): { ok: true; refs: EvidenceRef[] } | { ok: false; reason: string } {
  const byId = new Map(t.utterances.map(u => [u.id, u]));
  const out: EvidenceRef[] = [];
  for (const r of refs || []) {
    const us = (r.utteranceIds || []).map(id => byId.get(id));
    if (!us.length || us.some(u => !u)) return { ok: false, reason: `A claim cites unknown utterance ids ${JSON.stringify(r.utteranceIds)}.` };
    const list = us as Utterance[];
    out.push({
      releaseTag: t.releaseTag,
      segStart: Math.min(...list.map(u => u.start)),
      segEnd: Math.max(...list.map(u => u.end)),
      speaker: displayName(list[0].speaker, names),
      verbatim: String(r.verbatim || ''),
    });
  }
  return { ok: true, refs: out };
}

/** Transcript segments with Logan's renames applied, for the verbatim gate. */
export function namedSegments(t: LoadedTranscript, names: Record<string, string>): TranscriptSeg[] {
  return t.utterances.map(u => ({ start: u.start, end: u.end, speaker: displayName(u.speaker, names), text: u.text }));
}

/* ------------------------------------------------------------------------------------------------ */
/* Clips                                                                                             */
/* ------------------------------------------------------------------------------------------------ */

export function releaseTagFromUrl(url: string): string | null {
  const m = /\/releases\/download\/([^/]+)\//.exec(url || '');
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Catalog clips for a release. durationSec is the catalog's own end - start window (the duration of the
 * cut file); clips without an audio URL or a positive window are excluded and listed with the reason.
 */
export function catalogClipsForRelease(root: string, releaseTag: string): { clips: StudioClip[]; excluded: { clipId: string; reason: string }[] } {
  const p = path.join(root, 'public', 'clips', 'clips_catalog.json');
  if (!fs.existsSync(p)) return { clips: [], excluded: [] };
  const list: any[] = JSON.parse(fs.readFileSync(p, 'utf8'));
  const clips: StudioClip[] = [];
  const excluded: { clipId: string; reason: string }[] = [];
  list.forEach((c, i) => {
    const url = String(c?.download_url || c?.file_path || '');
    if (releaseTagFromUrl(url) !== releaseTag) return;
    const clipId = `cat${i}`;
    const start = Number(c?.start_seconds);
    const end = Number(c?.end_seconds);
    const dur = Number(c?.duration) > 0 ? Number(c.duration) : end - start;
    if (!url) { excluded.push({ clipId, reason: 'No audio file.' }); return; }
    if (!(dur > 0)) { excluded.push({ clipId, reason: 'No valid duration.' }); return; }
    clips.push({
      clipId, title: String(c?.title || clipId), speaker: Array.isArray(c?.speakers) ? c.speakers.join(', ') : String(c?.speaker || ''),
      releaseTag, audioUrl: url, durationSec: Math.round(dur * 100) / 100, text: String(c?.transcript_snippet || ''),
      episodeStartSec: Number.isFinite(start) ? start : undefined, audioOffsetSec: 0,
    });
  });
  return { clips, excluded };
}

/** A clip cut directly from the transcript ("Add to script"): utterances a..b of one release. */
export function clipFromUtterances(t: LoadedTranscript, fromId: string, toId: string, names: Record<string, string>, audioUrl: string | undefined): StudioClip | null {
  const a = t.utterances.findIndex(u => u.id === fromId);
  const b = t.utterances.findIndex(u => u.id === toId);
  if (a < 0 || b < a || !audioUrl) return null;
  const us = t.utterances.slice(a, b + 1);
  const start = us[0].start;
  const end = us[us.length - 1].end;
  if (!(end > start)) return null;
  const speakers = [...new Set(us.map(u => displayName(u.speaker, names)))];
  return {
    clipId: `tr_${t.releaseTag}_${fromId}_${toId}`, title: us[0].text.slice(0, 60), speaker: speakers.join(', '),
    releaseTag: t.releaseTag, audioUrl, durationSec: Math.round((end - start) * 100) / 100,
    text: us.map(u => (speakers.length > 1 ? `${displayName(u.speaker, names)}: ${u.text}` : u.text)).join(' '),
    episodeStartSec: start, audioOffsetSec: start,
  };
}

/* ------------------------------------------------------------------------------------------------ */
/* Full-episode audio for transcript cuts                                                            */
/* ------------------------------------------------------------------------------------------------ */

export const RELEASE_URL_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/([^/?#]+)$/;
const AUDIO_EXT_RE = /\.(mp3|m4a|wav|ogg|opus|aac)$/i;

/**
 * A transcript's audio_url sometimes names one of the release's cut clips instead of the full recording.
 * The full recording is the release asset whose name starts with the release tag.
 */
export function isFullEpisodeUrl(url: string | undefined, releaseTag: string): boolean {
  const m = url ? RELEASE_URL_RE.exec(url) : null;
  return !!m && m[3] === releaseTag && decodeURIComponent(m[4]).startsWith(`${releaseTag}_`) && AUDIO_EXT_RE.test(m[4]);
}

/** Looks up the full-episode audio asset in the GitHub release (read-only API call). */
export async function resolveEpisodeAudio(t: LoadedTranscript, fetchImpl: typeof fetch, token?: string): Promise<{ ok: true; url: string } | { ok: false; reason: string }> {
  if (isFullEpisodeUrl(t.audioUrl, t.releaseTag)) return { ok: true, url: t.audioUrl! };
  const m = t.audioUrl ? RELEASE_URL_RE.exec(t.audioUrl) : null;
  if (!m) return { ok: false, reason: 'The transcript has no GitHub release audio URL.' };
  const [, owner, repo] = m;
  let res: Response;
  try {
    res = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(t.releaseTag)}`, {
      headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  } catch (e: any) {
    return { ok: false, reason: `GitHub could not be reached: ${e?.message || e}` };
  }
  if (!res.ok) return { ok: false, reason: `GitHub returned HTTP ${res.status} for release ${t.releaseTag}.` };
  const j: any = await res.json().catch(() => null);
  const assets: { name: string; browser_download_url: string }[] = Array.isArray(j?.assets) ? j.assets : [];
  const full = assets.find(a => typeof a?.name === 'string' && a.name.startsWith(`${t.releaseTag}_`) && AUDIO_EXT_RE.test(a.name));
  if (!full) return { ok: false, reason: `Release ${t.releaseTag} has no full-episode audio asset (a file named ${t.releaseTag}_….mp3).` };
  return { ok: true, url: full.browser_download_url };
}
