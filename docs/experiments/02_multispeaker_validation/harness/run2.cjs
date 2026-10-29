// Experiment 2: segmented (A) vs whole-script (C) drafting on one long multi-speaker recording.
// Both arms get the same evidence board, outline, evidence text, clips, prompt and model. The only variable
// is scope: A drafts one scene per call (the app's real draft prompt), C drafts all three scenes in one call.
// Usage: node run2.cjs <board|outline|armA|armC|score>
const fs = require('fs');
const path = require('path');
const EXP = __dirname;
const ROOT = path.join(EXP, 'root');
const OUT = path.join(EXP, 'out');
const APP = 'C:/Users/Logan/copy-spaces-to-youtube-pipeline';
const TAG = '20260918_1AxRnZMeZNYxl';
const QUESTION = 'What has Angela said publicly about Logan: what she accuses him of, what evidence she claims to hold, what she says her motives are, and what she threatens or plans to do next? How do others in the room respond?';
const SCOPE = 'Scope for this test: a three-scene sequence of about 5 minutes, three segments with exactly one scene each. Quote-first: let the people in the recording carry the story through tape; narration only sets up, connects and states what remains unproven. Name a speaker only when the transcript label names them; refer to generic labels (Speaker 2 and so on) as an unidentified speaker.';
const THESIS = `${QUESTION}\n${SCOPE}`;

const { createJiti } = require(APP + '/node_modules/jiti');
const jiti = createJiti(__filename, { interopDefault: true });
const E = jiti(APP + '/server/scriptEngine.ts');
const PV = jiti(APP + '/server/scriptProviders.ts');
const ST = jiti(APP + '/server/scriptStore.ts');
const D = jiti(APP + '/server/scriptData.ts');
const P = jiti(APP + '/server/scriptPrompts.ts');
const STY = jiti(APP + '/server/scriptStyle.ts');
const G = jiti(APP + '/utils/scriptGates.ts');

const store = ST.createScriptStore(ROOT);
const registry = PV.createProviderRegistry({ env: () => process.env, dirs: { sandbox: path.join(EXP, 'cli-sandbox'), io: path.join(EXP, 'cli-io') } });
const engine = E.createEngine({ root: ROOT, store, registry });
const ROLE = 'claude_cli:sonnet';
const t = engine.transcript(TAG);
const byId = new Map(t.utterances.map((u, i) => [u.id, i]));
const save = (f, o) => fs.writeFileSync(path.join(OUT, f), JSON.stringify(o, null, 1));
const load = f => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));

async function call(label, prompt) {
  const a = registry.adapterFor(ROLE, { maxUsd: 0, spentUsd: 0 });
  const t0 = Date.now();
  const r = await a.complete({ role: 'reviser', system: prompt.system, user: prompt.user, schema: prompt.schema, schemaName: prompt.schemaName, maxTokens: prompt.maxTokens || 8000, timeoutMs: 15 * 60_000 });
  const entry = { label, ok: r.ok, ms: Date.now() - t0, outTok: r.usage?.outTok, code: r.code, message: r.message };
  fs.appendFileSync(path.join(OUT, 'calls.jsonl'), JSON.stringify(entry) + '\n');
  if (!r.ok) throw new Error(`${label}: ${r.code} ${r.message} ${String(r.rawOutput || '').slice(0, 1500)}`);
  return { json: r.json, ms: entry.ms };
}

/* ---------------- 1. evidence board (question first, code verified) ---------------- */
const S = { type: 'string' }; const SA = { type: 'array', items: S };
const obj = props => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });
const BOARD_SCHEMA = obj({
  quotes: { type: 'array', items: obj({
    utteranceIds: SA, verbatim: S, speaker: S, about: S,
    type: { type: 'string', enum: ['accusation', 'evidence_claim', 'motive', 'threat_or_plan', 'admission', 'response', 'other'] },
    status: { type: 'string', enum: ['checkable_in_recording', 'allegation_only', 'opinion'] }, why: S,
  }) },
  context: S,
});
async function board() {
  const lines = t.utterances.map(u => D.utteranceLine(u, {})).join('\n');
  const prompt = {
    schema: BOARD_SCHEMA, schemaName: 'evidence_board', maxTokens: 16000,
    system: `${P.BASE_RULES}
Task: an investigative producer is researching one question. Read the whole recording and pull out the passages that best help answer it, as exact quotes (aim for 25 to 40).
Question: ${QUESTION}
For each quote: the utterance ids it comes from (consecutive utterances of one speaker only), the words copied exactly (under about 80 words; the strongest contiguous excerpt), the speaker label exactly as given, who or what it is about, its type, whether it can be checked from the recording or is only the speaker's allegation or opinion, and one sentence on why it matters.
Include responses and pushback from others, not only Angela. Labels like "Speaker 2" are unidentified people; never guess who they are. "context": who is present, who is addressed, which labels are unidentified, and anything a scriptwriter must not get wrong.`,
    user: `Recording ${TAG}: ${t.title}\nLines are [utteranceId hh:mm:ss Speaker] text.\n${P.dataBlock(lines)}`,
  };
  const { json, ms } = await call('board', prompt);
  const segs = D.namedSegments(t, {});
  const quotes = (json.quotes || []).map(q => {
    const us = (q.utteranceIds || []).map(id => t.utterances[byId.get(id)]).filter(Boolean);
    const ok = us.length > 0 && us.length === q.utteranceIds.length && new Set(us.map(u => u.speaker)).size === 1
      && G.verifyVerbatim({ releaseTag: TAG, segStart: us[0].start, segEnd: us[us.length - 1].end, speaker: us[0].speaker, verbatim: q.verbatim }, segs).ok === true;
    return { ...q, verified: ok, labelMatches: us[0]?.speaker === q.speaker };
  });
  const verified = quotes.filter(q => q.verified).map((q, i) => ({ id: `Q${i + 1}`, ...q }));
  save('board.json', { ms, context: json.context, total: quotes.length, verifiedCount: verified.length, quotes: verified, rejected: quotes.filter(q => !q.verified) });
  console.log('board', ms, 'ms', quotes.length, 'quotes', verified.length, 'verified');
}

/* ---------------- shared material: clips (one per board quote) and the evidence text ---------------- */
function material() {
  const b = load('board.json');
  const clips = []; const seen = new Set();
  for (const q of b.quotes) {
    const ids = q.utteranceIds;
    const c = D.clipFromUtterances(t, ids[0], ids[ids.length - 1], {}, t.audioUrl || 'https://example.invalid/audio.mp3');
    if (c && !seen.has(c.clipId)) { seen.add(c.clipId); clips.push(c); }
    q.clipId = c?.clipId;
  }
  const ctxLines = new Set();
  for (const q of b.quotes) {
    const a = byId.get(q.utteranceIds[0]); const z = byId.get(q.utteranceIds[q.utteranceIds.length - 1]);
    for (let k = Math.max(0, a - 2); k <= Math.min(t.utterances.length - 1, z + 2); k++) ctxLines.add(k);
  }
  const boardView = b.quotes.map(q => ({ id: q.id, clipId: q.clipId, speaker: q.speaker, about: q.about, type: q.type, status: q.status, why: q.why, verbatim: q.verbatim, utteranceIds: q.utteranceIds }));
  const evidence = `Evidence board (every quote verified word for word; status says whether a claim can be checked in the recording or is only an allegation or opinion; each quote is playable as the clip named):
${JSON.stringify(boardView, null, 1)}

Producer context notes: ${b.context}

Transcript lines around every board quote (two either side). Lines are [utteranceId hh:mm:ss Speaker] text.
${[...ctxLines].sort((x, y) => x - y).map(i => D.utteranceLine(t.utterances[i], {})).join('\n')}`;
  const clipViews = clips.map(c => ({ clipId: c.clipId, title: c.title, speaker: c.speaker, durationSec: c.durationSec, text: c.text.slice(0, 1200) }));
  const project = { id: 'prj_exp2', title: 'Experiment 2', createdAt: 0, updatedAt: 0, format: 'investigative', sourceTags: [TAG], targetRuntimeSec: 300, transcriptHashes: {}, speakerNames: {}, clips, excludedClips: [], headVersionId: null, thesis: THESIS };
  return { b, clips, clipViews, evidence, project };
}

/* ---------------- 2. one fixed outline (the app's outline prompt, fed the board) ---------------- */
async function outline() {
  const { b, clips, project } = material();
  const prompt = P.outlinePrompt({
    format: 'investigative', targetRuntimeSec: 300, memory: '', recordings: '', thesis: THESIS,
    analysis: JSON.stringify({ moments: b.quotes.map(q => ({ id: q.id, kind: 'claim', why: q.why, speakers: [q.speaker], about: q.about, type: q.type, status: q.status })), producerContext: b.context }),
    clips: JSON.stringify(clips.map(c => ({ clipId: c.clipId, title: c.title, speaker: c.speaker, durationSec: c.durationSec, text: c.text.slice(0, 280) }))),
  });
  const { json, ms } = await call('outline', prompt);
  const clipIds = new Set(clips.map(c => c.clipId)); const qIds = new Set(b.quotes.map(q => q.id));
  const scenes = (json.segments || []).flatMap(s => s.scenes || []).slice(0, 3).map((sc, i) => ({
    sceneId: `sc${i + 1}`, title: String(sc.title), purpose: String(sc.purpose),
    clipIds: (sc.clipIds || []).filter(id => clipIds.has(id)), quoteIds: (sc.momentIds || []).filter(id => qIds.has(id)),
  }));
  save('outline.json', { ms, raw: json, scenes });
  console.log('outline', ms, 'ms', scenes.map(s => `${s.title} (${s.clipIds.length} clips)`).join(' | '));
}

/* ---------------- 3. drafting: same draft prompt; A one scene per call, C all scenes in one call ---------------- */
function draftPromptFor(scenes, segmentTitle, m) {
  const style = STY.draftStyle(store, ROOT);
  const sceneView = scenes.map(s => ({ sceneId: s.sceneId, title: s.title, purpose: s.purpose, clipIds: s.clipIds, quoteIds: s.quoteIds, lockedBlocks: [] }));
  const p = P.draftPrompt({ format: 'investigative', segmentTitle, scenes: JSON.stringify(sceneView), styleCard: style.styleCard, approvedPassages: style.approvedPassages, evidence: m.evidence, clips: JSON.stringify(m.clipViews), memory: '', recordings: '', thesis: THESIS });
  return { ...p, maxTokens: 12000 };
}
async function importScenes(m, outlineScenes, drafted, label) {
  const segments = outlineScenes.map((s, i) => ({ id: `seg${i + 1}`, title: s.title, scenes: [{ id: s.sceneId, title: s.title, purpose: s.purpose, blocks: [], suggestedClipIds: s.clipIds, momentIds: [] }] }));
  const base = { id: 'v_base_' + label, parentId: null, projectId: m.project.id, createdAt: 0, author: 'loop', label: 'Outline', segments };
  const imp = await engine.importCandidate(m.project, base, drafted, { label, promptVersion: label });
  if (!imp.ok) throw new Error(`${label} import failed: ${imp.reason}`);
  return imp;
}
async function armA() {
  const m = material(); const o = load('outline.json');
  const drafted = []; const timings = []; const raw = [];
  for (const s of o.scenes) {
    const { json, ms } = await call(`A draft ${s.sceneId}`, draftPromptFor([s], s.title, m));
    timings.push(ms); raw.push(json);
    const got = (json.scenes || []).find(x => String(x.sceneId) === s.sceneId) || (json.scenes || [])[0];
    drafted.push({ sceneId: s.sceneId, blocks: got ? got.blocks : [] });
  }
  const imp = await importScenes(m, o.scenes, drafted, 'A');
  save('A.json', { calls: 3, ms: timings.reduce((x, y) => x + y, 0), timings, intended: drafted, version: imp.version, gates: imp.gates });
  console.log('A done', timings);
}
async function armC() {
  const m = material(); const o = load('outline.json');
  const { json, ms } = await call('C draft all', draftPromptFor(o.scenes, 'Full sequence (all three scenes)', m));
  const drafted = o.scenes.map(s => ({ sceneId: s.sceneId, blocks: ((json.scenes || []).find(x => String(x.sceneId) === s.sceneId) || {}).blocks || [] }));
  const imp = await importScenes(m, o.scenes, drafted, 'C');
  save('C.json', { calls: 1, ms, intended: drafted, version: imp.version, gates: imp.gates });
  console.log('C done', ms);
}

const step = process.argv[2];
const steps = { board, outline, armA, armC, score: () => require('./score2.cjs')({ G, t, TAG, OUT, fs, path }) };
(steps[step] || (() => { throw new Error('unknown step ' + step); }))()
  .then(() => process.exit(0)).catch(e => { console.error(e.stack || e); process.exit(1); });
