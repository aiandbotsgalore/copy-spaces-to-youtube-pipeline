import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import { audioBufferToWav, sliceAudioBuffer, stitchAudioBuffers, normalizeBroadcastLoudness, applyAntiClickFades } from '../utils/wavEncoder';
import { getCachedAudioUrl } from '../utils/audioCache';

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
  startAudition: () => void;
  stopAudition: () => void;
  skipAudition: (index: number) => void;
  exportStitchedWav: () => Promise<void>;
  exportManifestJson: () => void;
  exportAudacityLabels: () => void;
  isExporting: boolean;
  exportProgress: string;
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
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState('');

  const auditionAudioRef = useRef<HTMLAudioElement | null>(null);
  const auditionTimerRef = useRef<number | null>(null);

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
        return { ...c, startSec: newStart };
      })
    );
  }, []);

  const nudgeClipEnd = useCallback((id: string, deltaSec: number) => {
    setClips(prev =>
      prev.map(c => {
        if (c.id !== id) return c;
        const newEnd = Math.max(c.startSec + 0.2, parseFloat((c.endSec + deltaSec).toFixed(2)));
        return { ...c, endSec: newEnd };
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

  // Audition playback engine (streaming & gapless with silence pause)
  const stopAudition = useCallback(() => {
    if (auditionAudioRef.current) {
      auditionAudioRef.current.pause();
      auditionAudioRef.current.src = '';
    }
    if (auditionTimerRef.current) {
      clearTimeout(auditionTimerRef.current);
      auditionTimerRef.current = null;
    }
    setIsAuditioning(false);
  }, []);

  const playClipAtIndex = useCallback(async (index: number) => {
    if (index >= clips.length) {
      stopAudition();
      return;
    }

    setCurrentAuditionIndex(index);
    const clip = clips[index];
    if (!clip.audioUrl) {
      // Skip if no audio stream
      auditionTimerRef.current = window.setTimeout(() => {
        playClipAtIndex(index + 1);
      }, gapSeconds * 1000);
      return;
    }

    let urlToPlay = clip.audioUrl;
    const cached = await getCachedAudioUrl(clip.audioUrl);
    if (cached) urlToPlay = cached;

    if (!auditionAudioRef.current) {
      auditionAudioRef.current = new Audio();
    }
    const audio = auditionAudioRef.current;
    audio.src = urlToPlay;
    audio.currentTime = Math.max(0, clip.startSec);

    audio.oncanplay = () => {
      audio.play().catch(e => {
        console.warn('Playback error during audition:', e);
      });
    };

    const checkEnd = () => {
      if (audio.currentTime >= clip.endSec) {
        audio.pause();
        audio.removeEventListener('timeupdate', checkEnd);
        // Inter-clip silence pause
        auditionTimerRef.current = window.setTimeout(() => {
          playClipAtIndex(index + 1);
        }, gapSeconds * 1000);
      }
    };
    audio.addEventListener('timeupdate', checkEnd);

    audio.onerror = () => {
      console.warn('Audio stream error on clip', clip.title);
      auditionTimerRef.current = window.setTimeout(() => {
        playClipAtIndex(index + 1);
      }, gapSeconds * 1000);
    };
  }, [clips, gapSeconds, stopAudition]);

  const startAudition = useCallback(() => {
    if (clips.length === 0) return;
    setIsAuditioning(true);
    playClipAtIndex(0);
  }, [clips, playClipAtIndex]);

  const skipAudition = useCallback((index: number) => {
    if (auditionAudioRef.current) {
      auditionAudioRef.current.pause();
    }
    if (auditionTimerRef.current) {
      clearTimeout(auditionTimerRef.current);
    }
    playClipAtIndex(index);
  }, [playClipAtIndex]);

  useEffect(() => {
    return () => {
      if (auditionAudioRef.current) {
        auditionAudioRef.current.pause();
      }
      if (auditionTimerRef.current) {
        clearTimeout(auditionTimerRef.current);
      }
    };
  }, []);

  // Multi-format Master WAV export via Web Audio API with broadcast loudness matching
  const exportStitchedWav = async () => {
    if (clips.length === 0) return;
    setIsExporting(true);
    setExportProgress('Initializing Web Audio engine…');

    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const decodedBuffers: AudioBuffer[] = [];

      for (let i = 0; i < clips.length; i++) {
        const c = clips[i];
        setExportProgress(`Fetching & decoding clip ${i + 1}/${clips.length}: ${c.title}…`);
        if (!c.audioUrl) continue;

        let fetchUrl = c.audioUrl;
        const cached = await getCachedAudioUrl(c.audioUrl);
        if (cached) fetchUrl = cached;

        const res = await fetch(fetchUrl);
        const arrayBuf = await res.arrayBuffer();
        const fullAudioBuffer = await audioCtx.decodeAudioData(arrayBuf);

        // Slice sub-clip if boundaries specified
        let finalClipBuffer = fullAudioBuffer;
        if (c.startSec > 0 || (c.endSec > 0 && c.endSec < fullAudioBuffer.duration)) {
          finalClipBuffer = sliceAudioBuffer(audioCtx, fullAudioBuffer, c.startSec, c.endSec);
        }
        decodedBuffers.push(finalClipBuffer);
      }

      setExportProgress('Mastering audio (loudness normalization ~-16 LUFS & anti-click micro-fades)…');
      const masterBuffer = stitchAudioBuffers(audioCtx, decodedBuffers, {
        gapSec: gapSeconds,
        normalizePeak: normalizeAudio,
        targetLufs: -16.0,
        targetPeakDb: -1.0,
        antiClickFades: antiClickFades,
        fadeMs: 18,
      });

      setExportProgress('Encoding lossless 16-bit PCM broadcast WAV…');
      const wavBlob = audioBufferToWav(masterBuffer);

      const downloadUrl = URL.createObjectURL(wavBlob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `Montage_Studio_Master_${clips.length}_Clips.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);

      setExportProgress('Master export complete!');
      setTimeout(() => setIsExporting(false), 1200);
    } catch (err: any) {
      console.error('Failed to export montage WAV:', err);
      alert(`Export Error: ${err.message || 'Could not fetch or decode audio clip data. Check audio streams.'}`);
      setIsExporting(false);
    }
  };

  const exportManifestJson = () => {
    const data = {
      project: 'SpacePipe Investigative Audio Montage Studio',
      created_at: new Date().toISOString(),
      total_clips: clips.length,
      gap_seconds: gapSeconds,
      target_duration_seconds: targetDurationSec,
      normalize_audio: normalizeAudio,
      anti_click_fades: antiClickFades,
      clips,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Montage_Studio_Recipe.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * DAW / Audacity Label Track Export:
   * Generates a standard labels.txt marker track mapping quote text,
   * speaker name, and exact timeline timestamps for Audacity / Reaper / Pro Tools.
   */
  const exportAudacityLabels = () => {
    let currentMarkerTime = 0;
    const lines: string[] = [];

    clips.forEach((c, idx) => {
      const dur = Math.max(0.5, c.endSec - c.startSec);
      const start = currentMarkerTime;
      const end = currentMarkerTime + dur;
      const cleanQuote = (c.quote || c.title).slice(0, 70).replace(/\t/g, ' ').replace(/\n/g, ' ');
      const label = `#${idx + 1} [${c.speaker}] ${cleanQuote}`;
      lines.push(`${start.toFixed(6)}\t${end.toFixed(6)}\t${label}`);
      currentMarkerTime = end + gapSeconds;
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Montage_Audacity_labels.txt';
    a.click();
    URL.revokeObjectURL(url);
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
        startAudition,
        stopAudition,
        skipAudition,
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
