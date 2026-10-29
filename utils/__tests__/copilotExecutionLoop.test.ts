import { describe, it, expect, vi } from 'vitest';
import { executeCopilotActionChain } from '../copilotExecutionLoop';
import type { CopilotAction } from '../copilotTypes';
import type { CopilotExecutionContext } from '../copilotExecutor';
import { DEFAULT_CONFIG } from '../../contexts/ConfigContext';

describe('Copilot Execution Loop & Chained Workflows', () => {
  const createMockContext = () => {
    let clips: any[] = [];
    return {
      config: { ...DEFAULT_CONFIG },
      updateConfig: vi.fn(),
      montage: {
        clips,
        addClip: vi.fn((c) => {
          clips.push(c);
        }),
        updateClip: vi.fn((id, patch) => {
          const target = clips.find(c => c.id === id);
          if (target) Object.assign(target, patch);
        }),
        replaceClips: vi.fn((newClips) => {
          clips = [...newClips];
        }),
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
    } as unknown as CopilotExecutionContext;
  };

  it('propagates generated clipId from CREATE_CLIP to downstream TRIM_CLIP', async () => {
    const ctx = createMockContext();

    const actions: CopilotAction[] = [
      {
        id: 'step_1',
        action: 'CREATE_CLIP',
        params: {
          title: 'Initial Clip',
          quote: 'Quote here',
          speaker: 'Speaker',
          startSec: 10,
          endSec: 30,
        },
        explanation: 'Create clip',
      },
      {
        id: 'step_2',
        action: 'TRIM_CLIP',
        params: {
          clipId: '$PREV_CLIP_ID',
          newStartSec: 12,
          newEndSec: 28,
        },
        explanation: 'Trim the created clip',
      },
    ];

    const summary = await executeCopilotActionChain(actions, ctx);

    expect(summary.totalSteps).toBe(2);
    expect(summary.completedSteps).toBe(2);
    expect(summary.abortedAtStep).toBeUndefined();
    expect(summary.results[0].result.ok).toBe(true);
    expect(summary.results[1].result.ok).toBe(true);

    const createdId = summary.results[0].result.resultData?.clipId;
    expect(createdId).toBeDefined();
    expect(ctx.montage.updateClip).toHaveBeenCalledWith(createdId, expect.objectContaining({
      startSec: 12,
      endSec: 28,
    }));
  });

  it('safely aborts downstream steps if an earlier step fails', async () => {
    const ctx = createMockContext();

    const actions: CopilotAction[] = [
      {
        id: 'step_1',
        action: 'CREATE_CLIP',
        params: {
          title: 'Invalid Clip',
          quote: 'Fails validation',
          speaker: 'Speaker',
          startSec: 50,
          endSec: 20, // Invalid: endSec < startSec
        },
        explanation: 'Should fail validation',
      },
      {
        id: 'step_2',
        action: 'AUDITION_MONTAGE',
        params: { startFromIndex: 0 },
        explanation: 'Should never run',
      },
    ];

    const summary = await executeCopilotActionChain(actions, ctx);

    expect(summary.completedSteps).toBe(0);
    expect(summary.abortedAtStep).toBe(1);
    expect(summary.results).toHaveLength(1);
    expect(ctx.montage.startAudition).not.toHaveBeenCalled();
  });
});
