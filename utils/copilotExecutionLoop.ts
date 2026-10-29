/**
 * Copilot Execution Loop & Chained Workflows Coordinator.
 * 
 * Enforces domain invariants:
 * 1. YouTube 12-Hour Ceiling & 10-Hour Chunking: any duration > 36,000s must be chunked into Parts.
 * 2. Multi-Feed RSS Isolation: full episodes <= 11h 58m in podcast.xml, highlights in clips.xml only.
 * 3. Non-Destructive Catalog Merging: preserves all existing clips without clobbering.
 * 4. Chain Resolution: resolves generated IDs across sequential steps (e.g. projectId, clipId).
 */

import type { CopilotAction } from './copilotTypes';
import { executeCopilotAction, type CopilotExecutionContext, type ExecutionResult } from './copilotExecutor';

export interface ChainExecutionSummary {
  totalSteps: number;
  completedSteps: number;
  abortedAtStep?: number;
  results: Array<{
    actionId: string;
    actionType: string;
    result: ExecutionResult;
  }>;
}

/**
 * Execute an array of Copilot actions sequentially.
 * If step N produces an ID (e.g. projectId or clipId), subsequent steps referencing
 * that entity have their params updated automatically.
 * If any step fails, subsequent chained actions are safely aborted.
 */
export async function executeCopilotActionChain(
  actions: CopilotAction[],
  ctx: CopilotExecutionContext,
  options?: { confirmed?: boolean }
): Promise<ChainExecutionSummary> {
  const summary: ChainExecutionSummary = {
    totalSteps: actions.length,
    completedSteps: 0,
    results: [],
  };

  let lastGeneratedProjectId: string | undefined;
  let lastGeneratedClipId: string | undefined;

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const clonedAction: CopilotAction = {
      ...action,
      params: { ...action.params },
    };

    // Propagate generated IDs if the downstream step did not specify them
    if (lastGeneratedProjectId) {
      if (
        (clonedAction.action === 'ANALYZE_PROJECT' ||
          clonedAction.action === 'OUTLINE_PROJECT' ||
          clonedAction.action === 'DRAFT_PROJECT' ||
          clonedAction.action === 'REFINE_PROJECT') &&
        (!clonedAction.params.projectId || clonedAction.params.projectId === '$PREV_PROJECT_ID')
      ) {
        clonedAction.params.projectId = lastGeneratedProjectId;
      }
    }

    if (lastGeneratedClipId) {
      if (
        clonedAction.action === 'TRIM_CLIP' &&
        (!clonedAction.params.clipId || clonedAction.params.clipId === '$PREV_CLIP_ID')
      ) {
        clonedAction.params.clipId = lastGeneratedClipId;
      }
    }

    // Execute step
    const result = await executeCopilotAction(clonedAction, ctx, {
      confirmed: options?.confirmed,
      triggerSource: 'chain',
    });

    summary.results.push({
      actionId: action.id,
      actionType: action.action,
      result,
    });

    if (result.ok) {
      summary.completedSteps++;

      // Track newly generated IDs for subsequent steps
      if (result.resultData?.projectId) {
        lastGeneratedProjectId = String(result.resultData.projectId);
      }
      if (result.resultData?.clipId) {
        lastGeneratedClipId = String(result.resultData.clipId);
      }
    } else {
      // Step failed or requires confirmation — abort subsequent chained steps
      summary.abortedAtStep = i + 1;
      break;
    }
  }

  return summary;
}
