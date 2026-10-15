import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import { audioBufferToWav, sliceAudioBuffer, stitchAudioBuffers, normalizeBroadcastLoudness, applyAntiClickFades } from '../utils/wavEncoder';
import { getCachedAudioUrl } from '../utils/audioCache';
import { buildPlayablePlan } from '../utils/sequencePlan';
import { createSequencePlayer, getSharedAudioContext } from '../utils/sequencePlayer';
import type { SequencePlayer } from '../utils/sequencePlayer';
import { mapLimit, probeFileDuration, reconcileWindow } from '../utils/clipProbe';
import { toFetchableUrl } from '../utils/audioUrl';
import type { DirectorProvenance } from '../utils/directorTypes';

/** localStorage key holding the last natural-language prompt given to the Director (for the manifest). */
export const DIRECTOR_LAST_PROMPT_KEY = 'spacepipe_director_last_prompt_v1';
const HISTORY_DEPTH = 20;

export interface MontageClipItem {
  id: string;
  title: string;
  quote: string;
  speaker: string;
  sourceTitle: string;
  sourceTag?: string;
  sourceDate?: string;
  audioUrl?: string;
  startSec: number;
  endSec: number;
  category?: string;
  severity?: number; // 1-10
  quoteId?: string; // e.g. AQ-0002, D02, R02
  status?: 'EXISTS' | 'READY_FOR_EXTRACTION' | 'SOURCE_NOT_AVAILABLE';
  isExcluded?: boolean;
  // Trim / Director bookkeeping. All optional so previously saved timelines still load.
  origStartSec?: number;
  origEndSec?: number;
  /** Real probed duration of the audio file. */
  sourceDurationSec?: number;
  /** Original episode-relative window when the asset turned out to be a pre-cut clip (metadata only). */
  episodeStartSec?: number;
  episodeEndSec?: number;
  windowVerified?: boolean;
  /** Manifest/audit clips that only carry a placeholder window (e.g. 0-30); resolved to the whole file once probed. */
  windowPlaceholder?: boolean;
  /** Silence after this clip; falls back to the global gap when undefined. */
  gapAfterSec?: number;
  directorNote?: string;
  tensionScore?: number;
  locked?: boolean;
  trimBasis?: 'segment' | 'silence' | 'estimated' | 'manual';
  keptText?: string;
  director?: DirectorProvenance;
}

export type AutoCuratorMode = 'escalation' | 'chronological' | 'target_fit';

interface MontageContextType {
  clips: MontageClipItem[];
  isDrawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
  addClip: (clip: Omit<MontageClipItem, 'id'> & { id?: string }) => void;
  removeClip: (id: string) => void;
  moveClip: (id: string, direction: 'up' | 'down') => void;
  reorderClips: (startIndex: number, endIndex: number) => void;
  nudgeClipStart: (id: string, deltaSec: number) => void;
  nudgeClipEnd: (id: string, deltaSec: number) => void;
  clearClips: () => void;
  /** Replace the whole timeline (used by the Director). Stops audition; undoable. */
  replaceClips: (next: MontageClipItem[]) => void;
  updateClip: (id: string, patch: Partial<MontageClipItem>) => void;
  /** undefined restores the global gap for that clip. */
  setClipGap: (id: string, gapSec: number | undefined) => void;
  toggleClipLock: (id: string) => void;
  resetClipTrim: (id: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Clip ids whose audio file could not be probed (404, blocked, unreadable). */
  unverifiableClipIds: string[];
  auditionStatus: string;
  gapSeconds: number;
  setGapSeconds: (sec: number) => void;
  targetDurationSec: number;
  setTargetDurationSec: (sec: number) => void;
  normalizeAudio: boolean;
  setNormalizeAudio: (val: boolean) => void;
  antiClickFades: boolean;
  setAntiClickFades: (val: boolean) => void;
  blacklistedQuoteIds: string[];
  toggleBlacklist: (quoteIdOrText: string) => void;
  isBlacklisted: (quoteIdOrText: string) => boolean;
  autoCurate: (mode: AutoCuratorMode, availablePool: MontageClipItem[], customTargetSec?: number) => void;
  sortByEscalation?: () => void;
  isAuditioning: boolean;
  currentAuditionIndex: number;
  auditionProgress: AuditionProgress | null;
  startAudition: () => void;
  stopAudition: () => void;
  skipAudition: (index: number) => void;
  insertClipAt: (clipData: Omit<MontageClipItem, 'id'> & { id?: string }, index: number) => void;
  exportStitchedWav: () => Promise<void>;
  exportManifestJson: () => void;
  exportAudacityLabels: () => void;
  isExporting: boolean;
  exportProgress: string;
}

export interface AuditionProgress {
  timelineIndex: number;
  clipProgress: number; // 0.0 to 1.0
  elapsedSec: number;
}

const MontageContext = createContext<MontageContextType | null>(null);

const STORAGE_KEY = 'spacepipe_montage_clips_v2';
const GAP_KEY = 'spacepipe_montage_gap_v2';
const TARGET_DURATION_KEY = 'spacepipe_montage_target_dur_v2';
const NORMALIZE_KEY = 'spacepipe_montage_norm_v2';
const ANTICLICK_KEY = 'spacepipe_montage_anticlick_v2';
const BLACKLIST_KEY = 'spacepipe_montage_blacklist_v2';

// Editorial Rule: Hard exclusion string that must never appear in auto-montage sequences
export const HARD_EXCLUDE_PHRASE = 'defended him relentlessly';

/**
 * Editorial Priority & Escalation Weights:
 * 1. Background / Context (10-20)
 * 2. Core Allegations / Direct Accusations (30-40)
 * 3. Retaliation / Scorched Earth / Disclosures / Legal (50-60)
 */
export const getCategoryEscalationWeight = (cat?: string): number => {
  const c = (cat || '').toLowerCase();
  if (c.includes('retaliation') || c.includes('scorched') || c.includes('threat') || c.includes('doxx') || c.includes('lawsuit')) {
    return 60;
  }
  if (c.includes('allegation') || c.includes('predator') || c.includes('abuse') || c.includes('nude') || c.includes('criminal')) {
    return 40;
  }
  if (c.includes('evidence') || c.includes('method') || c.includes('dossier') || c.includes('archive') || c.includes('recording')) {
    return 30;
  }
  if (c.includes('friend') || c.includes('alliance') || c.includes('context') || c.includes('self-definition') || c.includes('history')) {
    return 15;
  }
  return 25;
};

export const MontageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [clips, setClips] = useState<MontageClipItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [gapSeconds, setGapSecondsState] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(GAP_KEY);
      return saved ? parseFloat(saved) : 0.35;
    } catch {
      return 0.35;
    }
  });

  const [targetDurationSec, setTargetDurationSecState] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(TARGET_DURATION_KEY);
      return saved ? parseFloat(saved) : 90;
    } catch {
      return 90;
    }
  });

  const [normalizeAudio, setNormalizeAudioState] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(NORMALIZE_KEY);
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });

  const [antiClickFades, setAntiClickFadesState] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(ANTICLICK_KEY);
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });

  const [blacklistedQuoteIds, setBlacklistedQuoteIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(BLACKLIST_KEY);
      const parsed = saved ? JSON.parse(saved) : [];
      // Always ensure the hard excluded phrase/ID is in blacklist
      if (!parsed.includes('AQ-0269')) parsed.push('AQ-0269');
      return parsed;
    } catch {
      return ['AQ-0269'];
    }
  });

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isAuditioning, setIsAuditioning] = useState(false);
  const [currentAuditionIndex, setCurrentAuditionIndex] = useState(0);
  const [auditionProgress, setAuditionProgress] = useState<AuditionProgress | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState('');

  const playerRef = useRef<SequencePlayer | null>(null);
  const [auditionStatus, setAuditionStatus] = useState('');
  const [unverifiableClipIds, setUnverifiableClipIds] = useState<string[]>([]);
  const unverifiableRef = useRef<Set<string>>(new Set());
  const probingRef = useRef<Set<string>>(new Set());

  // Undo / redo (structural history of the timeline)
  const historyRef = useRef<{ past: MontageClipItem[][]; future: MontageClipItem[][] }>({ past: [], future: [] });
  const lastClipsRef = useRef<MontageClipItem[]>(clips);
  const suppressHistoryRef = useRef(false);
  const lastPushAtRef = useRef(0);
  const [, setHistoryTick] = useState(0);

  // Save to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clips));
    } catch (e) {
      console.warn('Failed to save montage clips:', e);
    }
  }, [clips]);

  useEffect(() => {
    try {
      localStorage.setItem(BLACKLIST_KEY, JSON.stringify(blacklistedQuoteIds));
    } catch {}
  }, [blacklistedQuoteIds]);

  useEffect(() => {
    if (lastClipsRef.current === clips) return;
    if (suppressHistoryRef.current) {
      suppressHistoryRef.current = false;
      lastClipsRef.current = clips;
      return;
    }
    const h = historyRef.current;
    const now = Date.now();
    // Rapid-fire edits (nudge buttons) collapse into a single undo step.
    if (now - lastPushAtRef.current > 600 || h.past.length === 0) {
      h.past.push(lastClipsRef.current);
      if (h.past.length > HISTORY_DEPTH) h.past.shift();
    }
    lastPushAtRef.current = now;
    h.future = [];
    lastClipsRef.current = clips;
    setHistoryTick(t => t + 1);
  }, [clips]);

  // Probe real audio durations and normalise windows (also migrates older saved timelines).
  useEffect(() => {
    const pending = clips.filter(
      c => c.audioUrl && !c.windowVerified && !unverifiableRef.current.has(c.id) && !probingRef.current.has(c.id)
    );
    if (pending.length === 0) return;
    pending.forEach(c => probingRef.current.add(c.id));
    void mapLimit(pending, 4, async (c: MontageClipItem) => {
      const dur = await probeFileDuration(c.audioUrl as string);
      probingRef.current.delete(c.id);
      if (dur == null) {
        unverifiableRef.current.add(c.id);
        setUnverifiableClipIds(Array.from(unverifiableRef.current));
        return;
      }
      setClips(prev => {
        let changed = false;
        const next = prev.map(x => {
          if (x.id !== c.id || x.windowVerified) return x;
          changed = true;
          return reconcileWindow(x, dur);
        });
        if (!changed) return prev;
        suppressHistoryRef.current = true;
        return next;
      });
    });
  }, [clips]);

  const setGapSeconds = (sec: number) => {
    setGapSecondsState(sec);
    try {
      localStorage.setItem(GAP_KEY, String(sec));
    } catch {}
  };

  const setTargetDurationSec = (sec: number) => {
    setTargetDurationSecState(sec);
    try {
      localStorage.setItem(TARGET_DURATION_KEY, String(sec));
    } catch {}
  };

  const setNormalizeAudio = (val: boolean) => {
    setNormalizeAudioState(val);
    try {
      localStorage.setItem(NORMALIZE_KEY, String(val));
    } catch {}
  };

  const setAntiClickFades = (val: boolean) => {
    setAntiClickFadesState(val);
    try {
      localStorage.setItem(ANTICLICK_KEY, String(val));
    } catch {}
  };

  const toggleBlacklist = useCallback((key: string) => {
    setBlacklistedQuoteIds(prev => {
      if (prev.includes(key)) {
        return prev.filter(k => k !== key);
      } else {
        return [...prev, key];
      }
    });
  }, []);

  const isBlacklisted = useCallback((key: string) => {
    if (!key) return false;
    const lower = key.toLowerCase();
    if (lower.includes(HARD_EXCLUDE_PHRASE.toLowerCase())) return true;
    return blacklistedQuoteIds.includes(key);
  }, [blacklistedQuoteIds]);

  const openDrawer = () => setIsDrawerOpen(true);
  const closeDrawer = () => setIsDrawerOpen(false);
  const toggleDrawer = () => setIsDrawerOpen(prev => !prev);

  const addClip = useCallback((clipData: Omit<MontageClipItem, 'id'> & { id?: string }) => {
    const newId = clipData.id || `montage_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    setClips(prev => {
      // Check if duplicate ID or matching identical quote
      if (prev.some(c => c.id === newId || (clipData.quote && c.quote === clipData.quote))) {
        return prev;
      }
      return [...prev, { ...clipData, id: newId }];
    });
    setIsDrawerOpen(true);
  }, []);

  const insertClipAt = useCallback((clipData: Omit<MontageClipItem, 'id'> & { id?: string }, index: number) => {
    const newId = clipData.id || `montage_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    setClips(prev => {
      if (prev.some(c => c.id === newId || (clipData.quote && c.quote === clipData.quote))) {
        return prev;
      }
      const next = [...prev];
      const targetIdx = Math.max(0, Math.min(next.length, index));
      next.splice(targetIdx, 0, { ...clipData, id: newId });
      return next;
    });
    setIsDrawerOpen(true);
  }, []);

  const removeClip = useCallback((id: string) => {
    setClips(prev => prev.filter(c => c.id !== id));
  }, []);

  const moveClip = useCallback((id: string, direction: 'up' | 'down') => {
    setClips(prev => {
      const idx = prev.findIndex(c => c.id === id);
      if (idx === -1) return prev;
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const next = [...prev];
      const temp = next[idx];
      next[idx] = next[targetIdx];
      next[targetIdx] = temp;
      return next;
    });
  }, []);

  const reorderClips = useCallback((startIndex: number, endIndex: number) => {
    setClips(prev => {
      if (startIndex < 0 || startIndex >= prev.length || endIndex < 0 || endIndex >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [removed] = next.splice(startIndex, 1);
      next.splice(endIndex, 0, removed);
      return next;
    });
  }, []);

  // Fine-tune nudge micro-controls (+/- 0.1s and +/- 0.5s)
  const nudgeClipStart = useCallback((id: string, deltaSec: number) => {
    setClips(prev =>
      prev.map(c => {
        if (c.id !== id) return c;
        const newStart = Math.max(0, parseFloat((c.startSec + deltaSec).toFixed(2)));
        if (newStart >= c.endSec - 0.2) return c; // maintain min 0.2s duration
        return { ...c, startSec: newStart, origStartSec: c.origStartSec ?? c.startSec, origEndSec: c.origEndSec ?? c.endSec, trimBasis: 'manual' as const };
      })
    );
  }, []);

  const nudgeClipEnd = useCallback((id: string, deltaSec: number) => {
    setClips(prev =>
      prev.map(c => {
        if (c.id !== id) return c;
        const newEnd = Math.max(c.startSec + 0.2, parseFloat((c.endSec + deltaSec).toFixed(2)));
        return { ...c, endSec: newEnd, origStartSec: c.origStartSec ?? c.startSec, origEndSec: c.origEndSec ?? c.endSec, trimBasis: 'manual' as const };
      })
    );
  }, []);

  const clearClips = useCallback(() => {
    stopAudition();
    setClips([]);
  }, []);

  /**
   * Auto-Curator Modes:
   * - Dramatic Escalation: Context/Background -> Core Allegations -> Retaliation/Disclosures
   * - Chronological Arc: Sorts by source recording date and timestamp
   * - Target Duration Fit: Greedily selects highest-priority non-excluded clips to fit target window
   */
  const autoCurate = useCallback((
    mode: AutoCuratorMode,
    availablePool: MontageClipItem[],
    customTargetSec?: number
  ) => {
    stopAudition();
    const targetSec = customTargetSec || targetDurationSec;

    // Filter out blacklisted and hard-excluded clips
    const validPool = availablePool.filter(c => {
      if (c.quote && c.quote.toLowerCase().includes(HARD_EXCLUDE_PHRASE.toLowerCase())) return false;
      if (c.quoteId && isBlacklisted(c.quoteId)) return false;
      if (c.id && isBlacklisted(c.id)) return false;
      if (c.isExcluded) return false;
      return true;
    });

    if (validPool.length === 0) return;

    let selected: MontageClipItem[] = [];

    if (mode === 'escalation') {
      // Sort by narrative escalation weight, then severity
      selected = [...validPool].sort((a, b) => {
        const weightA = getCategoryEscalationWeight(a.category);
        const weightB = getCategoryEscalationWeight(b.category);
        if (weightA !== weightB) return weightA - weightB;
        return (b.severity || 5) - (a.severity || 5);
      });
    } else if (mode === 'chronological') {
      // Sort by sourceDate (YYYY-MM-DD) and startSec
      selected = [...validPool].sort((a, b) => {
        const dateA = a.sourceDate || '2026-09-01';
        const dateB = b.sourceDate || '2026-09-01';
        if (dateA !== dateB) return dateA.localeCompare(dateB);
        return a.startSec - b.startSec;
      });
    } else if (mode === 'target_fit') {
      // Prioritize high-impact consequential quotes (Direct Allegation & Retaliation)
      const ranked = [...validPool].sort((a, b) => {
        const weightA = getCategoryEscalationWeight(a.category);
        const weightB = getCategoryEscalationWeight(b.category);
        if (weightA !== weightB) return weightB - weightA;
        return (b.severity || 5) - (a.severity || 5);
      });

      // Fit into targetSec with gap buffer
      let accumulatedSec = 0;
      for (const item of ranked) {
        const dur = Math.max(0.5, item.endSec - item.startSec);
        const nextTotal = accumulatedSec + dur + (selected.length > 0 ? gapSeconds : 0);
        if (nextTotal <= targetSec + 2.0) { // allow small 2s tolerance
          selected.push(item);
          accumulatedSec = nextTotal;
        }
      }

      // Re-order selected items for a natural narrative flow (Context -> Accusation -> Retaliation)
      selected.sort((a, b) => getCategoryEscalationWeight(a.category) - getCategoryEscalationWeight(b.category));
    }

    // Set curated timeline items
    setClips(selected);
    setIsDrawerOpen(true);
  }, [gapSeconds, targetDurationSec, isBlacklisted]);

  // Audition: sample-accurate Web Audio scheduling over the same plan that export and labels use.
  const stopAudition = useCallback(() => {
    playerRef.current?.stop();
    playerRef.current = null;
    setAuditionStatus('');
    setIsAuditioning(false);
    setAuditionProgress(null);
  }, []);

  const startAuditionFrom = useCallback((timelineIndex: number) => {
    playerRef.current?.stop();
    playerRef.current = null;
    const { plan, sourceIndex } = buildPlayablePlan<MontageClipItem>(clips, gapSeconds);
    if (plan.items.length === 0) {
      setIsAuditioning(false);
      setAuditionProgress(null);
      setAuditionStatus('No clips with audio to audition.');
      return;
    }
    const planStart = sourceIndex.findIndex(si => si >= timelineIndex);
    if (planStart < 0) {
      setIsAuditioning(false);
      setAuditionProgress(null);
      return;
    }
    const player: SequencePlayer = createSequencePlayer({
      plan,
      fadeMs: antiClickFades ? 18 : 0,
      resolveUrl: async (u: string) => (await getCachedAudioUrl(u)) || u,
      callbacks: {
        onIndex: planIndex => setCurrentAuditionIndex(sourceIndex[planIndex] ?? 0),
        onProgress: (planIndex, clipProgress, elapsedSec) => {
          const tIdx = sourceIndex[planIndex] ?? 0;
          setAuditionProgress({ timelineIndex: tIdx, clipProgress, elapsedSec });
        },
        onEnd: () => {
          if (playerRef.current === player) {
            playerRef.current = null;
            setIsAuditioning(false);
            setAuditionProgress(null);
          }
        },
        onStatus: msg => setAuditionStatus(msg),
        onError: msg => setAuditionStatus(msg),
      },
    });
    playerRef.current = player;
    setAuditionStatus('');
    setCurrentAuditionIndex(sourceIndex[planStart]);
    setAuditionProgress({ timelineIndex: sourceIndex[planStart] ?? 0, clipProgress: 0, elapsedSec: 0 });
    setIsAuditioning(true);
    player.start(planStart).catch(err => {
      console.warn('Audition failed:', err);
      setAuditionStatus('Audition failed: ' + (err?.message || 'unknown error'));
      setIsAuditioning(false);
    });
  }, [clips, gapSeconds, antiClickFades]);

  const startAudition = useCallback(() => {
    if (clips.length === 0) return;
    startAuditionFrom(0);
  }, [clips, startAuditionFrom]);

  const skipAudition = useCallback((index: number) => {
    startAuditionFrom(index);
  }, [startAuditionFrom]);

  useEffect(() => {
    return () => {
      playerRef.current?.stop();
    };
  }, []);

  const replaceClips = useCallback((next: MontageClipItem[]) => {
    stopAudition();
    setClips(next);
  }, [stopAudition]);

  const updateClip = useCallback((id: string, patch: Partial<MontageClipItem>) => {
    setClips(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const setClipGap = useCallback((id: string, gapSec: number | undefined) => {
    setClips(prev =>
      prev.map(c => {
        if (c.id !== id) return c;
        if (gapSec === undefined || !Number.isFinite(gapSec)) {
          const { gapAfterSec: _drop, ...rest } = c;
          return rest as MontageClipItem;
        }
        return { ...c, gapAfterSec: Math.min(5, Math.max(0, Math.round(gapSec * 100) / 100)) };
      })
    );
  }, []);

  const toggleClipLock = useCallback((id: string) => {
    setClips(prev => prev.map(c => (c.id === id ? { ...c, locked: !c.locked } : c)));
  }, []);

  const resetClipTrim = useCallback((id: string) => {
    setClips(prev =>
      prev.map(c => {
        if (c.id !== id || c.origStartSec === undefined || c.origEndSec === undefined) return c;
        const { keptText: _k, trimBasis: _t, ...rest } = c;
        return { ...(rest as MontageClipItem), startSec: c.origStartSec, endSec: c.origEndSec };
      })
    );
  }, []);

  const undo = useCallback(() => {
    const h = historyRef.current;
    const prev = h.past.pop();
    if (!prev) return;
    stopAudition();
    h.future.push(lastClipsRef.current);
    suppressHistoryRef.current = true;
    setClips(prev);
    setHistoryTick(t => t + 1);
  }, [stopAudition]);

  const redo = useCallback(() => {
    const h = historyRef.current;
    const next = h.future.pop();
    if (!next) return;
    stopAudition();
    h.past.push(lastClipsRef.current);
    suppressHistoryRef.current = true;
    setClips(next);
    setHistoryTick(t => t + 1);
  }, [stopAudition]);

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Master WAV export via Web Audio, driven by the same plan the audition uses (per-clip trims and gaps).
  const exportStitchedWav = async () => {
    const { plan } = buildPlayablePlan<MontageClipItem>(clips, gapSeconds);
    if (plan.items.length === 0) {
      alert('Nothing to export: none of the clips on the timeline has audio.');
      return;
    }
    setIsExporting(true);
    setExportProgress('Initializing Web Audio engine…');

    try {
      const audioCtx = getSharedAudioContext();
      if (audioCtx.state === 'suspended') {
        try {
          await audioCtx.resume();
        } catch {
          /* ignore */
        }
      }
      const fileCache = new Map<string, AudioBuffer>(); // small LRU: the same source file often backs several clips
      const parts: AudioBuffer[] = [];
      const gaps: number[] = [];
      const skipped: string[] = [];

      for (let i = 0; i < plan.items.length; i++) {
        const it = plan.items[i];
        const c = it.clip;
        setExportProgress(`Fetching & decoding clip ${i + 1}/${plan.items.length}: ${c.title}…`);
        const key = c.audioUrl as string;
        let full = fileCache.get(key);
        if (full) {
          fileCache.delete(key);
        } else {
          const fetchUrl = (await getCachedAudioUrl(key)) || key;
          const res = await fetch(toFetchableUrl(fetchUrl));
          if (!res.ok) throw new Error(`Could not fetch audio for "${c.title}" (HTTP ${res.status}).`);
          full = await audioCtx.decodeAudioData(await res.arrayBuffer());
        }
        fileCache.set(key, full);
        if (fileCache.size > 3) {
          const oldest = fileCache.keys().next().value;
          if (oldest !== undefined) fileCache.delete(oldest);
        }

        // Self-heal window bounds if clip window exceeds file duration (pre-cut clip with episode-relative timestamp)
        let sliceStart = it.effStart;
        let sliceEnd = it.effEnd;
        if (!c.windowVerified && sliceStart >= full.duration - 0.02) {
          const reconciled = reconcileWindow(c, full.duration);
          sliceStart = reconciled.startSec;
          sliceEnd = reconciled.endSec;
        }

        if (sliceStart >= full.duration - 0.02) {
          skipped.push(c.title || c.id);
          continue;
        }
        parts.push(sliceAudioBuffer(audioCtx, full, sliceStart, Math.min(sliceEnd, full.duration)));
        gaps.push(it.gapAfter);
      }

      if (parts.length === 0) {
        throw new Error('None of the clip windows fall inside their audio files. Re-check the trims.');
      }

      setExportProgress('Mastering audio (loudness normalization ~-16 LUFS & anti-click micro-fades)…');
      const masterBuffer = stitchAudioBuffers(audioCtx, parts, {
        gapSec: gapSeconds,
        gapsSec: gaps,
        normalizePeak: normalizeAudio,
        targetLufs: -16.0,
        targetPeakDb: -1.0,
        antiClickFades: antiClickFades,
        fadeMs: 18,
      });

      setExportProgress('Encoding lossless 16-bit PCM broadcast WAV…');
      triggerDownload(audioBufferToWav(masterBuffer), `Montage_Studio_Master_${parts.length}_Clips.wav`);

      setExportProgress(
        skipped.length > 0
          ? `Master export complete. Skipped ${skipped.length} clip(s) whose window is outside the audio: ${skipped.join(', ')}`
          : 'Master export complete!'
      );
      setTimeout(() => setIsExporting(false), skipped.length > 0 ? 4000 : 1200);
    } catch (err: any) {
      console.error('Failed to export montage WAV:', err);
      alert(`Export Error: ${err.message || 'Could not fetch or decode audio clip data. Check audio streams.'}`);
      setIsExporting(false);
    }
  };

  const exportManifestJson = () => {
    const { plan, sourceIndex } = buildPlayablePlan<MontageClipItem>(clips, gapSeconds);
    let directorPrompt: string | null = null;
    try {
      directorPrompt = localStorage.getItem(DIRECTOR_LAST_PROMPT_KEY);
    } catch {}
    const prov = clips.find(c => c.director)?.director;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const data = {
      project: 'SpacePipe Investigative Audio Montage Studio',
      created_at: new Date().toISOString(),
      total_clips: clips.length,
      gap_seconds: gapSeconds,
      total_runtime_sec: r2(plan.totalSec),
      clips_runtime_sec: r2(plan.clipsSec),
      gaps_runtime_sec: r2(plan.gapsSec),
      target_duration_seconds: targetDurationSec,
      normalize_audio: normalizeAudio,
      anti_click_fades: antiClickFades,
      director: prov ? { prompt: directorPrompt, cut_id: prov.cutId, model: prov.model, prompt_hash: prov.promptHash } : null,
      timeline: plan.items.map(it => ({
        position: sourceIndex[it.index] + 1,
        clip_id: it.clip.id,
        timeline_start_sec: r2(it.timelineStart),
        timeline_end_sec: r2(it.timelineEnd),
        source_start_sec: r2(it.effStart),
        source_end_sec: r2(it.effEnd),
        gap_after_sec: r2(it.gapAfter),
      })),
      clips,
    };
    triggerDownload(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'Montage_Studio_Recipe.json');
  };

  /**
   * DAW / Audacity Label Track Export: label times come from the same plan as the audio, so they line up
   * with the exported master (per-clip trims and gaps included).
   */
  const exportAudacityLabels = () => {
    const { plan, sourceIndex } = buildPlayablePlan<MontageClipItem>(clips, gapSeconds);
    const lines = plan.items.map(it => {
      const c = it.clip;
      const cleanQuote = (c.quote || c.title).slice(0, 70).replace(/\t/g, ' ').replace(/\n/g, ' ');
      const label = `#${sourceIndex[it.index] + 1} [${c.speaker}] ${cleanQuote}`;
      return `${it.timelineStart.toFixed(6)}\t${it.timelineEnd.toFixed(6)}\t${label}`;
    });
    triggerDownload(new Blob([lines.join('\n')], { type: 'text/plain' }), 'Montage_Audacity_labels.txt');
  };

  return (
    <MontageContext.Provider
      value={{
        clips,
        isDrawerOpen,
        openDrawer,
        closeDrawer,
        toggleDrawer,
        addClip,
        removeClip,
        moveClip,
        reorderClips,
        nudgeClipStart,
        nudgeClipEnd,
        clearClips,
        replaceClips,
        updateClip,
        setClipGap,
        toggleClipLock,
        resetClipTrim,
        undo,
        redo,
        canUndo: historyRef.current.past.length > 0,
        canRedo: historyRef.current.future.length > 0,
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
        sortByEscalation: () => autoCurate('escalation', clips),
        isAuditioning,
        currentAuditionIndex,
        auditionProgress,
        startAudition,
        stopAudition,
        skipAudition,
        insertClipAt,
        exportStitchedWav,
        exportManifestJson,
        exportAudacityLabels,
        isExporting,
        exportProgress,
      }}
    >
      {children}
    </MontageContext.Provider>
  );
};

export const useMontage = () => {
  const ctx = useContext(MontageContext);
  if (!ctx) {
    throw new Error('useMontage must be used within a MontageProvider');
  }
  return ctx;
};
