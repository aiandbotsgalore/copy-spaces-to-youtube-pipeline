/**
 * Read only adapter for Logan's verified AQ corpus (docs/documentary/data/angela_quotes_master.json,
 * 283 quotes, 35 fields). The file is only ever read; quotes are returned frozen so nothing in the app
 * can change them in memory either. Corpus metadata is always read live from the file, never copied.
 *
 * Corpus cut points become audio boundaries with source 'corpus_cut': supplied by the corpus, not
 * re-checked against the audio by this app. Existing WAVs come from the master file
 * (master_clip_filename) and public/clips/angela/manifest.json (quote_id), only when the file exists.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { AudioBoundary } from '../utils/scriptTypes';

export const AQ_MASTER_REL = path.join('docs', 'documentary', 'data', 'angela_quotes_master.json');
const CLIPS_REL = path.join('public', 'clips', 'angela');

/** One corpus record exactly as stored (all 35 fields). Typed only for the fields the app reads. */
export type AqQuote = Readonly<Record<string, unknown> & {
  quote_id: string; release_tag: string; exact_quote: string; speaker: string;
  cut_in: unknown; cut_out: unknown; source_in: unknown; source_out: unknown;
  needs_audio_alignment: unknown; transcript_search_window: unknown; master_clip_filename: unknown;
}>;

export interface AqCorpus { md5: string; quotes: readonly AqQuote[]; byId: Map<string, AqQuote>; tags: string[]; fields: string[] }
export interface AqClipFile { filename: string; url: string; from: 'master' | 'manifest' }

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
}

const cache = new Map<string, { mtime: number; size: number; corpus: AqCorpus }>();

export function loadAqCorpus(root: string): AqCorpus {
  const file = path.join(root, AQ_MASTER_REL);
  const st = fs.statSync(file);
  const hit = cache.get(file);
  if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.corpus;
  const raw = fs.readFileSync(file);
  const parsed = JSON.parse(raw.toString('utf8'));
  if (!Array.isArray(parsed)) throw new Error(`${AQ_MASTER_REL} is not an array of quotes.`);
  const quotes = deepFreeze(parsed as AqQuote[]);
  const fields: string[] = [];
  for (const q of quotes) for (const k of Object.keys(q)) if (!fields.includes(k)) fields.push(k);
  const corpus: AqCorpus = {
    md5: createHash('md5').update(raw).digest('hex'), quotes, fields,
    byId: new Map(quotes.map(q => [q.quote_id, q])),
    tags: [...new Set(quotes.map(q => q.release_tag))].sort(),
  };
  cache.set(file, { mtime: st.mtimeMs, size: st.size, corpus });
  return corpus;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Seconds from a corpus time: a number, or "HH:MM:SS.mmm" / "MM:SS.mmm". */
export function parseCutSec(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const m = /^\s*(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)\s*$/.exec(v);
  if (!m) return null;
  return round3(Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]));
}

/** Corpus cut points (only when the corpus marks them final) as audio boundaries; otherwise no audio yet. */
export function corpusAudio(q: AqQuote): AudioBoundary {
  const s = parseCutSec(q.cut_in), e = parseCutSec(q.cut_out);
  if (q.needs_audio_alignment === false && s !== null && e !== null && e > s) return { status: 'verified', source: 'corpus_cut', startSec: s, endSec: e };
  if (q.needs_audio_alignment !== false) return { status: 'none', reason: 'The corpus marks this quote as needing audio alignment.' };
  return { status: 'none', reason: 'The corpus has no usable cut points for this quote.' };
}

/** Where to look first in the transcript: the corpus source times, else its search window. */
export function corpusWindow(q: AqQuote): [number, number] | undefined {
  const s = parseCutSec(q.source_in), e = parseCutSec(q.source_out);
  if (s !== null && e !== null) return [s, e];
  const w = typeof q.transcript_search_window === 'string' ? q.transcript_search_window.split(/\s*[–—-]\s*(?=\d)/) : [];
  if (w.length === 2) {
    const a = parseCutSec(w[0]), b = parseCutSec(w[1]);
    if (a !== null && b !== null) return [a, b];
  }
  return undefined;
}

/** Existing WAVs per AQ id. The master file's own link wins over the manifest. */
export function aqClipFiles(root: string): Map<string, AqClipFile> {
  const dir = path.join(root, CLIPS_REL);
  const out = new Map<string, AqClipFile>();
  const add = (id: string, filename: string, from: AqClipFile['from']) => {
    if (out.has(id) || !/^[\w.() -]+\.(wav|mp3)$/i.test(filename) || !fs.existsSync(path.join(dir, filename))) return;
    out.set(id, { filename, url: `/clips/angela/${encodeURIComponent(filename)}`, from });
  };
  try {
    for (const q of loadAqCorpus(root).quotes) if (typeof q.master_clip_filename === 'string') add(q.quote_id, q.master_clip_filename, 'master');
  } catch { /* no corpus */ }
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    for (const x of Array.isArray(m) ? m : []) if (typeof x?.quote_id === 'string' && typeof x?.filename === 'string') add(x.quote_id, x.filename, 'manifest');
  } catch { /* no manifest */ }
  return out;
}
