/**
 * Zod contracts and Tier authorization logic for all SpacePipe Copilot actions.
 * Enforces:
 *   - Zod-at-every-boundary rule.
 *   - Single unified validate -> authorize -> execute -> report boundary.
 *   - Security: Zero access to secrets (githubToken, API keys).
 *   - Tier 0 (immediate), Tier 1 (auto-apply allowed + undo required), Tier 2 (explicit confirmation required).
 */
import { z } from 'zod';
import type { ActionTier, CopilotActionType } from '../copilotTypes';

/* -------------------------------------------------------------------------- */
/* Forbidden Keys & Secret Protection                                          */
/* -------------------------------------------------------------------------- */

export const FORBIDDEN_CONFIG_KEYS = new Set([
  'githubtoken',
  'token',
  'apikey',
  'api_key',
  'secret',
  'password',
  'directorapikey',
  'cheaperinferenceapikey',
  'auth',
]);

export function containsForbiddenSecretKey(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
    if (FORBIDDEN_CONFIG_KEYS.has(normalized)) return key;
    const val = (obj as Record<string, unknown>)[key];
    if (val && typeof val === 'object') {
      const nested = containsForbiddenSecretKey(val);
      if (nested) return nested;
    }
  }
  return null;
}

export const SENSITIVE_CONFIG_KEYS = new Set([
  'scheduledCron',
  'enableScheduledMonitoring',
  'enableDiscordWebhook',
  'discordWebhookUrl',
  'enableSlackWebhook',
  'slackWebhookUrl',
  'ownerName',
  'repoName',
  'repoOwner',
  'targetRepo',
  'autoPublishYouTube',
  'youtubePrivacy',
]);

/* -------------------------------------------------------------------------- */
/* Action Parameter Schemas                                                   */
/* -------------------------------------------------------------------------- */

export const CreateClipParamsSchema = z.object({
  title: z.preprocess(v => String(v || '').trim() || 'Extracted Soundbite', z.string()),
  quote: z.preprocess(v => String(v || '').trim(), z.string()),
  speaker: z.preprocess(v => String(v || '').trim() || 'Unknown', z.string()),
  startSec: z.preprocess(v => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }, z.number().nonnegative()),
  endSec: z.preprocess(v => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, n) : 30;
  }, z.number().positive()),
  category: z.preprocess(v => String(v || '').trim() || 'Highlights', z.string().optional()),
  viralScore: z.preprocess(v => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 75;
  }, z.number().min(0).max(100).optional()),
  reason: z.preprocess(v => (v ? String(v).trim() : undefined), z.string().optional()),
  episodeTag: z.preprocess(v => (v ? String(v).trim() : undefined), z.string().optional()),
  sourceTitle: z.preprocess(v => (v ? String(v).trim() : undefined), z.string().optional()),
  audioUrl: z.preprocess(v => (v ? String(v).trim() : undefined), z.string().optional()),
}).refine(data => data.endSec > data.startSec, {
  message: 'endSec must be strictly greater than startSec',
  path: ['endSec'],
}).refine(data => (data.endSec - data.startSec) <= 36000, {
  message: 'Episode/clip duration exceeds the 10-hour chunking ceiling (36,000s). Must be sliced into Parts per YouTube policy.',
  path: ['endSec'],
});

export const TrimClipParamsSchema = z.object({
  clipId: z.preprocess(v => String(v || '').trim(), z.string().min(1, 'clipId is required')),
  newStartSec: z.preprocess(v => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }, z.number().nonnegative()),
  newEndSec: z.preprocess(v => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }, z.number().positive()),
  reason: z.preprocess(v => (v ? String(v).trim() : undefined), z.string().optional()),
}).refine(data => data.newEndSec > data.newStartSec, {
  message: 'newEndSec must be strictly greater than newStartSec',
  path: ['newEndSec'],
});

export const SequenceMontageParamsSchema = z.object({
  clipIds: z.array(z.string().min(1)).min(1, 'clipIds must contain at least 1 clip id'),
  preset: z.preprocess(v => (v ? String(v).trim() : undefined), z.string().optional()),
  tensionScores: z.record(z.string(), z.number().min(1).max(10)).optional(),
  reason: z.preprocess(v => (v ? String(v).trim() : undefined), z.string().optional()),
});

export const AuditionMontageParamsSchema = z.object({
  startFromIndex: z.preprocess(v => (v !== undefined ? Number(v) : 0), z.number().int().nonnegative().optional()),
});

export const PlayAudioParamsSchema = z.object({
  timestampSec: z.preprocess(v => (v !== undefined ? Number(v) : undefined), z.number().nonnegative().optional()),
  audioUrl: z.preprocess(v => (v ? String(v).trim() : undefined), z.string().optional()),
  title: z.preprocess(v => (v ? String(v).trim() : undefined), z.string().optional()),
  episodeTag: z.preprocess(v => (v ? String(v).trim() : undefined), z.string().optional()),
});

export const PauseAudioParamsSchema = z.object({}).optional();

export const SeekAudioParamsSchema = z.object({
  timestampSec: z.preprocess(v => Number(v) || 0, z.number().nonnegative()),
});

export const NavigateTabParamsSchema = z.object({
  tab: z.preprocess(v => String(v || '').trim(), z.string().min(1, 'tab is required')),
  reason: z.preprocess(v => (v ? String(v).trim() : undefined), z.string().optional()),
});

export const LoadEpisodeParamsSchema = z.object({
  episodeTag: z.preprocess(v => String(v || '').trim(), z.string().min(1, 'episodeTag is required')),
  title: z.preprocess(v => (v ? String(v).trim() : undefined), z.string().optional()),
});

export const SearchTranscriptsParamsSchema = z.object({
  query: z.preprocess(v => String(v || '').trim(), z.string()),
  scope: z.enum(['all_transcripts', 'active_episode']).default('all_transcripts'),
  speaker_hint: z.preprocess(v => (v ? String(v).trim() : undefined), z.string().optional()),
  timestamp_sec: z.preprocess(v => (v !== undefined ? Number(v) : undefined), z.number().nonnegative().optional()),
});

export const UpdateConfigParamsSchema = z.object({
  updates: z.record(z.string(), z.unknown()).refine(
    updates => {
      const forbidden = containsForbiddenSecretKey(updates);
      return !forbidden;
    },
    { message: 'Security violation: Writing auth credentials, tokens, or secrets is strictly forbidden.' }
  ),
  reason: z.preprocess(v => (v ? String(v).trim() : undefined), z.string().optional()),
});

export const EnqueueSpaceParamsSchema = z.object({
  url: z.preprocess(v => (v !== undefined ? String(v).trim() : undefined), z.string().optional()),
  spaceUrl: z.preprocess(v => (v !== undefined ? String(v).trim() : undefined), z.string().optional()),
  targetQueue: z.preprocess(v => {
    if (v === 'batch' || v === 'batch_queue.txt') return 'batch_queue.txt';
    return 'space_queue.txt';
  }, z.enum(['space_queue.txt', 'batch_queue.txt'])).default('space_queue.txt'),
  queueType: z.preprocess(v => (v !== undefined ? String(v).trim() : undefined), z.string().optional()),
  title: z.preprocess(v => (v ? String(v).trim() : undefined), z.string().optional()),
  note: z.preprocess(v => (v ? String(v).trim() : undefined), z.string().optional()),
}).transform(data => {
  const finalUrl = (data.url || data.spaceUrl || '').trim();
  const finalQueue = (data.queueType === 'batch' || data.targetQueue === 'batch_queue.txt') ? 'batch_queue.txt' : 'space_queue.txt';
  return {
    ...data,
    url: finalUrl,
    spaceUrl: finalUrl,
    targetQueue: finalQueue,
    queueType: finalQueue === 'batch_queue.txt' ? 'batch' : 'priority',
  };
}).refine(data => {
  try {
    const parsed = new URL(data.url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}, { message: 'Must be a valid HTTP/HTTPS URL (Twitter/X, YouTube, etc.)', path: ['url'] });

export const DispatchWorkflowParamsSchema = z.object({
  workflowFile: z.preprocess(v => String(v || '').trim(), z.string().min(1, 'workflowFile is required').refine(
    f => f.endsWith('.yml') || f.endsWith('.yaml'),
    { message: 'workflowFile must end with .yml or .yaml' }
  )),
  inputs: z.record(z.string(), z.string()).optional(),
  ref: z.preprocess(v => (v ? String(v).trim() : undefined), z.string().optional()),
  reason: z.preprocess(v => (v ? String(v).trim() : undefined), z.string().optional()),
});

export const GetQueueParamsSchema = z.object({
  queue: z.enum(['space_queue.txt', 'batch_queue.txt', 'all']).default('all'),
});

export const GetRunHistoryParamsSchema = z.object({
  limit: z.preprocess(v => (v !== undefined ? Number(v) : 10), z.number().int().min(1).max(50).default(10)),
  status: z.enum(['all', 'active', 'failed', 'completed']).default('all'),
});

export const GetVoiceProfilesParamsSchema = z.object({
  filter: z.enum(['all', 'enrolled', 'missing_avatar']).default('all'),
});

export const GetScriptProjectsParamsSchema = z.object({
  limit: z.preprocess(v => (v !== undefined ? Number(v) : 10), z.number().int().min(1).max(50).default(10)),
});

export const InspectKnowledgeGraphParamsSchema = z.object({
  query: z.preprocess(v => String(v || '').trim(), z.string().min(1, 'query is required')),
  entityType: z.preprocess(v => (v ? String(v).trim() : undefined), z.string().optional()),
});

export const CreateProjectParamsSchema = z.object({
  releaseTags: z.array(z.string().min(1)).min(1, 'At least 1 recording release tag is required'),
  targetRuntimeSec: z.preprocess(v => Number(v) || 900, z.number().min(30).max(7200)),
  format: z.string().optional(),
  thesis: z.preprocess(v => (v ? String(v).trim() : undefined), z.string().max(500).optional()),
});

export const AnalyzeProjectParamsSchema = z.object({
  projectId: z.preprocess(v => String(v || '').trim(), z.string().min(1, 'projectId is required')),
  mode: z.enum(['subscription', 'fallback']).default('subscription'),
  maxUsd: z.preprocess(v => (v !== undefined ? Number(v) : 2.0), z.number().nonnegative().default(2.0)),
  force: z.boolean().default(false),
});

export const OutlineProjectParamsSchema = z.object({
  projectId: z.preprocess(v => String(v || '').trim(), z.string().min(1, 'projectId is required')),
  mode: z.enum(['subscription', 'fallback']).default('subscription'),
  maxUsd: z.preprocess(v => (v !== undefined ? Number(v) : 1.5), z.number().nonnegative().default(1.5)),
});

export const DraftProjectParamsSchema = z.object({
  projectId: z.preprocess(v => String(v || '').trim(), z.string().min(1, 'projectId is required')),
  mode: z.enum(['subscription', 'fallback']).default('subscription'),
  maxUsd: z.preprocess(v => (v !== undefined ? Number(v) : 3.0), z.number().nonnegative().default(3.0)),
});

export const RefineProjectParamsSchema = z.object({
  projectId: z.preprocess(v => String(v || '').trim(), z.string().min(1, 'projectId is required')),
  mode: z.enum(['subscription', 'fallback']).default('subscription'),
  maxUsd: z.preprocess(v => (v !== undefined ? Number(v) : 4.0), z.number().nonnegative().default(4.0)),
});

export const SynthesizeVoxParamsSchema = z.object({
  text: z.preprocess(v => String(v || '').trim(), z.string().min(1, 'text is required')),
  voiceId: z.preprocess(v => (v ? String(v).trim() : undefined), z.string().optional()),
  sceneId: z.preprocess(v => (v ? String(v).trim() : undefined), z.string().optional()),
});

export const RenderAvatarParamsSchema = z.object({
  clipId: z.preprocess(v => String(v || '').trim(), z.string().min(1, 'clipId is required')),
  avatarId: z.preprocess(v => (v ? String(v).trim() : undefined), z.string().optional()),
});

/* -------------------------------------------------------------------------- */
/* Action Schema Registry                                                     */
/* -------------------------------------------------------------------------- */

export const ACTION_SCHEMAS: Record<CopilotActionType, z.ZodType<any>> = {
  CREATE_CLIP: CreateClipParamsSchema,
  TRIM_CLIP: TrimClipParamsSchema,
  SEQUENCE_MONTAGE: SequenceMontageParamsSchema,
  AUDITION_MONTAGE: AuditionMontageParamsSchema,
  PLAY_AUDIO: PlayAudioParamsSchema,
  PAUSE_AUDIO: PauseAudioParamsSchema,
  SEEK_AUDIO: SeekAudioParamsSchema,
  NAVIGATE_TAB: NavigateTabParamsSchema,
  LOAD_EPISODE: LoadEpisodeParamsSchema,
  SEARCH_TRANSCRIPTS: SearchTranscriptsParamsSchema,
  UPDATE_CONFIG: UpdateConfigParamsSchema,
  ENQUEUE_SPACE: EnqueueSpaceParamsSchema,
  DISPATCH_WORKFLOW: DispatchWorkflowParamsSchema,
  GET_QUEUE: GetQueueParamsSchema,
  GET_RUN_HISTORY: GetRunHistoryParamsSchema,
  GET_VOICE_PROFILES: GetVoiceProfilesParamsSchema,
  GET_SCRIPT_PROJECTS: GetScriptProjectsParamsSchema,
  INSPECT_KNOWLEDGE_GRAPH: InspectKnowledgeGraphParamsSchema,
  CREATE_PROJECT: CreateProjectParamsSchema,
  ANALYZE_PROJECT: AnalyzeProjectParamsSchema,
  OUTLINE_PROJECT: OutlineProjectParamsSchema,
  DRAFT_PROJECT: DraftProjectParamsSchema,
  REFINE_PROJECT: RefineProjectParamsSchema,
  SYNTHESIZE_VOX: SynthesizeVoxParamsSchema,
  RENDER_AVATAR: RenderAvatarParamsSchema,
};

/**
 * Validates action parameters with its corresponding Zod schema.
 * Throws or returns error description on failure.
 */
export function validateActionParams(
  actionType: CopilotActionType,
  rawParams: Record<string, unknown>
): { ok: true; data: Record<string, any> } | { ok: false; error: string } {
  const schema = ACTION_SCHEMAS[actionType];
  if (!schema) {
    return { ok: false, error: `Unrecognized action type: ${actionType}` };
  }

  // Pre-check for forbidden secret keys
  const forbidden = containsForbiddenSecretKey(rawParams);
  if (forbidden) {
    return {
      ok: false,
      error: `Security violation: parameter '${forbidden}' is an unauthorized authentication credential.`,
    };
  }

  const result = schema.safeParse(rawParams || {});
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.') || 'param'}: ${i.message}`).join('; ');
    return { ok: false, error: `Validation failed for ${actionType}: ${issues}` };
  }

  return { ok: true, data: result.data };
}

/**
 * Determines the authorization tier for an action instance based on what it actually modifies.
 * Tier 0: Run immediately (search, inspect, navigate, play, pause, seek).
 * Tier 1: Auto-apply allowed if Auto-Apply is on; reliable undo snapshot required.
 * Tier 2: Explicit user confirmation required (destinations, pipelines, cloud dispatch, sensitive config, costs).
 */
export function resolveActionTier(actionType: CopilotActionType, params: Record<string, any>): ActionTier {
  switch (actionType) {
    case 'SEARCH_TRANSCRIPTS':
    case 'GET_QUEUE':
    case 'GET_RUN_HISTORY':
    case 'GET_VOICE_PROFILES':
    case 'GET_SCRIPT_PROJECTS':
    case 'INSPECT_KNOWLEDGE_GRAPH':
    case 'PLAY_AUDIO':
    case 'PAUSE_AUDIO':
    case 'SEEK_AUDIO':
    case 'NAVIGATE_TAB':
    case 'LOAD_EPISODE':
    case 'AUDITION_MONTAGE':
      return 0;

    case 'CREATE_CLIP':
    case 'TRIM_CLIP':
    case 'SEQUENCE_MONTAGE':
      return 1;

    case 'UPDATE_CONFIG': {
      const updates = (params?.updates || {}) as Record<string, unknown>;
      // If any updated key touches sensitive destination/schedule settings, escalate to Tier 2
      const touchesSensitive = Object.keys(updates).some(k => SENSITIVE_CONFIG_KEYS.has(k));
      return touchesSensitive ? 2 : 1;
    }

    case 'ENQUEUE_SPACE':
    case 'DISPATCH_WORKFLOW':
    case 'CREATE_PROJECT':
    case 'ANALYZE_PROJECT':
    case 'OUTLINE_PROJECT':
    case 'DRAFT_PROJECT':
    case 'REFINE_PROJECT':
    case 'SYNTHESIZE_VOX':
    case 'RENDER_AVATAR':
      return 2;

    default:
      return 2;
  }
}
