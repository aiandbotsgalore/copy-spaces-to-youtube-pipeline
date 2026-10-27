import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assignSourceKeys, buildCorpus, combineAnalyses, namesForTag, scopeNamesToTag } from '../../server/scriptCorpus';
import { parseTranscriptJson } from '../../server/scriptData';
import { linkQuoteIds, loadPaperTrail, paperTrailFor } from '../../server/scriptPaperTrail';
import { queryTerms, searchRecordings } from '../../server/scriptSearch';
import type { EpisodeAnalysis, ScriptProject } from '../../utils/scriptTypes';

const tr = (tag: string, segs: [string, number, string][]) => parseTranscriptJson(JSON.stringify({ title: `Title ${tag}`, segments: segs.map(([speaker, start, text]) => ({ speaker, start, end: start + 2, text })) }), tag);
const A = tr('20260101_aaaa', [['Speaker 1', 0, 'First recording opening line.'], ['Logan', 3, 'Who actually checked that?']]);
const B = tr('20260301_bbbb', [['Speaker 1', 0, 'A different person in another Space.'], ['Logan', 3, 'I said it again in March.'], ['Logan', 5, 'And I meant it.']]);
const byTag: Record<string, any> = { [A.releaseTag]: A, [B.releaseTag]: B };
const project = (tags: string[], extra: Partial<ScriptProject> = {}): ScriptProject => ({
  id: 'prj_x', title: 't', createdAt: 0, updatedAt: 0, format: 'thematic_multi', sourceTags: tags, targetRuntimeSec: 600,
  transcriptHashes: {}, speakerNames: {}, clips: [], excludedClips: [], headVersionId: null, ...extra,
});
const analysis = (tag: string, momentId: string, utt: string): EpisodeAnalysis => ({
  releaseTag: tag, transcriptHash: `h-${tag}`, promptVersion: 'analysis.v1', provider: 'claude_cli', model: 'sonnet',
  themes: [{ id: 't1', label: 'Doubt', summary: 's', momentIds: [momentId] }], dynamics: [{ speaker: 'Logan', role: 'host', stance: 'sceptical' }],
  moments: [{ id: momentId, releaseTag: tag, start: 3, end: 5, kind: 'claim', why: 'w', themes: ['t1'], speakers: ['Logan'], evidence: [], utteranceIds: [utt] }],
  openQuestions: ['q'], chunks: [{ index: 0, ok: true }], createdAt: 1,
});

describe('speaker renames per recording', () => {
  it('flat names apply everywhere, tag-scoped names to one recording', () => {
    const names = { 'Speaker 9': 'Flat', [`${A.releaseTag}::Speaker 1`]: 'Deb', [`${B.releaseTag}::Speaker 1`]: 'Oor' };
    expect(namesForTag(names, A.releaseTag)).toEqual({ 'Speaker 9': 'Flat', 'Speaker 1': 'Deb' });
    expect(namesForTag(names, B.releaseTag)).toEqual({ 'Speaker 9': 'Flat', 'Speaker 1': 'Oor' });
    expect(scopeNamesToTag({ 'Speaker 1': 'Deb', 'x::y': 'z' }, A.releaseTag)).toEqual({ [`${A.releaseTag}::Speaker 1`]: 'Deb', 'x::y': 'z' });
  });
});

describe('multi-recording corpus', () => {
  it('single recording: ids are unchanged', () => {
    const c = buildCorpus(project([A.releaseTag]), t => byTag[t]);
    expect(c.multi).toBe(false);
    expect(c.qualify(A.releaseTag, 'u1')).toBe('u1');
    expect(c.resolve('u1')?.u.text).toBe('Who actually checked that?');
    expect(c.legend()).toBe('');
  });

  it('several recordings: qualified ids with stable keys, dates, and per-recording names', () => {
    const p = project([A.releaseTag, B.releaseTag], { speakerNames: { [`${B.releaseTag}::Speaker 1`]: 'Oor' } });
    assignSourceKeys(p);
    expect(p.sourceKeys).toEqual({ [A.releaseTag]: 'E1', [B.releaseTag]: 'E2' });
    const c = buildCorpus(p, t => byTag[t]);
    expect(c.qualify(B.releaseTag, 'u2')).toBe('E2.u2');
    expect(c.resolve('E2.u2')?.u.text).toBe('And I meant it.');
    expect(c.resolve('u2')).toBeNull();          // unqualified ids are ambiguous across recordings
    expect(c.resolve('E7.u0')).toBeNull();
    expect(c.line(c.byTag(B.releaseTag)!, 0)).toBe('[E2.u0 00:00:00 Oor] A different person in another Space.');
    expect(c.legend()).toBe(`E1 = recorded 2026-01-01: Title ${A.releaseTag} (${A.releaseTag})\nE2 = recorded 2026-03-01: Title ${B.releaseTag} (${B.releaseTag})`);

    const ok = c.toEvidenceRefs([{ utteranceIds: ['E2.u1', 'E2.u2'], verbatim: 'I said it again in March. And I meant it.' }]);
    expect(ok).toEqual({ ok: true, refs: [{ releaseTag: B.releaseTag, segStart: 3, segEnd: 7, speaker: 'Logan', verbatim: 'I said it again in March. And I meant it.' }] });
    const mixed = c.toEvidenceRefs([{ utteranceIds: ['E1.u1', 'E2.u1'], verbatim: 'x' }]);
    expect(mixed.ok).toBe(false);
    if (mixed.ok === false) expect(mixed.reason).toMatch(/more than one recording/);

    // Removing E1 and adding another never reuses E1.
    p.sourceTags = [B.releaseTag, '20260401_cccc'];
    assignSourceKeys(p);
    expect(p.sourceKeys!['20260401_cccc']).toBe('E3');
  });

  it('combines analyses with qualified moment, theme and utterance ids', () => {
    const p = project([A.releaseTag, B.releaseTag]);
    assignSourceKeys(p);
    const c = buildCorpus(p, t => byTag[t]);
    const combined = combineAnalyses(c, { [A.releaseTag]: analysis(A.releaseTag, 'c0-1', 'u1'), [B.releaseTag]: analysis(B.releaseTag, 'c0-1', 'u2') })!;
    expect(combined.moments.map(m => [m.id, m.utteranceIds, m.releaseTag])).toEqual([['E1.c0-1', ['E1.u1'], A.releaseTag], ['E2.c0-1', ['E2.u2'], B.releaseTag]]);
    expect(combined.themes.map(t => [t.id, t.label, t.momentIds])).toEqual([['E1.t1', 'Doubt (E1, 2026-01-01)', ['E1.c0-1']], ['E2.t1', 'Doubt (E2, 2026-03-01)', ['E2.c0-1']]]);
    expect(combined.openQuestions).toEqual(['E1: q', 'E2: q']);
    const single = buildCorpus(project([A.releaseTag]), t => byTag[t]);
    const a = analysis(A.releaseTag, 'c0-1', 'u1');
    expect(combineAnalyses(single, { [A.releaseTag]: a })).toBe(a);
    expect(combineAnalyses(single, {})).toBeNull();
  });
});

describe('related recordings and The Paper Trail', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-corpus-'));
  const dir = path.join(root, 'public', 'transcripts', 'episodes');
  fs.mkdirSync(dir, { recursive: true });
  const w = (tag: string, texts: string[]) => fs.writeFileSync(path.join(dir, `${tag}.json`), JSON.stringify({ title: `Title ${tag}`, segments: texts.map((text, i) => ({ speaker: 'Logan', start: i * 5, end: i * 5 + 4, text })) }));
  w('20260101_aaaa', ['We talked about the Pentagon and the hacker case.', 'Gary McKinnon came up again.']);
  w('20260201_bbbb', ['Gary McKinnon, Gary McKinnon, the hacker who found the space fleet files.']);
  w('20260301_cccc', ['Cooking show tonight, nothing about hacking.']);
  fs.writeFileSync(path.join(root, 'public', 'transcripts', 'investigative_knowledge_graph.json'), JSON.stringify({
    quotes: [
      { quote_id: 'AQ-1', speaker: 'Logan', date: '2026-01-01', release_tag: '20260101_aaaa', exact_quote: 'We talked about the Pentagon and the hacker case... and more', category: 'c', why_it_matters: 'w' },
      { quote_id: 'AQ-2', speaker: 'Logan', date: '2026-02-01', release_tag: '20260201_bbbb', exact_quote: 'the hacker who found the space fleet files', category: 'c', why_it_matters: 'w' },
    ],
    contradiction_pairings: [{ pairing_id: 'PAIR-01', title: 'Then and now', pre_fallout: { quote_id: 'AQ-1', date: 'January 1, 2026', episode_tag: '20260101_aaaa' }, post_fallout: { quote_id: 'AQ-2', date: 'February 1, 2026', episode_tag: '20260201_bbbb' } }],
  }));

  it('ranks recordings by the thesis terms in code, excluding the project\'s own', () => {
    expect(queryTerms('What did Gary McKinnon find in the Pentagon?')).toEqual(['gary', 'mckinnon', 'find', 'pentagon']);
    const r = searchRecordings(root, 'Gary McKinnon hacker', { exclude: ['20260101_aaaa'] });
    expect(r.scanned).toBe(2);
    expect(r.hits.map(h => h.releaseTag)).toEqual(['20260201_bbbb']);
    expect(r.hits[0]).toMatchObject({ date: '2026-02-01', title: 'Title 20260201_bbbb', terms: { gary: 2, mckinnon: 2, hacker: 1 } });
    expect(r.hits[0].samples[0].text).toMatch(/Gary McKinnon/);
    expect(searchRecordings(root, 'the and of').hits).toEqual([]);
  });

  it('lists the curated pairs touching the project and links verbatim claims to quote ids', () => {
    const kg = loadPaperTrail(root);
    const pt = paperTrailFor(kg, ['20260101_aaaa']);
    expect(pt.quotes.map(q => q.quoteId)).toEqual(['AQ-1']);
    expect(pt.pairs[0]).toMatchObject({ pairId: 'PAIR-01', missingTags: ['20260201_bbbb'], postQuote: { quoteId: 'AQ-2' } });
    const refs = linkQuoteIds([
      { releaseTag: '20260101_aaaa', segStart: 0, segEnd: 4, speaker: 'Logan', verbatim: 'We talked about the Pentagon and the hacker case.' },
      { releaseTag: '20260201_bbbb', segStart: 0, segEnd: 4, speaker: 'Logan', verbatim: 'Gary McKinnon, Gary McKinnon, the hacker who found the space fleet files.' },
      { releaseTag: '20260301_cccc', segStart: 0, segEnd: 4, speaker: 'Logan', verbatim: 'the hacker who found the space fleet files' },
      { releaseTag: '20260101_aaaa', segStart: 0, segEnd: 4, speaker: 'Logan', verbatim: 'Pentagon' },
    ], kg);
    expect(refs.map(r => r.quoteId)).toEqual(['AQ-1', 'AQ-2', undefined, undefined]);
  });
});
