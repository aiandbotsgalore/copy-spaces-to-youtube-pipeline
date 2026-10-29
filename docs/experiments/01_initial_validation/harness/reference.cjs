// Builds the reference set: every verified AQ quote in the four test recordings, located in its transcript.
const { fs, path, EXP, APP, TAGS, norm, loadSegs, longestRun } = require('./common.cjs');
const corpus = JSON.parse(fs.readFileSync(path.join(APP, 'docs/documentary/data/angela_quotes_master.json'), 'utf8'));
const out = [];
for (const tag of TAGS) {
  const segs = loadSegs(tag);
  for (const q of corpus.filter(x => x.release_tag === tag)) {
    const parts = q.exact_quote.split(/\.\.\.|…/).map(norm).filter(p => p.length >= 4);
    const located = parts.map(p => {
      let best = { run: 0, id: null };
      for (const s of segs) { const r = longestRun(p, norm(s.text)); if (r > best.run) best = { run: r, id: s.id }; }
      return { words: p.length, run: best.run, id: best.id };
    });
    const ok = located.every(l => l.run >= Math.min(8, l.words));
    out.push({
      quoteId: q.quote_id, tag, status: q.verification_status, conf: q.speaker_attribution_confidence, category: q.category,
      cutIn: q.cut_in, cutOut: q.cut_out, utteranceIds: [...new Set(located.map(l => l.id))], located: ok,
      coverage: located.map(l => `${l.run}/${l.words}`).join(' '), parts, quote: q.exact_quote,
    });
  }
}
fs.writeFileSync(path.join(EXP, 'out/reference.json'), JSON.stringify(out, null, 1));
for (const r of out) console.log(r.quoteId, r.tag.slice(-6), r.status, r.conf, r.located ? 'LOCATED' : 'NOT LOCATED', r.utteranceIds.join(','), r.coverage);
console.log('total', out.length, 'located', out.filter(r => r.located).length);
