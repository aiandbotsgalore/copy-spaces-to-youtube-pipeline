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
import crypto from 'node:crypto';
import type { AqLink, AudioBoundary, LibraryQuote, RecordingLibrary, TextCheck } from '../utils/scriptTypes';
import { LOCATOR_VERSION, locateQuote, textCheck } from '../utils/quoteLocate';
import { namedSegments, parseTranscriptJson, transcriptPath, utteranceLine, type LoadedTranscript } from './scriptData';
import { aqClipFiles, corpusAudio, corpusWindow, loadAqCorpus, parseCutSec, type AqClipFile, type AqQuote } from './quoteCorpus';
import { readPrompt, type Prompt } from './scriptPrompts';
import { verifyVerbatim } from '../utils/scriptGates';
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

const WORD_RE = /[A-Za-z0-9‘’'`]+/g;
const normWord = (w: string) => w.toLowerCase().replace(/[‘’'`]/g, '');
const wordsOf = (s: string) => (s.match(WORD_RE) || []).map(normWord).filter(Boolean);

/**
 * True if two texts share at least minWords (default 8) consecutive words,
 * or if either quote is short (< minWords) and fully contained in the other.
 */
export function sharesConsecutiveWords(textA: string, textB: string, minWords = 8): boolean {
  const wordsA = wordsOf(textA);
  const wordsB = wordsOf(textB);
  if (!wordsA.length || !wordsB.length) return false;
  if (wordsA.length < minWords || wordsB.length < minWords) {
    const sA = wordsA.join(' ');
    const sB = wordsB.join(' ');
    return sA.includes(sB) || sB.includes(sA);
  }
  const textBJoined = ' ' + wordsB.join(' ') + ' ';
  for (let i = 0; i <= wordsA.length - minWords; i++) {
    const gram = ' ' + wordsA.slice(i, i + minWords).join(' ') + ' ';
    if (textBJoined.includes(gram)) return true;
  }
  return false;
}

export interface RawCandidateQuote {
  utteranceIds: string[];
  verbatim: string;
  speaker: string;
  about: string;
  type: LibraryQuote['type'];
  status: LibraryQuote['status'];
  why: string;
}

export interface ReadModelCallResult {
  ok: boolean;
  json?: {
    quotes?: RawCandidateQuote[];
    context?: string;
  };
  model?: string;
  code?: string;
  message?: string;
}

export type ReadModelCaller = (prompt: Prompt) => Promise<ReadModelCallResult>;

export interface ReadForQuestionResult {
  fromCache: boolean;
  releaseTag: string;
  question: string;
  model: string;
  newQuotes: LibraryQuote[];
  mergedRefs: string[];
  rejected: { verbatim: string; reason: string; at: number }[];
  contextNote?: string;
  totalQuotes: number;
}

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

    getQuoteAudioInfo(ref: string): {
      releaseTag: string;
      verbatim: string;
      segStart: number;
      segEnd: number;
      audio: AudioBoundary;
      speakerName?: string;
      speakerLabel?: string;
      wavUrl?: string;
    } | null {
      if (ref.startsWith('aq:')) {
        const aqId = ref.slice(3);
        const corpus = loadAqCorpus(root);
        const q = corpus.byId.get(aqId);
        if (!q) return null;
        const lib = store.getLibrary(q.release_tag);
        const link = lib?.aqLinks.find(l => l.aqId === aqId) ?? null;
        const files = aqClipFiles(root);
        const wav = files.get(aqId);
        const [cStart, cEnd] = corpusWindow(q) || [0, 10];
        const segStart = link?.segStart ?? parseCutSec(q.cut_in) ?? cStart;
        const segEnd = link?.segEnd ?? parseCutSec(q.cut_out) ?? cEnd;
        return {
          releaseTag: q.release_tag,
          verbatim: link?.text.transcriptSpan || q.exact_quote,
          segStart,
          segEnd,
          audio: link?.audio || corpusAudio(q),
          speakerName: link?.speakerName,
          speakerLabel: (link?.speakerLabels && link.speakerLabels[0]) || q.speaker,
          wavUrl: wav?.url,
        };
      }
      const tag = ref.split(':')[0];
      const lib = store.getLibrary(tag);
      const q = lib?.quotes.find(x => x.id === ref);
      if (!q) return null;
      return {
        releaseTag: q.releaseTag,
        verbatim: q.verbatim,
        segStart: q.segStart,
        segEnd: q.segEnd,
        audio: q.audio,
        speakerName: q.speakerName,
        speakerLabel: q.speakerLabel,
      };
    },

    updateAudio(ref: string, audio: AudioBoundary): AudioBoundary {
      if (ref.startsWith('aq:')) {
        const { lib, i } = findLink(ref);
        const link = { ...lib.aqLinks[i], audio };
        lib.aqLinks[i] = link;
        store.saveLibrary(lib);
        return audio;
      }
      const tag = ref.split(':')[0];
      const lib = store.getLibrary(tag);
      if (!lib) throw new Error(`Unknown recording library ${tag}.`);
      const i = lib.quotes.findIndex(x => x.id === ref);
      if (i < 0) throw new Error(`Unknown quote ${ref} in library ${tag}.`);
      lib.quotes[i] = { ...lib.quotes[i], audio };
      store.saveLibrary(lib);
      return audio;
    },

    /**
     * Reads a transcript for an investigative question, extracting and verifying candidate quotes.
     * Deduplicates against existing library quotes and the AQ corpus.
     * Caches reads by question and transcript hash so subsequent calls make 0 model calls.
     */
    async readForQuestion(
      tag: string,
      question: string,
      callModel: ReadModelCaller,
      opts: { force?: boolean } = {}
    ): Promise<ReadForQuestionResult> {
      const cleanQ = question.trim();
      if (!cleanQ) throw new Error('Investigative question cannot be empty.');
      const normQ = cleanQ.toLowerCase();

      const t = transcript(tag);
      if (!t) throw new Error(`No transcript found on disk for ${tag}.`);

      const stored = store.getLibrary(tag);
      const lib = stored ? structuredClone(stored) : emptyLibrary(tag, t.hash);
      const hashChanged = lib.transcriptHash !== t.hash;
      lib.transcriptHash = t.hash;

      // 1. Read Cache: Check if already read for this question with matching transcript hash
      const cachedRead = lib.reads.find(r => r.question.trim().toLowerCase() === normQ);
      if (cachedRead && !opts.force && !hashChanged) {
        const matchingQuotes = lib.quotes.filter(q => cachedRead.quoteIds.includes(q.id));
        const mergedRefs = cachedRead.quoteIds.filter(id => id.startsWith('aq:') || (!id.startsWith('aq:') && !lib.quotes.some(q => q.id === id)));
        const note = lib.notes.find(n => n.question.trim().toLowerCase() === normQ)?.text;
        return {
          fromCache: true,
          releaseTag: tag,
          question: cleanQ,
          model: cachedRead.model,
          newQuotes: matchingQuotes,
          mergedRefs,
          rejected: [],
          contextNote: note,
          totalQuotes: lib.quotes.length + lib.aqLinks.length,
        };
      }

      // 2. Build prompt and invoke model
      const lines = t.utterances.map(u => utteranceLine(u, {})).join('\n');
      const pr = readPrompt({ releaseTag: tag, title: t.title, lines, question: cleanQ });
      const res = await callModel(pr);
      if (!res.ok || !res.json) {
        throw new Error(res.message || `Failed to read ${tag} for question.`);
      }

      const modelName = res.model || 'model';
      const rawQuotes = Array.isArray(res.json.quotes) ? res.json.quotes : [];
      const contextText = typeof res.json.context === 'string' ? res.json.context.trim() : '';
      const at = now();

      const segs = namedSegments(t, {});
      const byId = new Map(t.utterances.map(u => [u.id, u]));
      const corpus = loadAqCorpus(root);
      const aqQuotesForTag = corpus.quotes.filter(q => q.release_tag === tag);

      const newQuotes: LibraryQuote[] = [];
      const mergedRefs: string[] = [];
      const quoteIdsForRead: string[] = [];

      for (const raw of rawQuotes) {
        const verbatim = String(raw.verbatim || '').trim();
        const rawUttIds = Array.isArray(raw.utteranceIds) ? raw.utteranceIds.map(String) : [];
        const us = rawUttIds.map(id => byId.get(id)).filter((u): u is LoadedTranscript['utterances'][0] => Boolean(u));

        if (!verbatim || !us.length) {
          lib.rejected.push({
            verbatim: verbatim || '(empty quote)',
            reason: 'Missing verbatim quote text or invalid utterance IDs.',
            at,
          });
          continue;
        }

        // 3. Verbatim check
        const v = verifyVerbatim({
          releaseTag: tag,
          segStart: us[0].start,
          segEnd: us[us.length - 1].end,
          speaker: us[0].speaker,
          verbatim,
        }, segs);

        if (v.ok !== true) {
          const loc = locateQuote(verbatim, t.utterances);
          lib.rejected.push({
            verbatim,
            reason: loc.located && loc.span
              ? `Wording differs from transcript. Exact transcript span: "${loc.span.slice(0, 160)}"`
              : (v.reason || 'Not found verbatim in transcript speech.'),
            at,
          });
          continue;
        }

        // 4. Deduplicate against AQ corpus quotes for this recording
        let matchedAq: AqQuote | undefined;
        for (const aq of aqQuotesForTag) {
          const link = lib.aqLinks.find(l => l.aqId === aq.quote_id);
          const aqUtts = link?.utteranceIds || [];
          const sharesUtt = !aqUtts.length || rawUttIds.some(id => aqUtts.includes(id));
          if (sharesUtt && sharesConsecutiveWords(verbatim, aq.exact_quote, 8)) {
            matchedAq = aq;
            break;
          }
        }
        if (matchedAq) {
          const ref = aqRef(matchedAq.quote_id);
          if (!mergedRefs.includes(ref)) mergedRefs.push(ref);
          if (!quoteIdsForRead.includes(ref)) quoteIdsForRead.push(ref);
          continue; // Deduplicated against AQ quote
        }

        // 5. Deduplicate against existing library quotes
        let matchedExisting: LibraryQuote | undefined;
        for (const ex of lib.quotes) {
          const sharesUtt = rawUttIds.some(id => ex.utteranceIds.includes(id));
          if (sharesUtt && sharesConsecutiveWords(verbatim, ex.verbatim, 8)) {
            matchedExisting = ex;
            break;
          }
        }
        if (matchedExisting) {
          if (!matchedExisting.foundBy.some(f => f.question.trim().toLowerCase() === normQ)) {
            matchedExisting.foundBy.push({ question: cleanQ, at });
          }
          if (!mergedRefs.includes(matchedExisting.id)) mergedRefs.push(matchedExisting.id);
          if (!quoteIdsForRead.includes(matchedExisting.id)) quoteIdsForRead.push(matchedExisting.id);
          continue; // Deduplicated against existing library quote
        }

        // 6. Genuinely new verified quote
        const shortHash = crypto.createHash('sha256').update(verbatim.toLowerCase()).digest('hex').slice(0, 8);
        const quoteId = `${tag}:${shortHash}`;

        // Double-check ID collision
        const idHit = lib.quotes.find(q => q.id === quoteId);
        if (idHit) {
          if (!idHit.foundBy.some(f => f.question.trim().toLowerCase() === normQ)) {
            idHit.foundBy.push({ question: cleanQ, at });
          }
          if (!mergedRefs.includes(quoteId)) mergedRefs.push(quoteId);
          if (!quoteIdsForRead.includes(quoteId)) quoteIdsForRead.push(quoteId);
          continue;
        }

        const newQuote: LibraryQuote = {
          id: quoteId,
          releaseTag: tag,
          utteranceIds: rawUttIds,
          speakerLabel: us[0].speaker,
          speakerConfirmed: false,
          verbatim,
          segStart: us[0].start,
          segEnd: us[us.length - 1].end,
          text: {
            status: 'exact',
            checkedAt: at,
            transcriptHash: t.hash,
          },
          audio: {
            status: 'none',
          },
          about: String(raw.about || '').trim(),
          why: String(raw.why || '').trim(),
          type: raw.type || 'other',
          status: raw.status || 'opinion',
          foundBy: [{ question: cleanQ, at }],
        };

        lib.quotes.push(newQuote);
        newQuotes.push(newQuote);
        quoteIdsForRead.push(quoteId);
      }

      // 7. Store context note
      if (contextText && !lib.notes.some(n => n.question.trim().toLowerCase() === normQ && n.text === contextText)) {
        lib.notes.push({ at, question: cleanQ, text: contextText });
      }

      // 8. Record read
      const prevReadIdx = lib.reads.findIndex(r => r.question.trim().toLowerCase() === normQ);
      const readEntry = { question: cleanQ, at, model: modelName, quoteIds: quoteIdsForRead };
      if (prevReadIdx >= 0) {
        lib.reads[prevReadIdx] = readEntry;
      } else {
        lib.reads.push(readEntry);
      }

      store.saveLibrary(lib);

      return {
        fromCache: false,
        releaseTag: tag,
        question: cleanQ,
        model: modelName,
        newQuotes,
        mergedRefs,
        rejected: lib.rejected.filter(r => r.at === at),
        contextNote: contextText || undefined,
        totalQuotes: lib.quotes.length + lib.aqLinks.length,
      };
    },
  };
}
export type QuoteLibrary = ReturnType<typeof createQuoteLibrary>;
