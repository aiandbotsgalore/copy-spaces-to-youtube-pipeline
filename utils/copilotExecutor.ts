/**
 * SpacePipe Copilot Action Execution Boundary.
 * Enforces:
 *   1. Validate: Every action parsed through Zod schema.
 *   2. Authorize: Tiers checked; Tier 2 strictly requires confirmed=true.
 *   3. Secret Guard: Secrets (githubToken, API keys) strictly forbidden from write.
 *   4. Snapshot: Pre-mutation state captured for deterministic revert.
 *   5. Report: Honest statuses ('accepted' for dispatches, 'completed' for synchronous).
 */
import {
  validateActionParams,
  resolveActionTier,
  containsForbiddenSecretKey,
} from './contracts/copilotActions';
import type {
  CopilotAction,
  ActionExecutionStatus,
  ActionSnapshot,
} from './copilotTypes';
import { EnhancedConfig } from '../types';
import {
  appendLineToRepositoryTextFile,
  dispatchWorkflow,
  readRepositoryTextFile,
  getRepositoryDefaultBranch,
  getWorkflowRuns,
} from './github';
import { scriptApi, RoleChoice } from './scriptClient';

export interface CopilotExecutionContext {
  config: EnhancedConfig;
  updateConfig: (updates: Partial<EnhancedConfig>) => void;
  montage: {
    clips: any[];
    addClip: (clip: any) => void;
    updateClip: (id: string, patch: any) => void;
    replaceClips: (clips: any[]) => void;
    startAudition: (index?: number) => void;
    stopAudition: () => void;
    canUndo?: boolean;
    undo?: () => void;
  };
  player: {
    play: (track: { id: string | number; title: string; audioUrl: string }, seekSec?: number) => void;
    pause?: () => void;
    togglePlay?: () => void;
    seek: (sec: number) => void;
    isPlaying?: boolean;
  };
  contextPayload?: {
    currentEpisode?: {
      releaseId?: number;
      releaseTag?: string;
      title?: string;
      audioUrl?: string;
    };
  };
  navHandler?: (panel: string) => void;
  loadEpisodeHandler?: (tag: string) => void;
}

export interface ExecutionResult {
  ok: boolean;
  status: ActionExecutionStatus;
  resultData?: Record<string, any>;
  snapshot?: ActionSnapshot;
  errorMessage?: string;
}

/**
 * Single allowlisted execution boundary for all Copilot actions.
 */
export async function executeCopilotAction(
  action: CopilotAction,
  ctx: CopilotExecutionContext,
  options?: { confirmed?: boolean; triggerSource?: 'user' | 'auto_apply' | 'palette' | 'chain' }
): Promise<ExecutionResult> {
  // 1. Validate action parameters with Zod
  const validation = validateActionParams(action.action, action.params);
  if (!validation.ok) {
    return {
      ok: false,
      status: 'failed',
      errorMessage: validation.error,
    };
  }
  const params = validation.data;

  // 2. Authorize via Security Tier
  const tier = resolveActionTier(action.action, params);
  if (tier === 2 && !options?.confirmed) {
    return {
      ok: false,
      status: 'pending',
      errorMessage: 'Action requires explicit user confirmation before execution.',
    };
  }

  // 3. Execution
  try {
    switch (action.action) {
      /* ─── MONTAGE EDITS (Tier 1, with undo snapshot) ─── */
      case 'CREATE_CLIP': {
        const snapshot: ActionSnapshot = {
          type: 'montage_clips',
          timestamp: Date.now(),
          data: JSON.parse(JSON.stringify(ctx.montage.clips)),
        };

        const newClipId = `clip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const start = params.startSec;
        const end = params.endSec;
        const score = params.viralScore ?? 75;

        ctx.montage.addClip({
          id: newClipId,
          title: params.title || 'Extracted Soundbite',
          quote: params.quote || params.title || '',
          speaker: params.speaker || 'Unknown',
          sourceTitle: params.sourceTitle || ctx.contextPayload?.currentEpisode?.title || 'Episode Space',
          sourceTag: params.episodeTag || ctx.contextPayload?.currentEpisode?.releaseTag,
          audioUrl: params.audioUrl || ctx.contextPayload?.currentEpisode?.audioUrl,
          startSec: start,
          endSec: end,
          category: params.category || 'Highlights',
          severity: Math.min(10, Math.max(1, Math.round(score / 10))),
          tensionScore: Math.min(10, Math.max(1, Math.round(score / 10))),
          directorNote: params.reason || action.explanation,
        });

        return {
          ok: true,
          status: 'completed',
          snapshot,
          resultData: { clipId: newClipId, title: params.title, startSec: start, endSec: end },
        };
      }

      case 'TRIM_CLIP': {
        const snapshot: ActionSnapshot = {
          type: 'montage_clips',
          timestamp: Date.now(),
          data: JSON.parse(JSON.stringify(ctx.montage.clips)),
        };

        const existing = ctx.montage.clips.find(c => c.id === params.clipId);
        if (!existing) {
          return {
            ok: false,
            status: 'failed',
            errorMessage: `Clip ${params.clipId} not found in active montage reel.`,
          };
        }

        ctx.montage.updateClip(params.clipId, {
          startSec: params.newStartSec,
          endSec: params.newEndSec,
          directorNote: params.reason || action.explanation,
        });

        return {
          ok: true,
          status: 'completed',
          snapshot,
          resultData: { clipId: params.clipId, newStartSec: params.newStartSec, newEndSec: params.newEndSec },
        };
      }

      case 'SEQUENCE_MONTAGE': {
        const snapshot: ActionSnapshot = {
          type: 'montage_clips',
          timestamp: Date.now(),
          data: JSON.parse(JSON.stringify(ctx.montage.clips)),
        };

        const currentClips = [...ctx.montage.clips];
        const clipMap = new Map(currentClips.map(c => [c.id, c]));
        const reordered = params.clipIds
          .map((id: string) => clipMap.get(id))
          .filter(Boolean);

        if (reordered.length === 0) {
          return {
            ok: false,
            status: 'failed',
            errorMessage: 'None of the specified clipIds exist in the active montage reel.',
          };
        }

        if (params.tensionScores) {
          reordered.forEach((c: any) => {
            if (params.tensionScores[c.id] !== undefined) {
              c.tensionScore = Number(params.tensionScores[c.id]);
            }
            if (params.reason) c.directorNote = params.reason;
          });
        }

        ctx.montage.replaceClips(reordered);

        return {
          ok: true,
          status: 'completed',
          snapshot,
          resultData: { count: reordered.length, sequence: reordered.map((c: any) => c.id) },
        };
      }

      /* ─── AUDIO PLAYBACK & TRANSPORT (Tier 0) ─── */
      case 'AUDITION_MONTAGE': {
        ctx.montage.startAudition(params.startFromIndex || 0);
        return { ok: true, status: 'completed' };
      }

      case 'PLAY_AUDIO': {
        const targetUrl = params.audioUrl || ctx.contextPayload?.currentEpisode?.audioUrl;
        if (targetUrl) {
          ctx.player.play(
            {
              id: ctx.contextPayload?.currentEpisode?.releaseId || Date.now(),
              title: params.title || ctx.contextPayload?.currentEpisode?.title || 'Episode Audio',
              audioUrl: targetUrl,
            },
            params.timestampSec || 0
          );
        } else if (params.timestampSec !== undefined) {
          ctx.player.seek(params.timestampSec);
        }
        return { ok: true, status: 'completed' };
      }

      case 'PAUSE_AUDIO': {
        if (ctx.player.pause) {
          ctx.player.pause();
        } else if (ctx.player.isPlaying && ctx.player.togglePlay) {
          ctx.player.togglePlay();
        }
        return { ok: true, status: 'completed' };
      }

      case 'SEEK_AUDIO': {
        ctx.player.seek(params.timestampSec);
        return { ok: true, status: 'completed' };
      }

      /* ─── NAVIGATION & VIEW (Tier 0) ─── */
      case 'NAVIGATE_TAB': {
        if (ctx.navHandler) {
          ctx.navHandler(params.tab);
          return { ok: true, status: 'completed', resultData: { tab: params.tab } };
        }
        return { ok: false, status: 'failed', errorMessage: 'Navigation handler unavailable.' };
      }

      case 'LOAD_EPISODE': {
        if (ctx.loadEpisodeHandler) {
          ctx.loadEpisodeHandler(params.episodeTag);
        } else if (ctx.navHandler) {
          ctx.navHandler('transcripts');
        }
        return { ok: true, status: 'completed', resultData: { episodeTag: params.episodeTag } };
      }

      /* ─── CONFIGURATION UPDATES (Tier 1 or Tier 2) ─── */
      case 'UPDATE_CONFIG': {
        // Enforce secret blocking
        const forbidden = containsForbiddenSecretKey(params.updates);
        if (forbidden) {
          return {
            ok: false,
            status: 'failed',
            errorMessage: `Security violation: writing '${forbidden}' is strictly blocked.`,
          };
        }

        // Snapshot current safe config values
        const currentSafeSnapshot: Record<string, any> = {};
        for (const key of Object.keys(params.updates)) {
          currentSafeSnapshot[key] = (ctx.config as any)[key];
        }

        const snapshot: ActionSnapshot = {
          type: 'config',
          timestamp: Date.now(),
          data: currentSafeSnapshot,
        };

        ctx.updateConfig(params.updates);
        return {
          ok: true,
          status: 'completed',
          snapshot,
          resultData: { updatedKeys: Object.keys(params.updates) },
        };
      }

      /* ─── QUEUE INGESTION (Tier 2, Persistent GitHub Commit) ─── */
      case 'ENQUEUE_SPACE': {
        const { githubToken, ownerName, repoName } = ctx.config;
        if (!githubToken || !ownerName || !repoName) {
          return {
            ok: false,
            status: 'failed',
            errorMessage: 'GitHub Token, Owner, and Repo must be configured to enqueue a Space.',
          };
        }

        const targetQueue = params.targetQueue || 'space_queue.txt';
        const commitMsg = `chore(queue): enqueue ${params.url} via SpacePipe Copilot`;

        await appendLineToRepositoryTextFile(
          githubToken,
          ownerName.trim(),
          repoName.trim(),
          targetQueue,
          params.url,
          commitMsg
        );

        // Honest status: 'accepted' (queued for CI/CD, not completed download)
        return {
          ok: true,
          status: 'accepted',
          resultData: { url: params.url, queue: targetQueue, repo: `${ownerName}/${repoName}` },
        };
      }

      /* ─── WORKFLOW DISPATCH (Tier 2, GitHub Actions) ─── */
      case 'DISPATCH_WORKFLOW': {
        const { githubToken, ownerName, repoName } = ctx.config;
        if (!githubToken || !ownerName || !repoName) {
          return {
            ok: false,
            status: 'failed',
            errorMessage: 'GitHub Token, Owner, and Repo must be configured to dispatch workflows.',
          };
        }

        await dispatchWorkflow(
          githubToken,
          ownerName.trim(),
          repoName.trim(),
          params.workflowFile,
          params.inputs || {},
          params.ref
        );

        // Honest status: 'accepted' (dispatched to runner, not completed execution)
        return {
          ok: true,
          status: 'accepted',
          resultData: {
            workflowFile: params.workflowFile,
            inputs: params.inputs,
            repo: `${ownerName}/${repoName}`,
          },
        };
      }

      /* ─── READ-ONLY PULL ACTIONS (Tier 0) ─── */
      case 'SEARCH_TRANSCRIPTS': {
        return { ok: true, status: 'completed' };
      }

      case 'GET_QUEUE': {
        const { githubToken, ownerName, repoName } = ctx.config;
        if (!githubToken || !ownerName || !repoName) {
          return {
            ok: true,
            status: 'completed',
            resultData: { queueStatus: 'unavailable', message: 'GitHub connection not configured.' },
          };
        }

        const branch = await getRepositoryDefaultBranch(githubToken, ownerName.trim(), repoName.trim());
        const filesToRead =
          params.queue === 'all'
            ? ['space_queue.txt', 'batch_queue.txt']
            : [params.queue];

        const queues: Record<string, string[]> = {};
        for (const file of filesToRead) {
          try {
            const data = await readRepositoryTextFile(githubToken, ownerName.trim(), repoName.trim(), file, branch);
            queues[file] = (data?.content || '')
              .split('\n')
              .map(l => l.trim())
              .filter(l => Boolean(l) && !l.startsWith('#'));
          } catch {
            queues[file] = [];
          }
        }

        return {
          ok: true,
          status: 'completed',
          resultData: { queues },
        };
      }

      case 'GET_RUN_HISTORY': {
        const { githubToken, ownerName, repoName } = ctx.config;
        if (!githubToken || !ownerName || !repoName) {
          return {
            ok: true,
            status: 'completed',
            resultData: { runStatus: 'unavailable', message: 'GitHub connection not configured.' },
          };
        }

        const runs = await getWorkflowRuns(githubToken, ownerName.trim(), repoName.trim());
        let filtered = runs;
        if (params.status === 'active') {
          filtered = runs.filter(r => r.status === 'in_progress' || r.status === 'queued');
        } else if (params.status === 'failed') {
          filtered = runs.filter(r => r.conclusion === 'failure');
        } else if (params.status === 'completed') {
          filtered = runs.filter(r => r.status === 'completed');
        }

        const sample = filtered.slice(0, params.limit).map(r => ({
          id: r.id,
          name: r.name,
          status: r.status,
          conclusion: r.conclusion,
          createdAt: r.created_at,
          htmlUrl: r.html_url,
        }));

        return {
          ok: true,
          status: 'completed',
          resultData: { total: filtered.length, runs: sample },
        };
      }

      case 'GET_VOICE_PROFILES': {
        try {
          const res = await fetch('/voice_profiles.json');
          const data = res.ok ? await res.json() : {};
          const profiles = data.profiles || {};
          const list = Object.entries(profiles).map(([name, p]: [string, any]) => ({
            name,
            enrolled: !!p.embedding,
            avatarUrl: p.avatarUrl || null,
            traits: p.traits || [],
          }));

          let filtered = list;
          if (params.filter === 'enrolled') {
            filtered = list.filter(p => p.enrolled);
          } else if (params.filter === 'missing_avatar') {
            filtered = list.filter(p => !p.avatarUrl);
          }

          return {
            ok: true,
            status: 'completed',
            resultData: { count: filtered.length, profiles: filtered },
          };
        } catch {
          return {
            ok: true,
            status: 'completed',
            resultData: { count: 0, profiles: [] },
          };
        }
      }

      case 'GET_SCRIPT_PROJECTS': {
        try {
          const r = await scriptApi.projects();
          const projects = (r.projects || []).slice(0, params.limit).map(p => ({
            id: p.id,
            title: p.title,
            format: p.format,
            sourcesCount: p.sourceTags?.length || 0,
            clipsCount: p.clips?.length || 0,
            updatedAt: p.updatedAt,
          }));
          return {
            ok: true,
            status: 'completed',
            resultData: { total: r.projects?.length || 0, projects },
          };
        } catch (e: any) {
          return {
            ok: false,
            status: 'failed',
            errorMessage: e?.message || 'Failed to list Script Studio projects.',
          };
        }
      }

      /* ─── SCRIPT STUDIO PIPELINE STAGES (Tier 2) ─── */
      case 'CREATE_PROJECT': {
        const res = await scriptApi.createProject(params.releaseTags, params.targetRuntimeSec, {
          format: params.format,
          thesis: params.thesis,
        });
        return {
          ok: true,
          status: 'completed',
          resultData: { projectId: res.project.id, title: res.project.title },
        };
      }

      case 'ANALYZE_PROJECT': {
        const res = await scriptApi.analyze(
          params.projectId,
          { mode: params.mode, roleMap: {}, maxUsd: params.maxUsd },
          params.force
        );
        return {
          ok: true,
          status: 'completed',
          resultData: { projectId: params.projectId, analyses: Object.keys(res.analyses || {}) },
        };
      }

      case 'OUTLINE_PROJECT': {
        const res = await scriptApi.outline(params.projectId, {
          mode: params.mode,
          roleMap: {},
          maxUsd: params.maxUsd,
        });
        return {
          ok: true,
          status: 'completed',
          resultData: { projectId: params.projectId, versionId: res.version.id, scenes: res.version.segments?.length },
        };
      }

      case 'DRAFT_PROJECT': {
        const res = await scriptApi.draft(params.projectId, {
          mode: params.mode,
          roleMap: {},
          maxUsd: params.maxUsd,
        });
        return {
          ok: true,
          status: 'completed',
          resultData: { projectId: params.projectId, versionId: res.version.id, gates: res.gates },
        };
      }

      case 'REFINE_PROJECT': {
        const roles: RoleChoice = {
          mode: params.mode || 'fallback',
          roleMap: {},
          maxUsd: params.maxUsd || 1.5,
        };
        const res = await scriptApi.refine(
          params.projectId,
          roles,
          { critiqueOnly: false }
        );
        return {
          ok: true,
          status: 'accepted',
          resultData: { projectId: params.projectId, runId: res.runId },
        };
      }

      case 'SYNTHESIZE_VOX': {
        const res = await fetch('/api/vox/synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: params.text, voiceId: params.voiceId }),
        });
        if (!res.ok) {
          throw new Error(`Vox synthesis failed with status ${res.status}`);
        }
        const data = await res.json();
        return {
          ok: true,
          status: 'completed',
          resultData: { audioUrl: data.takeUrl || data.url, durationSec: data.durationSec },
        };
      }

      case 'RENDER_AVATAR': {
        const res = await fetch('/api/avatar/render', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clipId: params.clipId, avatarId: params.avatarId }),
        });
        if (!res.ok) {
          throw new Error(`Avatar render failed with status ${res.status}`);
        }
        const data = await res.json();
        return {
          ok: true,
          status: 'accepted',
          resultData: { jobId: data.jobId || data.id },
        };
      }

      default:
        return {
          ok: false,
          status: 'failed',
          errorMessage: `Unsupported action type: ${(action as any).action}`,
        };
    }
  } catch (err: any) {
    return {
      ok: false,
      status: 'failed',
      errorMessage: err?.message || String(err),
    };
  }
}

/**
 * Deterministically rolls back a Tier 1 mutation action using its captured pre-state snapshot.
 */
export async function revertCopilotAction(
  action: CopilotAction,
  ctx: CopilotExecutionContext
): Promise<boolean> {
  try {
    if (action.snapshot?.type === 'montage_clips' && Array.isArray(action.snapshot.data)) {
      ctx.montage.replaceClips(action.snapshot.data);
      return true;
    }

    if (action.snapshot?.type === 'config' && action.snapshot.data && typeof action.snapshot.data === 'object') {
      ctx.updateConfig(action.snapshot.data);
      return true;
    }

    // Fallback: if montage has native undo and target was last added
    if (action.action === 'CREATE_CLIP' || action.action === 'SEQUENCE_MONTAGE') {
      if (ctx.montage.canUndo && ctx.montage.undo) {
        ctx.montage.undo();
        return true;
      }
    }

    return false;
  } catch (err) {
    console.error('Failed to revert action:', err);
    return false;
  }
}
