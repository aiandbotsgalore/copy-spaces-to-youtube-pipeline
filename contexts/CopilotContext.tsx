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
import {
  type CopilotSession,
  type PinnedContextItem,
  loadAllSessions,
  saveSession,
  deleteSessionFromDB,
  exportSessionToMarkdown,
  ACTIVE_SESSION_ID_KEY,
  WIDGET_SESSION_ID,
  DEFAULT_SESSION_ID,
  INITIAL_WELCOME_MESSAGE,
} from '../utils/copilotStorage';
import { triggerBlobDownload } from '../utils/zipUtils';
import { useConfig } from './ConfigContext';
import { useMontage } from './MontageContext';
import { usePlayer } from './PlayerContext';

const COPILOT_MODEL_KEY = 'spacepipe_copilot_model_v1';

export interface CopilotContextType {
  sessions: CopilotSession[];
  activeSessionId: string;
  setActiveSessionId: (id: string) => void;
  createSession: (title?: string, isWidget?: boolean) => Promise<string>;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, newTitle: string) => Promise<void>;
  exportSessionMarkdown: (id?: string) => void;
  pinnedContexts: PinnedContextItem[];
  addPinnedContext: (item: PinnedContextItem) => void;
  removePinnedContext: (id: string) => void;
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
  sendMessage: (
    content: string,
    override?: Partial<CopilotContextPayload>,
    options?: { targetSessionId?: string; liveContext?: string }
  ) => Promise<void>;
  applyAction: (
    action: CopilotAction,
    options?: { confirmed?: boolean; triggerSource?: 'user' | 'auto_apply' | 'palette' | 'chain' }
  ) => Promise<boolean>;
  revertAction: (action: CopilotAction) => Promise<boolean>;
  analyzeActionResults?: (action: CopilotAction) => Promise<void>;
  clearMessages: (sessionId?: string) => void;
  activePanelNavHandler?: (panel: string) => void;
  setActivePanelNavHandler: (fn: (panel: string) => void) => void;
  loadEpisodeHandler?: (tag: string) => void;
  setLoadEpisodeHandler: (fn: (tag: string) => void) => void;
  widgetSessionId: string;
}

const CopilotContext = createContext<CopilotContextType | null>(null);

export const CopilotProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { config, updateConfig } = useConfig();
  const montage = useMontage();
  const player = usePlayer();

  const [sessions, setSessions] = useState<CopilotSession[]>([]);
  const [activeSessionId, setActiveSessionIdState] = useState<string>(() => {
    try {
      return localStorage.getItem(ACTIVE_SESSION_ID_KEY) || DEFAULT_SESSION_ID;
    } catch {
      return DEFAULT_SESSION_ID;
    }
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
  const [contextPayload, setContextPayload] = useState<CopilotContextPayload>({});
  const navHandlerRef = useRef<((panel: string) => void) | undefined>(undefined);
  const loadEpisodeHandlerRef = useRef<((tag: string) => void) | undefined>(undefined);

  // Initialize sessions from IndexedDB on startup
  useEffect(() => {
    let isMounted = true;
    loadAllSessions().then((loaded) => {
      if (!isMounted) return;
      setSessions(loaded);
      if (loaded.length > 0 && !loaded.some(s => s.id === activeSessionId)) {
        const nextId = loaded.find(s => s.id !== WIDGET_SESSION_ID)?.id || loaded[0].id;
        setActiveSessionIdState(nextId);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const setActiveSessionId = useCallback((id: string) => {
    setActiveSessionIdState(id);
    try {
      localStorage.setItem(ACTIVE_SESSION_ID_KEY, id);
    } catch {}
  }, []);

  const currentSession = sessions.find(s => s.id === activeSessionId) || sessions[0] || {
    id: DEFAULT_SESSION_ID,
    title: 'Session 1',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [INITIAL_WELCOME_MESSAGE],
    actionHistory: [],
    pinnedContexts: [],
  };

  const messages = currentSession.messages || [];
  const actionHistory = currentSession.actionHistory || [];
  const pinnedContexts = currentSession.pinnedContexts || [];

  const updateSessionData = useCallback((sessionId: string, updater: (prev: CopilotSession) => CopilotSession) => {
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === sessionId);
      if (idx === -1) return prev;
      const updated = updater(prev[idx]);
      const next = [...prev];
      next[idx] = updated;
      saveSession(updated);
      return next;
    });
  }, []);

  const createSession = useCallback(async (title?: string, isWidget = false): Promise<string> => {
    const newId = `session_${Date.now()}`;
    const newSession: CopilotSession = {
      id: newId,
      title: title || `Session ${sessions.filter(s => !s.isWidgetSession).length + 1}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [INITIAL_WELCOME_MESSAGE],
      actionHistory: [],
      pinnedContexts: [],
      isWidgetSession: isWidget,
    };

    await saveSession(newSession);
    setSessions((prev) => [...prev, newSession]);
    setActiveSessionId(newId);
    return newId;
  }, [sessions, setActiveSessionId]);

  const deleteSession = useCallback(async (id: string) => {
    if (id === WIDGET_SESSION_ID) return; // Prevent deleting designated widget session
    await deleteSessionFromDB(id);
    setSessions((prev) => {
      const remaining = prev.filter((s) => s.id !== id);
      if (activeSessionId === id && remaining.length > 0) {
        const fallback = remaining.find((s) => s.id !== WIDGET_SESSION_ID) || remaining[0];
        setActiveSessionId(fallback.id);
      }
      return remaining;
    });
  }, [activeSessionId, setActiveSessionId]);

  const renameSession = useCallback(async (id: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    updateSessionData(id, (prev) => ({
      ...prev,
      title: trimmed,
      updatedAt: Date.now(),
    }));
  }, [updateSessionData]);

  const clearMessages = useCallback((sessionId?: string) => {
    const targetId = sessionId || activeSessionId;
    updateSessionData(targetId, (prev) => ({
      ...prev,
      messages: [INITIAL_WELCOME_MESSAGE],
      actionHistory: [],
      updatedAt: Date.now(),
    }));
  }, [activeSessionId, updateSessionData]);

  const addPinnedContext = useCallback((item: PinnedContextItem) => {
    updateSessionData(activeSessionId, (prev) => {
      const existing = prev.pinnedContexts || [];
      if (existing.some((c) => c.id === item.id)) return prev;
      return {
        ...prev,
        pinnedContexts: [...existing, { ...item, addedAt: Date.now() }],
        updatedAt: Date.now(),
      };
    });
  }, [activeSessionId, updateSessionData]);

  const removePinnedContext = useCallback((id: string) => {
    updateSessionData(activeSessionId, (prev) => ({
      ...prev,
      pinnedContexts: (prev.pinnedContexts || []).filter((c) => c.id !== id),
      updatedAt: Date.now(),
    }));
  }, [activeSessionId, updateSessionData]);

  const exportSessionMarkdown = useCallback((id?: string) => {
    const target = sessions.find((s) => s.id === (id || activeSessionId)) || currentSession;
    const md = exportSessionToMarkdown(target);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const filename = `Copilot_${target.title.replace(/[^a-zA-Z0-9_-]/g, '_')}_${new Date().toISOString().slice(0, 10)}.md`;
    triggerBlobDownload(blob, filename);
  }, [sessions, activeSessionId, currentSession]);

  const setActivePanelNavHandler = useCallback((fn: (panel: string) => void) => {
    navHandlerRef.current = fn;
  }, []);
  const activePanelNavHandler = useCallback((panel: string) => {
    navHandlerRef.current?.(panel);
  }, []);

  const setLoadEpisodeHandler = useCallback((fn: (tag: string) => void) => {
    loadEpisodeHandlerRef.current = fn;
  }, []);
  const loadEpisodeHandler = useCallback((tag: string) => {
    loadEpisodeHandlerRef.current?.(tag);
  }, []);

  const setModel = (m: string) => {
    setModelState(m);
    try {
      localStorage.setItem(COPILOT_MODEL_KEY, m);
    } catch {}
  };

  const applyAction = useCallback(
    async (
      action: CopilotAction,
      options?: { confirmed?: boolean; triggerSource?: 'user' | 'auto_apply' | 'palette' | 'chain' }
    ): Promise<boolean> => {
      const startTime = Date.now();
      const runningAction: CopilotAction = {
        ...action,
        status: 'running',
        appliedAt: new Date().toISOString(),
        triggerSource: options?.triggerSource || action.triggerSource || 'user',
      };

      updateSessionData(activeSessionId, (prev) => ({
        ...prev,
        messages: prev.messages.map((m) => {
          if (!m.actions) return m;
          return {
            ...m,
            actions: m.actions.map((a) => (a.id === action.id ? runningAction : a)),
          };
        }),
      }));

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
      const executionDurationMs = Date.now() - startTime;

      const updatedAction: CopilotAction = {
        ...action,
        tier: action.tier ?? resolveActionTier(action.action, action.params),
        applied: res.ok,
        appliedAt: new Date().toISOString(),
        executionDurationMs,
        status: res.status,
        snapshot: res.snapshot || action.snapshot,
        resultData: res.resultData || action.resultData,
        errorMessage: res.errorMessage,
        triggerSource: options?.triggerSource || action.triggerSource || 'user',
      };

      updateSessionData(activeSessionId, (prev) => ({
        ...prev,
        actionHistory: [updatedAction, ...(prev.actionHistory || []).filter((a) => a.id !== action.id)],
        messages: prev.messages.map((m) => {
          if (!m.actions) return m;
          return {
            ...m,
            actions: m.actions.map((a) => (a.id === action.id ? updatedAction : a)),
          };
        }),
      }));

      return res.ok;
    },
    [activeSessionId, config, updateConfig, montage, player, contextPayload, updateSessionData]
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

        updateSessionData(activeSessionId, (prev) => ({
          ...prev,
          actionHistory: (prev.actionHistory || []).map((a) => (a.id === action.id ? updatedAction : a)),
          messages: prev.messages.map((m) => {
            if (!m.actions) return m;
            return {
              ...m,
              actions: m.actions.map((a) => (a.id === action.id ? updatedAction : a)),
            };
          }),
        }));
      }
      return reverted;
    },
    [activeSessionId, config, updateConfig, montage, player, contextPayload, updateSessionData]
  );

  const sendMessage = useCallback(
    async (
      content: string,
      override?: Partial<CopilotContextPayload>,
      options?: { targetSessionId?: string; liveContext?: string }
    ) => {
      if (!content.trim() || loading) return;

      const targetId = options?.targetSessionId || activeSessionId;
      const targetSession = sessions.find((s) => s.id === targetId) || currentSession;
      const existingMessages = targetSession.messages || [];

      const userMsg: CopilotMessage = {
        id: `user_${Date.now()}`,
        role: 'user',
        content: content.trim(),
        timestamp: Date.now(),
      };

      const updatedMessages = [...existingMessages, userMsg];

      // Optimistically update target session
      updateSessionData(targetId, (prev) => ({
        ...prev,
        messages: updatedMessages,
        updatedAt: Date.now(),
      }));

      setLoading(true);
      setError(null);

      // Build live grounding including pinned items & liveContext
      const sessionPinned = targetSession.pinnedContexts || [];
      const pinnedText = sessionPinned.length > 0
        ? `PINNED GROUNDING CONTEXTS:\n${sessionPinned.map((c) => `- [${c.type.toUpperCase()}] ${c.title}: ${c.detail || ''}`).join('\n')}`
        : '';

      const liveContextSummary = options?.liveContext ? `LIVE VIEW STATE: ${options.liveContext}` : '';

      const dynamicContext: CopilotContextPayload = {
        ...contextPayload,
        ...override,
        activeMontageClips: override && 'activeMontageClips' in override
          ? override.activeMontageClips
          : montage.clips.map((c) => ({
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
        compactStateSummary: [
          liveContextSummary,
          pinnedText,
          buildCompactStateSummary({
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
        ].filter(Boolean).join('\n\n'),
      };

      try {
        const req: CopilotRequestBody = {
          messages: updatedMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          model,
          context: {
            ...dynamicContext,
            ownerName: config.ownerName,
            repoName: config.repoName,
          },
        };

        const res = await sendCopilotMessage({
          req,
          githubToken: config.githubToken,
        });

        if (res.inspectedRuns && Object.keys(res.inspectedRuns).length > 0) {
          setContextPayload((prev) => ({
            ...prev,
            inspectedRuns: {
              ...(prev.inspectedRuns || {}),
              ...res.inspectedRuns,
            },
          }));
        }

        const enrichedActions: CopilotAction[] = (res.actions || []).map((a) => {
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

        updateSessionData(targetId, (prev) => ({
          ...prev,
          messages: [...prev.messages, assistantMsg],
          updatedAt: Date.now(),
        }));

        if (autoApply && enrichedActions.length > 0) {
          for (const action of enrichedActions) {
            const isReadOnly = action.action === 'SEARCH_TRANSCRIPTS' || action.action.startsWith('GET_');
            if (!isReadOnly && action.status !== 'completed' && action.tier !== undefined && action.tier < 2) {
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
    [
      loading,
      activeSessionId,
      sessions,
      currentSession,
      updateSessionData,
      contextPayload,
      montage.clips,
      montage.targetDurationSec,
      montage.isAuditioning,
      config,
      player,
      model,
      autoApply,
      applyAction,
    ]
  );

  return (
    <CopilotContext.Provider
      value={{
        sessions,
        activeSessionId,
        setActiveSessionId,
        createSession,
        deleteSession,
        renameSession,
        exportSessionMarkdown,
        pinnedContexts,
        addPinnedContext,
        removePinnedContext,
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
        widgetSessionId: WIDGET_SESSION_ID,
      }}
    >
      {children}
    </CopilotContext.Provider>
  );
};

export const useCopilot = (): CopilotContextType => {
  const context = useContext(CopilotContext);
  if (!context) {
    throw new Error('useCopilot must be used within a CopilotProvider');
  }
  return context;
};
