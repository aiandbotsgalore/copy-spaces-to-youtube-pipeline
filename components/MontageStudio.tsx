import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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
  GripVertical,
  Lock,
  Unlock,
  Wand2,
  Undo2,
  Redo2,
} from 'lucide-react';
import { useMontage, MontageClipItem, HARD_EXCLUDE_PHRASE, AutoCuratorMode, DIRECTOR_LAST_PROMPT_KEY } from '../contexts/MontageContext';
import { EnhancedConfig } from '../types';
import { PromptDirector } from './PromptDirector';
import { TensionArc } from './TensionArc';
import { Splitter } from './Splitter';
import { TargetWindowGauge } from './TargetWindowGauge';
import { VisualWaveformTrim } from './VisualWaveformTrim';
import { SilenceGapBlock } from './SilenceGapBlock';
import { FloatingTransportBar } from './FloatingTransportBar';
import { buildSequencePlan } from '../utils/sequencePlan';
import { categoryDotClass } from '../utils/uiTokens';
import { probeFileDuration, reconcileWindow } from '../utils/clipProbe';
import { SORT_MAX_CLIPS, SORT_MIN_CLIPS, applySortOrder, buildSortItems, orderChangesTimeline } from '../utils/aiSort';
import { callSortClips } from '../utils/directorClient';

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
  speaker?: string;
  quote_id?: string;
  category?: string;
  duration?: number;
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

const STUDIO_LAYOUT_KEY = 'spacepipe_studio_layout_v1';
const DIRECTOR_MIN_PX = 44;
interface StudioLayout {
  leftPct: number;
  directorPx: number;
}
const DEFAULT_LAYOUT: StudioLayout = { leftPct: 48, directorPx: 200 };
function loadStudioLayout(): StudioLayout {
  try {
    const p = JSON.parse(localStorage.getItem(STUDIO_LAYOUT_KEY) || 'null');
    const left = Number(p?.leftPct);
    const dir = Number(p?.directorPx);
    return {
      leftPct: Number.isFinite(left) ? Math.min(75, Math.max(25, left)) : DEFAULT_LAYOUT.leftPct,
      directorPx: Number.isFinite(dir) ? Math.max(DIRECTOR_MIN_PX, dir) : DEFAULT_LAYOUT.directorPx,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
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
    setClipGap,
    toggleClipLock,
    resetClipTrim,
    updateClip,
    undo,
    redo,
    canUndo,
    canRedo,
    insertClipAt,
    unverifiableClipIds,
    auditionStatus,
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
    auditionProgress,
    startAudition,
    stopAudition,
    skipAudition,
    replaceClips,
    exportStitchedWav,
    exportManifestJson,
    exportAudacityLabels,
    isExporting,
    exportProgress,
  } = useMontage();

  // Resizable layout (persisted): left/right pane split and the Director panel height
  const [layout, setLayout] = useState<StudioLayout>(loadStudioLayout);
  const [isDesktop, setIsDesktop] = useState(() => (typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)').matches : true));
  const splitRowRef = useRef<HTMLDivElement | null>(null);
  const leftPaneRef = useRef<HTMLElement | null>(null);
  const directorRegionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const on = () => setIsDesktop(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STUDIO_LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      /* storage unavailable or full: layout simply is not remembered */
    }
  }, [layout]);

  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  /** Largest Director height that still leaves room for the arc, at least one card and the action bar. */
  const maxDirectorPx = () => {
    const left = leftPaneRef.current?.getBoundingClientRect();
    const region = directorRegionRef.current?.getBoundingClientRect();
    if (!left || !region) return 900;
    return Math.max(DIRECTOR_MIN_PX, left.bottom - region.top - 320);
  };
  const setDirectorPx = (px: number) => setLayout(l => ({ ...l, directorPx: Math.round(clamp(px, DIRECTOR_MIN_PX, maxDirectorPx())) }));
  const setLeftPct = (pct: number) => setLayout(l => ({ ...l, leftPct: Math.round(clamp(pct, 25, 75) * 10) / 10 }));

  // Keep the Director height valid when the window shrinks.
  useEffect(() => {
    const on = () => setLayout(l => (l.directorPx > maxDirectorPx() ? { ...l, directorPx: Math.round(maxDirectorPx()) } : l));
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

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
              // No real window in the audit file: the 0-30 default is a placeholder, resolved to the whole file once probed.
              windowPlaceholder: item.start_seconds == null && item.end_seconds == null,
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
              const clipDur = m.duration || 30;
              combined.push({
                id: `man_${m.id}`,
                title: m.title,
                quote: m.quote,
                speaker: m.speaker || 'Angela Maggard',
                sourceTitle: m.space_title || 'Twitter Space Archive',
                sourceTag: m.space_tag,
                sourceDate: m.space_tag?.startsWith('2026') ? m.space_tag.slice(0, 8).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : '2026-09-18',
                audioUrl: m.url || `clips/angela/${m.filename}`,
                startSec: 0,
                endSec: clipDur,
                sourceDurationSec: m.duration,
                windowPlaceholder: !m.duration,
                windowVerified: !!m.duration,
                category: m.category || (m.title.toLowerCase().includes('predator') || m.title.toLowerCase().includes('abuse') ? 'Direct Allegation' : 'Retaliation & Disclosure'),
                severity: 8,
                quoteId: m.quote_id,
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

  // Auto-reconcile timeline clips if newly extracted master audio assets became available
  useEffect(() => {
    if (availableClips.length === 0 || timelineClips.length === 0) return;
    const availMap = new Map<string, MontageClipItem>(availableClips.map(c => [c.id, c]));
    let changed = false;
    const updated = timelineClips.map(tc => {
      const avail = availMap.get(tc.id);
      if (avail && avail.audioUrl && (avail.audioUrl !== tc.audioUrl || tc.status === 'READY_FOR_EXTRACTION')) {
        changed = true;
        return {
          ...tc,
          audioUrl: avail.audioUrl,
          startSec: avail.startSec,
          endSec: avail.endSec,
          status: avail.status,
          windowPlaceholder: avail.windowPlaceholder,
        };
      }
      return tc;
    });
    if (changed) {
      replaceClips(updated);
    }
  }, [availableClips, timelineClips, replaceClips]);

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
  const plan = useMemo(() => buildSequencePlan<MontageClipItem>(timelineClips, gapSeconds), [timelineClips, gapSeconds]);
  const cumulativeSec = plan.totalSec;
  const runtimeMins = Math.floor(cumulativeSec / 60);
  const runtimeSecs = Math.round(cumulativeSec % 60);
  const formattedRuntime = `${runtimeMins}:${runtimeSecs.toString().padStart(2, '0')}`;

  // Visual Duration Gauge metrics
  const durationPct = targetDurationSec > 0 ? (cumulativeSec / targetDurationSec) * 100 : 0;
  const isOverflow = cumulativeSec > targetDurationSec;
  const overflowSec = (cumulativeSec - targetDurationSec).toFixed(1);

  // Playback handler for solo clip auditioning in browser
  const playSoloPreview = async (rawClip: MontageClipItem) => {
    let clip = rawClip;
    if (clip.audioUrl && !clip.windowVerified) {
      const dur = await probeFileDuration(clip.audioUrl);
      if (dur) clip = reconcileWindow(clip, dur);
    }
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

  // Drag and drop timeline handlers (both reordering and library clip insertion)
  const handleDragStart = (idx: number) => {
    setDraggedIdx(idx);
  };

  const handleTimelineDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('application/spacepipe-clip')) {
      e.dataTransfer.dropEffect = 'copy';
    } else {
      e.dataTransfer.dropEffect = 'move';
    }
    setDragOverIdx(idx);
  };

  const handleTimelineDrop = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    const clipData = e.dataTransfer.getData('application/spacepipe-clip');
    if (clipData) {
      try {
        const parsed = JSON.parse(clipData) as MontageClipItem;
        insertClipAt(parsed, targetIdx);
      } catch (err) {
        console.warn('Failed to parse dropped clip data:', err);
      }
    } else if (draggedIdx !== null && draggedIdx !== targetIdx) {
      reorderClips(draggedIdx, targetIdx);
    }
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  const handleContainerDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('application/spacepipe-clip')) {
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleContainerDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const clipData = e.dataTransfer.getData('application/spacepipe-clip');
    if (clipData) {
      try {
        const parsed = JSON.parse(clipData) as MontageClipItem;
        addClip(parsed);
      } catch (err) {
        console.warn('Failed to parse dropped clip data:', err);
      }
    }
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  // AI Sort state and execution
  const [isSorting, setIsSorting] = useState(false);
  const [sortMsg, setSortMsg] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const sortAbortRef = useRef<AbortController | null>(null);
  const clipsRef = useRef(timelineClips);
  clipsRef.current = timelineClips;

  const runAiSort = async () => {
    const movable = timelineClips.filter(c => !c.locked);
    if (movable.length < SORT_MIN_CLIPS) {
      setSortMsg({ kind: 'info', text: `Add at least ${SORT_MIN_CLIPS} unlocked clips to let the AI arrange them.` });
      return;
    }
    if (movable.length > SORT_MAX_CLIPS) {
      setSortMsg({ kind: 'info', text: `AI Sort works on up to ${SORT_MAX_CLIPS} unlocked clips at a time.` });
      return;
    }
    let theme = '';
    try {
      theme = localStorage.getItem(DIRECTOR_LAST_PROMPT_KEY) || '';
    } catch {}
    const { items, refToId } = buildSortItems(movable);
    const ctl = new AbortController();
    sortAbortRef.current = ctl;
    setIsSorting(true);
    setSortMsg(null);
    try {
      const res = await callSortClips({ items, theme: theme || undefined }, ctl.signal);
      if (res.ok === false) {
        setSortMsg(res.code === 'ABORTED' ? { kind: 'info', text: 'AI Sort cancelled.' } : { kind: 'err', text: res.message });
        return;
      }
      const idOrder = res.order.map(r => refToId[r]).filter((id): id is string => !!id);
      const latest = clipsRef.current;
      if (!orderChangesTimeline(latest, idOrder)) {
        setSortMsg({ kind: 'info', text: 'The reel is already in the order the AI would pick.' });
        return;
      }
      replaceClips(applySortOrder(latest, idOrder));
      setSortMsg({ kind: 'ok', text: res.rationale || 'Timeline sequence re-ordered by AI narrative flow.' });
    } finally {
      setIsSorting(false);
      if (sortAbortRef.current === ctl) sortAbortRef.current = null;
    }
  };

  // Keyboard navigation & transport hotkeys (Space, Shift+Space, J/K/L, Arrows)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        if (e.shiftKey) {
          const targetClip = timelineClips[currentAuditionIndex >= 0 ? currentAuditionIndex : 0];
          if (targetClip) {
            playSoloPreview(targetClip);
          }
        } else {
          if (isAuditioning) {
            stopAudition();
          } else if (timelineClips.length > 0) {
            startAudition();
          }
        }
      } else if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        if (isAuditioning) {
          stopAudition();
        } else if (timelineClips.length > 0) {
          startAudition();
        }
      } else if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (timelineClips.length > 0) {
          const prevIdx = Math.max(0, currentAuditionIndex - 1);
          skipAudition(prevIdx);
        }
      } else if (e.key === 'l' || e.key === 'L' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (timelineClips.length > 0) {
          const nextIdx = Math.min(timelineClips.length - 1, currentAuditionIndex + 1);
          skipAudition(nextIdx);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isAuditioning,
    currentAuditionIndex,
    timelineClips,
    startAudition,
    stopAudition,
    skipAudition,
  ]);

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 text-slate-200 overflow-hidden font-sans">
      {/* ── STUDIO HEADER / TOP METRICS BAR ── */}
      <header className="px-6 py-4 bg-slate-900/80 border-b border-indigo-500/20 backdrop-blur-md flex flex-wrap items-center justify-between gap-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-500/15 text-indigo-400 rounded-xl border border-indigo-500/30 shadow-lg">
            <Film size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                Montage Studio &amp; Audio Documentary Curator
              </h1>
              <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-mono text-[11px] uppercase font-bold border border-indigo-500/30">
                Studio Edition
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Cloud-native clip discovery, micro-trimming, auto-curation, and lossless master WAV export.
            </p>
          </div>
        </div>

        {/* Dynamic Target Window Fill Bar & Sequence Gauge */}
        <TargetWindowGauge
          currentDurationSec={cumulativeSec}
          targetDurationSec={targetDurationSec}
          clipCount={timelineClips.length}
          onSelectTarget={setTargetDurationSec}
        />
      </header>

      {/* ── MAIN STUDIO WORKSPACE (DUAL-PANE LAYOUT) ── */}
      <div ref={splitRowRef} className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
        {/* ── LEFT PANE: INTERACTIVE TIMELINE STUDIO ── */}
        <section
          ref={leftPaneRef}
          style={isDesktop ? { width: `${layout.leftPct}%` } : undefined}
          className="w-full lg:flex-none flex flex-col bg-slate-950 min-h-0 min-w-0"
        >
          {/* Timeline Toolbar */}
          <div className="px-5 py-3 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between gap-2 flex-wrap text-xs">
            <div className="flex items-center gap-2">
              <Layers size={15} className="text-indigo-400" />
              <h2 className="font-bold text-white text-sm">Sequence Timeline</h2>
              <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono text-[11px]">
                {timelineClips.length}
              </span>
            </div>

            {/* Toolbar Actions: Undo, Redo, AI Sort, Auto-Curator dropdown / triggers */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {/* Undo & Redo */}
              <div className="flex items-center gap-0.5 border-r border-slate-800 pr-1.5 mr-1">
                <button
                  onClick={undo}
                  disabled={!canUndo}
                  className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white disabled:opacity-20 transition-colors cursor-pointer"
                  title="Undo last change"
                >
                  <Undo2 size={13} />
                </button>
                <button
                  onClick={redo}
                  disabled={!canRedo}
                  className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white disabled:opacity-20 transition-colors cursor-pointer"
                  title="Redo change"
                >
                  <Redo2 size={13} />
                </button>
              </div>

              {/* AI Narrative Sort */}
              <button
                onClick={runAiSort}
                disabled={isSorting || timelineClips.length < SORT_MIN_CLIPS}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-gradient-to-r from-indigo-900/60 to-purple-900/60 hover:from-indigo-800 hover:to-purple-800 text-indigo-200 hover:text-white border border-indigo-500/40 rounded-lg text-[11px] font-semibold transition-all disabled:opacity-30 cursor-pointer shadow-sm mr-1"
                title={`AI Sort: Order ${timelineClips.length} clips into dramatic tension flow`}
              >
                {isSorting ? <Loader2 size={11} className="animate-spin text-indigo-400" /> : <Wand2 size={11} className="text-amber-400" />}
                <span>AI Sort</span>
              </button>

              <span className="text-[11px] text-slate-400 flex items-center gap-1 ml-1">
                <Sparkles size={12} className="text-amber-400" /> Auto-Curate:
              </span>
              <button
                onClick={() => autoCurate('escalation', availableClips)}
                className="px-2.5 py-1 bg-indigo-950/60 hover:bg-indigo-900/80 text-indigo-300 hover:text-white border border-indigo-500/30 rounded-lg text-[11px] font-semibold transition-all cursor-pointer"
                title="Curate by Dramatic Escalation: Context -> Core Allegations -> Retaliation/Disclosures"
              >
                Escalation Arc
              </button>
              <button
                onClick={() => autoCurate('target_fit', availableClips)}
                className="px-2.5 py-1 bg-indigo-950/60 hover:bg-indigo-900/80 text-indigo-300 hover:text-white border border-indigo-500/30 rounded-lg text-[11px] font-semibold transition-all cursor-pointer"
                title="Automatically fits highest-priority non-excluded clips into selected target length"
              >
                Fit {targetDurationSec}s
              </button>
              <button
                onClick={() => autoCurate('chronological', availableClips)}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 rounded-lg text-[11px] font-semibold transition-all cursor-pointer"
                title="Sort sequence in chronological order of recording date and timestamp"
              >
                Chronological
              </button>

              <button
                onClick={() => setLayout(DEFAULT_LAYOUT)}
                className="px-2 py-1 text-[11px] text-slate-400 hover:text-white border border-transparent hover:border-slate-700 rounded-lg cursor-pointer ml-1"
                title="Reset pane sizes"
              >
                Reset layout
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

          {/* AI Sort Feedback Banner */}
          {sortMsg && (
            <div
              className={`px-4 py-2 text-xs border-b flex items-center justify-between gap-2 animate-in fade-in duration-150 ${
                sortMsg.kind === 'ok'
                  ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                  : sortMsg.kind === 'err'
                  ? 'bg-rose-950/40 border-rose-500/30 text-rose-300'
                  : 'bg-indigo-950/40 border-indigo-500/30 text-indigo-300'
              }`}
            >
              <span className="leading-snug">{sortMsg.text}</span>
              <button
                onClick={() => setSortMsg(null)}
                className="text-slate-400 hover:text-white p-0.5 rounded cursor-pointer flex-shrink-0"
              >
                <X size={13} />
              </button>
            </div>
          )}

          {/* Master Sequence Controls: Silence Gap, Normalization, Micro-fades */}
          <div className="px-5 py-2.5 bg-slate-900/40 border-b border-slate-800/80 flex items-center justify-between gap-3 flex-wrap text-xs">
            {/* Silence gap slider */}
            <div className="flex items-center gap-2 bg-slate-900/90 border border-slate-800 rounded-lg px-3 py-1">
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
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                  normalizeAudio
                    ? 'bg-indigo-950/70 border-indigo-500/60 text-indigo-300 shadow-sm'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
                title="Level all clips with broadcast gain matching (~-16 LUFS / -1.0 dB True Peak)"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${normalizeAudio ? 'bg-indigo-400 animate-pulse' : 'bg-slate-600'}`} />
                <span>Norm (~-16 LUFS)</span>
              </button>

              <button
                type="button"
                onClick={() => setAntiClickFades(!antiClickFades)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                  antiClickFades
                    ? 'bg-emerald-950/70 border-emerald-500/60 text-emerald-300 shadow-sm'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
                title="Eliminate digital pops with 18ms raised-cosine boundary micro-fades"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${antiClickFades ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
                <span>18ms Micro-Fades</span>
              </button>
            </div>
          </div>

          {/* Director: fixed, user-resizable height with its own scroll, so it can never push the timeline out of view */}
          <div
            ref={directorRegionRef}
            className="flex-shrink-0 overflow-y-auto overscroll-contain"
            style={{ height: layout.directorPx }}
          >
            <PromptDirector pool={availableClips} filteredPool={filteredClips} />
          </div>
          <Splitter
            orientation="horizontal"
            label="Resize Director panel"
            valueNow={layout.directorPx}
            onMove={y => {
              const top = directorRegionRef.current?.getBoundingClientRect().top ?? 0;
              setDirectorPx(y - top);
            }}
            onStep={d => setDirectorPx(layout.directorPx + d)}
            onReset={() => setDirectorPx(DEFAULT_LAYOUT.directorPx)}
          />
          <div className="flex-shrink-0">
            <TensionArc
              clips={timelineClips}
              defaultGapSec={gapSeconds}
              currentIndex={currentAuditionIndex}
              isPlaying={isAuditioning}
              onSelect={i => skipAudition(i)}
            />
          </div>

          {/* Timeline Cards List (Scrollable & Drop Target) */}
          <div
            onDragOver={handleContainerDragOver}
            onDrop={handleContainerDrop}
            className="flex-1 overflow-y-auto min-h-0 p-4 space-y-3"
          >
            {timelineClips.length === 0 ? (
              <div
                onDragOver={handleContainerDragOver}
                onDrop={handleContainerDrop}
                className="min-h-[240px] flex flex-col items-center justify-center text-center p-8 text-slate-400 border-2 border-dashed border-slate-800/80 rounded-2xl"
              >
                <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-3">
                  <Film size={22} />
                </div>
                <h3 className="font-bold text-slate-300 text-sm mb-1">Your Sequence Timeline is Empty</h3>
                <p className="text-xs text-slate-400 max-w-sm mb-4">
                  Drag and drop clips from the Cloud Library on the right, or click an Auto-Curate preset above to assemble an opening documentary montage.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => autoCurate('escalation', availableClips)}
                    className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-all shadow-md cursor-pointer"
                  >
                    Auto-Generate Opening Montage
                  </button>
                </div>
              </div>
            ) : (
              timelineClips.map((clip, idx) => {
                const isPlayingThis = isAuditioning && currentAuditionIndex === idx;
                const isSoloPlaying = previewClipId === clip.id && isPreviewPlaying;
                const clipDur = plan.items[idx]?.effDur ?? Math.max(0.2, clip.endSec - clip.startSec);
                const isUnverifiable = unverifiableClipIds.includes(clip.id);
                const isDraggingThis = draggedIdx === idx;
                const isDragOverThis = dragOverIdx === idx;

                return (
                  <React.Fragment key={clip.id}>
                  <div
                    draggable
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={e => handleTimelineDragOver(e, idx)}
                    onDrop={e => handleTimelineDrop(e, idx)}
                    className={`p-3.5 rounded-xl border transition-all relative ${
                      isDraggingThis
                        ? 'opacity-40 border-dashed border-indigo-500'
                        : isDragOverThis
                        ? 'border-indigo-400 bg-indigo-950/40 shadow-lg ring-2 ring-indigo-500/40'
                        : isPlayingThis
                        ? 'bg-indigo-950/80 border-emerald-500 shadow-xl ring-2 ring-emerald-500/30'
                        : 'bg-slate-900/90 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {/* Top Row: Reorder grip, Rank, Category, Speaker, Controls */}
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-300" title="Drag to reorder">
                          <GripVertical size={14} />
                        </span>
                        <span className="w-5 h-5 rounded-md bg-slate-800 text-slate-200 font-mono text-[11px] font-bold flex items-center justify-center border border-slate-700">
                          {idx + 1}
                        </span>
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-800 text-slate-300">
                          <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${categoryDotClass(clip.category)}`} aria-hidden="true" />
                          {clip.category || 'Archival Quote'}
                        </span>
                        <span className="text-xs font-bold text-slate-200 truncate max-w-[140px]">
                          {clip.speaker}
                        </span>
                        {typeof clip.tensionScore === 'number' && (
                          <span
                            className="px-1.5 py-0.5 rounded-md text-[11px] font-mono font-bold bg-slate-800 text-slate-300"
                            title="Director tension score (1-10)"
                          >
                            T{clip.tensionScore}
                          </span>
                        )}
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

                        {/* Lock: the Director never changes a locked clip */}
                        <button
                          onClick={() => toggleClipLock(clip.id)}
                          className={`p-1 rounded-lg text-xs transition-colors cursor-pointer ${
                            clip.locked
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : 'hover:bg-slate-800 text-slate-400 hover:text-amber-300'
                          }`}
                          title={clip.locked ? 'Locked: the Director will not change this clip' : 'Lock this clip against Director edits'}
                          aria-pressed={!!clip.locked}
                        >
                          {clip.locked ? <Lock size={12} /> : <Unlock size={12} />}
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
                    {clip.directorNote && (
                      <p className="text-[11px] text-indigo-300/90 mb-2">Director: {clip.directorNote}</p>
                    )}
                    {isUnverifiable && (
                      <p className="text-[11px] text-amber-300 mb-2 flex items-center gap-1">
                        <AlertTriangle size={11} /> Audio could not be loaded (missing file or unreachable URL). It will be skipped.
                      </p>
                    )}

                    {/* Visual Waveform & Interactive Trim Scrubbing */}
                    <div className="pt-2.5 border-t border-slate-800/80">
                      <VisualWaveformTrim
                        clip={clip}
                        isPlaying={isPlayingThis}
                        playheadProgress={auditionProgress?.timelineIndex === idx ? auditionProgress.clipProgress : 0}
                        onTrimStart={(newStart) => {
                          updateClip(clip.id, {
                            startSec: newStart,
                            origStartSec: clip.origStartSec ?? clip.startSec,
                            origEndSec: clip.origEndSec ?? clip.endSec,
                            trimBasis: 'manual',
                          });
                        }}
                        onTrimEnd={(newEnd) => {
                          updateClip(clip.id, {
                            endSec: newEnd,
                            origStartSec: clip.origStartSec ?? clip.startSec,
                            origEndSec: clip.origEndSec ?? clip.endSec,
                            trimBasis: 'manual',
                          });
                        }}
                        onResetTrim={() => resetClipTrim(clip.id)}
                        onSeekPreview={(timeSec) => {
                          if (previewAudioRef.current && previewClipId === clip.id) {
                            previewAudioRef.current.currentTime = timeSec;
                          }
                        }}
                      />
                    </div>
                  </div>
                  {idx < timelineClips.length - 1 && (
                    <SilenceGapBlock
                      gapSec={plan.items[idx]?.gapAfter ?? gapSeconds}
                      isCustom={clip.gapAfterSec !== undefined}
                      defaultGapSec={gapSeconds}
                      onSetGap={(g) => setClipGap(clip.id, g)}
                    />
                  )}
                  </React.Fragment>
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
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg font-bold shadow-lg transition-all cursor-pointer disabled:opacity-30 ${
                  isAuditioning
                    ? 'bg-amber-500 text-slate-950'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
              >
                {isAuditioning ? <Pause size={14} /> : <Play size={14} />}
                <span>{isAuditioning ? 'Pause Audition' : 'Audition Sequence'}</span>
              </button>

              {auditionStatus && <span className="text-[11px] text-amber-300 max-w-[220px] truncate" title={auditionStatus}>{auditionStatus}</span>}
              {isAuditioning && (
                <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-lg border border-slate-800">
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
                    className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold shadow-lg cursor-pointer transition-all active:scale-95 disabled:opacity-40"
                    title="Render master broadcast WAV file with -16 LUFS loudness matching"
                  >
                    <Download size={13} />
                    <span>Export Stitched WAV</span>
                  </button>

                  <button
                    onClick={exportAudacityLabels}
                    disabled={timelineClips.length === 0}
                    className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg border border-slate-700 font-semibold cursor-pointer transition-colors disabled:opacity-40"
                    title="Export Audacity / DAW label track marker file"
                  >
                    <FileText size={13} className="text-amber-400" />
                    <span>Audacity Labels</span>
                  </button>

                  <button
                    onClick={exportManifestJson}
                    disabled={timelineClips.length === 0}
                    className="px-2.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg border border-slate-700 font-semibold cursor-pointer transition-colors disabled:opacity-40"
                    title="Export JSON recipe"
                  >
                    <span>JSON</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </section>

        {isDesktop && (
          <Splitter
            orientation="vertical"
            label="Resize timeline and library panes"
            valueNow={layout.leftPct}
            onMove={x => {
              const r = splitRowRef.current?.getBoundingClientRect();
              if (r && r.width > 0) setLeftPct(((x - r.left) / r.width) * 100);
            }}
            onStep={d => {
              const r = splitRowRef.current?.getBoundingClientRect();
              if (r && r.width > 0) setLeftPct(layout.leftPct + (d / r.width) * 100);
            }}
            onReset={() => setLeftPct(DEFAULT_LAYOUT.leftPct)}
          />
        )}

        {/* ── RIGHT PANE: CLOUD CLIP BROWSER & PLAYER ── */}
        <section className="w-full lg:flex-1 lg:min-w-0 flex flex-col bg-slate-950/80 min-h-0">
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
                    selectedStatusFilter === 'READY_FOR_EXTRACTION' ? 'bg-slate-600/30 text-slate-300 font-bold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  READY
                </button>
              </div>
            </div>

            {/* Search Bar */}
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
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
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer ${
                  hideBlacklisted
                    ? 'bg-rose-950/60 border-rose-500/50 text-rose-300'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
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
              <div className="h-64 flex flex-col items-center justify-center text-center p-8 text-slate-400">
                <Search size={24} className="text-slate-500 mb-2" />
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
                    draggable={!isHardExcluded}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/spacepipe-clip', JSON.stringify(clip));
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    className={`p-4 rounded-xl border transition-all ${
                      !isHardExcluded ? 'cursor-grab active:cursor-grabbing' : ''
                    } ${
                      isExcluded
                        ? 'bg-rose-950/20 border-rose-500/30'
                        : isAlreadyInTimeline
                        ? 'bg-slate-900/60 border-indigo-500/30'
                        : 'bg-slate-900/90 border-slate-800/90 hover:border-slate-700'
                    }`}
                  >
                    {/* Hard Exclude Editorial Alert if present */}
                    {isHardExcluded && (
                      <div className="mb-2.5 px-3 py-1.5 rounded-lg bg-rose-500/15 border border-rose-500/30 flex items-center gap-2 text-rose-300 text-xs font-semibold">
                        <AlertTriangle size={14} className="flex-shrink-0" />
                        <span>MANDATORY EXCLUSION: Strictly excluded from montage sequences by Editorial Charter.</span>
                      </div>
                    )}

                    {/* Header */}
                    <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        {clip.quoteId && (
                          <span className="font-mono text-[11px] text-slate-400">
                            {clip.quoteId}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-800 text-slate-300">
                          <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${categoryDotClass(clip.category)}`} aria-hidden="true" />
                          {clip.category || 'Excerpt'}
                        </span>
                        <span className="text-xs text-slate-400">
                          {clip.speaker}
                        </span>
                      </div>

                      {/* Status Badges */}
                      <div className="flex items-center gap-1.5">
                        {clip.status === 'EXISTS' && (
                          <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400" title="Asset exists in cloud release library">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                            In library
                          </span>
                        )}
                        {clip.status === 'READY_FOR_EXTRACTION' && (
                          <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400" title="Timecode boundaries aligned for cloud slicing">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-500" aria-hidden="true" />
                            Ready to extract
                          </span>
                        )}
                        {clip.status === 'SOURCE_NOT_AVAILABLE' && (
                          <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400" title="Source recording outside available archive pool">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" aria-hidden="true" />
                            Source not available
                          </span>
                        )}
                        {isExcluded && (
                          <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" aria-hidden="true" />
                            Excluded
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Quote Text */}
                    <p className="text-sm text-slate-100 leading-relaxed mb-3">
                      &ldquo;{clip.quote}&rdquo;
                    </p>

                    {/* Footer: Source Space, Duration, Actions */}
                    <div className="pt-2.5 border-t border-slate-800/80 flex items-center justify-between gap-3 flex-wrap text-xs">
                      <div className="text-[11px] text-slate-400 truncate max-w-[240px]">
                        <span className="text-slate-400">Source:</span> {clip.sourceTitle}
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Instant streaming playback button */}
                        {clip.audioUrl ? (
                          <button
                            onClick={() => playSoloPreview(clip)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                              isSoloPlaying
                                ? 'bg-indigo-600 text-white border-indigo-500'
                                : 'bg-transparent hover:bg-slate-800 text-slate-300 border-transparent'
                            }`}
                            title="Stream preview directly from cloud storage"
                          >
                            {isSoloPlaying ? <Pause size={12} /> : <Play size={12} />}
                            <span>{isSoloPlaying ? 'Pause' : 'Stream'}</span>
                          </button>
                        ) : hasFailed ? (
                          <span className="px-2 py-1 rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30 text-[11px] font-semibold">
                            Stream Offline
                          </span>
                        ) : null}

                        {/* Blacklist toggle button */}
                        {!isHardExcluded && (
                          <button
                            onClick={() => toggleBlacklist(clip.quoteId || clip.id)}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                              isExcluded
                                ? 'bg-transparent text-rose-300 border-rose-500/40 hover:bg-rose-500/10'
                                : 'bg-transparent hover:bg-slate-800 text-slate-300 hover:text-rose-300 border-transparent'
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
                          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm cursor-pointer ${
                            isAlreadyInTimeline
                              ? 'bg-transparent text-emerald-400 border border-slate-800 cursor-not-allowed'
                              : isHardExcluded
                              ? 'bg-rose-950/40 text-slate-400 border border-rose-900/30 cursor-not-allowed'
                              : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                          }`}
                        >
                          {isAlreadyInTimeline ? (
                            <>
                              <Check size={12} />
                              <span>In reel</span>
                            </>
                          ) : (
                            <>
                              <Plus size={12} />
                              <span>Add to reel</span>
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

      {/* ── FLOATING TRANSPORT BAR & PLAYHEAD CONTROLS ── */}
      {timelineClips.length > 0 && (
        <FloatingTransportBar
          isPlaying={isAuditioning}
          currentIndex={currentAuditionIndex}
          totalClips={timelineClips.length}
          currentClipTitle={timelineClips[currentAuditionIndex]?.title || timelineClips[currentAuditionIndex]?.speaker}
          currentClipSpeaker={timelineClips[currentAuditionIndex]?.speaker}
          elapsedSec={auditionProgress?.elapsedSec ?? 0}
          totalSec={cumulativeSec}
          onTogglePlay={isAuditioning ? stopAudition : startAudition}
          onAuditionSolo={() => {
            const clip = timelineClips[currentAuditionIndex >= 0 ? currentAuditionIndex : 0];
            if (clip) playSoloPreview(clip);
          }}
          onPrev={() => skipAudition(Math.max(0, currentAuditionIndex - 1))}
          onNext={() => skipAudition(Math.min(timelineClips.length - 1, currentAuditionIndex + 1))}
          onReset={() => skipAudition(0)}
          normalizeAudio={normalizeAudio}
        />
      )}
    </div>
  );
};

export default MontageStudio;
