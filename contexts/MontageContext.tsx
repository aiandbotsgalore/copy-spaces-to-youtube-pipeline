import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import { audioBufferToWav, sliceAudioBuffer, stitchAudioBuffers } from '../utils/wavEncoder';
import { getCachedAudioUrl } from '../utils/audioCache';

export interface MontageClipItem {
  id: string;
  title: string;
  quote: string;
  speaker: string;
  sourceTitle: string;
  sourceTag?: string;
  audioUrl?: string;
  startSec: number;
  endSec: number;
  category?: 'insult' | 'character' | 'abuse' | 'sexual' | 'criminal' | 'threat' | 'other';
  severity?: number; // 1-10
}

interface MontageContextType {
  clips: MontageClipItem[];
  isDrawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
  addClip: (clip: Omit<MontageClipItem, 'id'> & { id?: string }) => void;
  removeClip: (id: string) => void;
  moveClip: (id: string, direction: 'up' | 'down') => void;
  clearClips: () => void;
  gapSeconds: number;
  setGapSeconds: (sec: number) => void;
  normalizeAudio: boolean;
  setNormalizeAudio: (val: boolean) => void;
  antiClickFades: boolean;
  setAntiClickFades: (val: boolean) => void;
  sortByEscalation: () => void;
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

const STORAGE_KEY = 'spacepipe_montage_clips_v1';
const GAP_KEY = 'spacepipe_montage_gap_v1';
const NORMALIZE_KEY = 'spacepipe_montage_norm_v1';
const ANTICLICK_KEY = 'spacepipe_montage_anticlick_v1';

// Preset category rank for escalating arc:
// 1. insults -> 2. character -> 3. abuse -> 4. sexual/predatory -> 5. criminal/threat
const CATEGORY_ESCALATION_WEIGHT: Record<string, number> = {
  insult: 10,
  character: 20,
  abuse: 30,
  sexual: 40,
  criminal: 50,
  threat: 60,
  other: 25,
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
      return saved ? parseFloat(saved) : 0.5;
    } catch {
      return 0.5;
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

  const setGapSeconds = (sec: number) => {
    setGapSecondsState(sec);
    try {
      localStorage.setItem(GAP_KEY, String(sec));
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

  const openDrawer = () => setIsDrawerOpen(true);
  const closeDrawer = () => setIsDrawerOpen(false);
  const toggleDrawer = () => setIsDrawerOpen(prev => !prev);

  const addClip = useCallback((clipData: Omit<MontageClipItem, 'id'> & { id?: string }) => {
    const newId = clipData.id || `montage_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    setClips(prev => {
      // Check if duplicate
      if (prev.some(c => c.id === newId)) return prev;
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

  const clearClips = useCallback(() => {
    stopAudition();
    setClips([]);
  }, []);

  const sortByEscalation = useCallback(() => {
    setClips(prev => {
      return [...prev].sort((a, b) => {
        const catA = CATEGORY_ESCALATION_WEIGHT[a.category || 'other'] || 25;
        const catB = CATEGORY_ESCALATION_WEIGHT[b.category || 'other'] || 25;
        if (catA !== catB) return catA - catB;
        const sevA = a.severity || 5;
        const sevB = b.severity || 5;
        return sevA - sevB;
      });
    });
  }, []);

  // Audition playback engine
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
      // Skip if no audio
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

    const durationSec = Math.max(1, clip.endSec - clip.startSec);

    audio.oncanplay = () => {
      audio.play().catch(e => {
        console.warn('Playback error during audition:', e);
      });
    };

    // Monitor when clip slice ends
    const checkEnd = () => {
      if (audio.currentTime >= clip.endSec) {
        audio.pause();
        audio.removeEventListener('timeupdate', checkEnd);
        // Pause for gap, then next
        auditionTimerRef.current = window.setTimeout(() => {
          playClipAtIndex(index + 1);
        }, gapSeconds * 1000);
      }
    };
    audio.addEventListener('timeupdate', checkEnd);

    audio.onerror = () => {
      console.warn('Audio error on clip', clip.title);
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

  // Cleanup on unmount
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

  // One-click master WAV export with browser-native Web Audio API stitching
  const exportStitchedWav = async () => {
    if (clips.length === 0) return;
    setIsExporting(true);
    setExportProgress('Initializing audio engine…');

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
        const sliceDuration = c.endSec - c.startSec;
        let finalClipBuffer = fullAudioBuffer;
        if (c.startSec > 0 || (c.endSec > 0 && c.endSec < fullAudioBuffer.duration)) {
          finalClipBuffer = sliceAudioBuffer(audioCtx, fullAudioBuffer, c.startSec, c.endSec);
        }
        decodedBuffers.push(finalClipBuffer);
      }

      setExportProgress('Mastering audio (loudness normalization & anti-pop micro-fades)…');
      const masterBuffer = stitchAudioBuffers(audioCtx, decodedBuffers, {
        gapSec: gapSeconds,
        normalizePeak: normalizeAudio,
        targetPeakDb: -1.0,
        antiClickFades: antiClickFades,
        fadeMs: 12,
      });

      setExportProgress('Encoding lossless 16-bit PCM WAV…');
      const wavBlob = audioBufferToWav(masterBuffer);

      // Trigger download
      const downloadUrl = URL.createObjectURL(wavBlob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `Master_Montage_Escalation_${clips.length}_Clips.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);

      setExportProgress('Done!');
      setTimeout(() => setIsExporting(false), 1200);
    } catch (err: any) {
      console.error('Failed to export montage WAV:', err);
      alert(`Export Error: ${err.message || 'Could not fetch or decode audio clip data. Ensure audio URLs allow access.'}`);
      setIsExporting(false);
    }
  };

  const exportManifestJson = () => {
    const data = {
      project: 'SpacePipe Investigation Montage Reel',
      created_at: new Date().toISOString(),
      total_clips: clips.length,
      gap_seconds: gapSeconds,
      normalize_audio: normalizeAudio,
      anti_click_fades: antiClickFades,
      clips,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Montage_Reel_Manifest.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportAudacityLabels = () => {
    let currentMarkerTime = 0;
    const lines: string[] = [];

    clips.forEach((c, idx) => {
      const dur = Math.max(0.5, c.endSec - c.startSec);
      const start = currentMarkerTime;
      const end = currentMarkerTime + dur;
      const label = `#${idx + 1} [${c.speaker}] ${c.quote.slice(0, 50).replace(/\t/g, ' ')}`;
      lines.push(`${start.toFixed(6)}\t${end.toFixed(6)}\t${label}`);
      currentMarkerTime = end + gapSeconds;
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Montage_Audacity_Labels.txt';
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
        clearClips,
        gapSeconds,
        setGapSeconds,
        normalizeAudio,
        setNormalizeAudio,
        antiClickFades,
        setAntiClickFades,
        sortByEscalation,
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
