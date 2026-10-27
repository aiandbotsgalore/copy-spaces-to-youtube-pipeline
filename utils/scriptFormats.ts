/**
 * The seven episode formats: structure, rubric criteria with definitions, and the format rules that
 * code can check. Hard rules gate candidates (only when a candidate makes them worse than its
 * baseline, so an inherited problem never blocks an unrelated fix); soft notes go to the critic as
 * local checks and are shown to Logan. Pure module, shared by server and UI.
 */
import type { Block, EpisodeFormat, FormatCriterion, Segment } from './scriptTypes';
import { ATTRIBUTION_RE, blockSeconds, estimateRuntime, wordCount } from './scriptGates';

export interface FormatSpec { label: string; structure: string; criteria: FormatCriterion[] }

export const FORMAT_SPECS: Record<EpisodeFormat, FormatSpec> = {
  narrative_doc: { label: 'Narrative documentary', structure: 'Cold open near the payoff, then chronology with withheld information; scenes end on open questions.', criteria: ['curiosity', 'momentum', 'resonance'] },
  investigative: { label: 'Investigative deep dive', structure: 'Claim, then evidence clip, then counterpoint, then what remains unproven. A claim needs two sources or attribution wording ("according to", "alleges").', criteria: ['fairness', 'clarity'] },
  best_of: { label: 'Best-of', structure: 'Clip-dominant, narration under 15 percent of runtime, thematic chapters.', criteria: ['clip_choice', 'pacing'] },
  interview: { label: 'Interview', structure: 'Guest arc (who, why now, the turn, the surprise); narration only bridges cuts.', criteria: ['authenticity'] },
  thematic_multi: { label: 'Thematic multi-recording', structure: 'A thesis question across dates, with a date on every clip.', criteria: ['clarity', 'payoff'] },
  commentary: { label: 'Commentary', structure: 'Host-led argument with clips as exhibits; explicit opinion markers.', criteria: ['authenticity', 'clarity'] },
  short_highlight: { label: 'Short highlight', structure: '30 to 90 seconds, one moment, at most one setup line, every clip self-contained.', criteria: ['clip_choice', 'payoff'] },
};

export const CRITERION_DEFINITIONS: Record<FormatCriterion, string> = {
  curiosity: 'the listener wants to know what happens next; questions are raised before they are answered',
  momentum: 'each beat moves the story forward; no stalls or repeated information',
  clarity: 'who is speaking, what is claimed and why it matters is always clear',
  pacing: 'clip and narration lengths vary; no long runs of one kind; breathing room after big moments',
  authenticity: 'the speakers are heard in their own words; narration does not put words in their mouths',
  clip_choice: 'each clip is the strongest available moment for its purpose and is understandable on its own',
  resonance: 'the scene leaves a feeling or idea that stays with the listener',
  payoff: 'set-ups are paid off; the ending answers or sharpens the opening question',
  fairness: 'claims are attributed, counterpoints are heard, allegations are not stated as fact',
};

/** The rubric text used by the critic and the judge. */
export function rubricText(format: EpisodeFormat | null): string {
  const criteria: FormatCriterion[] = format ? FORMAT_SPECS[format].criteria : ['curiosity', 'momentum', 'clarity', 'pacing'];
  return criteria.map(c => `- ${c}: ${CRITERION_DEFINITIONS[c]}`).join('\n');
}

export interface FormatFinding { key: string; message: string }
export interface FormatCheck { hard: FormatFinding[]; soft: FormatFinding[] }

export const BEST_OF_MAX_NARRATION_SHARE = 0.15;
export const SHORT_MIN_SEC = 30;
export const SHORT_MAX_SEC = 90;
export const INTERVIEW_BRIDGE_MAX_WORDS = 60;
const OPINION_RE = /\b(i think|i believe|in my view|my view|to me|my take|i'd argue|i would argue|frankly|honestly|i suspect|i doubt|i'm convinced|my opinion|in my opinion)\b/i;
const DATE_TAG_RE = /^(\d{4})(\d{2})(\d{2})_/;

const narrations = (segments: Segment[]) => segments.flatMap(s => s.scenes.flatMap(sc => sc.blocks)).filter((b): b is Extract<Block, { kind: 'narration' }> => b.kind === 'narration');

export function dateOfTag(tag: string): string | null {
  const m = DATE_TAG_RE.exec(tag);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function formatChecks(segments: Segment[], format: EpisodeFormat | null, opts: { clipTags?: Record<string, string>; sourceCount?: number } = {}): FormatCheck {
  const hard: FormatFinding[] = [];
  const soft: FormatFinding[] = [];
  if (!format) return { hard, soft };
  const scenes = segments.flatMap(s => s.scenes);
  const total = estimateRuntime(segments).sec;

  if (format === 'best_of') {
    const narr = narrations(segments).reduce((s, b) => s + blockSeconds(b).sec, 0);
    const share = total > 0 ? narr / total : 0;
    if (share >= BEST_OF_MAX_NARRATION_SHARE) hard.push({ key: 'best_of:narration_share', message: `Best-of: narration is ${Math.round(share * 100)}% of runtime (must stay under ${BEST_OF_MAX_NARRATION_SHARE * 100}%).` });
  }

  if (format === 'short_highlight') {
    if (total > 0 && (total < SHORT_MIN_SEC || total > SHORT_MAX_SEC)) hard.push({ key: 'short:runtime', message: `Short highlight: runtime ${Math.round(total)}s is outside ${SHORT_MIN_SEC} to ${SHORT_MAX_SEC}s.` });
    const n = narrations(segments).length;
    if (n > 1) hard.push({ key: 'short:setup_lines', message: `Short highlight: ${n} narration blocks (at most one setup line).` });
    if (scenes.length > 1) soft.push({ key: 'short:one_moment', message: `Short highlight: ${scenes.length} scenes; the format is one moment.` });
  }

  if (format === 'investigative') {
    for (const b of narrations(segments)) {
      if (!b.claims.length) continue;
      const sources = new Set(b.claims.map(c => `${c.releaseTag}|${c.speaker.toLowerCase()}`));
      if (sources.size < 2 && !ATTRIBUTION_RE.test(b.text)) hard.push({ key: `inv:attr:${b.id}`, message: `Investigative: narration ${b.id} rests on one source without attribution wording.` });
    }
    for (const sc of scenes) {
      const hasClaim = sc.blocks.some(b => b.kind === 'narration' && b.claims.length);
      const hasClip = sc.blocks.some(b => b.kind === 'clip');
      if (hasClaim && !hasClip) soft.push({ key: `inv:evidence:${sc.id}`, message: `Investigative: scene "${sc.title}" makes claims but plays no evidence clip.` });
      const fns = sc.blocks.filter(b => b.kind === 'clip').map(b => (b as any).fn);
      if (hasClaim && hasClip && !fns.includes('counterpoint') && sc === scenes[scenes.length - 1]) soft.push({ key: `inv:counter:${sc.id}`, message: 'Investigative: the closing scene has no counterpoint clip.' });
    }
  }

  if (format === 'interview') {
    for (const sc of scenes) {
      sc.blocks.forEach((b, i) => {
        if (b.kind !== 'narration') return;
        if (wordCount(b.text) > INTERVIEW_BRIDGE_MAX_WORDS) soft.push({ key: `int:long:${b.id}`, message: `Interview: narration ${b.id} is ${wordCount(b.text)} words; narration should only bridge cuts.` });
        if (sc.blocks[i + 1]?.kind === 'narration') soft.push({ key: `int:double:${b.id}`, message: `Interview: narration ${b.id} is followed by more narration instead of the guest.` });
      });
    }
  }

  if (format === 'thematic_multi') {
    for (const sc of scenes) for (const b of sc.blocks) {
      if (b.kind !== 'clip') continue;
      const tag = opts.clipTags?.[b.clipId];
      if (!tag || !dateOfTag(tag)) hard.push({ key: `thm:date:${b.id}`, message: `Thematic: clip ${b.clipId} has no recording date.` });
    }
    if ((opts.sourceCount ?? 1) < 2) soft.push({ key: 'thm:sources', message: 'Thematic: the project has one recording; the format compares recordings across dates.' });
  }

  if (format === 'commentary') {
    for (const sc of scenes) {
      const ns = sc.blocks.filter(b => b.kind === 'narration') as Extract<Block, { kind: 'narration' }>[];
      if (ns.length && !ns.some(b => OPINION_RE.test(b.text))) soft.push({ key: `com:opinion:${sc.id}`, message: `Commentary: scene "${sc.title}" has no explicit opinion marker ("I think", "in my view").` });
    }
  }

  if (format === 'narrative_doc') {
    for (const sc of scenes.slice(0, -1)) {
      const last = [...sc.blocks].reverse().find(b => b.kind === 'narration') as Extract<Block, { kind: 'narration' }> | undefined;
      if (last && sc.blocks[sc.blocks.length - 1] === last && !/\?\s*$/.test(last.text.trim())) soft.push({ key: `doc:open:${sc.id}`, message: `Narrative: scene "${sc.title}" ends on narration that closes rather than opens a question.` });
    }
  }
  return { hard, soft };
}

/** Hard findings present in the candidate but not in its baseline. */
export function newHardFindings(candidate: FormatCheck, baseline: FormatCheck): FormatFinding[] {
  const before = new Set(baseline.hard.map(f => f.key));
  return candidate.hard.filter(f => !before.has(f.key));
}
