/**
 * The Paper Trail (public/transcripts/investigative_knowledge_graph.json): Logan's curated quotes and
 * contradiction pairs. Investigative projects see the curated quotes and pairs that touch their
 * recordings, and a narration claim whose verbatim text is one of those quotes is linked by quoteId.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { EvidenceRef } from '../utils/scriptTypes';

export interface CuratedQuote { quoteId: string; speaker: string; releaseTag: string; date: string; text: string; category: string; why: string }
export interface ContradictionPair { pairId: string; title: string; pre: { quoteId: string; releaseTag: string; date: string }; post: { quoteId: string; releaseTag: string; date: string } }
export interface PaperTrail { quotes: CuratedQuote[]; pairs: ContradictionPair[] }

const cache = new Map<string, { mtime: number; kg: PaperTrail }>();

export function loadPaperTrail(root: string): PaperTrail {
  const f = path.join(root, 'public', 'transcripts', 'investigative_knowledge_graph.json');
  let mtime = 0;
  try { mtime = fs.statSync(f).mtimeMs; } catch { return { quotes: [], pairs: [] }; }
  const hit = cache.get(f);
  if (hit && hit.mtime === mtime) return hit.kg;
  let j: any = {};
  try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { j = {}; }
  const kg: PaperTrail = {
    quotes: (Array.isArray(j?.quotes) ? j.quotes : []).map((q: any) => ({
      quoteId: String(q?.quote_id || ''), speaker: String(q?.speaker || ''), releaseTag: String(q?.release_tag || ''), date: String(q?.date || ''),
      text: String(q?.exact_quote || ''), category: String(q?.category || ''), why: String(q?.why_it_matters || ''),
    })).filter((q: CuratedQuote) => q.quoteId && q.releaseTag),
    pairs: (Array.isArray(j?.contradiction_pairings) ? j.contradiction_pairings : []).map((p: any) => ({
      pairId: String(p?.pairing_id || ''), title: String(p?.title || ''),
      pre: { quoteId: String(p?.pre_fallout?.quote_id || ''), releaseTag: String(p?.pre_fallout?.episode_tag || ''), date: String(p?.pre_fallout?.date || '') },
      post: { quoteId: String(p?.post_fallout?.quote_id || ''), releaseTag: String(p?.post_fallout?.episode_tag || ''), date: String(p?.post_fallout?.date || '') },
    })).filter((p: ContradictionPair) => p.pairId),
  };
  cache.set(f, { mtime, kg });
  return kg;
}

export function paperTrailFor(kg: PaperTrail, tags: string[]) {
  const set = new Set(tags);
  const byId = new Map(kg.quotes.map(q => [q.quoteId, q]));
  return {
    quotes: kg.quotes.filter(q => set.has(q.releaseTag)),
    pairs: kg.pairs.filter(p => set.has(p.pre.releaseTag) || set.has(p.post.releaseTag)).map(p => ({
      ...p, preQuote: byId.get(p.pre.quoteId) || null, postQuote: byId.get(p.post.quoteId) || null,
      missingTags: [p.pre.releaseTag, p.post.releaseTag].filter(t => t && !set.has(t)),
    })),
  };
}

const norm = (s: string) => s.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Links each ref to a curated quote of the same recording when its verbatim is (part of) that quote. Needs 6 or more words. */
export function linkQuoteIds(refs: EvidenceRef[], kg: PaperTrail): EvidenceRef[] {
  if (!kg.quotes.length) return refs;
  return refs.map(r => {
    const v = norm(r.verbatim);
    if (v.split(' ').length < 6) return r;
    const q = kg.quotes.find(x => x.releaseTag === r.releaseTag && x.text.split(/\.\.\.|…/).some(part => { const p = norm(part); return p.length > 0 && (p.includes(v) || (p.split(' ').length >= 6 && v.includes(p))); }));
    return q ? { ...r, quoteId: q.quoteId } : r;
  });
}
