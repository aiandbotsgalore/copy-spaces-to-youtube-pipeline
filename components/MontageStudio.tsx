import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Film,
  Play,
  Pause,
  ArrowUp,
  ArrowDown,
  Trash2,
  Download,
  FileText,
  Sparkles,
  Clock,
  Volume2,
  VolumeX,
  Search,
  SlidersHorizontal,
  Plus,
  Check,
  X,
  AlertTriangle,
  RotateCcw,
  SkipForward,
  SkipBack,
  Loader2,
  ShieldAlert,
  Calendar,
  Layers,
  Flame,
  Radio,
  ExternalLink,
  ChevronRight,
  GripVertical
} from 'lucide-react';
import { useMontage, MontageClipItem, HARD_EXCLUDE_PHRASE, AutoCuratorMode } from '../contexts/MontageContext';
import { EnhancedConfig } from '../types';

interface RawCatalogClip {
  title: string;
  category: string;
  start_seconds: number;
  end_seconds: number;
  duration?: number;
  speakers: string[];
  viral_score?: number;
  reason?: string;
  transcript_snippet?: string;
  episode?: string;
  file_path?: string;
  download_url?: string;
}

interface RawManifestClip {
  id: string;
  filename: string;
  title: string;
  quote: string;
  space_tag?: string;
  space_title?: string;
  timestamp?: string;
  url?: string;
}

interface AuditCueItem {
  cue_id: string;
  category: string;
  quote_id: string;
  status: 'EXISTS' | 'READY_FOR_EXTRACTION' | 'SOURCE_NOT_AVAILABLE';
  episode_key: string;
  episode_id: string;
  speaker: string;
  filename: string | null;
  audio_url: string | null;
  start_seconds?: number | null;
  end_seconds?: number | null;
  duration?: number;
  verbatim: string;
  note: string;
}

export const MontageStudio: React.FC<{ config?: EnhancedConfig }> = ({ config }) => {
  const {
    clips: timelineClips,
    addClip,
    removeClip,
    moveClip,
    reorderClips,
    nudgeClipStart,
    nudgeClipEnd,
    clearClips,
    gapSeconds,
    setGapSeconds,
    targetDurationSec,
    setTargetDurationSec,
    normalizeAudio,
    setNormalizeAudio,
    antiClickFades,
    setAntiClickFades,
    blacklistedQuoteIds,
    toggleBlacklist,
    isBlacklisted,
    autoCurate,
    isAuditioning,
    currentAuditionIndex,
    startAudition,
    stopAudition,
    skipAudition,
    exportStitchedWav,
    exportManifestJson,
    exportAudacityLabels,
    isExporting,
    exportProgress,
  } = useMontage();

  // All available clips from cloud catalog and local manifests
  const [availableClips, setAvailableClips] = useState<MontageClipItem[]>([]);
  const [loadingClips, setLoadingClips] = useState(true);

  // Search & Filtering
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('ALL');
  const [hideBlacklisted, setHideBlacklisted] = useState(false);

  // Solo clip preview player state
  const [previewClipId, setPreviewClipId] = useState<string | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [failedAudioUrls, setFailedAudioUrls] = useState<Record<string, boolean>>({});
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  // Drag and drop state for timeline reordering
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Load clips dynamically from clips_catalog.json, manifest.json, and cue_sheet_audit_results.json
  useEffect(() => {
    let isMounted = true;
    const fetchAllClips = async () => {
      setLoadingClips(true);
      const combined: MontageClipItem[] = [];
      const seenQuotes = new Set<string>();

      // 1. Fetch cue_sheet_audit_results.json if generated
      try {
        const auditRes = await fetch('cue_sheet_audit_results.json');
        if (auditRes.ok) {
          const auditData: AuditCueItem[] = await auditRes.json();
          auditData.forEach(item => {
            const quoteText = item.verbatim || '';
            seenQuotes.add(quoteText.trim().toLowerCase());
            combined.push({
              id: `cue_${item.cue_id}_${item.quote_id}`,
              title: `${item.cue_id}: ${item.quote_id} (${item.category})`,
              quote: quoteText,
              speaker: item.speaker || 'Angela Maggard',
              sourceTitle: item.episode_key.replace(/_/g, ' '),
              sourceTag: item.episode_id,
              sourceDate: item.episode_id.startsWith('2026') ? item.episode_id.slice(0, 8).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : '2026-09-18',
              audioUrl: item.audio_url || undefined,
              startSec: item.start_seconds || 0,
              endSec: item.end_seconds || (item.start_seconds ? item.start_seconds + (item.duration || 15) : 30),
              category: item.category,
              severity: item.category.includes('Allegation') ? 9 : 8,
              quoteId: item.quote_id,
              status: item.status,
              isExcluded: item.verbatim.toLowerCase().includes(HARD_EXCLUDE_PHRASE.toLowerCase()),
            });
          });
        }
      } catch (err) {
        console.warn('Notice: cue_sheet_audit_results.json not yet generated or loaded:', err);
      }

      // 2. Fetch local Angela clips manifest
      try {
        const manRes = await fetch('clips/angela/manifest.json');
        if (manRes.ok) {
          const manData: RawManifestClip[] = await manRes.json();
          manData.forEach(m => {
            const quoteKey = (m.quote || m.title).trim().toLowerCase();
            if (!seenQuotes.has(quoteKey)) {
              seenQuotes.add(quoteKey);
              const isHardExcluded = quoteKey.includes(HARD_EXCLUDE_PHRASE.toLowerCase());
              combined.push({
                id: `man_${m.id}`,
                title: m.title,
                quote: m.quote,
                speaker: 'Angela Maggard',
                sourceTitle: m.space_title || 'Twitter Space Archive',
                sourceTag: m.space_tag,
                sourceDate: m.space_tag?.startsWith('2026') ? m.space_tag.slice(0, 8).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : '2026-09-18',
                audioUrl: m.url || `clips/angela/${m.filename}`,
                startSec: 0,
                endSec: 30, // Lossless sliced clips play from 0s
                category: m.title.toLowerCase().includes('predator') || m.title.toLowerCase().includes('abuse') ? 'Direct Allegation' : 'Retaliation & Disclosure',
                severity: 8,
                status: 'EXISTS',
                isExcluded: isHardExcluded,
              });
            }
          });
        }
      } catch (err) {
        console.warn('Notice: clips/angela/manifest.json fetch skipped:', err);
      }

      // 3. Fetch clips_catalog.json (Releases catalog)
      try {
        const catRes = await fetch('clips/clips_catalog.json');
        if (catRes.ok) {
          const catData: RawCatalogClip[] = await catRes.json();
          catData.forEach((c, idx) => {
            const quoteKey = (c.transcript_snippet || c.title).trim().toLowerCase();
            if (!seenQuotes.has(quoteKey)) {
              seenQuotes.add(quoteKey);
              const isHardExcluded = quoteKey.includes(HARD_EXCLUDE_PHRASE.toLowerCase());
              combined.push({
                id: `cat_${idx}_${c.start_seconds}`,
                title: c.title,
                quote: c.transcript_snippet || c.title,
                speaker: (c.speakers && c.speakers[0]) || 'Speaker',
                sourceTitle: c.episode || 'Twitter Space',
                sourceTag: c.episode,
                sourceDate: c.episode?.match(/2026\d{4}/)?.[0].replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') || '2026-09-08',
                audioUrl: c.download_url || c.file_path,
                startSec: c.start_seconds,
                endSec: c.end_seconds,
                category: c.category || 'Highlights',
                severity: c.viral_score || 7,
                status: 'EXISTS',
                isExcluded: isHardExcluded,
              });
            }
          });
        }
      } catch (err) {
        console.warn('Notice: clips_catalog.json fetch skipped:', err);
      }

      if (isMounted) {
        setAvailableClips(combined);
        setLoadingClips(false);
      }
    };

    fetchAllClips();
    return () => {
      isMounted = false;
    };
  }, []);

  // Filter available clips
  const filteredClips = useMemo(() => {
    return availableClips.filter(c => {
      // Exclude hard blacklisted quote or editor-blacklisted
      const isHard = c.quote && c.quote.toLowerCase().includes(HARD_EXCLUDE_PHRASE.toLowerCase());
      const isBl = isHard || isBlacklisted(c.quoteId || '') || isBlacklisted(c.id) || isBlacklisted(c.quote);
      if (hideBlacklisted && isBl) return false;

      // Category filter
      if (selectedCategory !== 'ALL') {
        const cat = (c.category || '').toLowerCase();
        if (selectedCategory === 'allegations' && !cat.includes('allegation') && !cat.includes('predator') && !cat.includes('abuse')) {
          return false;
        }
        if (selectedCategory === 'retaliation' && !cat.includes('retaliation') && !cat.includes('threat') && !cat.includes('doxx') && !cat.includes('lawsuit')) {
          return false;
        }
        if (selectedCategory === 'evidence' && !cat.includes('evidence') && !cat.includes('method') && !cat.includes('archive')) {
          return false;
        }
        if (selectedCategory === 'humor' && !cat.includes('humor') && !cat.includes('banter')) {
          return false;
        }
      }

      // Status filter
      if (selectedStatusFilter !== 'ALL' && c.status !== selectedStatusFilter) {
        return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = (c.title || '').toLowerCase().includes(q);
        const matchQuote = (c.quote || '').toLowerCase().includes(q);
        const matchSpeaker = (c.speaker || '').toLowerCase().includes(q);
        const matchEp = (c.sourceTitle || '').toLowerCase().includes(q);
        const matchCat = (c.category || '').toLowerCase().includes(q);
        const matchQuoteId = (c.quoteId || '').toLowerCase().includes(q);
        if (!matchTitle && !matchQuote && !matchSpeaker && !matchEp && !matchCat && !matchQuoteId) {
          return false;
        }
      }

      return true;
    });
  }, [availableClips, searchQuery, selectedCategory, selectedStatusFilter, hideBlacklisted, isBlacklisted]);

  // Timeline runtime calculations
  const totalClipsDuration = timelineClips.reduce((acc, c) => acc + Math.max(0.2, c.endSec - c.startSec), 0);
  const totalGapsDuration = Math.max(0, timelineClips.length - 1) * gapSeconds;
  const cumulativeSec = totalClipsDuration + totalGapsDuration;
  const runtimeMins = Math.floor(cumulativeSec / 60);
  const runtimeSecs = Math.round(cumulativeSec % 60);
  const formattedRuntime = `${runtimeMins}:${runtimeSecs.toString().padStart(2, '0')}`;

  // Visual Duration Gauge metrics
  const durationPct = targetDurationSec > 0 ? (cumulativeSec / targetDurationSec) * 100 : 0;
  const isOverflow = cumulativeSec > targetDurationSec;
  const overflowSec = (cumulativeSec - targetDurationSec).toFixed(1);

  // Playback handler for solo clip auditioning in browser
  const playSoloPreview = (clip: MontageClipItem) => {
    if (previewClipId === clip.id && isPreviewPlaying) {
      if (previewAudioRef.current) previewAudioRef.current.pause();
      setIsPreviewPlaying(false);
      return;
    }

    if (!clip.audioUrl) {
      alert('Audio stream URL is not available for this excerpt.');
      return;
    }

    if (!previewAudioRef.current) {
      previewAudioRef.current = new Audio();
    }

    const audio = previewAudioRef.current;
    audio.src = clip.audioUrl;
    audio.currentTime = Math.max(0, clip.startSec);

    audio.oncanplay = () => {
      audio.play().catch(e => {
        console.warn('Playback error:', e);
        setFailedAudioUrls(prev => ({ ...prev, [clip.id]: true }));
        setIsPreviewPlaying(false);
      });
    };

    const handleTimeUpdate = () => {
      if (clip.endSec > 0 && audio.currentTime >= clip.endSec) {
        audio.pause();
        audio.removeEventListener('timeupdate', handleTimeUpdate);
        setIsPreviewPlaying(false);
      }
    };
    audio.addEventListener('timeupdate', handleTimeUpdate);

    audio.onerror = () => {
      setFailedAudioUrls(prev => ({ ...prev, [clip.id]: true }));
      setIsPreviewPlaying(false);
    };

    setPreviewClipId(clip.id);
    setIsPreviewPlaying(true);
  };

  // Drag and drop timeline reordering handlers
  const handleDragStart = (idx: number) => {
    setDraggedIdx(idx);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIdx(idx);
  };

  const handleDrop = (targetIdx: number) => {
    if (draggedIdx !== null && draggedIdx !== targetIdx) {
      reorderClips(draggedIdx, targetIdx);
    }
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 text-slate-200 overflow-hidden font-sans">
      {/* ── STUDIO HEADER / TOP METRICS BAR ── */}
      <header className="px-6 py-4 bg-slate-900/80 border-b border-indigo-500/20 backdrop-blur-md flex flex-wrap items-center justify-between gap-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-br from-indigo-500/20 to-violet-500/20 text-indigo-400 rounded-2xl border border-indigo-500/30 shadow-lg shadow-indigo-500/10">
            <Film size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                Montage Studio &amp; Audio Documentary Curator
              </h1>
              <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-mono text-[10px] uppercase font-bold border border-indigo-500/30">
                Studio Edition
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Cloud-native clip discovery, micro-trimming, auto-curation, and lossless master WAV export.
            </p>
          </div>
        </div>

        {/* Global Reel Stats & Duration Gauge */}
        <div className="flex items-center gap-4 bg-slate-950/80 border border-slate-800 rounded-2xl px-4 py-2 text-xs">
          <div>
            <span className="text-[10px] uppercase font-semibold text-slate-500 block">Sequence</span>
            <span className="font-bold text-white text-sm">
              {timelineClips.length} <span className="text-slate-400 font-normal text-xs">clip{timelineClips.length !== 1 ? 's' : ''}</span>
            </span>
          </div>

          <div className="h-7 w-px bg-slate-800" />

          {/* Cumulative Duration & Visual Duration Gauge */}
          <div className="flex flex-col min-w-[170px]">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-[10px] uppercase font-semibold text-slate-400">
                Duration: <strong className="text-white font-mono">{formattedRuntime}</strong>
              </span>
              <span className={`text-[10px] font-mono font-bold ${isOverflow ? 'text-rose-400' : 'text-emerald-400'}`}>
                {isOverflow ? `+${overflowSec}s overflow` : `${Math.round(durationPct)}% of target`}
              </span>
            </div>
            {/* Gauge bar */}
            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 rounded-full ${
                  isOverflow
                    ? 'bg-rose-500'
                    : durationPct >= 85
                    ? 'bg-emerald-400'
                    : 'bg-indigo-500'
                }`}
                style={{ width: `${Math.min(100, durationPct)}%` }}
              />
            </div>
          </div>

          <div className="h-7 w-px bg-slate-800" />

          {/* Target Duration Selector */}
          <div>
            <span className="text-[10px] uppercase font-semibold text-slate-500 block">Target Window</span>
            <select
              value={targetDurationSec}
              onChange={e => setTargetDurationSec(parseFloat(e.target.value))}
              className="bg-transparent text-indigo-300 font-bold focus:outline-none cursor-pointer text-xs"
            >
              <option value="60" className="bg-slate-900">60s (Teaser / Short)</option>
              <option value="90" className="bg-slate-900">90s (Standard Reel)</option>
              <option value="120" className="bg-slate-900">120s (Extended Trailer)</option>
              <option value="180" className="bg-slate-900">180s (3-Min Spotlight)</option>
              <option value="300" className="bg-slate-900">300s (5-Min Scene)</option>
            </select>
          </div>
        </div>
      </header>

      {/* ── MAIN STUDIO WORKSPACE (DUAL-PANE LAYOUT) ── */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
        {/* ── LEFT PANE: INTERACTIVE TIMELINE STUDIO ── */}
        <section className="w-full lg:w-[48%] border-r border-slate-800/80 flex flex-col bg-slate-950 min-h-0">
          {/* Timeline Toolbar */}
          <div className="px-5 py-3 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between gap-2 flex-wrap text-xs">
            <div className="flex items-center gap-2">
              <Layers size={15} className="text-indigo-400" />
              <h2 className="font-bold text-white text-sm">Sequence Timeline</h2>
              <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono text-[11px]">
                {timelineClips.length}
              </span>
            </div>

            {/* Auto-Curator dropdown / triggers */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-400 flex items-center gap-1">
                <Sparkles size={12} className="text-amber-400" /> Auto-Curate:
              </span>
              <button
                onClick={() => autoCurate('escalation', availableClips)}
                className="px-2.5 py-1 bg-violet-950/60 hover:bg-violet-900/80 text-violet-300 hover:text-white border border-violet-500/30 rounded-xl text-[11px] font-semibold transition-all cursor-pointer"
                title="Curate by Dramatic Escalation: Context -> Core Allegations -> Retaliation/Disclosures"
              >
                Escalation Arc
              </button>
              <button
                onClick={() => autoCurate('target_fit', availableClips)}
                className="px-2.5 py-1 bg-indigo-950/60 hover:bg-indigo-900/80 text-indigo-300 hover:text-white border border-indigo-500/30 rounded-xl text-[11px] font-semibold transition-all cursor-pointer"
                title="Automatically fits highest-priority non-excluded clips into selected target length"
              >
                Fit {targetDurationSec}s
              </button>
              <button
                onClick={() => autoCurate('chronological', availableClips)}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 rounded-xl text-[11px] font-semibold transition-all cursor-pointer"
                title="Sort sequence in chronological order of recording date and timestamp"
              >
                Chronological
              </button>

              {timelineClips.length > 0 && (
                <button
                  onClick={clearClips}
                  className="p-1 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 border border-transparent hover:border-rose-500/30 rounded-lg text-xs transition-colors cursor-pointer ml-1"
                  title="Clear timeline"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Master Sequence Controls: Silence Gap, Normalization, Micro-fades */}
          <div className="px-5 py-2.5 bg-slate-900/40 border-b border-slate-800/80 flex items-center justify-between gap-3 flex-wrap text-xs">
            {/* Silence gap slider */}
            <div className="flex items-center gap-2 bg-slate-900/90 border border-slate-800 rounded-xl px-3 py-1">
              <Clock size={13} className="text-indigo-400" />
              <span className="text-[11px] text-slate-400">Inter-Clip Silence:</span>
              <input
                type="range"
                min="0.0"
                max="1.5"
                step="0.05"
                value={gapSeconds}
                onChange={e => setGapSeconds(parseFloat(e.target.value))}
                className="w-20 accent-indigo-500 cursor-pointer"
              />
              <span className="font-mono text-white text-[11px] font-bold w-10 text-right">
                {gapSeconds.toFixed(2)}s
              </span>
            </div>

            {/* Loudness & Micro-fades toggles */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setNormalizeAudio(!normalizeAudio)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                  normalizeAudio
                    ? 'bg-indigo-950/70 border-indigo-500/60 text-indigo-300 shadow-sm'
                    : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-400'
                }`}
                title="Level all clips with broadcast gain matching (~-16 LUFS / -1.0 dB True Peak)"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${normalizeAudio ? 'bg-indigo-400 animate-pulse' : 'bg-slate-600'}`} />
                <span>Norm (~-16 LUFS)</span>
              </button>

              <button
                type="button"
                onClick={() => setAntiClickFades(!antiClickFades)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                  antiClickFades
                    ? 'bg-emerald-950/70 border-emerald-500/60 text-emerald-300 shadow-sm'
                    : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-400'
                }`}
                title="Eliminate digital pops with 18ms raised-cosine boundary micro-fades"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${antiClickFades ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
                <span>18ms Micro-Fades</span>
              </button>
            </div>
          </div>

          {/* Timeline Cards List (Scrollable) */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {timelineClips.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-500">
                <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-3">
                  <Film size={22} />
                </div>
                <h3 className="font-bold text-slate-300 text-sm mb-1">Your Sequence Timeline is Empty</h3>
                <p className="text-xs text-slate-500 max-w-sm mb-4">
                  Select clips from the cloud catalog on the right, or click an Auto-Curate preset above to assemble an opening documentary montage.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => autoCurate('escalation', availableClips)}
                    className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer"
                  >
                    Auto-Generate Opening Montage
                  </button>
                </div>
              </div>
            ) : (
              timelineClips.map((clip, idx) => {
                const isPlayingThis = isAuditioning && currentAuditionIndex === idx;
                const isSoloPlaying = previewClipId === clip.id && isPreviewPlaying;
                const clipDur = Math.max(0.2, clip.endSec - clip.startSec);
                const isDraggingThis = draggedIdx === idx;
                const isDragOverThis = dragOverIdx === idx;

                return (
                  <div
                    key={clip.id}
                    draggable
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={e => handleDragOver(e, idx)}
                    onDrop={() => handleDrop(idx)}
                    className={`p-3.5 rounded-2xl border transition-all relative ${
                      isDraggingThis
                        ? 'opacity-40 border-dashed border-indigo-500'
                        : isDragOverThis
                        ? 'border-indigo-400 bg-indigo-950/40 shadow-lg'
                        : isPlayingThis
                        ? 'bg-indigo-950/80 border-emerald-500 shadow-xl shadow-emerald-500/15 ring-2 ring-emerald-500/30'
                        : 'bg-slate-900/90 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {/* Top Row: Reorder grip, Rank, Category, Speaker, Controls */}
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="cursor-grab active:cursor-grabbing text-slate-500 hover:text-slate-300" title="Drag to reorder">
                          <GripVertical size={14} />
                        </span>
                        <span className="w-5 h-5 rounded-md bg-slate-800 text-slate-200 font-mono text-[11px] font-bold flex items-center justify-center border border-slate-700">
                          {idx + 1}
                        </span>
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                          {clip.category || 'Archival Quote'}
                        </span>
                        <span className="text-xs font-bold text-slate-200 truncate max-w-[140px]">
                          {clip.speaker}
                        </span>
                      </div>

                      <div className="flex items-center gap-1">
                        {/* Play solo preview */}
                        <button
                          onClick={() => playSoloPreview(clip)}
                          className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                            isSoloPlaying
                              ? 'bg-amber-500 text-slate-950 border-amber-400'
                              : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border-slate-700'
                          }`}
                          title="Audition single clip slice"
                        >
                          {isSoloPlaying ? <Pause size={12} /> : <Play size={12} />}
                        </button>

                        {/* Move Up/Down */}
                        <button
                          onClick={() => moveClip(clip.id, 'up')}
                          disabled={idx === 0}
                          className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white disabled:opacity-20 cursor-pointer"
                          title="Move earlier"
                        >
                          <ArrowUp size={12} />
                        </button>
                        <button
                          onClick={() => moveClip(clip.id, 'down')}
                          disabled={idx === timelineClips.length - 1}
                          className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white disabled:opacity-20 cursor-pointer"
                          title="Move later"
                        >
                          <ArrowDown size={12} />
                        </button>

                        {/* Exclude / Blacklist toggle */}
                        <button
                          onClick={() => toggleBlacklist(clip.quoteId || clip.id)}
                          className={`p-1 rounded-lg text-xs transition-colors cursor-pointer ${
                            isBlacklisted(clip.quoteId || clip.id)
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              : 'hover:bg-slate-800 text-slate-400 hover:text-rose-400'
                          }`}
                          title="Toggle Exclude from Montage (blacklist quote)"
                        >
                          <ShieldAlert size={12} />
                        </button>

                        {/* Delete */}
                        <button
                          onClick={() => removeClip(clip.id)}
                          className="p-1 rounded-lg hover:bg-rose-950/50 text-slate-400 hover:text-rose-400 cursor-pointer transition-colors"
                          title="Remove from sequence"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </div>

                    {/* Quote text */}
                    <p className="text-xs text-slate-300 italic font-medium leading-relaxed mb-3 line-clamp-3">
                      "{clip.quote}"
                    </p>

                    {/* Boundary Micro-Trim & Nudge Controls */}
                    <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
                      {/* Start Nudge */}
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-slate-500 uppercase">In:</span>
                        <span className="text-slate-300 font-bold mr-1">{clip.startSec.toFixed(1)}s</span>
                        <div className="inline-flex rounded-md shadow-sm">
                          <button
                            onClick={() => nudgeClipStart(clip.id, -0.5)}
                            className="px-1 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] rounded-l border border-slate-700 cursor-pointer"
                            title="Expand start by 0.5s"
                          >
                            -0.5s
                          </button>
                          <button
                            onClick={() => nudgeClipStart(clip.id, -0.1)}
                            className="px-1 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] border-t border-b border-slate-700 cursor-pointer"
                            title="Expand start by 0.1s"
                          >
                            -0.1s
                          </button>
                          <button
                            onClick={() => nudgeClipStart(clip.id, 0.1)}
                            className="px-1 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] border-t border-b border-slate-700 cursor-pointer"
                            title="Trim start by 0.1s"
                          >
                            +0.1s
                          </button>
                          <button
                            onClick={() => nudgeClipStart(clip.id, 0.5)}
                            className="px-1 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] rounded-r border border-slate-700 cursor-pointer"
                            title="Trim start by 0.5s"
                          >
                            +0.5s
                          </button>
                        </div>
                      </div>

                      {/* End Nudge */}
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-slate-500 uppercase">Out:</span>
                        <span className="text-slate-300 font-bold mr-1">{clip.endSec.toFixed(1)}s</span>
                        <div className="inline-flex rounded-md shadow-sm">
                          <button
                            onClick={() => nudgeClipEnd(clip.id, -0.5)}
                            className="px-1 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] rounded-l border border-slate-700 cursor-pointer"
                            title="Trim end by 0.5s"
                          >
                            -0.5s
                          </button>
                          <button
                            onClick={() => nudgeClipEnd(clip.id, -0.1)}
                            className="px-1 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] border-t border-b border-slate-700 cursor-pointer"
                            title="Trim end by 0.1s"
                          >
                            -0.1s
                          </button>
                          <button
                            onClick={() => nudgeClipEnd(clip.id, 0.1)}
                            className="px-1 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] border-t border-b border-slate-700 cursor-pointer"
                            title="Expand end by 0.1s"
                          >
                            +0.1s
                          </button>
                          <button
                            onClick={() => nudgeClipEnd(clip.id, 0.5)}
                            className="px-1 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] rounded-r border border-slate-700 cursor-pointer"
                            title="Expand end by 0.5s"
                          >
                            +0.5s
                          </button>
                        </div>
                      </div>

                      <div className="text-indigo-400 font-bold text-[11px]">
                        Len: {clipDur.toFixed(1)}s
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Master Audition & Export Action Bar */}
          <div className="px-5 py-3.5 bg-slate-900/90 border-t border-slate-800/80 flex items-center justify-between gap-3 flex-wrap text-xs">
            {/* Audition Player */}
            <div className="flex items-center gap-2">
              <button
                onClick={isAuditioning ? stopAudition : startAudition}
                disabled={timelineClips.length === 0}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl font-bold shadow-lg transition-all cursor-pointer disabled:opacity-30 ${
                  isAuditioning
                    ? 'bg-amber-500 text-slate-950 shadow-amber-500/20'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20'
                }`}
              >
                {isAuditioning ? <Pause size={14} /> : <Play size={14} />}
                <span>{isAuditioning ? 'Pause Audition' : 'Audition Sequence'}</span>
              </button>

              {isAuditioning && (
                <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-xl border border-slate-800">
                  <button
                    onClick={() => skipAudition(Math.max(0, currentAuditionIndex - 1))}
                    disabled={currentAuditionIndex === 0}
                    className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-20 cursor-pointer"
                  >
                    <SkipBack size={12} />
                  </button>
                  <span className="font-mono text-emerald-400 font-bold text-xs">
                    #{currentAuditionIndex + 1}/{timelineClips.length}
                  </span>
                  <button
                    onClick={() => skipAudition(Math.min(timelineClips.length - 1, currentAuditionIndex + 1))}
                    disabled={currentAuditionIndex >= timelineClips.length - 1}
                    className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-20 cursor-pointer"
                  >
                    <SkipForward size={12} />
                  </button>
                </div>
              )}
            </div>

            {/* Master Export Buttons */}
            <div className="flex items-center gap-2">
              {isExporting ? (
                <div className="flex items-center gap-2 text-indigo-400 font-medium">
                  <Loader2 size={15} className="animate-spin" />
                  <span>{exportProgress}</span>
                </div>
              ) : (
                <>
                  <button
                    onClick={exportStitchedWav}
                    disabled={timelineClips.length === 0}
                    className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-xl font-bold shadow-lg shadow-indigo-600/30 cursor-pointer transition-all active:scale-95 disabled:opacity-40"
                    title="Render master broadcast WAV file with -16 LUFS loudness matching"
                  >
                    <Download size={13} />
                    <span>Export Stitched WAV</span>
                  </button>

                  <button
                    onClick={exportAudacityLabels}
                    disabled={timelineClips.length === 0}
                    className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-xl border border-slate-700 font-semibold cursor-pointer transition-colors disabled:opacity-40"
                    title="Export Audacity / DAW label track marker file"
                  >
                    <FileText size={13} className="text-amber-400" />
                    <span>Audacity Labels</span>
                  </button>

                  <button
                    onClick={exportManifestJson}
                    disabled={timelineClips.length === 0}
                    className="px-2.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl border border-slate-700 font-semibold cursor-pointer transition-colors disabled:opacity-40"
                    title="Export JSON recipe"
                  >
                    <span>JSON</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </section>

        {/* ── RIGHT PANE: CLOUD CLIP BROWSER & PLAYER ── */}
        <section className="w-full lg:w-[52%] flex flex-col bg-slate-950/80 min-h-0">
          {/* Browser Header & Search */}
          <div className="p-4 border-b border-slate-800 bg-slate-900/40 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Radio size={16} className="text-indigo-400" />
                <h2 className="font-bold text-white text-sm">Cloud Clip Library</h2>
                <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-mono text-[11px]">
                  {filteredClips.length} available
                </span>
              </div>

              {/* Status filter tabs */}
              <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-[11px]">
                <button
                  onClick={() => setSelectedStatusFilter('ALL')}
                  className={`px-2.5 py-0.5 rounded-lg font-medium cursor-pointer transition-colors ${
                    selectedStatusFilter === 'ALL' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  All Status
                </button>
                <button
                  onClick={() => setSelectedStatusFilter('EXISTS')}
                  className={`px-2 py-0.5 rounded-lg font-medium cursor-pointer transition-colors ${
                    selectedStatusFilter === 'EXISTS' ? 'bg-emerald-600/30 text-emerald-300 font-bold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  EXISTS
                </button>
                <button
                  onClick={() => setSelectedStatusFilter('READY_FOR_EXTRACTION')}
                  className={`px-2 py-0.5 rounded-lg font-medium cursor-pointer transition-colors ${
                    selectedStatusFilter === 'READY_FOR_EXTRACTION' ? 'bg-cyan-600/30 text-cyan-300 font-bold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  READY
                </button>
              </div>
            </div>

            {/* Search Bar */}
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
              <input
                type="text"
                placeholder="Search transcripts, speakers, quote IDs (e.g. D02, R02, AQ-0002), or keywords…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-8 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Category Filter Pills & Blacklist Toggle */}
            <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
              <div className="flex items-center gap-1.5 flex-wrap">
                {[
                  { id: 'ALL', label: 'All Categories' },
                  { id: 'allegations', label: 'Direct Allegations' },
                  { id: 'retaliation', label: 'Retaliation & Disclosures' },
                  { id: 'evidence', label: 'Evidence & Archives' },
                  { id: 'humor', label: 'Humor & Banter' },
                ].map(c => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCategory(c.id)}
                    className={`px-2.5 py-1 rounded-xl text-[11px] font-semibold border transition-all cursor-pointer ${
                      selectedCategory === c.id
                        ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                        : 'bg-slate-900 text-slate-400 hover:text-slate-200 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>

              {/* Hide blacklisted toggle */}
              <button
                type="button"
                onClick={() => setHideBlacklisted(!hideBlacklisted)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-semibold border transition-all cursor-pointer ${
                  hideBlacklisted
                    ? 'bg-rose-950/60 border-rose-500/50 text-rose-300'
                    : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-400'
                }`}
              >
                <ShieldAlert size={12} />
                <span>Hide Excluded ({blacklistedQuoteIds.length})</span>
              </button>
            </div>
          </div>

          {/* Cloud Clips Grid / List (Scrollable) */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
            {loadingClips ? (
              <div className="h-64 flex flex-col items-center justify-center text-slate-400">
                <Loader2 className="w-7 h-7 text-indigo-400 animate-spin mb-2" />
                <span className="text-xs">Loading cloud clips catalog…</span>
              </div>
            ) : filteredClips.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-center p-8 text-slate-500">
                <Search size={24} className="text-slate-600 mb-2" />
                <p className="text-xs">No clips match your search query and filters.</p>
              </div>
            ) : (
              filteredClips.map(clip => {
                const isHardExcluded = clip.quote && clip.quote.toLowerCase().includes(HARD_EXCLUDE_PHRASE.toLowerCase());
                const isExcluded = isHardExcluded || isBlacklisted(clip.quoteId || '') || isBlacklisted(clip.id) || isBlacklisted(clip.quote);
                const isAlreadyInTimeline = timelineClips.some(c => c.id === clip.id || (clip.quote && c.quote === clip.quote));
                const isSoloPlaying = previewClipId === clip.id && isPreviewPlaying;
                const hasFailed = failedAudioUrls[clip.id];

                return (
                  <div
                    key={clip.id}
                    className={`p-4 rounded-2xl border transition-all ${
                      isExcluded
                        ? 'bg-rose-950/20 border-rose-500/30'
                        : isAlreadyInTimeline
                        ? 'bg-slate-900/60 border-indigo-500/30'
                        : 'bg-slate-900/90 border-slate-800/90 hover:border-slate-700'
                    }`}
                  >
                    {/* Hard Exclude Editorial Alert if present */}
                    {isHardExcluded && (
                      <div className="mb-2.5 px-3 py-1.5 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center gap-2 text-rose-300 text-xs font-semibold">
                        <AlertTriangle size={14} className="flex-shrink-0" />
                        <span>MANDATORY EXCLUSION: Strictly excluded from montage sequences by Editorial Charter.</span>
                      </div>
                    )}

                    {/* Header */}
                    <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        {clip.quoteId && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-indigo-300 font-mono text-[10px] font-bold border border-slate-700">
                            {clip.quoteId}
                          </span>
                        )}
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                          {clip.category || 'Excerpt'}
                        </span>
                        <span className="text-xs font-bold text-white">
                          {clip.speaker}
                        </span>
                      </div>

                      {/* Status Badges */}
                      <div className="flex items-center gap-1.5">
                        {clip.status === 'EXISTS' && (
                          <span className="px-2 py-0.5 rounded-md text-[9px] font-bold uppercase bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" title="Asset exists in cloud release library">
                            EXISTS
                          </span>
                        )}
                        {clip.status === 'READY_FOR_EXTRACTION' && (
                          <span className="px-2 py-0.5 rounded-md text-[9px] font-bold uppercase bg-cyan-500/15 text-cyan-300 border border-cyan-500/30" title="Timecode boundaries aligned for cloud slicing">
                            READY
                          </span>
                        )}
                        {clip.status === 'SOURCE_NOT_AVAILABLE' && (
                          <span className="px-2 py-0.5 rounded-md text-[9px] font-bold uppercase bg-rose-500/15 text-rose-300 border border-rose-500/30" title="Source recording outside available archive pool">
                            SOURCE NOT AVAILABLE
                          </span>
                        )}
                        {isExcluded && (
                          <span className="px-2 py-0.5 rounded-md text-[9px] font-bold uppercase bg-rose-500/20 text-rose-400 border border-rose-500/40">
                            EXCLUDED
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Quote Text */}
                    <p className="text-xs text-slate-200 leading-relaxed italic mb-3 font-medium">
                      "{clip.quote}"
                    </p>

                    {/* Footer: Source Space, Duration, Actions */}
                    <div className="pt-2.5 border-t border-slate-800/80 flex items-center justify-between gap-3 flex-wrap text-xs">
                      <div className="text-[11px] text-slate-400 truncate max-w-[240px]">
                        <span className="text-slate-500">Source:</span> {clip.sourceTitle}
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Instant streaming playback button */}
                        {clip.audioUrl ? (
                          <button
                            onClick={() => playSoloPreview(clip)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                              isSoloPlaying
                                ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-md'
                                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                            }`}
                            title="Stream preview directly from cloud storage"
                          >
                            {isSoloPlaying ? <Pause size={12} /> : <Play size={12} />}
                            <span>{isSoloPlaying ? 'Pause' : 'Stream'}</span>
                          </button>
                        ) : hasFailed ? (
                          <span className="px-2 py-1 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30 text-[10px] font-semibold">
                            Stream Offline
                          </span>
                        ) : null}

                        {/* Blacklist toggle button */}
                        {!isHardExcluded && (
                          <button
                            onClick={() => toggleBlacklist(clip.quoteId || clip.id)}
                            className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                              isExcluded
                                ? 'bg-rose-500/20 text-rose-300 border-rose-500/30 hover:bg-rose-500/30'
                                : 'bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-rose-300 border-slate-700'
                            }`}
                            title="Exclude quote from automatic montage sequences"
                          >
                            {isExcluded ? 'Include' : 'Exclude'}
                          </button>
                        )}

                        {/* Add to timeline button */}
                        <button
                          onClick={() => addClip(clip)}
                          disabled={isHardExcluded || isAlreadyInTimeline}
                          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer ${
                            isAlreadyInTimeline
                              ? 'bg-slate-800 text-slate-400 border border-slate-700 cursor-not-allowed'
                              : isHardExcluded
                              ? 'bg-rose-950/40 text-slate-500 border border-rose-900/30 cursor-not-allowed'
                              : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/20'
                          }`}
                        >
                          {isAlreadyInTimeline ? (
                            <>
                              <Check size={12} />
                              <span>Added</span>
                            </>
                          ) : (
                            <>
                              <Plus size={12} />
                              <span>+ Add to Reel</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default MontageStudio;
