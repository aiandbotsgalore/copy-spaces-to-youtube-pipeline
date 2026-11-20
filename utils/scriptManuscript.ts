/**
 * Manuscript states for THE PAPER TRAIL (one production, one project):
 *  - the current working master: the version every tool treats as "the script" while editing continues;
 *  - individually approved and locked passages: blocks with `locked: true` (unchanged by any AI revision);
 *  - proposed editorial revisions: refinement candidates and any version that is not a designated master;
 *  - the fully approved recording manuscript: only set by Logan explicitly, never implied by the working master.
 *
 * This module is pure (no file or network access): locking a verbatim reference passage, and rendering a
 * version as plain manuscript text for research tools such as the PaperTrail bridge.
 */
import type { Block, Segment } from './scriptTypes';

export type ManuscriptRole = 'working' | 'recording';

const squash = (s: string) => String(s || '').replace(/\s+/g, ' ').trim();

/** The text a block contributes to a manuscript, or '' for blocks without words. */
export function blockText(b: Block): string {
  switch (b.kind) {
    case 'narration': return b.text;
    case 'clip': return b.keptText;
    case 'heading': return b.text;
    case 'cue': return b.text || b.note || '';
    case 'music': return b.note;
    default: return '';
  }
}

export interface VerbatimLockReport {
  /** Paragraphs in the reference text. */
  paragraphs: number;
  /** Reference paragraphs found as a whole block, word for word (whitespace may differ). */
  matched: number;
  /** Blocks newly locked. Blocks that were already locked are left as they are and not counted. */
  newlyLocked: number;
  /** Reference paragraphs with no identical block (shortened). Empty when the whole reference is covered. */
  missing: string[];
}

/**
 * Locks every block whose words are, word for word, one paragraph of a verbatim reference text (such as
 * Logan's locked introduction). Paragraphs are separated by blank lines. Nothing else changes, and no block is
 * unlocked. Each paragraph locks at most one block, the first unlocked match in order.
 */
export function lockVerbatimPassages(segments: Segment[], reference: string): { segments: Segment[]; report: VerbatimLockReport } {
  const paragraphs = reference.split(/\r?\n\s*\r?\n/).map(squash).filter(Boolean);
  const want = new Map<string, number>();
  for (const p of paragraphs) want.set(p, (want.get(p) || 0) + 1);
  let newlyLocked = 0;
  const found = new Map<string, number>();
  const out = segments.map(seg => ({
    ...seg,
    scenes: seg.scenes.map(sc => ({
      ...sc,
      blocks: sc.blocks.map(b => {
        const t = squash(blockText(b));
        if (!t || !want.has(t) || (found.get(t) || 0) >= (want.get(t) || 0)) return b;
        found.set(t, (found.get(t) || 0) + 1);
        if (b.locked) return b;
        newlyLocked++;
        return { ...b, locked: true } as Block;
      }),
    })),
  }));
  const missing: string[] = [];
  const seen = new Map<string, number>();
  for (const p of paragraphs) {
    const n = (seen.get(p) || 0) + 1;
    seen.set(p, n);
    if (n > (found.get(p) || 0)) missing.push(p.length > 80 ? `${p.slice(0, 80)}…` : p);
  }
  return { segments: out, report: { paragraphs: paragraphs.length, matched: paragraphs.length - missing.length, newlyLocked, missing } };
}

export interface ManuscriptHeader {
  title: string;
  role: ManuscriptRole;
  versionId: string;
  designatedAt: number;
  source?: string;
}

/**
 * The version as plain manuscript text, headed by its status so a reader (human or model) never mistakes a
 * working master for an approved recording manuscript. Locked passages are marked.
 */
export function renderManuscript(segments: Segment[], h: ManuscriptHeader): string {
  const status = h.role === 'recording'
    ? 'FULLY APPROVED RECORDING MANUSCRIPT (approved by Logan in Script Studio).'
    : 'CURRENT WORKING MASTER. Not approved for recording as a whole: only passages marked [LOCKED] are approved and must stay verbatim; everything else is still subject to editorial refinement.';
  const lines: string[] = [
    `# ${h.title}`,
    '',
    `Status: ${status}`,
    `Script Studio version: ${h.versionId}; designated ${new Date(h.designatedAt).toISOString()}${h.source ? `; imported from ${h.source}` : ''}.`,
    '',
  ];
  for (const seg of segments) {
    lines.push(`## ${seg.title}`, '');
    for (const sc of seg.scenes) {
      lines.push(`### ${sc.title}`, '');
      for (const b of sc.blocks) {
        const lock = b.locked ? '[LOCKED] ' : '';
        if (b.kind === 'clip') lines.push(`${lock}[ARCHIVAL CLIP ${b.clipId}${b.speaker ? ` | ${b.speaker}` : ''}] ${b.keptText}`, '');
        else if (b.kind === 'pause') lines.push(`${lock}[Pause ${b.sec}s]`, '');
        else if (b.kind === 'music') lines.push(`${lock}[Music: ${b.cue}${b.note ? ` | ${b.note}` : ''}]`, '');
        else {
          const t = blockText(b).trim();
          if (t) lines.push(`${lock}${t}`, '');
        }
      }
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
