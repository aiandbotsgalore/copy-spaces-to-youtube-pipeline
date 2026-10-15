/**
 * Editorial profile for the AI Prompt Director.
 * Everything project-specific (archetypes, rules, banned language) lives here as DATA so the
 * system prompt is assembled, not hard-coded. Defaults follow ANGELA_EDITORIAL_CHARTER.md.
 */
import type { CutId } from './directorTypes';

export const DEFAULT_DIRECTOR_MODEL = 'claude-sonnet-5.5';
export const FALLBACK_DIRECTOR_MODEL = 'claude-sonnet-5';

export const DIRECTOR_CANDIDATE_CAP = 80;
export const DIRECTOR_TEXT_MAX_CHARS = 280;
export const DIRECTOR_MAX_OPS = 12;
export const DIRECTOR_TIMEOUT_MS = 90_000;
export const DIRECTOR_MAX_TOKENS = 4096;

export const GAP_MIN_SEC = 0.05;
export const GAP_MAX_SEC = 1.5;
export const NOTE_MAX_CHARS = 140;
export const RUNTIME_TOLERANCE = 0.1;
export const MIN_EFFECTIVE_AFTER_TRIM_SEC = 1.5;
export const MAX_AUTO_TRIM_FRACTION = 0.35;

export interface Archetype {
  id: CutId;
  title: string;
  archetype: 'chronological' | 'standards' | 'cold_open';
  lens: string;
  /** Optional hard clamp for the runtime target (seconds). */
  targetClampSec?: [number, number];
}

export const ARCHETYPES: Record<CutId, Archetype> = {
  cut_a: {
    id: 'cut_a',
    title: 'Chronological Record',
    archetype: 'chronological',
    lens:
      'Order the picks by sourceDate (earliest first), then by position within the same source. ' +
      'Follow the story spine where the material allows it: trust, method, ethical rules, reversal, archive, ' +
      'public accusation, escalation, contradiction. Describe what happens in time; draw no conclusions.',
  },
  cut_b: {
    id: 'cut_b',
    title: 'Her Own Standards',
    archetype: 'standards',
    lens:
      'Pair statements in which the speaker states a standard, rule or principle with later statements that can be ' +
      'compared against it. This is juxtaposition only: let the contrast register without asserting a conclusion. ' +
      'Alternate between a "stated standard" clip and a "later statement" clip.',
  },
  cut_c: {
    id: 'cut_c',
    title: 'Cold Open',
    archetype: 'cold_open',
    targetClampSec: [30, 60],
    lens:
      'A 30 to 60 second teaser of 4 to 7 clips: the strongest self-authored lines first. Every clip must make sense ' +
      'standing alone. A clip that is only intelligible with context that is not in the cut is disqualified. ' +
      'Reordering is allowed, but never so as to imply a sequence of events the recordings do not support.',
  },
};

export const CUT_IDS: CutId[] = ['cut_a', 'cut_b', 'cut_c'];

/** Words the Director must not use in its own voice (titles, taglines, notes). Quotes are exempt. */
export const BANNED_LANGUAGE: string[] = [
  'liar', 'lying', 'lied', 'predator', 'pedophile', 'abuser', 'monster', 'guilty', 'destroy', 'destroys', 'destroyed',
  'shocking', 'bombshell', 'explosive', 'scorched earth', 'smoking gun', 'damning', 'devastating', 'villain',
  'hostile', 'weaponized', 'manufactured', 'forensic verdict', 'cover-up', 'coverup', 'confession', 'confesses',
];

const bannedRegex = new RegExp(
  '\\b(' + BANNED_LANGUAGE.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')).join('|') + ')\\b',
  'i'
);

/** Returns the first banned word found in `text`, or null. */
export function findBannedLanguage(text: string): string | null {
  const m = bannedRegex.exec(text || '');
  return m ? m[1].toLowerCase().replace(/\s+/g, ' ') : null;
}

/** Runtime target for a cut, applying the archetype clamp (Cold Open is always 30-60 s). */
export function targetForCut(cutId: CutId, requestedSec: number): number {
  const clamp = ARCHETYPES[cutId].targetClampSec;
  const t = Number.isFinite(requestedSec) && requestedSec > 0 ? requestedSec : 90;
  return clamp ? Math.min(clamp[1], Math.max(clamp[0], t)) : t;
}

export const SHARED_RULES = `You are the Director: an editorial assistant that assembles audio montages from archived recordings.
You work ONLY with the JSON you are given. You never hear audio and you never see timestamps.

RULES
1. Choose only from "candidates". Never invent a clipId. Use each clip at most once.
2. Verbatim integrity. You may reorder, drop, and optionally trim a leading or trailing filler or lead-in. NEVER trim so that a negation, qualifier, condition or attribution is lost, or a statement is separated from who it is about. If unsure, do not trim (set keptText to null). When you do trim, keptText must be an exact contiguous excerpt of the candidate "text".
3. Language. "note" is at most 18 words, descriptive and evidentiary (for example: "Speaker states the rule she says she applies to others"). Titles, taglines and notes are neutral. No verdict words, no characterising anyone in your own voice, no true-crime cliches, no emoji. Allegations remain allegations.
4. Ping-pong. With two or more speakers, avoid more than 2 consecutive clips from one speaker unless it is a deliberate monologue. With a single-speaker pool, alternate between a "stated standard" and a "later statement" instead.
5. Gaps (gapAfterSec): 0.1 to 0.2 for rapid rebuttal, 0.35 standard, 0.6 to 0.9 after a significant admission or before a contrasting statement (a pause after an important statement carries weight). The last pick has gapAfterSec 0.
6. tensionScore is an integer 1 to 10: pacing intensity, relative within the cut. Shape an arc; do not flat-line; do not open at 8 or above unless this is the Cold Open.
7. Runtime. Estimate total = sum of clip durationSec (shorter if you trim) + sum of gaps. Stay within +/-10% of targetWindowSec. Do not output durations.
8. The user prompt sets subject and runtime; your cut's lens sets the editorial approach.
9. Output a single JSON object and nothing else: no prose, no markdown fences.`;

export const GENERATE_OUTPUT_SPEC = `OUTPUT (generate): {"cutId": string, "title": string, "tagline": string, "picks": [{"clipId": string, "keptText": string|null, "gapAfterSec": number, "tensionScore": integer, "note": string}]}
"title" is a short descriptive name for the cut; "tagline" is one neutral sentence describing what the cut does.`;

export const REFINE_OUTPUT_SPEC = `OUTPUT (refine): {"summary": string, "ops": [{"op": "drop"|"move"|"trim"|"setGap"|"insert"|"replace"|"setNote", "clipId": string, "toIndex": integer|null, "keptText": string|null, "gapAfterSec": number|null, "atIndex": integer|null, "withClipId": string|null, "note": string|null}]}
You are editing the CURRENT timeline surgically. Change only what the instruction asks; leave other clips untouched, and do not add compensating or "while I am here" edits. At most ${DIRECTOR_MAX_OPS} ops.
- drop: remove clipId (a current clip).  - move: move clipId to zero-based position toIndex in the resulting list.
- trim: keptText is the exact excerpt of that clip's text to keep.  - setGap: set gapAfterSec for clipId.
- insert: add candidate clipId at zero-based position atIndex (optionally gapAfterSec, note).  - replace: swap current clipId for candidate withClipId.
- setNote: set a neutral note for clipId.  Clips with "locked": true must never be targeted.
Unused fields must be null. "summary" is one neutral sentence describing what changed.`;

export function buildSystemPrompt(cutId: CutId, mode: 'generate' | 'refine'): string {
  const a = ARCHETYPES[cutId];
  return [
    SHARED_RULES,
    `THIS CUT: ${a.id} "${a.title}"\nLENS: ${a.lens}`,
    mode === 'generate' ? GENERATE_OUTPUT_SPEC : REFINE_OUTPUT_SPEC,
  ].join('\n\n');
}

/** JSON schemas for strict structured output (all fields required, optional ones nullable). */
export const GENERATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['cutId', 'title', 'tagline', 'picks'],
  properties: {
    cutId: { type: 'string', enum: ['cut_a', 'cut_b', 'cut_c'] },
    title: { type: 'string' },
    tagline: { type: 'string' },
    picks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['clipId', 'keptText', 'gapAfterSec', 'tensionScore', 'note'],
        properties: {
          clipId: { type: 'string' },
          keptText: { type: ['string', 'null'] },
          gapAfterSec: { type: 'number' },
          tensionScore: { type: 'integer' },
          note: { type: 'string' },
        },
      },
    },
  },
} as const;

export const REFINE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'ops'],
  properties: {
    summary: { type: 'string' },
    ops: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['op', 'clipId', 'toIndex', 'keptText', 'gapAfterSec', 'atIndex', 'withClipId', 'note'],
        properties: {
          op: { type: 'string', enum: ['drop', 'move', 'trim', 'setGap', 'insert', 'replace', 'setNote'] },
          clipId: { type: 'string' },
          toIndex: { type: ['integer', 'null'] },
          keptText: { type: ['string', 'null'] },
          gapAfterSec: { type: ['number', 'null'] },
          atIndex: { type: ['integer', 'null'] },
          withClipId: { type: ['string', 'null'] },
          note: { type: ['string', 'null'] },
        },
      },
    },
  },
} as const;

/** Static suggestion pills (charter-neutral). Dynamic pills are added from the loaded catalog. */
export const STATIC_PILLS: string[] = [
  '90s chronological: trust, reversal, escalation',
  '45s cold open: strongest self-authored lines',
  '75s: stated standards vs later statements',
];
