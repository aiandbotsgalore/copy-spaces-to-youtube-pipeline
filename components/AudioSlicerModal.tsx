import React, { useState, useEffect, useRef } from 'react';
import {
  Scissors, Play, Pause, Download, Plus, X, RotateCcw,
  Volume2, ShieldAlert, Sparkles, Clock, Check, Loader2, Music
} from 'lucide-react';
import { useMontage } from '../contexts/MontageContext';
import { audioBufferToWav, sliceAudioBuffer } from '../utils/wavEncoder';
import { getCachedAudioUrl } from '../utils/audioCache';

export interface SlicerTurnTarget {
  speaker: string;
  text?: string;
  quote?: string;
  startSec: number;
  endSec: number | null;
  audioUrl?: string;
  releaseTitle?: string;
  sourceTitle?: string;
  releaseTag?: string;
  sourceTag?: string;
  words?: { word: string; start: number; end: number }[];
}

interface AudioSlicerModalProps {
  isOpen: boolean;
  onClose: () => void;
  target: SlicerTurnTarget | null;
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const ms = Math.floor((seconds % 1) * 10);
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${ms}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}.${ms}`;
}

export const AudioSlicerModal: React.FC<AudioSlicerModalProps> = ({ isOpen, onClose, target }) => {
  const { addClip } = useMontage();

  const [startSec, setStartSec] = useState<number>(0);
  const [endSec, setEndSec] = useState<number>(10);
  const [isPlayingSlice, setIsPlayingSlice] = useState(false);
  const [currentPreviewSec, setCurrentPreviewSec] = useState<number | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [category, setCategory] = useState<'insult' | 'character' | 'abuse' | 'sexual' | 'criminal' | 'threat' | 'other'>('other');
  const [severity, setSeverity] = useState<number>(7);

  // Waveform visualization state
  const [waveformPeaks, setWaveformPeaks] = useState<Float32Array | null>(null);
  const [isDecodingWaveform, setIsDecodingWaveform] = useState(false);
  const [viewWindow, setViewWindow] = useState<{ start: number; end: number }>({ start: 0, end: 30 });
  const [draggingHandle, setDraggingHandle] = useState<'start' | 'end' | 'scrub' | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Initialize bounds when target changes
  useEffect(() => {
    if (target) {
      const s = Math.max(0, target.startSec - 0.5); // 0.5s pre-roll by default
      const e = target.endSec !== null && target.endSec > target.startSec
        ? target.endSec + 0.8 // 0.8s tail
        : target.startSec + 15;
      const roundedStart = Math.round(s * 10) / 10;
      const roundedEnd = Math.round(e * 10) / 10;
      setStartSec(roundedStart);
      setEndSec(roundedEnd);

      // Set viewing window with 4s padding around target
      const winStart = Math.max(0, Math.floor(roundedStart - 4));
      const winEnd = Math.ceil(roundedEnd + 4);
      setViewWindow({ start: winStart, end: winEnd });

      // Auto-detect category from quote keywords
      const quoteVal = target.text || target.quote || '';
      const lower = quoteVal.toLowerCase();
      if (lower.includes('police') || lower.includes('cop') || lower.includes('ic3') || lower.includes('lawsuit') || lower.includes('court') || lower.includes('bankrupt')) {
        setCategory(lower.includes('lawsuit') || lower.includes('bankrupt') ? 'threat' : 'criminal');
        setSeverity(9);
      } else if (lower.includes('predator') || lower.includes('porn') || lower.includes('deepfake') || lower.includes('nude') || lower.includes('minor')) {
        setCategory('sexual');
        setSeverity(10);
      } else if (lower.includes('harem') || lower.includes('triangulat') || lower.includes('trauma') || lower.includes('manipulat')) {
        setCategory('abuse');
        setSeverity(8);
      } else if (lower.includes('dox') || lower.includes('address') || lower.includes('phone') || lower.includes('front door')) {
        setCategory('threat');
        setSeverity(9);
      } else {
        setCategory('character');
        setSeverity(7);
      }
      setIsPlayingSlice(false);
      setCurrentPreviewSec(null);
      setExportSuccess(false);
    }
  }, [target]);

  // Decode audio and extract waveform peaks for current window
  useEffect(() => {
    if (!target?.audioUrl || !isOpen) return;

    let cancelled = false;
    setIsDecodingWaveform(true);

    (async () => {
      try {
        let fetchUrl = target.audioUrl!;
        const cached = await getCachedAudioUrl(target.audioUrl!);
        if (cached) fetchUrl = cached;

        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const res = await fetch(fetchUrl);
        const arrayBuf = await res.arrayBuffer();
        const fullBuffer = await audioCtx.decodeAudioData(arrayBuf);
        if (cancelled) return;

        const sampleRate = fullBuffer.sampleRate;
        const startSample = Math.max(0, Math.floor(viewWindow.start * sampleRate));
        const endSample = Math.min(fullBuffer.length, Math.floor(viewWindow.end * sampleRate));
        const channelData = fullBuffer.getChannelData(0);

        const BARS = 260;
        const blockSize = Math.max(1, Math.floor((endSample - startSample) / BARS));
        const peaks = new Float32Array(BARS);

        for (let b = 0; b < BARS; b++) {
          const offset = startSample + b * blockSize;
          let maxVal = 0;
          for (let s = 0; s < blockSize; s += 8) {
            const val = Math.abs(channelData[offset + s] || 0);
            if (val > maxVal) maxVal = val;
          }
          peaks[b] = Math.min(1.0, maxVal);
        }

        setWaveformPeaks(peaks);
      } catch (err) {
        console.warn('Could not extract waveform peaks:', err);
      } finally {
        if (!cancelled) setIsDecodingWaveform(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [target?.audioUrl, isOpen, viewWindow.start, viewWindow.end]);

  // Render Canvas Waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = '#080c14';
    ctx.fillRect(0, 0, width, height);

    // Center baseline
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    const winDuration = Math.max(0.1, viewWindow.end - viewWindow.start);
    const secToX = (s: number) => ((s - viewWindow.start) / winDuration) * width;

    const startX = Math.max(0, Math.min(width, secToX(startSec)));
    const endX = Math.max(0, Math.min(width, secToX(endSec)));

    // Active slice highlight background
    ctx.fillStyle = 'rgba(16, 185, 129, 0.08)';
    ctx.fillRect(startX, 0, Math.max(2, endX - startX), height);

    // Waveform bars
    if (waveformPeaks && waveformPeaks.length > 0) {
      const barWidth = width / waveformPeaks.length;
      for (let i = 0; i < waveformPeaks.length; i++) {
        const x = i * barWidth;
        const amp = waveformPeaks[i];
        const barH = Math.max(3, amp * (height * 0.76));
        const y = (height - barH) / 2;
        const isInside = x >= startX && x <= endX;

        if (isInside) {
          const grad = ctx.createLinearGradient(0, y, 0, y + barH);
          grad.addColorStop(0, '#34d399');
          grad.addColorStop(1, '#6366f1');
          ctx.fillStyle = grad;
        } else {
          ctx.fillStyle = '#334155';
        }

        ctx.fillRect(x + 0.5, y, Math.max(1, barWidth - 1), barH);
      }
    } else {
      // Subtle pulse line while decoding
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, height / 2 - 1, width, 2);
    }

    // Start handle (Emerald)
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(startX, 0);
    ctx.lineTo(startX, height);
    ctx.stroke();

    // Start tab pill
    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.roundRect(Math.max(0, startX - 16), 0, 32, 16, [0, 0, 6, 6]);
    ctx.fill();
    ctx.fillStyle = '#064e3b';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('IN', Math.max(16, startX), 11);

    // End handle (Rose)
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(endX, 0);
    ctx.lineTo(endX, height);
    ctx.stroke();

    // End tab pill
    ctx.fillStyle = '#f43f5e';
    ctx.beginPath();
    ctx.roundRect(Math.min(width - 32, endX - 16), 0, 32, 16, [0, 0, 6, 6]);
    ctx.fill();
    ctx.fillStyle = '#4c0519';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('OUT', Math.min(width - 16, endX), 11);

    // Moving Playhead
    if (currentPreviewSec !== null && currentPreviewSec >= viewWindow.start && currentPreviewSec <= viewWindow.end) {
      const playX = secToX(currentPreviewSec);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playX, 0);
      ctx.lineTo(playX, height);
      ctx.stroke();
    }
  }, [waveformPeaks, startSec, endSec, currentPreviewSec, viewWindow]);

  // Handle stop on unmount or close
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  if (!isOpen || !target) return null;

  const duration = Math.max(0, endSec - startSec);
  const targetTitle = target.releaseTitle || target.sourceTitle || 'Space Episode';
  const targetText = target.text || target.quote || '';

  // Canvas pointer scrubbing & boundary drag handlers
  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const winDuration = Math.max(0.1, viewWindow.end - viewWindow.start);
    const secToX = (s: number) => ((s - viewWindow.start) / winDuration) * canvas.width;

    const startX = secToX(startSec);
    const endX = secToX(endSec);

    if (Math.abs(x - startX) <= 18) {
      setDraggingHandle('start');
      canvas.setPointerCapture(e.pointerId);
    } else if (Math.abs(x - endX) <= 18) {
      setDraggingHandle('end');
      canvas.setPointerCapture(e.pointerId);
    } else {
      // Scrub playhead to this point
      const clickedSec = viewWindow.start + (x / canvas.width) * winDuration;
      setCurrentPreviewSec(clickedSec);
      if (audioRef.current) {
        audioRef.current.currentTime = Math.max(0, clickedSec);
      }
    }
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draggingHandle) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(canvas.width, ((e.clientX - rect.left) / rect.width) * canvas.width));
    const winDuration = Math.max(0.1, viewWindow.end - viewWindow.start);
    const curSec = Math.round((viewWindow.start + (x / canvas.width) * winDuration) * 10) / 10;

    if (draggingHandle === 'start') {
      setStartSec(Math.max(0, Math.min(endSec - 0.2, curSec)));
    } else if (draggingHandle === 'end') {
      setEndSec(Math.max(startSec + 0.2, curSec));
    }
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (draggingHandle) {
      setDraggingHandle(null);
      try {
        canvasRef.current?.releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  const togglePlaySlice = async () => {
    if (!target.audioUrl) {
      alert('No audio stream URL available for this episode.');
      return;
    }

    if (isPlayingSlice && audioRef.current) {
      audioRef.current.pause();
      setIsPlayingSlice(false);
      setCurrentPreviewSec(null);
      return;
    }

    let playUrl = target.audioUrl;
    const cached = await getCachedAudioUrl(target.audioUrl);
    if (cached) playUrl = cached;

    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    const audio = audioRef.current;
    audio.src = playUrl;
    audio.currentTime = Math.max(0, startSec);
    setCurrentPreviewSec(startSec);

    audio.oncanplay = () => {
      audio.play().catch(e => console.warn('Slice preview error:', e));
      setIsPlayingSlice(true);
    };

    const handleTimeUpdate = () => {
      setCurrentPreviewSec(audio.currentTime);
      if (audio.currentTime >= endSec) {
        audio.pause();
        audio.currentTime = startSec;
        setCurrentPreviewSec(startSec);
        setIsPlayingSlice(false);
        audio.removeEventListener('timeupdate', handleTimeUpdate);
      }
    };
    audio.addEventListener('timeupdate', handleTimeUpdate);

    audio.onended = () => {
      setIsPlayingSlice(false);
      setCurrentPreviewSec(null);
    };
  };

  // Quick word snapping helper
  const handleWordClick = (wordStart: number, wordEnd: number, idx: number, total: number) => {
    // If word is in first 40% of utterance, snap Start; otherwise snap End
    if (idx < Math.ceil(total * 0.4)) {
      setStartSec(Math.max(0, Math.round(wordStart * 10) / 10));
    } else {
      setEndSec(Math.round(wordEnd * 10) / 10);
    }
  };

  const snapToFirstWord = () => {
    if (target.words && target.words.length > 0) {
      setStartSec(Math.max(0, Math.round(target.words[0].start * 10) / 10));
    } else {
      setStartSec(Math.max(0, target.startSec));
    }
  };

  const snapToLastWord = () => {
    if (target.words && target.words.length > 0) {
      setEndSec(Math.round(target.words[target.words.length - 1].end * 10) / 10);
    } else if (target.endSec) {
      setEndSec(target.endSec);
    }
  };

  const trimSilencePadding = () => {
    setStartSec(prev => Math.max(0, Math.round((prev + 0.3) * 10) / 10));
    setEndSec(prev => Math.max(startSec + 0.5, Math.round((prev - 0.3) * 10) / 10));
  };

  const handleDownloadWav = async () => {
    if (!target.audioUrl) {
      alert('Audio stream URL is not available to export.');
      return;
    }

    setIsExporting(true);
    try {
      let fetchUrl = target.audioUrl;
      const cached = await getCachedAudioUrl(target.audioUrl);
      if (cached) fetchUrl = cached;

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const res = await fetch(fetchUrl);
      const arrayBuffer = await res.arrayBuffer();
      const fullBuffer = await audioCtx.decodeAudioData(arrayBuffer);

      const slicedBuffer = sliceAudioBuffer(audioCtx, fullBuffer, startSec, endSec);
      const wavBlob = audioBufferToWav(slicedBuffer);

      // Create clean filename based on quote
      const quoteVal = target.text || target.quote || 'Clip';
      const cleanQuoteSlug = quoteVal
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .trim()
        .split(/\s+/)
        .slice(0, 6)
        .join('_');
      const filename = `${target.speaker}_${cleanQuoteSlug || 'Clip'}.wav`;

      const blobUrl = URL.createObjectURL(wavBlob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);

      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 2500);
    } catch (err: any) {
      console.error('Failed to export sliced audio:', err);
      alert(`Export error: ${err.message || 'Could not fetch or decode audio. Cross-origin restrictions may apply to this remote stream.'}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleAddToMontage = () => {
    const quoteVal = target.text || target.quote || '';
    const cleanQuoteSlug = quoteVal
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 5)
      .join(' ');

    addClip({
      title: `${target.speaker}: "${cleanQuoteSlug}…"`,
      quote: quoteVal,
      speaker: target.speaker,
      sourceTitle: target.releaseTitle || target.sourceTitle || 'Space Episode',
      sourceTag: target.releaseTag || target.sourceTag,
      audioUrl: target.audioUrl,
      startSec,
      endSec,
      category,
      severity,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col text-slate-100">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-xl border border-indigo-500/30">
              <Scissors size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>In-Browser Audio Slicer</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {target.speaker}
                </span>
              </h2>
              <p className="text-xs text-slate-400 truncate max-w-md">
                {targetTitle}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[70vh]">
          {/* Waveform Visualizer Box */}
          <div className="p-4 rounded-xl bg-slate-950/90 border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <Music size={13} className="text-emerald-400" />
                <span className="font-semibold text-slate-200">Waveform Amplitude Peaks</span>
                {isDecodingWaveform && (
                  <span className="flex items-center gap-1 text-[11px] text-indigo-400">
                    <Loader2 size={11} className="animate-spin" /> Decoding audio…
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-[11px] font-mono text-slate-400">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" /> IN: {formatTime(startSec)}
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-rose-400" /> OUT: {formatTime(endSec)}
                </span>
              </div>
            </div>

            {/* Interactive Canvas */}
            <div className="relative w-full h-28 bg-slate-950 rounded-xl overflow-hidden border border-slate-800/90 cursor-ew-resize">
              <canvas
                ref={canvasRef}
                width={640}
                height={112}
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={handleCanvasPointerUp}
                className="w-full h-full block"
              />
              <div className="absolute bottom-1 right-2 pointer-events-none text-[11px] font-mono text-slate-400">
                Drag IN/OUT tabs or click to scrub
              </div>
            </div>

            {/* Quick Word & Silence Snapping Buttons */}
            <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={snapToFirstWord}
                  className="px-2.5 py-1 bg-emerald-950/50 hover:bg-emerald-900/60 border border-emerald-500/30 text-emerald-300 rounded-lg text-[11px] font-medium transition-colors cursor-pointer"
                  title="Snap start boundary to first word"
                >
                  Snap Start to 1st Word
                </button>
                <button
                  type="button"
                  onClick={snapToLastWord}
                  className="px-2.5 py-1 bg-rose-950/50 hover:bg-rose-900/60 border border-rose-500/30 text-rose-300 rounded-lg text-[11px] font-medium transition-colors cursor-pointer"
                  title="Snap end boundary to last word"
                >
                  Snap End to Last Word
                </button>
                <button
                  type="button"
                  onClick={trimSilencePadding}
                  className="px-2.5 py-1 bg-indigo-950/50 hover:bg-indigo-900/60 border border-indigo-500/30 text-indigo-300 rounded-lg text-[11px] font-medium transition-colors cursor-pointer"
                  title="Trim 0.3s silence padding from both ends"
                >
                  Trim Silence (-0.3s)
                </button>
              </div>
              <span className="text-[11px] text-slate-400 italic">Click any word below to snap</span>
            </div>
          </div>

          {/* Quote display with clickable word-snapping pills */}
          <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Exact Verbatim Dialogue {target.words && target.words.length > 0 ? '(Click Word to Snap)' : ''}
            </span>
            <div className="text-sm font-medium text-slate-100 leading-relaxed flex flex-wrap gap-1">
              {target.words && target.words.length > 0 ? (
                target.words.map((w, wIdx) => {
                  const isWithinSelection = w.start >= startSec - 0.2 && w.end <= endSec + 0.2;
                  return (
                    <button
                      key={wIdx}
                      type="button"
                      onClick={() => handleWordClick(w.start, w.end, wIdx, target.words!.length)}
                      className={`px-1.5 py-0.5 rounded transition-all cursor-pointer text-xs ${
                        isWithinSelection
                          ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40 hover:bg-emerald-500/30'
                          : 'bg-slate-800/60 text-slate-400 hover:text-white hover:bg-slate-700'
                      }`}
                      title={`Click to snap! Starts at ${formatTime(w.start)}`}
                    >
                      {w.word}
                    </button>
                  );
                })
              ) : (
                <p className="italic text-slate-200">"{targetText}"</p>
              )}
            </div>
          </div>

          {/* Time Boundary Inputs */}
          <div className="grid grid-cols-2 gap-4">
            {/* Start boundary */}
            <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-emerald-400">Clip Start</span>
                <span className="font-mono text-slate-400">{formatTime(startSec)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={startSec}
                  onChange={e => setStartSec(Math.max(0, parseFloat(e.target.value) || 0))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm font-mono text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div className="flex gap-1 pt-1">
                {[-5, -1, 1, 5].map(delta => (
                  <button
                    key={`start_${delta}`}
                    type="button"
                    onClick={() => setStartSec(prev => Math.max(0, Math.round((prev + delta) * 10) / 10))}
                    className="flex-1 py-1 text-[11px] font-mono bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg cursor-pointer transition-colors"
                  >
                    {delta > 0 ? `+${delta}s` : `${delta}s`}
                  </button>
                ))}
              </div>
            </div>

            {/* End boundary */}
            <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-rose-400">Clip End</span>
                <span className="font-mono text-slate-400">{formatTime(endSec)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={endSec}
                  onChange={e => setEndSec(Math.max(startSec + 0.5, parseFloat(e.target.value) || 0))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm font-mono text-white focus:outline-none focus:border-rose-500"
                />
              </div>
              <div className="flex gap-1 pt-1">
                {[-5, -1, 1, 5].map(delta => (
                  <button
                    key={`end_${delta}`}
                    type="button"
                    onClick={() => setEndSec(prev => Math.max(startSec + 0.5, Math.round((prev + delta) * 10) / 10))}
                    className="flex-1 py-1 text-[11px] font-mono bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg cursor-pointer transition-colors"
                  >
                    {delta > 0 ? `+${delta}s` : `${delta}s`}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Duration Indicator */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-indigo-950/30 border border-indigo-500/30 rounded-lg text-xs">
            <span className="text-indigo-300 font-semibold flex items-center gap-1.5">
              <Clock size={14} /> Total Clip Duration:
            </span>
            <span className="font-mono font-bold text-white text-sm">
              {duration.toFixed(1)} seconds
            </span>
          </div>

          {/* Category & Severity metadata for montage */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-400">Category Tag</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value as any)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none"
              >
                <option value="insult">Insult / Ridicule</option>
                <option value="character">Character Attack</option>
                <option value="abuse">Abuse / Manipulation</option>
                <option value="sexual">Sexual / Predatory / AI Deepfakes</option>
                <option value="criminal">Criminal / IC3 / Police</option>
                <option value="threat">Lawsuit / Ruin Threat</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <label className="font-semibold text-slate-400">Severity Rating</label>
                <span className="font-bold text-amber-400">{severity} / 10</span>
              </div>
              <input
                type="range"
                min="1"
                max="10"
                value={severity}
                onChange={e => setSeverity(parseInt(e.target.value))}
                className="w-full accent-amber-500 cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="p-5 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between gap-3 flex-wrap">
          <button
            onClick={togglePlaySlice}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              isPlayingSlice
                ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-lg'
                : 'bg-slate-800 hover:bg-slate-700 text-white border border-slate-700'
            }`}
          >
            {isPlayingSlice ? <Pause size={14} /> : <Play size={14} />}
            <span>{isPlayingSlice ? 'Stop Preview' : 'Audition Slice Loop'}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadWav}
              disabled={isExporting}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-emerald-300 hover:text-white rounded-lg text-xs font-semibold border border-slate-700 transition-colors cursor-pointer shadow-sm"
              title="Export sub-clip directly as lossless WAV"
            >
              {isExporting ? (
                <Loader2 size={13} className="animate-spin text-emerald-400" />
              ) : exportSuccess ? (
                <Check size={13} className="text-emerald-400" />
              ) : (
                <Download size={13} />
              )}
              <span>{isExporting ? 'Slicing…' : exportSuccess ? 'Downloaded!' : 'Download .wav'}</span>
            </button>

            <button
              onClick={handleAddToMontage}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold shadow-lg transition-all cursor-pointer hover:scale-105 active:scale-95"
            >
              <Plus size={14} />
              <span>Add to Montage Reel</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
