/**
 * Script Studio code gates (pure, deterministic, vitest-tested), run before any model judges quality.
 *
 *  - verbatim: each EvidenceRef.verbatim must appear in the JOINED text of contiguous same-speaker
 *    transcript segments overlapping its time window (most quotes cross a segment boundary).
 *  - clip bounds: 0 <= inSec < outSec <= durationSec (clip-relative).
 *  - locks: a locked block in the baseline must be present, unchanged, in the candidate.
 *  - runtime: within 10 percent of the target.
 *  - investigative attribution: a single-source claim must use attribution wording.
 *  - applyPatch: replaces one scene's blocks; refuses to drop or edit a locked block, or to name an
 *    unknown block or clip. Locked blocks are never silently re-inserted.
 */
import { hasValidTake } from './scriptAudio';
import { findExcerpt, normalizeText } from './directorValidate';
import type {
  Block, Critique, EpisodeFormat, EvidenceRef, GateResult, JudgeConsensus, JudgeWinner, NarrativeFunction,
  Scene, ScriptVersion, Segment, StudioClip,
} from './scriptTypes';
import { NARRATIVE_FUNCTIONS } from './scriptTypes';

export interface TranscriptSeg { start: number; end: number; speaker: string; text: string }

export const RUNTIME_TOLERANCE = 0.1;
export const DEFAULT_NARRATION_WPM = 155;
export const LONG_SENTENCE_WORDS = 28;
const WINDOW_SLACK_SEC = 0.5;

const sameSpeaker = (a: string, b: string, names: Record<string, string> = {}) => {
  const n = (s: string) => (names[s] || s || '').trim().toLowerCase();
  return n(a) === n(b);
};

/* ------------------------------------------------------------------------------------------------ */
/* Verbatim                                                                                          */
/* ------------------------------------------------------------------------------------------------ */

/**
 * Returns the joined texts of every maximal run of consecutive same-speaker segments (by speaker
 * `speaker`) that overlaps [from, to]. Runs extend past the window to neighbouring segments of the
 * same speaker, so a quote that starts or ends just outside the window is still found.
 */
export function sameSpeakerRuns(segments: TranscriptSeg[], speaker: string, from: number, to: number, names: Record<string, string> = {}): string[] {
  const runs: string[] = [];
  const lo = from - WINDOW_SLACK_SEC;
  const hi = to + WINDOW_SLACK_SEC;
  let i = 0;
  while (i < segments.length) {
    if (!sameSpeaker(segments[i].speaker, speaker, names)) { i++; continue; }
    let j = i;
    while (j + 1 < segments.length && sameSpeaker(segments[j + 1].speaker, speaker, names)) j++;
    const runStart = segments[i].start;
    const runEnd = segments[j].end;
    if (runEnd >= lo && runStart <= hi) runs.push(segments.slice(i, j + 1).map(s => s.text).join(' '));
    i = j + 1;
  }
  return runs;
}

export function verifyVerbatim(ref: EvidenceRef, segments: TranscriptSeg[], names: Record<string, string> = {}): { ok: true } | { ok: false; reason: string } {
  if (!ref.verbatim || !normalizeText(ref.verbatim)) return { ok: false, reason: 'Claim has an empty quote.' };
  if (!(ref.segEnd >= ref.segStart)) return { ok: false, reason: `Quote "${ref.verbatim.slice(0, 60)}" has an invalid time window.` };
  const runs = sameSpeakerRuns(segments, ref.speaker, ref.segStart, ref.segEnd, names);
  if (runs.length === 0) return { ok: false, reason: `No ${ref.speaker} segments near ${ref.segStart.toFixed(1)}s to ${ref.segEnd.toFixed(1)}s for "${ref.verbatim.slice(0, 60)}".` };
  if (runs.some(r => findExcerpt(r, ref.verbatim))) return { ok: true };
  return { ok: false, reason: `"${ref.verbatim.slice(0, 80)}" is not verbatim ${ref.speaker} speech at ${ref.segStart.toFixed(1)}s to ${ref.segEnd.toFixed(1)}s.` };
}

/* ------------------------------------------------------------------------------------------------ */
/* Clips, runtime, attribution                                                                       */
/* ------------------------------------------------------------------------------------------------ */

export function clipBoundsOk(block: Extract<Block, { kind: 'clip' }>, clip: StudioClip | undefined): string | null {
  if (!clip) return `Clip block ${block.id} names unknown clip ${block.clipId}.`;
  if (!(block.inSec >= 0 && block.inSec < block.outSec && block.outSec <= clip.durationSec + 1e-6)) {
    return `Clip ${block.clipId} bounds ${block.inSec}s to ${block.outSec}s are outside 0 to ${clip.durationSec}s.`;
  }
  return null;
}

export const wordCount = (s: string) => (s || '').trim().split(/\s+/).filter(Boolean).length;

export function blockSeconds(b: Block, wpm = DEFAULT_NARRATION_WPM): { sec: number; estimated: boolean } {
  if (b.type === 'HEADING' || b.kind === 'heading') return { sec: 0, estimated: false };
  if (b.type === 'CUE' || b.kind === 'cue') {
    const sec = 'sec' in b && typeof (b as any).sec === 'number' ? (b as any).sec : 0;
    return { sec: Math.max(0, sec), estimated: false };
  }
  switch (b.kind) {
    case 'narration':
      if (hasValidTake(b)) return { sec: b.takeSec, estimated: false };
      return { sec: (wordCount(b.text) / wpm) * 60, estimated: true };
    case 'clip': return { sec: Math.max(0, b.outSec - b.inSec), estimated: false };
    case 'pause': return { sec: Math.max(0, b.sec), estimated: false };
    case 'music': return { sec: 0, estimated: false };
    default: return { sec: 0, estimated: false };
  }
}

export function estimateRuntime(segments: Segment[], wpm = DEFAULT_NARRATION_WPM): { sec: number; estimated: boolean } {
  let sec = 0;
  let estimated = false;
  for (const seg of segments) for (const sc of seg.scenes) for (const b of sc.blocks) {
    const r = blockSeconds(b, wpm);
    sec += r.sec;
    estimated = estimated || r.estimated;
  }
  return { sec, estimated };
}

export function runtimeWithin(estimatedSec: number, targetSec: number, tol = RUNTIME_TOLERANCE): boolean {
  if (!(targetSec > 0)) return true;
  return Math.abs(estimatedSec - targetSec) <= targetSec * tol;
}

export const ATTRIBUTION_RE = /\b(according to|alleg(e|es|ed|ing|ation|ations)|claim(s|ed|ing)?|said|says|told|accus(e|es|ed|ing)|assert(s|ed)?|insist(s|ed)?|maintain(s|ed)?|in (his|her|their) (words|telling|account))\b/i;

/** Investigative format: a narration block resting on a single source must attribute it in words. */
export function attributionFailure(b: Block, format: EpisodeFormat | null): string | null {
  if (format !== 'investigative' || b.kind !== 'narration' || b.claims.length === 0) return null;
  const sources = new Set(b.claims.map(c => `${c.releaseTag}|${c.speaker.toLowerCase()}`));
  if (sources.size >= 2) return null;
  if (ATTRIBUTION_RE.test(b.text)) return null;
  return `Narration ${b.id} rests on one source (${b.claims[0].speaker}) but does not attribute it ("according to", "alleges", ...).`;
}

/* ------------------------------------------------------------------------------------------------ */
/* Locks and patching                                                                                */
/* ------------------------------------------------------------------------------------------------ */

export function allBlocks(segments: Segment[]): Block[] {
  return segments.flatMap(s => s.scenes.flatMap(sc => sc.blocks));
}

export function findScene(segments: Segment[], sceneId: string): { segment: Segment; scene: Scene; segIndex: number; sceneIndex: number } | null {
  for (let i = 0; i < segments.length; i++) {
    const j = segments[i].scenes.findIndex(s => s.id === sceneId);
    if (j >= 0) return { segment: segments[i], scene: segments[i].scenes[j], segIndex: i, sceneIndex: j };
  }
  return null;
}

/** Block content for comparisons. Vox take fields are audio metadata derived from the text, not content. */
const stable = (b: Block) => {
  if (b.kind !== 'narration') return JSON.stringify(b);
  const { takeUrl: _u, takeSec: _s, takeTextHash: _h, ...rest } = b;
  return JSON.stringify(rest);
};

export function locksIntact(baseline: Segment[], candidate: Segment[]): string[] {
  const cand = new Map(allBlocks(candidate).map(b => [b.id, b]));
  const failures: string[] = [];
  for (const b of allBlocks(baseline)) {
    if (!b.locked) continue;
    const c = cand.get(b.id);
    if (!c) failures.push(`Locked block ${b.id} was dropped.`);
    else if (stable(c) !== stable(b)) failures.push(`Locked block ${b.id} was changed.`);
  }
  return failures;
}

/** Block shapes a model may return for one scene. Locked blocks are referenced with {kind:'keep', id}. */
export type PatchBlock =
  | { kind: 'keep'; id: string }
  | { kind: 'narration'; text: string; mode?: 'live' | 'polished'; claims?: EvidenceRef[] }
  | { kind: 'clip'; clipId: string; keptText: string; fn?: string; rationale?: string }
  | { kind: 'pause'; sec: number }
  | { kind: 'music'; cue: string; note: string };

export interface TrimFn {
  (clip: StudioClip, keptText: string): Promise<{ ok: true; inSec: number; outSec: number; basis: 'segment' | 'silence' | 'estimated' | 'full' } | { ok: false; reason: string }>;
}

export interface PatchOptions {
  clipsById: Record<string, StudioClip>;
  trim: TrimFn;
  newId: () => string;
  /** 'reject' (revision) fails the whole patch on a bad trim; 'flag' (draft) keeps the full clip and flags it. */
  onBadTrim: 'reject' | 'flag';
}

const MUSIC_CUES = ['sting', 'bed_in', 'bed_out', 'transition'];

export async function materializeBlocks(
  patch: PatchBlock[],
  existing: Map<string, Block>,
  opts: PatchOptions
): Promise<{ ok: true; blocks: Block[] } | { ok: false; reason: string }> {
  const out: Block[] = [];
  for (const p of patch) {
    if (!p || typeof p !== 'object') return { ok: false, reason: 'Patch contains a non-object block.' };
    switch (p.kind) {
      case 'keep': {
        const b = existing.get(p.id);
        if (!b) return { ok: false, reason: `Patch names unknown block ${p.id}.` };
        out.push(b);
        break;
      }
      case 'narration':
        if (typeof p.text !== 'string' || !p.text.trim()) return { ok: false, reason: 'Narration block without text.' };
        out.push({ id: opts.newId(), kind: 'narration', text: p.text.trim(), mode: p.mode === 'polished' ? 'polished' : 'live', claims: Array.isArray(p.claims) ? p.claims : [] });
        break;
      case 'clip': {
        const clip = opts.clipsById[p.clipId];
        if (!clip) return { ok: false, reason: `Patch names unknown clip ${p.clipId}.` };
        const fn = (NARRATIVE_FUNCTIONS as string[]).includes(p.fn || '') ? (p.fn as NarrativeFunction) : (clip.fn || 'evidence');
        const t = await opts.trim(clip, p.keptText || clip.text);
        if (t.ok === false) {
          if (opts.onBadTrim === 'reject') return { ok: false, reason: `Clip ${p.clipId}: ${t.reason}` };
          out.push({ id: opts.newId(), kind: 'clip', clipId: clip.clipId, keptText: clip.text, inSec: 0, outSec: clip.durationSec, trimBasis: 'full', fn, rationale: p.rationale || '', flag: `Trim not applied: ${t.reason}` });
        } else {
          out.push({ id: opts.newId(), kind: 'clip', clipId: clip.clipId, keptText: p.keptText || clip.text, inSec: t.inSec, outSec: t.outSec, trimBasis: t.basis, fn, rationale: p.rationale || '' });
        }
        break;
      }
      case 'pause': {
        const sec = Number(p.sec);
        if (!(sec > 0 && sec <= 10)) return { ok: false, reason: `Pause of ${p.sec}s is outside 0 to 10s.` };
        out.push({ id: opts.newId(), kind: 'pause', sec });
        break;
      }
      case 'music':
        if (!MUSIC_CUES.includes(p.cue)) return { ok: false, reason: `Unknown music cue ${p.cue}.` };
        out.push({ id: opts.newId(), kind: 'music', cue: p.cue as any, note: String(p.note || '') });
        break;
      default:
        return { ok: false, reason: `Unknown block kind ${(p as any).kind}.` };
    }
  }
  return { ok: true, blocks: out };
}

/** Replace one scene's blocks with a patch. Rejects a patch that drops or edits a locked block. */
export async function applyPatch(
  version: ScriptVersion,
  sceneId: string,
  patch: PatchBlock[],
  opts: PatchOptions & { newVersionId: string; now: number; author?: ScriptVersion['author'] }
): Promise<{ ok: true; version: ScriptVersion } | { ok: false; reason: string }> {
  const loc = findScene(version.segments, sceneId);
  if (!loc) return { ok: false, reason: `Patch targets unknown scene ${sceneId}.` };
  const existing = new Map(loc.scene.blocks.map(b => [b.id, b]));
  const keptIds = new Set(patch.filter((p): p is { kind: 'keep'; id: string } => p?.kind === 'keep').map(p => p.id));
  for (const b of loc.scene.blocks) {
    if (b.locked && !keptIds.has(b.id)) return { ok: false, reason: `Patch drops locked block ${b.id}.` };
  }
  const mat = await materializeBlocks(patch, existing, opts);
  if (mat.ok === false) return mat;
  const segments: Segment[] = version.segments.map((seg, i) =>
    i !== loc.segIndex ? seg : { ...seg, scenes: seg.scenes.map((sc, j) => (j !== loc.sceneIndex ? sc : { ...sc, blocks: mat.blocks })) }
  );
  const lockFailures = locksIntact(version.segments, segments);
  if (lockFailures.length) return { ok: false, reason: lockFailures.join(' ') };
  return {
    ok: true,
    version: {
      id: opts.newVersionId, parentId: version.id, projectId: version.projectId, createdAt: opts.now,
      author: opts.author || 'loop', segments, changedScope: { level: 'scene', ids: [sceneId] },
    },
  };
}

/* ------------------------------------------------------------------------------------------------ */
/* Gates                                                                                             */
/* ------------------------------------------------------------------------------------------------ */

export interface GateContext {
  baseline: Segment[];
  transcripts: Record<string, TranscriptSeg[]>;   // releaseTag -> segments
  speakerNames?: Record<string, string>;
  clipsById: Record<string, StudioClip>;
  targetRuntimeSec: number;
  format: EpisodeFormat | null;
  /** Only these block ids are checked for claims and attribution (the changed ones); all when omitted. */
  changedBlockIds?: Set<string>;
  /** Format rules (utils/scriptFormats.ts). With changedBlockIds, only findings new against the baseline fail. */
  formatCheck?: (segments: Segment[]) => { hard: { key: string; message: string }[] };
}

export function changedBlockIds(baseline: Segment[], candidate: Segment[]): Set<string> {
  const base = new Map(allBlocks(baseline).map(b => [b.id, stable(b)]));
  return new Set(allBlocks(candidate).filter(b => base.get(b.id) !== stable(b)).map(b => b.id));
}

export function codeGates(candidate: Segment[], ctx: GateContext): GateResult & { ok: boolean } {
  const failures: string[] = [];
  let factual = true;
  let faithful = true;
  let boundsOk = true;
  const changed = ctx.changedBlockIds;
  for (const b of allBlocks(candidate)) {
    const isChanged = !changed || changed.has(b.id);
    if (b.kind === 'clip') {
      const err = clipBoundsOk(b, ctx.clipsById[b.clipId]);
      if (err) { boundsOk = false; failures.push(err); }
      const clip = ctx.clipsById[b.clipId];
      if (isChanged && clip && b.trimBasis !== 'full' && !findExcerpt(clip.text, b.keptText)) {
        faithful = false;
        failures.push(`Clip ${b.clipId}: kept text is not a contiguous excerpt of the clip.`);
      }
    }
    if (b.kind === 'narration' && isChanged) {
      for (const ref of b.claims) {
        const segs = ctx.transcripts[ref.releaseTag];
        if (!segs) { factual = false; failures.push(`Claim cites ${ref.releaseTag}, whose transcript is not loaded.`); continue; }
        const v = verifyVerbatim(ref, segs, ctx.speakerNames);
        if (v.ok === false) { factual = false; failures.push(v.reason); }
      }
      const a = attributionFailure(b, ctx.format);
      if (a) { faithful = false; failures.push(a); }
    }
  }
  const lockFailures = locksIntact(ctx.baseline, candidate);
  failures.push(...lockFailures);
  if (ctx.format && ctx.formatCheck) {
    const cand = ctx.formatCheck(candidate);
    const base = ctx.formatCheck(ctx.baseline);
    const added = ctx.changedBlockIds ? cand.hard.filter(f => !base.hard.some(b => b.key === f.key)) : cand.hard;
    if (added.length) { faithful = false; failures.push(...added.map(f => f.message)); }
  }
  const rt = estimateRuntime(candidate);
  const rtOk = runtimeWithin(rt.sec, ctx.targetRuntimeSec);
  if (!rtOk) failures.push(`Runtime ${Math.round(rt.sec)}s${rt.estimated ? ' (estimated)' : ''} is not within 10% of the ${ctx.targetRuntimeSec}s target.`);
  const result: GateResult = {
    factual: factual ? 'pass' : 'fail', faithful: faithful ? 'pass' : 'fail', locksIntact: lockFailures.length === 0,
    clipBoundsOk: boundsOk, runtimeOk: rtOk, failures,
  };
  return { ...result, ok: failures.length === 0 };
}

/* ------------------------------------------------------------------------------------------------ */
/* Critique ordering, local checks, judge consensus                                                  */
/* ------------------------------------------------------------------------------------------------ */

const SEV_RANK = { blocker: 0, major: 1, minor: 2 } as const;

export function mostConsequential(crits: Critique[]): Critique | null {
  if (!crits.length) return null;
  return [...crits].sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity])[0];
}

/** Cheap local text checks, passed to the critic so the model does not spend tokens on them. */
export function localTextChecks(scene: Scene): string[] {
  const notes: string[] = [];
  const openers = new Map<string, number>();
  for (const b of scene.blocks) {
    if (b.kind !== 'narration') continue;
    const sentences = b.text.split(/(?<=[.!?])\s+/).filter(s => s.trim());
    for (const s of sentences) {
      const n = wordCount(s);
      if (n > LONG_SENTENCE_WORDS) notes.push(`Block ${b.id}: a sentence of ${n} words ("${s.slice(0, 50)}...").`);
      const opener = normalizeText(s).split(' ').slice(0, 2).join(' ');
      if (opener) openers.set(opener, (openers.get(opener) || 0) + 1);
    }
  }
  for (const [o, c] of openers) if (c >= 3) notes.push(`Opener "${o}" starts ${c} sentences in this scene.`);
  return notes;
}

/**
 * Blind pairwise consensus. Order AB shows (baseline, candidate); order BA shows (candidate, baseline).
 * The candidate wins with two wins, or with one win and one tie when it targets a blocker or major critique.
 */
export function judgeConsensus(winnerAB: JudgeWinner, winnerBA: JudgeWinner, targetSeverity: Critique['severity']): { consensus: JudgeConsensus; win: boolean; candVotes: number; baseVotes: number } {
  const candVotes = (winnerAB === 'B' ? 1 : 0) + (winnerBA === 'A' ? 1 : 0);
  const baseVotes = (winnerAB === 'A' ? 1 : 0) + (winnerBA === 'B' ? 1 : 0);
  if (candVotes === 2) return { consensus: 'two_wins', win: true, candVotes, baseVotes };
  if (candVotes === 1 && baseVotes === 0 && targetSeverity !== 'minor') return { consensus: 'win_plus_tie_on_major', win: true, candVotes, baseVotes };
  return { consensus: 'rejected', win: false, candVotes, baseVotes };
}

/* ------------------------------------------------------------------------------------------------ */
/* Views and diffs                                                                                   */
/* ------------------------------------------------------------------------------------------------ */

/** A scene stripped of ids and lock flags, for the blind judge. */
export function anonymousScene(scene: Scene, clipsById: Record<string, StudioClip>): unknown {
  return {
    title: scene.title,
    purpose: scene.purpose,
    blocks: scene.blocks.map(b => {
      switch (b.kind) {
        case 'narration': return { kind: 'narration', text: b.text };
        case 'clip': return { kind: 'clip', speaker: clipsById[b.clipId]?.speaker || '', words: b.keptText, seconds: Math.round((b.outSec - b.inSec) * 10) / 10 };
        case 'pause': return { kind: 'pause', sec: b.sec };
        case 'music': return { kind: 'music_marker', cue: b.cue, note: b.note };
      }
    }),
  };
}

export interface BlockDiff { blockId: string; change: 'added' | 'removed' | 'changed'; before?: Block; after?: Block }

export function diffVersions(before: Segment[], after: Segment[]): BlockDiff[] {
  const a = new Map(allBlocks(before).map(b => [b.id, b]));
  const b = new Map(allBlocks(after).map(x => [x.id, x]));
  const out: BlockDiff[] = [];
  for (const [id, blk] of a) {
    const nb = b.get(id);
    if (!nb) out.push({ blockId: id, change: 'removed', before: blk });
    else if (stable(nb) !== stable(blk)) out.push({ blockId: id, change: 'changed', before: blk, after: nb });
  }
  for (const [id, blk] of b) if (!a.has(id)) out.push({ blockId: id, change: 'added', after: blk });
  return out;
}

/** First and last narration or clip line of a scene, for neighbour context. */
export function boundaryLines(scene: Scene | undefined): { first: string; last: string } | null {
  if (!scene) return null;
  const lines = scene.blocks.map(b => (b.kind === 'narration' ? b.text : b.kind === 'clip' ? b.keptText : '')).filter(Boolean);
  if (!lines.length) return null;
  return { first: lines[0].slice(0, 300), last: lines[lines.length - 1].slice(0, 300) };
}

/* ------------------------------------------------------------------------------------------------ */
/* Episode structure                                                                                 */
/* ------------------------------------------------------------------------------------------------ */

/**
 * Applies a proposed scene order. Every existing segment must appear once, and every scene exactly once
 * (scenes may move between segments; none added or dropped). Blocks are untouched.
 */
export function reorderScenes(segments: Segment[], order: { segmentId: string; sceneIds: string[] }[]):
  { ok: true; segments: Segment[]; moved: string[] } | { ok: false; reason: string } {
  const segById = new Map(segments.map(s => [s.id, s]));
  const sceneById = new Map(segments.flatMap(s => s.scenes.map(sc => [sc.id, sc] as const)));
  if (order.length !== segments.length || new Set(order.map(o => o.segmentId)).size !== order.length || order.some(o => !segById.has(o.segmentId))) {
    return { ok: false, reason: 'The proposed order does not list every segment exactly once.' };
  }
  const seen = new Set<string>();
  for (const o of order) for (const id of o.sceneIds) {
    if (!sceneById.has(id)) return { ok: false, reason: `The proposed order names unknown scene ${id}.` };
    if (seen.has(id)) return { ok: false, reason: `The proposed order lists scene ${id} twice.` };
    seen.add(id);
  }
  if (seen.size !== sceneById.size) return { ok: false, reason: `The proposed order drops ${[...sceneById.keys()].filter(id => !seen.has(id)).join(', ')}.` };
  const before = segments.map(s => `${s.id}:${s.scenes.map(sc => sc.id).join(',')}`).join('|');
  const next: Segment[] = order.map(o => ({ ...segById.get(o.segmentId)!, scenes: o.sceneIds.map(id => sceneById.get(id)!) }));
  const after = next.map(s => `${s.id}:${s.scenes.map(sc => sc.id).join(',')}`).join('|');
  if (before === after) return { ok: false, reason: 'The proposed order is the current order.' };
  const pos = (segs: Segment[]) => new Map(segs.flatMap((s, si) => s.scenes.map((sc, i) => [sc.id, `${si}.${i}`] as const)));
  const a = pos(segments); const b = pos(next);
  return { ok: true, segments: next, moved: [...a.keys()].filter(id => a.get(id) !== b.get(id)) };
}

/** What the episode pass and its judge see: titles, purposes, first and last lines and seconds; no ids for the judge. */
export function episodeOutlineView(segments: Segment[], withIds: boolean): unknown {
  return segments.map(seg => ({
    ...(withIds ? { segmentId: seg.id } : {}), title: seg.title,
    scenes: seg.scenes.map(sc => {
      const b = boundaryLines(sc);
      const seconds = Math.round(sc.blocks.reduce((s, x) => s + blockSeconds(x).sec, 0));
      return { ...(withIds ? { sceneId: sc.id } : {}), title: sc.title, purpose: sc.purpose, first: b?.first ?? '', last: b?.last ?? '', seconds };
    }),
  }));
}
