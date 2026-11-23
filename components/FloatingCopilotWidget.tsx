import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Bot,
  X,
  Send,
  Maximize2,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  RotateCcw,
  Plus,
} from 'lucide-react';
import { useCopilot } from '../contexts/CopilotContext';
import { useConfig } from '../contexts/ConfigContext';
import { usePlayer } from '../contexts/PlayerContext';
import { useMontage } from '../contexts/MontageContext';
import { CopilotMarkdown } from './CopilotMarkdown';
import { extractLiveStudioContext } from '../utils/liveContextExtractor';
import { sendCopilotMessage } from '../utils/copilotClient';
import { buildCompactStateSummary } from '../utils/copilotState';
import { resolveActionTier } from '../utils/contracts/copilotActions';
import { DEFAULT_COPILOT_MODEL } from '../utils/copilotModels';
import { saveSession, type CopilotSession } from '../utils/copilotStorage';
import type {
  CopilotMessage,
  CopilotAction,
  CopilotContextPayload,
  CopilotRequestBody,
} from '../utils/copilotTypes';

export interface CopilotWidgetTab {
  id: string;
  title: string;
  messages: CopilotMessage[];
  inputDraft: string;
  includeContext: boolean;
  createdAt: number;
  updatedAt: number;
}

export const COPILOT_WIDGET_TABS_STORAGE_KEY = 'spacepipe_copilot_widget_tabs_v1';
export const COPILOT_WIDGET_ACTIVE_TAB_STORAGE_KEY = 'spacepipe_copilot_widget_active_tab_v1';

export function createDefaultWidgetTab(title = 'Chat 1'): CopilotWidgetTab {
  return {
    id: `widget_tab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title,
    messages: [],
    inputDraft: '',
    includeContext: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function getNextChatNumber(tabs: CopilotWidgetTab[]): number {
  let highest = 0;
  for (const t of tabs) {
    const match = t.title.match(/^Chat (\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > highest) {
        highest = num;
      }
    }
  }
  return Math.max(highest + 1, tabs.length + 1);
}

interface FloatingCopilotWidgetProps {
  activeTab: string;
}

export const FloatingCopilotWidget: React.FC<FloatingCopilotWidgetProps> = ({ activeTab }) => {
  const {
    model,
    autoApply,
    applyAction,
    contextPayload,
    widgetSessionId,
    setActiveSessionId,
    updateSessionData,
  } = useCopilot();

  const { config } = useConfig();
  const player = usePlayer();
  const montage = useMontage();

  const [isOpen, setIsOpen] = useState(false);
  const [contextRefreshKey, setContextRefreshKey] = useState(0);

  // Tabs state persisted in localStorage
  const [tabs, setTabs] = useState<CopilotWidgetTab[]>(() => {
    try {
      const stored = localStorage.getItem(COPILOT_WIDGET_TABS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('[FloatingCopilotWidget] Failed to load tabs from localStorage:', e);
    }
    return [createDefaultWidgetTab('Chat 1')];
  });

  const [activeTabId, setActiveTabId] = useState<string>(() => {
    try {
      const storedActive = localStorage.getItem(COPILOT_WIDGET_ACTIVE_TAB_STORAGE_KEY);
      if (storedActive) return storedActive;
    } catch {}
    return tabs[0]?.id || '';
  });

  // Track per-tab loading & errors
  const [loadingTabIds, setLoadingTabIds] = useState<Set<string>>(new Set());
  const [tabErrors, setTabErrors] = useState<Record<string, string>>({});
  const abortControllersRef = useRef<Record<string, AbortController>>({});

  // Active tab object
  const activeTabObj = useMemo(() => {
    return tabs.find((t) => t.id === activeTabId) || tabs[0] || createDefaultWidgetTab('Chat 1');
  }, [tabs, activeTabId]);

  // Ensure activeTabId is valid
  useEffect(() => {
    if (!tabs.some((t) => t.id === activeTabId)) {
      if (tabs.length > 0) {
        setActiveTabId(tabs[0].id);
      }
    }
  }, [tabs, activeTabId]);

  // Persist tabs to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(COPILOT_WIDGET_TABS_STORAGE_KEY, JSON.stringify(tabs));
    } catch (e) {
      console.warn('[FloatingCopilotWidget] Failed to persist tabs to localStorage:', e);
    }
  }, [tabs]);

  // Persist active tab ID to localStorage
  useEffect(() => {
    try {
      if (activeTabId) {
        localStorage.setItem(COPILOT_WIDGET_ACTIVE_TAB_STORAGE_KEY, activeTabId);
      }
    } catch (e) {
      console.warn('[FloatingCopilotWidget] Failed to persist activeTabId to localStorage:', e);
    }
  }, [activeTabId]);

  // Active tab's input draft
  const [input, setInput] = useState(() => activeTabObj?.inputDraft || '');
  const prevActiveTabIdRef = useRef(activeTabId);

  useEffect(() => {
    if (prevActiveTabIdRef.current !== activeTabId) {
      prevActiveTabIdRef.current = activeTabId;
      const target = tabs.find((t) => t.id === activeTabId);
      setInput(target?.inputDraft || '');
    }
  }, [activeTabId, tabs]);

  const handleInputChange = (val: string) => {
    setInput(val);
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? { ...t, inputDraft: val, updatedAt: Date.now() } : t))
    );
  };

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Read LIVE non-stale context of current tab
  const liveContext = useMemo(() => {
    return extractLiveStudioContext(activeTab);
  }, [activeTab, contextRefreshKey]);

  const messages = activeTabObj?.messages || [];
  const includeContext = activeTabObj?.includeContext ?? true;
  const isLoadingActive = loadingTabIds.has(activeTabId);
  const currentError = tabErrors[activeTabId] || null;

  // Toggle shortcut: Alt + C
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isLoadingActive, isOpen, activeTabId]);

  // Tab management handlers
  const handleSelectTab = (tabId: string) => {
    if (tabId === activeTabId) return;
    setActiveTabId(tabId);
    const target = tabs.find((t) => t.id === tabId);
    setInput(target?.inputDraft || '');
  };

  const handleNewTab = () => {
    const nextNum = getNextChatNumber(tabs);
    const newTab = createDefaultWidgetTab(`Chat ${nextNum}`);
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
    setInput('');
    setTabErrors((prev) => {
      const next = { ...prev };
      delete next[newTab.id];
      return next;
    });
  };

  const handleCloseTab = (idToClose: string) => {
    if (abortControllersRef.current[idToClose]) {
      abortControllersRef.current[idToClose]?.abort();
      delete abortControllersRef.current[idToClose];
    }
    setLoadingTabIds((prev) => {
      const next = new Set(prev);
      next.delete(idToClose);
      return next;
    });

    if (tabs.length <= 1) {
      const freshTab = createDefaultWidgetTab('Chat 1');
      setTabs([freshTab]);
      setActiveTabId(freshTab.id);
      setInput('');
      setTabErrors({});
      return;
    }

    const remaining = tabs.filter((t) => t.id !== idToClose);
    setTabs(remaining);

    if (activeTabId === idToClose) {
      const closedIndex = tabs.findIndex((t) => t.id === idToClose);
      const nextTab = remaining[Math.min(closedIndex, remaining.length - 1)];
      setActiveTabId(nextTab.id);
      setInput(nextTab.inputDraft || '');
    }
  };

  const handleToggleContext = () => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId
          ? { ...t, includeContext: !t.includeContext, updatedAt: Date.now() }
          : t
      )
    );
  };

  // Clear Context & Reset Handler
  const handleClearContext = () => {
    // 1. Wipe input & draft
    setInput('');
    setTabErrors((prev) => {
      const next = { ...prev };
      delete next[activeTabId];
      return next;
    });

    // 2. Abort any running in-flight request for active tab
    if (abortControllersRef.current[activeTabId]) {
      abortControllersRef.current[activeTabId]?.abort();
      delete abortControllersRef.current[activeTabId];
    }
    setLoadingTabIds((prev) => {
      const next = new Set(prev);
      next.delete(activeTabId);
      return next;
    });

    // 3. Reset any stale active-episode or search telemetry bindings
    try {
      sessionStorage.removeItem('spacepipe_transcript_search_q');
      sessionStorage.removeItem('spacepipe_radar_selection');
    } catch {}

    // 4. Wipe active tab messages, draft, and restore fresh context toggle
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId
          ? {
              ...t,
              messages: [],
              inputDraft: '',
              includeContext: true,
              updatedAt: Date.now(),
            }
          : t
      )
    );

    // 5. Trigger fresh live context extraction
    setContextRefreshKey((k) => k + 1);
  };

  const handleSend = async (textToSend?: string) => {
    const targetTabId = activeTabId;
    const currentTab = tabs.find((t) => t.id === targetTabId);
    if (!currentTab) return;

    const msg = (textToSend || input).trim();
    if (!msg || loadingTabIds.has(targetTabId)) return;

    const userMsg: CopilotMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: msg,
      timestamp: Date.now(),
    };

    // Auto-title tab from the first prompt
    const shouldAutoTitle = currentTab.messages.length === 0 || /^Chat \d+$/.test(currentTab.title);
    const cleanPrompt = msg.replace(/\s+/g, ' ').trim();
    const updatedTitle = shouldAutoTitle
      ? (cleanPrompt.length > 18 ? `${cleanPrompt.slice(0, 16)}…` : cleanPrompt)
      : currentTab.title;

    const updatedMessages = [...currentTab.messages, userMsg];

    // Optimistically update tab in state
    setTabs((prev) =>
      prev.map((t) =>
        t.id === targetTabId
          ? {
              ...t,
              title: updatedTitle,
              messages: updatedMessages,
              inputDraft: '',
              updatedAt: Date.now(),
            }
          : t
      )
    );

    if (!textToSend) {
      setInput('');
    }

    setLoadingTabIds((prev) => new Set(prev).add(targetTabId));
    setTabErrors((prev) => {
      const next = { ...prev };
      delete next[targetTabId];
      return next;
    });

    const controller = new AbortController();
    abortControllersRef.current[targetTabId] = controller;

    try {
      const liveContextSummary = currentTab.includeContext ? `LIVE VIEW STATE: ${liveContext.contextSummary}` : '';

      const dynamicContext: CopilotContextPayload = {
        ...contextPayload,
        activeMontageClips: montage.clips.map((c) => ({
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
          buildCompactStateSummary({
            activePanel: activeTab,
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

      const req: CopilotRequestBody = {
        messages: updatedMessages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        model: model || DEFAULT_COPILOT_MODEL,
        context: {
          ...dynamicContext,
          ownerName: config.ownerName,
          repoName: config.repoName,
        },
      };

      const res = await sendCopilotMessage({
        req,
        githubToken: config.githubToken,
        signal: controller.signal,
      });

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

      // Append response to target tab
      setTabs((prev) =>
        prev.map((t) =>
          t.id === targetTabId
            ? {
                ...t,
                messages: [...t.messages, assistantMsg],
                updatedAt: Date.now(),
              }
            : t
        )
      );

      if (autoApply && enrichedActions.length > 0) {
        for (const action of enrichedActions) {
          const isReadOnly = action.action === 'SEARCH_TRANSCRIPTS' || action.action.startsWith('GET_') || action.action === 'INSPECT_KNOWLEDGE_GRAPH' || action.action === 'FETCH_RAW_AUDIO' || action.action === 'READ_FILE' || action.action === 'INTROSPECT_NODE_LINKAGE' || action.action === 'REVEAL_VECTOR_EMBEDDINGS' || action.action === 'STREAM_LIVE_LOGS';
          if (!isReadOnly && action.status !== 'completed' && action.tier !== undefined && action.tier < 2) {
            await applyAction(action, { triggerSource: 'auto_apply' });
          }
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return;
      }
      const errorMsg = err?.message || 'Error communicating with AI service';
      setTabErrors((prev) => ({ ...prev, [targetTabId]: errorMsg }));
    } finally {
      delete abortControllersRef.current[targetTabId];
      setLoadingTabIds((prev) => {
        const next = new Set(prev);
        next.delete(targetTabId);
        return next;
      });
    }
  };

  const handleExpandToStudioTab = async () => {
    if (activeTabObj) {
      const sessionToSave: CopilotSession = {
        id: widgetSessionId,
        title: activeTabObj.title || 'Quick Widget Chat',
        createdAt: activeTabObj.createdAt,
        updatedAt: Date.now(),
        messages: activeTabObj.messages.length > 0 ? activeTabObj.messages : [
          {
            id: 'widget_welcome',
            role: 'assistant',
            content: '👋 **Quick Copilot Widget Active!** Ask questions about this tab or anything in your pipeline.',
            timestamp: Date.now(),
          },
        ],
        actionHistory: [],
        isWidgetSession: true,
      };
      await saveSession(sessionToSave);
      if (updateSessionData) {
        updateSessionData(widgetSessionId, () => sessionToSave);
      }
    }
    setActiveSessionId(widgetSessionId);
    window.location.hash = '#ai-copilot';
    setIsOpen(false);
  };

  // If user is currently on the dedicated AI Copilot tab, hide floating launcher completely
  if (activeTab === 'ai-copilot') {
    return null;
  }

  return (
    <div className="fixed bottom-20 right-5 z-40 flex flex-col items-end select-none">
      {/* Expanded Floating Drawer Panel */}
      {isOpen && (
        <div className="mb-3 w-[420px] max-w-[calc(100vw-2.5rem)] h-[580px] max-h-[calc(100vh-10rem)] bg-slate-900/95 border border-slate-700/80 rounded-2xl shadow-2xl backdrop-blur-md flex flex-col overflow-hidden text-slate-200 animate-in fade-in zoom-in-95 duration-200">
          {/* Header */}
          <div className="px-4 py-3 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                <Bot size={15} />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-xs text-white">SpacePipe Copilot</span>
                  <span className="text-[10px] text-slate-500 font-mono">Alt+C</span>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-indigo-400 font-medium">
                  <span>Context:</span>
                  <span className="text-slate-300 font-semibold">{liveContext.badge}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              {/* Context Toggle */}
              <button
                type="button"
                onClick={handleToggleContext}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] border transition-colors cursor-pointer ${
                  includeContext
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
                title="Include live state from the currently active studio tab"
              >
                {includeContext ? (
                  <ToggleRight size={13} className="text-emerald-400" />
                ) : (
                  <ToggleLeft size={13} className="text-slate-500" />
                )}
                <span>Context</span>
              </button>

              {/* Clear Context Action */}
              <button
                type="button"
                onClick={handleClearContext}
                className="p-1.5 rounded-lg text-slate-400 hover:text-amber-300 hover:bg-slate-800 transition-colors cursor-pointer"
                title="Clear conversation & reset context"
                aria-label="Clear conversation & reset context"
              >
                <RotateCcw size={14} />
              </button>

              {/* Expand to Studio Tab */}
              <button
                type="button"
                onClick={handleExpandToStudioTab}
                className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-300 hover:bg-slate-800 transition-colors cursor-pointer"
                title="Expand to Dedicated AI Copilot Studio Tab"
              >
                <Maximize2 size={14} />
              </button>

              {/* Close */}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"
                title="Minimize Widget (Alt+C)"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Multi-Tab Bar */}
          <div className="px-3 py-1.5 bg-slate-950/90 border-b border-slate-800 flex items-center gap-1.5 overflow-x-auto no-scrollbar flex-shrink-0 text-[11px]">
            <div className="flex items-center gap-1.5 flex-1 overflow-x-auto no-scrollbar">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTabId;
                const isTabLoading = loadingTabIds.has(tab.id);
                return (
                  <div
                    key={tab.id}
                    onClick={() => handleSelectTab(tab.id)}
                    className={`group flex items-center gap-1.5 px-2.5 py-1 rounded-md cursor-pointer transition-all border text-[11px] select-none ${
                      isActive
                        ? 'bg-slate-800 text-indigo-300 font-medium border-slate-700 shadow-sm'
                        : 'bg-slate-900/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border-slate-800/50'
                    }`}
                    title={tab.title}
                  >
                    {isTabLoading && (
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping flex-shrink-0" />
                    )}
                    <span className="truncate max-w-[85px]">{tab.title}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCloseTab(tab.id);
                      }}
                      className="p-0.5 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-700/60 transition-colors cursor-pointer"
                      title="Close tab"
                      aria-label={`Close ${tab.title}`}
                    >
                      <X size={10} />
                    </button>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={handleNewTab}
              className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer flex-shrink-0 flex items-center justify-center border border-dashed border-slate-700 hover:border-slate-500"
              title="New Tab"
              aria-label="New Tab"
            >
              <Plus size={12} />
            </button>
          </div>

          {/* Quick Prompts Bar */}
          <div className="px-3 py-1.5 bg-slate-950/40 border-b border-slate-800/60 flex items-center gap-1.5 overflow-x-auto no-scrollbar flex-shrink-0 text-[11px]">
            <button
              onClick={() => handleSend(`Summarize the current view: ${liveContext.contextSummary}`)}
              disabled={isLoadingActive}
              className="px-2 py-0.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 whitespace-nowrap cursor-pointer transition-colors"
            >
              🔍 Summarize Tab
            </button>
            <button
              onClick={() => handleSend('What should I do next in this space?')}
              disabled={isLoadingActive}
              className="px-2 py-0.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 whitespace-nowrap cursor-pointer transition-colors"
            >
              💡 Next Actions
            </button>
            <button
              onClick={() => handleSend('Diagnose any errors or bottlenecks right now.')}
              disabled={isLoadingActive}
              className="px-2 py-0.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 whitespace-nowrap cursor-pointer transition-colors"
            >
              🩺 Quick Diagnose
            </button>
          </div>

          {/* Messages Stream */}
          <div className="flex-1 p-3 overflow-y-auto space-y-3 text-xs leading-relaxed">
            {messages.length === 0 ? (
              <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-center p-4 text-slate-400 space-y-2">
                <div className="w-9 h-9 rounded-xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <Sparkles size={16} />
                </div>
                <div className="font-semibold text-slate-200 text-xs">
                  {activeTabObj?.title || 'New Conversation'}
                </div>
                <p className="text-[11px] text-slate-400 max-w-[280px]">
                  Context is fresh and ready for <span className="text-indigo-300 font-medium">{liveContext.badge}</span>.
                  Type a query below or pick a quick prompt to begin.
                </p>
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {m.role === 'assistant' && (
                    <div className="w-6 h-6 rounded bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 flex-shrink-0 mt-0.5">
                      <Bot size={13} />
                    </div>
                  )}
                  <div
                    className={`max-w-[85%] rounded-xl p-2.5 ${
                      m.role === 'user'
                        ? 'bg-indigo-600 text-white rounded-tr-none'
                        : 'bg-slate-800/90 border border-slate-700/60 text-slate-200 rounded-tl-none'
                    }`}
                  >
                    {m.role === 'user' ? (
                      <div className="whitespace-pre-wrap">{m.content}</div>
                    ) : (
                      <CopilotMarkdown
                        content={m.content}
                        onSeek={(sec) => player.seek(sec)}
                        onPlay={(sec, meta) => {
                          const matched = m.matches?.[0];
                          const audioUrl = meta?.audioUrl || matched?.audio_url;
                          if (audioUrl) {
                            player.play(
                              {
                                id: meta?.episodeId || matched?.episode_id || Date.now(),
                                title: meta?.episodeTitle || matched?.episode_title || 'Audio Moment',
                                audioUrl,
                              },
                              sec
                            );
                          }
                        }}
                      />
                    )}

                    {/* Quick Action Chips in Assistant Messages */}
                    {m.matches && m.matches.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-slate-700/50 flex flex-wrap gap-1">
                        {m.matches.slice(0, 2).map((match, idx) => (
                          <button
                            key={idx}
                            onClick={() => {
                              montage.addClip({
                                id: `clip_${Date.now()}_${idx}`,
                                title: `${match.speaker}: ${match.snippet.slice(0, 25)}...`,
                                quote: match.snippet,
                                speaker: match.speaker,
                                sourceTitle: match.episode_title,
                                sourceTag: match.episode_id,
                                audioUrl: match.audio_url,
                                startSec: match.start_timestamp,
                                endSec: match.end_timestamp || match.start_timestamp + 25,
                                category: 'Highlights',
                                severity: 8,
                                tensionScore: 7,
                              });
                            }}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 rounded border border-emerald-500/30 transition-colors cursor-pointer"
                          >
                            <Sparkles size={9} />
                            <span>+ Reel: {match.speaker}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}

            {isLoadingActive && (
              <div className="flex gap-2 items-center text-xs text-indigo-400 animate-pulse py-2">
                <Bot size={13} />
                <span>Copilot is reasoning with live context…</span>
              </div>
            )}

            {currentError && (
              <div className="p-2 rounded bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[11px]">
                {currentError}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Footer */}
          <div className="p-2.5 bg-slate-950 border-t border-slate-800 flex-shrink-0">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="flex items-center gap-1.5"
            >
              <input
                type="text"
                value={input}
                onChange={(e) => handleInputChange(e.target.value)}
                placeholder={
                  includeContext
                    ? `Ask about ${liveContext.badge}...`
                    : 'Ask a general question...'
                }
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
              <button
                type="submit"
                disabled={!input.trim() || isLoadingActive}
                className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white cursor-pointer transition-colors"
                title="Send Message"
              >
                <Send size={13} />
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Floating Toggle Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="group relative flex items-center gap-2 px-3.5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full shadow-lg hover:shadow-indigo-500/25 border border-indigo-400/30 transition-all transform hover:-translate-y-0.5 cursor-pointer"
        title="Toggle AI Copilot Widget (Alt+C)"
      >
        <Bot size={16} className="text-white group-hover:rotate-12 transition-transform" />
        <span className="text-xs font-semibold tracking-wide">Copilot</span>
        {tabs.length > 1 && (
          <span className="px-1.5 py-0.2 rounded-full bg-indigo-800 text-[10px] font-bold text-indigo-200 border border-indigo-400/30">
            {tabs.length}
          </span>
        )}
        {includeContext && (
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" title="Live context attached" />
        )}
      </button>
    </div>
  );
};