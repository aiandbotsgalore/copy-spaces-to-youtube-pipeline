/**
 * Multi-recording projects. A project can draw on several of Logan's recordings (thematic and
 * investigative episodes). With one recording, ids stay as they are (u92, c0-1). With more than one,
 * every utterance and moment id the models see carries its recording key (E1.u92, E2.c0-1), so a claim
 * resolves to exactly one recording and one span, and the date of each recording is known.
 */
import type { EpisodeAnalysis, EvidenceRef, MomentInsight, ScriptProject } from '../utils/scriptTypes';
import { dateOfTag } from '../utils/scriptFormats';
import { displayName, hhmmss, type LoadedTranscript, type Utterance } from './scriptData';

import { namesForTag } from '../utils/scriptNames';
export { namesForTag, scopeNamesToTag } from '../utils/scriptNames';

export interface Recording { key: string; tag: string; t: LoadedTranscript; date: string | null; names: Record<string, string> }

export interface Corpus {
  multi: boolean;
  recordings: Recording[];
  byTag(tag: string): Recording | undefined;
  qualify(tag: string, id: string): string;
  resolve(qid: string): { rec: Recording; u: Utterance; index: number } | null;
  line(rec: Recording, index: number): string;
  /** One line per recording: key, date, title, tag. Empty for single-recording projects. */
  legend(): string;
  toEvidenceRefs(refs: { utteranceIds: string[]; verbatim: string }[] | null | undefined): { ok: true; refs: EvidenceRef[] } | { ok: false; reason: string };
}

export function buildCorpus(project: ScriptProject, transcript: (tag: string) => LoadedTranscript): Corpus {
  const recordings: Recording[] = [];
  project.sourceTags.forEach((tag, i) => {
    let t: LoadedTranscript;
    try { t = transcript(tag); } catch { return; }
    recordings.push({ key: project.sourceKeys?.[tag] || `E${i + 1}`, tag, t, date: dateOfTag(tag), names: namesForTag(project.speakerNames, tag) });
  });
  const multi = project.sourceTags.length > 1;
  const indexes = new Map<string, Map<string, number>>();
  const idx = (rec: Recording) => {
    let m = indexes.get(rec.tag);
    if (!m) { m = new Map(rec.t.utterances.map((u, i) => [u.id, i])); indexes.set(rec.tag, m); }
    return m;
  };
  const byKey = new Map(recordings.map(r => [r.key, r]));
  const byTag = (tag: string) => recordings.find(r => r.tag === tag);
  const qualify = (tag: string, id: string) => {
    if (!multi) return id;
    const rec = byTag(tag);
    return rec ? `${rec.key}.${id}` : id;
  };
  const resolve = (qid: string) => {
    let rec: Recording | undefined;
    let id = qid;
    const m = /^(E\d+)\.(.+)$/.exec(qid);
    if (m) { rec = byKey.get(m[1]); id = m[2]; } else if (!multi) rec = recordings[0];
    if (!rec) return null;
    const i = idx(rec).get(id);
    return i == null ? null : { rec, u: rec.t.utterances[i], index: i };
  };
  const line = (rec: Recording, index: number) => {
    const u = rec.t.utterances[index];
    return `[${qualify(rec.tag, u.id)} ${hhmmss(u.start)} ${displayName(u.speaker, rec.names)}] ${u.text}`;
  };
  const legend = () => multi
    ? recordings.map(r => `${r.key} = recorded ${r.date || 'date unknown'}: ${r.t.title} (${r.tag})`).join('\n')
    : '';
  const toEvidenceRefs: Corpus['toEvidenceRefs'] = refs => {
    const out: EvidenceRef[] = [];
    for (const r of refs || []) {
      const hits = (r.utteranceIds || []).map(resolve);
      if (!hits.length || hits.some(h => !h)) return { ok: false, reason: `A claim cites unknown utterance ids ${JSON.stringify(r.utteranceIds)}.` };
      const list = hits as NonNullable<ReturnType<typeof resolve>>[];
      if (new Set(list.map(h => h.rec.tag)).size > 1) return { ok: false, reason: `A claim cites utterances from more than one recording ${JSON.stringify(r.utteranceIds)}; each quote must come from one recording.` };
      out.push({
        releaseTag: list[0].rec.tag,
        segStart: Math.min(...list.map(h => h.u.start)),
        segEnd: Math.max(...list.map(h => h.u.end)),
        speaker: displayName(list[0].u.speaker, list[0].rec.names),
        verbatim: String(r.verbatim || ''),
      });
    }
    return { ok: true, refs: out };
  };
  return { multi, recordings, byTag, qualify, resolve, line, legend, toEvidenceRefs };
}

/**
 * One analysis view over every recording of the project. Single recording: the analysis itself.
 * Several: moment, theme and utterance ids are qualified by recording key, themes are labeled with the
 * recording they come from, and each moment keeps its releaseTag.
 */
export function combineAnalyses(corpus: Corpus, analyses: Record<string, EpisodeAnalysis>): EpisodeAnalysis | null {
  const present = corpus.recordings.filter(r => analyses[r.tag]);
  if (!present.length) return null;
  if (!corpus.multi) return analyses[present[0].tag];
  const q = (r: { key: string }, id: string) => `${r.key}.${id}`;
  const moments: MomentInsight[] = [];
  const themes: EpisodeAnalysis['themes'] = [];
  const dynamics: EpisodeAnalysis['dynamics'] = [];
  const openQuestions: string[] = [];
  for (const r of present) {
    const a = analyses[r.tag];
    for (const m of a.moments) moments.push({ ...m, id: q(r, m.id), themes: m.themes.map(t => q(r, t)), utteranceIds: m.utteranceIds.map(u => q(r, u)) });
    for (const t of a.themes) themes.push({ id: q(r, t.id), label: `${t.label} (${r.key}, ${r.date || 'undated'})`, summary: t.summary, momentIds: t.momentIds.map(id => q(r, id)) });
    for (const d of a.dynamics) dynamics.push({ ...d, role: `${d.role} (${r.key})` });
    for (const o of a.openQuestions) openQuestions.push(`${r.key}: ${o}`);
  }
  const first = analyses[present[0].tag];
  return {
    releaseTag: present.map(r => r.tag).join('+'), transcriptHash: present.map(r => analyses[r.tag].transcriptHash).join('+'),
    promptVersion: first.promptVersion, provider: first.provider, model: first.model,
    themes, dynamics, moments, openQuestions,
    chunks: present.flatMap(r => analyses[r.tag].chunks), createdAt: Math.max(...present.map(r => analyses[r.tag].createdAt)),
  };
}

/** Gives every source a stable recording key; keys are never reused after a source is removed. */
export function assignSourceKeys(project: ScriptProject): void {
  const keys = { ...(project.sourceKeys || {}) };
  let next = Math.max(0, ...Object.values(keys).map(k => Number(k.slice(1)) || 0)) + 1;
  for (const tag of project.sourceTags) if (!keys[tag]) keys[tag] = `E${next++}`;
  project.sourceKeys = keys;
}
