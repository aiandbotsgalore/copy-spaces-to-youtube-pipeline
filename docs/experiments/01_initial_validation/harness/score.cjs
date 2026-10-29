// Scores both experiments from the saved outputs. Pure code: no model calls.
const { fs, path, EXP, TAGS, DRAFT_TAG, hits, loadSegs } = require('./common.cjs');
const OUT = path.join(EXP, 'out');
const read = f => { try { return JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')); } catch { return null; } };
const ref = read('reference.json');
const report = {};

/* ---------------- retrieval ---------------- */
const R1 = read('R1_analysis.json');
const R2 = read('R2_question_first.json');
if (R1 && R2) {
  const rows = [];
  for (const r of ref) {
    const m = R1[r.tag].moments;
    const q = R2[r.tag].quotes;
    rows.push({
      quoteId: r.quoteId, tag: r.tag,
      R1_line: m.some(x => x.utteranceIds.some(id => r.utteranceIds.includes(id))),
      R1_text: m.some(x => (x.evidence || []).some(qq => hits(r.parts, qq.verbatim))),
      R2_line: q.some(x => x.utteranceIds.some(id => r.utteranceIds.includes(id))),
      R2_text: q.some(x => x.verified && hits(r.parts, x.verbatim)),
    });
  }
  const sum = k => rows.filter(x => x[k]).length;
  const per = {};
  for (const tag of TAGS) {
    const segs = loadSegs(tag);
    const linesR1 = new Set(R1[tag].moments.flatMap(x => x.utteranceIds));
    const linesR2 = new Set(R2[tag].quotes.flatMap(x => x.utteranceIds));
    per[tag] = {
      lines: segs.length, refQuotes: ref.filter(r => r.tag === tag).length,
      R1: { ms: R1[tag].ms, items: R1[tag].moments.length, quotes: R1[tag].moments.reduce((a, x) => a + (x.evidence || []).length, 0), linesKept: linesR1.size },
      R2: { ms: R2[tag].ms, items: R2[tag].quotes.length, verified: R2[tag].quotes.filter(x => x.verified).length, linesKept: linesR2.size },
    };
  }
  report.retrieval = { n: rows.length, R1_line: sum('R1_line'), R1_text: sum('R1_text'), R2_line: sum('R2_line'), R2_text: sum('R2_text'), per, rows };
}

/* ---------------- drafts ---------------- */
const WPS = 2.6; // narration speaking rate, words per second
function readable(version, intended = []) {
  let ci = 0;
  const lines = [];
  version.segments.forEach((seg, si) => seg.scenes.forEach(sc => {
    lines.push(`\n## Scene ${si + 1}: ${sc.title}`);
    for (const b of sc.blocks) {
      if (b.kind === 'narration') lines.push(`NARRATOR: ${b.text}`);
      else if (b.kind === 'clip') { const k = (intended[ci++] || {}).keptText || b.keptText; lines.push(`[TAPE ${b.clipId.split('_').pop()}, ${b.speaker || 'speaker'}] "${k}"`); }
      else if (b.kind === 'pause') lines.push(`[pause ${b.sec}s]`);
      else if (b.kind === 'music') lines.push(`[music ${b.cue}: ${b.note}]`);
    }
  }));
  return lines.join('\n');
}
function intendedClips(name, d) {
  if (d.raw) return d.raw.scenes.flatMap(sc => sc.blocks).filter(b => b.kind === 'clip');
  const lines = fs.existsSync(path.join(OUT, 'raw_calls.jsonl')) ? fs.readFileSync(path.join(OUT, 'raw_calls.jsonl'), 'utf8').trim().split(String.fromCharCode(10)).map(JSON.parse) : [];
  return lines.filter(l => l.arm === 'armA' && l.schema === 'segment_draft' && l.ok).flatMap(l => l.json.scenes.flatMap(sc => sc.blocks)).filter(b => b.kind === 'clip');
}
function draftStats(name, file) {
  const d = read(file);
  if (!d) return null;
  const blocks = d.version.segments.flatMap(s => s.scenes.flatMap(sc => sc.blocks));
  const nar = blocks.filter(b => b.kind === 'narration');
  const clips = blocks.filter(b => b.kind === 'clip');
  const narSec = nar.reduce((a, b) => a + b.text.split(/\s+/).filter(Boolean).length, 0) / WPS;
  const intended = intendedClips(name, d);
  const tapeSec = intended.reduce((a, b) => a + String(b.keptText || '').split(/\s+/).filter(Boolean).length, 0) / WPS;
  const appTapeSec = clips.reduce((a, b) => a + Math.max(0, b.outSec - b.inSec), 0);
  const refOnTape = ref.filter(r => r.tag === DRAFT_TAG && intended.some(c => hits(r.parts, c.keptText || ''))).map(r => r.quoteId);
  const refNarrated = ref.filter(r => r.tag === DRAFT_TAG && nar.some(n => n.claims.some(c => hits(r.parts, c.verbatim)))).map(r => r.quoteId);
  const flagged = clips.filter(c => c.trimFlag || c.flag || c.badTrim).length;
  fs.writeFileSync(path.join(OUT, `${name}_readable.md`), readable(d.version, intended));
  return {
    timings: d.timings, scenes: d.version.segments.reduce((a, s) => a + s.scenes.length, 0),
    notDrafted: d.version.segments.filter(s => s.notDrafted).map(s => s.notDrafted),
    narrationBlocks: nar.length, claims: nar.reduce((a, b) => a + b.claims.length, 0), clipBlocks: clips.length, flaggedClips: flagged,
    narrationSec: Math.round(narSec), tapeSec: Math.round(tapeSec), appTapeSecAfterTrimFallback: Math.round(appTapeSec), intendedClips: intended.length, tapeShare: +(tapeSec / (tapeSec + narSec || 1)).toFixed(2),
    refQuotesOnTape: refOnTape, refQuotesNarratedAsClaims: refNarrated,
    gates: { factual: d.gates.factual, faithful: d.gates.faithful, failures: d.gates.failures },
  };
}
report.drafts = { A: draftStats('A', 'A_existing.json'), B: draftStats('B', 'B_whole.json'), C: draftStats('C', 'C_hybrid.json') };
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ ...report, retrieval: report.retrieval && { ...report.retrieval, rows: undefined } }, null, 1));
if (report.retrieval) for (const r of report.retrieval.rows) console.log(r.quoteId, r.tag.slice(-6), 'R1 line', r.R1_line ? 'Y' : '-', 'text', r.R1_text ? 'Y' : '-', '| R2 line', r.R2_line ? 'Y' : '-', 'text', r.R2_text ? 'Y' : '-');
