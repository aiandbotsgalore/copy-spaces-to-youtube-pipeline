/**
 * Code search for related recordings (thematic and investigative episodes): ranks every transcript on
 * disk by how often it uses the thesis terms (BM25 over the raw transcript text). No model call.
 */
import fs from 'node:fs';
import path from 'node:path';
import { dateOfTag } from '../utils/scriptFormats';

export interface RelatedHit { releaseTag: string; title: string; date: string | null; score: number; terms: Record<string, number>; samples: { start: number; speaker: string; text: string }[] }

const STOP = new Set('about above after again against also because been before being below between both could does doing down during each from further have having here into itself just more most other over same should some such than that their them then there these they this those through under until very what when where which while will with would your yours really think know like going want people thing things said says yeah okay right well'.split(' '));

/** Short capitalised words that are ordinary English, not names, so a capital letter alone does not make them terms. */
const SHORT_STOP = new Set('the and but was did why how who she her his him you our its not are has had can for all any one two yes now get got let may say see too way use new old off out own per via yet'.split(' '));

/**
 * Search terms from a question. Words of four or more letters are kept unless they are stop words.
 * Shorter words are kept only when they look meaningful: written with a capital (a name such as "Sav"),
 * in capitals (an acronym such as "DMs"), or containing a digit ("9pm").
 */
export function queryTerms(q: string): string[] {
  const words = q.replace(/[^A-Za-z0-9' -]+/g, ' ').split(/[\s-]+/)
    .map(w => w.replace(/^'+|'+$/g, '').replace(/'s$/i, '')).filter(Boolean);
  const keep = words.filter(w => {
    const lower = w.toLowerCase();
    if (w.length >= 4) return !STOP.has(lower);
    if (w.length < 2 || SHORT_STOP.has(lower)) return false;
    return /^[A-Z]/.test(w) || /\d/.test(w);
  });
  return [...new Set(keep.map(w => w.toLowerCase()))].slice(0, 12);
}

function count(hay: string, term: string): number {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Long terms also match short word endings ("record" -> "recorded"). Short terms (names, acronyms) match
  // only themselves, a plural or a possessive, so "sav" does not match "save" or "savvy".
  const re = new RegExp(term.length >= 4 ? `\\b${esc}\\w{0,3}\\b` : `\\b${esc}(?:'s|s)?\\b`, 'g');
  return (hay.match(re) || []).length;
}

export function searchRecordings(root: string, query: string, opts: { exclude?: string[]; limit?: number } = {}): { terms: string[]; hits: RelatedHit[]; scanned: number } {
  const terms = queryTerms(query);
  const dir = path.join(root, 'public', 'transcripts', 'episodes');
  if (!terms.length || !fs.existsSync(dir)) return { terms, hits: [], scanned: 0 };
  const exclude = new Set(opts.exclude || []);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.endsWith('.embeddings.json'));
  const docs: { tag: string; len: number; tf: Record<string, number> }[] = [];
  for (const f of files) {
    const tag = f.slice(0, -5);
    if (exclude.has(tag)) continue;
    let raw: string;
    try { raw = fs.readFileSync(path.join(dir, f), 'utf8').toLowerCase(); } catch { continue; }
    const tf: Record<string, number> = {};
    for (const t of terms) tf[t] = count(raw, t);
    docs.push({ tag, len: raw.length, tf });
  }
  const N = docs.length || 1;
  const avg = docs.reduce((s, d) => s + d.len, 0) / N;
  const df: Record<string, number> = Object.fromEntries(terms.map(t => [t, docs.filter(d => d.tf[t] > 0).length]));
  const k1 = 1.2, b = 0.75;
  const scored = docs.map(d => {
    let score = 0, matched = 0;
    for (const t of terms) {
      const f = d.tf[t];
      if (!f) continue;
      matched++;
      const idf = Math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / avg)));
    }
    return { d, score, matched };
  }).filter(x => x.matched >= Math.min(terms.length, Math.max(1, Math.ceil(terms.length / 2)))).sort((a, b2) => b2.score - a.score).slice(0, opts.limit ?? 10);
  const rare = [...terms].sort((a, b2) => df[a] - df[b2]);
  const hits: RelatedHit[] = scored.map(({ d, score }) => {
    let title = d.tag;
    const samples: RelatedHit['samples'] = [];
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, `${d.tag}.json`), 'utf8'));
      title = String(j?.title || d.tag);
      const segs: any[] = Array.isArray(j?.segments) ? j.segments : [];
      for (const t of rare) {
        if (samples.length >= 2) break;
        const s = segs.find(x => String(x?.text || '').toLowerCase().includes(t) && !samples.some(y => y.start === Number(x.start)));
        if (s) samples.push({ start: Number(s.start) || 0, speaker: String(s.speaker || ''), text: String(s.text || '').slice(0, 240) });
      }
    } catch { /* title stays the tag */ }
    return { releaseTag: d.tag, title, date: dateOfTag(d.tag), score: Math.round(score * 100) / 100, terms: d.tf, samples };
  });
  return { terms, hits, scanned: docs.length };
}
