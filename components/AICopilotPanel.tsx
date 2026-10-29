import React, { useState, useRef, useEffect } from 'react';
import { COPILOT_MODEL_OPTIONS } from '../utils/copilotModels';
import {
  Bot,
  Send,
  Sparkles,
  Trash2,
  CheckCircle2,
  Undo2,
  Play,
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
  AlertTriangle,
  ShieldAlert,
  Clock,
  XCircle
} from 'lucide-react';
import { useCopilot } from '../contexts/CopilotContext';
import { useMontage } from '../contexts/MontageContext';
import { usePlayer } from '../contexts/PlayerContext';
import { TensionArc } from './TensionArc';
import { TargetWindowGauge } from './TargetWindowGauge';
import type { CopilotAction } from '../utils/copilotTypes';
import { resolveActionTier } from '../utils/contracts/copilotActions';

const PRESET_PILLS = [
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
    clearMessages,
    contextPayload,
  } = useCopilot();

  const montage = useMontage();
  const player = usePlayer();

  const [input, setInput] = useState('');
  const [showCanvas, setShowCanvas] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

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

            {/* Clear button */}
            <button
              onClick={clearMessages}
              className="p-1.5 rounded-lg border border-slate-800 text-slate-400 hover:text-rose-400 hover:border-rose-500/30 transition-colors cursor-pointer"
              title="Clear chat history"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>

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
          {messages.map(m => (
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
                <div className="whitespace-pre-wrap">{renderMessageContent(m.content, m.matches?.[0])}</div>

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
                      {m.matches.map((match, idx) => (
                        <div key={idx} className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs hover:border-slate-700 transition-colors">
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 font-semibold text-[10px] border border-blue-500/20 flex-shrink-0">
                                {match.speaker}
                              </span>
                              <span className="text-slate-400 text-[11px] truncate">
                                in {match.episode_title || match.episode_id}
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-500 font-mono flex-shrink-0">
                              {match.formatted_time || formatTime(match.start_timestamp)} - {formatTime(match.end_timestamp)}
                            </span>
                          </div>

                          <p className="text-[11px] text-slate-300 italic mb-2 line-clamp-2">
                            "{match.snippet}"
                          </p>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                const targetUrl = match.audio_url || contextPayload.currentEpisode?.audioUrl;
                                if (targetUrl) {
                                  player.play(
                                    {
                                      id: match.episode_id || Date.now(),
                                      title: match.episode_title || 'Episode Space',
                                      audioUrl: targetUrl,
                                    },
                                    match.start_timestamp
                                  );
                                } else {
                                  player.seek(match.start_timestamp);
                                }
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 rounded text-[11px] font-semibold border border-indigo-500/30 transition-colors cursor-pointer"
                              title="Seek audio player to this segment"
                            >
                              <Play size={10} className="fill-current" />
                              ▶ Jump to Timestamp
                            </button>
                            <button
                              onClick={() => {
                                const newClipId = `clip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                                montage.addClip({
                                  id: newClipId,
                                  title: `${match.speaker}: ${match.snippet.slice(0, 30)}...`,
                                  quote: match.snippet,
                                  speaker: match.speaker,
                                  sourceTitle: match.episode_title,
                                  sourceTag: match.episode_id,
                                  audioUrl: match.audio_url || contextPayload.currentEpisode?.audioUrl,
                                  startSec: match.start_timestamp,
                                  endSec: match.end_timestamp || match.start_timestamp + 25,
                                  category: 'Highlights',
                                  severity: 8,
                                  tensionScore: 7,
                                  directorNote: `Extracted from search quote in ${match.episode_title}`,
                                });
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 rounded text-[11px] font-semibold border border-emerald-500/30 transition-colors cursor-pointer"
                              title="Append this slice to the Active Montage Reel"
                            >
                              <Sparkles size={10} />
                              + Append to Reel
                            </button>
                          </div>
                        </div>
                      ))}
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
                      />
                    ))}
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
          ))}

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
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-medium">
                {montage.clips.length} clips
              </span>
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
              montage.clips.map((clip, idx) => (
                <div
                  key={clip.id}
                  className="p-3 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors flex items-start justify-between gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="w-4 h-4 rounded-full bg-slate-800 text-[10px] font-bold flex items-center justify-center text-slate-400 flex-shrink-0">
                        {idx + 1}
                      </span>
                      <p className="text-xs font-semibold text-white truncate">{clip.title}</p>
                    </div>
                    <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5 italic">
                      "{clip.quote}"
                    </p>
                    <div className="flex items-center gap-2 mt-1.5 text-[10px] text-slate-500">
                      <span>{clip.speaker}</span>
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
                    onClick={() => {
                      if (clip.audioUrl) {
                        player.play(
                          { id: Date.now(), title: clip.title, audioUrl: clip.audioUrl },
                          clip.startSec
                        );
                      }
                    }}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer flex-shrink-0"
                    title="Play clip snippet"
                  >
                    <Play size={12} />
                  </button>
                </div>
              ))
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
}

const ActionCard: React.FC<ActionCardProps> = ({ action, onApply, onRevert }) => {
  const isSearchAction = action.action === 'SEARCH_TRANSCRIPTS' || action.action.startsWith('GET_') || action.action === 'INSPECT_KNOWLEDGE_GRAPH';
  const tier = action.tier ?? resolveActionTier(action.action, action.params);
  const isTier2 = tier === 2;

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
    <div className={`p-3 rounded-xl border flex flex-col gap-2.5 text-xs transition-colors ${
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

          {/* Error Message if Failed */}
          {action.status === 'failed' && action.errorMessage && (
            <p className="mt-1 text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2 py-1 rounded">
              Error: {action.errorMessage}
            </p>
          )}
        </div>

        {/* Action Controls & Status Badges */}
        <div className="flex items-center gap-1.5 flex-shrink-0 self-center">
          {isSearchAction ? (
            action.status === 'running' ? (
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-400">
                <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
                Querying...
              </span>
            ) : action.status === 'no_matches' || action.matchCount === 0 ? (
              <span className="text-[11px] font-semibold text-slate-400">
                No matches found
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-300">
                <CheckCircle2 size={13} className="text-blue-400" />
                Found {action.matchCount ?? 'matches'}
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
          ) : action.status === 'running' ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-500/15 text-blue-300 border border-blue-500/30">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
              Executing...
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
