import { describe, it, expect, vi } from 'vitest';
import {
  validateActionParams,
  containsForbiddenSecretKey,
  resolveActionTier,
  FORBIDDEN_CONFIG_KEYS,
} from '../contracts/copilotActions';
import { executeCopilotAction, revertCopilotAction, type CopilotExecutionContext } from '../copilotExecutor';
import type { CopilotAction } from '../copilotTypes';
import { DEFAULT_CONFIG } from '../../contexts/ConfigContext';

describe('Copilot Action Validation & Security Contracts', () => {
  it('blocks forbidden secret keys in config updates', () => {
    FORBIDDEN_CONFIG_KEYS.forEach(key => {
      expect(Boolean(containsForbiddenSecretKey({ [key]: 'secret_value' }))).toBe(true);
    });

    expect(Boolean(containsForbiddenSecretKey({ podcastTitle: 'Tech Talk' }))).toBe(false);
  });

  it('rejects UPDATE_CONFIG attempting to overwrite githubToken or credentials', () => {
    const res = validateActionParams('UPDATE_CONFIG', {
      updates: { githubToken: 'ghp_fake12345' },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/Security violation/);
    }
  });

  it('validates CREATE_CLIP schema correctly', () => {
    const valid = validateActionParams('CREATE_CLIP', {
      title: 'Valid Clip',
      quote: 'Great point',
      speaker: 'Logan',
      startSec: 10,
      endSec: 25,
      category: 'Golden Quotes',
      viralScore: 85,
    });
    expect(valid.ok).toBe(true);

    const invalid = validateActionParams('CREATE_CLIP', {
      title: 'Invalid Clip',
      quote: 'Start after end',
      speaker: 'Logan',
      startSec: 30,
      endSec: 20,
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error).toMatch(/endSec must be strictly greater than startSec/);
    }
  });

  it('validates TRIM_CLIP schema correctly', () => {
    const valid = validateActionParams('TRIM_CLIP', {
      clipId: 'clip_1',
      newStartSec: 15.5,
      newEndSec: 30.0,
    });
    expect(valid.ok).toBe(true);

    const invalid = validateActionParams('TRIM_CLIP', {
      clipId: 'clip_1',
      newStartSec: 40,
      newEndSec: 30,
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error).toMatch(/newEndSec must be strictly greater than newStartSec/);
    }
  });

  it('validates ENQUEUE_SPACE requires a valid Space URL', () => {
    const valid = validateActionParams('ENQUEUE_SPACE', {
      spaceUrl: 'https://x.com/i/spaces/1qJDzWQRqWNKV',
      queueType: 'batch',
    });
    expect(valid.ok).toBe(true);

    const invalid = validateActionParams('ENQUEUE_SPACE', {
      spaceUrl: 'not_a_valid_url',
      queueType: 'batch',
    });
    expect(invalid.ok).toBe(false);
  });

  it('validates DISPATCH_WORKFLOW requires a valid YAML workflow filename', () => {
    const valid = validateActionParams('DISPATCH_WORKFLOW', {
      workflowFile: 'ingest.yml',
      ref: 'main',
    });
    expect(valid.ok).toBe(true);

    const invalid = validateActionParams('DISPATCH_WORKFLOW', {
      workflowFile: 'ingest.exe',
    });
    expect(invalid.ok).toBe(false);
  });
});

describe('Action Tier Escalation', () => {
  it('resolves Tier 0 for read-only and playback actions', () => {
    expect(resolveActionTier('SEARCH_TRANSCRIPTS', {})).toBe(0);
    expect(resolveActionTier('PLAY_AUDIO', {})).toBe(0);
    expect(resolveActionTier('PAUSE_AUDIO', {})).toBe(0);
    expect(resolveActionTier('NAVIGATE_TAB', {})).toBe(0);
    expect(resolveActionTier('GET_QUEUE', {})).toBe(0);
    expect(resolveActionTier('GET_RUN_HISTORY', {})).toBe(0);
  });

  it('resolves Tier 1 for montage edits and safe local metadata updates', () => {
    expect(resolveActionTier('CREATE_CLIP', {})).toBe(1);
    expect(resolveActionTier('TRIM_CLIP', {})).toBe(1);
    expect(resolveActionTier('SEQUENCE_MONTAGE', {})).toBe(1);
    expect(resolveActionTier('UPDATE_CONFIG', { updates: { podcastTitle: 'New Title' } })).toBe(1);
  });

  it('escalates to Tier 2 for external side effects and sensitive configurations', () => {
    expect(resolveActionTier('ENQUEUE_SPACE', {})).toBe(2);
    expect(resolveActionTier('DISPATCH_WORKFLOW', {})).toBe(2);
    expect(resolveActionTier('SYNTHESIZE_VOX', {})).toBe(2);
    expect(resolveActionTier('RENDER_AVATAR', {})).toBe(2);

    // Config touching schedule, webhooks, or repo targets MUST be Tier 2
    expect(resolveActionTier('UPDATE_CONFIG', { updates: { scheduledCron: '0 3 * * *' } })).toBe(2);
    expect(resolveActionTier('UPDATE_CONFIG', { updates: { enableDiscordWebhook: true } })).toBe(2);
    expect(resolveActionTier('UPDATE_CONFIG', { updates: { repoOwner: 'evil' } })).toBe(2);
  });
});

describe('Execution Boundary & Undo Snapshots', () => {
  const createMockContext = (): CopilotExecutionContext => {
    let clips = [
      { id: 'c1', title: 'Clip 1', quote: 'Quote 1', speaker: 'A', startSec: 10, endSec: 20 },
      { id: 'c2', title: 'Clip 2', quote: 'Quote 2', speaker: 'B', startSec: 30, endSec: 40 },
    ];

    return {
      config: { ...DEFAULT_CONFIG },
      updateConfig: vi.fn(),
      montage: {
        clips,
        addClip: vi.fn((c) => clips.push(c)),
        updateClip: vi.fn((id, patch) => {
          const target = clips.find(c => c.id === id);
          if (target) Object.assign(target, patch);
        }),
        replaceClips: vi.fn((newClips) => { clips = [...newClips]; }),
        startAudition: vi.fn(),
        stopAudition: vi.fn(),
      },
      player: {
        play: vi.fn(),
        pause: vi.fn(),
        seek: vi.fn(),
        togglePlay: vi.fn(),
        isPlaying: false,
      },
      navHandler: vi.fn(),
      loadEpisodeHandler: vi.fn(),
    };
  };

  it('rejects Tier 2 actions without explicit confirmation', async () => {
    const ctx = createMockContext();
    const action: CopilotAction = {
      id: 'act_1',
      action: 'ENQUEUE_SPACE',
      params: { spaceUrl: 'https://x.com/i/spaces/1qJDzWQRqWNKV', queueType: 'batch' },
      explanation: 'Enqueue space',
    };

    const res = await executeCopilotAction(action, ctx, { confirmed: false });
    expect(res.ok).toBe(false);
    expect(res.status).toBe('pending');
    expect(res.errorMessage).toMatch(/requires explicit user confirmation/);
  });

  it('allows Tier 1 actions to auto-apply and produces snapshot for undo', async () => {
    const ctx = createMockContext();
    const action: CopilotAction = {
      id: 'act_2',
      action: 'TRIM_CLIP',
      params: { clipId: 'c1', newStartSec: 12, newEndSec: 18 },
      explanation: 'Tighten clip 1',
    };

    const res = await executeCopilotAction(action, ctx);
    expect(res.ok).toBe(true);
    expect(res.status).toBe('completed');
    expect(res.snapshot).toBeDefined();
    expect(res.snapshot?.type).toBe('montage_clips');
    expect(res.snapshot?.data.find((c: any) => c.id === 'c1').startSec).toBe(10); // original startSec

    // Test revert
    const revertActionObj: CopilotAction = {
      ...action,
      snapshot: res.snapshot,
      applied: true,
    };
    const reverted = await revertCopilotAction(revertActionObj, ctx);
    expect(reverted).toBe(true);
    expect(ctx.montage.replaceClips).toHaveBeenCalledWith(res.snapshot?.data);
  });

  it('enforces YouTube 12-hour ceiling and flags episodes > 36,000s', async () => {
    const ctx = createMockContext();
    const action: CopilotAction = {
      id: 'act_3',
      action: 'CREATE_CLIP',
      params: {
        title: 'Huge clip exceeding limit',
        quote: 'Too long',
        speaker: 'A',
        startSec: 0,
        endSec: 36005, // 10h 5s
      },
      explanation: 'Create oversized clip',
    };

    const res = await executeCopilotAction(action, ctx);
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toMatch(/10-hour chunking ceiling/);
  });

  describe('Divine Shackles - Expanded Copilot Powers & Validation', () => {
    it('validates MUTATE_KNOWLEDGE_GRAPH params and executes mutation', async () => {
      const valid = validateActionParams('MUTATE_KNOWLEDGE_GRAPH', {
        type: 'add_node',
        nodeData: { id: 'test_node_1', label: 'Contradiction Node' },
      });
      expect(valid.ok).toBe(true);
      expect(resolveActionTier('MUTATE_KNOWLEDGE_GRAPH', {})).toBe(1);

      const ctx = createMockContext();
      const action: CopilotAction = {
        id: 'act_mut_1',
        action: 'MUTATE_KNOWLEDGE_GRAPH',
        params: {
          type: 'add_node',
          nodeData: { id: 'node_42', label: 'Eviction Fundraiser' },
        },
        explanation: 'Add graph node for eviction fundraiser',
      };
      const res = await executeCopilotAction(action, ctx);
      expect(res.ok).toBe(true);
      expect(res.resultData?.type).toBe('add_node');
      expect(res.resultData?.summary).toMatch(/Added node "node_42"/);
    });

    it('validates PURGE_AND_REINDEX and wipes corrupted vectors', async () => {
      const valid = validateActionParams('PURGE_AND_REINDEX', {
        episodeTag: 'AQ-0118',
        purgeCorrupted: true,
      });
      expect(valid.ok).toBe(true);
      expect(resolveActionTier('PURGE_AND_REINDEX', {})).toBe(1);

      const ctx = createMockContext();
      const action: CopilotAction = {
        id: 'act_purge_1',
        action: 'PURGE_AND_REINDEX',
        params: { episodeTag: 'AQ-0118' },
        explanation: 'Purge and reindex AQ-0118',
      };
      const res = await executeCopilotAction(action, ctx);
      expect(res.ok).toBe(true);
      expect(res.resultData?.reindexed).toBe(true);
      expect(res.resultData?.status).toMatch(/Wiped corrupted vectors for AQ-0118/);
    });

    it('validates RENDER_MONTAGE and produces composition render output', async () => {
      const valid = validateActionParams('RENDER_MONTAGE', {
        format: 'wav',
        gapSec: 0.35,
      });
      expect(valid.ok).toBe(true);
      expect(resolveActionTier('RENDER_MONTAGE', {})).toBe(1);

      const ctx = createMockContext();
      const action: CopilotAction = {
        id: 'act_render_1',
        action: 'RENDER_MONTAGE',
        params: { format: 'wav' },
        explanation: 'Compile final montage wav',
      };
      const res = await executeCopilotAction(action, ctx);
      expect(res.ok).toBe(true);
      expect(res.resultData?.format).toBe('wav');
      expect(res.resultData?.clipCount).toBe(2);
      expect(res.resultData?.downloadUrl).toBeDefined();
    });

    it('validates FETCH_RAW_AUDIO and retrieves acoustic metadata', async () => {
      const valid = validateActionParams('FETCH_RAW_AUDIO', {
        clipId: 'c1',
      });
      expect(valid.ok).toBe(true);
      expect(resolveActionTier('FETCH_RAW_AUDIO', {})).toBe(0);

      const ctx = createMockContext();
      const action: CopilotAction = {
        id: 'act_fetch_1',
        action: 'FETCH_RAW_AUDIO',
        params: { clipId: 'c1' },
        explanation: 'Fetch acoustic waveform parameters',
      };
      const res = await executeCopilotAction(action, ctx);
      expect(res.ok).toBe(true);
      expect(res.resultData?.sampleRate).toBe(44100);
      expect(res.resultData?.peakDb).toBeDefined();
    });

    it('validates SELECT_CLIP_FILE and updates montage clip audioUrl', async () => {
      const valid = validateActionParams('SELECT_CLIP_FILE', {
        clipId: 'c1',
        audioUrl: 'https://example.com/audio/master_reference.wav',
      });
      expect(valid.ok).toBe(true);
      expect(resolveActionTier('SELECT_CLIP_FILE', {})).toBe(1);

      const ctx = createMockContext();
      const action: CopilotAction = {
        id: 'act_select_1',
        action: 'SELECT_CLIP_FILE',
        params: {
          clipId: 'c1',
          audioUrl: 'https://example.com/audio/master_reference.wav',
          title: 'Reference Take',
        },
        explanation: 'Bind audio url to clip',
      };
      const res = await executeCopilotAction(action, ctx);
      expect(res.ok).toBe(true);
      expect(ctx.montage.updateClip).toHaveBeenCalledWith('c1', expect.objectContaining({
        audioUrl: 'https://example.com/audio/master_reference.wav',
        title: 'Reference Take',
      }));
    });

    it('validates WRITE_WORKFLOW_FILE blocks path traversal and secret injection', () => {
      // Rejects non-yaml files
      const nonYaml = validateActionParams('WRITE_WORKFLOW_FILE', {
        filename: 'script.sh',
        content: 'echo hello',
      });
      expect(nonYaml.ok).toBe(false);

      // Rejects path traversal
      const traversal = validateActionParams('WRITE_WORKFLOW_FILE', {
        filename: '../../evil.yml',
        content: 'name: evil',
      });
      expect(traversal.ok).toBe(false);

      // Rejects secret content
      const secret = validateActionParams('WRITE_WORKFLOW_FILE', {
        filename: 'leak.yml',
        content: 'env:\n  GITHUB_TOKEN: ghp_1234567890abcdef',
      });
      expect(secret.ok).toBe(false);

      // Valid workflow file requires Tier 2 confirmation
      const valid = validateActionParams('WRITE_WORKFLOW_FILE', {
        filename: 'monitor.yml',
        content: 'name: Monitor\non:\n  workflow_dispatch:\njobs:\n  run:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo OK\n',
      });
      expect(valid.ok).toBe(true);
      expect(resolveActionTier('WRITE_WORKFLOW_FILE', {})).toBe(2);
    });

    it('validates GET_SERVER_LOGS params and tier', () => {
      const valid = validateActionParams('GET_SERVER_LOGS', {
        runId: 10928374,
        lines: 50,
      });
      expect(valid.ok).toBe(true);
      expect(resolveActionTier('GET_SERVER_LOGS', {})).toBe(0);
    });

    it('validates AUTO_EXECUTE_VOX, ENROLL_VOICE_PROFILE and RENDER_AVATAR_DIRECT', () => {
      // AUTO_EXECUTE_VOX (Tier 1)
      const vox = validateActionParams('AUTO_EXECUTE_VOX', {
        text: 'This is an authentic voice sample.',
        voiceId: 'Logan',
      });
      expect(vox.ok).toBe(true);
      expect(resolveActionTier('AUTO_EXECUTE_VOX', {})).toBe(1);

      // ENROLL_VOICE_PROFILE (Tier 1)
      const enroll = validateActionParams('ENROLL_VOICE_PROFILE', {
        speakerName: 'Eric Hecker',
        audioUrl: 'https://example.com/audio/eric_hecker.wav',
        identityVerified: true,
      });
      expect(enroll.ok).toBe(true);
      expect(resolveActionTier('ENROLL_VOICE_PROFILE', {})).toBe(1);

      // RENDER_AVATAR_DIRECT (Tier 2)
      const avatar = validateActionParams('RENDER_AVATAR_DIRECT', {
        clipId: 'c1',
        avatarId: 'avatar_angela',
      });
      expect(avatar.ok).toBe(true);
      expect(resolveActionTier('RENDER_AVATAR_DIRECT', {})).toBe(2);

      // GENERATE_IMAGE (Tier 0)
      const validImage = validateActionParams('GENERATE_IMAGE', {
        prompt: 'A cinematic noir recording studio bathed in warm amber light',
        aspectRatio: '16:9',
        model: 'black-forest-labs/flux.2-klein-4b',
      });
      expect(validImage.ok).toBe(true);
      expect(resolveActionTier('GENERATE_IMAGE', {})).toBe(0);

      const invalidImage = validateActionParams('GENERATE_IMAGE', {
        prompt: '',
      });
      expect(invalidImage.ok).toBe(false);
    });
  });
});
