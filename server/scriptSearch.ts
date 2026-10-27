/**
 * Code search for related recordings (thematic and investigative episodes): ranks every transcript on
 * disk by how often it uses the thesis terms (BM25 over the raw transcript text). No model call.
 */
import fs from 'node:fs';
import path from 'node:path';
import { dateOfTag } from '../utils/scriptFormats';

export interface RelatedHit { releaseTag: string; title: string; date: string | null; score: number; terms: Record<string, number>; samples: { start: number; speaker: string; text: string }[] }

const STOP = new Set('about above after again against also because been before being below between both could does doing down during each from further have having here into itself just more most other over same should some such than that their them then there these they this those through under until very what when where which while will with would your yours really think know like going want people thing things said says yeah okay right well'.split(' '));

export function queryTerms(q: string): string[] {
  return [...new Set(q.toLowerCase().replace(/[^a-z0-9' -]+/g, ' ').split(/[\s-]+/).map(w => w.replace(/^'+|'+$/g, '')).filter(w => w.length >= 4 && !STOP.has(w)))].slice(0, 12);
}

function count(hay: string, term: string): number {
  const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w{0,3}\\b`, 'g');
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
