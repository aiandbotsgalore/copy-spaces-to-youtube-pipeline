/**
 * Sample-accurate sequence audition using the Web Audio clock.
 * Replaces the HTMLAudioElement + timeupdate + setTimeout approach (about 150-250 ms granularity),
 * which is too coarse for 0.1 s trims and per-clip gaps.
 *
 * Timing comes from the same buildSequencePlan() used by export and labels, so what you hear is what you render.
 */
import type { PlanClip, SequencePlan } from './sequencePlan';
import { toFetchableUrl } from './audioUrl';
import { reconcileWindow } from './clipProbe';
import type { ClipLike } from './directorTypes';

export interface PlayerClip extends PlanClip {
  audioUrl?: string;
}

export interface SequencePlayerCallbacks {
  /** Called with the PLAN item index whose clip is now playing. */
  onIndex: (planIndex: number) => void;
  onEnd: () => void;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
  /** Real-time playhead progress across the active clip and entire sequence */
  onProgress?: (planIndex: number, clipProgress: number, sequenceElapsedSec: number) => void;
}

export interface SequencePlayerOptions<T extends PlayerClip> {
  plan: SequencePlan<T>;
  /** Micro-fade length in ms at both clip edges; 0 disables. */
  fadeMs: number;
  callbacks: SequencePlayerCallbacks;
  /** Maps a stored URL to the URL to fetch (e.g. an offline cache blob URL). */
  resolveUrl?: (url: string) => Promise<string>;
  /** Injection points for tests. */
  ctx?: AudioContext;
  decode?: (url: string, ctx: AudioContext) => Promise<AudioBuffer | null>;
}

export interface SequencePlayer {
  start(fromPlanIndex: number): Promise<void>;
  stop(): void;
}

/* ---------------------------------------------------------------------------------------------- */
/* Shared context + decode cache                                                                   */
/* ---------------------------------------------------------------------------------------------- */

let sharedCtx: AudioContext | null = null;
export function getSharedAudioContext(): AudioContext {
  if (!sharedCtx || sharedCtx.state === 'closed') {
    const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
    sharedCtx = new Ctor() as AudioContext;
  }
  return sharedCtx;
}

const MAX_FILE_BYTES = 80 * 1024 * 1024;
const MAX_CACHED_SAMPLES = 75_000_000; // about 300 MB of Float32
const decodeCache = new Map<string, Promise<AudioBuffer | null>>();
const decodedSizes = new Map<string, number>();

function evictIfNeeded(keep: string) {
  let total = 0;
  decodedSizes.forEach(v => (total += v));
  for (const key of Array.from(decodedSizes.keys())) {
    if (total <= MAX_CACHED_SAMPLES) break;
    if (key === keep) continue;
    total -= decodedSizes.get(key) || 0;
    decodedSizes.delete(key);
    decodeCache.delete(key);
  }
}

/** Fetch + decode an audio URL once; results are cached (LRU by decoded size). null = could not decode. */
export function decodeAudioUrl(
  url: string,
  ctx: AudioContext,
  resolveUrl?: (u: string) => Promise<string>
): Promise<AudioBuffer | null> {
  const hit = decodeCache.get(url);
  if (hit) return hit;
  const p = (async () => {
    try {
      const target = resolveUrl ? await resolveUrl(url) : url;
      const res = await fetch(toFetchableUrl(target));
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_FILE_BYTES) return null;
      const audio = await ctx.decodeAudioData(buf);
      decodedSizes.set(url, audio.length * audio.numberOfChannels);
      evictIfNeeded(url);
      return audio;
    } catch {
      return null;
    }
  })();
  decodeCache.set(url, p);
  p.then(v => {
    if (!v) decodeCache.delete(url);
  });
  return p;
}

/* ---------------------------------------------------------------------------------------------- */
/* Player                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

interface Slot {
  start: number;
  end: number;
  planIndex: number;
}

export function createSequencePlayer<T extends PlayerClip>(opts: SequencePlayerOptions<T>): SequencePlayer {
  let token = 0;
  let sources: AudioBufferSourceNode[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;

  const cleanup = () => {
    if (timer) clearInterval(timer);
    timer = null;
    for (const s of sources) {
      try {
        s.onended = null;
        s.stop();
      } catch {
        /* already stopped */
      }
      try {
        s.disconnect();
      } catch {
        /* ignore */
      }
    }
    sources = [];
  };

  const stop = () => {
    token++;
    cleanup();
  };

  const start = async (fromPlanIndex: number) => {
    stop();
    const my = token;
    const ctx = opts.ctx || getSharedAudioContext();
    const decode = opts.decode || ((url: string, c: AudioContext) => decodeAudioUrl(url, c, opts.resolveUrl));
    try {
      if (ctx.state === 'suspended') await ctx.resume();
    } catch {
      /* resume may reject without a user gesture; scheduling still works once resumed */
    }

    const items = opts.plan.items.slice(Math.max(0, fromPlanIndex));
    if (items.length === 0) {
      opts.callbacks.onEnd();
      return;
    }

    const buffers: Array<AudioBuffer | null> = [];
    for (let i = 0; i < items.length; i++) {
      opts.callbacks.onStatus(items.length > 1 ? `Decoding ${i + 1}/${items.length}…` : 'Decoding…');
      const url = items[i].clip.audioUrl;
      buffers.push(url ? await decode(url, ctx) : null);
      if (token !== my) return; // stopped or restarted while decoding
    }
    opts.callbacks.onStatus('');

    const fade = Math.max(0, opts.fadeMs) / 1000;
    const slots: Slot[] = [];
    let cursor = ctx.currentTime + 0.08;

    items.forEach((it, k) => {
      const buf = buffers[k];
      if (!buf) {
        opts.callbacks.onError(`Skipped clip #${it.index + 1}: its audio could not be loaded.`);
        return;
      }

      let effStart = it.effStart;
      let effDur = it.effDur;
      const c = it.clip as any;
      if (!c?.windowVerified && effStart >= buf.duration - 0.02) {
        const reconciled = reconcileWindow(c as ClipLike, buf.duration);
        effStart = reconciled.startSec;
        effDur = reconciled.endSec - reconciled.startSec;
      }

      const offset = Math.min(effStart, Math.max(0, buf.duration - 0.01));
      const dur = Math.min(effDur, buf.duration - offset);
      if (!(dur > 0.02)) {
        opts.callbacks.onError(`Skipped clip #${it.index + 1}: its window is outside the audio file.`);
        return;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      if (fade > 0 && dur > fade * 2) {
        gain.gain.setValueAtTime(0, cursor);
        gain.gain.linearRampToValueAtTime(1, cursor + fade);
        gain.gain.setValueAtTime(1, cursor + dur - fade);
        gain.gain.linearRampToValueAtTime(0, cursor + dur);
      } else {
        gain.gain.setValueAtTime(1, cursor);
      }
      src.connect(gain);
      gain.connect(ctx.destination);
      src.start(cursor, offset, dur);
      sources.push(src);
      slots.push({ start: cursor, end: cursor + dur, planIndex: it.index });
      cursor += dur + it.gapAfter;
    });

    if (slots.length === 0) {
      opts.callbacks.onEnd();
      return;
    }

    let current = -1;
    const lastEnd = slots[slots.length - 1].end;
    timer = setInterval(() => {
      if (token !== my) return;
      const now = ctx.currentTime;
      for (const s of slots) {
        if (now >= s.start && now < s.end) {
          if (s.planIndex !== current) {
            current = s.planIndex;
            opts.callbacks.onIndex(current);
          }
          const clipProgress = Math.max(0, Math.min(1, (now - s.start) / Math.max(0.001, s.end - s.start)));
          const sequenceElapsedSec = Math.max(0, now - slots[0].start);
          opts.callbacks.onProgress?.(current, clipProgress, sequenceElapsedSec);
          break;
        }
      }
      if (now >= lastEnd + 0.03) {
        cleanup();
        opts.callbacks.onEnd();
      }
    }, 25);
  };

  return { start, stop };
}
