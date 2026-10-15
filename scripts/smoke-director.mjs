// Smoke test for the AI Prompt Director endpoint. Never prints the API key.
// Usage: node scripts/smoke-director.mjs [baseUrl]   (default http://127.0.0.1:5000)
const base = (process.argv[2] || 'http://127.0.0.1:5000').replace(/\/+$/, '') + '/api/montage/direct';

const cand = (id, speaker, category, sourceDate, durationSec, text) => ({
  id, speaker, category, sourceDate, sourceTitle: 'Sample Space', status: 'EXISTS', durationSec, text, textTruncated: false,
});
// Neutral synthetic sample material (not real recordings).
const candidates = [
  cand('s01', 'Host', 'Context', '2026-02-10', 18.2, 'um so basically I keep a written log of every conversation because I think records matter more than memory'),
  cand('s02', 'Host', 'Method', '2026-03-01', 22.4, 'Before I say anything publicly I check it against two independent sources, that is my rule and I do not break it'),
  cand('s03', 'Guest', 'Context', '2026-03-15', 15.0, 'I have known them for years and I never saw any of that behaviour, honestly it surprised me'),
  cand('s04', 'Host', 'Dispute', '2026-06-20', 20.1, 'Look, I posted the screenshot first and I verified it afterwards, I know that is not how I said it should work'),
  cand('s05', 'Guest', 'Dispute', '2026-06-21', 17.7, 'That is not what happened and I can show the messages from that night, they say something different'),
  cand('s06', 'Host', 'Aftermath', '2026-08-02', 24.3, 'Yes the process server was sent, and yes in hindsight process can be used as a club by both sides, myself included'),
  cand('s07', 'Guest', 'Aftermath', '2026-08-05', 12.9, 'I just want it on the record that nobody contacted me before that went out'),
  cand('s08', 'Host', 'Context', '2026-04-11', 19.5, 'Evidence has to serve a purpose, otherwise you are just twisting the knife and that is not what this is for'),
];

async function j(path, init) {
  const t0 = Date.now();
  const res = await fetch(base + path, init);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, ms: Date.now() - t0, text };
}

const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };

const status = await j('/status');
console.log('status   ', status.status, JSON.stringify(status.json));
if (!status.json) { fail('Director endpoint not reachable (is the dev server running?)'); process.exit(1); }
if (!status.json.keyConfigured) console.log('note: no key in .env.local on the server; set one or use the in-app backup key');

const test = await j('/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
console.log('test     ', test.status, JSON.stringify(test.json));
if (!test.json?.ok) fail('connection test failed');

const body = { mode: 'generate', cutId: 'cut_a', userPrompt: '75 second chronological record of how the dispute developed', targetWindowSec: 75, candidates };
const gen = await j('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
console.log('generate ', gen.status, `${gen.ms} ms`);
if (!gen.json?.ok) { fail('generate failed: ' + JSON.stringify(gen.json)); process.exit(1); }
const byId = Object.fromEntries(candidates.map(c => [c.id, c]));
console.log('title    ', gen.json.cut.title, '|', gen.json.cut.tagline);
let total = 0;
gen.json.cut.picks.forEach((p, i) => {
  const c = byId[p.clipId];
  total += c.durationSec + (i < gen.json.cut.picks.length - 1 ? p.gapAfterSec : 0);
  console.log(` ${i + 1}. ${p.clipId} [${c.sourceDate}] t${p.tensionScore} gap ${p.gapAfterSec}${p.keptText ? ' TRIM' : ''} :: ${p.note}`);
});
console.log('est. runtime', total.toFixed(1), 's of 75 target; usage', JSON.stringify(gen.json.usage), 'model', gen.json.model, 'warnings', JSON.stringify(gen.json.warnings));
const dates = gen.json.cut.picks.map(p => byId[p.clipId].sourceDate);
if (dates.join() !== [...dates].sort().join()) fail('cut_a is not chronological');

const cur = gen.json.cut.picks.map((p, i) => ({ index: i, clipId: p.clipId, text: byId[p.clipId].text, startSec: 0, endSec: byId[p.clipId].durationSec, durationSec: byId[p.clipId].durationSec, gapAfterSec: p.gapAfterSec, locked: i === 0 }));
const ref = await j('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'refine', cutId: 'cut_a', userPrompt: body.userPrompt, targetWindowSec: 75, candidates, instruction: 'Drop the last clip and make the pause after the second clip longer.', current: cur }) });
console.log('refine   ', ref.status, `${ref.ms} ms`, JSON.stringify(ref.json?.refine ?? ref.json));
if (!ref.json?.ok) fail('refine failed');
console.log(process.exitCode ? 'SMOKE: FAILED' : 'SMOKE: OK');
