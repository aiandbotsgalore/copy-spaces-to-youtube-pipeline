import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type {
  CopilotAction,
  CopilotMessage,
  CopilotContextPayload,
  CopilotRequestBody,
} from '../utils/copilotTypes';
import { sendCopilotMessage } from '../utils/copilotClient';
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
  applyAction: (action: CopilotAction) => Promise<boolean>;
  revertAction: (action: CopilotAction) => Promise<boolean>;
  clearMessages: () => void;
  activePanelNavHandler?: (panel: string) => void;
  setActivePanelNavHandler: (fn: (panel: string) => void) => void;
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
      return localStorage.getItem(COPILOT_MODEL_KEY) || 'claude-sonnet-5.5';
    } catch {
      return 'claude-sonnet-5.5';
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

  const prevMontageSnapshotRef = useRef<Record<string, any>>({});

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
    async (action: CopilotAction): Promise<boolean> => {
      try {
        switch (action.action) {
          case 'CREATE_CLIP': {
            const p = action.params;
            const newClipId = `clip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            const start = Number(p.startSec) || 0;
            const end = Number(p.endSec) || start + 30;
            const score = Number(p.viralScore) || 75;

            montage.addClip({
              id: newClipId,
              title: p.title || 'Extracted Soundbite',
              quote: p.quote || p.title || '',
              speaker: p.speaker || 'Unknown',
              sourceTitle: p.sourceTitle || contextPayload.currentEpisode?.title || 'Episode Space',
              sourceTag: p.episodeTag || contextPayload.currentEpisode?.releaseTag,
              audioUrl: p.audioUrl || contextPayload.currentEpisode?.audioUrl,
              startSec: start,
              endSec: end,
              category: p.category || 'Highlights',
              severity: Math.min(10, Math.max(1, Math.round(score / 10))),
              tensionScore: Math.min(10, Math.max(1, Math.round(score / 10))),
              directorNote: p.reason || action.explanation,
            });
            break;
          }

          case 'TRIM_CLIP': {
            const { clipId, newStartSec, newEndSec, reason } = action.params;
            if (clipId) {
              const existing = montage.clips.find(c => c.id === clipId);
              if (existing) {
                prevMontageSnapshotRef.current[clipId] = {
                  startSec: existing.startSec,
                  endSec: existing.endSec,
                };
              }
              montage.updateClip(clipId, {
                startSec: Number(newStartSec) || 0,
                endSec: Number(newEndSec) || 0,
                directorNote: reason || action.explanation,
              });
            }
            break;
          }

          case 'SEQUENCE_MONTAGE': {
            const { clipIds, tensionScores, reason } = action.params;
            if (Array.isArray(clipIds) && clipIds.length > 0) {
              const currentClips = [...montage.clips];
              const clipMap = new Map(currentClips.map(c => [c.id, c]));
              const reordered = clipIds
                .map(id => clipMap.get(id))
                .filter((c): c is typeof currentClips[0] => !!c);

              // Apply updated tension scores if provided
              if (tensionScores && typeof tensionScores === 'object') {
                reordered.forEach(c => {
                  if (tensionScores[c.id] !== undefined) {
                    c.tensionScore = Number(tensionScores[c.id]);
                  }
                  if (reason) c.directorNote = reason;
                });
              }

              montage.replaceClips(reordered);
            }
            break;
          }

          case 'PLAY_AUDIO': {
            const { timestampSec, audioUrl, title } = action.params;
            const targetUrl = audioUrl || contextPayload.currentEpisode?.audioUrl;
            if (targetUrl) {
              player.play(
                {
                  id: contextPayload.currentEpisode?.releaseId || Date.now(),
                  title: title || contextPayload.currentEpisode?.title || 'Episode Space',
                  audioUrl: targetUrl,
                },
                Number(timestampSec) || 0
              );
            } else if (Number.isFinite(timestampSec)) {
              player.seek(Number(timestampSec));
            }
            break;
          }

          case 'UPDATE_CONFIG': {
            const { updates } = action.params;
            if (updates && typeof updates === 'object') {
              updateConfig(updates);
            }
            break;
          }

          case 'NAVIGATE_TAB': {
            const { tab } = action.params;
            if (tab && navHandlerRef.current) {
              navHandlerRef.current(tab);
            }
            break;
          }

          case 'AUDITION_MONTAGE': {
            montage.startAudition();
            break;
          }

          case 'SEARCH_TRANSCRIPTS': {
            // Read-only search action executed server-side — decoupled from timeline mutations
            return true;
          }

          case 'LOAD_EPISODE': {
            if (navHandlerRef.current) {
              navHandlerRef.current('transcripts');
            }
            break;
          }

          default:
            console.warn('Unknown Copilot action:', action.action);
        }

        // Mark mutation action as applied
        setActionHistory(prev => [
          { ...action, applied: true, appliedAt: new Date().toISOString() },
          ...prev.filter(a => a.id !== action.id),
        ]);
        setMessages(prev =>
          prev.map(m => {
            if (!m.actions) return m;
            return {
              ...m,
              actions: m.actions.map(a =>
                a.id === action.id ? { ...a, applied: true, appliedAt: new Date().toISOString() } : a
              ),
            };
          })
        );
        return true;
      } catch (err) {
        console.error('Failed to apply action:', err);
        return false;
      }
    },
    [montage, player, contextPayload, updateConfig]
  );

  const revertAction = useCallback(
    async (action: CopilotAction): Promise<boolean> => {
      try {
        if (action.action === 'TRIM_CLIP') {
          const clipId = action.params.clipId;
          const orig = prevMontageSnapshotRef.current[clipId];
          if (orig) {
            montage.updateClip(clipId, {
              startSec: orig.startSec,
              endSec: orig.endSec,
            });
          }
        } else if (action.action === 'SEQUENCE_MONTAGE') {
          if (montage.canUndo) montage.undo();
        } else if (action.action === 'CREATE_CLIP') {
          // If created clip was the last added, undo
          if (montage.canUndo) montage.undo();
        }

        setActionHistory(prev =>
          prev.map(a => (a.id === action.id ? { ...a, applied: false, reverted: true } : a))
        );
        setMessages(prev =>
          prev.map(m => {
            if (!m.actions) return m;
            return {
              ...m,
              actions: m.actions.map(a =>
                a.id === action.id ? { ...a, applied: false, reverted: true } : a
              ),
            };
          })
        );
        return true;
      } catch (err) {
        console.error('Failed to revert action:', err);
        return false;
      }
    },
    [montage]
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
        activeMontageClips: montage.clips.map(c => ({
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

        const assistantMsg: CopilotMessage = {
          id: `asst_${Date.now()}`,
          role: 'assistant',
          content: res.text,
          timestamp: Date.now(),
          actions: res.actions,
          matches: res.matches,
          model: res.model,
          usage: res.usage,
        };

        setMessages(prev => [...prev, assistantMsg]);

        // Auto-apply if enabled (timeline mutations only, never read-only searches)
        if (autoApply && res.actions && res.actions.length > 0) {
          for (const action of res.actions) {
            if (action.action !== 'SEARCH_TRANSCRIPTS') {
              await applyAction(action);
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
  model: 'gemini-2.5-flash',
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
};

export const useCopilot = (): CopilotContextType => {
  const ctx = useContext(CopilotContext);
  if (!ctx) {
    console.warn('[CopilotContext] useCopilot invoked outside a CopilotProvider. Returning safe fallback context.');
    return FALLBACK_COPILOT_CONTEXT;
  }
  return ctx;
};
