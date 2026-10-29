/**
 * The shared evidence library: one JSON file per recording under .spacepipe-studio/library/, holding
 * everything learned about its quotes once (location, text check, audio, speaker confirmation), for
 * every project to reuse. Phase 1 fills it from the AQ corpus; quotes read by the model come later.
 *
 * AQ quotes are located and text checked once per transcript version (by hash) and locator version. A
 * changed transcript or locator re-checks the text in code; speaker confirmations and reviewed or aligned
 * audio are kept.
 */
import fs from 'node:fs';
import type { AqLink, AudioBoundary, RecordingLibrary } from '../utils/scriptTypes';
import { LOCATOR_VERSION, locateQuote, textCheck } from '../utils/quoteLocate';
import { parseTranscriptJson, transcriptPath, type LoadedTranscript } from './scriptData';
import { aqClipFiles, corpusAudio, corpusWindow, loadAqCorpus, type AqClipFile, type AqQuote } from './quoteCorpus';
import type { ScriptStore } from './scriptStore';

export interface AqEntry { ref: string; aqId: string; releaseTag: string; corpus: AqQuote; link: AqLink | null; clipFile?: AqClipFile; warnings: string[] }

const CUT_SLACK_SEC = 2;
/** Data checks shown beside a quote. They never change the corpus values or the stored link. */
function warningsFor(link: AqLink | null): string[] {
  const out: string[] = [];
  const a = link?.audio;
  if (link && a?.source === 'corpus_cut' && a.startSec !== undefined && a.endSec !== undefined && link.segStart !== undefined && link.segEnd !== undefined
    && (a.endSec < link.segStart - CUT_SLACK_SEC || a.startSec > link.segEnd + CUT_SLACK_SEC)) {
    out.push(`Corpus cut points (${a.startSec.toFixed(1)} to ${a.endSec.toFixed(1)} s) do not overlap where the quote was located in the transcript (${link.segStart.toFixed(1)} to ${link.segEnd.toFixed(1)} s). Listen before using this audio.`);
  }
  return out;
}
export interface SyncResult { quotes: number; located: number; exact: number; differs: number; unlocated: number; updated: string[] }

export const aqRef = (aqId: string) => `aq:${aqId}`;

const emptyLibrary = (releaseTag: string, transcriptHash: string): RecordingLibrary =>
  ({ version: 1, releaseTag, transcriptHash, reads: [], notes: [], rejected: [], quotes: [], aqLinks: [] });

/** Audio set by alignment or by Logan is never replaced by a corpus re-import. */
const keepsAudio = (a: AudioBoundary | undefined) => !!a && (a.source === 'manual' || a.source === 'alignment');

export function createQuoteLibrary(root: string, store: ScriptStore, deps: { now?: () => number } = {}) {
  const now = deps.now ?? Date.now;
  const transcripts = new Map<string, { mtime: number; size: number; t: LoadedTranscript }>();

  function transcript(tag: string): LoadedTranscript | null {
    const file = transcriptPath(root, tag);
    let st: fs.Stats;
    try { st = fs.statSync(file); } catch { return null; }
    const hit = transcripts.get(tag);
    if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.t;
    const t = parseTranscriptJson(fs.readFileSync(file, 'utf8'), tag);
    transcripts.set(tag, { mtime: st.mtimeMs, size: st.size, t });
    return t;
  }

  function linkFor(q: AqQuote, t: LoadedTranscript | null, prev: AqLink | undefined): AqLink {
    const at = now();
    const kept = { ...(prev?.speakerConfirmed !== undefined ? { speakerConfirmed: prev.speakerConfirmed } : {}), ...(prev?.speakerName ? { speakerName: prev.speakerName } : {}) };
    const audio = keepsAudio(prev?.audio) ? prev!.audio : corpusAudio(q);
    if (!t) return { aqId: q.quote_id, utteranceIds: [], speakerLabels: [], text: { status: 'unlocated', checkedAt: at, transcriptHash: '', note: `No transcript file for ${q.release_tag}.` }, audio, ...kept };
    const loc = locateQuote(q.exact_quote, t.utterances, { window: corpusWindow(q) });
    return {
      aqId: q.quote_id, utteranceIds: loc.utteranceIds, speakerLabels: loc.speakerLabels,
      ...(loc.located ? { segStart: loc.segStart, segEnd: loc.segEnd } : {}),
      text: textCheck(q.exact_quote, loc, t.utterances, t.hash, at), audio, ...kept,
    };
  }

  /** Locates and checks every AQ quote whose library entry is missing or whose transcript changed. */
  function syncAq(): SyncResult {
    const corpus = loadAqCorpus(root);
    const updated: string[] = [];
    const counts = { located: 0, exact: 0, differs: 0, unlocated: 0 };
    for (const tag of corpus.tags) {
      const t = transcript(tag);
      const hash = t?.hash ?? '';
      const before = store.getLibrary(tag);
      const lib = before ? structuredClone(before) : emptyLibrary(tag, hash);
      let changed = !before || lib.transcriptHash !== hash;
      lib.transcriptHash = hash;
      for (const q of corpus.quotes.filter(x => x.release_tag === tag)) {
        const i = lib.aqLinks.findIndex(l => l.aqId === q.quote_id);
        const prev = i >= 0 ? lib.aqLinks[i] : undefined;
        if (!prev || prev.text.transcriptHash !== hash || (t && prev.text.locator !== LOCATOR_VERSION)) {
          const link = linkFor(q, t, prev);
          if (i >= 0) lib.aqLinks[i] = link; else lib.aqLinks.push(link);
          changed = true;
        }
        const s = (i >= 0 ? lib.aqLinks[i] : lib.aqLinks[lib.aqLinks.length - 1]).text.status;
        if (s === 'unlocated') counts.unlocated++; else { counts.located++; counts[s]++; }
      }
      if (changed) { store.saveLibrary(lib); updated.push(tag); }
    }
    return { quotes: corpus.quotes.length, ...counts, updated };
  }

  function findLink(ref: string): { lib: RecordingLibrary; i: number } {
    const aqId = ref.startsWith('aq:') ? ref.slice(3) : '';
    const q = loadAqCorpus(root).byId.get(aqId);
    const lib = q ? store.getLibrary(q.release_tag) : null;
    const i = lib ? lib.aqLinks.findIndex(l => l.aqId === aqId) : -1;
    if (!q || !lib || i < 0) throw new Error(`Unknown quote ${ref}.`);
    return { lib, i };
  }

  return {
    syncAq,
    transcript,

    /** Every AQ quote with its live corpus record, its library link and any existing WAV. */
    entries(): AqEntry[] {
      const corpus = loadAqCorpus(root);
      const files = aqClipFiles(root);
      const libs = new Map(corpus.tags.map(t => [t, store.getLibrary(t)]));
      return corpus.quotes.map(q => {
        const link = libs.get(q.release_tag)?.aqLinks.find(l => l.aqId === q.quote_id) ?? null;
        return {
          ref: aqRef(q.quote_id), aqId: q.quote_id, releaseTag: q.release_tag, corpus: q, link,
          ...(files.has(q.quote_id) ? { clipFile: files.get(q.quote_id) } : {}),
          warnings: warningsFor(link),
        };
      });
    },

    hasRef(ref: string): boolean {
      if (ref.startsWith('aq:')) return loadAqCorpus(root).byId.has(ref.slice(3));
      const tag = ref.split(':')[0];
      try { return !!store.getLibrary(tag)?.quotes.some(x => x.id === ref); } catch { return false; }
    },

    /** Confirms (or clears, with null) who is speaking, once for every project. */
    confirmSpeaker(ref: string, name: string | null): AqLink {
      const { lib, i } = findLink(ref);
      const link = { ...lib.aqLinks[i] };
      const clean = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
      if (clean) { link.speakerConfirmed = true; link.speakerName = clean; } else { link.speakerConfirmed = false; delete link.speakerName; }
      lib.aqLinks[i] = link;
      store.saveLibrary(lib);
      return link;
    },
  };
}
export type QuoteLibrary = ReturnType<typeof createQuoteLibrary>;
