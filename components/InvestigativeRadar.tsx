import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Scale,
  Search,
  Clock,
  User,
  ArrowRight,
  Play,
  Pause,
  Volume2,
  AlertTriangle,
  Layers,
  Filter,
  CheckCircle2,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  Headphones,
  Check
} from 'lucide-react';
import { PipelineConfig } from '../types';
import { getSpeakerTheme } from '../utils/transcriptData';
import { usePlayer } from '../contexts/PlayerContext';

interface ContradictionPairing {
  pairing_id: string;
  number: number;
  title: string;
  pre_fallout: {
    quote_id: string;
    date: string;
    episode_tag: string;
    verbatim: string;
  };
  post_fallout: {
    quote_id: string;
    date: string;
    episode_tag: string;
    verbatim: string;
  };
}

interface CuratedQuote {
  quote_id: string;
  speaker: string;
  date: string;
  episode_title: string;
  release_tag: string;
  exact_quote: string;
  category: string;
  target?: string;
  why_it_matters?: string;
  pre_or_post_fallout: string;
  contradiction_candidate: boolean;
  time_window?: string;
}

interface KnowledgeGraphData {
  version: string;
  title: string;
  updated_at: string;
  stats: {
    total_curated_quotes: number;
    total_contradiction_pairs: number;
    total_speakers: number;
    total_categories: number;
  };
  speakers: string[];
  categories: string[];
  contradiction_pairings: ContradictionPairing[];
  quotes: CuratedQuote[];
}

interface InvestigativeRadarProps {
  config: PipelineConfig;
  onOpenTranscript?: (releaseTag: string) => void;
}

export function parseTimeWindow(tw?: string): { start: number; end: number } | null {
  if (!tw) return null;
  const clean = tw.replace(/[\u2013\u2014]/g, '-').trim();
  const parts = clean.split('-').map(s => s.trim());
  if (parts.length < 2) return null;

  const toSec = (str: string): number => {
    const secMatch = str.match(/^([\d.]+)\s*s?$/i);
    if (secMatch && !str.includes(':')) {
      return parseFloat(secMatch[1]);
    }
    const sub = str.split(':').map(n => parseInt(n, 10));
    if (sub.length === 3) {
      return (sub[0] || 0) * 3600 + (sub[1] || 0) * 60 + (sub[2] || 0);
    } else if (sub.length === 2) {
      return (sub[0] || 0) * 60 + (sub[1] || 0);
    }
    return 0;
  };

  const start = toSec(parts[0]);
  const end = toSec(parts[1]);
  if (isNaN(start) || isNaN(end) || end <= start) {
    if (!isNaN(start) && isNaN(end)) return { start, end: start + 30 };
    return null;
  }
  return { start, end };
}

export function formatSecondsCompact(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const InvestigativeRadar: React.FC<InvestigativeRadarProps> = ({ config, onOpenTranscript }) => {
  const [data, setData] = useState<KnowledgeGraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [audioMap, setAudioMap] = useState<Record<string, string>>({});

  // Audio snippet playback state
  const [playingQuoteId, setPlayingQuoteId] = useState<string | null>(null);
  const [playProgress, setPlayProgress] = useState<{ current: number; duration: number } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentRangeRef = useRef<{
    start: number;
    end: number;
    quoteId: string;
    nextQuote?: { quoteId: string; releaseTag: string; timeWindow?: string };
  } | null>(null);

  const globalPlayer = usePlayer();

  // Tab state
  const [activeTab, setActiveTab] = useState<'matrix' | 'quotes'>('matrix');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSpeaker, setSelectedSpeaker] = useState('ALL');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [selectedFallout, setSelectedFallout] = useState<'ALL' | 'PRE-FALLOUT' | 'POST-FALLOUT'>('ALL');

  // 1. Load Knowledge Graph
  useEffect(() => {
    async function loadGraph() {
      try {
        setLoading(true);
        const res = await fetch('./transcripts/investigative_knowledge_graph.json');
        if (!res.ok) throw new Error(`HTTP ${res.status} loading knowledge graph`);
        const json = await res.json();
        setData(json);
      } catch (err: any) {
        setError(err.message || 'Failed to load knowledge graph data');
      } finally {
        setLoading(false);
      }
    }
    loadGraph();
  }, []);

  // 2. Load Episode Audio Index Map
  useEffect(() => {
    fetch('./transcripts/transcripts_summary_index.json')
      .then(r => (r.ok ? r.json() : []))
      .then((items: any[]) => {
        const map: Record<string, string> = {};
        if (Array.isArray(items)) {
          items.forEach(it => {
            if (it.release_tag && it.audio_url) {
              map[it.release_tag] = it.audio_url;
            }
          });
        }
        setAudioMap(map);
      })
      .catch(() => {});
  }, []);

  // Map of Quote ID -> Curated Quote
  const quotesMap = useMemo(() => {
    const map = new Map<string, CuratedQuote>();
    if (data?.quotes) {
      data.quotes.forEach(q => {
        if (q.quote_id) map.set(q.quote_id, q);
      });
    }
    return map;
  }, [data]);

  // Audio Playback Engine
  const handleTogglePlay = useCallback(
    (
      quoteId: string,
      releaseTag: string,
      timeWindow?: string,
      nextQuote?: { quoteId: string; releaseTag: string; timeWindow?: string }
    ) => {
      if (playingQuoteId === quoteId) {
        if (audioRef.current) audioRef.current.pause();
        setPlayingQuoteId(null);
        setPlayProgress(null);
        currentRangeRef.current = null;
        return;
      }

      const audioUrl = audioMap[releaseTag];
      if (!audioUrl) {
        onOpenTranscript?.(releaseTag);
        return;
      }

      const range = parseTimeWindow(timeWindow);
      if (!audioRef.current) {
        audioRef.current = new Audio();
      }
      const audio = audioRef.current;

      if (!range) {
        currentRangeRef.current = { start: 0, end: 999999, quoteId, nextQuote };
        setPlayingQuoteId(quoteId);
        audio.src = audioUrl;
        audio.currentTime = 0;
        audio.play().catch(console.error);
        return;
      }

      currentRangeRef.current = { start: range.start, end: range.end, quoteId, nextQuote };
      setPlayingQuoteId(quoteId);
      setPlayProgress({ current: 0, duration: Math.max(1, range.end - range.start) });

      if (audio.src === audioUrl) {
        audio.currentTime = range.start;
        audio.play().catch(console.error);
      } else {
        audio.src = audioUrl;
        audio.currentTime = range.start;
        audio.play().catch(console.error);
      }
    },
    [audioMap, onOpenTranscript, playingQuoteId]
  );

  // Auto-pause local snippet if global player starts
  useEffect(() => {
    if (globalPlayer?.isPlaying && playingQuoteId) {
      if (audioRef.current) audioRef.current.pause();
      setPlayingQuoteId(null);
      setPlayProgress(null);
      currentRangeRef.current = null;
    }
  }, [globalPlayer?.isPlaying, playingQuoteId]);

  // Audio event listeners for snippet progression and chaining
  useEffect(() => {
    const audio = audioRef.current || new Audio();
    audioRef.current = audio;

    const onTimeUpdate = () => {
      if (!currentRangeRef.current) return;
      const { start, end, nextQuote } = currentRangeRef.current;
      const curr = audio.currentTime;
      if (curr >= end) {
        audio.pause();
        if (nextQuote) {
          setTimeout(() => {
            handleTogglePlay(nextQuote.quoteId, nextQuote.releaseTag, nextQuote.timeWindow);
          }, 600);
        } else {
          setPlayingQuoteId(null);
          setPlayProgress(null);
          currentRangeRef.current = null;
        }
      } else {
        setPlayProgress({
          current: Math.max(0, curr - start),
          duration: Math.max(1, end - start)
        });
      }
    };

    const onEnded = () => {
      const nextQuote = currentRangeRef.current?.nextQuote;
      if (nextQuote) {
        setTimeout(() => {
          handleTogglePlay(nextQuote.quoteId, nextQuote.releaseTag, nextQuote.timeWindow);
        }, 600);
      } else {
        setPlayingQuoteId(null);
        setPlayProgress(null);
        currentRangeRef.current = null;
      }
    };

    const onError = () => {
      setPlayingQuoteId(null);
      setPlayProgress(null);
      currentRangeRef.current = null;
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audio.pause();
    };
  }, [handleTogglePlay]);

  // Play both Pre and Post quotes sequentially
  const handlePlayPairing = (pair: ContradictionPairing) => {
    const preQ = quotesMap.get(pair.pre_fallout.quote_id);
    const postQ = quotesMap.get(pair.post_fallout.quote_id);
    const preTag = preQ?.release_tag || pair.pre_fallout.episode_tag;
    const postTag = postQ?.release_tag || pair.post_fallout.episode_tag;
    const preTW = preQ?.time_window;
    const postTW = postQ?.time_window;

    if (playingQuoteId === pair.pre_fallout.quote_id || playingQuoteId === pair.post_fallout.quote_id) {
      if (audioRef.current) audioRef.current.pause();
      setPlayingQuoteId(null);
      setPlayProgress(null);
      currentRangeRef.current = null;
      return;
    }

    handleTogglePlay(
      pair.pre_fallout.quote_id,
      preTag,
      preTW,
      postTag ? { quoteId: pair.post_fallout.quote_id, releaseTag: postTag, timeWindow: postTW } : undefined
    );
  };

  // Filtered quotes for Tab 2
  const filteredQuotes = useMemo(() => {
    if (!data?.quotes) return [];
    return data.quotes.filter(q => {
      if (selectedSpeaker !== 'ALL' && q.speaker !== selectedSpeaker) return false;
      if (selectedCategory !== 'ALL' && q.category !== selectedCategory) return false;
      if (selectedFallout !== 'ALL' && q.pre_or_post_fallout !== selectedFallout) return false;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const text = `${q.exact_quote} ${q.why_it_matters || ''} ${q.quote_id} ${q.target || ''}`.toLowerCase();
        if (!text.includes(query)) return false;
      }
      return true;
    });
  }, [data, selectedSpeaker, selectedCategory, selectedFallout, searchQuery]);

  // Helper to render Pre or Post column in Matrix
  const renderQuoteColumn = (
    meta: { quote_id: string; date: string; episode_tag: string; verbatim: string },
    resolvedQuote: CuratedQuote | undefined,
    type: 'pre' | 'post'
  ) => {
    const isPre = type === 'pre';
    const quoteId = meta.quote_id || resolvedQuote?.quote_id || 'AQ-????';
    const exactQuote = resolvedQuote?.exact_quote || meta.verbatim || 'Audio quote statement on record.';
    const speaker = resolvedQuote?.speaker || 'Speaker';
    const date = resolvedQuote?.date || meta.date;
    const timeWindow = resolvedQuote?.time_window;
    const whyItMatters = resolvedQuote?.why_it_matters;
    const category = resolvedQuote?.category;
    const releaseTag = resolvedQuote?.release_tag || meta.episode_tag;
    const episodeTitle = resolvedQuote?.episode_title;
    const audioUrl = audioMap[releaseTag];
    const range = parseTimeWindow(timeWindow);
    const isPlayingThis = playingQuoteId === quoteId;
    const speakerTheme = getSpeakerTheme(speaker);

    return (
      <div className={`p-5 flex flex-col justify-between space-y-4 ${isPre ? 'bg-emerald-950/10' : 'bg-rose-950/10'}`}>
        <div className="space-y-3">
          {/* Row 1: Era Badge + Date */}
          <div className="flex items-center justify-between">
            <span
              className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${
                isPre
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                  : 'bg-rose-500/20 text-rose-400 border-rose-500/30'
              }`}
            >
              {isPre ? 'Pre-Fallout Commitment' : 'Post-Fallout Reversal'}
            </span>
            <span className="text-xs text-slate-400 font-mono flex items-center gap-1">
              <Clock size={11} /> {date}
            </span>
          </div>

          {/* Row 2: Speaker Badge + Time Window */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${speakerTheme.badge} ${speakerTheme.text} border ${speakerTheme.border}`}
              >
                <span>{speakerTheme.emoji || '🎙️'}</span>
                <span>{speaker}</span>
                {speakerTheme.role && <span className="text-[9px] opacity-75 font-normal">({speakerTheme.role})</span>}
              </span>
            </div>
            {timeWindow && (
              <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1 bg-slate-900/80 px-2 py-0.5 rounded border border-slate-800">
                <Clock size={11} className="text-slate-500" /> {timeWindow}
              </span>
            )}
          </div>

          {/* Verbatim Blockquote */}
          <blockquote
            className={`text-xs leading-relaxed text-slate-200 italic border-l-2 pl-3 py-1.5 ${
              isPre ? 'border-emerald-500/60' : 'border-rose-500/60'
            }`}
          >
            "{exactQuote}"
          </blockquote>

          {/* Evidentiary Significance Callout */}
          {(whyItMatters || category) && (
            <div
              className={`p-3 rounded-xl border text-xs leading-relaxed ${
                isPre
                  ? 'bg-emerald-950/20 border-emerald-500/20 text-emerald-200/90'
                  : 'bg-rose-950/20 border-rose-500/20 text-rose-200/90'
              }`}
            >
              <div
                className={`flex items-center gap-1.5 font-semibold text-[10px] uppercase tracking-wider mb-1 ${
                  isPre ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {isPre ? <Scale size={11} /> : <AlertTriangle size={11} />} Evidentiary Significance
              </div>
              <p className="text-slate-300 text-[11px] leading-relaxed">{whyItMatters || category}</p>
            </div>
          )}
        </div>

        {/* Footer: Playback Button + ID + View Episode */}
        <div className="pt-3 border-t border-slate-800/60 space-y-2">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <div className="flex items-center gap-2">
              {audioUrl ? (
                <button
                  onClick={() => handleTogglePlay(quoteId, releaseTag, timeWindow)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer shadow-sm ${
                    isPlayingThis
                      ? isPre
                        ? 'bg-emerald-500 text-slate-950 animate-pulse font-bold'
                        : 'bg-rose-500 text-slate-950 animate-pulse font-bold'
                      : isPre
                      ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40'
                      : 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40'
                  }`}
                  title={isPlayingThis ? 'Pause audio snippet' : 'Play isolated audio snippet'}
                >
                  {isPlayingThis ? <Pause size={12} className="fill-current" /> : <Play size={12} className="fill-current" />}
                  <span>
                    {isPlayingThis && playProgress
                      ? `${formatSecondsCompact(playProgress.current)} / ${formatSecondsCompact(playProgress.duration)}`
                      : `Play Clip ${range ? `(${formatSecondsCompact(range.end - range.start)})` : ''}`}
                  </span>
                </button>
              ) : (
                <button
                  onClick={() => releaseTag && onOpenTranscript?.(releaseTag)}
                  className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-400 cursor-pointer"
                  title="Episode audio indexing in background"
                >
                  <Headphones size={11} /> <span>Audio Index</span>
                </button>
              )}

              <span className={`font-mono font-semibold ${isPre ? 'text-emerald-400' : 'text-rose-400'}`}>
                ID: {quoteId}
              </span>
            </div>

            {releaseTag && (
              <button
                onClick={() => onOpenTranscript?.(releaseTag)}
                className="text-indigo-400 hover:text-indigo-300 hover:underline flex items-center gap-1 cursor-pointer truncate max-w-[160px]"
                title={`View episode: ${episodeTitle || releaseTag}`}
              >
                <span className="truncate">{episodeTitle || 'View Episode'}</span>
                <ChevronRight size={11} className="shrink-0" />
              </button>
            )}
          </div>

          {/* Dynamic progress bar when playing */}
          {isPlayingThis && playProgress && (
            <div className="w-full bg-slate-900 rounded-full h-1 overflow-hidden border border-slate-800">
              <div
                className={`h-full transition-all duration-150 ${isPre ? 'bg-emerald-400' : 'bg-rose-400'}`}
                style={{ width: `${Math.min(100, (playProgress.current / playProgress.duration) * 100)}%` }}
              />
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-slate-950 text-slate-100 overflow-hidden">
      {/* ── Top Header ── */}
      <header className="px-6 py-4 border-b border-slate-800 bg-slate-900/40 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
              <Scale size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                Investigative Radar & Contradiction Board
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                Relational evidence graph mapping narrative shifts, contradictions, and evidentiary callbacks.
              </p>
            </div>
          </div>
        </div>

        {/* Tab Buttons */}
        <div className="flex items-center gap-1.5 bg-slate-900/80 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveTab('matrix')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'matrix' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <AlertTriangle size={13} className={activeTab === 'matrix' ? 'text-amber-300' : ''} />
            Contradiction Matrix ({data?.stats.total_contradiction_pairs || 0})
          </button>
          <button
            onClick={() => setActiveTab('quotes')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'quotes' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers size={13} />
            Curated Claims ({data?.stats.total_curated_quotes || 0})
          </button>
        </div>
      </header>

      {/* ── Main View ── */}
      <div className="flex-1 min-h-0 overflow-y-auto p-6 md:p-8">
        {loading && (
          <div className="h-64 flex flex-col items-center justify-center gap-3">
            <RefreshCw className="w-6 h-6 text-indigo-400 animate-spin" />
            <p className="text-xs text-slate-400">Loading investigative knowledge graph...</p>
          </div>
        )}

        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm">{error}</div>
        )}

        {!loading && !error && data && (
          <>
            {/* ── TAB 1: CONTRADICTION MATRIX ── */}
            {activeTab === 'matrix' && (
              <div className="space-y-6 max-w-6xl mx-auto">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">
                      Master Analytical Juxtapositions
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Side-by-side verification pairing pre-fallout commitments against post-fallout conduct.
                    </p>
                  </div>
                  <span className="text-xs font-mono text-amber-400 bg-amber-400/10 px-2.5 py-1 rounded-md border border-amber-400/20">
                    {data.contradiction_pairings.length} Master Pairings Identified
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-6">
                  {data.contradiction_pairings.map(pair => {
                    const preQuote = quotesMap.get(pair.pre_fallout.quote_id);
                    const postQuote = quotesMap.get(pair.post_fallout.quote_id);
                    const isPairPlaying =
                      playingQuoteId === pair.pre_fallout.quote_id || playingQuoteId === pair.post_fallout.quote_id;

                    return (
                      <div
                        key={pair.pairing_id}
                        className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-xl"
                      >
                        {/* Pairing Header */}
                        <div className="px-5 py-3 border-b border-slate-800 bg-slate-800/40 flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <span className="px-2 py-0.5 rounded font-mono text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              #{pair.number.toString().padStart(2, '0')}
                            </span>
                            <h3 className="text-sm font-bold text-slate-100">{pair.title}</h3>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handlePlayPairing(pair)}
                              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer shadow-sm ${
                                isPairPlaying
                                  ? 'bg-amber-500 text-slate-950 animate-pulse font-bold shadow-amber-500/20'
                                  : 'bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/40'
                              }`}
                              title="Play Pre-Fallout commitment followed immediately by Post-Fallout reversal"
                            >
                              {isPairPlaying ? <Pause size={12} className="fill-current" /> : <Play size={12} className="fill-current" />}
                              <span>{isPairPlaying ? 'Pause Comparison' : 'Play Both ▶'}</span>
                            </button>
                            <span className="text-[11px] font-semibold text-rose-400 flex items-center gap-1">
                              <AlertTriangle size={12} /> Direct Contradiction
                            </span>
                          </div>
                        </div>

                        {/* Side-by-Side Dual Card */}
                        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-800">
                          {renderQuoteColumn(pair.pre_fallout, preQuote, 'pre')}
                          {renderQuoteColumn(pair.post_fallout, postQuote, 'post')}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── TAB 2: CURATED CLAIMS EXPLORER ── */}
            {activeTab === 'quotes' && (
              <div className="space-y-6 max-w-6xl mx-auto">
                {/* Search & Filter Bar */}
                <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row items-center gap-3">
                  <div className="relative flex-1 w-full">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={15} />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Filter claims by quote text, quote ID, why it matters, or target..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  {/* Speaker Filter */}
                  <select
                    value={selectedSpeaker}
                    onChange={e => setSelectedSpeaker(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="ALL">All Speakers ({data.speakers.length})</option>
                    {data.speakers.map(s => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>

                  {/* Category Filter */}
                  <select
                    value={selectedCategory}
                    onChange={e => setSelectedCategory(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 max-w-[200px]"
                  >
                    <option value="ALL">All Categories ({data.categories.length})</option>
                    {data.categories.map(c => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>

                  {/* Fallout Period Filter */}
                  <select
                    value={selectedFallout}
                    onChange={e => setSelectedFallout(e.target.value as any)}
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="ALL">All Eras</option>
                    <option value="PRE-FALLOUT">Pre-Fallout (Alliance)</option>
                    <option value="POST-FALLOUT">Post-Fallout (Conflict)</option>
                  </select>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                  <span>
                    Showing {filteredQuotes.length} of {data.quotes.length} curated quotes
                  </span>
                </div>

                {/* Quotes Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredQuotes.map(q => {
                    const speakerTheme = getSpeakerTheme(q.speaker);
                    const isPre = q.pre_or_post_fallout === 'PRE-FALLOUT';
                    const range = parseTimeWindow(q.time_window);
                    const isPlayingThis = playingQuoteId === q.quote_id;
                    const audioUrl = audioMap[q.release_tag];

                    return (
                      <div
                        key={q.quote_id}
                        className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 flex flex-col justify-between space-y-3 hover:border-slate-700 transition-colors"
                      >
                        <div className="space-y-2.5">
                          {/* Row 1: ID, Speaker & Era Badge */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-bold text-indigo-400">{q.quote_id}</span>
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${speakerTheme.badge} ${speakerTheme.text} border ${speakerTheme.border}`}
                              >
                                <span>{speakerTheme.emoji || '🎙️'}</span>
                                <span>{q.speaker}</span>
                              </span>
                            </div>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded font-mono border ${
                                isPre
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                  : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                              }`}
                            >
                              {q.pre_or_post_fallout}
                            </span>
                          </div>

                          {/* Time window */}
                          {q.time_window && (
                            <div className="text-[11px] font-mono text-slate-400 flex items-center gap-1">
                              <Clock size={11} className="text-slate-500" /> {q.time_window}
                            </div>
                          )}

                          <blockquote className="text-xs text-slate-200 italic border-l-2 border-indigo-500/40 pl-2.5 py-1 leading-relaxed">
                            "{q.exact_quote}"
                          </blockquote>

                          {q.why_it_matters && (
                            <div className="text-[11px] text-slate-300 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/60 leading-relaxed">
                              <strong className="text-indigo-300 font-semibold block mb-0.5">
                                Evidentiary Significance:
                              </strong>
                              {q.why_it_matters}
                            </div>
                          )}
                        </div>

                        {/* Footer: Play Audio Button + Category + Link */}
                        <div className="pt-2.5 border-t border-slate-800/80 space-y-2 text-[11px] text-slate-400">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {audioUrl ? (
                                <button
                                  onClick={() => handleTogglePlay(q.quote_id, q.release_tag, q.time_window)}
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer shadow-sm ${
                                    isPlayingThis
                                      ? 'bg-indigo-500 text-white animate-pulse font-bold'
                                      : 'bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/40'
                                  }`}
                                  title={isPlayingThis ? 'Pause audio snippet' : 'Play isolated audio snippet'}
                                >
                                  {isPlayingThis ? (
                                    <Pause size={12} className="fill-current" />
                                  ) : (
                                    <Play size={12} className="fill-current" />
                                  )}
                                  <span>
                                    {isPlayingThis && playProgress
                                      ? `${formatSecondsCompact(playProgress.current)} / ${formatSecondsCompact(playProgress.duration)}`
                                      : `Play Clip ${range ? `(${formatSecondsCompact(range.end - range.start)})` : ''}`}
                                  </span>
                                </button>
                              ) : (
                                <span className="font-mono text-slate-500">{q.date}</span>
                              )}
                            </div>

                            <div className="flex items-center gap-2">
                              <span className="truncate max-w-[180px] text-slate-400" title={q.category}>
                                {q.category}
                              </span>
                              {q.release_tag && (
                                <button
                                  onClick={() => onOpenTranscript?.(q.release_tag)}
                                  className="text-indigo-400 hover:text-indigo-300 cursor-pointer"
                                  title="Jump to Episode Transcript"
                                >
                                  <ExternalLink size={12} />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Dynamic progress bar when playing in Tab 2 */}
                          {isPlayingThis && playProgress && (
                            <div className="w-full bg-slate-900 rounded-full h-1 overflow-hidden border border-slate-800">
                              <div
                                className="h-full bg-indigo-500 transition-all duration-150"
                                style={{
                                  width: `${Math.min(100, (playProgress.current / playProgress.duration) * 100)}%`
                                }}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          </>
        )}
      </div>
    </div>
  );
};

export default InvestigativeRadar;
