// Blind cross-family judge (the app's judge provider, Codex) with the full transcript. Two orders.
const { fs, path, EXP, APP, DRAFT_TAG, QUESTION } = require('./common.cjs');
const { createJiti } = require(APP + '/node_modules/jiti');
const jiti = createJiti(__filename, { interopDefault: true });
const PV = jiti(APP + '/server/scriptProviders.ts');
const P = jiti(APP + '/server/scriptPrompts.ts');
const D = jiti(APP + '/server/scriptData.ts');
const OUT = path.join(EXP, 'out');
const registry = PV.createProviderRegistry({ env: () => process.env, dirs: { sandbox: path.join(EXP, 'cli-sandbox-j'), io: path.join(EXP, 'cli-io-j') } });

const S = { type: 'string' }; const I = { type: 'integer' };
const obj = props => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });
const SCHEMA = obj({
  scripts: { type: 'array', items: obj({
    label: S,
    errors: { type: 'array', items: obj({ excerpt: S, problem: S, severity: { type: 'string', enum: ['serious', 'minor'] } }) },
    accuracy: I, fairness: I, ownVoice: I, coherence: I, storytelling: I, summary: S,
  }) },
  ranking: { type: 'array', items: S }, reasons: S,
});

const t = D.readTranscript(path.join(EXP, 'root'), DRAFT_TAG);
const transcript = t.utterances.map(u => D.utteranceLine(u, {})).join('\n');
const scripts = { A: 'A_readable.md', B: 'B_readable.md', C: 'C_readable.md' };
const text = Object.fromEntries(Object.entries(scripts).map(([k, f]) => [k, fs.readFileSync(path.join(OUT, f), 'utf8')]));

async function judge(order, run) {
  const labels = ['X', 'Y', 'Z'];
  const map = Object.fromEntries(order.map((k, i) => [labels[i], k]));
  const system = `${P.BASE_RULES}
Task: you are a senior investigative audio documentary editor. Three draft scripts for the same three-scene sequence were written from the recording transcript below, for the question: "${QUESTION}"
The episode format is an investigative deep dive: allegations must stay allegations, and the subject's own recorded voice (TAPE) is more persuasive and safer than a narrator paraphrasing her.
For each script: list every factual error against the transcript (wrong attribution, wrong event, wrong order, invented detail, an allegation stated as fact, a quote that misrepresents its context, or a contradiction between scenes), then score 1 to 10: accuracy (faithful to the transcript), fairness (allegations framed as allegations, no loaded framing), ownVoice (lets the speaker carry the story through tape), coherence (one consistent story across the three scenes, no repetition), storytelling (would hold a listener). Then rank the scripts best first by overall quality for this documentary. Check claims against the transcript yourself; do not trust the scripts.`;
  const user = `Transcript (lines are [utteranceId hh:mm:ss Speaker] text):\n${P.dataBlock(transcript)}\n\n${labels.map(l => `=== SCRIPT ${l} ===\n${text[map[l]]}`).join('\n\n')}`;
  const adapter = registry.adapterFor('codex_cli', { maxUsd: 0, spentUsd: 0 });
  const t0 = Date.now();
  const r = await adapter.complete({ role: 'judge', system, user, schema: SCHEMA, schemaName: 'judge', maxTokens: 6000, timeoutMs: 15 * 60_000 });
  if (!r.ok) throw new Error(`${r.code} ${r.message} ${String(r.rawOutput || '').slice(0, 1500)}`);
  const j = r.json;
  const unblind = { run, order, ms: Date.now() - t0, model: r.model, scripts: j.scripts.map(s => ({ ...s, arm: map[s.label] })), ranking: j.ranking.map(l => map[l] || l), reasons: j.reasons };
  fs.writeFileSync(path.join(OUT, `judge_${run}.json`), JSON.stringify(unblind, null, 1));
  console.log(run, 'ranking', unblind.ranking.join(' > '), unblind.scripts.map(s => `${s.arm}: acc ${s.accuracy} fair ${s.fairness} voice ${s.ownVoice} coh ${s.coherence} story ${s.storytelling} errors ${s.errors.length} (${s.errors.filter(e => e.severity === 'serious').length} serious)`).join(' | '));
}

Promise.all([judge(['A', 'B', 'C'], 1), judge(['C', 'B', 'A'], 2)]).then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
