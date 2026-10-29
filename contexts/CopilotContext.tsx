import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { DEFAULT_COPILOT_MODEL, normalizeCopilotModel } from '../utils/copilotModels';
import type {
  CopilotAction,
  CopilotMessage,
  CopilotContextPayload,
  CopilotRequestBody,
  ActionTier,
  ActionExecutionStatus,
} from '../utils/copilotTypes';
import { sendCopilotMessage } from '../utils/copilotClient';
import { executeCopilotAction, revertCopilotAction, type CopilotExecutionContext } from '../utils/copilotExecutor';
import { resolveActionTier } from '../utils/contracts/copilotActions';
import { buildCompactStateSummary } from '../utils/copilotState';
import { useConfig } from './ConfigContext';
import { useMontage } from './MontageContext';
import { usePlayer } from './PlayerContext';

const COPILOT_MESSAGES_STORAGE_KEY = 'spacepipe_copilot_messages_v1';
const COPILOT_MODEL_KEY = 'spacepipe_copilot_model_v1';

export interface CopilotContextType {
  messages: CopilotMessage[];
  loading: boolean;
  error: string | null;
  model: string;
  setModel: (m: string) => void;
  autoApply: boolean;
  setAutoApply: (v: boolean) => void;
  actionHistory: CopilotAction[];
  contextPayload: CopilotContextPayload;
  setContextPayload: React.Dispatch<React.SetStateAction<CopilotContextPayload>>;
  sendMessage: (content: string, override?: Partial<CopilotContextPayload>) => Promise<void>;
  applyAction: (
    action: CopilotAction,
    options?: { confirmed?: boolean; triggerSource?: 'user' | 'auto_apply' | 'palette' | 'chain' }
  ) => Promise<boolean>;
  revertAction: (action: CopilotAction) => Promise<boolean>;
  clearMessages: () => void;
  activePanelNavHandler?: (panel: string) => void;
  setActivePanelNavHandler: (fn: (panel: string) => void) => void;
  loadEpisodeHandler?: (tag: string) => void;
  setLoadEpisodeHandler: (fn: (tag: string) => void) => void;
}

const INITIAL_WELCOME_MESSAGE: CopilotMessage = {
  id: 'welcome_1',
  role: 'assistant',
  content: `👋 **Welcome to the SpacePipe AI Studio & Copilot!**

I am your **Executive Audio Producer & Pipeline Assistant**.

Here are some things I can do for you right now:
* ⚡ **"Soundbite Hunter"**: Scan any transcript for the highest-energy rants, debates, or viral quotes.
* 🍿 **"The Debate Duel"**: Reorder your montage clips into an escalating clash with a mic-drop resolution.
* ✂️ **"Word-Perfect Trimming"**: Tighten In/Out points to remove filler words and dead air.
* 🩺 **"Diagnose Pipeline"**: Audit your GitHub Actions YAML and cron settings with 1-click auto-fixes.

How can I help with your episodes or pipeline today?`,
  timestamp: Date.now(),
};

const CopilotContext = createContext<CopilotContextType | null>(null);

export const CopilotProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { config, updateConfig } = useConfig();
  const montage = useMontage();
  const player = usePlayer();

  const [messages, setMessages] = useState<CopilotMessage[]>(() => {
    try {
      const saved = localStorage.getItem(COPILOT_MESSAGES_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((m: CopilotMessage) => ({
            ...m,
            content: typeof m.content === 'string' ? m.content.replace(/,?\s*powered by \*\*CheaperInference\*\*/gi, '') : m.content,
          }));
        }
      }
    } catch {
      // fallback
    }
    return [INITIAL_WELCOME_MESSAGE];
  });

  const [model, setModelState] = useState<string>(() => {
    try {
      return normalizeCopilotModel(localStorage.getItem(COPILOT_MODEL_KEY));
    } catch {
      return DEFAULT_COPILOT_MODEL;
    }
  });

  const [autoApply, setAutoApply] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionHistory, setActionHistory] = useState<CopilotAction[]>([]);
  const [contextPayload, setContextPayload] = useState<CopilotContextPayload>({});
  const navHandlerRef = useRef<((panel: string) => void) | undefined>(undefined);
  const setActivePanelNavHandler = useCallback((fn: (panel: string) => void) => {
    navHandlerRef.current = fn;
  }, []);
  const activePanelNavHandler = useCallback((panel: string) => {
    navHandlerRef.current?.(panel);
  }, []);

  const loadEpisodeHandlerRef = useRef<((tag: string) => void) | undefined>(undefined);
  const setLoadEpisodeHandler = useCallback((fn: (tag: string) => void) => {
    loadEpisodeHandlerRef.current = fn;
  }, []);
  const loadEpisodeHandler = useCallback((tag: string) => {
    loadEpisodeHandlerRef.current?.(tag);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(COPILOT_MESSAGES_STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // ignore
    }
  }, [messages]);

  const setModel = (m: string) => {
    setModelState(m);
    try {
      localStorage.setItem(COPILOT_MODEL_KEY, m);
    } catch {
      // ignore
    }
  };

  const applyAction = useCallback(
    async (
      action: CopilotAction,
      options?: { confirmed?: boolean; triggerSource?: 'user' | 'auto_apply' | 'palette' | 'chain' }
    ): Promise<boolean> => {
      const ctx: CopilotExecutionContext = {
        config,
        updateConfig,
        montage,
        player: {
          play: player.play,
          seek: player.seek,
          isPlaying: player.isPlaying,
          pause: () => {
            if (player.isPlaying) player.togglePlay();
          },
          togglePlay: player.togglePlay,
        },
        contextPayload,
        navHandler: navHandlerRef.current,
        loadEpisodeHandler: loadEpisodeHandlerRef.current,
      };

      const res = await executeCopilotAction(action, ctx, options);

      const updatedAction: CopilotAction = {
        ...action,
        tier: action.tier ?? resolveActionTier(action.action, action.params),
        applied: res.ok,
        appliedAt: res.ok ? new Date().toISOString() : action.appliedAt,
        status: res.status,
        snapshot: res.snapshot || action.snapshot,
        resultData: res.resultData || action.resultData,
        errorMessage: res.errorMessage,
        triggerSource: options?.triggerSource || action.triggerSource || 'user',
      };

      setActionHistory(prev => [
        updatedAction,
        ...prev.filter(a => a.id !== action.id),
      ]);

      setMessages(prev =>
        prev.map(m => {
          if (!m.actions) return m;
          return {
            ...m,
            actions: m.actions.map(a => (a.id === action.id ? updatedAction : a)),
          };
        })
      );

      return res.ok;
    },
    [config, updateConfig, montage, player, contextPayload]
  );

  const revertAction = useCallback(
    async (action: CopilotAction): Promise<boolean> => {
      const ctx: CopilotExecutionContext = {
        config,
        updateConfig,
        montage,
        player: {
          play: player.play,
          seek: player.seek,
          isPlaying: player.isPlaying,
          pause: () => {
            if (player.isPlaying) player.togglePlay();
          },
          togglePlay: player.togglePlay,
        },
        contextPayload,
        navHandler: navHandlerRef.current,
        loadEpisodeHandler: loadEpisodeHandlerRef.current,
      };

      const reverted = await revertCopilotAction(action, ctx);
      if (reverted) {
        const updatedAction: CopilotAction = {
          ...action,
          applied: false,
          reverted: true,
          status: 'pending',
        };

        setActionHistory(prev =>
          prev.map(a => (a.id === action.id ? updatedAction : a))
        );

        setMessages(prev =>
          prev.map(m => {
            if (!m.actions) return m;
            return {
              ...m,
              actions: m.actions.map(a => (a.id === action.id ? updatedAction : a)),
            };
          })
        );
      }
      return reverted;
    },
    [config, updateConfig, montage, player, contextPayload]
  );

  const sendMessage = useCallback(
    async (content: string, override?: Partial<CopilotContextPayload>) => {
      if (!content.trim() || loading) return;

      const userMsg: CopilotMessage = {
        id: `user_${Date.now()}`,
        role: 'user',
        content: content.trim(),
        timestamp: Date.now(),
      };

      const updatedMessages = [...messages, userMsg];
      setMessages(updatedMessages);
      setLoading(true);
      setError(null);

      // Merge current dynamic runtime context
      const dynamicContext: CopilotContextPayload = {
        ...contextPayload,
        ...override,
        // An explicit override (even `undefined`, used by the Copilot's context chips) wins over the live Reel.
        activeMontageClips: override && 'activeMontageClips' in override
          ? override.activeMontageClips
          : montage.clips.map(c => ({
              id: c.id,
              title: c.title,
              quote: c.quote,
              speaker: c.speaker,
              startSec: c.startSec,
              endSec: c.endSec,
              category: c.category,
              tensionScore: c.tensionScore,
            })),
        configSummary: {
          enableTranscription: config.enableTranscription,
          enableScheduledMonitoring: config.enableScheduledMonitoring,
          scheduledCron: config.scheduledCron,
          enableDiscordWebhook: config.enableDiscordWebhook,
          enableSlackWebhook: config.enableSlackWebhook,
          ownerName: config.ownerName,
          repoName: config.repoName,
          podcastTitle: config.podcastTitle,
        },
        compactStateSummary: buildCompactStateSummary({
          activePanel: contextPayload.activeTab,
          player: {
            isPlaying: player.isPlaying,
            current: (player as any).current,
            currentTime: (player as any).currentTime,
            duration: (player as any).duration,
          },
          montage: {
            clipCount: montage.clips.length,
            totalDurationSec: montage.clips.reduce((acc, c) => acc + Math.max(0, c.endSec - c.startSec), 0),
            targetDurationSec: montage.targetDurationSec,
            isAuditioning: montage.isAuditioning,
          },
          config: {
            enableTranscription: config.enableTranscription,
            enableScheduledMonitoring: config.enableScheduledMonitoring,
            enableDiscordWebhook: config.enableDiscordWebhook,
            enableSlackWebhook: config.enableSlackWebhook,
            hasGithubToken: Boolean(config.githubToken),
            targetRepo: config.repoName ? `${config.ownerName}/${config.repoName}` : undefined,
          },
        }),
      };

      try {
        const req: CopilotRequestBody = {
          messages: updatedMessages.map(m => ({
            role: m.role,
            content: m.content,
          })),
          model,
          context: dynamicContext,
        };

        const res = await sendCopilotMessage({ req });

        const enrichedActions: CopilotAction[] = (res.actions || []).map(a => {
          const tier = a.tier ?? resolveActionTier(a.action, a.params);
          return {
            ...a,
            tier,
            status: a.action === 'SEARCH_TRANSCRIPTS' ? (a.status || 'completed') : 'pending',
          };
        });

        const assistantMsg: CopilotMessage = {
          id: `asst_${Date.now()}`,
          role: 'assistant',
          content: res.text,
          timestamp: Date.now(),
          actions: enrichedActions,
          matches: res.matches,
          model: res.model,
          usage: res.usage,
        };

        setMessages(prev => [...prev, assistantMsg]);

        // Auto-apply if enabled — STRICTLY restricted to Tier 0 or Tier 1 actions!
        // Tier 2 actions (enqueuing, workflows, GPU/paid generation, sensitive config)
        // ALWAYS require user confirmation, even with autoApply ON.
        if (autoApply && enrichedActions.length > 0) {
          for (const action of enrichedActions) {
            if (action.tier !== undefined && action.tier < 2 && action.action !== 'SEARCH_TRANSCRIPTS') {
              await applyAction(action, { triggerSource: 'auto_apply' });
            }
          }
        }
      } catch (err: any) {
        const msg = err?.message || 'Error communicating with AI service';
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [messages, loading, model, contextPayload, montage.clips, config, autoApply, applyAction]
  );

  const clearMessages = useCallback(() => {
    setMessages([INITIAL_WELCOME_MESSAGE]);
    try {
      localStorage.removeItem(COPILOT_MESSAGES_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  return (
    <CopilotContext.Provider
      value={{
        messages,
        loading,
        error,
        model,
        setModel,
        autoApply,
        setAutoApply,
        actionHistory,
        contextPayload,
        setContextPayload,
        sendMessage,
        applyAction,
        revertAction,
        clearMessages,
        activePanelNavHandler,
        setActivePanelNavHandler,
        loadEpisodeHandler,
        setLoadEpisodeHandler,
      }}
    >
      {children}
    </CopilotContext.Provider>
  );
};

const FALLBACK_COPILOT_CONTEXT: CopilotContextType = {
  messages: [],
  loading: false,
  error: null,
  model: DEFAULT_COPILOT_MODEL,
  setModel: () => {},
  autoApply: false,
  setAutoApply: () => {},
  actionHistory: [],
  contextPayload: {},
  setContextPayload: () => {},
  sendMessage: async () => {},
  applyAction: async () => false,
  revertAction: async () => false,
  clearMessages: () => {},
  setActivePanelNavHandler: () => {},
  setLoadEpisodeHandler: () => {},
};

export const useCopilot = (): CopilotContextType => {
  const ctx = useContext(CopilotContext);
  if (!ctx) {
    console.warn('[CopilotContext] useCopilot invoked outside a CopilotProvider. Returning safe fallback context.');
    return FALLBACK_COPILOT_CONTEXT;
  }
  return ctx;
};
