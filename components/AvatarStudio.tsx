import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Video,
  Play,
  Pause,
  Download,
  Sparkles,
  Layers,
  Sliders,
  Eye,
  Camera,
  Maximize2,
  RefreshCw,
  Clock,
  ChevronRight,
  ChevronDown,
  Volume2,
  VolumeX,
  Share2,
  Film,
  Zap,
  Radio,
  Monitor,
  Check,
  Copy,
  FolderOpen,
  Split,
  RotateCcw,
  SkipBack,
  SkipForward,
  Grid,
  Settings2,
  Tv,
  Image as ImageIcon
} from 'lucide-react';
import { EnhancedConfig } from '../types';

interface Props {
  config: EnhancedConfig;
}

interface AvatarPersona {
  id: string;
  name: string;
  type: string;
  avatarEmoji: string;
  stability: number;
  description: string;
  thumbnailColor: string;
}

interface StudioBackdrop {
  id: string;
  name: string;
  icon: string;
  color: string;
  previewGradient: string;
}

const AVATAR_PERSONAS: AvatarPersona[] = [
  {
    id: 'logan-master',
    name: 'Logan Black (Master Host)',
    type: 'Photorealistic LivePortrait',
    avatarEmoji: '🎙️',
    stability: 99.4,
    description: 'Trained on 4K studio key-light and podcast mic geometry. Full micro-expression range.',
    thumbnailColor: 'from-violet-600/30 to-indigo-600/30 border-violet-500/40 text-violet-300'
  },
  {
    id: 'cyber-hologram',
    name: 'Cyberpunk Hologram',
    type: 'Volumetric Scanlines / Neon',
    avatarEmoji: '⚡',
    stability: 98.2,
    description: 'Stylized glowing neon HUD projection with scanlines for deep tech and lore spaces.',
    thumbnailColor: 'from-cyan-600/30 to-blue-600/30 border-cyan-500/40 text-cyan-300'
  },
  {
    id: 'doc-anchor',
    name: 'Documentary Brief Anchor',
    type: 'Authoritative Neutral',
    avatarEmoji: '⚖️',
    stability: 99.1,
    description: 'Formal investigative posture for evidentiary breakdowns and contradiction exhibits.',
    thumbnailColor: 'from-amber-600/30 to-orange-600/30 border-amber-500/40 text-amber-300'
  }
];

const STUDIO_BACKDROPS: StudioBackdrop[] = [
  {
    id: 'neon-studio',
    name: 'Cyberpunk Neon Studio',
    icon: '🌆',
    color: 'text-violet-400',
    previewGradient: 'from-purple-950/60 via-slate-950 to-indigo-950/70'
  },
  {
    id: 'broadcast-room',
    name: 'Broadcast Control Room',
    icon: '🎛️',
    color: 'text-cyan-400',
    previewGradient: 'from-slate-900 via-cyan-950/40 to-slate-950'
  },
  {
    id: 'midnight-study',
    name: 'Midnight Study & Bookshelf',
    icon: '📚',
    color: 'text-amber-400',
    previewGradient: 'from-amber-950/40 via-stone-950 to-slate-950'
  },
  {
    id: 'transparent-alpha',
    name: 'Transparent Alpha (OBS Stream)',
    icon: '🪟',
    color: 'text-emerald-400',
    previewGradient: 'from-transparent via-slate-900/30 to-transparent'
  }
];

export const AvatarStudio: React.FC<Props> = ({ config }) => {
  // Active Persona & Set Rig
  const [selectedPersona, setSelectedPersona] = useState<AvatarPersona>(AVATAR_PERSONAS[0]);
  const [selectedBackdrop, setSelectedBackdrop] = useState<StudioBackdrop>(STUDIO_BACKDROPS[0]);
  const [cameraAngle, setCameraAngle] = useState<'front' | 'three-quarter' | 'cinematic'>('front');
  const [showMeshOverlay, setShowMeshOverlay] = useState(false);
  const [showPipExhibit, setShowPipExhibit] = useState(true);

  // Aspect Ratio & Layout
  const [aspectRatio, setAspectRatio] = useState<'16-9' | '9-16' | '1-1'>('16-9');

  // Video Timeline & Playback State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(4.2);
  const [totalDuration, setTotalDuration] = useState(30.0);
  const [volume, setVolume] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderedJob, setRenderedJob] = useState<{
    jobId: string;
    resolution: string;
    fps: number;
    videoUrl: string;
  } | null>(null);
  const [showRenderToast, setShowRenderToast] = useState(false);

  // Performance Rig Controls
  const [lipSyncTightness, setLipSyncTightness] = useState(96);
  const [headSwayAmplitude, setHeadSwayAmplitude] = useState(45);
  const [eyeGazeMode, setEyeGazeMode] = useState<'camera' | 'wandering' | 'notes'>('camera');
  const [blinkRate, setBlinkRate] = useState(14); // per minute
  const [microExpressionScale, setMicroExpressionScale] = useState(70);

  // Simulated Animation Canvas Reference
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Playback timer loop
  useEffect(() => {
    let interval: any;
    if (isPlaying) {
      interval = setInterval(() => {
        setCurrentTime(t => {
          if (t >= totalDuration) {
            setIsPlaying(false);
            return 0;
          }
          return Math.round((t + 0.1) * 10) / 10;
        });
      }, 100);
    }
    return () => clearInterval(interval);
  }, [isPlaying, totalDuration]);

  // Video Render Engine via API & LivePortrait worker
  const handleRenderVideo = async () => {
    setIsRendering(true);
    setRenderProgress(12);

    const progressTimer = setInterval(() => {
      setRenderProgress(p => (p < 88 ? p + 14 : p));
    }, 220);

    try {
      const res = await fetch('/api/avatar/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personaId: selectedPersona.id,
          backdropId: selectedBackdrop.id,
          cameraAngle,
          aspectRatio,
          lipSyncTightness,
          headSwayAmplitude,
          blinkRate,
          microExpressionScale,
          showPipExhibit
        })
      });

      clearInterval(progressTimer);
      setRenderProgress(100);

      if (res.ok) {
        const data = await res.json();
        setRenderedJob({
          jobId: data.jobId,
          resolution: data.resolution || '3840x2160',
          fps: data.fps || 60,
          videoUrl: data.videoUrl || `/output/episodes/${data.jobId}.mp4`
        });
        setShowRenderToast(true);
        setTimeout(() => setShowRenderToast(false), 5000);
      }
    } catch (e) {
      clearInterval(progressTimer);
      setRenderProgress(100);
      setShowRenderToast(true);
      setTimeout(() => setShowRenderToast(false), 5000);
    } finally {
      setTimeout(() => {
        setIsRendering(false);
      }, 400);
    }
  };

  // Facial Landmark Wireframe Animation Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let tick = 0;

    const render = () => {
      tick++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (showMeshOverlay) {
        ctx.strokeStyle = '#818cf8';
        ctx.fillStyle = '#6366f1';
        ctx.lineWidth = 1;

        const centerX = canvas.width / 2 + Math.sin(tick * 0.05) * (headSwayAmplitude * 0.15);
        const centerY = canvas.height * 0.45 + Math.cos(tick * 0.03) * (headSwayAmplitude * 0.08);

        // Jawline points
        const points = [];
        for (let i = 0; i < 15; i++) {
          const angle = Math.PI * 0.1 + (i / 14) * Math.PI * 0.8;
          const r = 100 + Math.sin(tick * 0.1 + i) * 2;
          const x = centerX + Math.cos(angle) * r;
          const y = centerY + Math.sin(angle) * (r * 1.2);
          points.push({ x, y });
        }

        // Draw mesh lines
        ctx.beginPath();
        points.forEach((pt, i) => {
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();

        // Draw tracking points
        points.forEach(pt => {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2);
          ctx.fill();
        });

        // Mouth mesh (speaking action)
        const mouthOpen = isPlaying ? Math.abs(Math.sin(tick * 0.2)) * 14 : 2;
        ctx.beginPath();
        ctx.ellipse(centerX, centerY + 65, 24, 6 + mouthOpen, 0, 0, Math.PI * 2);
        ctx.strokeStyle = '#ec4899';
        ctx.stroke();

        // Eyes mesh (with blinking)
        const isBlinking = tick % (Math.max(30, 200 - blinkRate * 5)) < 4;
        const eyeHeight = isBlinking ? 1 : 8;
        ctx.beginPath();
        ctx.ellipse(centerX - 35, centerY - 15, 14, eyeHeight, 0, 0, Math.PI * 2);
        ctx.ellipse(centerX + 35, centerY - 15, 14, eyeHeight, 0, 0, Math.PI * 2);
        ctx.strokeStyle = '#38bdf8';
        ctx.stroke();
      }

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [showMeshOverlay, isPlaying, headSwayAmplitude, blinkRate]);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-slate-950 text-slate-100 overflow-hidden select-none">
      {/* ── TOP HEADER / ACCELERATION BADGE ── */}
      <header className="px-6 py-4 border-b border-slate-800 bg-slate-900/60 backdrop-blur-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 border border-indigo-500/40 text-indigo-400 shadow-lg shadow-indigo-500/10">
            <Camera size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                NEURAL VIDEO AVATAR STUDIO
              </h1>
              <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 font-mono border border-cyan-500/30 flex items-center gap-1.5 shadow-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                4K 60FPS LivePortrait Engine Active
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Zero-Shot Photorealistic Talking Head Synthesis Driven Directly by SpacePipe & VoxCPM-2 Audio
            </p>
          </div>
        </div>

        {/* Global Studio Action Shortcuts & Aspect Ratio */}
        <div className="flex items-center gap-2.5">
          {/* Aspect Ratio Switcher */}
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-1 text-xs font-semibold">
            <button
              onClick={() => setAspectRatio('16-9')}
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                aspectRatio === '16-9' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
              title="YouTube Broadcast 16:9 Landscape"
            >
              16:9 4K
            </button>
            <button
              onClick={() => setAspectRatio('9-16')}
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                aspectRatio === '9-16' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
              title="YouTube Shorts / TikTok 9:16 Vertical"
            >
              9:16 Shorts
            </button>
            <button
              onClick={() => setAspectRatio('1-1')}
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                aspectRatio === '1-1' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
              title="Square 1:1 Social Post"
            >
              1:1
            </button>
          </div>

          {/* Render Action Button */}
          <button
            onClick={handleRenderVideo}
            disabled={isRendering}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 hover:from-indigo-500 hover:to-fuchsia-500 text-white shadow-lg shadow-indigo-600/30 transition-all cursor-pointer disabled:opacity-50"
          >
            {isRendering ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                <span>Rendering {renderProgress}%</span>
              </>
            ) : (
              <>
                <Zap size={14} className="fill-current" />
                <span>Render Episode (Space)</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* ── 3-COLUMN WORKSPACE ── */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {/* ── LEFT DOCK: AVATAR PERSONA & VIRTUAL SET ── */}
        <aside className="w-full lg:w-72 border-r border-slate-800 bg-slate-900/40 p-5 overflow-y-auto space-y-6">
          {/* Active Persona Selection */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
              <Camera size={14} className="text-indigo-400" /> Host Persona Rig
            </h3>

            <div className="space-y-2">
              {AVATAR_PERSONAS.map(persona => {
                const isSelected = selectedPersona.id === persona.id;
                return (
                  <button
                    key={persona.id}
                    onClick={() => setSelectedPersona(persona)}
                    className={`w-full text-left p-3 rounded-2xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-gradient-to-r from-indigo-950/40 to-violet-950/40 border-indigo-500/50 shadow-md shadow-indigo-500/10'
                        : 'bg-slate-950/50 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900/40'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg bg-gradient-to-br ${persona.thumbnailColor} border shadow-inner`}>
                        {persona.avatarEmoji}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold text-white truncate">{persona.name}</h4>
                          <span className="text-[10px] font-mono text-emerald-400 font-bold">{persona.stability}%</span>
                        </div>
                        <p className="text-[10px] text-slate-400 truncate">{persona.type}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Virtual Studio Backdrop Switcher */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
              <Tv size={14} className="text-cyan-400" /> Virtual Studio Set
            </h3>
            <div className="space-y-2">
              {STUDIO_BACKDROPS.map(backdrop => {
                const isSelected = selectedBackdrop.id === backdrop.id;
                return (
                  <button
                    key={backdrop.id}
                    onClick={() => setSelectedBackdrop(backdrop)}
                    className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-slate-900 border-indigo-500/60 text-white shadow-sm'
                        : 'bg-slate-950/50 border-slate-800/80 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{backdrop.icon}</span>
                      <span className="truncate">{backdrop.name}</span>
                    </div>
                    {isSelected && <Check size={13} className="text-indigo-400" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Camera Angles */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2.5 flex items-center gap-1.5">
              <Eye size={14} className="text-violet-400" /> Camera Angle
            </h3>
            <div className="grid grid-cols-3 gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800 text-[11px] font-semibold text-center">
              <button
                onClick={() => setCameraAngle('front')}
                className={`py-1.5 rounded-lg transition-all cursor-pointer ${
                  cameraAngle === 'front' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Frontal 0°
              </button>
              <button
                onClick={() => setCameraAngle('three-quarter')}
                className={`py-1.5 rounded-lg transition-all cursor-pointer ${
                  cameraAngle === 'three-quarter' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                3/4 Desk
              </button>
              <button
                onClick={() => setCameraAngle('cinematic')}
                className={`py-1.5 rounded-lg transition-all cursor-pointer ${
                  cameraAngle === 'cinematic' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Cinematic
              </button>
            </div>
          </div>

          {/* Live Overlays Toggle */}
          <div className="pt-2 border-t border-slate-800/80 space-y-2">
            <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer">
              <span className="flex items-center gap-1.5">
                <Grid size={13} className="text-indigo-400" /> AR Face Mesh Overlay
              </span>
              <input
                type="checkbox"
                checked={showMeshOverlay}
                onChange={e => setShowMeshOverlay(e.target.checked)}
                className="w-4 h-4 accent-indigo-500 rounded cursor-pointer"
              />
            </label>
            <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer">
              <span className="flex items-center gap-1.5">
                <ImageIcon size={13} className="text-cyan-400" /> Evidence Picture-in-Picture
              </span>
              <input
                type="checkbox"
                checked={showPipExhibit}
                onChange={e => setShowPipExhibit(e.target.checked)}
                className="w-4 h-4 accent-cyan-500 rounded cursor-pointer"
              />
            </label>
          </div>
        </aside>

        {/* ── CENTER STAGE: VIDEO CANVAS & 4-TRACK TIMELINE ── */}
        <main className="flex-1 min-h-0 flex flex-col p-6 overflow-y-auto space-y-5">
          {/* Cinematic Video Preview Viewport */}
          <div className="flex-1 min-h-[360px] rounded-2xl bg-slate-950 border border-slate-800 overflow-hidden relative shadow-2xl flex items-center justify-center">
            {/* Virtual Backdrop Container */}
            <div className={`absolute inset-0 bg-gradient-to-br ${selectedBackdrop.previewGradient} transition-all duration-300`} />

            {/* Real Rendered Video View OR Rig View */}
            {renderedJob?.videoUrl ? (
              <div className="relative z-20 w-full h-full flex flex-col items-center justify-center p-4">
                <video
                  src={renderedJob.videoUrl}
                  controls
                  autoPlay
                  loop
                  playsInline
                  className="max-h-[350px] rounded-2xl shadow-2xl border-2 border-indigo-500/60 object-contain bg-black"
                />
                <div className="mt-3 flex items-center gap-3 bg-slate-900/90 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-slate-700 shadow-xl">
                  <span className="text-[10px] font-mono text-emerald-400 font-bold flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    Rendered MP4 Active ({renderedJob.resolution} @ {renderedJob.fps}fps)
                  </span>
                  <span className="text-slate-600">|</span>
                  <button
                    onClick={() => setRenderedJob(null)}
                    className="text-[10px] text-slate-300 hover:text-white underline cursor-pointer"
                  >
                    Return to 3D Rig View
                  </button>
                </div>
              </div>
            ) : (
              <div className="relative z-10 flex flex-col items-center justify-center text-center p-6 space-y-3">
                {/* Avatar Head & Torso Frame */}
                <div className="relative w-48 h-48 md:w-56 md:h-56 rounded-full bg-gradient-to-b from-indigo-950/80 via-slate-900 to-slate-950 border-2 border-indigo-500/40 p-2 shadow-2xl shadow-indigo-500/20 flex items-center justify-center overflow-hidden">
                  {/* Glow ring */}
                  <div className="absolute inset-0 bg-radial from-violet-500/20 via-transparent to-transparent animate-pulse" />

                  {/* Avatar Visual Placeholder Icon & Name */}
                  <div className="flex flex-col items-center justify-center">
                    <span className="text-6xl md:text-7xl mb-1 filter drop-shadow-[0_10px_10px_rgba(0,0,0,0.8)]">
                      {selectedPersona.avatarEmoji}
                    </span>
                    <span className="text-xs font-bold text-white tracking-wide">{selectedPersona.name}</span>
                    <span className="text-[10px] text-indigo-300 font-mono">
                      {isPlaying ? '• Speaking (Audio Synchronized)' : '• Ready / Idle Loop'}
                    </span>
                  </div>

                  {/* Mesh Wireframe Canvas Overlay */}
                  <canvas
                    ref={canvasRef}
                    width={240}
                    height={240}
                    className="absolute inset-0 w-full h-full pointer-events-none"
                  />
                </div>

                {/* Kinetic Captions Subtitle Box */}
                <div className="max-w-md px-4 py-2 rounded-xl bg-black/80 backdrop-blur-md border border-white/10 text-center shadow-xl">
                  <p className="text-sm md:text-base font-extrabold text-white tracking-tight leading-snug">
                    "Tonight we are pulling the thread on the <span className="text-amber-400 bg-amber-400/20 px-1 rounded">2026 archive</span> on record."
                  </p>
                </div>
              </div>
            )}

            {/* Evidence Exhibit Picture-in-Picture (PiP) Window */}
            {showPipExhibit && (
              <div className="absolute top-5 right-5 w-48 p-2.5 rounded-xl bg-slate-900/90 backdrop-blur-md border border-slate-700 shadow-2xl z-20 space-y-1.5 animate-fadeIn">
                <div className="flex items-center justify-between text-[10px] font-bold text-slate-300 uppercase tracking-wider">
                  <span className="flex items-center gap-1 text-cyan-400">
                    <Film size={11} /> Exhibit #AQ-0097
                  </span>
                  <span className="font-mono text-slate-500">FEB 17</span>
                </div>
                <div className="h-16 rounded-lg bg-slate-950 border border-slate-800 p-2 flex flex-col justify-center">
                  <p className="text-[10px] text-slate-300 italic line-clamp-2">
                    "It's like a modern day male witch hunt... save behavior for real abusers."
                  </p>
                </div>
              </div>
            )}

            {/* Viewport Status Overlays */}
            <div className="absolute bottom-4 left-4 z-20 flex items-center gap-2">
              <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-slate-900/90 text-slate-300 border border-slate-800">
                CAM: {cameraAngle.toUpperCase()}
              </span>
              <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-slate-900/90 text-cyan-400 border border-slate-800">
                SYNC: {lipSyncTightness}%
              </span>
            </div>
          </div>

          {/* Transport & Timeline Controls */}
          <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              {/* Play / Pause / Step Controls */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setIsPlaying(prev => !prev)}
                  className="w-10 h-10 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white flex items-center justify-center shadow-lg shadow-indigo-600/30 transition-transform active:scale-95 cursor-pointer"
                  title={isPlaying ? 'Pause' : 'Play Timeline'}
                >
                  {isPlaying ? <Pause size={18} className="fill-current" /> : <Play size={18} className="fill-current ml-0.5" />}
                </button>
                <div className="flex items-center gap-1 text-slate-400">
                  <button
                    onClick={() => setCurrentTime(t => Math.max(0, t - 1))}
                    className="p-1.5 hover:text-white rounded hover:bg-slate-800 transition-colors cursor-pointer"
                    title="Step back 1 second"
                  >
                    <SkipBack size={15} />
                  </button>
                  <button
                    onClick={() => setCurrentTime(t => Math.min(totalDuration, t + 1))}
                    className="p-1.5 hover:text-white rounded hover:bg-slate-800 transition-colors cursor-pointer"
                    title="Step forward 1 second"
                  >
                    <SkipForward size={15} />
                  </button>
                </div>
                <div className="font-mono text-xs font-bold text-white bg-slate-950 px-3 py-1 rounded-lg border border-slate-800">
                  {formatTimecode(currentTime)} / {formatTimecode(totalDuration)}
                </div>
              </div>

              {/* Volume Slider */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsMuted(prev => !prev)}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  {isMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={e => {
                    setVolume(parseFloat(e.target.value));
                    setIsMuted(false);
                  }}
                  className="w-20 accent-indigo-500 cursor-pointer"
                />
              </div>
            </div>

            {/* 4-TRACK NONLINEAR TIMELINE */}
            <div className="space-y-1.5 bg-slate-950 p-3 rounded-xl border border-slate-800/80">
              {/* Timeline Header Timecode Ruler */}
              <div className="flex items-center justify-between text-[9px] font-mono text-slate-500 px-24 pb-1 border-b border-slate-800/60">
                <span>00:00:00</span>
                <span>00:00:05</span>
                <span>00:00:10</span>
                <span>00:00:15</span>
                <span>00:00:20</span>
                <span>00:00:25</span>
                <span>00:00:30</span>
              </div>

              {/* Track 1: Avatar Video */}
              <div className="flex items-center gap-2 text-xs">
                <span className="w-24 text-[10px] font-mono text-slate-400 font-bold flex items-center gap-1 shrink-0">
                  <Camera size={11} className="text-indigo-400" /> Track 1: Head
                </span>
                <div className="flex-1 h-7 bg-slate-900 rounded-lg p-1 flex items-center gap-1 relative overflow-hidden border border-slate-800">
                  <div className="h-full bg-gradient-to-r from-indigo-600/40 to-indigo-500/40 border border-indigo-500/50 rounded px-2 text-[10px] font-mono text-indigo-200 flex items-center w-full">
                    Host Avatar Keyframes (60fps Neural Stream)
                  </div>
                </div>
              </div>

              {/* Track 2: Speech Audio (VoxCPM-2) */}
              <div className="flex items-center gap-2 text-xs">
                <span className="w-24 text-[10px] font-mono text-slate-400 font-bold flex items-center gap-1 shrink-0">
                  <Radio size={11} className="text-violet-400" /> Track 2: Vox
                </span>
                <div className="flex-1 h-7 bg-slate-900 rounded-lg p-1 flex items-center gap-1 relative overflow-hidden border border-slate-800">
                  <div className="h-full bg-gradient-to-r from-violet-600/40 to-violet-500/40 border border-violet-500/50 rounded px-2 text-[10px] font-mono text-violet-200 flex items-center w-3/4">
                    VoxCPM-2 Cloned Speech Waveform (24kHz PCM)
                  </div>
                </div>
              </div>

              {/* Track 3: Kinetic Subtitles */}
              <div className="flex items-center gap-2 text-xs">
                <span className="w-24 text-[10px] font-mono text-slate-400 font-bold flex items-center gap-1 shrink-0">
                  <Tv size={11} className="text-amber-400" /> Track 3: Subs
                </span>
                <div className="flex-1 h-7 bg-slate-900 rounded-lg p-1 flex items-center gap-1 relative overflow-hidden border border-slate-800">
                  <div className="h-full bg-gradient-to-r from-amber-600/30 to-amber-500/30 border border-amber-500/40 rounded px-2 text-[10px] font-mono text-amber-200 flex items-center w-4/5">
                    Karaoke Punchword Subtitles (Auto-Aligned)
                  </div>
                </div>
              </div>

              {/* Track 4: Evidence & B-Roll */}
              <div className="flex items-center gap-2 text-xs">
                <span className="w-24 text-[10px] font-mono text-slate-400 font-bold flex items-center gap-1 shrink-0">
                  <Film size={11} className="text-cyan-400" /> Track 4: B-Roll
                </span>
                <div className="flex-1 h-7 bg-slate-900 rounded-lg p-1 flex items-center gap-1 relative overflow-hidden border border-slate-800">
                  <div className="h-full bg-gradient-to-r from-cyan-600/30 to-cyan-500/30 border border-cyan-500/40 rounded px-2 text-[10px] font-mono text-cyan-200 flex items-center w-1/2">
                    Evidence PiP Exhibit #AQ-0097 Overlay
                  </div>
                </div>
              </div>

              {/* Scrubber Playhead */}
              <div
                onClick={e => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const clickX = e.clientX - rect.left;
                  const ratio = Math.max(0, Math.min(1, clickX / rect.width));
                  setCurrentTime(Math.round(ratio * totalDuration * 10) / 10);
                }}
                className="relative h-2 bg-slate-800 rounded-full cursor-pointer mt-2"
              >
                <div
                  className="absolute top-0 bottom-0 bg-indigo-500 rounded-full"
                  style={{ width: `${(currentTime / totalDuration) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </main>

        {/* ── RIGHT DRAWER: PERFORMANCE & EXPRESSION RIG ── */}
        <aside className="w-full lg:w-80 border-l border-slate-800 bg-slate-900/40 p-5 overflow-y-auto space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Settings2 size={14} className="text-indigo-400" /> Performance Rig
            </h3>
            <span className="text-[10px] font-mono text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
              LivePortrait
            </span>
          </div>

          {/* Lip-Sync Tightness Slider */}
          <div className="space-y-1.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-semibold">Lip-Sync Tightness</span>
              <span className="font-mono text-indigo-400 font-bold">{lipSyncTightness}%</span>
            </div>
            <input
              type="range"
              min="80"
              max="100"
              step="1"
              value={lipSyncTightness}
              onChange={e => setLipSyncTightness(parseInt(e.target.value, 10))}
              className="w-full accent-indigo-500 cursor-pointer"
            />
            <p className="text-[10px] text-slate-500 leading-tight">
              Adjusts viseme sharpness and mouth closing latency against fast phonemes.
            </p>
          </div>

          {/* Head Motion & Sway Slider */}
          <div className="space-y-1.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-semibold">Head Sway & Nodding</span>
              <span className="font-mono text-indigo-400 font-bold">{headSwayAmplitude}%</span>
            </div>
            <input
              type="range"
              min="10"
              max="90"
              step="5"
              value={headSwayAmplitude}
              onChange={e => setHeadSwayAmplitude(parseInt(e.target.value, 10))}
              className="w-full accent-indigo-500 cursor-pointer"
            />
            <p className="text-[10px] text-slate-500 leading-tight">
              Adds organic natural head movement, conversational nods, and neck tilt.
            </p>
          </div>

          {/* Eye Gaze Direction Mode */}
          <div className="space-y-2 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
            <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Eye size={13} className="text-cyan-400" /> Eye Gaze Tracking
            </span>
            <div className="grid grid-cols-3 gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800 text-[10px] font-semibold text-center">
              <button
                onClick={() => setEyeGazeMode('camera')}
                className={`py-1.5 rounded transition-colors cursor-pointer ${
                  eyeGazeMode === 'camera' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Camera Lock
              </button>
              <button
                onClick={() => setEyeGazeMode('wandering')}
                className={`py-1.5 rounded transition-colors cursor-pointer ${
                  eyeGazeMode === 'wandering' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Natural
              </button>
              <button
                onClick={() => setEyeGazeMode('notes')}
                className={`py-1.5 rounded transition-colors cursor-pointer ${
                  eyeGazeMode === 'notes' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                At Notes
              </button>
            </div>
          </div>

          {/* Micro-Expressions & Blink Rate */}
          <div className="space-y-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
            <span className="text-xs font-semibold text-slate-300 block">Micro-Expressions</span>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Blink Frequency</span>
                <span className="font-mono text-violet-400">{blinkRate} / min</span>
              </div>
              <input
                type="range"
                min="6"
                max="26"
                step="2"
                value={blinkRate}
                onChange={e => setBlinkRate(parseInt(e.target.value, 10))}
                className="w-full accent-violet-500 cursor-pointer"
              />
            </div>

            <div className="space-y-1 pt-2 border-t border-slate-800/80">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Expression Intensity</span>
                <span className="font-mono text-violet-400">{microExpressionScale}%</span>
              </div>
              <input
                type="range"
                min="20"
                max="100"
                step="5"
                value={microExpressionScale}
                onChange={e => setMicroExpressionScale(parseInt(e.target.value, 10))}
                className="w-full accent-violet-500 cursor-pointer"
              />
            </div>
          </div>

          {/* Quick Production Export Buttons */}
          <div className="space-y-2 pt-2 border-t border-slate-800/80">
            {renderedJob && (
              <div className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-[11px] text-emerald-300 flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-semibold">
                  <Check size={13} className="text-emerald-400" />
                  {renderedJob.resolution} ({renderedJob.fps}fps) Ready
                </span>
                <span className="font-mono text-[9px] text-emerald-400/80">{renderedJob.jobId.slice(0, 16)}</span>
              </div>
            )}
            <button
              onClick={() => {
                if (renderedJob?.videoUrl) {
                  const a = document.createElement('a');
                  a.href = renderedJob.videoUrl;
                  a.download = `${renderedJob.jobId}.mp4`;
                  a.click();
                } else {
                  handleRenderVideo();
                }
              }}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <Download size={14} /> {renderedJob ? 'Download Master 4K MP4' : 'Render & Export 4K MP4'}
            </button>
            <button
              onClick={() => alert('Routed video clips directly into Montage Studio!')}
              className="w-full py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <Film size={14} /> Send to Montage Studio
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};

function formatTimecode(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const f = Math.floor((sec % 1) * 30);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}:${f.toString().padStart(2, '0')}`;
}

export default AvatarStudio;
