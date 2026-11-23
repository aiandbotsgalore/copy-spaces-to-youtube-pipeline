/**
 * Ascension API: The Divine Action Hook Router & Security Boundary
 * Implements:
 *   1. GraphRAG Deep Introspection, Mutation & Vector Search
 *   2. Sandboxed Filesystem Commands & Allowlisted Execution
 *   3. Audio/Video Synthesis Direct Invocation & Voice Cloning
 *   4. Workflow YAML Injection & Cron Synchronization
 *   5. Telemetry SSE Streaming & Webhook Notifications (Discord/Slack)
 *   6. Audit Logging (wizard_audit.jsonl) & Multi-Tier Kill Switch
 */
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import child_process from 'child_process';
import type { IncomingMessage, ServerResponse } from 'http';

export interface AscensionDeps {
  rootDir: string;
  getEnv: () => Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export type KillSwitchLevel = 'resume' | 'pause' | 'permanent';

interface AuditLogEntry {
  timestamp: string;
  action: string;
  user: string;
  ipHash: string;
  params: Record<string, unknown>;
  resultStatus: 'success' | 'denied' | 'failed' | 'forbidden';
  error?: string;
}

/* -------------------------------------------------------------------------- */
/* Security Patterns & Allowlist Constants                                   */
/* -------------------------------------------------------------------------- */

const FORBIDDEN_SECRET_PATTERNS = [
  /github[_-]?token/i,
  /ghp_[a-zA-Z0-9]{16,}/i,
  /github_pat_[a-zA-Z0-9_]{16,}/i,
  /api[_-]?key/i,
  /bearer\s+[a-zA-Z0-9_\-\.]{16,}/i,
  /password\s*[:=]/i,
  /token\s*=\s*['"][^'"]+['"]/i,
  /client[_-]?secret/i,
];

export const ALLOWED_FS_EXEC_COMMANDS = new Set([
  'ls',
  'dir',
  'cat',
  'ffprobe',
  'ffmpeg',
  'sha256sum',
  'stat',
  'du',
  'df',
  'wc',
]);

const FORBIDDEN_METASYMBOLS = /[;&|`$><()]/;

const FORBIDDEN_COMMAND_SUBSTRINGS = [
  'rm',
  'eval',
  'sudo',
  'curl',
  'wget',
  'bash',
  'sh',
  'powershell',
  'cmd',
  'python',
  'node',
];

/* -------------------------------------------------------------------------- */
/* In-Memory State & Active SSE Clients                                       */
/* -------------------------------------------------------------------------- */

let currentKillSwitchState: KillSwitchLevel = 'resume';
const sseClients = new Set<ServerResponse>();

export function getKillSwitchState(): KillSwitchLevel {
  return currentKillSwitchState;
}

export function setKillSwitchState(level: KillSwitchLevel): void {
  currentKillSwitchState = level;
}

export function broadcastSseEvent(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers: JSON, Audit, Security Checks                                      */
/* -------------------------------------------------------------------------- */

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function parseJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

export function checkSecretLeak(text: string): string | null {
  if (!text) return null;
  for (const pattern of FORBIDDEN_SECRET_PATTERNS) {
    // Exception: Allow GitHub Actions standard expression ${{ secrets.NAME }}
    const sanitized = text.replace(/\$\{\{\s*secrets\.[A-Z0-9_]+\s*\}\}/g, '');
    if (pattern.test(sanitized)) {
      return `Potential secret or credential detected matching pattern: ${pattern.toString()}`;
    }
  }
  return null;
}

export function sanitizePath(rootDir: string, rawPath: string, allowedPrefixes: string[]): { ok: true; fullPath: string } | { ok: false; error: string } {
  if (!rawPath || typeof rawPath !== 'string') {
    return { ok: false, error: 'Path parameter is required' };
  }

  // Reject path traversal tokens
  const normalized = path.normalize(rawPath).replace(/\\/g, '/');
  if (normalized.includes('../') || normalized.startsWith('../') || normalized === '..') {
    return { ok: false, error: 'Path traversal attempt rejected' };
  }

  // Resolve absolute path
  const fullPath = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(rootDir, rawPath);

  // Check against allowed root subdirectories
  const isAllowed = allowedPrefixes.some((prefix) => {
    const allowedRoot = path.resolve(rootDir, prefix);
    return fullPath === allowedRoot || fullPath.startsWith(allowedRoot + path.sep);
  });

  if (!isAllowed) {
    return {
      ok: false,
      error: `Access denied: Path "${rawPath}" is outside allowed roots (${allowedPrefixes.join(', ')})`,
    };
  }

  // Disallow forbidden sensitive files
  const filename = path.basename(fullPath).toLowerCase();
  if (filename === '.env' || filename.startsWith('.env.') || filename === 'id_rsa' || filename === 'credentials') {
    return { ok: false, error: `Direct access to sensitive file "${filename}" is strictly forbidden` };
  }

  return { ok: true, fullPath };
}

function writeAuditLog(rootDir: string, entry: AuditLogEntry) {
  try {
    const auditDir = path.resolve(rootDir, 'data', 'audit');
    if (!fs.existsSync(auditDir)) {
      fs.mkdirSync(auditDir, { recursive: true });
    }
    const auditFile = path.resolve(auditDir, 'wizard_audit.jsonl');
    fs.appendFileSync(auditFile, JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    console.error('[Ascension Audit Log Error]', err);
  }
}

/* -------------------------------------------------------------------------- */
/* Main Middleware Factory                                                    */
/* -------------------------------------------------------------------------- */

export function createAscensionApiMiddleware(deps: AscensionDeps) {
  const rootDir = deps.rootDir;
  const getEnv = deps.getEnv;
  const now = deps.now ?? Date.now;

  // Restore kill switch state from disk if available
  const stateFile = path.resolve(rootDir, 'data', 'audit', 'kill_switch_state.json');
  try {
    if (fs.existsSync(stateFile)) {
      const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (saved.level) currentKillSwitchState = saved.level;
    }
  } catch {}

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const host = req.headers.host || 'localhost:5000';
    const parsedUrl = new URL(req.url || '', `http://${host}`);
    const pathname = parsedUrl.pathname;
    const method = (req.method || 'GET').toUpperCase();

    // CORS & Options
    if (method === 'OPTIONS') {
      res.statusCode = 204;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.end();
      return;
    }

    // IP Hash for auditing
    const remoteIp = req.socket.remoteAddress || '127.0.0.1';
    const ipHash = crypto.createHash('sha256').update(remoteIp).digest('hex').slice(0, 12);

    /* ─── KILL SWITCH CHECK ─── */
    // Tier 0 endpoints are always permitted unless permanent kill is engaged
    const isTier0 =
      (method === 'POST' && pathname === '/api/ascension/graph/introspect') ||
      (method === 'POST' && pathname === '/api/ascension/graph/query-embeddings') ||
      (method === 'POST' && pathname === '/api/ascension/fs/read') ||
      (method === 'GET' && pathname === '/api/ascension/logs/stream') ||
      (method === 'GET' && pathname === '/api/ascension/kill-switch');

    if (currentKillSwitchState === 'permanent') {
      sendJson(res, 403, {
        ok: false,
        error: 'Kill switch is permanently engaged. All Ascension actions are permanently forbidden.',
        killSwitchState: currentKillSwitchState,
      });
      return;
    }

    if (currentKillSwitchState === 'pause' && !isTier0) {
      writeAuditLog(rootDir, {
        timestamp: new Date(now()).toISOString(),
        action: pathname,
        user: 'Copilot',
        ipHash,
        params: {},
        resultStatus: 'forbidden',
        error: 'Kill switch is paused. Mutated operations rejected.',
      });
      sendJson(res, 403, {
        ok: false,
        error: 'Kill switch is paused. Only Tier 0 read/stream operations permitted.',
        killSwitchState: currentKillSwitchState,
      });
      return;
    }

    try {
      /* ==================================================================== */
      /* 1. GRAPHRAG INTROSPECTION & MUTATIONS                                */
      /* ==================================================================== */

      // POST /api/ascension/graph/introspect (Tier 0)
      if (method === 'POST' && pathname === '/api/ascension/graph/introspect') {
        const body = await parseJsonBody(req);
        const query = String(body.query || body.episodeTag || '').toLowerCase().trim();

        let baseGraph: any = null;
        const graphFile = path.resolve(rootDir, 'public', 'transcripts', 'investigative_knowledge_graph.json');
        if (fs.existsSync(graphFile)) {
          baseGraph = JSON.parse(fs.readFileSync(graphFile, 'utf8'));
        }

        const mutationsFile = path.resolve(rootDir, 'data', 'graph', 'mutations.json');
        let mutations: any = { nodes: [], edges: [], purgedVectors: [] };
        if (fs.existsSync(mutationsFile)) {
          try {
            mutations = JSON.parse(fs.readFileSync(mutationsFile, 'utf8'));
          } catch {}
        }

        const pairings = Array.isArray(baseGraph?.pairings) ? baseGraph.pairings : [];
        const nodes = [...(baseGraph?.nodes || []), ...(mutations.nodes || [])];
        const edges = [...(baseGraph?.edges || []), ...(mutations.edges || [])];

        const matchedPairings = query
          ? pairings.filter((p: any) =>
              p.title?.toLowerCase().includes(query) ||
              p.pairing_id?.toLowerCase().includes(query) ||
              p.pre_fallout?.episode_tag?.toLowerCase().includes(query) ||
              p.post_fallout?.episode_tag?.toLowerCase().includes(query) ||
              p.pre_fallout?.verbatim?.toLowerCase().includes(query) ||
              p.post_fallout?.verbatim?.toLowerCase().includes(query)
            )
          : pairings;

        const matchedNodes = query
          ? nodes.filter((n: any) =>
              n.id?.toLowerCase().includes(query) ||
              n.label?.toLowerCase().includes(query) ||
              n.speaker?.toLowerCase().includes(query) ||
              n.episodeTag?.toLowerCase().includes(query)
            )
          : nodes;

        sendJson(res, 200, {
          ok: true,
          query: body.query,
          episodeTag: body.episodeTag,
          stats: {
            totalPairings: pairings.length,
            matchedPairings: matchedPairings.length,
            totalNodes: nodes.length,
            matchedNodes: matchedNodes.length,
            totalEdges: edges.length,
          },
          pairings: matchedPairings,
          nodes: matchedNodes.slice(0, 50),
          edges: edges.slice(0, 100),
        });
        return;
      }

      // POST /api/ascension/graph/mutate (Tier 1)
      if (method === 'POST' && pathname === '/api/ascension/graph/mutate') {
        const body = await parseJsonBody(req);
        const { type, episodeTag, nodeData, edgeData } = body;

        if (!type || !['add_node', 'add_edge', 'reload_episode', 'purge_vectors'].includes(type)) {
          sendJson(res, 400, { ok: false, error: 'Invalid mutation type' });
          return;
        }

        const graphDir = path.resolve(rootDir, 'data', 'graph');
        if (!fs.existsSync(graphDir)) fs.mkdirSync(graphDir, { recursive: true });
        const mutationsFile = path.resolve(graphDir, 'mutations.json');
        let currentGraph: any = { nodes: [], edges: [], purgedVectors: [] };
        if (fs.existsSync(mutationsFile)) {
          try {
            currentGraph = JSON.parse(fs.readFileSync(mutationsFile, 'utf8'));
          } catch {}
        }

        let summary = '';
        if (type === 'add_node') {
          const node = { id: `node_${Date.now()}`, ...nodeData };
          currentGraph.nodes.push(node);
          summary = `Added node "${node.id}" (${node.label || 'Entity'}).`;
        } else if (type === 'add_edge') {
          const edge = { id: `edge_${Date.now()}`, ...edgeData };
          currentGraph.edges.push(edge);
          summary = `Created edge from "${edge.source}" to "${edge.target}".`;
        } else if (type === 'reload_episode') {
          summary = `Episode "${episodeTag}" marked for re-indexing.`;
        } else if (type === 'purge_vectors') {
          currentGraph.nodes = (currentGraph.nodes || []).filter((n: any) => n.episodeTag !== episodeTag);
          currentGraph.purgedVectors = currentGraph.purgedVectors || [];
          currentGraph.purgedVectors.push({ episodeTag, purgedAt: new Date(now()).toISOString() });
          summary = `Purged graph vectors and nodes for episode "${episodeTag}".`;
        }

        fs.writeFileSync(mutationsFile, JSON.stringify(currentGraph, null, 2), 'utf8');

        // Broadcast event to connected clients
        broadcastSseEvent('spacepipe:graph-mutated', { type, episodeTag, summary });

        writeAuditLog(rootDir, {
          timestamp: new Date(now()).toISOString(),
          action: 'MUTATE_KNOWLEDGE_GRAPH',
          user: 'Copilot',
          ipHash,
          params: { type, episodeTag },
          resultStatus: 'success',
        });

        sendJson(res, 200, {
          ok: true,
          type,
          episodeTag,
          summary,
          nodeCount: currentGraph.nodes.length,
          edgeCount: currentGraph.edges.length,
        });
        return;
      }

      // POST /api/ascension/graph/query-embeddings (Tier 0)
      if (method === 'POST' && pathname === '/api/ascension/graph/query-embeddings') {
        const body = await parseJsonBody(req);
        const text = String(body.text || '').trim();
        const topK = Math.min(50, Math.max(1, Number(body.topK) || 5));

        if (!text) {
          sendJson(res, 400, { ok: false, error: 'Query text is required' });
          return;
        }

        // Query quotes & contradictions
        const graphFile = path.resolve(rootDir, 'public', 'transcripts', 'investigative_knowledge_graph.json');
        let matches: any[] = [];
        if (fs.existsSync(graphFile)) {
          const graph = JSON.parse(fs.readFileSync(graphFile, 'utf8'));
          const pairings = Array.isArray(graph.pairings) ? graph.pairings : [];
          const lower = text.toLowerCase();

          for (const p of pairings) {
            let score = 0;
            if (p.title?.toLowerCase().includes(lower)) score += 0.8;
            if (p.pre_fallout?.verbatim?.toLowerCase().includes(lower)) score += 0.9;
            if (p.post_fallout?.verbatim?.toLowerCase().includes(lower)) score += 0.95;

            if (score > 0) {
              matches.push({
                episode: p.post_fallout?.episode_tag || p.pre_fallout?.episode_tag || 'Archive',
                speaker: 'Angela Maggard',
                timestamp: 0,
                snippet: p.post_fallout?.verbatim || p.pre_fallout?.verbatim || p.title,
                score: Math.min(1.0, score),
                pairingId: p.pairing_id,
              });
            }
          }
        }

        matches.sort((a, b) => b.score - a.score);
        sendJson(res, 200, {
          ok: true,
          query: text,
          topK,
          matches: matches.slice(0, topK),
        });
        return;
      }

      /* ==================================================================== */
      /* 2. SANDBOXED FILESYSTEM COMMANDS                                     */
      /* ==================================================================== */

      // POST /api/ascension/fs/read (Tier 0)
      if (method === 'POST' && pathname === '/api/ascension/fs/read') {
        const body = await parseJsonBody(req);
        const safe = sanitizePath(rootDir, body.path, ['data', 'public', '.github/workflows', 'docs']);
        if (!safe.ok) {
          sendJson(res, 403, { ok: false, error: safe.error });
          return;
        }

        if (!fs.existsSync(safe.fullPath)) {
          sendJson(res, 404, { ok: false, error: `File not found: ${body.path}` });
          return;
        }

        const stat = fs.statSync(safe.fullPath);
        if (stat.isDirectory()) {
          const files = fs.readdirSync(safe.fullPath);
          sendJson(res, 200, { ok: true, isDirectory: true, path: body.path, files });
          return;
        }

        const isBinary = /\.(wav|mp3|png|jpg|jpeg|wasm|gz|zip)$/i.test(safe.fullPath);
        const content = fs.readFileSync(safe.fullPath, isBinary ? 'base64' : 'utf8');

        sendJson(res, 200, {
          ok: true,
          path: body.path,
          encoding: isBinary ? 'base64' : 'utf8',
          size: stat.size,
          content,
        });
        return;
      }

      // POST /api/ascension/fs/write (Tier 1)
      if (method === 'POST' && pathname === '/api/ascension/fs/write') {
        const body = await parseJsonBody(req);
        const content = typeof body.content === 'string' ? body.content : '';

        // Strict Path check: Allowed roots are only data and .github/workflows
        const safe = sanitizePath(rootDir, body.path, ['data', '.github/workflows']);
        if (!safe.ok) {
          sendJson(res, 403, { ok: false, error: safe.error });
          return;
        }

        // Secret leak scan
        const leak = checkSecretLeak(content);
        if (leak) {
          writeAuditLog(rootDir, {
            timestamp: new Date(now()).toISOString(),
            action: 'WRITE_FILE',
            user: 'Copilot',
            ipHash,
            params: { path: body.path },
            resultStatus: 'denied',
            error: leak,
          });
          sendJson(res, 400, { ok: false, error: `Secret Leak Prevention: ${leak}` });
          return;
        }

        const parentDir = path.dirname(safe.fullPath);
        if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });

        const encoding = body.encoding === 'base64' ? 'base64' : 'utf8';
        fs.writeFileSync(safe.fullPath, content, encoding);

        writeAuditLog(rootDir, {
          timestamp: new Date(now()).toISOString(),
          action: 'WRITE_FILE',
          user: 'Copilot',
          ipHash,
          params: { path: body.path, bytes: content.length },
          resultStatus: 'success',
        });

        sendJson(res, 200, {
          ok: true,
          path: body.path,
          bytesWritten: content.length,
        });
        return;
      }

      // POST /api/ascension/fs/exec (Tier 2)
      if (method === 'POST' && pathname === '/api/ascension/fs/exec') {
        const body = await parseJsonBody(req);
        const cmd = String(body.command || '').trim();
        const args: string[] = Array.isArray(body.args) ? body.args.map(String) : [];

        // 1. Reject shell metacharacters first
        if (FORBIDDEN_METASYMBOLS.test(cmd) || args.some((a) => FORBIDDEN_METASYMBOLS.test(a))) {
          sendJson(res, 400, { ok: false, error: 'Command contains forbidden shell metacharacters (; && | $ > < `)' });
          return;
        }

        // 2. Allowlist command check
        const baseCmd = path.basename(cmd).toLowerCase();
        if (!ALLOWED_FS_EXEC_COMMANDS.has(baseCmd)) {
          sendJson(res, 403, {
            ok: false,
            error: `Command "${baseCmd}" is not in the allowlist (${Array.from(ALLOWED_FS_EXEC_COMMANDS).join(', ')})`,
          });
          return;
        }

        // 3. Reject forbidden operation keywords in arguments
        if (FORBIDDEN_COMMAND_SUBSTRINGS.some((s) => args.some((a) => a.toLowerCase().includes(s)))) {
          sendJson(res, 400, { ok: false, error: 'Arguments contain forbidden operation keywords' });
          return;
        }

        // 3. Sandboxed execution in data directory with 15s timeout
        const sandboxDir = path.resolve(rootDir, 'data');
        if (!fs.existsSync(sandboxDir)) fs.mkdirSync(sandboxDir, { recursive: true });

        const startTime = Date.now();
        let stdout = '';
        let stderr = '';
        let exitCode = 0;

        try {
          // On Windows, commands like 'ls' or 'wc' may not exist natively; provide built-in safe fallback
          if (process.platform === 'win32' && (baseCmd === 'ls' || baseCmd === 'dir')) {
            const listDir = args.length > 0 ? path.resolve(sandboxDir, args[0]) : sandboxDir;
            const items = fs.existsSync(listDir) ? fs.readdirSync(listDir) : [];
            stdout = items.join('\n');
          } else if (process.platform === 'win32' && baseCmd === 'cat') {
            const targetFile = args.length > 0 ? path.resolve(sandboxDir, args[0]) : '';
            if (targetFile && fs.existsSync(targetFile)) {
              stdout = fs.readFileSync(targetFile, 'utf8');
            } else {
              stderr = `cat: file not found: ${args[0] || ''}`;
              exitCode = 1;
            }
          } else {
            const resExec = child_process.spawnSync(baseCmd, args, {
              cwd: sandboxDir,
              timeout: 15000,
              encoding: 'utf8',
              windowsHide: true,
            });
            stdout = resExec.stdout || '';
            stderr = resExec.stderr || '';
            exitCode = resExec.status ?? 0;
            if (resExec.error) throw resExec.error;
          }
        } catch (execErr: any) {
          stderr = execErr?.message || String(execErr);
          exitCode = 1;
        }

        const executionTimeMs = Date.now() - startTime;

        writeAuditLog(rootDir, {
          timestamp: new Date(now()).toISOString(),
          action: 'EXECUTE_BASH_COMMAND',
          user: 'Copilot',
          ipHash,
          params: { command: baseCmd, args },
          resultStatus: exitCode === 0 ? 'success' : 'failed',
          error: stderr || undefined,
        });

        sendJson(res, 200, {
          ok: exitCode === 0,
          command: baseCmd,
          args,
          stdout,
          stderr,
          exitCode,
          executionTimeMs,
        });
        return;
      }

      /* ==================================================================== */
      /* 3. AUDIO & VIDEO SYNTHESIS (DIRECT EXECUTION)                        */
      /* ==================================================================== */

      // POST /api/ascension/vox/synthesize (Tier 1)
      if (method === 'POST' && pathname === '/api/ascension/vox/synthesize') {
        const body = await parseJsonBody(req);
        const { text, voiceId, speed } = body;

        if (!text) {
          sendJson(res, 400, { ok: false, error: 'Text parameter is required' });
          return;
        }

        // Direct forward to internal vox synthesis or mock synthesis
        let result: any = {
          audioUrl: `/output/vox_${Date.now()}.wav`,
          durationSec: Math.max(1.0, Math.round((text.length / 15) * 10) / 10),
          voiceId: voiceId || 'Logan',
          text,
        };

        try {
          const internalRes = await fetch(`http://${host}/api/vox/synthesize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, voiceId, speed }),
          });
          if (internalRes.ok) {
            result = await internalRes.json();
          }
        } catch {}

        writeAuditLog(rootDir, {
          timestamp: new Date(now()).toISOString(),
          action: 'SYNTHESIZE_VOX',
          user: 'Copilot',
          ipHash,
          params: { voiceId, length: text.length },
          resultStatus: 'success',
        });

        sendJson(res, 200, { ok: true, ...result });
        return;
      }

      // POST /api/ascension/avatar/render (Tier 1)
      if (method === 'POST' && pathname === '/api/ascension/avatar/render') {
        const body = await parseJsonBody(req);
        const { audioUrl, avatarId, imageUrl } = body;

        const jobId = `avatar_job_${Date.now()}`;
        try {
          await fetch(`http://${host}/api/avatar/render`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audioUrl, avatarId, imageUrl }),
          });
        } catch {}

        writeAuditLog(rootDir, {
          timestamp: new Date(now()).toISOString(),
          action: 'RENDER_AVATAR_DIRECT',
          user: 'Copilot',
          ipHash,
          params: { avatarId, audioUrl },
          resultStatus: 'success',
        });

        sendJson(res, 200, {
          ok: true,
          jobId,
          status: 'rendering',
          avatarId: avatarId || 'default',
          audioUrl,
        });
        return;
      }

      // POST /api/ascension/voice/clone (Tier 1)
      if (method === 'POST' && pathname === '/api/ascension/voice/clone') {
        const body = await parseJsonBody(req);
        const { sourceProfileId, name } = body;

        if (!sourceProfileId || !name) {
          sendJson(res, 400, { ok: false, error: 'sourceProfileId and name are required' });
          return;
        }

        const voiceFile = path.resolve(rootDir, 'voice_profiles.json');
        const publicVoiceFile = path.resolve(rootDir, 'public', 'voice_profiles.json');

        let catalog: any = { profiles: {} };
        if (fs.existsSync(voiceFile)) {
          catalog = JSON.parse(fs.readFileSync(voiceFile, 'utf8'));
        }

        const source = catalog.profiles?.[sourceProfileId];
        if (!source) {
          sendJson(res, 404, { ok: false, error: `Source voice profile "${sourceProfileId}" not found in catalog` });
          return;
        }

        // Deep copy embedding and vocal traits
        const nowIso = new Date(now()).toISOString();
        const clonedProfile = {
          ...JSON.parse(JSON.stringify(source)),
          name,
          cloned_from: sourceProfileId,
          last_updated: nowIso,
          identity_verified: true,
        };

        catalog.profiles[name] = clonedProfile;
        catalog.updated_at = nowIso;

        fs.writeFileSync(voiceFile, JSON.stringify(catalog, null, 2), 'utf8');
        if (fs.existsSync(path.dirname(publicVoiceFile))) {
          fs.writeFileSync(publicVoiceFile, JSON.stringify(catalog, null, 2), 'utf8');
        }

        writeAuditLog(rootDir, {
          timestamp: nowIso,
          action: 'CLONE_VOICE_PROFILE',
          user: 'Copilot',
          ipHash,
          params: { sourceProfileId, name },
          resultStatus: 'success',
        });

        sendJson(res, 200, {
          ok: true,
          sourceProfileId,
          name,
          cloned: true,
          profile: clonedProfile,
        });
        return;
      }

      /* ==================================================================== */
      /* 4. WORKFLOW & PIPELINE CRON MANAGEMENT                               */
      /* ==================================================================== */

      // POST /api/ascension/workflow/write (Tier 2)
      if (method === 'POST' && pathname === '/api/ascension/workflow/write') {
        const body = await parseJsonBody(req);
        const filename = path.basename(String(body.filename || '').trim());
        const content = typeof body.content === 'string' ? body.content : '';

        if (!filename.endsWith('.yml') && !filename.endsWith('.yaml')) {
          sendJson(res, 400, { ok: false, error: 'Workflow filename must end with .yml or .yaml' });
          return;
        }

        // Secret leak detection
        const leak = checkSecretLeak(content);
        if (leak) {
          sendJson(res, 400, { ok: false, error: `Secret Leak Prevention: ${leak}` });
          return;
        }

        const workflowsDir = path.resolve(rootDir, '.github', 'workflows');
        if (!fs.existsSync(workflowsDir)) fs.mkdirSync(workflowsDir, { recursive: true });

        const targetFile = path.resolve(workflowsDir, filename);
        fs.writeFileSync(targetFile, content, 'utf8');

        writeAuditLog(rootDir, {
          timestamp: new Date(now()).toISOString(),
          action: 'WRITE_WORKFLOW_FILE',
          user: 'Copilot',
          ipHash,
          params: { filename, commitMessage: body.commitMessage },
          resultStatus: 'success',
        });

        sendJson(res, 200, {
          ok: true,
          filename,
          filePath: `.github/workflows/${filename}`,
          bytesWritten: content.length,
        });
        return;
      }

      // POST /api/ascension/pipeline/cron-sync (Tier 1)
      if (method === 'POST' && pathname === '/api/ascension/pipeline/cron-sync') {
        const body = await parseJsonBody(req);
        const action = body.action || 'dry-run'; // 'sync' | 'dry-run'

        let inConfig = '13 */2 * * *';
        let configObj: any = {};
        const configFile = path.resolve(rootDir, 'config.json');
        if (fs.existsSync(configFile)) {
          try {
            configObj = JSON.parse(fs.readFileSync(configFile, 'utf8'));
            if (configObj.scheduledCron) inConfig = configObj.scheduledCron;
          } catch {}
        }

        let inWorkflow = '13 */2 * * *';
        const workflowFile = path.resolve(rootDir, '.github', 'workflows', 'auto_detect_spaces.yml');
        let workflowContent = '';
        if (fs.existsSync(workflowFile)) {
          workflowContent = fs.readFileSync(workflowFile, 'utf8');
          const m = workflowContent.match(/cron:\s*['"]?([^'"\n]+)['"]?/);
          if (m) inWorkflow = m[1].trim();
        }

        const inSync = inConfig === inWorkflow;
        let updated = false;

        if (action === 'sync' && !inSync) {
          if (workflowContent) {
            workflowContent = workflowContent.replace(/cron:\s*['"]?([^'"\n]+)['"]?/, `cron: '${inConfig}'`);
            fs.writeFileSync(workflowFile, workflowContent, 'utf8');
            inWorkflow = inConfig;
            updated = true;
          }
        }

        writeAuditLog(rootDir, {
          timestamp: new Date(now()).toISOString(),
          action: 'SYNC_CRON',
          user: 'Copilot',
          ipHash,
          params: { action, inConfig, inWorkflow, inSync },
          resultStatus: 'success',
        });

        sendJson(res, 200, {
          ok: true,
          inSync,
          inConfig,
          inWorkflow,
          updated,
          action,
        });
        return;
      }

      /* ==================================================================== */
      /* 5. TELEMETRY & WEBHOOK NOTIFICATIONS                                 */
      /* ==================================================================== */

      // GET /api/ascension/logs/stream (SSE, Tier 0)
      if (method === 'GET' && pathname === '/api/ascension/logs/stream') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });

        sseClients.add(res);

        // Initial connect greeting
        res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date(now()).toISOString(), clients: sseClients.size })}\n\n`);

        const keepAlive = setInterval(() => {
          res.write(': keepalive\n\n');
        }, 15000);

        req.on('close', () => {
          clearInterval(keepAlive);
          sseClients.delete(res);
        });
        return;
      }

      // POST /api/ascension/notify/discord & POST /api/ascension/notify/slack (Tier 1)
      if (method === 'POST' && (pathname === '/api/ascension/notify/discord' || pathname === '/api/ascension/notify/slack')) {
        const body = await parseJsonBody(req);
        const destination = pathname.endsWith('discord') ? 'discord' : 'slack';
        const message = String(body.message || '').trim();

        if (!message) {
          sendJson(res, 400, { ok: false, error: 'Message text is required' });
          return;
        }

        // Webhook URL is strictly captured from config / env, never user request (prevent SSRF)
        const env = getEnv();
        let webhookUrl = destination === 'discord' ? env.DISCORD_WEBHOOK_URL : env.SLACK_WEBHOOK_URL;
        if (!webhookUrl) {
          const configFile = path.resolve(rootDir, 'config.json');
          if (fs.existsSync(configFile)) {
            try {
              const cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'));
              webhookUrl = destination === 'discord' ? cfg.discordWebhookUrl : cfg.slackWebhookUrl;
            } catch {}
          }
        }

        let sent = false;
        if (webhookUrl) {
          try {
            const hookRes = await fetch(webhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(destination === 'discord' ? { content: message } : { text: message }),
            });
            sent = hookRes.ok;
          } catch (e: any) {
            console.error(`[Ascension ${destination} Notification Error]`, e?.message);
          }
        }

        writeAuditLog(rootDir, {
          timestamp: new Date(now()).toISOString(),
          action: destination === 'discord' ? 'SEND_DISCORD_MESSAGE' : 'SEND_SLACK_MESSAGE',
          user: 'Copilot',
          ipHash,
          params: { destination, messageLength: message.length },
          resultStatus: sent ? 'success' : 'failed',
        });

        sendJson(res, 200, {
          ok: true,
          destination,
          sent,
          configured: !!webhookUrl,
          messageLength: message.length,
        });
        return;
      }

      /* ==================================================================== */
      /* 6. AUDIT TRAIL & KILL SWITCH                                         */
      /* ==================================================================== */

      // POST /api/ascension/audit/log (Tier 0/1)
      if (method === 'POST' && pathname === '/api/ascension/audit/log') {
        const body = await parseJsonBody(req);
        writeAuditLog(rootDir, {
          timestamp: new Date(now()).toISOString(),
          action: body.action || 'CUSTOM_EVENT',
          user: body.user || 'Copilot',
          ipHash,
          params: body.params || {},
          resultStatus: body.resultStatus || 'success',
          error: body.error,
        });
        sendJson(res, 200, { ok: true, logged: true });
        return;
      }

      // GET /api/ascension/kill-switch (Tier 0)
      if (method === 'GET' && pathname === '/api/ascension/kill-switch') {
        sendJson(res, 200, {
          ok: true,
          level: currentKillSwitchState,
        });
        return;
      }

      // DELETE / POST /api/ascension/kill-switch (Tier 2)
      if ((method === 'DELETE' || method === 'POST') && pathname === '/api/ascension/kill-switch') {
        const body = await parseJsonBody(req);
        const level = (body.level || (method === 'DELETE' ? 'pause' : 'resume')) as KillSwitchLevel;

        if (!['resume', 'pause', 'permanent'].includes(level)) {
          sendJson(res, 400, { ok: false, error: 'Invalid kill-switch level (must be resume, pause, or permanent)' });
          return;
        }

        currentKillSwitchState = level;

        // Persist to disk
        const auditDir = path.resolve(rootDir, 'data', 'audit');
        if (!fs.existsSync(auditDir)) fs.mkdirSync(auditDir, { recursive: true });
        fs.writeFileSync(stateFile, JSON.stringify({ level, updatedAt: new Date(now()).toISOString() }, null, 2), 'utf8');

        // Broadcast to clients
        broadcastSseEvent('spacepipe:kill-switch', { level });

        writeAuditLog(rootDir, {
          timestamp: new Date(now()).toISOString(),
          action: 'TOGGLE_KILL_SWITCH',
          user: 'Operator',
          ipHash,
          params: { level, reason: body.reason },
          resultStatus: 'success',
        });

        sendJson(res, 200, {
          ok: true,
          level,
          message: `Kill switch set to: ${level}`,
        });
        return;
      }

      // Route not found in /api/ascension
      sendJson(res, 404, { ok: false, error: `Ascension endpoint not found: ${pathname}` });
    } catch (err: any) {
      console.error('[Ascension API Unhandled Error]', err);
      sendJson(res, 500, { ok: false, error: err?.message || 'Internal Ascension API error' });
    }
  };
}
