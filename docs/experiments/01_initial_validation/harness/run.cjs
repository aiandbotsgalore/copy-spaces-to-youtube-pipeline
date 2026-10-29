// Experiment harness. Imports the app's own engine, prompts, providers and gates (read only) and runs
// every arm against an isolated scratch root, so nothing in the app's .spacepipe-studio is touched.
// Usage: node run.cjs <analyze|qf|armA|armB|armC|judge>
const { fs, path, EXP, ROOT, APP, TAGS, DRAFT_TAG, QUESTION, SCOPE, loadSegs } = require('./common.cjs');
const { createJiti } = require(APP + '/node_modules/jiti');
const jiti = createJiti(__filename, { interopDefault: true });
const E = jiti(APP + '/server/scriptEngine.ts');
const PV = jiti(APP + '/server/scriptProviders.ts');
const ST = jiti(APP + '/server/scriptStore.ts');
const D = jiti(APP + '/server/scriptData.ts');
const P = jiti(APP + '/server/scriptPrompts.ts');
const STY = jiti(APP + '/server/scriptStyle.ts');
const G = jiti(APP + '/utils/scriptGates.ts');

const OUT = path.join(EXP, 'out');
const store = ST.createScriptStore(ROOT);
const registry = PV.createProviderRegistry({ env: () => process.env, dirs: { sandbox: path.join(EXP, 'cli-sandbox'), io: path.join(EXP, 'cli-io') } });
// RAW CAPTURE: record every structured reply so intended clip excerpts survive the app's trim fallback.
const _adapterFor = registry.adapterFor.bind(registry);
registry.adapterFor = (spec, budget) => { const a = _adapterFor(spec, budget); if (!a) return a; const c = a.complete.bind(a);
  return { ...a, available: a.available.bind(a), complete: async req => { const r = await c(req); fs.appendFileSync(path.join(EXP, 'out', 'raw_calls.jsonl'), JSON.stringify({ arm: process.argv[2], schema: req.schemaName, ok: r.ok, json: r.json }) + String.fromCharCode(10)); return r; } }; };
const engine = E.createEngine({ root: ROOT, store, registry });
const ROLE = 'claude_cli:sonnet';
const roleMap = { analyst: ROLE, reviser: ROLE, critic: ROLE, judge: 'codex_cli', factcheck: 'codex_cli' };
const ctx = label => ({ roleMap, budget: { maxUsd: 0, spentUsd: 0 }, signal: new AbortController().signal, label });
const save = (name, obj) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 1));
const timed = async (fn) => { const t = Date.now(); const r = await fn(); return { r, ms: Date.now() - t }; };

function project(tags = [DRAFT_TAG], withClips = true) {
  const t = engine.transcript(DRAFT_TAG);
  const clips = withClips ? t.utterances.map(u => D.clipFromUtterances(t, u.id, u.id, {}, t.audioUrl || 'https://example.invalid/audio.mp3')).filter(Boolean) : [];
  return {
    id: 'prj_experiment', title: 'Experiment', createdAt: 0, updatedAt: 0, format: 'investigative', sourceTags: tags, targetRuntimeSec: 300,
    transcriptHashes: {}, speakerNames: {}, clips, excludedClips: [], headVersionId: null, thesis: `${QUESTION}\n${SCOPE}`,
  };
}

/* ---------- direct calls for arms B and C (same adapter, same model as the engine's reviser) ---------- */
async function direct(label, system, user, schema, schemaName, maxTokens = 8000) {
  const adapter = registry.adapterFor(ROLE, { maxUsd: 0, spentUsd: 0 });
  const t = Date.now();
  const r = await adapter.complete({ role: 'reviser', system, user, schema, schemaName, maxTokens, timeoutMs: 10 * 60_000 });
  const entry = { label, ok: r.ok, ms: Date.now() - t, inTok: r.usage?.inTok, outTok: r.usage?.outTok, model: r.model, code: r.code, message: r.message };
  fs.appendFileSync(path.join(OUT, 'calls.jsonl'), JSON.stringify(entry) + '\n');
  if (!r.ok) throw new Error(`${label}: ${r.code} ${r.message}\n${String(r.rawOutput || '').slice(0, 2000)}`);
  return r.json;
}

const transcriptLines = tag => { const t = engine.transcript(tag); return t.utterances.map(u => D.utteranceLine(u, {})).join('\n'); };
const thesisNote = `Thesis question Logan set for this episode: ${QUESTION}\n${SCOPE}`;

/* ---------- question-first extraction (retrieval arm R2, and step 1 of the hybrid) ---------- */
const S = { type: 'string' };
const SA = { type: 'array', items: S };
const obj = props => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });
const QF_SCHEMA = obj({
  quotes: { type: 'array', items: obj({
    utteranceIds: SA, verbatim: S, speaker: S, about: S,
    type: { type: 'string', enum: ['accusation', 'evidence_claim', 'motive', 'threat_or_plan', 'admission', 'other'] },
    status: { type: 'string', enum: ['checkable_in_recording', 'allegation_only', 'opinion'] }, why: S,
  }) },
  context: S,
});
function qfPrompt(tag) {
  const t = engine.transcript(tag);
  return {
    system: `${P.BASE_RULES}
Task: an investigative producer is researching one question. Read the whole recording and pull out every passage that helps answer it, as exact quotes.
Question: ${QUESTION}
For each quote: the utterance ids it comes from, the words copied exactly (a quote may span consecutive utterances of one speaker; keep each quote under about 120 words, pick the strongest contiguous excerpt), the speaker label as given, who or what it is about, its type, whether it can be checked from the recording itself or is only the speaker's allegation or opinion, and one sentence on why it matters to the question.
Include passages that complicate or contradict the speaker's account, not only supporting ones. Do not include filler. "context": a few sentences on who is present, who is being addressed and anything a scriptwriter must not get wrong.`,
    user: `Recording ${tag}: ${t.title}\nLines are [utteranceId hh:mm:ss Speaker] text.\n${P.dataBlock(transcriptLines(tag))}`,
  };
}
function verifyQuotes(tag, quotes) {
  const segs = D.namedSegments(engine.transcript(tag), {});
  const byId = new Map(engine.transcript(tag).utterances.map(u => [u.id, u]));
  return quotes.map(q => {
    const us = (q.utteranceIds || []).map(id => byId.get(id)).filter(Boolean);
    const ok = us.length > 0 && us.length === q.utteranceIds.length && G.verifyVerbatim({ releaseTag: tag, segStart: us[0].start, segEnd: us[us.length - 1].end, speaker: us[0].speaker, verbatim: q.verbatim }, segs).ok === true;
    const plain = us.map(u => u.text).join(' ').toLowerCase().replace(/\s+/g, ' ');
    const sub = plain.includes(String(q.verbatim).toLowerCase().replace(/\s+/g, ' ').trim());
    return { ...q, verified: ok, substring: sub };
  });
}

/* ---------- arms ---------- */
async function analyzeAll() {
  const p = project(TAGS, false);
  const res = {};
  await Promise.all(TAGS.map(async tag => {
    const { r, ms } = await timed(() => engine.analyze({ ...p, sourceTags: [tag] }, tag, ctx('analysis')));
    res[tag] = { ms, moments: r.moments, themes: r.themes, chunks: r.chunks };
    console.log('analysis', tag, ms, 'ms', r.moments.length, 'moments');
  }));
  save('R1_analysis.json', res);
}

async function qfAll() {
  const res = {};
  await Promise.all(TAGS.map(async tag => {
    const pr = qfPrompt(tag);
    const { r, ms } = await timed(() => direct(`qf ${tag}`, pr.system, pr.user, QF_SCHEMA, 'evidence_board'));
    res[tag] = { ms, context: r.context, quotes: verifyQuotes(tag, r.quotes || []) };
    console.log('qf', tag, ms, 'ms', res[tag].quotes.length, 'quotes', res[tag].quotes.filter(q => q.verified).length, 'verified');
  }));
  save('R2_question_first.json', res);
}

async function armA() {
  const p = project();
  const style = STY.draftStyle(store, ROOT);
  const a = await timed(() => engine.analyze(p, DRAFT_TAG, ctx('analysis')));
  const tg = await timed(() => engine.tagClips(p, a.r, ctx('clip tags')));
  const o = await timed(() => engine.outline(tg.r.project, a.r, ctx('outline')));
  const d = await timed(() => engine.draft(tg.r.project, o.r, a.r, ctx('draft'), style.styleCard, style.approvedPassages));
  save('A_existing.json', { timings: { analysisMs: a.ms, tagMs: tg.ms, outlineMs: o.ms, draftMs: d.ms }, outline: o.r, version: d.r.version, gates: d.r.gates });
  console.log('A done', JSON.stringify({ analysisMs: a.ms, tagMs: tg.ms, outlineMs: o.ms, draftMs: d.ms }), 'hard gates', d.r.gates.hard?.length);
}

const SCENES_SCHEMA = obj({ scenes: { type: 'array', items: obj({ title: S, purpose: S, blocks: { type: 'array', items: P.PATCH_BLOCK_SCHEMA } }) } });
function wholePrompt(extra = '') {
  const style = STY.draftStyle(store, ROOT);
  const p = project();
  const memory = store.getMemory().styleRules.slice(0, 30).map(r => `- ${r.rule}`).join('\n');
  const clipList = p.clips.map(c => `${c.clipId} = utterance ${c.clipId.split('_').pop()} (${c.speaker}, ${c.durationSec}s): its text is that transcript line`).join('\n');
  return {
    p,
    system: `${P.BASE_RULES}
Task: plan and draft the script in one pass. Return exactly three scenes in order; for each give a title, a one-sentence purpose and its blocks (narration, clips, pauses, music-cue markers). Write narration in Logan's voice as described by the style card: "live" narration sounds like Logan talking in his Spaces, "polished" like his written documentary narration. Match the mode to the scene. Keep the three scenes consistent with each other: one story, no repeated set-ups, no contradictions.
${P.formatBrief('investigative')}
${P.BLOCK_RULES}
${thesisNote}`,
    user: `Style card:
${style.styleCard || '(none yet)'}

Approved passages by Logan:
${style.approvedPassages || '(none yet)'}

Editorial rules:
${memory || '(none yet)'}

Clips: every transcript line is available as a clip. keptText must be copied exactly from that line.
${clipList}
${extra}
Full transcript of the recording. Lines are [utteranceId hh:mm:ss Speaker] text.
${P.dataBlock(transcriptLines(DRAFT_TAG))}`,
  };
}

async function importScenes(p, scenes, label) {
  const segments = scenes.map((s, i) => ({ id: `seg${i + 1}`, title: s.title, scenes: [{ id: `sc${i + 1}`, title: s.title, purpose: s.purpose, blocks: [], suggestedClipIds: [], momentIds: [] }] }));
  const base = { id: 'v_base_' + label, parentId: null, projectId: p.id, createdAt: 0, author: 'loop', label: 'Outline', segments };
  const imp = await engine.importCandidate(p, base, scenes.map((s, i) => ({ sceneId: `sc${i + 1}`, blocks: s.blocks })), { label, promptVersion: label });
  if (!imp.ok) throw new Error(`${label} import failed: ${imp.reason}`);
  return imp;
}

async function armB() {
  const w = wholePrompt();
  const { r, ms } = await timed(() => direct('B whole-script', w.system, w.user, SCENES_SCHEMA, 'whole_script'));
  const imp = await importScenes(w.p, r.scenes, 'B');
  save('B_whole.json', { timings: { draftMs: ms }, raw: r, version: imp.version, gates: imp.gates });
  console.log('B done', ms, 'ms', 'hard gates', imp.gates.hard?.length);
}

async function armC() {
  const qf = JSON.parse(fs.readFileSync(path.join(OUT, 'R2_question_first.json'), 'utf8'))[DRAFT_TAG];
  const board = qf.quotes.filter(q => q.verified).map((q, i) => ({ id: `Q${i + 1}`, utteranceIds: q.utteranceIds, speaker: q.speaker, about: q.about, type: q.type, status: q.status, why: q.why, verbatim: q.verbatim }));
  const extra = `
Evidence board (quotes already verified word for word against the transcript; status says whether a claim can be checked in the recording or is only the speaker's allegation or opinion):
${JSON.stringify(board, null, 1)}

Producer notes on context: ${qf.context}

Build the scenes on the evidence board. Let the speaker carry the story in her own words: use board quotes as clips where they work as tape, and keep narration for set-up, context and what remains unproven. Narration must not state an allegation_only or opinion item as fact.
`;
  const w = wholePrompt(extra);
  const { r, ms } = await timed(() => direct('C hybrid draft', w.system, w.user, SCENES_SCHEMA, 'whole_script'));
  const imp = await importScenes(w.p, r.scenes, 'C');
  save('C_hybrid.json', { timings: { extractMs: qf.ms, draftMs: ms }, board, raw: r, version: imp.version, gates: imp.gates });
  console.log('C done', ms, 'ms', 'hard gates', imp.gates.hard?.length);
}

const arm = process.argv[2];
({ analyze: analyzeAll, qf: qfAll, armA, armB, armC }[arm] || (() => { throw new Error('unknown arm ' + arm); }))()
  .then(() => process.exit(0)).catch(e => { console.error(e.stack || e); process.exit(1); });
