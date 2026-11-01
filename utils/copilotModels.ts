/**
 * Copilot model choices. The label is the model id that is actually sent to the gateway, so the dropdown
 * never names a different model than the one called. Supported models span Inception Labs, Cohere, Anthropic, and Google.
 * The model that really answered (after any gateway fallback) is shown under each reply.
 */
export interface CopilotModelOption {
  id: string;
  label: string;
}

export const DEFAULT_COPILOT_MODEL = 'mercury-3';

export const COPILOT_MODEL_OPTIONS: CopilotModelOption[] = [
  { id: 'mercury-3', label: 'Inception Labs Mercury-3 (mercury-3)' },
  { id: 'command-a-03-2025', label: 'Cohere Command A (command-a-03-2025)' },
  { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash High (gemini-3.8-flash-high)' },
  { id: 'claude-sonnet-5.5', label: 'Claude Sonnet 5.5 (claude-sonnet-5.5)' },
  { id: 'claude-haiku-5.5', label: 'Claude Haiku 5.5 (claude-haiku-5.5)' },
  { id: 'claude-opus-5', label: 'Claude Opus 5 (claude-opus-5)' },
];

/** A stored choice that is no longer offered (for example the old 'claude-3-5-haiku') resets to the default. */
export function normalizeCopilotModel(stored: string | null | undefined): string {
  return COPILOT_MODEL_OPTIONS.some(o => o.id === stored) ? (stored as string) : DEFAULT_COPILOT_MODEL;
}
