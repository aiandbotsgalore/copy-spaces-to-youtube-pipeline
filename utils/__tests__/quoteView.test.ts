/**
 * Phase 1 view logic for the Library and Board: filters, facet counts, how quote audio is labelled
 * (corpus cut points are never presented as independently checked), and what can be listened to.
 */
import { describe, it, expect } from 'vitest';
import { audioLabel, facetValues, filterEntries, listenOptions, type ViewEntry } from '../quoteView';
import type { EvidenceBoard } from '../scriptTypes';

const entry = (aqId: string, corpus: Record<string, unknown>, link: Partial<ViewEntry['link'] & object> | null, clip = false): ViewEntry => ({
  ref: `aq:${aqId}`, aqId, releaseTag: String(corpus.release_tag), warnings: [],
  corpus: { quote_id: aqId, exact_quote: 'q', speaker: 'Angela', category: 'Threat', target: 'Logan', why_it_matters: '', ...corpus } as any,
  link: link ? { aqId, utteranceIds: ['u1'], speakerLabels: ['Speaker 1'], segStart: 10, segEnd: 14, text: { status: 'exact', checkedAt: 1, transcriptHash: 'h' }, audio: { status: 'none' }, ...link } as any : null,
  ...(clip ? { clipFile: { filename: `${aqId}.wav`, url: `/clips/angela/${aqId}.wav`, from: 'manifest' as const } } : {}),
});
const entries: ViewEntry[] = [
  entry('AQ-0001', { release_tag: 'tagA', exact_quote: 'I will burn it down', category: 'Threat', target: 'Logan' }, { audio: { status: 'verified', source: 'corpus_cut', startSec: 1, endSec: 2 } }, true),
  entry('AQ-0002', { release_tag: 'tagA', exact_quote: 'Evidence speaks', category: 'Documentation', target: 'general audience', speaker: 'Angela Maggard' }, {}),
  entry('AQ-0003', { release_tag: 'tagB', exact_quote: 'Receipts on all of it', category: 'Threat', target: 'Sav' }, { text: { status: 'differs', transcriptSpan: 'receipts, um, on all of it', checkedAt: 1, transcriptHash: 'h' } }),
];
const board: EvidenceBoard = { version: 1, question: '', tapeBalance: 'balanced', recordings: [], claims: [], sources: [], items: [{ ref: 'aq:AQ-0002', starred: true, addedAt: 1 }, { ref: 'aq:AQ-0003', excluded: true, addedAt: 1 }] };
const ids = (xs: ViewEntry[]) => xs.map(x => x.aqId);

describe('filterEntries', () => {
  it('filters by recording, speaker, category and target', () => {
    expect(ids(filterEntries(entries, null, { releaseTag: 'tagA' }))).toEqual(['AQ-0001', 'AQ-0002']);
    expect(ids(filterEntries(entries, null, { speaker: 'Angela Maggard' }))).toEqual(['AQ-0002']);
    expect(ids(filterEntries(entries, null, { category: 'Threat' }))).toEqual(['AQ-0001', 'AQ-0003']);
    expect(ids(filterEntries(entries, null, { category: 'Threat', target: 'Sav' }))).toEqual(['AQ-0003']);
  });

  it('searches the corpus wording, the transcript wording and the id', () => {
    expect(ids(filterEntries(entries, null, { query: 'burn' }))).toEqual(['AQ-0001']);
    expect(ids(filterEntries(entries, null, { query: 'um, on all' }))).toEqual(['AQ-0003']);
    expect(ids(filterEntries(entries, null, { query: 'aq-0002' }))).toEqual(['AQ-0002']);
  });

  it('shows starred, excluded or not excluded quotes for the project board', () => {
    expect(ids(filterEntries(entries, board, { show: 'starred' }))).toEqual(['AQ-0002']);
    expect(ids(filterEntries(entries, board, { show: 'excluded' }))).toEqual(['AQ-0003']);
    expect(ids(filterEntries(entries, board, { show: 'not_excluded' }))).toEqual(['AQ-0001', 'AQ-0002']);
    expect(ids(filterEntries(entries, null, { show: 'starred' }))).toEqual([]);
  });
});

describe('facetValues', () => {
  it('lists values with counts, most common first', () => {
    expect(facetValues(entries, e => String(e.corpus.category))).toEqual([{ value: 'Threat', count: 2 }, { value: 'Documentation', count: 1 }]);
  });
});

describe('audioLabel', () => {
  it('never presents corpus cut points as independently checked', () => {
    expect(audioLabel({ status: 'verified', source: 'corpus_cut', startSec: 1, endSec: 2 })).toEqual({ kind: 'corpus_cut', short: 'Corpus cut', detail: 'Cut points supplied by the AQ corpus. Not independently checked against the audio by this app.', usable: true });
    expect(audioLabel({ status: 'verified', source: 'manual', startSec: 1, endSec: 2 })).toMatchObject({ kind: 'manual', short: 'Verified by you', usable: true });
    expect(audioLabel({ status: 'aligned', source: 'alignment', startSec: 1, endSec: 2 })).toMatchObject({ kind: 'aligned', usable: true });
    expect(audioLabel({ status: 'needs_review' })).toMatchObject({ kind: 'needs_review', usable: false });
    expect(audioLabel({ status: 'none', reason: 'The corpus marks this quote as needing audio alignment.' })).toEqual({ kind: 'none', short: 'No verified audio', detail: 'The corpus marks this quote as needing audio alignment.', usable: false });
  });
});

describe('listenOptions', () => {
  it('offers usable audio, the pre cut WAV and the transcript window, each labelled for what it is', () => {
    expect(listenOptions(entries[0])).toEqual([
      { kind: 'audio', label: 'Play corpus cut', url: '/api/script/library/audio?ref=aq%3AAQ-0001' },
      { kind: 'wav', label: 'Play pre cut WAV', url: '/clips/angela/AQ-0001.wav' },
      { kind: 'window', label: 'Play transcript window', url: '/api/script/library/audio?ref=aq%3AAQ-0001&mode=window' },
    ]);
    expect(listenOptions(entries[1]).map(o => o.kind)).toEqual(['window']);
  });

  it('offers nothing for a quote that was not located and has no audio', () => {
    expect(listenOptions(entry('AQ-0009', { release_tag: 'tagA' }, { utteranceIds: [], segStart: undefined, segEnd: undefined, text: { status: 'unlocated', checkedAt: 1, transcriptHash: 'h' } }))).toEqual([]);
  });
});
