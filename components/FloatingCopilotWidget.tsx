import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Bot,
  X,
  Send,
  Maximize2,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  ChevronDown,
  MessageSquare,
  Flame,
  Zap,
  Activity,
  Play,
  Scissors,
} from 'lucide-react';
import { useCopilot } from '../contexts/CopilotContext';
import { usePlayer } from '../contexts/PlayerContext';
import { useMontage } from '../contexts/MontageContext';
import { CopilotMarkdown } from './CopilotMarkdown';
import { extractLiveStudioContext } from '../utils/liveContextExtractor';

interface FloatingCopilotWidgetProps {
  activeTab: string;
}

export const FloatingCopilotWidget: React.FC<FloatingCopilotWidgetProps> = ({ activeTab }) => {
  const {
    sessions,
    sendMessage,
    loading,
    error,
    model,
    widgetSessionId,
    setActiveSessionId,
  } = useCopilot();

  const player = usePlayer();
  const montage = useMontage();

  const [isOpen, setIsOpen] = useState(false);
  const [includeContext, setIncludeContext] = useState(true);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Read LIVE non-stale context of current tab
  const liveContext = useMemo(() => {
    return extractLiveStudioContext(activeTab);
  }, [activeTab]);

  // Designated widget session
  const widgetSession = useMemo(() => {
    return sessions.find((s) => s.id === widgetSessionId) || sessions[0];
  }, [sessions, widgetSessionId]);

  const messages = widgetSession?.messages || [];

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
  }, [messages, loading, isOpen]);

  const handleSend = (textToSend?: string) => {
    const msg = (textToSend || input).trim();
    if (!msg || loading) return;

    sendMessage(
      msg,
      undefined,
      {
        targetSessionId: widgetSessionId,
        liveContext: includeContext ? liveContext.contextSummary : undefined,
      }
    );

    if (!textToSend) setInput('');
  };

  const handleExpandToStudioTab = () => {
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
                onClick={() => setIncludeContext(!includeContext)}
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

          {/* Quick Prompts Bar */}
          <div className="px-3 py-1.5 bg-slate-950/40 border-b border-slate-800/60 flex items-center gap-1.5 overflow-x-auto no-scrollbar flex-shrink-0 text-[11px]">
            <button
              onClick={() => handleSend(`Summarize the current view: ${liveContext.contextSummary}`)}
              disabled={loading}
              className="px-2 py-0.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 whitespace-nowrap cursor-pointer transition-colors"
            >
              🔍 Summarize Tab
            </button>
            <button
              onClick={() => handleSend('What should I do next in this space?')}
              disabled={loading}
              className="px-2 py-0.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 whitespace-nowrap cursor-pointer transition-colors"
            >
              💡 Next Actions
            </button>
            <button
              onClick={() => handleSend('Diagnose any errors or bottlenecks right now.')}
              disabled={loading}
              className="px-2 py-0.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 whitespace-nowrap cursor-pointer transition-colors"
            >
              🩺 Quick Diagnose
            </button>
          </div>

          {/* Messages Stream */}
          <div className="flex-1 p-3 overflow-y-auto space-y-3 text-xs leading-relaxed">
            {messages.map((m) => (
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
            ))}

            {loading && (
              <div className="flex gap-2 items-center text-xs text-indigo-400 animate-pulse py-2">
                <Bot size={13} />
                <span>Copilot is reasoning with live context…</span>
              </div>
            )}

            {error && (
              <div className="p-2 rounded bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[11px]">
                {error}
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
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  includeContext
                    ? `Ask about ${liveContext.badge}...`
                    : 'Ask a general question...'
                }
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
              <button
                type="submit"
                disabled={!input.trim() || loading}
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
        {includeContext && (
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" title="Live context attached" />
        )}
      </button>
    </div>
  );
};
