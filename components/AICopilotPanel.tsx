import React, { useState, useRef, useEffect, useMemo } from 'react';
import { COPILOT_MODEL_OPTIONS } from '../utils/copilotModels';
import {
  Bot,
  Send,
  Sparkles,
  Trash2,
  CheckCircle2,
  Undo2,
  Play,
  Pause,
  RotateCcw,
  Zap,
  Sliders,
  Scissors,
  Flame,
  Radio,
  FileSearch,
  Settings2,
  Layers,
  ChevronRight,
  SplitSquareVertical,
  Activity,
  Check,
  Copy,
  AlertTriangle,
  ShieldAlert,
  Clock,
  XCircle,
  AlertCircle,
  ExternalLink,
  Code,
  ChevronDown,
  ChevronUp,
  Pin,
  Plus,
  MessageSquare,
  Download,
  Film,
  FileText,
  X,
} from 'lucide-react';
import { useCopilot } from '../contexts/CopilotContext';
import { useMontage } from '../contexts/MontageContext';
import { usePlayer } from '../contexts/PlayerContext';
import { TensionArc } from './TensionArc';
import { TargetWindowGauge } from './TargetWindowGauge';
import type { CopilotAction } from '../utils/copilotTypes';
import { resolveActionTier } from '../utils/contracts/copilotActions';
import { renderTranscriptWithContextFocus } from '../utils/searchWorker';
import { CopilotMarkdown } from './CopilotMarkdown';
import { fetchSummaryIndex, findEpisodeInSummary, EpisodeSummary } from '../utils/transcriptData';

const PRESET_PILLS = [
  {
    icon: <Sparkles size={13} className="text-amber-400" />,
    label: 'Deep Rerank Search',
    prompt: 'Search the transcripts using Deep Rerank (Cohere Rerank 5) for the most relevant dialogue about ',
  },
  {
    icon: <Flame size={13} className="text-amber-400" />,
    label: 'Soundbite Hunter',
    prompt: 'Scan the active transcript for the 3 highest-energy rants, debates, or golden insights and create clips for them with viral scores.',
  },
  {
    icon: <Radio size={13} className="text-rose-400" />,
    label: 'The Debate Duel',
    prompt: 'Sequence the clips in my Montage Studio into an escalating debate conflict preset with a mic-drop conclusion.',
  },
  {
    icon: <Scissors size={13} className="text-indigo-400" />,
    label: 'Word-Perfect Trim',
    prompt: 'Inspect the clips in my montage reel and tighten the In/Out boundaries to eliminate filler words, breaths, and dead air.',
  },
  {
    icon: <Zap size={13} className="text-cyan-400" />,
    label: 'Viral Short (45s)',
    prompt: 'Create a 45-second high-tempo teaser montage suitable for TikTok/Reels, starting with the punchiest hook.',
  },
  {
    icon: <Activity size={13} className="text-emerald-400" />,
    label: 'Diagnose Pipeline',
    prompt: 'Diagnose my current pipeline settings, YAML workflow syntax, and cron schedule for any potential GitHub Actions failures.',
  },
];

export const AICopilotPanel: React.FC = () => {
  const {
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
    sendMessage,
    applyAction,
    revertAction,
    analyzeActionResults,
    clearMessages,
    contextPayload,
    widgetSessionId,
  } = useCopilot();

  const montage = useMontage();
  const player = usePlayer();

  const [input, setInput] = useState('');
  const [showCanvas, setShowCanvas] = useState(true);
  const [copiedMatchKey, setCopiedMatchKey] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [showPinDropdown, setShowPinDropdown] = useState(false);
  const [episodeSummaries, setEpisodeSummaries] = useState<EpisodeSummary[]>([]);
  const [recentlyAppendedMatchKey, setRecentlyAppendedMatchKey] = useState<string | null>(null);
  const activeTimelineCardRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetchSummaryIndex().then(setEpisodeSummaries).catch(() => {});
  }, []);

  useEffect(() => {
    if (montage.isAuditioning && activeTimelineCardRef.current) {
      activeTimelineCardRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [montage.isAuditioning, montage.currentAuditionIndex]);

  const activeRunningAction = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const running = messages[i].actions?.find(a => a.status === 'running');
      if (running) return running;
    }
    return null;
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    sendMessage(input);
    setInput('');
  };

  const handlePillClick = (prompt: string) => {
    sendMessage(prompt);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Helper to parse [timestamp] badges and quick action chips into interactive buttons
  const renderMessageContent = (content: string, firstMatch?: any) => {
    const parts = content.split(/(\[▶\s*(?:Jump to|Play)\s*[^\]]+\]|\[▶\s*Play\s*\d{1,2}:\d{2}\]|\b\d{1,2}:\d{2}\b|\[\+\s*Append to Reel\])/gi);
    return parts.map((part, i) => {
      if (/\[\+\s*Append to Reel\]/i.test(part)) {
        return (
          <button
            key={i}
            onClick={() => {
              if (firstMatch) {
                montage.addClip({
                  id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                  title: `${firstMatch.speaker}: ${firstMatch.snippet.slice(0, 30)}...`,
                  quote: firstMatch.snippet,
                  speaker: firstMatch.speaker,
                  sourceTitle: firstMatch.episode_title,
                  sourceTag: firstMatch.episode_id,
                  audioUrl: firstMatch.audio_url || contextPayload.currentEpisode?.audioUrl,
                  startSec: firstMatch.start_timestamp,
                  endSec: firstMatch.end_timestamp || firstMatch.start_timestamp + 25,
                  category: 'Highlights',
                  severity: 8,
                  tensionScore: 7,
                });
              }
            }}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-1 text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 rounded border border-emerald-500/30 transition-colors cursor-pointer"
          >
            <Sparkles size={10} />
            + Append to Reel
          </button>
        );
      }

      const match = part.match(/(\d{1,2}):(\d{2})/);
      if (match) {
        const sec = parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
        return (
          <button
            key={i}
            onClick={() => {
              const audioUrl = firstMatch?.audio_url || contextPayload.currentEpisode?.audioUrl;
              if (audioUrl) {
                player.play(
                  {
                    id: firstMatch?.episode_id || contextPayload.currentEpisode?.releaseId || Date.now(),
                    title: firstMatch?.episode_title || contextPayload.currentEpisode?.title || 'Space Audio',
                    audioUrl,
                  },
                  sec
                );
              } else {
                player.seek(sec);
              }
            }}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-1 text-[11px] font-semibold bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 rounded border border-indigo-500/30 transition-colors cursor-pointer"
          >
            <Play size={10} className="fill-current" />
            {part.startsWith('[▶') ? part : `▶ ${match[0]}`}
          </button>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="flex-1 flex flex-col lg:flex-row h-full overflow-hidden bg-slate-950 text-slate-200">
      {/* ── Left Pane: Dialogue & Action Console ── */}
      <div className="flex-1 flex flex-col h-full border-r border-slate-800/80 overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-slate-800/80 bg-slate-900/60 flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
              <Bot size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white leading-none">SpacePipe AI Copilot</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
                  Studio AI
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Executive Audio Producer &amp; Pipeline Automation</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Auto-apply toggle */}
            <button
              onClick={() => setAutoApply(!autoApply)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                autoApply
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                  : 'bg-slate-800/80 text-slate-400 border-slate-700'
              }`}
              title="Automatically apply recommended clip creations and pipeline updates"
            >
              <Zap size={12} className={autoApply ? 'text-emerald-400 fill-current' : 'text-slate-500'} />
              <span>Auto-Apply: {autoApply ? 'ON' : 'OFF'}</span>
            </button>

            {/* Model Selector */}
            <select
              value={model}
              title="Model id sent to the gateway. The model that actually answered is shown under each reply."
              onChange={e => setModel(e.target.value)}
              className="bg-slate-800 text-slate-300 text-xs px-2.5 py-1 rounded-lg border border-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              {COPILOT_MODEL_OPTIONS.map(o => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>

            {/* Split Canvas Toggle */}
            <button
              onClick={() => setShowCanvas(!showCanvas)}
              className={`p-1.5 rounded-lg border text-xs transition-colors cursor-pointer hidden lg:block ${
                showCanvas ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/30' : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
              title="Toggle Live Studio Canvas"
            >
              <SplitSquareVertical size={16} />
            </button>
          </div>
        </div>

        {/* Multi-Tab Session Bar */}
        <div className="px-3 pt-2 pb-0 bg-slate-950/70 border-b border-slate-800/80 flex items-center justify-between gap-2 overflow-x-auto no-scrollbar flex-shrink-0">
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            {sessions.map((sess) => {
              const isActive = sess.id === activeSessionId;
              const isWidget = sess.isWidgetSession || sess.id === widgetSessionId;
              const isEditing = editingSessionId === sess.id;

              return (
                <div
                  key={sess.id}
                  onClick={() => !isEditing && setActiveSessionId(sess.id)}
                  onDoubleClick={() => {
                    if (!isWidget) {
                      setEditingSessionId(sess.id);
                      setEditingTitle(sess.title);
                    }
                  }}
                  className={`group relative flex items-center gap-2 px-3 py-1.5 rounded-t-lg text-xs font-medium border-t border-x cursor-pointer transition-all ${
                    isActive
                      ? 'bg-slate-900 text-indigo-300 border-slate-700 shadow-sm border-b-transparent'
                      : 'bg-slate-950/50 text-slate-400 hover:text-slate-200 border-slate-800/80 hover:bg-slate-900/60'
                  }`}
                  title={isWidget ? 'Quick Widget Chat (Synced with Floating Widget)' : 'Double-click to rename'}
                >
                  {isWidget ? (
                    <Zap size={12} className="text-amber-400 flex-shrink-0" />
                  ) : (
                    <MessageSquare size={12} className={isActive ? 'text-indigo-400' : 'text-slate-500'} />
                  )}

                  {isEditing ? (
                    <input
                      type="text"
                      value={editingTitle}
                      autoFocus
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onBlur={() => {
                        renameSession(sess.id, editingTitle);
                        setEditingSessionId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          renameSession(sess.id, editingTitle);
                          setEditingSessionId(null);
                        } else if (e.key === 'Escape') {
                          setEditingSessionId(null);
                        }
                      }}
                      className="bg-slate-800 text-white px-1.5 py-0.5 rounded text-xs border border-indigo-500 focus:outline-none w-28"
                    />
                  ) : (
                    <span className="truncate max-w-[130px]">{sess.title}</span>
                  )}

                  {!isWidget && sessions.length > 2 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if ((sess.messages?.length || 0) > 1) {
                          if (!window.confirm(`Close and delete "${sess.title}"?`)) return;
                        }
                        deleteSession(sess.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 hover:text-rose-400 p-0.5 rounded transition-opacity"
                      title="Close session"
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
              );
            })}

            <button
              type="button"
              onClick={() => createSession()}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-t-lg text-xs text-slate-400 hover:text-white hover:bg-slate-900/80 transition-colors cursor-pointer"
              title="Open New Chat Session"
            >
              <Plus size={13} />
              <span>New</span>
            </button>
          </div>

          {/* Session Action Controls */}
          <div className="flex items-center gap-1.5 pb-1">
            <button
              type="button"
              onClick={() => setShowPinDropdown(!showPinDropdown)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors cursor-pointer ${
                pinnedContexts.length > 0
                  ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                  : 'bg-slate-800 text-slate-400 border-slate-700/80 hover:text-slate-200'
              }`}
              title="Pin grounding context to this session"
            >
              <Pin size={11} className={pinnedContexts.length > 0 ? 'text-amber-400 fill-current' : ''} />
              <span>Pin Context {pinnedContexts.length > 0 ? `(${pinnedContexts.length})` : ''}</span>
            </button>

            <button
              type="button"
              onClick={() => exportSessionMarkdown()}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80 hover:bg-slate-750 transition-colors cursor-pointer"
              title="Export session conversation and citations to Markdown"
            >
              <Download size={11} />
              <span>Export .md</span>
            </button>

            <button
              type="button"
              onClick={() => clearMessages()}
              className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"
              title="Clear active session chat"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* Context Pinning Bar */}
        {(showPinDropdown || pinnedContexts.length > 0) && (
          <div className="px-4 py-2 bg-slate-950/90 border-b border-slate-800 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1">
              <Pin size={12} className="fill-current" /> Grounding:
            </span>

            {pinnedContexts.map((pin) => (
              <span
                key={pin.id}
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-800/80 text-slate-200 border border-slate-700 text-[11px]"
              >
                <span className="text-indigo-400 font-semibold uppercase text-[10px]">[{pin.type}]</span>
                <span className="truncate max-w-[160px]">{pin.title}</span>
                <button
                  type="button"
                  onClick={() => removePinnedContext(pin.id)}
                  className="hover:text-rose-400 cursor-pointer"
                  title="Unpin"
                >
                  <X size={10} />
                </button>
              </span>
            ))}

            <div className="flex items-center gap-1 ml-auto">
              {contextPayload.currentEpisode && !pinnedContexts.some(p => p.id === contextPayload.currentEpisode?.releaseTag) && (
                <button
                  type="button"
                  onClick={() => {
                    addPinnedContext({
                      id: contextPayload.currentEpisode!.releaseTag || 'ep',
                      type: 'episode',
                      title: contextPayload.currentEpisode!.title || contextPayload.currentEpisode!.releaseTag || 'Episode',
                      detail: `${contextPayload.currentEpisode!.speakers?.join(', ') || ''}`,
                    });
                  }}
                  className="px-2 py-0.5 rounded text-[11px] bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 border border-indigo-500/30 transition-colors cursor-pointer"
                >
                  + Pin Episode
                </button>
              )}

              {montage.clips.length > 0 && !pinnedContexts.some(p => p.id === 'active_montage_reel') && (
                <button
                  type="button"
                  onClick={() => {
                    addPinnedContext({
                      id: 'active_montage_reel',
                      type: 'reel',
                      title: `Active Montage Reel (${montage.clips.length} clips)`,
                      detail: `${Math.round(montage.clips.reduce((acc, c) => acc + (c.endSec - c.startSec), 0))}s total duration`,
                    });
                  }}
                  className="px-2 py-0.5 rounded text-[11px] bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 border border-emerald-500/30 transition-colors cursor-pointer"
                >
                  + Pin Reel
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  try {
                    const draft = localStorage.getItem('spacepipe_script_studio_active_draft');
                    if (draft) {
                      const p = JSON.parse(draft);
                      addPinnedContext({
                        id: 'script_draft',
                        type: 'script',
                        title: p.title || 'Script Draft',
                        detail: `${p.scenes?.length || 0} scenes`,
                      });
                    } else {
                      window.alert('No active script draft found in Script Studio to pin.');
                    }
                  } catch {}
                }}
                className="px-2 py-0.5 rounded text-[11px] bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 border border-violet-500/30 transition-colors cursor-pointer"
              >
                + Pin Script Draft
              </button>
            </div>
          </div>
        )}

        {/* Quick Action Pills */}
        <div className="px-4 py-2 border-b border-slate-800/40 bg-slate-900/30 flex items-center gap-2 overflow-x-auto no-scrollbar flex-shrink-0">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap">Playbooks:</span>
          {PRESET_PILLS.map((pill, i) => (
            <button
              key={i}
              onClick={() => handlePillClick(pill.prompt)}
              disabled={loading}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-slate-800/60 hover:bg-slate-800 text-slate-300 border border-slate-700/60 whitespace-nowrap transition-colors cursor-pointer disabled:opacity-50"
            >
              {pill.icon}
              <span>{pill.label}</span>
            </button>
          ))}
        </div>

        {/* Context Chip (if active episode or file is present) */}
        {(contextPayload.currentEpisode || contextPayload.activeTab) && (
          <div className="px-4 py-1.5 bg-indigo-500/5 border-b border-indigo-500/10 flex items-center gap-2 text-xs text-slate-400 flex-shrink-0">
            <span className="text-indigo-400 font-semibold">Active Context:</span>
            {contextPayload.currentEpisode && (
              <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 text-[11px]">
                🎙️ {contextPayload.currentEpisode.title || contextPayload.currentEpisode.releaseTag}
              </span>
            )}
            {contextPayload.activeTab && (
              <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[11px]">
                Tab: {contextPayload.activeTab}
              </span>
            )}
          </div>
        )}

        {/* Messages Stream */}
        <div className="flex-1 p-4 overflow-y-auto space-y-4">
          {messages.map(m => {
            const isTelemetryPrompt = m.role === 'user' && typeof m.content === 'string' && m.content.startsWith('[ACTION RESULT TELEMETRY]');
            if (isTelemetryPrompt) {
              return (
                <div key={m.id} className="flex justify-center my-1.5">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-indigo-950/40 border border-indigo-500/30 text-xs text-indigo-300 shadow-sm">
                    <Activity size={13} className="text-indigo-400 animate-pulse flex-shrink-0" />
                    <span className="font-medium">System Telemetry Dispatched: Live pipeline inspection results forwarded to Copilot for analysis</span>
                  </div>
                </div>
              );
            }

            return (
            <div
              key={m.id}
              className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {m.role === 'assistant' && (
                <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 flex-shrink-0 mt-0.5">
                  <Bot size={16} />
                </div>
              )}

              <div
                className={`max-w-[85%] rounded-2xl p-4 text-sm leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-indigo-600 text-white rounded-tr-sm shadow-md'
                    : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-sm shadow-lg'
                }`}
              >
                {m.role === 'user' ? (
                  <div className="whitespace-pre-wrap">{m.content}</div>
                ) : (
                  <CopilotMarkdown
                    content={m.content}
                    onSeek={(sec) => player.seek(sec)}
                    onPlay={(sec, meta) => {
                      const matched = m.matches?.find(match =>
                        meta?.audioUrl && match.audio_url === meta.audioUrl
                      ) || m.matches?.[0];

                      const audioUrl = meta?.audioUrl || matched?.audio_url || contextPayload.currentEpisode?.audioUrl;
                      const title = meta?.episodeTitle || matched?.episode_title || contextPayload.currentEpisode?.title || 'Space Audio';
                      const id = meta?.episodeId || matched?.episode_id || contextPayload.currentEpisode?.releaseId || Date.now();

                      if (audioUrl) {
                        player.play(
                          {
                            id,
                            title,
                            audioUrl,
                          },
                          sec
                        );
                      } else {
                        player.seek(sec);
                      }
                    }}
                    onAppendToReel={() => {
                      const firstMatch = m.matches?.[0];
                      if (firstMatch) {
                        montage.addClip({
                          id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                          title: `${firstMatch.speaker}: ${firstMatch.snippet.slice(0, 30)}...`,
                          quote: firstMatch.snippet,
                          speaker: firstMatch.speaker,
                          sourceTitle: firstMatch.episode_title,
                          sourceTag: firstMatch.episode_id,
                          audioUrl: firstMatch.audio_url || contextPayload.currentEpisode?.audioUrl,
                          startSec: firstMatch.start_timestamp,
                          endSec: firstMatch.end_timestamp || firstMatch.start_timestamp + 25,
                          category: 'Highlights',
                          severity: 8,
                          tensionScore: 7,
                          sourceDurationSec: contextPayload.currentEpisode?.durationSec,
                        });
                      }
                    }}
                  />
                )}

                {/* Render Structured Transcript Matches */}
                {m.matches && m.matches.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-800/80 space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      <span className="flex items-center gap-1.5 text-blue-400">
                        <FileSearch size={13} />
                        Transcript Matches ({m.matches.length})
                      </span>
                    </div>
                    <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                      {m.matches.map((match, idx) => {
                        const matchKey = match.chunk_id || `${match.episode_id}_${match.start_timestamp}_${idx}`;
                        const isCopied = copiedMatchKey === matchKey;
                        const hasAudio = Boolean(match.audio_url || (match.source_type === 'space_transcript' && contextPayload.currentEpisode?.audioUrl));
                        const isDocument = match.source_type && match.source_type !== 'space_transcript';

                        return (
                        <div key={idx} className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs hover:border-slate-700 transition-colors">
                          <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                            <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                              <span className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 font-semibold text-[10px] border border-blue-500/20 flex-shrink-0">
                                {match.speaker}
                              </span>

                              {match.source_classification && (
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border flex-shrink-0 ${
                                  match.source_classification === 'primary_record'
                                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20'
                                    : 'bg-purple-500/15 text-purple-300 border-purple-500/20'
                                }`}>
                                  {match.source_classification === 'primary_record' ? 'PRIMARY RECORD' : 'DERIVATIVE ANALYSIS'}
                                </span>
                              )}

                              {isDocument && (
                                <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[9px] font-mono border border-slate-700 flex-shrink-0">
                                  {match.source_type?.replace(/_/g, ' ').toUpperCase()}
                                </span>
                              )}

                              {match.match_type === 'rerank' && (
                                <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[9px] font-mono flex-shrink-0">
                                  Rerank 5{match.relevant_spans && match.relevant_spans.length > 0 && ' · Focus'}
                                </span>
                              )}
                              <span className="text-slate-400 text-[11px] truncate" title={match.episode_title || match.episode_id}>
                                in {match.episode_title || match.episode_id}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              {match.relevance_score !== undefined && (
                                <span className="text-[10px] text-slate-400 font-mono" title="Raw Cohere relevance score">
                                  Score: {match.relevance_score.toFixed(3)}
                                </span>
                              )}
                              <span className="text-[10px] text-slate-400 font-mono">
                                {match.document_location?.displayText || match.formatted_time || `${formatTime(match.start_timestamp)} - ${formatTime(match.end_timestamp)}`}
                              </span>
                            </div>
                          </div>

                          <p className="text-[11px] text-slate-300 leading-relaxed mb-2 select-text">
                            "{renderTranscriptWithContextFocus(
                              match.snippet,
                              match.relevant_spans,
                              undefined,
                              'bg-amber-500/20 text-amber-100 rounded px-1 py-0.5 border-b border-amber-400/50 font-normal'
                            )}"
                          </p>

                          {/* Surrounding Dialogue / Exchange Context Window */}
                          {match.dialogue_window && match.dialogue_window.length > 1 && (
                            <details className="mb-2 text-[10px] text-slate-400 bg-slate-900/60 p-2 rounded-lg border border-slate-800/80">
                              <summary className="cursor-pointer font-medium text-slate-400 hover:text-slate-200 select-none">
                                View Surrounding Dialogue Context ({match.dialogue_window.length} turns)
                              </summary>
                              <div className="mt-2 space-y-1 pl-1 border-l-2 border-slate-700/60 max-h-36 overflow-y-auto pr-1">
                                {match.dialogue_window.map((dw, dIdx) => (
                                  <div key={dIdx} className={dw.text === match.snippet ? "text-amber-200 font-medium" : "text-slate-400"}>
                                    <span className="font-semibold text-slate-300">{dw.speaker}:</span> {dw.text}
                                  </div>
                                ))}
                              </div>
                            </details>
                          )}

                          <div className="flex items-center gap-2 flex-wrap">
                            {hasAudio && (
                              <>
                                {(() => {
                                  const ep = findEpisodeInSummary(episodeSummaries, match.episode_id || match.episode_title);
                                  const verifiedAudioUrl = match.audio_url || ep?.audio_url || contextPayload.currentEpisode?.audioUrl || '';
                                  const verifiedDuration = ep?.duration_sec || contextPayload.currentEpisode?.durationSec || 3600;
                                  const isAppended = recentlyAppendedMatchKey === matchKey;

                                  return (
                                    <>
                                      <button
                                        onClick={() => {
                                          if (verifiedAudioUrl) {
                                            montage.auditionSoloClip({
                                              id: `preview_${matchKey}`,
                                              title: `${match.speaker} Soundbite`,
                                              quote: match.snippet,
                                              speaker: match.speaker,
                                              audioUrl: verifiedAudioUrl,
                                              startSec: match.start_timestamp,
                                              endSec: match.end_timestamp || match.start_timestamp + 25,
                                              sourceTitle: match.episode_title || ep?.title || 'Episode Space',
                                              sourceDurationSec: verifiedDuration,
                                              category: 'Highlights',
                                            });
                                          } else {
                                            player.seek(match.start_timestamp);
                                          }
                                        }}
                                        className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 rounded text-[11px] font-semibold border border-indigo-500/30 transition-colors cursor-pointer"
                                        title="Instant edge preview of this soundbite"
                                      >
                                        <Play size={10} className="fill-current" />
                                        ▶ Preview Soundbite
                                      </button>
                                      <button
                                        onClick={() => {
                                          const newClipId = `clip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                                          montage.addClip({
                                            id: newClipId,
                                            title: `${match.speaker}: ${match.snippet.slice(0, 30)}...`,
                                            quote: match.snippet,
                                            speaker: match.speaker,
                                            sourceTitle: match.episode_title || ep?.title || contextPayload.currentEpisode?.title || 'Episode Space',
                                            sourceTag: match.episode_id || ep?.release_tag || contextPayload.currentEpisode?.releaseTag || 'clip',
                                            audioUrl: verifiedAudioUrl,
                                            startSec: match.start_timestamp,
                                            endSec: match.end_timestamp || match.start_timestamp + 25,
                                            category: 'Highlights',
                                            severity: 8,
                                            tensionScore: 7,
                                            sourceDurationSec: verifiedDuration,
                                            directorNote: `Extracted from search quote in ${match.episode_title || ep?.title || 'episode'}`,
                                          });
                                          setRecentlyAppendedMatchKey(matchKey);
                                          setTimeout(() => setRecentlyAppendedMatchKey(null), 2500);
                                        }}
                                        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold border transition-all cursor-pointer ${
                                          isAppended
                                            ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                                            : 'bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border-emerald-500/30'
                                        }`}
                                        title="Append this slice to the Active Montage Reel"
                                      >
                                        {isAppended ? <Check size={10} /> : <Sparkles size={10} />}
                                        {isAppended ? '✓ Added to Reel' : '+ Append to Reel'}
                                      </button>
                                    </>
                                  );
                                })()}
                              </>
                            )}

                            {/* Copy Citation into Script button */}
                            <button
                              onClick={() => {
                                const loc = match.document_location?.displayText || (match.start_timestamp ? `Timestamp ${formatTime(match.start_timestamp)}` : 'Document Excerpt');
                                const docTitle = match.episode_title || match.episode_id;
                                const classification = match.source_classification === 'primary_record' ? 'Primary Record' : 'Derivative Analysis';
                                const citation = `> **[Source: ${docTitle} | ${loc} (${classification})]**\n> **${match.speaker}**: "${match.snippet}"`;
                                navigator.clipboard.writeText(citation);
                                setCopiedMatchKey(matchKey);
                                setTimeout(() => setCopiedMatchKey(null), 2500);
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] font-semibold border border-slate-700 transition-colors cursor-pointer"
                              title="Copy formatted quote citation for manuscript drafting"
                            >
                              {isCopied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                              {isCopied ? '✓ Copied Citation' : '📋 Copy Citation into Script'}
                            </button>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Render Executable Actions attached to this message */}
                {m.actions && m.actions.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-slate-800/80 space-y-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                      <Sparkles size={12} className="text-amber-400" />
                      Executive Actions ({m.actions.length})
                    </p>
                    {m.actions.map(action => (
                      <ActionCard
                        key={action.id}
                        action={action}
                        onApply={(opts) => applyAction(action, opts)}
                        onRevert={() => revertAction(action)}
                        onAnalyze={analyzeActionResults}
                      />
                    ))}
                  </div>
                )}

                {/* Cross-Studio Dispatch: Send Outline to Script Studio */}
                {m.role === 'assistant' && (
                  <div className="mt-3 pt-2 border-t border-slate-800/60 flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        try {
                          const draft = {
                            title: 'Copilot Generated Outline',
                            outlineSummary: m.content,
                            scenes: [],
                            updatedAt: Date.now(),
                          };
                          localStorage.setItem('spacepipe_script_studio_active_draft', JSON.stringify(draft));
                          window.location.hash = '#script-studio';
                        } catch (e) {
                          console.warn('Failed to send outline to Script Studio:', e);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold bg-violet-600/20 text-violet-300 hover:bg-violet-600/30 border border-violet-500/30 transition-colors cursor-pointer"
                      title="Send this text and structure into Script Studio as an active project"
                    >
                      <FileText size={12} />
                      <span>📄 Send Outline to Script Studio</span>
                    </button>
                  </div>
                )}

                {/* Usage Footer */}
                {m.usage && (
                  <div className="mt-2 text-[10px] text-slate-500 flex items-center justify-end gap-2">
                    <span>{m.model}</span>
                    <span>•</span>
                    <span>{m.usage.completionTokens} tokens</span>
                  </div>
                )}
              </div>
            </div>
            );
          })}

          {/* Realtime Live Action Telemetry Banner */}
          {activeRunningAction && (
            <div className="p-3 rounded-xl bg-indigo-950/60 border border-indigo-500/40 text-xs flex items-center justify-between gap-3 animate-pulse shadow-lg shadow-indigo-950/50">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-indigo-600/30 flex items-center justify-center text-indigo-400 flex-shrink-0">
                  <Activity size={14} className="animate-spin" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-white truncate">
                    Executing: {activeRunningAction.explanation || activeRunningAction.action}
                  </p>
                  <p className="text-[11px] text-indigo-300/80">
                    Realtime pipeline execution in progress...
                  </p>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono text-[10px] font-bold flex-shrink-0 border border-indigo-500/30">
                LIVE ACTION
              </span>
            </div>
          )}

          {loading && (
            <div className="flex gap-3 items-center text-slate-400 text-xs">
              <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 animate-pulse">
                <Bot size={16} />
              </div>
              <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-3.5 py-2 rounded-xl">
                <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
                <span>Executive Producer is analyzing audio transcripts and pacing...</span>
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-xl flex items-center justify-between">
              <span>{error}</span>
              <button
                onClick={() => sendMessage(messages[messages.length - 1]?.content || 'retry')}
                className="px-2.5 py-1 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 rounded font-semibold transition-colors cursor-pointer"
              >
                Retry
              </button>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <div className="p-4 border-t border-slate-800/80 bg-slate-900/60 flex-shrink-0">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Ask Copilot: 'Find best debate soundbite', 'Reorder montage for tension', 'Fix cron'..."
              className="flex-1 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none transition-colors"
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center gap-1.5 transition-all shadow-lg shadow-indigo-600/20 cursor-pointer"
            >
              <Send size={15} />
              <span className="hidden sm:inline">Send</span>
            </button>
          </form>
        </div>
      </div>

      {/* ── Right Pane: Live Interactive Studio Canvas ── */}
      {showCanvas && (
        <div className="w-full lg:w-96 flex-shrink-0 bg-slate-950 p-4 overflow-y-auto flex flex-col gap-5">
          {/* Reel Status & Audition Header */}
          <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800/80">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Layers size={16} className="text-indigo-400" />
                <h3 className="font-bold text-sm text-white">Active Montage Reel</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    window.location.hash = '#montage';
                  }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 border border-indigo-500/30 transition-colors cursor-pointer"
                  title="Open current reel in Montage Studio"
                >
                  <Film size={11} />
                  <span>🎬 Open in Montage Studio</span>
                </button>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-medium">
                  {montage.clips.length} clips
                </span>
              </div>
            </div>

            {/* Target Window Gauge */}
            <div className="mb-3">
              <TargetWindowGauge
                currentDurationSec={montage.clips.reduce((acc, c) => acc + Math.max(0, c.endSec - c.startSec), 0)}
                targetDurationSec={montage.targetDurationSec}
                clipCount={montage.clips.length}
                onSelectTarget={montage.setTargetDurationSec}
              />
            </div>

            {/* Audition Reel CTA */}
            <button
              onClick={() => {
                if (montage.isAuditioning) {
                  montage.stopAudition();
                } else {
                  montage.startAudition();
                }
              }}
              disabled={montage.clips.length === 0}
              className={`w-full py-2.5 px-4 rounded-xl font-semibold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
                montage.isAuditioning
                  ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/20 animate-pulse'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20'
              } disabled:opacity-50`}
            >
              <Play size={14} className={montage.isAuditioning ? 'fill-current' : ''} />
              <span>{montage.isAuditioning ? 'Stop Audition' : '▶ Audition Montage Reel'}</span>
            </button>
          </div>

          {/* Tension Arc */}
          <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800/80">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Activity size={13} className="text-indigo-400" />
                Narrative Tension Arc
              </span>
            </div>
            <TensionArc
              clips={montage.clips}
              defaultGapSec={montage.gapSeconds}
              currentIndex={montage.currentAuditionIndex}
              isPlaying={montage.isAuditioning}
            />
          </div>

          {/* Timeline Clip Cards */}
          <div className="flex-1 flex flex-col gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Timeline Sequence</span>
            {montage.clips.length === 0 ? (
              <div className="p-6 rounded-xl border border-dashed border-slate-800 text-center text-xs text-slate-500">
                Reel is empty. Ask Copilot to hunt soundbites or assemble a debate reel!
              </div>
            ) : (
              montage.clips.map((clip, idx) => {
                const isCurrentPlaying = montage.isAuditioning && montage.currentAuditionIndex === idx;

                return (
                  <div
                    key={clip.id}
                    ref={isCurrentPlaying ? activeTimelineCardRef : undefined}
                    className={`p-3 rounded-lg border transition-all flex items-start justify-between gap-2 ${
                      isCurrentPlaying
                        ? 'bg-slate-900 border-indigo-500 ring-2 ring-indigo-500/40 shadow-md'
                        : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0 ${
                          isCurrentPlaying ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'
                        }`}>
                          {idx + 1}
                        </span>
                        <p className="text-xs font-semibold text-white truncate">{clip.title}</p>
                      </div>
                      <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5 italic">
                        "{clip.quote}"
                      </p>
                      <div className="flex items-center gap-2 mt-1.5 text-[10px] text-slate-500">
                        <span className="text-slate-300 font-medium">{clip.speaker}</span>
                        <span>•</span>
                        <span>{(clip.endSec - clip.startSec).toFixed(1)}s</span>
                        {clip.tensionScore !== undefined && (
                          <>
                            <span>•</span>
                            <span className="text-indigo-400 font-semibold">Tension: {clip.tensionScore}/10</span>
                          </>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        if (isCurrentPlaying) {
                          montage.stopAudition();
                        } else {
                          montage.auditionSoloClip(clip);
                        }
                      }}
                      className={`p-1.5 rounded-lg transition-all cursor-pointer flex-shrink-0 border ${
                        isCurrentPlaying
                          ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-sm'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border-slate-700'
                      }`}
                      title={isCurrentPlaying ? 'Pause snippet' : 'Play clip snippet'}
                    >
                      {isCurrentPlaying ? <Pause size={12} className="fill-current" /> : <Play size={12} className="fill-current" />}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface ActionCardProps {
  action: CopilotAction;
  onApply: (options?: { confirmed?: boolean }) => void;
  onRevert: () => void;
  onAnalyze?: (action: CopilotAction) => void;
}

const ActionCard: React.FC<ActionCardProps> = ({ action, onApply, onRevert, onAnalyze }) => {
  const isSearchAction = action.action === 'SEARCH_TRANSCRIPTS';
  const isInspectionAction = action.action.startsWith('GET_') || action.action === 'INSPECT_KNOWLEDGE_GRAPH';
  const tier = action.tier ?? resolveActionTier(action.action, action.params);
  const isTier2 = tier === 2;
  const [showTelemetry, setShowTelemetry] = useState(false);

  const getBadge = () => {
    switch (action.action) {
      case 'CREATE_CLIP':
        return { label: 'New Clip', bg: 'bg-amber-500/15 text-amber-300 border-amber-500/30' };
      case 'TRIM_CLIP':
        return { label: 'Trim Audio', bg: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' };
      case 'SEQUENCE_MONTAGE':
        return { label: 'Story Arc', bg: 'bg-rose-500/15 text-rose-300 border-rose-500/30' };
      case 'PLAY_AUDIO':
        return { label: 'Audio Playback', bg: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' };
      case 'UPDATE_CONFIG':
        return { label: 'Config Update', bg: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' };
      case 'NAVIGATE_TAB':
        return { label: 'Navigate', bg: 'bg-purple-500/15 text-purple-300 border-purple-500/30' };
      case 'SEARCH_TRANSCRIPTS':
        return { label: 'Search Transcripts', bg: 'bg-blue-500/15 text-blue-300 border-blue-500/30' };
      case 'LOAD_EPISODE':
        return { label: 'Load Episode', bg: 'bg-teal-500/15 text-teal-300 border-teal-500/30' };
      case 'ENQUEUE_SPACE':
        return { label: 'Enqueue Space', bg: 'bg-amber-500/15 text-amber-300 border-amber-500/30' };
      case 'DISPATCH_WORKFLOW':
        return { label: 'Dispatch Workflow', bg: 'bg-violet-500/15 text-violet-300 border-violet-500/30' };
      case 'AUDITION_MONTAGE':
        return { label: 'Audition Reel', bg: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' };
      case 'CREATE_PROJECT':
      case 'ANALYZE_PROJECT':
      case 'OUTLINE_PROJECT':
      case 'DRAFT_PROJECT':
      case 'REFINE_PROJECT':
        return { label: 'Script Studio', bg: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' };
      case 'SYNTHESIZE_VOX':
        return { label: 'Voice Synth', bg: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30' };
      case 'RENDER_AVATAR':
        return { label: 'Render Avatar', bg: 'bg-pink-500/15 text-pink-300 border-pink-500/30' };
      case 'GET_QUEUE':
      case 'GET_RUN_HISTORY':
      case 'GET_VOICE_PROFILES':
      case 'GET_SCRIPT_PROJECTS':
        return { label: 'Inspect Pipeline', bg: 'bg-blue-500/15 text-blue-300 border-blue-500/30' };
      default:
        return { label: action.action, bg: 'bg-slate-800 text-slate-300 border-slate-700' };
    }
  };

  const badge = getBadge();

  return (
    <div className={`p-3.5 rounded-xl border flex flex-col gap-2.5 text-xs transition-colors ${
      isTier2 && !action.applied && action.status !== 'accepted' && action.status !== 'completed'
        ? 'bg-amber-950/20 border-amber-500/40 shadow-sm shadow-amber-950/40'
        : 'bg-slate-950/70 border-slate-800'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border uppercase tracking-wider ${badge.bg}`}>
              {badge.label}
            </span>
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold ${
              tier === 2 ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
              tier === 1 ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' :
              'bg-slate-800 text-slate-400'
            }`}>
              TIER {tier}
            </span>
            <p className="font-semibold text-slate-200">{action.explanation}</p>
          </div>

          {/* Context Details */}
          {action.params?.query && (
            <p className="text-[11px] text-slate-400 mt-1 truncate">
              Query: <span className="text-white font-medium">"{action.params.query}"</span>
              {action.params.scope && (
                <span className="text-slate-500 ml-1.5 font-mono text-[10px]">
                  ({action.params.scope})
                </span>
              )}
            </p>
          )}
          {action.params?.title && (
            <p className="text-[11px] text-slate-400 mt-1 truncate">
              Target: <span className="text-white font-medium">{action.params.title}</span>
              {action.params.startSec !== undefined && (
                <span className="text-slate-500 ml-1.5">
                  ({action.params.startSec}s - {action.params.endSec}s)
                </span>
              )}
            </p>
          )}

          {/* Tier 2 Explicit Diff / Impact Details */}
          {isTier2 && action.action === 'UPDATE_CONFIG' && action.params?.updates && (
            <div className="mt-2 p-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-mono">
              <span className="text-slate-400 font-sans block mb-1">Proposed Config Changes:</span>
              {Object.entries(action.params.updates).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-2 text-slate-300 py-0.5">
                  <span className="text-amber-400">{k}:</span>
                  <span className="text-emerald-400 font-bold truncate">{JSON.stringify(v)}</span>
                </div>
              ))}
            </div>
          )}

          {isTier2 && action.action === 'ENQUEUE_SPACE' && (
            <div className="mt-2 p-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px]">
              <div><span className="text-slate-400">Target URL:</span> <span className="font-mono text-cyan-300">{action.params?.spaceUrl}</span></div>
              <div><span className="text-slate-400">Queue:</span> <span className="font-mono text-amber-300">{action.params?.queueType === 'priority' ? 'space_queue.txt (Priority)' : 'batch_queue.txt (Batch)'}</span></div>
              {action.params?.title && <div><span className="text-slate-400">Title:</span> {action.params.title}</div>}
            </div>
          )}

          {isTier2 && action.action === 'DISPATCH_WORKFLOW' && (
            <div className="mt-2 p-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px]">
              <div><span className="text-slate-400">Workflow:</span> <span className="font-mono text-violet-300">{action.params?.workflowFile}</span></div>
              <div><span className="text-slate-400">Ref:</span> <span className="font-mono text-slate-300">{action.params?.ref || 'main'}</span></div>
              {action.params?.inputs && Object.keys(action.params.inputs).length > 0 && (
                <div className="mt-1 text-[10px] font-mono text-slate-400">
                  Inputs: {JSON.stringify(action.params.inputs)}
                </div>
              )}
            </div>
          )}

          {/* Rich Results for GET_RUN_HISTORY */}
          {action.action === 'GET_RUN_HISTORY' && action.resultData && (
            <div className="mt-2 space-y-2">
              {action.resultData.runStatus === 'unavailable' ? (
                <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-start gap-2">
                  <AlertCircle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">GitHub Actions Telemetry Unavailable</p>
                    <p className="text-[11px] text-amber-200/80 mt-0.5">
                      {action.resultData.message || 'Configure your GitHub Token in Settings to inspect live workflow runs.'}
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span className="font-semibold text-white">
                      Workflow Runs ({action.resultData.runs?.length || 0} of {action.resultData.total || 0})
                    </span>
                    {action.resultData.failedCount !== undefined && action.resultData.failedCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                        {action.resultData.failedCount} Failed
                      </span>
                    )}
                  </div>
                  {action.resultData.runs && action.resultData.runs.length > 0 ? (
                    <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                      {action.resultData.runs.map((run: any) => {
                        const isFail = run.conclusion === 'failure';
                        const isSuccess = run.conclusion === 'success';
                        const isRunning = run.status === 'in_progress' || run.status === 'queued';
                        return (
                          <div key={run.id} className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between gap-2 text-xs">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-semibold text-white truncate">{run.name || 'Workflow Run'}</span>
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                                  isFail ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' :
                                  isSuccess ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                                  isRunning ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse' :
                                  'bg-slate-800 text-slate-400'
                                }`}>
                                  {run.conclusion || run.status}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5">
                                <span>Branch: {run.headBranch || 'master'}</span>
                                <span>•</span>
                                <span>{run.createdAt ? new Date(run.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'Recent'}</span>
                                {run.runNumber && <span>• #{run.runNumber}</span>}
                              </div>
                            </div>
                            {run.htmlUrl && (
                              <a
                                href={run.htmlUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-indigo-300 text-[11px] font-medium flex items-center gap-1 transition-colors flex-shrink-0"
                                title="View run logs on GitHub"
                              >
                                <span>Logs</span>
                                <ExternalLink size={10} />
                              </a>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-500 italic">No workflow runs found matching this filter.</p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Rich Results for GET_QUEUE */}
          {action.action === 'GET_QUEUE' && action.resultData?.queues && (
            <div className="mt-2 space-y-2">
              <span className="text-[11px] font-semibold text-white block">Queue Files Inspection</span>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {Object.entries(action.resultData.queues).map(([file, items]: [string, any]) => (
                  <div key={file} className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-cyan-300 text-[11px] font-semibold">{file}</span>
                      <span className="text-[10px] text-slate-400 font-mono">{Array.isArray(items) ? items.length : 0} items</span>
                    </div>
                    {Array.isArray(items) && items.length > 0 ? (
                      <ul className="space-y-0.5 pl-2 border-l border-slate-700/60 max-h-24 overflow-y-auto">
                        {items.slice(0, 10).map((it, idx) => (
                          <li key={idx} className="text-[10px] text-slate-400 truncate font-mono">
                            {typeof it === 'string' ? it : JSON.stringify(it)}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[10px] text-slate-500 italic">Queue is currently empty.</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Rich Results for GET_VOICE_PROFILES */}
          {action.action === 'GET_VOICE_PROFILES' && action.resultData?.profiles && (
            <div className="mt-2 space-y-2">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="font-semibold text-white">Voice Profiles Catalog ({action.resultData.profiles.length})</span>
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {action.resultData.profiles.slice(0, 10).map((p: any, idx: number) => (
                  <div key={idx} className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-white truncate">{p.name}</p>
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mt-0.5">
                        <span className={`px-1 rounded text-[9px] font-semibold ${p.enrolled ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
                          {p.enrolled ? 'Enrolled' : 'Pending'}
                        </span>
                        {p.traits?.length > 0 && <span>• {p.traits.join(', ')}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Rich Results for GET_SCRIPT_PROJECTS */}
          {action.action === 'GET_SCRIPT_PROJECTS' && action.resultData?.projects && (
            <div className="mt-2 space-y-2">
              <span className="text-[11px] font-semibold text-white block">Script Projects ({action.resultData.projects.length})</span>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {action.resultData.projects.map((p: any) => (
                  <div key={p.id} className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between text-xs">
                    <div>
                      <p className="font-semibold text-white">{p.title}</p>
                      <p className="text-[10px] text-slate-500">{p.format || 'Standard'} • {p.clipsCount || 0} clips</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Rich Results for CREATE_CLIP / TRIM_CLIP */}
          {(action.action === 'CREATE_CLIP' || action.action === 'TRIM_CLIP') && action.resultData?.clip && (
            <div className="mt-2 p-2.5 rounded-lg bg-indigo-950/40 border border-indigo-500/30 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white truncate">{action.resultData.clip.title}</span>
                {action.resultData.clip.viral_score && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    🔥 {action.resultData.clip.viral_score}/10
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mt-1 italic line-clamp-2">"{action.resultData.clip.quote || action.resultData.clip.transcript_snippet}"</p>
              <div className="flex items-center gap-2 mt-2 text-[10px] text-slate-500">
                <span>Speaker: {action.resultData.clip.speaker || action.resultData.clip.speakers?.[0]}</span>
                <span>•</span>
                <span>{action.resultData.clip.startSec}s - {action.resultData.clip.endSec}s</span>
              </div>
            </div>
          )}

          {/* Universal 100% Full Telemetry & Payloads Inspector */}
          <div className="mt-2 pt-2 border-t border-slate-800/80">
            <button
              onClick={() => setShowTelemetry(!showTelemetry)}
              className="text-[10px] font-semibold text-slate-400 hover:text-slate-200 flex items-center gap-1 transition-colors cursor-pointer"
            >
              <Code size={11} className="text-slate-500" />
              <span>{showTelemetry ? 'Hide' : 'View'} Raw Action Telemetry &amp; Payloads</span>
              {action.executionDurationMs !== undefined && (
                <span className="text-[9px] text-slate-500 font-mono ml-auto">
                  ⏱️ {action.executionDurationMs}ms
                </span>
              )}
              {showTelemetry ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </button>
            {showTelemetry && (
              <div className="mt-2 space-y-2 p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 text-[10px] font-mono">
                <div>
                  <span className="text-slate-400 font-sans font-semibold block mb-0.5">Parameters Sent:</span>
                  <pre className="p-2 rounded bg-slate-950 text-slate-300 overflow-x-auto max-h-32">
                    {JSON.stringify(action.params || {}, null, 2)}
                  </pre>
                </div>
                {action.resultData && (
                  <div>
                    <span className="text-slate-400 font-sans font-semibold block mb-0.5">Execution Result Data:</span>
                    <pre className="p-2 rounded bg-slate-950 text-emerald-300/90 overflow-x-auto max-h-40">
                      {JSON.stringify(action.resultData, null, 2)}
                    </pre>
                  </div>
                )}
                {action.errorMessage && (
                  <div>
                    <span className="text-rose-400 font-sans font-semibold block mb-0.5">Error Message:</span>
                    <pre className="p-2 rounded bg-rose-950/40 border border-rose-500/30 text-rose-300 overflow-x-auto">
                      {action.errorMessage}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Analyze Findings with Copilot CTA */}
          {action.resultData && (isInspectionAction || isSearchAction) && action.status === 'completed' && onAnalyze && (
            <button
              onClick={() => onAnalyze(action)}
              className="w-full mt-2.5 py-1.5 px-3 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <Sparkles size={12} className="text-amber-400" />
              <span>Ask Copilot to Analyze These Results</span>
            </button>
          )}

          {/* Error Message if Failed */}
          {action.status === 'failed' && action.errorMessage && (
            <p className="mt-1 text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2 py-1 rounded">
              Error: {action.errorMessage}
            </p>
          )}
        </div>

        {/* Action Controls & Status Badges */}
        <div className="flex items-center gap-1.5 flex-shrink-0 self-center">
          {action.status === 'running' ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-500/15 text-blue-300 border border-blue-500/30 animate-pulse">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
              Executing...
            </span>
          ) : isSearchAction ? (
            action.status === 'no_matches' || action.matchCount === 0 ? (
              <span className="text-[11px] font-semibold text-slate-400">
                No matches found
              </span>
            ) : (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-500/15 text-blue-300 border border-blue-500/30">
                <CheckCircle2 size={13} className="text-blue-400" />
                Found {action.matchCount ?? 'matches'}
              </span>
            )
          ) : isInspectionAction ? (
            action.status === 'failed' ? (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
                <XCircle size={13} />
                Failed
              </span>
            ) : (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                <CheckCircle2 size={13} className="text-emerald-400" />
                Completed
              </span>
            )
          ) : action.status === 'accepted' ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30" title="Enqueued for runner execution">
              <Clock size={13} className="text-amber-400" />
              Accepted (Asynchronous Run)
            </span>
          ) : action.status === 'failed' ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
              <XCircle size={13} />
              Failed
            </span>
          ) : action.applied ? (
            <>
              <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                <Check size={13} />
                Applied
              </span>
              {action.snapshot && (
                <button
                  onClick={onRevert}
                  className="p-1 rounded text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition-colors cursor-pointer"
                  title="Undo this action"
                >
                  <Undo2 size={13} />
                </button>
              )}
            </>
          ) : isTier2 ? (
            <button
              onClick={() => onApply({ confirmed: true })}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg text-xs transition-colors flex items-center gap-1.5 shadow-lg shadow-amber-600/20 cursor-pointer"
            >
              <ShieldAlert size={13} />
              Confirm &amp; Execute
            </button>
          ) : (
            <button
              onClick={() => onApply()}
              className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg text-xs transition-colors cursor-pointer"
            >
              Apply Fix
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
