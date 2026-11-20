import type { Block, Critique, EvidenceRef, NarrationTarget, ScriptVersion, Segment, StudioClip } from './scriptTypes';
import { anonymousScene, episodeOutlineView, findScene } from './scriptGates';

const MAX_TARGETS = 8;
type Narration = Extract<Block, { kind: 'narration' }>;
const editable = (b: Block): b is Narration => b.kind === 'narration' && !b.locked
  && !b.readEvidence && b.type !== 'QUOTE_READ' && b.type !== 'HEADING';
type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

/** A critic may cite an exact excerpt; bind it to the full current text before asking for edits. */
export function validateLinkedTargets(version: ScriptVersion, primaryId: string, value: unknown, allowed: Set<string>): Result<NarrationTarget[]> {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_TARGETS) return { ok: false, reason: 'A linked issue needs 2–8 narration targets.' };
  const targets: NarrationTarget[] = [];
  const seen = new Set<string>();
  for (const t of value) {
    const block = findScene(version.segments, t?.sceneId)?.scene.blocks.find(b => b.id === t?.blockId);
    if (!allowed.has(t?.sceneId) || !block || !editable(block) || seen.has(block.id)) {
      return { ok: false, reason: 'Linked issue targets unknown, duplicate, protected or out-of-scope narration.' };
    }
    if (typeof t.sourceText !== 'string' || !t.sourceText.trim() || !block.text.includes(t.sourceText)) {
      return { ok: false, reason: `Linked target ${block.id} has stale or inexact source text.` };
    }
    seen.add(block.id);
    targets.push({ sceneId: t.sceneId, blockId: block.id, sourceText: block.text });
  }
  const scenes = new Set(targets.map(t => t.sceneId));
  if (scenes.size < 2 || !scenes.has(primaryId)) return { ok: false, reason: 'A linked issue must include its primary scene and another scene.' };
  return { ok: true, value: targets };
}

export interface LinkedNarrationEdit extends NarrationTarget { text: string; claims: EvidenceRef[] }

/** Reconstruct from the baseline only after the complete group passes. No tape/cue/order mutations. */
export function applyLinkedNarration(
  version: ScriptVersion, critique: Critique, baselineId: unknown, edits: LinkedNarrationEdit[], allowed: Set<string>,
  opts: { newVersionId: string; now: number },
): { ok: true; version: ScriptVersion } | { ok: false; reason: string } {
  if (baselineId !== version.id || critique.versionId !== version.id) return { ok: false, reason: 'Linked revision names a stale baseline.' };
  const validated = validateLinkedTargets(version, critique.targetId, critique.linkedTargets, allowed);
  if (!validated.ok) return validated;
  const targets = validated.value;
  if (targets.some((t, i) => t.sourceText !== critique.linkedTargets![i].sourceText)) return { ok: false, reason: 'Linked issue checkpoints changed.' };
  if (!Array.isArray(edits) || edits.length !== targets.length) return { ok: false, reason: 'Linked revision omitted a required target or added an extra edit.' };
  const replacements = new Map<string, LinkedNarrationEdit>();
  for (const e of edits) {
    const t = targets.find(t => t.sceneId === e?.sceneId && t.blockId === e?.blockId);
    if (!t || replacements.has(e.blockId) || t.sourceText !== e.sourceText) return { ok: false, reason: 'Linked revision has an extra, duplicate or stale target.' };
    if (typeof e.text !== 'string' || !e.text.trim() || e.text.trim() === t.sourceText.trim() || !Array.isArray(e.claims)) {
      return { ok: false, reason: `Linked revision must change narration ${t.blockId} and supply its evidence claims.` };
    }
    replacements.set(e.blockId, e);
  }
  const segments = version.segments.map(seg => ({ ...seg, scenes: seg.scenes.map(sc => ({ ...sc,
    blocks: sc.blocks.map(b => {
      const e = replacements.get(b.id);
      return e && e.sceneId === sc.id && editable(b) ? { ...b, text: e.text.trim(), claims: e.claims } : b;
    }),
  })) }));
  return { ok: true, version: {
    id: opts.newVersionId, parentId: version.id, projectId: version.projectId, createdAt: opts.now, author: 'loop', segments,
    changedScope: { level: 'scene', ids: [...new Set(targets.map(t => t.sceneId))] },
  } };
}

/** Bounded previews, shared by existing critic calls. Full text is rebound by validation. */
export function linkedStoryContext(segments: Segment[], allowed: Set<string>) {
  const scenes = segments.flatMap(seg => seg.scenes).filter(sc => allowed.has(sc.id));
  const perScene = Math.floor(24_000 / Math.max(1, scenes.length));
  return scenes.map(sc => {
    const blocks = sc.blocks.filter(editable);
    const perBlock = Math.min(500, Math.floor(perScene / Math.max(1, blocks.length)));
    return { sceneId: sc.id, title: sc.title, purpose: sc.purpose,
      narration: perBlock < 20 ? [] : blocks.map(b => ({ blockId: b.id, sourceText: b.text.slice(0, perBlock) })),
    };
  });
}

/** Complete affected scenes and unchanged neighbour checkpoints in episode order, without IDs. */
export function linkedRevisionView(version: ScriptVersion, sceneIds: string[], clips: Record<string, StudioClip>) {
  const scenes = version.segments.flatMap(seg => seg.scenes);
  const positions = new Set<number>();
  scenes.forEach((sc, i) => { if (sceneIds.includes(sc.id)) for (const j of [i - 1, i, i + 1]) if (scenes[j]) positions.add(j); });
  return { outline: episodeOutlineView(version.segments, false), scenes: [...positions].sort((a, b) => a - b)
    .map(i => ({ position: i + 1, scene: anonymousScene(scenes[i], clips) })) };
}
