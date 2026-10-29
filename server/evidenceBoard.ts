/**
 * A project's Evidence Board (.spacepipe-studio/projects/<id>/board.json): only this project's
 * choices (star, exclude, note) and references to library or AQ quotes. Quote data itself lives once in
 * the shared library. A project has no board file until Logan first uses it.
 */
import type { BoardItem, EvidenceBoard, ScriptProject } from '../utils/scriptTypes';
import type { ScriptStore } from './scriptStore';

export const emptyBoard = (p: ScriptProject): EvidenceBoard => ({
  version: 1, question: p.thesis || '', tapeBalance: 'balanced',
  recordings: p.sourceTags.map(releaseTag => ({ releaseTag, status: 'candidate' as const })),
  items: [], claims: [], sources: [],
});

export const getBoard = (store: ScriptStore, projectId: string): EvidenceBoard | null => store.getBoard(projectId);

export interface ItemPatch { starred?: boolean; excluded?: boolean; note?: string }

/** Stars, excludes or notes one quote ref on this project's board. An item with none of these is removed. */
export function setBoardItem(store: ScriptStore, project: ScriptProject, ref: string, patch: ItemPatch, hasRef: (ref: string) => boolean, now: () => number = Date.now): EvidenceBoard {
  if (!hasRef(ref)) throw new Error(`Unknown quote ${ref}.`);
  const board = store.getBoard(project.id) ?? emptyBoard(project);
  const i = board.items.findIndex(x => x.ref === ref);
  const item: BoardItem = i >= 0 ? { ...board.items[i] } : { ref, addedAt: now() };
  if (patch.starred !== undefined) { if (patch.starred) item.starred = true; else delete item.starred; }
  if (patch.excluded !== undefined) { if (patch.excluded) item.excluded = true; else delete item.excluded; }
  if (patch.note !== undefined) { const n = patch.note.trim().slice(0, 1000); if (n) item.note = n; else delete item.note; }
  const keep = item.starred || item.excluded || item.note;
  if (i >= 0) { if (keep) board.items[i] = item; else board.items.splice(i, 1); }
  else if (keep) board.items.push(item);
  store.saveBoard(project.id, board);
  return board;
}
