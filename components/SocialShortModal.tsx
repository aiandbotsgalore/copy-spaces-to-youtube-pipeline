import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  X,
  Play,
  Pause,
  Download,
  Film,
  Sparkles,
  Volume2,
  Sliders,
  Check,
  Palette,
  Loader2,
} from 'lucide-react';
import { ClipItem } from '../utils/contracts/clipCatalog';
import { getAudioUrl, formatEpisodeTitle } from './clips/clipUtils';
import { computePeaksFromChannelData } from '../utils/audioPeaks';

interface Props {
  clip: ClipItem;
  isOpen: boolean;
  onClose: () => void;
}

const THEMES = [
  { id: 'cyber', name: 'Cyberpunk Neon', bg: ['#0f172a', '#1e1b4b', '#311042'], accent: '#38bdf8', secondary: '#f43f5e' },
  { id: 'sunset', name: 'Crimson Dusk', bg: ['#18080c', '#3f101c', '#601625'], accent: '#fb923c', secondary: '#f43f5e' },
  { id: 'emerald', name: 'Investigative Green', bg: ['#022c22', '#064e3b', '#0f172a'], accent: '#34d399', secondary: '#10b981' },
  { id: 'slate', name: 'Sleek Darkroom', bg: ['#020617', '#0f172a', '#1e293b'], accent: '#818cf8', secondary: '#c084fc' },
  { id: 'amber', name: 'Golden Hour', bg: ['#1c1004', '#451a03', '#78350f'], accent: '#fbbf24', secondary: '#f59e0b' },
];

export const SocialShortModal: React.FC<Props> = ({ clip, isOpen, onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);

  const [theme, setTheme] = useState(THEMES[0]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordProgress, setRecordProgress] = useState<number>(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [showProgressBars, setShowProgressBars] = useState(true);

  const audioUrl = getAudioUrl(clip);
  const title = clip.title || 'Space Highlight';
  const speaker = clip.speakers?.[0] || 'Speaker';
  const quote = clip.transcript_snippet || clip.reason || '';
  const episodeName = formatEpisodeTitle(clip.episode);

  // Setup Web Audio Analyser
  const initAudioNodes = useCallback(() => {
    if (!audioRef.current || audioCtxRef.current) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.8;

      const source = ctx.createMediaElementSource(audioRef.current);
      source.connect(analyser);
      analyser.connect(ctx.destination);

      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      sourceNodeRef.current = source;
    } catch (e) {
      console.debug('[SocialShortModal] AudioContext init note:', e);
    }
  }, []);

  // Main Canvas Render Loop (1080x1920 vertical canvas)
  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = 1080;
    const height = 1920;

    // 1. Draw Theme Background Gradient
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, theme.bg[0]);
    grad.addColorStop(0.5, theme.bg[1]);
    grad.addColorStop(1, theme.bg[2]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Decorative grid texture
    ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
    for (let x = 0; x < width; x += 60) {
      ctx.fillRect(x, 0, 1, height);
    }
    for (let y = 0; y < height; y += 60) {
      ctx.fillRect(0, y, width, 1);
    }

    // 2. Glowing Ambient Orbs
    const time = Date.now() * 0.001;
    const orbX = width * 0.5 + Math.sin(time) * 120;
    const orbY = height * 0.45 + Math.cos(time * 0.8) * 100;
    const orbGrad = ctx.createRadialGradient(orbX, orbY, 10, orbX, orbY, 400);
    orbGrad.addColorStop(0, `${theme.accent}33`);
    orbGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = orbGrad;
    ctx.beginPath();
    ctx.arc(orbX, orbY, 400, 0, Math.PI * 2);
    ctx.fill();

    // 3. Top Header: SpacePipe Gen Branding & Episode Badge
    ctx.textAlign = 'center';
    ctx.fillStyle = theme.accent;
    ctx.font = 'bold 32px sans-serif';
    ctx.fillText('🎙️ TWITTER SPACES HIGHLIGHT', width / 2, 160);

    // Episode Title Pill
    ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 2;
    const epWidth = Math.min(800, ctx.measureText(episodeName).width + 60);
    roundRect(ctx, (width - epWidth) / 2, 200, epWidth, 54, 27);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '500 24px sans-serif';
    ctx.fillText(episodeName.slice(0, 48), width / 2, 236);

    // 4. Center Quote Card
    const cardY = 320;
    const cardHeight = 620;
    const cardWidth = 920;
    const cardX = (width - cardWidth) / 2;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = `${theme.accent}55`;
    ctx.lineWidth = 3;
    roundRect(ctx, cardX, cardY, cardWidth, cardHeight, 36);
    ctx.fill();
    ctx.stroke();

    // Speaker Badge
    ctx.fillStyle = theme.accent;
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`🗣️  ${speaker}`, cardX + 50, cardY + 80);

    // Viral Star Badge
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 32px sans-serif';
    ctx.fillText(`★ ${(clip.viral_score || 9)}/10 Moment`, cardX + cardWidth - 50, cardY + 80);

    // Divider Line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cardX + 50, cardY + 115);
    ctx.lineTo(cardX + cardWidth - 50, cardY + 115);
    ctx.stroke();

    // Title Headline
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 44px sans-serif';
    wrapText(ctx, `"${title}"`, cardX + 50, cardY + 185, cardWidth - 100, 56);

    // Quote Dialogue
    if (quote) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'italic 34px sans-serif';
      wrapText(ctx, quote, cardX + 50, cardY + 340, cardWidth - 100, 46);
    }

    // 5. Audio-Reactive Animated Waveform (Center-Bottom)
    const waveY = 1140;
    const waveWidth = 840;
    const waveX = (width - waveWidth) / 2;
    const barCount = 36;
    const barW = Math.floor(waveWidth / barCount) - 6;

    let freqData = new Uint8Array(barCount);
    if (analyserRef.current && isPlaying) {
      const fullFreq = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteFrequencyData(fullFreq);
      for (let i = 0; i < barCount; i++) {
        freqData[i] = fullFreq[i % fullFreq.length];
      }
    } else {
      // Idle gentle animation
      for (let i = 0; i < barCount; i++) {
        freqData[i] = 40 + Math.sin(time * 3 + i * 0.4) * 25;
      }
    }

    for (let i = 0; i < barCount; i++) {
      const barH = Math.max(16, (freqData[i] / 255) * 240);
      const bx = waveX + i * (barW + 6);
      const by = waveY - barH / 2;

      const barGrad = ctx.createLinearGradient(0, by, 0, by + barH);
      barGrad.addColorStop(0, theme.accent);
      barGrad.addColorStop(1, theme.secondary);
      ctx.fillStyle = barGrad;
      roundRect(ctx, bx, by, barW, barH, barW / 2);
      ctx.fill();
    }

    // 6. Playhead Duration Bar
    if (showProgressBars && audioRef.current && audioRef.current.duration) {
      const prog = audioRef.current.currentTime / audioRef.current.duration;
      const barW = 840;
      const bx = (width - barW) / 2;
      const by = 1380;

      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      roundRect(ctx, bx, by, barW, 12, 6);
      ctx.fill();

      ctx.fillStyle = theme.accent;
      roundRect(ctx, bx, by, barW * Math.max(0, Math.min(1, prog)), 12, 6);
      ctx.fill();

      // Current Time Display
      ctx.fillStyle = '#cbd5e1';
      ctx.font = 'bold 28px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(formatTime(audioRef.current.currentTime), bx, by + 46);
      ctx.textAlign = 'right';
      ctx.fillText(formatTime(audioRef.current.duration), bx + barW, by + 46);
    }

    // 7. Footer Call to Action
    ctx.textAlign = 'center';
    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText('LISTEN FULL ARCHIVE ON PODCAST & YOUTUBE', width / 2, 1780);

    animFrameRef.current = requestAnimationFrame(renderFrame);
  }, [theme, isPlaying, episodeName, title, speaker, quote, clip.viral_score, showProgressBars]);

  useEffect(() => {
    if (isOpen) {
      animFrameRef.current = requestAnimationFrame(renderFrame);
    }
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isOpen, renderFrame]);

  const handlePlayToggle = () => {
    if (!audioRef.current) return;
    initAudioNodes();
    if (audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume();
    }

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => setIsPlaying(true)).catch(console.warn);
    }
  };

  // Live Canvas + Audio Export using MediaRecorder
  const handleExportShort = async () => {
    if (!canvasRef.current || !audioRef.current) return;
    setIsRecording(true);
    setRecordProgress(0);

    initAudioNodes();
    if (audioCtxRef.current?.state === 'suspended') {
      await audioCtxRef.current.resume();
    }

    // Create stream from canvas at 30fps
    const canvasStream = canvasRef.current.captureStream(30);

    // Create stream from audio element via Web Audio
    let combinedStream: MediaStream = canvasStream;
    if (audioCtxRef.current && sourceNodeRef.current) {
      const dest = audioCtxRef.current.createMediaStreamDestination();
      sourceNodeRef.current.connect(dest);
      const audioTrack = dest.stream.getAudioTracks()[0];
      if (audioTrack) {
        combinedStream = new MediaStream([...canvasStream.getVideoTracks(), audioTrack]);
      }
    }

    // Determine supported mimeType
    const mimeTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4',
    ];
    const mimeType = mimeTypes.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';

    const recorder = new MediaRecorder(combinedStream, {
      mimeType,
      videoBitsPerSecond: 8_000_000, // 8 Mbps high quality
    });

    const chunks: Blob[] = [];
    recorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      setRecordedBlob(blob);
      setIsRecording(false);
      setIsPlaying(false);

      // Trigger instant browser download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `short_${(clip.title || 'clip').replace(/[^a-zA-Z0-9_-]/g, '_')}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };

    // Restart audio from start and record until end
    audioRef.current.currentTime = 0;
    audioRef.current.onended = () => {
      if (recorder.state === 'recording') recorder.stop();
    };
    audioRef.current.ontimeupdate = () => {
      if (audioRef.current && audioRef.current.duration) {
        const pct = Math.round((audioRef.current.currentTime / audioRef.current.duration) * 100);
        setRecordProgress(pct);
      }
    };

    recorder.start(500);
    audioRef.current.play().then(() => setIsPlaying(true)).catch(console.warn);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-150">
      <audio
        ref={audioRef}
        src={audioUrl}
        crossOrigin="anonymous"
        preload="auto"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />

      <div className="relative w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col md:flex-row max-h-[90vh]">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-20 p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-full transition-colors cursor-pointer"
        >
          <X size={18} />
        </button>

        {/* Left Side: 9:16 Canvas Live Preview */}
        <div className="flex-1 bg-slate-950 p-6 flex flex-col items-center justify-center border-b md:border-b-0 md:border-r border-slate-800">
          <div className="relative aspect-[9/16] h-[480px] sm:h-[540px] max-w-full rounded-2xl overflow-hidden shadow-2xl border-2 border-slate-800">
            <canvas
              ref={canvasRef}
              width={1080}
              height={1920}
              className="w-full h-full object-cover"
            />
            {/* Play/Pause Overlay Indicator */}
            <button
              onClick={handlePlayToggle}
              className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/30 transition-colors group cursor-pointer"
            >
              <div className="p-4 rounded-full bg-slate-900/80 border border-slate-700 text-white shadow-xl group-hover:scale-110 transition-transform">
                {isPlaying ? <Pause size={28} /> : <Play size={28} className="translate-x-0.5" />}
              </div>
            </button>
          </div>
          <span className="text-xs text-slate-500 mt-3 font-mono">1080 × 1920 (9:16 Vertical Video)</span>
        </div>

        {/* Right Side: Configuration & Export Controls */}
        <div className="w-full md:w-80 p-6 flex flex-col justify-between space-y-6 overflow-y-auto">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Film size={20} className="text-indigo-400" />
              <h2 className="text-lg font-bold text-white">Social Short Studio</h2>
            </div>
            <p className="text-xs text-slate-400">
              Generate 9:16 vertical shorts directly in your browser with animated audio waveforms and quote cards.
            </p>

            {/* Theme Palette Chooser */}
            <div className="mt-5 space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Palette size={13} /> Color Palette
              </label>
              <div className="grid grid-cols-1 gap-2">
                {THEMES.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t)}
                    className={`flex items-center justify-between p-2.5 rounded-xl border text-xs font-medium transition-all cursor-pointer ${
                      theme.id === t.id
                        ? 'border-indigo-500 bg-indigo-500/10 text-white shadow-sm'
                        : 'border-slate-800 bg-slate-950/40 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className="w-4 h-4 rounded-full shadow-sm"
                        style={{ backgroundColor: t.accent }}
                      />
                      <span>{t.name}</span>
                    </div>
                    {theme.id === t.id && <Check size={14} className="text-indigo-400" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Waveform Options */}
            <div className="mt-5 space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Sliders size={13} /> Display Options
              </label>
              <label className="flex items-center justify-between p-3 rounded-xl border border-slate-800 bg-slate-950/40 text-xs text-slate-300 cursor-pointer">
                <span>Show Playhead Timeline</span>
                <input
                  type="checkbox"
                  checked={showProgressBars}
                  onChange={e => setShowProgressBars(e.target.checked)}
                  className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500"
                />
              </label>
            </div>
          </div>

          {/* Action Export Button */}
          <div className="pt-4 border-t border-slate-800 space-y-3">
            {isRecording ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-indigo-300 font-semibold">
                  <span className="flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" /> Recording Short...
                  </span>
                  <span>{recordProgress}%</span>
                </div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-indigo-500 to-teal-400 transition-all duration-200"
                    style={{ width: `${recordProgress}%` }}
                  />
                </div>
              </div>
            ) : (
              <button
                onClick={handleExportShort}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl text-sm font-bold shadow-lg transition-all cursor-pointer hover:scale-[1.02]"
              >
                <Download size={16} />
                <span>Render & Download Short (MP4)</span>
              </button>
            )}

            <p className="text-[11px] text-slate-500 text-center">
              Rendered on client GPU via WebCodecs & Canvas. Zero cloud upload required.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

// Canvas helper: Rounded Rectangle
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Canvas helper: Text Wrapping
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  const words = text.split(' ');
  let line = '';
  let curY = y;

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      ctx.fillText(line, x, curY);
      line = words[n] + ' ';
      curY += lineHeight;
      if (curY > y + lineHeight * 4) {
        ctx.fillText(line + '...', x, curY);
        return;
      }
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, curY);
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}
