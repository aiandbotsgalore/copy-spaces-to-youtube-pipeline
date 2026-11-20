/**
 * Prompts and schemas for the THE PAPER TRAIL review loop (server/scriptReviewLoop.ts).
 * Text only: the models read and write manuscript text, never audio.
 */
import type { Prompt } from './scriptPrompts';

type S = Record<string, unknown>;
const str: S = { type: 'string' };
const int: S = { type: 'integer' };
const bool: S = { type: 'boolean' };
const strArr: S = { type: 'array', items: str };
const obj = (props: Record<string, S>): S => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });
const arr = (items: S): S => ({ type: 'array', items });
const en = (values: readonly string[]): S => ({ type: 'string', enum: [...values] });

export const REVIEW_PROMPT_VERSIONS = {
  review: 'review-loop.review.v1',
  revise: 'review-loop.revise.v1',
  targeted: 'review-loop.targeted.v1',
  compare: 'review-loop.compare.v1',
  structure: 'review-loop.structure.v1',
  factcheck: 'review-loop.factcheck.v1',
} as const;

export const CRITERIA = ['story_clarity', 'pacing', 'character_portrayal', 'narration', 'transitions', 'inference_support'] as const;
export type Criterion = typeof CRITERIA[number];

const CRITERIA_TEXT = `Judge every draft on the same criteria:
- story_clarity: can a listener follow what happened, to whom, and why it matters, in the order it is told?
- pacing: does each scene earn its time; is anything repeated after the listener already understood it; do the strongest moments get room?
- character_portrayal: is every person portrayed fairly and accurately; are allegations kept distinct from established fact?
- narration: does it sound like Logan speaking (conversational, plain, specific), not AI-sounding, not melodramatic, not over-narrating the archival audio?
- transitions: does each scene hand off to the next so the listener knows where they are and why they moved?
- inference_support: does the writing support what it leads the listener to infer? A confusing reveal, a misleading edit or juxtaposition, or an implication the sources do not support is a blocker even in an otherwise excellent draft.`;

const PRODUCTION = `THE PAPER TRAIL is one single audio investigative documentary (not a series, not episodes), narrated by Logan Black, built from recorded X Spaces audio, direct messages, screenshots, transcripts and timeline notes. It should feel like an unfolding investigation told in Logan's own conversational voice. The finished piece is audio only: narration, recorded voices, and music or sound design where they serve a scene. Written messages are read aloud and identified as messages.`;

/* ---------------------------------------------------------------------------------------------- */
/* Independent review                                                                              */
/* ---------------------------------------------------------------------------------------------- */

export const REVIEW_SCHEMA = obj({
  score: int,
  summary: str,
  works: arr(obj({ passage: str, why: str })),
  findings: arr(obj({
    passage: str,
    missingConnection: str,
    problem: str,
    effectOnListener: str,
    proposedChange: str,
    criterion: en(CRITERIA),
    blocker: bool,
    structural: bool,
    needsMaterial: str,
  })),
  ending: obj({ verdict: en(['answers', 'explains_why_open', 'fails']), openingQuestions: strArr, note: str }),
});

export interface ReviewInputs { script: string; bodyStart: string; brief: string; supporting: string }

/**
 * One review prompt. Both reviewers get this exact object, built once per draft: same script, same supporting
 * text, same brief, and nothing about the other reviewer or any earlier round.
 */
export function reviewPrompt(x: ReviewInputs): Prompt {
  return {
    version: REVIEW_PROMPT_VERSIONS.review, schemaName: 'script_review', schema: REVIEW_SCHEMA, maxTokens: 6000,
    system: `You are an independent senior story editor reviewing a complete script draft. Work alone: you are not told what any other reviewer thinks, and you must not guess.
${PRODUCTION}

The script opens with an INTRO that is locked: Logan approved it word for word. Never propose changes to it. Read it as context, and use it to test the ending: does the ending answer the questions the opening raises, or make clear why they remain open? Direct every proposed edit to the BODY (everything after the intro).

${CRITERIA_TEXT}

Say what works (so it is preserved), what falls flat, and what you would change.
Scoring: score the whole script from 0 to 100. 90 or more means it is ready to record as a whole and nothing must be fixed first. Do not inflate: a draft with a blocker cannot be 90 or more.
Findings:
- blocker = true only for a problem that must be fixed before delivery (misleading inference, unsupported or wrong fact or attribution, confusing reveal, unfair portrayal, broken continuity).
- Every blocker, and when the score is below 90 every finding behind the deduction, must identify where: copy the exact passage from the body (5 to 40 consecutive words, verbatim) in "passage", or, if the problem is something missing, leave "passage" empty and describe the missing connection in "missingConnection". Then explain its effect on the listener in "effectOnListener".
- structural = true when the fix is about scene order or where something is revealed, not wording.
- needsMaterial: if the draft needs better source material (a clip, message or fact it does not have), describe what to search for; otherwise empty.
- Use "" for any field that does not apply.
Ending: verdict "answers", "explains_why_open" or "fails", with the questions the opening raises.`,
    user: `EDITORIAL BRIEF (Logan's standing rules for this production)\n${x.brief || '(none)'}\n\nSUPPORTING TEXT (source material and notes; context only)\n${x.supporting || '(none)'}\n\nTHE SCRIPT. Everything before the line "${x.bodyStart}" is the locked intro; the body starts at that line.\n<<<SCRIPT\n${x.script}\nSCRIPT>>>`,
  };
}

/* ---------------------------------------------------------------------------------------------- */
/* Claude's revision of the body                                                                    */
/* ---------------------------------------------------------------------------------------------- */

export const REVISE_SCHEMA = obj({
  edits: arr(obj({ find: str, replace: str, why: str })),
  resolutions: arr(obj({ finding: str, decision: en(['fixed', 'declined']), reason: str })),
  summary: str,
});

export function revisePrompt(x: {
  intro: string; body: string; brief: string; supporting: string; reviews: string; tactic: string;
  structureOptions?: string; material?: string; sourceIssues?: string; rejectedEdits?: string;
}): Prompt {
  return {
    version: REVIEW_PROMPT_VERSIONS.revise, schemaName: 'body_revision', schema: REVISE_SCHEMA, maxTokens: 16000,
    system: `You revise the BODY of a script for THE PAPER TRAIL. ${PRODUCTION}

Two editors reviewed the same draft independently. Read both reviews, resolve where they disagree (decide, and say why), and revise the body so the next draft fixes every blocker and the problems that cost points, while preserving the passages that already work. Do not rewrite what works just to change it.

The INTRO is locked and approved word for word. It is given only as context. You cannot edit it: your edits apply to the body only.

${CRITERIA_TEXT}

Rules:
- Return edits as find/replace pairs on the BODY. "find" must be copied exactly from the body (whole sentences or paragraphs, at least 8 words) and must appear there exactly once. "replace" is the new text. Use "" in replace to cut.
- Keep the manuscript's existing formatting conventions (scene headings, **NAME:** quotes, [CLIP ...] and [NON-SPOKEN PRODUCTION NOTE ...] lines, --- separators).
- Never invent quotes, attributions, dates or facts. Quotes must stay word for word from the sources; if you need material the script does not have, use only what is in the supporting text or the material provided below.
- Keep allegations clearly distinct from established fact.
- Write narration in Logan's plain, conversational voice. No melodrama, no AI-sounding phrasing.
- For every finding you were given, add a resolution: fixed or declined, with the reason.`,
    user: [
      `TACTIC FOR THIS ROUND\n${x.tactic}`,
      x.sourceIssues ? `SOURCE CHECK PROBLEMS (fix these; a quote or claim that cannot be supported must be corrected or removed)\n${x.sourceIssues}` : '',
      x.rejectedEdits ? `EDITS FROM LAST ROUND THAT COULD NOT BE APPLIED (their "find" text was not unique or not in the body)\n${x.rejectedEdits}` : '',
      x.structureOptions ? `ALTERNATIVE SCENE ORDERS TO CONSIDER (from a structure pass; adopt one only if it fixes the problem)\n${x.structureOptions}` : '',
      x.material ? `ADDITIONAL SOURCE MATERIAL FOUND FOR THIS ROUND (verbatim excerpts; cite only these words)\n${x.material}` : '',
      `THE TWO REVIEWS\n${x.reviews}`,
      `EDITORIAL BRIEF\n${x.brief || '(none)'}`,
      `SUPPORTING TEXT\n${x.supporting || '(none)'}`,
      `LOCKED INTRO (context only)\n<<<INTRO\n${x.intro}\nINTRO>>>`,
      `BODY (edit this)\n<<<BODY\n${x.body}\nBODY>>>`,
    ].filter(Boolean).join('\n\n'),
  };
}

/* ---------------------------------------------------------------------------------------------- */
/* Targeted fix: only the paragraphs involved, never the whole script                               */
/* ---------------------------------------------------------------------------------------------- */

export function targetedRevisePrompt(x: {
  brief: string; reviews: string; tactic: string; excerpts: { scene: string; text: string }[];
  sourceIssues?: string; rejectedEdits?: string;
}): Prompt {
  return {
    version: REVIEW_PROMPT_VERSIONS.targeted, schemaName: 'body_revision', schema: REVISE_SCHEMA, maxTokens: 6000,
    system: `You make small, targeted fixes to the BODY of a script for THE PAPER TRAIL. ${PRODUCTION}

Two editors reviewed the whole script independently. Every problem they found sits in the excerpts below, so you are given only those excerpts, not the whole script. Fix the problems in place and leave everything that works alone.

${CRITERIA_TEXT}

Rules:
- Edit only text inside the excerpts. Return find/replace pairs: "find" must be copied exactly from one excerpt (whole sentences, at least 8 words) so it is unique in the script. "replace" is the new text. Use "" in replace to cut.
- You cannot see the rest of the script, so do not refer to, move, or depend on anything outside the excerpts.
- Keep the manuscript's formatting conventions (scene headings, **NAME:** quotes, [CLIP ...] lines, --- separators).
- Never invent quotes, attributions, dates or facts. Quotes stay word for word. If a quote or claim cannot be supported, correct or remove it.
- Keep allegations clearly distinct from established fact.
- Write narration in Logan's plain, conversational voice. No melodrama, no AI-sounding phrasing.
- For every finding you were given, add a resolution: fixed or declined, with the reason.`,
    user: [
      `TACTIC FOR THIS ROUND\n${x.tactic}`,
      x.sourceIssues ? `SOURCE CHECK PROBLEMS (fix these; a quote or claim that cannot be supported must be corrected or removed)\n${x.sourceIssues}` : '',
      x.rejectedEdits ? `EDITS FROM LAST ROUND THAT COULD NOT BE APPLIED\n${x.rejectedEdits}` : '',
      `THE TWO REVIEWS\n${x.reviews}`,
      `EDITORIAL BRIEF\n${x.brief || '(none)'}`,
      ...x.excerpts.map((e, i) => `EXCERPT ${i + 1} (scene: ${e.scene})\n<<<EXCERPT\n${e.text}\nEXCERPT>>>`),
    ].filter(Boolean).join('\n\n'),
  };
}

/* ---------------------------------------------------------------------------------------------- */
/* Blind comparison of a major rewrite                                                              */
/* ---------------------------------------------------------------------------------------------- */

export const COMPARE_SCHEMA = obj({ pairs: arr(obj({ pair: int, stronger: en(['A', 'B']), confidence: en(['clear', 'slight']), reason: str })) });

export function comparePrompt(pairs: { pair: number; before: string; a: string; b: string; after: string }[], brief: string): Prompt {
  return {
    version: REVIEW_PROMPT_VERSIONS.compare, schemaName: 'blind_compare', schema: COMPARE_SCHEMA, maxTokens: 3000,
    system: `You compare two versions of the same passage of a script for THE PAPER TRAIL, blind. ${PRODUCTION}
For each pair you get the text just before the passage, version A, version B, and the text just after. Read each version in place, as a listener would hear it. Choose the stronger version on story clarity, pacing, character portrayal, narration, transitions and whether the writing supports what it leads the listener to infer. You are not told which version is newer. Answer for every pair.`,
    user: `EDITORIAL BRIEF\n${brief || '(none)'}\n\n${pairs.map(p => `PAIR ${p.pair}\n[TEXT BEFORE]\n${p.before}\n[VERSION A]\n${p.a}\n[VERSION B]\n${p.b}\n[TEXT AFTER]\n${p.after}`).join('\n\n')}`,
  };
}

/* ---------------------------------------------------------------------------------------------- */
/* Mercury 3: alternative scene orders for a stretch with a persistent structural problem          */
/* ---------------------------------------------------------------------------------------------- */

export const STRUCTURE_SCHEMA = obj({ options: arr(obj({ order: strArr, rationale: str, risk: str })) });

export function structurePrompt(x: { problem: string; scenes: { heading: string; text: string }[] }): Prompt {
  return {
    version: REVIEW_PROMPT_VERSIONS.structure, schemaName: 'scene_orders', schema: STRUCTURE_SCHEMA, maxTokens: 2500,
    system: `You are a documentary story architect. ${PRODUCTION}
A structural problem has persisted through two revision rounds. Propose two or three different orders for the scenes given (use the exact headings), each with the reason it fixes the problem and the risk it introduces. The first scene heading in each order may change. Do not invent scenes; you may suggest that a reveal move between scenes in the rationale.`,
    user: `PERSISTENT PROBLEM\n${x.problem}\n\nSCENES IN CURRENT ORDER\n${x.scenes.map(s => `${s.heading}\n${s.text}`).join('\n\n')}`,
  };
}

/* ---------------------------------------------------------------------------------------------- */
/* Final source check of changed claims                                                             */
/* ---------------------------------------------------------------------------------------------- */

export const FACTCHECK_SCHEMA = obj({ claims: arr(obj({ index: int, claim: str, label: en(['supported', 'unsupported', 'contradicted', 'attribution_wrong']), note: str })) });

export function factcheckPrompt(items: { index: number; paragraph: string; sources: string }[]): Prompt {
  return {
    version: REVIEW_PROMPT_VERSIONS.factcheck, schemaName: 'source_check', schema: FACTCHECK_SCHEMA, maxTokens: 4000,
    system: `You check changed paragraphs of a documentary script against source text. For each paragraph, list its factual claims, quotes and attributions (who said or did what, when) and label each one: supported (the source text given says it), unsupported (the source text given does not say it), contradicted (the source text says otherwise) or attribution_wrong (the words or act are real but credited to the wrong person). Judge only against the source text provided, never from memory. Opinions clearly framed as Logan's own view are supported by definition; label them supported with the note "opinion". Keep the paragraph index.`,
    user: items.map(i => `PARAGRAPH ${i.index}\n${i.paragraph}\nSOURCE TEXT\n${i.sources || '(no source text found)'}`).join('\n\n'),
  };
}
