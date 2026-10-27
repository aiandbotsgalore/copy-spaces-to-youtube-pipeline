/**
 * Optional Grok Bot deep passes (Phase 6), by file handoff only: the app exports a self-contained
 * pack.json for one project, Logan attaches it in a Grok Bot chat, and imports the result.json it
 * returns. Nothing is pushed or published from the app. Everything imported is checked in code exactly
 * like the in-app loop's own output: quotes must be verbatim, ids must resolve, clip times are computed
 * from the kept words, locked blocks survive, and every candidate waits for Logan's accept or reject.
 *
 * Kinds:
 *   refine     overnight-style refinement of the current script -> candidate versions
 *   factcheck  cross-archive fact check of every narration block -> labels with verified evidence
 *   storyline  other recordings that continue, contradict or deepen the thesis -> suggestions with verified quotes
 */
import { createHash } from 'node:crypto';
import type { Block, EpisodeAnalysis, ScriptProject, ScriptVersion, StudioClip } from '../utils/scriptTypes';
import { verifyVerbatim } from '../utils/scriptGates';
import { dateOfTag } from '../utils/scriptFormats';
import { BASE_RULES, BLOCK_RULES, formatBrief, PROMPT_VERSIONS } from './scriptPrompts';
import { isSafeTag, namedSegments, readTranscript, RELEASE_URL_RE, toEvidenceRefs, type LoadedTranscript } from './scriptData';
import type { Corpus } from './scriptCorpus';

export const HANDOFF_KINDS = ['refine', 'factcheck', 'storyline'] as const;
export type HandoffKind = typeof HANDOFF_KINDS[number];
export const PACK_KIND = 'spacepipe-studio-pack';
export const RESULT_KIND = 'spacepipe-studio-result';
const MAX_CANDIDATES = 5;
const MAX_ITEMS = 200;

export interface VerifiedQuote { releaseTag: string; utteranceIds: string[]; speaker: string; verbatim: string; start: number; end: number }
export interface ImportSummary {
  at: number; report: string; warnings: string[];
  candidates: { label: string; summary: string; versionId?: string; gatesOk?: boolean; failures?: string[]; error?: string }[];
  factchecks: { blockId: string; label: 'supported' | 'overstated' | 'unsupported'; note: string; evidence: VerifiedQuote[]; droppedEvidence: number }[];
  recordings: { releaseTag: string; title: string; date: string | null; why: string; quotes: VerifiedQuote[]; droppedQuotes: number; alreadySource: boolean }[];
}
export interface HandoffRecord {
  requestId: string; projectId: string; kind: HandoffKind; baseVersionId: string; createdAt: number;
  promptVersion: string; packHash: string; packBytes: number; note: string;
  status: 'exported' | 'imported'; imports: ImportSummary[];
}

/* ------------------------------------------------------------------------------------------------ */
/* Pack                                                                                             */
/* ------------------------------------------------------------------------------------------------ */

const quoteSchema = { type: 'object', required: ['releaseTag', 'utteranceIds', 'verbatim'], properties: { releaseTag: { type: 'string' }, utteranceIds: { type: 'array', items: { type: 'string' } }, verbatim: { type: 'string' } } };
export const RESULT_SCHEMA = {
  type: 'object',
  required: ['kind', 'version', 'requestId', 'projectId', 'baseVersionId', 'report'],
  properties: {
    kind: { const: RESULT_KIND }, version: { const: 1 }, requestId: { type: 'string' }, projectId: { type: 'string' }, baseVersionId: { type: 'string' },
    report: { type: 'string', description: 'Markdown: what you did, what you found, what you could not check.' },
    candidates: { type: 'array', maxItems: MAX_CANDIDATES, items: { type: 'object', required: ['label', 'summary', 'scenes'], properties: {
      label: { type: 'string' }, summary: { type: 'string' },
      scenes: { type: 'array', items: { type: 'object', required: ['sceneId', 'blocks'], properties: { sceneId: { type: 'string' }, blocks: { type: 'array', items: { type: 'object' } } } } },
    } } },
    factchecks: { type: 'array', items: { type: 'object', required: ['blockId', 'label', 'note', 'evidence'], properties: {
      blockId: { type: 'string' }, label: { enum: ['supported', 'overstated', 'unsupported'] }, note: { type: 'string' }, evidence: { type: 'array', items: quoteSchema },
    } } },
    recordings: { type: 'array', items: { type: 'object', required: ['releaseTag', 'why', 'quotes'], properties: {
      releaseTag: { type: 'string' }, why: { type: 'string' }, quotes: { type: 'array', items: quoteSchema },
    } } },
  },
};

const TASKS: Record<HandoffKind, string> = {
  refine: `Refine the base script the way the in-app loop does, with more time: critique each scene against the format rubric, then rewrite the weakest scenes. Return at most ${MAX_CANDIDATES} candidates in "candidates". Each candidate lists the scenes it changes ("sceneId" from the base) with the scene's FULL new block list. Unchanged scenes are left out. Blocks follow the block rules below; claims cite utterance ids exactly as they appear in "transcripts" of this pack. Never write clip times: give the kept words of a clip, code computes the times. Leave "factchecks" and "recordings" empty.`,
  factcheck: `Fact-check every narration block of the base script against the archive. For each narration block id give a label: supported (the recordings say it), overstated (the recordings say less, or an allegation is stated as fact) or unsupported (no recording says it), a one-line note, and up to 3 evidence quotes. Evidence may come from any recording in the archive: the transcripts of this project are in this pack; the rest are in the repository at "archive.transcriptsPath" (utterance id u<i> is segments[i] of that file), if you can read it. Quote the words exactly and give the release tag and the utterance ids of the quote. Leave "candidates" and "recordings" empty.`,
  storyline: `Find other recordings in the archive that continue, contradict or deepen this episode's thesis or story, for a multi-recording episode. For each, give its release tag, why it belongs (one or two sentences, with its date), and 1 to 3 exact quotes with utterance ids. The archive's transcripts are in the repository at "archive.transcriptsPath" (utterance id u<i> is segments[i] of that file), if you can read it; recordings already in the project are listed in "project.recordings". Leave "candidates" and "factchecks" empty.`,
};

export function packInstructions(kind: HandoffKind): string {
  return `${BASE_RULES}

This is an optional deep pass for SpacePipe Script Studio, handed to Grok Bot as a file. You do not reach Logan's computer and nothing is published: reply with one JSON file, result.json, matching "resultSchema", with "kind": "${RESULT_KIND}", "version": 1, and the requestId, projectId and baseVersionId of this pack. Logan imports it in the app, where code checks every quote and id; anything that does not check out is dropped and shown to him as dropped.

Task (${kind}): ${TASKS[kind]}

${BLOCK_RULES}

"report" is short markdown: what you did, what you found, and what you could not check.`;
}

export function repoOf(t: LoadedTranscript | null | undefined): string | null {
  const m = t?.audioUrl ? RELEASE_URL_RE.exec(t.audioUrl) : null;
  return m ? `${m[1]}/${m[2]}` : null;
}

const stripTakes = (b: Block) => {
  const { takeUrl, takeSec, takeTextHash, ...rest } = b as any;
  void takeUrl; void takeSec; void takeTextHash;
  return rest;
};

export function buildPack(args: {
  kind: HandoffKind; requestId: string; createdAt: number; project: ScriptProject; base: ScriptVersion; corpus: Corpus;
  analysis: EpisodeAnalysis | null; clips: (StudioClip & { recorded?: string | null })[]; styleCard: string; rules: string[]; approvedPassages: string[];
}) {
  const { project, base, corpus } = args;
  const repo = repoOf(corpus.recordings[0]?.t);
  return {
    kind: PACK_KIND, version: 1, promptVersion: PROMPT_VERSIONS.handoff, requestId: args.requestId, createdAt: new Date(args.createdAt).toISOString(),
    task: args.kind, projectId: project.id, baseVersionId: base.id,
    instructions: packInstructions(args.kind),
    resultSchema: RESULT_SCHEMA,
    archive: { repository: repo, transcriptsPath: 'public/transcripts/episodes/<releaseTag>.json', utteranceIds: 'u<i> is segments[i] of the transcript file' },
    project: {
      title: project.title, format: project.format, formatBrief: formatBrief(project.format), thesis: project.thesis || null, targetRuntimeSec: project.targetRuntimeSec,
      recordings: corpus.recordings.map(r => ({ key: corpus.multi ? r.key : null, releaseTag: r.tag, date: r.date, title: r.t.title })),
      idNote: corpus.multi ? 'Several recordings: ids in "transcripts" carry the recording key (E1.u92). Use them exactly in candidate claims.' : 'One recording: ids are u<i>.',
    },
    style: { card: args.styleCard || null, rules: args.rules, approvedPassages: args.approvedPassages },
    base: { versionId: base.id, label: base.label || null, segments: base.segments.map(sg => ({ ...sg, scenes: sg.scenes.map(sc => ({ ...sc, blocks: sc.blocks.map(stripTakes) })) })) },
    clips: args.clips.map(c => ({ clipId: c.clipId, title: c.title, speaker: c.speaker, releaseTag: c.releaseTag, durationSec: c.durationSec, fn: c.fn ?? null, text: c.text })),
    analysis: args.analysis ? { themes: args.analysis.themes, moments: args.analysis.moments.map(m => ({ id: m.id, kind: m.kind, why: m.why, speakers: m.speakers, utteranceIds: m.utteranceIds })), openQuestions: args.analysis.openQuestions } : null,
    transcripts: corpus.recordings.map(r => ({ releaseTag: r.tag, key: corpus.multi ? r.key : null, date: r.date, lines: r.t.utterances.map((_, i) => corpus.line(r, i)) })),
  };
}

export const packHash = (json: string) => createHash('sha256').update(json).digest('hex');

/* ------------------------------------------------------------------------------------------------ */
/* Result                                                                                           */
/* ------------------------------------------------------------------------------------------------ */

export function checkResultHeader(raw: any, rec: HandoffRecord): string | null {
  if (!raw || typeof raw !== 'object') return 'result.json is not a JSON object.';
  if (raw.kind !== RESULT_KIND) return `This is not a Script Studio result (kind should be "${RESULT_KIND}").`;
  if (raw.version !== 1) return `Unsupported result version ${JSON.stringify(raw.version)}.`;
  if (raw.requestId !== rec.requestId) return `The result answers request ${raw.requestId}, not ${rec.requestId}.`;
  if (raw.projectId !== rec.projectId) return 'The result belongs to another project.';
  if (raw.baseVersionId !== rec.baseVersionId) return `The result is based on version ${raw.baseVersionId}, but the pack was exported from ${rec.baseVersionId}.`;
  for (const k of ['candidates', 'factchecks', 'recordings'] as const) if (raw[k] !== undefined && !Array.isArray(raw[k])) return `"${k}" must be a list.`;
  return null;
}

/** Verifies archive-wide quotes: the recording exists, the ids resolve, the words are verbatim same-speaker speech. */
export function verifyArchiveQuotes(root: string, quotes: unknown, cache: Map<string, LoadedTranscript | null>): { ok: VerifiedQuote[]; dropped: number } {
  const ok: VerifiedQuote[] = [];
  let dropped = 0;
  for (const q of Array.isArray(quotes) ? quotes.slice(0, 5) : []) {
    const tag = String((q as any)?.releaseTag || '');
    const ids = Array.isArray((q as any)?.utteranceIds) ? (q as any).utteranceIds.map(String).map((id: string) => id.replace(/^E\d+\./, '')) : [];
    if (!isSafeTag(tag)) { dropped++; continue; }
    if (!cache.has(tag)) cache.set(tag, readTranscript(root, tag));
    const t = cache.get(tag);
    if (!t) { dropped++; continue; }
    const ev = toEvidenceRefs([{ utteranceIds: ids, verbatim: String((q as any)?.verbatim || '') }], t, {});
    if (ev.ok === false || !verifyVerbatim(ev.refs[0], namedSegments(t, {}), {}).ok) { dropped++; continue; }
    const r = ev.refs[0];
    ok.push({ releaseTag: tag, utteranceIds: ids, speaker: r.speaker, verbatim: r.verbatim, start: r.segStart, end: r.segEnd });
  }
  return { ok, dropped };
}

export function narrationIds(v: ScriptVersion): Set<string> {
  return new Set(v.segments.flatMap(s => s.scenes.flatMap(sc => sc.blocks)).filter(b => b.kind === 'narration').map(b => b.id));
}

export function checkFactchecks(root: string, raw: unknown, base: ScriptVersion, cache: Map<string, LoadedTranscript | null>, warnings: string[]): ImportSummary['factchecks'] {
  const ids = narrationIds(base);
  const out: ImportSummary['factchecks'] = [];
  for (const f of Array.isArray(raw) ? raw.slice(0, MAX_ITEMS) : []) {
    const blockId = String((f as any)?.blockId || '');
    const label = (f as any)?.label;
    if (!ids.has(blockId)) { warnings.push(`Fact check for unknown narration block ${blockId || '(none)'} dropped.`); continue; }
    if (!['supported', 'overstated', 'unsupported'].includes(label)) { warnings.push(`Fact check for ${blockId} has no valid label; dropped.`); continue; }
    const ev = verifyArchiveQuotes(root, (f as any)?.evidence, cache);
    out.push({ blockId, label, note: String((f as any)?.note || '').slice(0, 1000), evidence: ev.ok, droppedEvidence: ev.dropped });
  }
  const missing = [...ids].filter(id => !out.some(f => f.blockId === id));
  if (out.length && missing.length) warnings.push(`${missing.length} narration block(s) were not fact-checked: ${missing.slice(0, 10).join(', ')}.`);
  return out;
}

export function checkRecordings(root: string, raw: unknown, project: ScriptProject, cache: Map<string, LoadedTranscript | null>, warnings: string[]): ImportSummary['recordings'] {
  const out: ImportSummary['recordings'] = [];
  for (const r of Array.isArray(raw) ? raw.slice(0, 50) : []) {
    const tag = String((r as any)?.releaseTag || '');
    if (!isSafeTag(tag)) { warnings.push(`Suggested recording ${tag || '(none)'} has an invalid tag; dropped.`); continue; }
    if (!cache.has(tag)) cache.set(tag, readTranscript(root, tag));
    const t = cache.get(tag);
    if (!t) { warnings.push(`Suggested recording ${tag} has no transcript on disk; dropped.`); continue; }
    const quotes = verifyArchiveQuotes(root, ((r as any)?.quotes || []).map((q: any) => ({ ...q, releaseTag: tag })), cache);
    if (!quotes.ok.length) { warnings.push(`Suggested recording ${tag}: none of its quotes are in the transcript; dropped.`); continue; }
    out.push({ releaseTag: tag, title: t.title, date: dateOfTag(tag), why: String((r as any)?.why || '').slice(0, 1000), quotes: quotes.ok, droppedQuotes: quotes.dropped, alreadySource: project.sourceTags.includes(tag) });
  }
  return out;
}
