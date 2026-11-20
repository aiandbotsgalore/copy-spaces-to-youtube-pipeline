import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyBodyEdits, boundaryCandidates, createReviewLoop, DEFAULT_CONFIG, extractQuotes, makeIntroLock, parseReview, passageExcerpts, passProblems, quoteInText,
  reassemble, sha256, splitScript, TACTICS, type ReviewRun, type SourceHit,
} from '../../server/scriptReviewLoop';
import { agyArgs, AGY_FILE_INSTRUCTION, AGY_INLINE_PROMPT_MAX, codexArgs, createProviderRegistry, parseRoleSpec, type CompleteRequest, type CompleteResult, type ProviderAdapter } from '../../server/scriptProviders';

/* ---------------------------------------------------------------------------------------------- */
/* Fixture                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

const INTRO = `# THE PAPER TRAIL\n**NARRATOR:** Logan Black  \n\n---\n\n### PROLOGUE — LOCKED VERBATIM INTRO\n\nAngela: I am a walking paper trail, and everybody knows it.\n\nLogan : This is the paper trail.   \n\n---\n\n`;
const BODY_START = '### ACT I — SCENE 1: START';
const BODY = `${BODY_START}\n\nThe original first scene sentence that sets things up for the listener today.\n\n**ANGELA:** "I keep everything that anybody ever sends me in private."\n\n### ACT I — SCENE 2: NEXT\n\nThe second scene carries on with more detail for the listener to follow along.\n\n### EPILOGUE\n\nThe ending closes the story for now and points back to the opening question.\n`;
const SCRIPT = INTRO + BODY;

const SOURCES: SourceHit[] = [
  { ref: 'passage:keep', text: 'Angela: I keep everything that anybody ever sends me in private. Everything.', speaker: 'Angela Maggard', recording: '20260918_x' },
  { ref: 'passage:new', text: 'Sav said I only went to her because I thought she could help me with my family.', speaker: 'Sav', recording: '20260908_y' },
];

type Handler = (spec: string, req: CompleteRequest) => any;
interface Seen { spec: string; schemaName: string; system: string; user: string }

function fakeRegistry(handler: Handler, seen: Seen[]) {
  return {
    adapterFor(spec: string, budget: { maxUsd: number; spentUsd: number }): ProviderAdapter {
      const paid = spec.startsWith('inception:');
      return {
        id: spec.startsWith('agy') ? 'agy_cli' : spec.startsWith('codex') ? 'codex_cli' : spec.startsWith('inception') ? 'inception' : 'claude_cli',
        family: 'anthropic', model: spec,
        async available() { return { ok: true, detail: 'mock' }; },
        async complete(req: CompleteRequest): Promise<CompleteResult> {
          seen.push({ spec, schemaName: req.schemaName, system: req.system, user: req.user });
          if (paid) {
            if (budget.spentUsd + 0.01 > budget.maxUsd + 1e-12) return { ok: false, code: 'BUDGET_EXCEEDED', message: 'over the cap', rawOutput: '', durationMs: 1, provider: 'inception', model: spec };
            budget.spentUsd += 0.01;
          }
          const r = handler(spec, req) as any;
          if (r && r.ok === false) return r;
          return { ok: true, json: r?.json ?? r, provider: 'claude_cli', model: spec, durationMs: 1, usage: { inTok: 1, outTok: 1, costUsd: 0 } };
        },
      } as ProviderAdapter;
    },
  };
}

const review = (score: number, opts: { blocker?: string; structural?: string; needsMaterial?: string; verdict?: string } = {}) => ({
  score,
  summary: `score ${score}`,
  works: [{ passage: 'The second scene carries on with more detail', why: 'clear' }],
  findings: [
    ...(score < 90 && !opts.blocker && !opts.structural ? [{ passage: 'sets things up for the listener today', missingConnection: '', problem: 'flat opening', effectOnListener: 'the listener drifts', proposedChange: 'sharpen', criterion: 'pacing', blocker: false, structural: false, needsMaterial: opts.needsMaterial || '' }] : []),
    ...(opts.blocker ? [{ passage: opts.blocker, missingConnection: '', problem: 'misleading', effectOnListener: 'the listener infers something the sources do not support', proposedChange: 'fix', criterion: 'inference_support', blocker: true, structural: false, needsMaterial: '' }] : []),
    ...(opts.structural ? [{ passage: opts.structural, missingConnection: '', problem: 'the reveal comes too late', effectOnListener: 'confusing', proposedChange: 'move it', criterion: 'story_clarity', blocker: false, structural: true, needsMaterial: '' }] : []),
  ],
  ending: { verdict: opts.verdict || 'answers', openingQuestions: ['Is she a walking paper trail?'], note: '' },
});

const edit = (find: string, replace: string) => ({ find, replace, why: 'test' });

let base: string;
let seen: Seen[];
let saved: { projectId: string; text: string; label: string }[];
const PID = 'prj_test1';

function makeLoop(handler: Handler, research?: Partial<{ search: any; rerank: any }>) {
  return createReviewLoop({
    base,
    registry: fakeRegistry(handler, seen),
    research: {
      search: research?.search ?? (async (q: string) => ({ ok: true, items: SOURCES.filter(s => quoteInText(q, s.text) || s.text.toLowerCase().includes(q.toLowerCase().slice(0, 12))) })),
      ...(research?.rerank ? { rerank: research.rerank } : {}),
    },
    context: () => ({ brief: 'BRIEF: keep allegations distinct from fact.', supporting: 'SUPPORTING: timeline notes.' }),
    saveResult: (projectId, text, label) => { saved.push({ projectId, text, label }); return `v_${saved.length}`; },
    random: () => 0.9,
  });
}

/** The tests in sections 1 to 5 exercise full rewrites; targeted fixes have their own section. */
function startRun(loop: ReturnType<typeof makeLoop>, limits: Record<string, number | string> = {}, text = SCRIPT): ReviewRun {
  loop.setIntroLock(PID, SCRIPT, BODY_START, 'master.md');
  return loop.createRun(PID, text, { file: 'master.md', maxCalls: 40, maxUsd: 1, maxRounds: 12, targetedReviser: '', ...limits });
}

beforeEach(() => { base = fs.mkdtempSync(path.join(os.tmpdir(), 'review-loop-')); seen = []; saved = []; });
afterEach(() => { fs.rmSync(base, { recursive: true, force: true }); });

/* ---------------------------------------------------------------------------------------------- */
/* 1. Intro protection                                                                              */
/* ---------------------------------------------------------------------------------------------- */

describe('intro protection', () => {
  it('locks everything before one explicit line, byte for byte', () => {
    const lock = makeIntroLock(SCRIPT, BODY_START, 'master.md', 1);
    expect(lock.text).toBe(INTRO);
    expect(lock.sha256).toBe(sha256(INTRO));
    expect(boundaryCandidates(SCRIPT).map(c => c.line)).toContain(BODY_START);
    expect(() => makeIntroLock(SCRIPT, '### ACT IX', 'master.md', 1)).toThrow(/not in/);
    expect(() => makeIntroLock(SCRIPT + `\n${BODY_START}\n`, BODY_START, 'master.md', 1)).toThrow(/appears 2 times/);
  });

  it('refuses a script whose intro differs, even by trailing whitespace', () => {
    const lock = makeIntroLock(SCRIPT, BODY_START, 'master.md', 1);
    expect(splitScript(SCRIPT, lock).ok).toBe(true);
    const tampered = SCRIPT.replace('This is the paper trail.   ', 'This is the paper trail.');
    const r = splitScript(tampered, lock);
    expect(r.ok).toBe(false);
    expect(reassemble({ ...lock, sha256: sha256('other') }, BODY).ok).toBe(false);
    const loop = makeLoop(() => ({}));
    loop.setIntroLock(PID, SCRIPT, BODY_START, 'master.md');
    expect(() => loop.createRun(PID, tampered)).toThrow(/does not match the locked intro/);
  });

  it('applies edits to the body only: an edit aimed at intro words is rejected and the intro stays exact', async () => {
    let revisions = 0;
    const loop = makeLoop((spec, req) => {
      if (req.schemaName === 'script_review') {
        const body = req.user.split(BODY_START)[2] ?? '';
        return body.includes('REV1') ? review(95) : review(80);
      }
      if (req.schemaName === 'body_revision') {
        revisions++;
        return { edits: [edit('This is the paper trail.', 'This was the paper trail.'), edit('sets things up for the listener today.', 'sets things up for the listener today. REV1')], resolutions: [], summary: 's' };
      }
      if (req.schemaName === 'source_check') return { claims: [] };
      return {};
    });
    const run = startRun(loop);
    await loop.runToEnd(run);
    const done = loop.getRun(PID, run.id)!;
    expect(done.status).toBe('complete');
    expect(revisions).toBe(1);
    const rev = done.rounds[0].revision!;
    expect(rev.rejected.some(r => r.find.includes('This is the paper trail'))).toBe(true);
    const finalText = loop.draftText(done, done.result!.hash);
    expect(finalText.startsWith(INTRO)).toBe(true);
    expect(finalText.slice(0, INTRO.length)).toBe(INTRO);
    expect(finalText).toContain('REV1');
    // The reviser saw the intro as context but the prompt marks it locked.
    const revisePrompt = seen.find(s => s.schemaName === 'body_revision')!;
    expect(revisePrompt.user).toContain('LOCKED INTRO (context only)');
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* 2. Identical, independent review inputs                                                          */
/* ---------------------------------------------------------------------------------------------- */

describe('independent reviews', () => {
  it('gives both reviewers the identical prompt, and never shows earlier reviews or scores', async () => {
    const loop = makeLoop((spec, req) => {
      if (req.schemaName === 'script_review') {
        if (req.user.includes('REV1')) return review(spec.startsWith('agy') ? 94 : 92);
        return spec.startsWith('agy') ? { ...review(71), summary: 'GEMINI-SECRET-OPINION' } : { ...review(88), summary: 'CHATGPT-SECRET-OPINION' };
      }
      if (req.schemaName === 'body_revision') return { edits: [edit('sets things up for the listener today.', 'sets things up for the listener today. REV1')], resolutions: [], summary: '' };
      if (req.schemaName === 'source_check') return { claims: [] };
      return {};
    });
    const run = startRun(loop);
    await loop.runToEnd(run);
    const reviews = seen.filter(s => s.schemaName === 'script_review');
    expect(reviews).toHaveLength(4);
    for (const [a, b] of [[reviews[0], reviews[1]], [reviews[2], reviews[3]]]) {
      expect(new Set([a.spec, b.spec]).size).toBe(2);
      expect(a.system).toBe(b.system);
      expect(a.user).toBe(b.user);
      expect(a.user).toContain('BRIEF: keep allegations');
      expect(a.user).toContain('SUPPORTING: timeline notes.');
    }
    // Round 2 prompts carry no trace of round 1's reviews or scores.
    for (const r of reviews.slice(2)) {
      expect(r.user).not.toMatch(/SECRET-OPINION|score 71|score 88|REVIEW 1/);
      expect(r.system).not.toMatch(/SECRET-OPINION/);
    }
    // Claude, by contrast, reads both reviews.
    const rev = seen.find(s => s.schemaName === 'body_revision')!;
    expect(rev.user).toContain('GEMINI-SECRET-OPINION');
    expect(rev.user).toContain('CHATGPT-SECRET-OPINION');
    expect(loop.getRun(PID, run.id)!.status).toBe('complete');
  });

  it('retries a rejected review once, telling only that reviewer what was wrong', async () => {
    let chatgptCalls = 0;
    const loop = makeLoop((spec, req) => {
      if (req.schemaName === 'script_review') {
        if (req.user.includes('REV1')) return review(95);
        if (spec === 'codex_cli') { chatgptCalls++; if (chatgptCalls === 1) return review(70, { blocker: 'words that are not in the script at all anywhere' }); }
        return review(80);
      }
      if (req.schemaName === 'body_revision') return { edits: [edit('sets things up for the listener today.', 'sets things up for the listener today. REV1')], resolutions: [], summary: '' };
      if (req.schemaName === 'source_check') return { claims: [] };
      return {};
    });
    const run = startRun(loop);
    await loop.runToEnd(run);
    const done = loop.getRun(PID, run.id)!;
    expect(done.status).toBe('complete');
    const first = seen.filter(x => x.schemaName === 'script_review').slice(0, 3);
    const retry = first.find(x => x.user.includes('YOUR PREVIOUS ANSWER COULD NOT BE ACCEPTED'))!;
    expect(retry.spec).toBe('codex_cli');
    const gemini = first.find(x => x.spec.startsWith('agy'))!;
    expect(gemini.user).not.toContain('YOUR PREVIOUS ANSWER');
    expect(done.rounds[0].reviews.chatgpt!.ok).toBe(true);
  });

  it('rejects a review that scores below 90 without naming a passage or missing connection', () => {
    const bad = { ...review(80), findings: [{ passage: '', missingConnection: '', problem: 'meh', effectOnListener: 'bored', proposedChange: '', criterion: 'pacing', blocker: false, structural: false, needsMaterial: '' }] };
    expect(parseReview(bad, 'gemini', { provider: 'p', model: 'm' }, 'h', INTRO, BODY).ok).toBe(false);
    const blockerNowhere = review(70, { blocker: 'words that are not in the script at all anywhere' });
    expect(parseReview(blockerNowhere, 'gemini', { provider: 'p', model: 'm' }, 'h', INTRO, BODY).ok).toBe(false);
    expect(parseReview(review(80), 'gemini', { provider: 'p', model: 'm' }, 'h', INTRO, BODY).ok).toBe(true);
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* 3. Repeat on a failing score or a blocker                                                        */
/* ---------------------------------------------------------------------------------------------- */

describe('repeat until both pass', () => {
  it('keeps revising while one score is below 90 or a blocker remains, and never delivers the unrevised draft', async () => {
    const loop = makeLoop((spec, req) => {
      if (req.schemaName === 'script_review') {
        const u = req.user;
        if (u.includes('REV3')) return review(spec.startsWith('agy') ? 91 : 90);
        if (u.includes('REV2')) return spec.startsWith('agy') ? review(96) : review(89);           // one reviewer below 90
        if (u.includes('REV1')) return spec.startsWith('agy') ? review(95) : review(95, { blocker: 'The second scene carries on with more detail' }); // high score, but a blocker
        return review(93);                                                                          // diagnostic: passes, but it is the unrevised draft
      }
      if (req.schemaName === 'body_revision') {
        const u = req.user;
        const tag = u.includes('REV2') ? 'REV3' : u.includes('REV1') ? 'REV2' : 'REV1';
        return { edits: [edit('points back to the opening question.', `points back to the opening question. ${tag}`)], resolutions: [], summary: tag };
      }
      if (req.schemaName === 'source_check') return { claims: [] };
      return {};
    });
    const run = startRun(loop);
    await loop.runToEnd(run);
    const done = loop.getRun(PID, run.id)!;
    expect(done.status).toBe('complete');
    expect(done.rounds.map(r => r.passed)).toEqual([true, false, false, true]);
    expect(done.rounds[1].passBlockers.join(' ')).toMatch(/blocker/);
    expect(done.rounds[2].passBlockers.join(' ')).toMatch(/chatgpt scored 89/);
    expect(loop.draftText(done, done.result!.hash)).toContain('REV3');
    expect(done.result!.label).toMatch(/COMPLETE: Gemini 91, ChatGPT 90/);
    expect(saved).toHaveLength(1);
  });

  it('treats a failed review as incomplete, never as a pass', () => {
    const r = passProblems({ gemini: { ok: true, review: { ...(parseReview(review(97), 'gemini', { provider: 'p', model: 'm' }, 'h', INTRO, BODY) as any).review } }, chatgpt: { ok: false, reviewer: 'chatgpt', code: 'TIMEOUT', message: 'slow' } }, 'h');
    expect(r).toEqual(['chatgpt review failed (TIMEOUT)']);
    expect(passProblems({ gemini: (parseReview(review(97), 'gemini', { provider: 'p', model: 'm' }, 'h', INTRO, BODY) as any) }, 'h')).toContain('chatgpt review is missing');
  });

  it('changes tactic after three unsuccessful rounds and calls Mercury only for a persistent structural problem', async () => {
    let n = 0;
    const loop = makeLoop((spec, req) => {
      if (req.schemaName === 'script_review') {
        if (req.user.includes('REV5')) return review(92);
        return review(80, { structural: 'The second scene carries on with more detail' });
      }
      if (req.schemaName === 'body_revision') { n++; return { edits: [edit('points back to the opening question.', `points back to the opening question. REV${n}`)], resolutions: [], summary: '' }; }
      if (req.schemaName === 'scene_orders') return { options: [{ order: ['### EPILOGUE', '### ACT I — SCENE 2: NEXT'], rationale: 'r', risk: 'x' }] };
      if (req.schemaName === 'source_check') return { claims: [] };
      return {};
    });
    const run = startRun(loop);
    await loop.runToEnd(run);
    const done = loop.getRun(PID, run.id)!;
    expect(done.status).toBe('complete');
    const revs = seen.filter(s => s.schemaName === 'body_revision');
    // Round 1 is diagnostic; rounds 2-4 are three unsuccessful revised drafts, so revision 4 uses a new tactic.
    expect(revs[3].user).toContain(TACTICS[0].text.slice(0, 40));
    expect(revs[2].user).not.toContain(TACTICS[0].text.slice(0, 40));
    const mercury = seen.filter(s => s.schemaName === 'scene_orders');
    expect(mercury.length).toBeGreaterThan(0);
    expect(mercury.length).toBeLessThan(revs.length); // on demand, not every round
    expect(seen.findIndex(s => s.schemaName === 'scene_orders')).toBeGreaterThan(seen.findIndex(s => s.schemaName === 'body_revision')); // not in the first round
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* 4. An edit after a pass invalidates it                                                           */
/* ---------------------------------------------------------------------------------------------- */

describe('approval is invalidated by any edit', () => {
  it('sends a source-check fix back through both reviews before delivery', async () => {
    const loop = makeLoop((spec, req) => {
      if (req.schemaName === 'script_review') return req.user.includes('REV') ? review(94) : review(85);
      if (req.schemaName === 'body_revision') {
        if (req.user.includes('SOURCE CHECK PROBLEMS')) return { edits: [edit('"She told everyone a story nobody can find anywhere."', '"Sav said I only went to her because I thought she could help me with my family." REV-FIX')], resolutions: [], summary: 'fix' };
        return { edits: [edit('The second scene carries on with more detail for the listener to follow along.', 'The second scene carries on with more detail for the listener to follow along.\n\n**SAV:** "She told everyone a story nobody can find anywhere." REV1')], resolutions: [], summary: '' };
      }
      if (req.schemaName === 'source_check') return { claims: [{ index: 0, claim: 'c', label: 'supported', note: '' }] };
      return {};
    });
    const run = startRun(loop);
    await loop.runToEnd(run);
    const done = loop.getRun(PID, run.id)!;
    expect(done.status).toBe('complete');
    // Round 2 passed both reviews but failed the source check; its fix became a new draft that was reviewed again.
    expect(done.rounds[1].passed).toBe(true);
    expect(done.rounds[1].finalCheck!.ok).toBe(false);
    expect(done.rounds[1].finalCheck!.issues.join(' ')).toMatch(/Quote not found/);
    expect(done.rounds[2].draftHash).not.toBe(done.rounds[1].draftHash);
    expect(done.rounds[2].reviews.gemini?.ok && done.rounds[2].reviews.chatgpt?.ok).toBe(true);
    expect(done.result!.hash).toBe(done.rounds[2].draftHash);
    const finalText = loop.draftText(done, done.result!.hash);
    expect(finalText).toContain('REV-FIX');
    expect(finalText).not.toContain('nobody can find anywhere');
    expect(done.rounds[2].finalCheck!.quotes.find(q => q.status === 'verified')?.ref).toBe('passage:new');
  });

  it('keeps the old passage when both blind comparisons prefer it over a major rewrite', async () => {
    const big = 'A completely rewritten scene. '.repeat(30);
    const loop = makeLoop((spec, req) => {
      if (req.schemaName === 'script_review') return req.user.includes('SMALL-FIX') ? review(95) : review(82);
      if (req.schemaName === 'body_revision') return { edits: [edit('The second scene carries on with more detail for the listener to follow along.', big), edit('sets things up for the listener today.', 'sets things up for the listener today. SMALL-FIX')], resolutions: [], summary: '' };
      if (req.schemaName === 'blind_compare') {
        // random() = 0.9 -> no flip: A is the old passage, B the rewrite. Both prefer A (old).
        return { pairs: [{ pair: 1, stronger: 'A', confidence: 'clear', reason: 'tighter' }] };
      }
      if (req.schemaName === 'source_check') return { claims: [] };
      return {};
    });
    const run = startRun(loop);
    await loop.runToEnd(run);
    const done = loop.getRun(PID, run.id)!;
    expect(done.rounds[0].revision!.major).toEqual([{ pair: 1, kept: 'old', votes: ['old', 'old'] }]);
    const text = loop.draftText(done, done.result!.hash);
    expect(text).not.toContain('A completely rewritten scene.');
    expect(text).toContain('SMALL-FIX');
    const compares = seen.filter(s => s.schemaName === 'blind_compare');
    expect(compares).toHaveLength(2);
    expect(compares[0].user).toBe(compares[1].user);
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* 5. Spending limit                                                                                */
/* ---------------------------------------------------------------------------------------------- */

describe('spending limit', () => {
  it('stops at the call limit, saves the strongest draft and labels it unfinished', async () => {
    let n = 0;
    const loop = makeLoop((spec, req) => {
      if (req.schemaName === 'script_review') {
        if (req.user.includes('REV1') && !req.user.includes('REV2')) return review(88); // the strongest draft
        return req.user.includes('REV') ? review(70) : review(75);
      }
      if (req.schemaName === 'body_revision') { n++; return { edits: [edit('points back to the opening question.', `points back to the opening question. REV${n}`)], resolutions: [], summary: '' }; }
      return {};
    });
    const run = startRun(loop, { maxCalls: 8 });
    await loop.runToEnd(run);
    const done = loop.getRun(PID, run.id)!;
    expect(done.status).toBe('unfinished');
    expect(done.stopReason).toBe('spending_limit');
    expect(done.calls).toBeLessThanOrEqual(8);
    // Every call is tallied with the tokens the service reported.
    const tally = Object.values(done.usage || {});
    expect(tally.reduce((a, u) => a + u.calls, 0)).toBe(done.calls);
    expect(tally.reduce((a, u) => a + u.inTok, 0)).toBe(done.calls);
    expect(done.threshold).toBe(90);
    const best = loop.draftText(done, done.result!.hash);
    expect(best).toContain('REV1');
    expect(best).not.toContain('REV2');
    expect(done.result!.file).toMatch(/FINAL-UNFINISHED\.md$/);
    expect(fs.readFileSync(done.result!.file, 'utf8')).toBe(best);
    expect(saved[0].label).toMatch(/UNFINISHED \(spending_limit\)/);
    expect(saved[0].label).not.toMatch(/COMPLETE/);
  });

  it('stops at the dollar limit for paid models and can be resumed without lowering the bar', async () => {
    let n = 0;
    const loop = makeLoop((spec, req) => {
      if (req.schemaName === 'script_review') return review(80, { structural: 'The second scene carries on with more detail' });
      if (req.schemaName === 'body_revision') { n++; return { edits: [edit('points back to the opening question.', `points back to the opening question. REV${n}`)], resolutions: [], summary: '' }; }
      if (req.schemaName === 'scene_orders') return { options: [] };
      return {};
    });
    const run = startRun(loop, { maxUsd: 0.005 });
    await loop.runToEnd(run);
    const done = loop.getRun(PID, run.id)!;
    expect(done.status).toBe('unfinished');
    expect(done.stopReason).toBe('spending_limit');
    expect(done.message).toMatch(/\$0\.01 spending limit|spending limit/);
    const resumed = loop.resume(PID, run.id, { maxUsd: 0.5, maxCalls: 12 });
    expect(resumed.status).toBe('running');
    expect(resumed.threshold).toBe(90);
    expect(() => loop.resume(PID, run.id)).toThrow(/Only an unfinished run/);
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Helpers and the Gemini adapter                                                                   */
/* ---------------------------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------------------------- */
/* 6. Who rewrites: ChatGPT 6.2 (high) for full rewrites, Claude Pro only for targeted fixes        */
/* ---------------------------------------------------------------------------------------------- */

describe('Claude Pro only for targeted fixes', () => {
  const claudeCalls = () => seen.filter(x => x.spec.startsWith('claude_cli'));

  it('defaults to ChatGPT gpt-6.2-sol at high effort for full rewrites and Claude only for targeted fixes', () => {
    expect(DEFAULT_CONFIG.reviser).toBe('codex_cli:gpt-6.2-sol:high');
    expect(DEFAULT_CONFIG.targetedReviser).toBe('claude_cli:sonnet');
    expect(DEFAULT_CONFIG.reviewers.chatgpt).toBe('codex_cli');
    expect(parseRoleSpec('codex_cli:gpt-6.2-sol:high')).toEqual({ provider: 'codex_cli', model: 'gpt-6.2-sol', effort: 'high' });
    expect(parseRoleSpec('codex_cli:gpt-6.2-sol:bogus')).toBeNull();
    expect(codexArgs('/s', '/o', 'gpt-6.2-sol', 'high')).toEqual(['exec', '-', '-m', 'gpt-6.2-sol', '-c', 'model_reasoning_effort="high"', '--output-schema', '/s', '-o', '/o', '--json', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config']);
    const reg = createProviderRegistry({ env: () => ({}) } as any);
    expect(reg.adapterFor('codex_cli:gpt-6.2-sol:high', { maxUsd: 0, spentUsd: 0 })!.model).toBe('gpt-6.2-sol');
  });

  it('sends Claude only the paragraphs around a local problem, never the intro or the whole script', async () => {
    const loop = makeLoop((spec, req) => {
      if (req.schemaName === 'script_review') return req.user.includes('REV1') ? review(spec.startsWith('agy') ? 94 : 92) : review(80);
      if (req.schemaName === 'body_revision') return { edits: [edit('sets things up for the listener today.', 'sets things up for the listener today. REV1'), edit('The ending closes the story for now and points back to the opening question.', 'Out of reach. REV-OUTSIDE')], resolutions: [], summary: '' };
      if (req.schemaName === 'source_check') return { claims: [] };
      return {};
    });
    const run = loop.createRun(PID, SCRIPT, (loop.setIntroLock(PID, SCRIPT, BODY_START, 'master.md'), { file: 'master.md', maxCalls: 40, maxUsd: 1, maxRounds: 12 }));
    await loop.runToEnd(run);
    const done = loop.getRun(PID, run.id)!;
    expect(done.status).toBe('complete');
    const rev = done.rounds[0].revision!;
    expect(rev.mode).toBe('targeted');
    expect(rev.by).toBe('claude_cli:sonnet');
    expect(rev.rejected.map(r => r.reason)).toContain('outside the passages sent for a targeted fix');
    const sent = claudeCalls();
    expect(sent).toHaveLength(1);
    expect(sent[0].user).toContain('sets things up for the listener today.');
    expect(sent[0].user).not.toContain('The ending closes the story');      // a paragraph far from the problem
    expect(sent[0].user).not.toContain('This is the paper trail.');         // the locked intro
    expect(sent[0].user).not.toContain('SUPPORTING: timeline notes.');      // supporting text stays out
    expect(sent[0].user).not.toContain('<<<BODY');
    const text = loop.draftText(done, done.result!.hash);
    expect(text).toContain('REV1');
    expect(text).not.toContain('REV-OUTSIDE');
    expect(text.startsWith(INTRO)).toBe(true);
    // No full rewrite was needed.
    expect(seen.some(x => x.spec === DEFAULT_CONFIG.reviser && x.schemaName === 'body_revision')).toBe(false);
  });

  it('uses a ChatGPT full rewrite for a structural problem, and Claude never sees it', async () => {
    const loop = makeLoop((spec, req) => {
      if (req.schemaName === 'script_review') return req.user.includes('REV1') ? review(95) : review(80, { structural: 'The second scene carries on with more detail' });
      if (req.schemaName === 'body_revision') return { edits: [edit('points back to the opening question.', 'points back to the opening question. REV1')], resolutions: [], summary: '' };
      if (req.schemaName === 'source_check') return { claims: [] };
      return {};
    });
    loop.setIntroLock(PID, SCRIPT, BODY_START, 'master.md');
    const run = loop.createRun(PID, SCRIPT, { file: 'master.md', maxCalls: 40, maxUsd: 1, maxRounds: 12 });
    await loop.runToEnd(run);
    const done = loop.getRun(PID, run.id)!;
    expect(done.status).toBe('complete');
    expect(done.rounds[0].revision!.mode).toBe('full');
    expect(done.rounds[0].revision!.by).toBe('codex_cli:gpt-6.2-sol:high');
    const full = seen.find(x => x.schemaName === 'body_revision')!;
    expect(full.spec).toBe('codex_cli:gpt-6.2-sol:high');
    expect(full.user).toContain('<<<BODY');
    expect(claudeCalls()).toHaveLength(0);
  });

  it('falls back to a ChatGPT rewrite when Claude is out of usage, instead of stopping', async () => {
    const loop = makeLoop((spec, req) => {
      if (req.schemaName === 'script_review') return req.user.includes('REV1') ? review(95) : review(80);
      if (req.schemaName === 'body_revision') {
        if (spec.startsWith('claude_cli')) return { ok: false, code: 'USAGE_LIMIT', message: 'Claude usage limit reached', rawOutput: '', durationMs: 1, provider: 'claude_cli', model: spec };
        return { edits: [edit('sets things up for the listener today.', 'sets things up for the listener today. REV1')], resolutions: [], summary: '' };
      }
      if (req.schemaName === 'source_check') return { claims: [] };
      return {};
    });
    loop.setIntroLock(PID, SCRIPT, BODY_START, 'master.md');
    const run = loop.createRun(PID, SCRIPT, { file: 'master.md', maxCalls: 40, maxUsd: 1, maxRounds: 12 });
    await loop.runToEnd(run);
    const done = loop.getRun(PID, run.id)!;
    expect(done.status).toBe('complete');
    const rev = done.rounds[0].revision!;
    expect(rev.note).toMatch(/Targeted fix unavailable \(USAGE_LIMIT\)/);
    expect(rev.by).toBe('codex_cli:gpt-6.2-sol:high');
    expect(loop.draftText(done, done.result!.hash)).toContain('REV1');
  });

  it('cuts excerpts to the paragraphs around each passage', () => {
    const body = ['P0 heading', 'P1 alpha words here', 'P2 beta words here', 'P3 gamma words here', 'P4 delta words here', 'P5 epsilon words here', 'P6 zeta words here'].join('\n\n');
    const r = passageExcerpts(body, ['beta words', 'zeta words', 'not in the body at all']);
    expect(r.missing).toEqual(['not in the body at all']);
    expect(r.excerpts.map(e => e.text)).toEqual([
      ['P1 alpha words here', 'P2 beta words here', 'P3 gamma words here'].join('\n\n'),
      ['P5 epsilon words here', 'P6 zeta words here'].join('\n\n'),
    ]);
  });
});

describe('helpers', () => {
  it('applies whitespace- and quote-tolerant edits that match exactly once', () => {
    const r = applyBodyEdits(BODY, [edit('The original first   scene sentence', 'X'), edit('for the listener', 'Y'), edit('nowhere to be found here', 'Z')]);
    expect(r.applied).toHaveLength(1);
    expect(r.rejected.map(x => x.reason)).toEqual(['matches 2 places', 'not found in the body']);
  });
  it('finds quotes and checks them against source text', () => {
    expect(extractQuotes('**ANGELA:** "I keep everything that anybody ever sends me in private."')).toEqual([{ quote: 'I keep everything that anybody ever sends me in private.', speaker: 'ANGELA' }]);
    expect(quoteInText('I keep everything ... sends me in private', SOURCES[0].text)).toBe(true);
    expect(quoteInText('I delete everything', SOURCES[0].text)).toBe(false);
  });
});

describe('Gemini (agy) long prompts', () => {
  it('passes a long prompt through a per-call prompt file instead of the command line', async () => {
    const io = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-io-'));
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-sb-'));
    let captured: { args: string[]; cwd: string; prompt: string } | null = null;
    const registry = createProviderRegistry({
      env: () => ({}),
      dirs: { io, sandbox },
      resolveOverride: async () => ({ ok: true, file: 'agy', prefixArgs: [], via: 'path', found: 'agy' }),
      runner: async (_file: string, args: string[], opts: { cwd: string }) => {
        const pf = path.join(opts.cwd, 'prompt.md');
        captured = { args, cwd: opts.cwd, prompt: fs.existsSync(pf) ? fs.readFileSync(pf, 'utf8') : '' };
        return { code: 0, stdout: JSON.stringify({ structured_output: { ok: true }, usage: {} }), stderr: '', timedOut: false, aborted: false };
      },
    } as any);
    const a = registry.adapterFor('agy_cli:gemini-3.8-flash-high', { maxUsd: 0, spentUsd: 0 })!;
    const user = 'x'.repeat(AGY_INLINE_PROMPT_MAX + 10);
    const r = await a.complete({ role: 'critic', system: 'SYS', user, schema: {}, schemaName: 's', maxTokens: 10, timeoutMs: 1000, signal: new AbortController().signal });
    expect(r.ok).toBe(true);
    expect(captured!.args[captured!.args.indexOf('-p') + 1]).toBe(AGY_FILE_INSTRUCTION);
    expect(captured!.prompt).toBe(`SYS\n\n${user}`);
    expect(captured!.cwd).not.toBe(sandbox);
    expect(fs.existsSync(captured!.cwd)).toBe(false); // cleaned up after the call
    expect(agyArgs('s.json')).not.toContain('--dangerously-skip-permissions');
    fs.rmSync(io, { recursive: true, force: true });
    fs.rmSync(sandbox, { recursive: true, force: true });
  });
});
