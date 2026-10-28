/**
 * Script Studio audio helpers (pure, shared by server and browser).
 *
 * Vox takes are cached by a hash of the narration text: a take belongs to a block only while the block's
 * text still hashes to the take's hash, so an edited line falls back to its words-per-minute estimate
 * (marked "estimated") instead of keeping a stale duration.
 */
import type { Block, Scene, Segment } from './scriptTypes';

/** The voice every Script Studio take is synthesized in: Logan's existing VoxCPM reference sample. */
export const TAKE_VOICE = 'Logan';

const normalizeText = (s: string) => (s || '').replace(/\s+/g, ' ').trim();

function fnv1a(s: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 64-bit hex hash of the voice and normalized text; stable across server and browser. */
export function takeTextHash(text: string, voice = TAKE_VOICE): string {
  const s = `${voice}\u0000${normalizeText(text)}`;
  return fnv1a(s, 0x811c9dc5).toString(16).padStart(8, '0') + fnv1a(s, 0x050c5d1f).toString(16).padStart(8, '0');
}

type Narration = Extract<Block, { kind: 'narration' }>;

/** True when the block carries a real Vox take that matches its current text. */
export function hasValidTake(b: Block): b is Narration & { takeUrl: string; takeSec: number; takeTextHash: string } {
  return b.kind === 'narration' && !!b.takeUrl && typeof b.takeSec === 'number' && b.takeSec > 0 && b.takeTextHash === takeTextHash(b.text);
}

export interface TakeRecord { hash: string; url: string; sec: number; createdAt: number; voice: string; model: string }
export type TakeIndex = Record<string, TakeRecord>;

/** Sets take fields on narration blocks whose text has a cached take, and removes stale ones. */
export function attachTakes(segments: Segment[], index: TakeIndex): Segment[] {
  return segments.map(seg => ({
    ...seg,
    scenes: seg.scenes.map(sc => ({
      ...sc,
      blocks: sc.blocks.map(b => {
        if (b.kind !== 'narration') return b;
        const { takeUrl: _u, takeSec: _s, takeTextHash: _h, ...rest } = b;
        const hash = takeTextHash(b.text);
        const t = index[hash];
        return t ? { ...rest, takeUrl: t.url, takeSec: t.sec, takeTextHash: hash } : rest;
      }),
    })),
  }));
}

/** Narration blocks in scope (whole script, or one scene) that have text to speak. */
export function narrationInScope(segments: Segment[], sceneId?: string): Narration[] {
  const out: Narration[] = [];
  for (const seg of segments) for (const sc of seg.scenes) {
    if (sceneId && sc.id !== sceneId) continue;
    for (const b of sc.blocks) {
      if (b.kind === 'narration' && normalizeText(b.text)) {
        if (b.type === 'HEADING') continue;
        out.push(b);
      }
    }
  }
  return out;
}

export const countTakes = (segments: Segment[]) => {
  let withTake = 0, narration = 0;
  for (const seg of segments) for (const sc of seg.scenes) for (const b of sc.blocks) {
    if (b.kind !== 'narration' || !normalizeText(b.text)) continue;
    if (b.type && b.type !== 'NARRATION') continue;
    narration++;
    if (hasValidTake(b)) withTake++;
  }
  return { withTake, narration };
};

/* ------------------------------------------------------------------------------------------------ */
/* Spoken-audio view and local pacing checks (step 16)                                               */
/* ------------------------------------------------------------------------------------------------ */

/** Above this many words per second a real take sounds rushed; below the slow line it drags. */
export const RUSHED_WPS = 3.3;
export const SLOW_WPS = 1.7;
/** Narration running longer than this with no pause or clip gives the listener no breath point. */
export const BREATH_SEC = 40;

const words = (s: string) => normalizeText(s).split(' ').filter(Boolean);
const r1 = (n: number) => Math.round(n * 10) / 10;

export interface SpokenBlockView {
  id: string; kind: Block['kind'];
  text?: string; seconds: number; durationSource: 'vox' | 'estimated' | 'clip' | 'pause' | 'marker';
  wordsPerSec?: number; speaker?: string; cue?: string;
}

/** A scene as it will be heard: every block with its duration and where that duration came from. */
export function spokenSceneView(scene: Scene, clips: Record<string, { speaker: string }>, wpm = 155): { sceneId: string; title: string; purpose: string; blocks: SpokenBlockView[] } {
  return {
    sceneId: scene.id, title: scene.title, purpose: scene.purpose,
    blocks: scene.blocks.filter(b => !b.locked).map((b): SpokenBlockView => {
      switch (b.kind) {
        case 'narration': {
          const n = words(b.text).length;
          if (hasValidTake(b)) return { id: b.id, kind: 'narration', text: b.text, seconds: r1(b.takeSec), durationSource: 'vox', wordsPerSec: r1(n / b.takeSec) };
          return { id: b.id, kind: 'narration', text: b.text, seconds: r1((n / wpm) * 60), durationSource: 'estimated' };
        }
        case 'clip': return { id: b.id, kind: 'clip', text: b.keptText, seconds: r1(b.outSec - b.inSec), durationSource: 'clip', speaker: clips[b.clipId]?.speaker };
        case 'pause': return { id: b.id, kind: 'pause', seconds: b.sec, durationSource: 'pause' };
        case 'music': return { id: b.id, kind: 'music', seconds: 0, durationSource: 'marker', cue: b.cue, text: b.note };
        case 'heading': return { id: b.id, kind: 'heading', text: b.text, seconds: 0, durationSource: 'marker' };
        case 'cue': return { id: b.id, kind: 'cue', text: b.text || b.note, seconds: r1(b.sec || 0), durationSource: b.sec ? 'pause' : 'marker', cue: b.cueType };
        default: return { id: (b as any).id, kind: (b as any).kind, seconds: 0, durationSource: 'marker' };
      }
    }),
  };
}

/** Local, code-only pacing notes for one scene, passed to the spoken critique as facts. */
export function spokenChecks(scene: Scene): string[] {
  const notes: string[] = [];
  let run = 0;
  let runStart = '';
  const openers: string[] = [];
  for (const b of scene.blocks) {
    if (b.kind === 'narration') {
      const n = words(b.text).length;
      if (hasValidTake(b) && b.takeSec >= 2) {
        const wps = n / b.takeSec;
        if (wps > RUSHED_WPS) notes.push(`Block ${b.id} is rushed: ${r1(wps)} words per second in the Vox take (comfortable is under ${RUSHED_WPS}).`);
        else if (wps < SLOW_WPS) notes.push(`Block ${b.id} drags: ${r1(wps)} words per second in the Vox take.`);
      }
      const sec = hasValidTake(b) ? b.takeSec : (n / 155) * 60;
      if (run === 0) runStart = b.id;
      run += sec;
      if (run > BREATH_SEC) { notes.push(`Narration from block ${runStart} runs ${Math.round(run)} s with no pause or clip.`); run = 0; }
      const opener = words(b.text).slice(0, 2).join(' ').toLowerCase().replace(/[^a-z' ]/g, '');
      if (opener) openers.push(opener);
    } else if (b.kind === 'clip' || (b.kind === 'pause' && b.sec >= 0.5)) {
      run = 0;
    }
  }
  const seen = new Map<string, number>();
  for (const o of openers) seen.set(o, (seen.get(o) || 0) + 1);
  for (const [o, n] of seen) if (n > 1) notes.push(`${n} narration lines in this scene open with "${o}".`);
  return notes;
}
