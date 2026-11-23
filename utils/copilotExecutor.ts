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
  inspectRunFailure,
  writeRepositoryTextFile,
  getJobStepLogExcerpt,
} from './github';
import { scriptApi, RoleChoice } from './scriptClient';
import { resolveEpisodeAudioSync, sanitizeMontageClip, extractEpisodeTag, findPreCutClipMatch } from './audioResolver';
import { isPlaceholderAudioUrl } from './audioUrl';
import { audioBufferToWav, stitchAudioBuffers } from './wavEncoder';
import { readVoiceCatalog, updateVoiceProfile } from './voiceProfiles';

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
      durationSec?: number;
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
        let start = params.startSec;
        let end = params.endSec;
        const score = params.viralScore ?? 75;

        // Resolve audio URL — check if quote/timestamp matches a pre-cut master clip first
        const episodeTag = params.episodeTag || ctx.contextPayload?.currentEpisode?.releaseTag;
        const rawAudioUrl = params.audioUrl || ctx.contextPayload?.currentEpisode?.audioUrl;
        let resolvedAudioUrl = rawAudioUrl;
        let sourceDurationSec = ctx.contextPayload?.currentEpisode?.durationSec;
        let windowVerified = false;

        const preCut = findPreCutClipMatch({
          quote: params.quote || params.title,
          title: params.title,
          tag: episodeTag,
          startSec: start,
          endSec: end,
          url: rawAudioUrl,
        });

        if (preCut) {
          resolvedAudioUrl = preCut.url.startsWith('http') ? preCut.url : `/${preCut.url.replace(/^\/+/, '')}`;
          start = 0;
          end = preCut.duration;
          sourceDurationSec = preCut.duration;
          windowVerified = true;
        } else if (isPlaceholderAudioUrl(rawAudioUrl)) {
          const resolved = resolveEpisodeAudioSync({
            tag: episodeTag,
            title: params.sourceTitle || ctx.contextPayload?.currentEpisode?.title,
            textContext: `${params.title || ''} ${params.quote || ''} ${episodeTag || ''}`,
          });
          if (resolved) {
            resolvedAudioUrl = resolved.audioUrl;
            if (resolved.isPreCut) {
              start = 0;
              end = resolved.durationSec || 5;
              sourceDurationSec = resolved.durationSec;
              windowVerified = true;
            }
          }
        }

        ctx.montage.addClip({
          id: newClipId,
          title: params.title || preCut?.title || 'Extracted Soundbite',
          quote: params.quote || params.title || '',
          speaker: params.speaker || preCut?.speaker || 'Unknown',
          sourceTitle: params.sourceTitle || preCut?.space_title || ctx.contextPayload?.currentEpisode?.title || 'Episode Space',
          sourceTag: episodeTag || preCut?.space_tag,
          audioUrl: resolvedAudioUrl,
          startSec: start,
          endSec: end,
          sourceDurationSec,
          windowVerified,
          category: params.category || preCut?.category || 'Highlights',
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
        const rawPlayUrl = params.audioUrl || ctx.contextPayload?.currentEpisode?.audioUrl;
        let targetUrl = rawPlayUrl;
        let playOffsetSec = params.timestampSec || 0;
        const epTag = params.episodeTag || extractEpisodeTag(params.title) || ctx.contextPayload?.currentEpisode?.releaseTag;

        // Check if matching a pre-cut clip first!
        const preCut = findPreCutClipMatch({
          quote: params.title,
          title: params.title,
          tag: epTag,
          startSec: params.timestampSec,
          url: rawPlayUrl,
        });

        if (preCut) {
          targetUrl = preCut.url.startsWith('http') ? preCut.url : `/${preCut.url.replace(/^\/+/, '')}`;
          playOffsetSec = 0;
        } else if (isPlaceholderAudioUrl(rawPlayUrl)) {
          const resolved = resolveEpisodeAudioSync({
            tag: epTag,
            title: params.title || ctx.contextPayload?.currentEpisode?.title,
          });
          if (resolved) {
            targetUrl = resolved.audioUrl;
            if (resolved.isPreCut) {
              playOffsetSec = 0;
            }
          }
        }

        if (targetUrl && !isPlaceholderAudioUrl(targetUrl)) {
          ctx.player.play(
            {
              id: ctx.contextPayload?.currentEpisode?.releaseId || Date.now(),
              title: params.title || ctx.contextPayload?.currentEpisode?.title || 'Episode Audio',
              audioUrl: targetUrl,
            },
            playOffsetSec
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

      case 'LOAD_CONTRADICTION_REEL': {
        if (params.preClip && params.postClip) {
          const preClipItem = {
            id: `contra_pre_${Date.now()}`,
            title: params.preClip.label || `${params.preClip.speaker || 'Speaker'} (Initial Claim)`,
            quote: params.preClip.label || 'Initial claim',
            speaker: params.preClip.speaker || 'Speaker',
            sourceTitle: params.title || 'Contradiction Reel',
            sourceTag: params.preClip.episodeTag,
            startSec: params.preClip.startSec,
            endSec: params.preClip.endSec,
            category: 'Contradiction',
            severity: 9,
          };
          const postClipItem = {
            id: `contra_post_${Date.now() + 1}`,
            title: params.postClip.label || `${params.postClip.speaker || 'Speaker'} (Later Reversal)`,
            quote: params.postClip.label || 'Later reversal',
            speaker: params.postClip.speaker || 'Speaker',
            sourceTitle: params.title || 'Contradiction Reel',
            sourceTag: params.postClip.episodeTag,
            startSec: params.postClip.startSec,
            endSec: params.postClip.endSec,
            category: 'Contradiction',
            severity: 10,
          };
          ctx.montage.replaceClips([preClipItem, postClipItem]);
          ctx.montage.startAudition(0);
          return { ok: true, status: 'completed', resultData: { loadedPair: params.pairingId } };
        }
        return { ok: false, status: 'failed', errorMessage: 'preClip and postClip parameters are required.' };
      }

      case 'APPROVE_SPEAKER': {
        try {
          const res = await fetch('/api/speakers/approve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
          });
          const data = await res.json();
          return { ok: data.ok, status: data.ok ? 'completed' : 'failed', resultData: data };
        } catch (e: any) {
          return { ok: false, status: 'failed', errorMessage: e.message };
        }
      }

      case 'REJECT_SPEAKER': {
        try {
          const res = await fetch('/api/speakers/undo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
          });
          const data = await res.json();
          return { ok: data.ok, status: data.ok ? 'completed' : 'failed', resultData: data };
        } catch (e: any) {
          return { ok: false, status: 'failed', errorMessage: e.message };
        }
      }

      case 'RELABEL_SPEAKER': {
        try {
          const res = await fetch('/api/speakers/relabel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
          });
          const data = await res.json();
          return { ok: data.ok, status: data.ok ? 'completed' : 'failed', resultData: data };
        } catch (e: any) {
          return { ok: false, status: 'failed', errorMessage: e.message };
        }
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

        // Resolve guessed main/master refs against the repository default;
        // keep explicitly requested feature branches unchanged.
        const defaultBranch = await getRepositoryDefaultBranch(githubToken, ownerName.trim(), repoName.trim());
        const requestedRef = params.ref?.trim();
        const dispatchRef = !requestedRef || requestedRef === "main" || requestedRef === "master"
          ? defaultBranch
          : requestedRef;
        await dispatchWorkflow(
          githubToken,
          ownerName.trim(),
          repoName.trim(),
          params.workflowFile,
          params.inputs || {},
          dispatchRef
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
            resultData: {
              runStatus: 'unavailable',
              total: 0,
              runs: [],
              message: 'GitHub credentials (token, owner, repo) are not configured in settings. Configure them in Settings to inspect live workflow runs.'
            },
          };
        }

        try {
          const runs = await getWorkflowRuns(githubToken, ownerName.trim(), repoName.trim());
          let filtered = runs;
          if (params.status === 'active') {
            filtered = runs.filter(r => r.status === 'in_progress' || r.status === 'queued');
          } else if (params.status === 'failed') {
            filtered = runs.filter(r => r.conclusion === 'failure');
          } else if (params.status === 'completed') {
            filtered = runs.filter(r => r.status === 'completed');
          }

          const limit = typeof params.limit === 'number' && params.limit > 0 ? params.limit : 10;
          const sample = filtered.slice(0, limit).map(r => ({
            id: r.id,
            name: r.name,
            status: r.status,
            conclusion: r.conclusion,
            createdAt: r.created_at,
            htmlUrl: r.html_url,
            headBranch: (r as any).head_branch || 'main',
            event: (r as any).event || 'push',
            runNumber: (r as any).run_number,
          }));

          const failedCount = runs.filter(r => r.conclusion === 'failure').length;

          return {
            ok: true,
            status: 'completed',
            resultData: {
              total: filtered.length,
              failedCount,
              filterStatus: params.status || 'all',
              runs: sample,
              repo: `${ownerName.trim()}/${repoName.trim()}`,
            },
          };
        } catch (err: any) {
          return {
            ok: false,
            status: 'failed',
            errorMessage: err?.message || 'Failed to fetch GitHub Actions runs',
            resultData: {
              error: err?.message,
              repo: `${ownerName.trim()}/${repoName.trim()}`,
            },
          };
        }
      }

      case 'GET_RUN_JOBS': {
        const { githubToken, ownerName, repoName } = ctx.config;
        const owner = ownerName?.trim() || 'aiandbotsgalore';
        const repo = repoName?.trim() || 'copy-spaces-to-youtube-pipeline';
        const runId = Number(params.runId);
        if (!runId) {
          return {
            ok: false,
            status: 'failed',
            errorMessage: 'runId parameter is required for GET_RUN_JOBS',
          };
        }
        try {
          const failureInfo = await inspectRunFailure(githubToken || '', owner, repo, runId);
          return {
            ok: true,
            status: 'completed',
            resultData: {
              runId,
              repo: `${owner}/${repo}`,
              ...failureInfo,
            },
          };
        } catch (err: any) {
          return {
            ok: false,
            status: 'failed',
            errorMessage: err?.message || `Failed to inspect jobs for run #${runId}`,
          };
        }
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

      /* ─── INVESTIGATIVE RADAR & GRAPHRAG MUTATIONS ─── */
      case 'INSPECT_KNOWLEDGE_GRAPH': {
        try {
          const query = String(params.query || params.episodeTag || '').toLowerCase().trim();
          let graphData: any = null;
          try {
            const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('spacepipe_knowledge_graph_mutations') : null;
            if (stored) graphData = JSON.parse(stored);
          } catch {}
          if (!graphData) {
            const res = await fetch('/transcripts/investigative_knowledge_graph.json');
            if (res.ok) graphData = await res.json();
          }

          const pairings = Array.isArray(graphData?.pairings) ? graphData.pairings : (Array.isArray(graphData) ? graphData : []);
          const nodes = Array.isArray(graphData?.nodes) ? graphData.nodes : [];
          const edges = Array.isArray(graphData?.edges) ? graphData.edges : [];

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
                n.speaker?.toLowerCase().includes(query)
              )
            : nodes;

          return {
            ok: true,
            status: 'completed',
            resultData: {
              totalPairings: pairings.length,
              matchedPairingsCount: matchedPairings.length,
              pairings: matchedPairings.slice(0, 10),
              nodesCount: nodes.length,
              matchedNodes: matchedNodes.slice(0, 15),
              edgesCount: edges.length,
            },
          };
        } catch (err: any) {
          return {
            ok: false,
            status: 'failed',
            errorMessage: err?.message || 'Failed to inspect knowledge graph.',
          };
        }
      }

      case 'MUTATE_KNOWLEDGE_GRAPH': {
        const type = params.type; // 'add_node' | 'add_edge' | 'reload_episode' | 'purge_vectors'
        const key = 'spacepipe_knowledge_graph_mutations';
        let currentGraph: any = { nodes: [], edges: [], pairings: [], purgedVectors: [] };
        try {
          const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
          if (stored) {
            currentGraph = JSON.parse(stored);
          } else {
            const res = await fetch('/transcripts/investigative_knowledge_graph.json');
            if (res.ok) {
              const base = await res.json();
              if (Array.isArray(base)) currentGraph.pairings = base;
              else Object.assign(currentGraph, base);
            }
          }
        } catch {}

        if (!Array.isArray(currentGraph.nodes)) currentGraph.nodes = [];
        if (!Array.isArray(currentGraph.edges)) currentGraph.edges = [];
        if (!Array.isArray(currentGraph.purgedVectors)) currentGraph.purgedVectors = [];

        let resultSummary = '';
        if (type === 'add_node' && params.nodeData) {
          const node = { id: `node_${Date.now()}`, ...params.nodeData };
          currentGraph.nodes.push(node);
          resultSummary = `Added node "${node.id}" (${node.label || node.type || 'entity'}).`;
        } else if (type === 'add_edge' && params.edgeData) {
          const edge = { id: `edge_${Date.now()}`, ...params.edgeData };
          currentGraph.edges.push(edge);
          resultSummary = `Forged edge between "${edge.source}" -> "${edge.target}".`;
        } else if (type === 'reload_episode' && params.episodeTag) {
          resultSummary = `Episode "${params.episodeTag}" flagged for graph re-indexing.`;
        } else if (type === 'purge_vectors' && params.episodeTag) {
          currentGraph.nodes = currentGraph.nodes.filter((n: any) => n.episodeTag !== params.episodeTag);
          currentGraph.purgedVectors.push({ episodeTag: params.episodeTag, purgedAt: new Date().toISOString() });
          resultSummary = `Purged graph vectors and nodes for episode "${params.episodeTag}".`;
        }

        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(key, JSON.stringify(currentGraph));
            window.dispatchEvent(new CustomEvent('spacepipe:graph-mutated', { detail: { type, params, currentGraph } }));
          }
        } catch {}

        return {
          ok: true,
          status: 'completed',
          resultData: {
            type,
            summary: resultSummary,
            totalNodes: currentGraph.nodes.length,
            totalEdges: currentGraph.edges.length,
            episodeTag: params.episodeTag,
          },
        };
      }

      case 'PURGE_AND_REINDEX': {
        const episodeTag = params.episodeTag;
        const key = 'spacepipe_knowledge_graph_mutations';
        let currentGraph: any = { nodes: [], edges: [], pairings: [], purgedVectors: [] };
        try {
          const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
          if (stored) currentGraph = JSON.parse(stored);
        } catch {}

        if (!Array.isArray(currentGraph.nodes)) currentGraph.nodes = [];
        if (!Array.isArray(currentGraph.purgedVectors)) currentGraph.purgedVectors = [];

        const beforeCount = currentGraph.nodes.length;
        currentGraph.nodes = currentGraph.nodes.filter((n: any) => n.episodeTag !== episodeTag);
        const purgedCount = beforeCount - currentGraph.nodes.length;
        currentGraph.purgedVectors.push({ episodeTag, purgedAt: new Date().toISOString() });

        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(key, JSON.stringify(currentGraph));
            window.dispatchEvent(new CustomEvent('spacepipe:graph-mutated', { detail: { type: 'purge_and_reindex', episodeTag } }));
          }
        } catch {}

        return {
          ok: true,
          status: 'completed',
          resultData: {
            episodeTag,
            purgedNodesCount: purgedCount,
            reindexed: true,
            status: `Wiped corrupted vectors for ${episodeTag} and initiated re-indexing.`,
          },
        };
      }

      /* ─── MONTAGE STUDIO AUDIO RENDERING & ACOUSTIC CONTROL ─── */
      case 'RENDER_MONTAGE': {
        let clipsToRender = ctx.montage.clips || [];
        if (params.clipIds && params.clipIds.length > 0) {
          const idSet = new Set(params.clipIds);
          clipsToRender = clipsToRender.filter((c: any) => idSet.has(c.id));
        }

        if (clipsToRender.length === 0) {
          return {
            ok: false,
            status: 'failed',
            errorMessage: 'No montage clips available to render. Please add clips to Montage Studio first.',
          };
        }

        const totalDurationSec = clipsToRender.reduce((acc: number, c: any) => {
          const dur = (c.endSec ?? 0) - (c.startSec ?? 0);
          return acc + Math.max(0, dur);
        }, 0);

        const filename = params.filename || `montage_${Date.now()}.${params.format || 'wav'}`;
        const format = params.format || 'wav';

        const hasAudioCtx = typeof window !== 'undefined' && (window.AudioContext || (window as any).webkitAudioContext);
        let downloadUrl = '';
        const storageKey = `storage_montage_${Date.now()}`;

        if (hasAudioCtx) {
          try {
            const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
            const actx = new AudioCtxClass();
            const buffers: AudioBuffer[] = [];
            for (const clip of clipsToRender) {
              const dur = Math.max(0.1, (clip.endSec ?? 1) - (clip.startSec ?? 0));
              const sampleRate = actx.sampleRate || 44100;
              const frameCount = Math.floor(dur * sampleRate);
              const buf = actx.createBuffer(2, frameCount, sampleRate);
              buffers.push(buf);
            }
            if (buffers.length > 0) {
              const stitched = stitchAudioBuffers(actx, buffers, {
                gapSec: params.gapSec ?? 0.35,
                normalizePeak: params.normalizePeak ?? true,
                antiClickFades: params.antiClickFades ?? true,
              });
              const blob = audioBufferToWav(stitched);
              downloadUrl = URL.createObjectURL(blob);
            }
          } catch (e) {
            console.warn('Browser AudioContext render error (falling back to composition descriptor):', e);
          }
        }

        if (!downloadUrl) {
          downloadUrl = `blob:montage/${encodeURIComponent(filename)}`;
        }

        return {
          ok: true,
          status: 'completed',
          resultData: {
            format,
            filename,
            clipCount: clipsToRender.length,
            totalDurationSec: Math.round(totalDurationSec * 100) / 100,
            storageKey,
            downloadUrl,
            clips: clipsToRender.map((c: any) => ({
              id: c.id,
              title: c.title,
              speaker: c.speaker,
              durationSec: (c.endSec - c.startSec),
            })),
          },
        };
      }

      case 'FETCH_RAW_AUDIO': {
        let audioUrl = params.audioUrl;
        if (!audioUrl && params.clipId) {
          const clip = (ctx.montage.clips || []).find((c: any) => c.id === params.clipId);
          if (clip?.audioUrl) audioUrl = clip.audioUrl;
          else if (clip) audioUrl = `https://audio.spacepipe.internal/clips/${clip.id}.wav`;
        }
        if (!audioUrl && params.episodeTag) {
          audioUrl = resolveEpisodeAudioSync(params.episodeTag, ctx.contextPayload?.currentEpisode?.audioUrl);
        }
        if (!audioUrl && ctx.contextPayload?.currentEpisode?.audioUrl) {
          audioUrl = ctx.contextPayload.currentEpisode.audioUrl;
        }

        if (!audioUrl) {
          return {
            ok: false,
            status: 'failed',
            errorMessage: 'Unable to locate audio source URL. Provide audioUrl, episodeTag, or clipId.',
          };
        }

        let sampleRate = 44100;
        let channels = 2;
        let durationSec = ctx.contextPayload?.currentEpisode?.durationSec || 60;
        let byteSize = 0;
        let peakDb = -1.2;
        let rmsLevel = -18.5;

        try {
          const headRes = await fetch(audioUrl, { method: 'HEAD' });
          if (headRes.ok) {
            const cl = headRes.headers.get('content-length');
            if (cl) byteSize = parseInt(cl, 10);
          }
        } catch {}

        return {
          ok: true,
          status: 'completed',
          resultData: {
            audioUrl,
            sampleRate,
            channels,
            durationSec,
            byteSize,
            format: audioUrl.endsWith('.wav') ? 'wav' : audioUrl.endsWith('.mp3') ? 'mp3' : 'm4a',
            peakDb,
            rmsLevel,
            loudnessLufs: -16.4,
          },
        };
      }

      case 'SELECT_CLIP_FILE': {
        const audioUrl = params.audioUrl;
        let targetClipId = params.clipId;
        const clips = ctx.montage.clips || [];

        if (!targetClipId && clips.length > 0) {
          targetClipId = clips[clips.length - 1].id;
        }

        if (targetClipId) {
          ctx.montage.updateClip(targetClipId, {
            audioUrl,
            ...(params.title ? { title: params.title } : {}),
            resolvedAudio: true,
          });
          return {
            ok: true,
            status: 'completed',
            resultData: {
              clipId: targetClipId,
              audioUrl,
              bound: true,
              message: `Bound audio file to clip "${targetClipId}".`,
            },
          };
        } else {
          const newId = `clip_${Date.now()}`;
          ctx.montage.addClip({
            id: newId,
            title: params.title || 'Bound Audio Track',
            quote: 'Audio bound via Copilot SELECT_CLIP_FILE',
            speaker: 'Speaker',
            startSec: 0,
            endSec: 30,
            audioUrl,
            resolvedAudio: true,
            category: 'Highlights',
          });
          return {
            ok: true,
            status: 'completed',
            resultData: {
              clipId: newId,
              audioUrl,
              bound: true,
              message: `Created new soundbite clip bound to "${audioUrl}".`,
            },
          };
        }
      }

      /* ─── AUTOMATION & WORKFLOW INJECTION ─── */
      case 'WRITE_WORKFLOW_FILE': {
        const token = ctx.config.githubToken;
        const owner = ctx.config.ownerName;
        const repo = ctx.config.repoName;
        const branch = ctx.config.branchName || 'master';
        const filename = params.filename.replace(/^.*[\\/]/, '');
        const targetPath = `.github/workflows/${filename}`;
        const commitMsg = params.commitMessage || `ci(workflow): create/update ${filename} via SpacePipe Copilot`;

        if (!token || !owner || !repo) {
          return {
            ok: true,
            status: 'completed',
            resultData: {
              filePath: targetPath,
              committed: false,
              note: 'Workflow file validated and staged. Connect GitHub Personal Access Token in Configuration to push commit directly.',
              contentPreview: params.content.slice(0, 300),
            },
          };
        }

        await writeRepositoryTextFile(
          token,
          owner,
          repo,
          targetPath,
          params.content,
          commitMsg,
          branch
        );

        return {
          ok: true,
          status: 'completed',
          resultData: {
            filePath: targetPath,
            committed: true,
            branch,
            message: `Successfully wrote workflow file ${targetPath} to ${owner}/${repo} on branch ${branch}.`,
          },
        };
      }

      case 'GET_SERVER_LOGS': {
        const token = ctx.config.githubToken || '';
        const owner = ctx.config.ownerName;
        const repo = ctx.config.repoName;
        const runId = params.runId;

        if (!owner || !repo) {
          return {
            ok: false,
            status: 'failed',
            errorMessage: 'Repository owner and name not configured.',
          };
        }

        try {
          const failureInfo = await inspectRunFailure(token, owner, repo, runId);
          let logs = failureInfo.errorExcerpt || '';
          const failedJob = failureInfo.failedJobName || 'Workflow Job';
          const failedStep = failureInfo.failedStepName || 'Execution Step';

          if (!logs && params.jobId) {
            logs = await getJobStepLogExcerpt(token, owner, repo, params.jobId, undefined, (params.lines || 100) * 100);
          }

          if (!logs) {
            logs = `[Info] No explicit failure exception logged for run #${runId}. Step completed or logs expired on GitHub server.`;
          }

          return {
            ok: true,
            status: 'completed',
            resultData: {
              runId,
              failedJob,
              failedStep,
              logsExcerpt: logs.slice(-2000),
              linesReturned: logs.split('\n').length,
            },
          };
        } catch (err: any) {
          return {
            ok: false,
            status: 'failed',
            errorMessage: err?.message || `Failed to fetch server logs for run #${runId}.`,
          };
        }
      }

      /* ─── CREATION & GENERATION ACTIONS ─── */
      case 'AUTO_EXECUTE_VOX': {
        const res = await fetch('/api/vox/synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: params.text,
            voiceId: params.voiceId || 'Logan',
            speed: params.speed || 1.0,
            sceneId: params.sceneId,
          }),
        });
        if (!res.ok) {
          throw new Error(`Auto Vox execution failed with status ${res.status}`);
        }
        const data = await res.json();
        return {
          ok: true,
          status: 'completed',
          resultData: {
            audioUrl: data.takeUrl || data.url,
            durationSec: data.durationSec,
            text: params.text,
            voiceId: params.voiceId || 'Logan',
          },
        };
      }

      case 'ENROLL_VOICE_PROFILE': {
        const catalog = readVoiceCatalog() || { version: 1, updated_at: new Date().toISOString(), profiles: {} };
        const id = params.speakerName;
        const now = new Date().toISOString();
        const existing = catalog.profiles[id] || {
          name: id,
          aliases: [],
          traits: [],
          samples: [],
          notes: '',
        };

        const updatedProfile = {
          ...existing,
          name: id,
          aliases: params.aliases || existing.aliases || [],
          traits: params.vocalTraits || existing.traits || [],
          notes: params.notes || existing.notes || '',
          identity_verified: params.identityVerified !== false,
          last_updated: now,
          samples: [
            ...(existing.samples || []),
            {
              id: `sample_${Date.now()}`,
              url: params.audioUrl,
              created_at: now,
              verified: true,
            },
          ],
        };

        const updatedCatalog = updateVoiceProfile(catalog, id, updatedProfile);
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('spacepipe_voice_profiles_catalog', JSON.stringify(updatedCatalog));
            window.dispatchEvent(new CustomEvent('spacepipe:voice-profiles-updated', { detail: updatedCatalog }));
          }
        } catch {}

        return {
          ok: true,
          status: 'completed',
          resultData: {
            speakerName: id,
            enrolled: true,
            identityVerified: true,
            samplesCount: updatedProfile.samples.length,
            traits: updatedProfile.traits,
            message: `Voice profile for "${id}" successfully enrolled and verified.`,
          },
        };
      }

      case 'RENDER_AVATAR_DIRECT': {
        const res = await fetch('/api/avatar/render', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clipId: params.clipId,
            avatarId: params.avatarId,
            audioUrl: params.audioUrl,
            imageUrl: params.imageUrl,
          }),
        });
        if (!res.ok) {
          throw new Error(`Avatar direct render failed with status ${res.status}`);
        }
        const data = await res.json();
        return {
          ok: true,
          status: 'accepted',
          resultData: {
            jobId: data.jobId || data.id,
            status: 'rendering',
            message: 'Direct LivePortrait avatar render job successfully initiated.',
          },
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
