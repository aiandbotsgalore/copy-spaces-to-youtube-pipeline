/**
 * Script Studio disk store under <root>/.spacepipe-studio/ (gitignored, outside public/ so it is never
 * served, and in Vite's server.watch.ignored so writes never reload the page or restart the server).
 * Every write goes to a temp file and is renamed into place. Errors carry the path and the OS message.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TakeIndex, TakeRecord } from '../utils/scriptAudio';
import type { EditorialMemory, EpisodeAnalysis, ScriptProject, ScriptRun, ScriptVersion } from '../utils/scriptTypes';

export class StoreError extends Error {
  constructor(public filePath: string, public osMessage: string) {
    super(`Could not write ${filePath}: ${osMessage}`);
  }
}

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
export const isSafeId = (id: string) => ID_RE.test(id);
export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${randomUUID().replace(/-/g, '').slice(0, 8)}`;

export const EMPTY_MEMORY: EditorialMemory = { styleRules: [], approvedPassages: [], rejectedRewrites: [], unresolved: [], decisionsSinceDistill: 0 };

export function createScriptStore(root: string) {
  const base = path.join(root, '.spacepipe-studio');
  const p = (...parts: string[]) => path.join(base, ...parts);

  function writeJson(file: string, data: unknown) {
    const tmp = `${file}.${randomUUID().slice(0, 8)}.tmp`;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmp, file);
    } catch (e: any) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
      throw new StoreError(file, e?.message || String(e));
    }
  }
  function readJson<T>(file: string): T | null {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return null; }
  }
  const must = (id: string) => { if (!isSafeId(id)) throw new Error(`Invalid id ${id}`); return id; };

  return {
    base,
    writeJson, readJson,
    projectDir: (id: string) => p('projects', must(id)),

    listProjects(): ScriptProject[] {
      const dir = p('projects');
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).filter(isSafeId).map(id => readJson<ScriptProject>(p('projects', id, 'project.json'))).filter((x): x is ScriptProject => !!x)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    getProject: (id: string) => readJson<ScriptProject>(p('projects', must(id), 'project.json')),
    saveProject: (proj: ScriptProject) => writeJson(p('projects', must(proj.id), 'project.json'), proj),

    getVersion: (projectId: string, versionId: string) => readJson<ScriptVersion>(p('projects', must(projectId), 'versions', `${must(versionId)}.json`)),
    saveVersion: (v: ScriptVersion) => writeJson(p('projects', must(v.projectId), 'versions', `${must(v.id)}.json`), v),
    listVersions(projectId: string): ScriptVersion[] {
      const dir = p('projects', must(projectId), 'versions');
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => readJson<ScriptVersion>(path.join(dir, f))).filter((x): x is ScriptVersion => !!x)
        .sort((a, b) => a.createdAt - b.createdAt);
    },

    getRun: (projectId: string, runId: string) => readJson<ScriptRun>(p('projects', must(projectId), 'runs', `${must(runId)}.json`)),
    saveRun: (r: ScriptRun) => writeJson(p('projects', must(r.projectId), 'runs', `${must(r.id)}.json`), r),
    listRuns(projectId: string): ScriptRun[] {
      const dir = p('projects', must(projectId), 'runs');
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => readJson<ScriptRun>(path.join(dir, f))).filter((x): x is ScriptRun => !!x)
        .sort((a, b) => b.createdAt - a.createdAt);
    },
    allRuns(): ScriptRun[] {
      return this.listProjects().flatMap(pr => this.listRuns(pr.id));
    },

    analysisPath: (releaseTag: string, promptVersion: string) => p('analyses', `${releaseTag}.${promptVersion}.json`),
    getAnalysis(releaseTag: string, promptVersion: string, transcriptHash: string): EpisodeAnalysis | null {
      const a = readJson<EpisodeAnalysis>(this.analysisPath(releaseTag, promptVersion));
      return a && a.transcriptHash === transcriptHash ? a : null;
    },
    saveAnalysis(a: EpisodeAnalysis) { writeJson(this.analysisPath(a.releaseTag, a.promptVersion), a); },

    getMemory: (): EditorialMemory => ({ ...EMPTY_MEMORY, ...(readJson<EditorialMemory>(p('memory.json')) || {}) }),
    saveMemory: (m: EditorialMemory) => writeJson(p('memory.json'), m),

    appendLog(runId: string, entry: Record<string, unknown>) {
      const file = p('logs', `${must(runId)}.jsonl`);
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
      } catch (e: any) {
        throw new StoreError(file, e?.message || String(e));
      }
    },
    listLogIds(): string[] {
      const dir = p('logs');
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => f.slice(0, -6)).filter(isSafeId);
    },
    appendQualityHistory(entry: Record<string, unknown>) {
      const file = p('quality-history.jsonl');
      try { fs.mkdirSync(base, { recursive: true }); fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8'); }
      catch (e: any) { throw new StoreError(file, e?.message || String(e)); }
    },
    readQualityHistory(): Record<string, unknown>[] {
      try { return fs.readFileSync(p('quality-history.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; }
    },
    /** Vox take index (text hash -> take). Takes whose file is gone are dropped on read. */
    getTakes(): TakeIndex {
      const idx = readJson<TakeIndex>(p('takes.json')) || {};
      const out: TakeIndex = {};
      for (const [h, t] of Object.entries(idx)) {
        if (t && typeof t.url === 'string' && t.url.startsWith('/output/vox/') && fs.existsSync(path.join(root, 'public', t.url))) out[h] = t;
      }
      return out;
    },
    saveTake(t: TakeRecord) {
      const idx = readJson<TakeIndex>(p('takes.json')) || {};
      idx[t.hash] = t;
      writeJson(p('takes.json'), idx);
    },
    renderDir: (projectId: string) => p('projects', must(projectId), 'renders'),

    readLog(runId: string): Record<string, unknown>[] {
      try {
        return fs.readFileSync(p('logs', `${must(runId)}.jsonl`), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
      } catch { return []; }
    },
  };
}
export type ScriptStore = ReturnType<typeof createScriptStore>;
