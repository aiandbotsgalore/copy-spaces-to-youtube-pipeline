/**
 * Real audio durations and window reconciliation.
 *
 * The Studio historically loaded clips with placeholder windows (manifest clips: 0..30 s) or with
 * episode-relative windows (catalog clips: e.g. 5625.6 s) while the audio files are pre-cut, short files.
 * Windows are reconciled against the REAL file duration, per clip, using evidence (never a blanket assumption).
 */
import type { ClipLike } from './directorTypes';
import { toFetchableUrl } from './audioUrl';

/* ---------------------------------------------------------------------------------------------- */
/* Pure helpers (unit-tested)                                                                      */
/* ---------------------------------------------------------------------------------------------- */

/** Parse a RIFF/WAVE header (first bytes of the file) and return duration in seconds, or null. */
export function parseWavHeaderDuration(bytes: Uint8Array, totalFileSize?: number): number | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;

  let offset = 12;
  let byteRate = 0;
  let dataSize: number | null = null;
  let dataStart = 0;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') {
      if (offset + 8 + 12 > bytes.length) return null;
      byteRate = view.getUint32(offset + 8 + 8, true);
    } else if (id === 'data') {
      dataSize = size;
      dataStart = offset + 8;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (!byteRate || dataSize === null) return null;

  let effective = dataSize;
  // Streaming/placeholder sizes (0, 0xFFFFFFFF) or sizes larger than the file: derive from the file size.
  if (totalFileSize && (effective === 0 || effective === 0xffffffff || effective > totalFileSize - dataStart)) {
    effective = Math.max(0, totalFileSize - dataStart);
  }
  if (effective <= 0) return null;
  return effective / byteRate;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Reconcile a clip's window with the real duration `fileDurationSec` of its audio file.
 *  - placeholder window (manifest 0..30)            -> whole file
 *  - window already inside the file                  -> unchanged (just verified)
 *  - window runs past the end of the file (pre-cut)  -> file-relative window, episode times kept as metadata
 */
export function reconcileWindow<T extends ClipLike>(clip: T, fileDurationSec: number): T {
  if (!Number.isFinite(fileDurationSec) || fileDurationSec <= 0) return clip;
  const D = round2(fileDurationSec);

  if (clip.windowVerified) {
    return clip.sourceDurationSec ? clip : { ...clip, sourceDurationSec: D };
  }

  if (clip.windowPlaceholder) {
    return {
      ...clip,
      startSec: 0,
      endSec: D,
      origStartSec: 0,
      origEndSec: D,
      sourceDurationSec: D,
      windowPlaceholder: false,
      windowVerified: true,
    };
  }

  if (clip.endSec <= D + 0.5) {
    return {
      ...clip,
      endSec: Math.min(clip.endSec, D),
      origStartSec: clip.origStartSec ?? clip.startSec,
      origEndSec: clip.origEndSec ?? Math.min(clip.endSec, D),
      sourceDurationSec: D,
      windowVerified: true,
    };
  }

  // Window exceeds the file: the asset is a pre-cut clip and the window was episode-relative.
  const span = clip.endSec - clip.startSec;
  const newEnd = span <= 0 || span > D || Math.abs(D - span) <= 2 ? D : round2(span);
  return {
    ...clip,
    episodeStartSec: clip.episodeStartSec ?? clip.startSec,
    episodeEndSec: clip.episodeEndSec ?? clip.endSec,
    startSec: 0,
    endSec: newEnd,
    origStartSec: 0,
    origEndSec: newEnd,
    sourceDurationSec: D,
    windowVerified: true,
  };
}

export async function mapLimit<I, O>(items: I[], limit: number, fn: (item: I, index: number) => Promise<O>): Promise<O[]> {
  const out: O[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/* ---------------------------------------------------------------------------------------------- */
/* Browser probing (cached)                                                                        */
/* ---------------------------------------------------------------------------------------------- */

const DURATION_CACHE_KEY = 'spacepipe_clip_durations_v1';
const memo = new Map<string, Promise<number | null>>();

function readDiskCache(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(DURATION_CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}
function writeDiskCache(url: string, dur: number) {
  try {
    const c = readDiskCache();
    c[url] = dur;
    localStorage.setItem(DURATION_CACHE_KEY, JSON.stringify(c));
  } catch {
    /* storage unavailable */
  }
}

async function probeWav(url: string, timeoutMs: number): Promise<number | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(toFetchableUrl(url), { headers: { Range: 'bytes=0-255' }, signal: ctl.signal });
    if (!res.ok && res.status !== 206) return null;
    let total: number | undefined;
    const cr = res.headers.get('content-range');
    if (cr && /\/(\d+)$/.test(cr)) total = parseInt(cr.split('/').pop() as string, 10);
    else if (res.status === 200) {
      const cl = res.headers.get('content-length');
      if (cl) total = parseInt(cl, 10);
    }
    // Read only the first chunk(s); never download the entire file if the server ignored Range.
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let got = 0;
    while (got < 256) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      got += value.length;
    }
    reader.cancel().catch(() => {});
    const buf = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) {
      buf.set(c, o);
      o += c.length;
    }
    return parseWavHeaderDuration(buf, total);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function probeMediaElement(url: string, timeoutMs: number): Promise<number | null> {
  return new Promise(resolve => {
    if (typeof Audio === 'undefined') return resolve(null);
    const a = new Audio();
    let settled = false;
    const done = (v: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      a.removeAttribute('src');
      a.load();
      resolve(v);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) && a.duration > 0 ? a.duration : null);
    a.onerror = () => done(null);
    a.src = toFetchableUrl(url);
  });
}

/** Real duration (s) of an audio file, or null if it cannot be determined. Cached. */
export function probeFileDuration(url: string, opts: { timeoutMs?: number } = {}): Promise<number | null> {
  if (!url) return Promise.resolve(null);
  const hit = memo.get(url);
  if (hit) return hit;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const p = (async () => {
    const disk = readDiskCache()[url];
    if (typeof disk === 'number' && disk > 0) return disk;
    const isWav = /\.wav(\?|#|$)/i.test(url);
    let dur: number | null = null;
    if (isWav) dur = await probeWav(url, timeoutMs);
    if (dur == null) dur = await probeMediaElement(url, timeoutMs);
    if (dur != null) writeDiskCache(url, dur);
    return dur;
  })();
  memo.set(url, p);
  // Do not memoise failures for the whole session: allow a later retry.
  p.then(v => {
    if (v == null) memo.delete(url);
  });
  return p;
}
