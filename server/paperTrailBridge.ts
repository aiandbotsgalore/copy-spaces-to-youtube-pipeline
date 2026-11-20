/**
 * Client for Logan's PaperTrail bridge (`papertrail_bridge.py`, a JSONL-over-stdio research process outside
 * this repository). Script Studio starts it once, on first use, and keeps it running so the bridge's
 * embedding model stays loaded between requests. It is read-only from Studio's side except for operations
 * the caller explicitly sends; Studio sends none that write.
 *
 * The bridge is optional: when it is missing or fails, callers get { ok: false } and fall back to Studio's
 * own behaviour. Paths come from environment variables so nothing about Logan's machine is hardcoded here
 * beyond the bridge's own default location.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';

export interface BridgeConfig {
  /** Python executable. Default: PAPERTRAIL_PYTHON or "python". */
  python?: string;
  /** Path to papertrail_bridge.py. Default: PAPERTRAIL_BRIDGE or D:\PaperTrail-Knowledge\papertrail_bridge.py. */
  script?: string;
  /** Manuscript the bridge's manuscript_context reads (passed as PAPERTRAIL_MASTER_MANUSCRIPT). */
  manuscriptPath?: () => string | undefined;
  /** Milliseconds before one request gives up. The first semantic request loads a model, so allow longer. */
  timeoutMs?: number;
  /** Test seam: replaces spawning the real process. */
  spawnImpl?: (cmd: string, args: string[], env: NodeJS.ProcessEnv) => ChildProcessWithoutNullStreams;
}

export type BridgeResult<T = any> = { ok: true; result: T } | { ok: false; reason: string };

export interface BridgeStatus {
  configured: boolean;
  running: boolean;
  script: string;
  lastError?: string;
  requests: number;
  failures: number;
}

const DEFAULT_SCRIPT = 'D:\\PaperTrail-Knowledge\\papertrail_bridge.py';
/** Operations Studio may send. Writes (memory_upsert) are deliberately absent until Logan approves them. */
const READ_OPERATIONS = new Set([
  'status', 'search', 'hybrid_search', 'semantic_search', 'multi_search', 'context', 'passage_text',
  'recording_context', 'related_sources', 'timeline', 'existing_claims', 'manuscript_context',
  'memory_search', 'case_compare', 'research_bundle',
]);

export function createPaperTrailBridge(cfg: BridgeConfig = {}) {
  const python = cfg.python || process.env.PAPERTRAIL_PYTHON || 'python';
  const script = cfg.script || process.env.PAPERTRAIL_BRIDGE || DEFAULT_SCRIPT;
  const timeoutMs = cfg.timeoutMs ?? 120_000;
  let child: ChildProcessWithoutNullStreams | null = null;
  let buffer = '';
  let seq = 0;
  let requests = 0;
  let failures = 0;
  let lastError: string | undefined;
  let restartAfter = 0;
  const pending = new Map<string, { resolve: (r: BridgeResult) => void; timer: NodeJS.Timeout }>();

  const configured = () => !!cfg.spawnImpl || fs.existsSync(script);

  function failAll(reason: string) {
    for (const [id, p] of pending) { clearTimeout(p.timer); p.resolve({ ok: false, reason }); pending.delete(id); }
  }

  function onLine(line: string) {
    if (!line.trim()) return;
    let msg: any;
    try { msg = JSON.parse(line); } catch { return; } // a stray print from the bridge; ignore it
    const id = msg?._request_id;
    const p = id !== undefined ? pending.get(String(id)) : undefined;
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(String(id));
    if (msg.ok) p.resolve({ ok: true, result: msg.result });
    else { failures++; p.resolve({ ok: false, reason: String(msg.error || 'The PaperTrail bridge reported an error.') }); }
  }

  function start(): ChildProcessWithoutNullStreams | null {
    if (child) return child;
    if (Date.now() < restartAfter) return null;
    if (!configured()) { lastError = `PaperTrail bridge not found at ${script}.`; return null; }
    const env: NodeJS.ProcessEnv = { ...process.env, PYTHONIOENCODING: 'utf-8' };
    const manuscript = cfg.manuscriptPath?.();
    if (manuscript) env.PAPERTRAIL_MASTER_MANUSCRIPT = manuscript;
    try {
      child = cfg.spawnImpl ? cfg.spawnImpl(python, ['-u', script], env) : spawn(python, ['-u', script], { env, windowsHide: true });
    } catch (e: any) {
      lastError = `Could not start the PaperTrail bridge: ${e?.message || e}`;
      restartAfter = Date.now() + 30_000;
      return null;
    }
    buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); onLine(line); }
    });
    child.stderr.on('data', (d: Buffer | string) => { const t = String(d).trim(); if (t) lastError = t.slice(-500); });
    const onGone = (why: string) => {
      child = null;
      // Back off briefly so a bridge that crashes on start is not respawned on every request.
      restartAfter = Date.now() + 10_000;
      failAll(why);
    };
    child.on('exit', code => onGone(`The PaperTrail bridge stopped (exit ${code}).${lastError ? ` ${lastError}` : ''}`));
    child.on('error', err => { lastError = err.message; onGone(`The PaperTrail bridge failed: ${err.message}`); });
    return child;
  }

  /** Sends one read operation. Never throws; resolves { ok: false } when the bridge is unavailable. */
  function request<T = any>(operation: string, params: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
    if (!READ_OPERATIONS.has(operation)) return Promise.resolve({ ok: false, reason: `Operation ${operation} is not allowed from Script Studio.` });
    const proc = start();
    if (!proc) return Promise.resolve({ ok: false, reason: lastError || 'The PaperTrail bridge is not running.' });
    const id = String(++seq);
    requests++;
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        pending.delete(id);
        failures++;
        resolve({ ok: false, reason: `The PaperTrail bridge did not answer ${operation} within ${Math.round(timeoutMs / 1000)} s.` });
      }, timeoutMs);
      pending.set(id, { resolve, timer });
      try { proc.stdin.write(JSON.stringify({ ...params, operation, _request_id: id }) + '\n'); }
      catch (e: any) { clearTimeout(timer); pending.delete(id); failures++; resolve({ ok: false, reason: `Could not reach the PaperTrail bridge: ${e?.message || e}` }); }
    });
  }

  /** Stops the process; the next request starts a fresh one (for example after the manuscript changes). */
  function restart() {
    restartAfter = 0;
    if (child) { const c = child; child = null; failAll('The PaperTrail bridge was restarted.'); try { c.kill(); } catch { /* already gone */ } }
  }

  const status = (): BridgeStatus => ({ configured: configured(), running: !!child, script, lastError, requests, failures });

  return { request, restart, status };
}

export type PaperTrailBridge = ReturnType<typeof createPaperTrailBridge>;

/** One related recording as Script Studio's recording search shows it. */
export interface BridgeRelatedHit {
  releaseTag: string; title: string; date: string | null; score: number;
  terms: Record<string, number>; samples: { start: number; speaker: string; text: string }[];
}

/**
 * Groups bridge passages (hybrid search) into recordings for the "related recordings" list. The bridge's
 * recording_id is the same as Studio's release tag. Passages without a recording (documents, messages) are
 * returned separately so they are not silently dropped.
 */
export function groupPassagesByRecording(items: any[], opts: { exclude?: string[]; limit?: number } = {}): { hits: BridgeRelatedHit[]; documents: any[] } {
  const exclude = new Set(opts.exclude || []);
  const byTag = new Map<string, BridgeRelatedHit>();
  const documents: any[] = [];
  items.forEach((it, rank) => {
    const tag = typeof it?.recording_id === 'string' ? it.recording_id : '';
    if (!tag) { documents.push(it); return; }
    if (exclude.has(tag)) return;
    const weight = 1 / (rank + 1);
    const hit: BridgeRelatedHit = byTag.get(tag) || { releaseTag: tag, title: String(it.title || it.recording_title || tag), date: it.event_date ? String(it.event_date).slice(0, 10) : null, score: 0, terms: {}, samples: [] };
    hit.score += weight;
    if (hit.samples.length < 2) hit.samples.push({ start: Number(it.start_seconds) || 0, speaker: String(it.speaker || ''), text: String(it.text || '').slice(0, 240) });
    byTag.set(tag, hit);
  });
  const hits = [...byTag.values()].sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 10)
    .map(h => ({ ...h, score: Math.round(h.score * 100) / 100 }));
  return { hits, documents };
}
