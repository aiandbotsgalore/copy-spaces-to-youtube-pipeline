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
  AlertTriangle,
  Image as ImageIcon,
  Upload,
  Music,
  Mic,
  X,
  User,
  SlidersHorizontal,
  Info,
  ExternalLink
} from 'lucide-react';
import { EnhancedConfig } from '../types';
import { useMontage } from '../contexts/MontageContext';
import { AvatarCropModal } from './AvatarCropModal';

interface Props {
  config: EnhancedConfig;
}

export interface AvatarPersona {
  id: string;
  name: string;
  type: string;
  avatarEmoji: string;
  stability: number;
  description: string;
  thumbnailColor: string;
  avatarUrl: string;
  category: 'host' | 'speaker' | 'custom';
  isCustom?: boolean;
}

export interface DrivingAudioSource {
  id: string;
  name: string;
  category: 'sample' | 'vox' | 'montage' | 'upload';
  durationSec: number;
  url: string;
  base64?: string;
  description?: string;
}

interface StudioBackdrop {
  id: string;
  name: string;
  icon: string;
  color: string;
  previewGradient: string;
}

interface RenderedAvatarJob {
  jobId: string;
  resolution: string;
  fps: number;
  videoUrl: string;
  durationSec?: number | null;
  renderMode?: string;
  warning?: string;
}

const DEFAULT_PERSONAS: AvatarPersona[] = [
  {
    id: 'logan-master',
    name: 'Logan Black (Master Host)',
    type: 'Photorealistic LivePortrait',
    avatarEmoji: '🎙️',
    stability: 99.4,
    description: 'Trained on 4K studio key-light and podcast mic geometry. Full micro-expression range.',
    thumbnailColor: 'from-violet-600/30 to-indigo-600/30 border-violet-500/40 text-violet-300',
    avatarUrl: '/avatars/logan.jpg',
    category: 'host'
  },
  {
    id: 'cyber-hologram',
    name: 'Cyberpunk Hologram',
    type: 'Volumetric Scanlines / Neon',
    avatarEmoji: '⚡',
    stability: 98.2,
    description: 'Stylized glowing neon HUD projection with scanlines for deep tech and lore spaces.',
    thumbnailColor: 'from-cyan-600/30 to-blue-600/30 border-cyan-500/40 text-cyan-300',
    avatarUrl: '/avatars/speaker_4.jpg',
    category: 'host'
  },
  {
    id: 'doc-anchor',
    name: 'Documentary Brief Anchor',
    type: 'Authoritative Neutral',
    avatarEmoji: '⚖️',
    stability: 99.1,
    description: 'Formal investigative posture for evidentiary breakdowns and contradiction exhibits.',
    thumbnailColor: 'from-amber-600/30 to-orange-600/30 border-amber-500/40 text-amber-300',
    avatarUrl: '/avatars/speaker_3.jpg',
    category: 'host'
  },
  {
    id: 'speaker-angela',
    name: 'Angela Maggard',
    type: 'Archive Speaker Profile',
    avatarEmoji: '🎙️',
    stability: 98.9,
    description: 'Investigative archive speaker with enrolled acoustic voiceprint profile.',
    thumbnailColor: 'from-rose-600/30 to-red-600/30 border-rose-500/40 text-rose-300',
    avatarUrl: '/avatars/angela.jpg',
    category: 'speaker'
  },
  {
    id: 'speaker-eric-hecker',
    name: 'Eric Hecker',
    type: 'South Pole / Defense Witness',
    avatarEmoji: '🧊',
    stability: 98.7,
    description: 'Acoustic voiceprint enrolled witness with verified Raytheon/South Pole affidavit record.',
    thumbnailColor: 'from-blue-600/30 to-cyan-600/30 border-blue-500/40 text-blue-300',
    avatarUrl: '/avatars/eric_hecker.jpg',
    category: 'speaker'
  },
  {
    id: 'speaker-jason-sands',
    name: 'Jason Sands',
    type: 'Legacy Program Witness',
    avatarEmoji: '🛸',
    stability: 98.4,
    description: 'Classified retrieval program testimony witness with high-contrast profile photo.',
    thumbnailColor: 'from-emerald-600/30 to-teal-600/30 border-emerald-500/40 text-emerald-300',
    avatarUrl: '/avatars/jason_sands.jpg',
    category: 'speaker'
  }
];

const DEFAULT_AUDIO_SOURCES: DrivingAudioSource[] = [
  {
    id: 'sample-logan',
    name: 'Logan Master Reference (Podcast)',
    category: 'sample',
    durationSec: 15.0,
    url: '/speaker_samples/Logan/master_reference.wav',
    description: '44.1kHz PCM master studio microphone reference'
  },
  {
    id: 'vox-logan-001',
    name: 'LOGAN_001 (VoxCPM-2 Synthesized)',
    category: 'vox',
    durationSec: 14.5,
    url: '/output/vox/LOGAN_001.mp3',
    description: 'Cloned neural speech generated in Vox Studio'
  },
  {
    id: 'vox-take-09b',
    name: 'Documentary Brief Take 09b',
    category: 'vox',
    durationSec: 12.0,
    url: '/output/vox/take_09be656bb3f8246d.mp3',
    description: 'Script Studio narrative dialogue track'
  },
  {
    id: 'vox-dessa',
    name: 'Narrative Master Take (Longform)',
    category: 'vox',
    durationSec: 45.0,
    url: '/output/vox/dessa_speech_logan.mp3',
    description: 'Extended investigative narration sample'
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
  // ── STEP 1: PERSONA & FACE STATE ──
  const [personas, setPersonas] = useState<AvatarPersona[]>(DEFAULT_PERSONAS);
  const [selectedPersona, setSelectedPersona] = useState<AvatarPersona>(DEFAULT_PERSONAS[0]);
  const [personaFilter, setPersonaFilter] = useState<'all' | 'host' | 'speaker' | 'custom'>('all');
  const [cropModalFile, setCropModalFile] = useState<File | null>(null);
  const faceInputRef = useRef<HTMLInputElement | null>(null);

  // ── STEP 2: DRIVING AUDIO / VOICE STATE ──
  const montage = useMontage();
  const [audioSources, setAudioSources] = useState<DrivingAudioSource[]>(DEFAULT_AUDIO_SOURCES);
  const [selectedAudio, setSelectedAudio] = useState<DrivingAudioSource>(DEFAULT_AUDIO_SOURCES[0]);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // Sync Montage Context clips into audio sources if any exist
  useEffect(() => {
    if (montage.clips && montage.clips.length > 0) {
      const montageSources: DrivingAudioSource[] = montage.clips
        .filter((c): c is typeof c & { audioUrl: string } => typeof c.audioUrl === 'string' && c.audioUrl.length > 0)
        .map(c => ({
          id: `montage-${c.id}`,
          name: c.title || `Montage Clip ${c.id.slice(0, 8)}`,
          category: 'montage' as const,
          durationSec: Math.max(1, (c.endSec - c.startSec) || c.sourceDurationSec || 15),
          url: c.audioUrl,
          description: `Imported from Montage Studio (${c.speaker || 'Clip'})`
        }));

      setAudioSources(prev => {
        const existingIds = new Set(prev.map(s => s.id));
        const newOnes = montageSources.filter(s => !existingIds.has(s.id));
        return newOnes.length > 0 ? [...newOnes, ...prev] : prev;
      });
    }
  }, [montage.clips]);

  // ── STEP 3: VIRTUAL STAGE & PERFORMANCE RIG ──
  const [selectedBackdrop, setSelectedBackdrop] = useState<StudioBackdrop>(STUDIO_BACKDROPS[0]);
  const [cameraAngle, setCameraAngle] = useState<'front' | 'three-quarter' | 'cinematic'>('front');
  const [showMeshOverlay, setShowMeshOverlay] = useState(false);
  const [showPipExhibit, setShowPipExhibit] = useState(true);
  const [aspectRatio, setAspectRatio] = useState<'16-9' | '9-16' | '1-1'>('16-9');

  // Performance Controls
  const [lipSyncTightness, setLipSyncTightness] = useState(96);
  const [headSwayAmplitude, setHeadSwayAmplitude] = useState(45);
  const [eyeGazeMode, setEyeGazeMode] = useState<'camera' | 'wandering' | 'notes'>('camera');
  const [blinkRate, setBlinkRate] = useState(14);
  const [microExpressionScale, setMicroExpressionScale] = useState(70);

  // ── STEP 4: TIMELINE, PREVIEW & RENDERING ──
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0.0);
  const [totalDuration, setTotalDuration] = useState(selectedAudio.durationSec);
  const [volume, setVolume] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);

  // Generation Engine State
  const [renderEngine, setRenderEngine] = useState<'kaggle' | 'local'>('kaggle');
  const [latentSteps, setLatentSteps] = useState<number>(6);
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderedJob, setRenderedJob] = useState<RenderedAvatarJob | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderWarning, setRenderWarning] = useState<string | null>(null);
  const [kaggleRunStatus, setKaggleRunStatus] = useState<{
    runId?: number;
    status?: string;
    conclusion?: string;
    url?: string;
    stageText?: string;
  } | null>(null);
  const [isPollingKaggle, setIsPollingKaggle] = useState(false);
  const kagglePollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const renderAbortRef = useRef<AbortController | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Canvas Reference for simulated wireframe overlay
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const showToast = (msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(msg);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 4000);
  };

  useEffect(() => () => {
    renderAbortRef.current?.abort();
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    if (kagglePollTimerRef.current) clearInterval(kagglePollTimerRef.current);
  }, []);

  // Check for active or recently completed Kaggle GPU render on mount
  useEffect(() => {
    let active = true;
    const owner = config.ownerName || 'aiandbotsgalore';
    const repo = config.repoName || 'copy-spaces-to-youtube-pipeline';
    fetch(`/api/avatar/render?action=status&owner=${owner}&repo=${repo}&targetTag=spaces-live-stage-test-20261029`)
      .then(res => res.json())
      .then(data => {
        if (!active || !data || !data.ok) return;
        setKaggleRunStatus({
          runId: data.runId,
          status: data.status,
          conclusion: data.conclusion,
          url: data.htmlUrl,
          stageText: data.status === 'in_progress'
            ? 'Kaggle Dual-T4 active: synthesizing EchoMimic / Wav2Lip neural lip-sync...'
            : data.status === 'queued'
              ? 'Job queued on GitHub runner / Kaggle pool...'
              : `Job ${data.status} (${data.conclusion || 'ready'})`
        });
        if (data.status === 'in_progress' || data.status === 'queued') {
          setIsRendering(true);
          setIsPollingKaggle(true);
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, [config.ownerName, config.repoName]);

  // Sync totalDuration whenever selectedAudio changes
  useEffect(() => {
    if (selectedAudio && Number.isFinite(selectedAudio.durationSec) && selectedAudio.durationSec > 0) {
      setTotalDuration(selectedAudio.durationSec);
      setCurrentTime(0);
      setIsPlaying(false);
    }
  }, [selectedAudio]);

  // Synchronize native audio player with timeline isPlaying state
  useEffect(() => {
    const audio = audioPlayerRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.volume = isMuted ? 0 : volume;
      audio.currentTime = currentTime;
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [isPlaying]);

  // Volume & Mute Sync
  useEffect(() => {
    const audio = audioPlayerRef.current;
    if (audio) {
      audio.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  // Handle Audio Time Updates
  const handleAudioTimeUpdate = () => {
    const audio = audioPlayerRef.current;
    if (audio && isPlaying) {
      setCurrentTime(Math.round(audio.currentTime * 10) / 10);
    }
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    if (audioPlayerRef.current) {
      audioPlayerRef.current.currentTime = 0;
    }
  };

  // Playhead scrubber
  const handleSeek = (timeSec: number) => {
    const clamped = Math.max(0, Math.min(totalDuration, Math.round(timeSec * 10) / 10));
    setCurrentTime(clamped);
    if (audioPlayerRef.current) {
      audioPlayerRef.current.currentTime = clamped;
    }
  };

  // File upload handlers for Custom Face
  const handleFaceFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCropModalFile(file);
    if (faceInputRef.current) faceInputRef.current.value = '';
  };

  const handleCustomFaceConfirmed = (blob: Blob) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      const customId = `custom-face-${Date.now()}`;
      const newPersona: AvatarPersona = {
        id: customId,
        name: `Custom Face (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`,
        type: 'Custom User Upload (512x512)',
        avatarEmoji: '👤',
        stability: 98.8,
        description: 'User-provided portrait cropped to 512x512 square for neural keyframe driving.',
        thumbnailColor: 'from-fuchsia-600/30 to-pink-600/30 border-fuchsia-500/40 text-fuchsia-300',
        avatarUrl: base64,
        category: 'custom',
        isCustom: true
      };

      setPersonas(prev => [newPersona, ...prev]);
      setSelectedPersona(newPersona);
      setCropModalFile(null);
      showToast('📸 Custom face framed and active on rig!');
    };
    reader.readAsDataURL(blob);
  };

  // File upload handler for Custom Driving Audio
  const handleAudioFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const tempAudio = new Audio(url);

    tempAudio.onloadedmetadata = () => {
      const dur = Math.round((tempAudio.duration || 15) * 10) / 10;
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        const newAudio: DrivingAudioSource = {
          id: `custom-audio-${Date.now()}`,
          name: file.name.replace(/\.[^/.]+$/, ''),
          category: 'upload',
          durationSec: dur,
          url,
          base64,
          description: `Local upload: ${(file.size / 1024).toFixed(0)} KB`
        };

        setAudioSources(prev => [newAudio, ...prev]);
        setSelectedAudio(newAudio);
        setTotalDuration(dur);
        setCurrentTime(0);
        showToast(`🎵 Loaded driving audio "${file.name}" (${dur}s)`);
      };
      reader.readAsDataURL(file);
    };

    if (audioInputRef.current) audioInputRef.current.value = '';
  };

  // ── TRIGGER VIDEO RENDER PIPELINE ──
  const handleRenderVideo = async () => {
    renderAbortRef.current?.abort();
    if (kagglePollTimerRef.current) {
      clearInterval(kagglePollTimerRef.current);
      kagglePollTimerRef.current = null;
    }
    const controller = new AbortController();
    renderAbortRef.current = controller;

    setIsRendering(true);
    setRenderProgress(10);
    setRenderError(null);
    setRenderWarning(null);

    // Realistic progress staging simulation for local draft
    const progressTimer = setInterval(() => {
      setRenderProgress(p => (p < 90 ? p + 12 : p));
    }, 280);

    try {
      const owner = config.ownerName || 'aiandbotsgalore';
      const repo = config.repoName || 'copy-spaces-to-youtube-pipeline';

      // ── MODE 1: CLOUD GPU (KAGGLE DUAL-T4 + ECHOMIMIC / WAV2LIP) ──
      if (renderEngine === 'kaggle') {
        const payload: Record<string, any> = {
          engine: 'kaggle',
          personaId: selectedPersona.id,
          personaName: selectedPersona.name,
          avatarUrl: selectedPersona.avatarUrl,
          audioUrl: selectedAudio.url,
          durationSec: totalDuration,
          aspectRatio,
          ownerName: owner,
          repoName: repo,
          githubToken: config.githubToken,
          targetReleaseTag: 'spaces-live-stage-test-20261029',
          latentSteps,
          renderQuality: latentSteps <= 4 ? 'draft' : 'standard',
          lipSyncTightness,
          headSwayAmplitude,
          eyeGazeMode,
          blinkRate,
          microExpressionScale,
          showMeshOverlay,
          showPipExhibit,
        };

        const res = await fetch('/api/avatar/render', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(config.githubToken ? { 'Authorization': `token ${config.githubToken}` } : {})
          },
          signal: controller.signal,
          body: JSON.stringify(payload)
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok || (!data.ok && !data.dispatched && data.status !== 'dispatched')) {
          const detail = data.message || data.error || (res.status === 401 ? 'GitHub token unauthorized or expired' : `Workflow dispatch failed (HTTP ${res.status})`);
          throw new Error(detail);
        }

        clearInterval(progressTimer);
        setRenderProgress(25);
        showToast('🚀 Kaggle Dual-T4 GPU worker dispatched! Monitoring neural render...');
        setIsPollingKaggle(true);
        const workflowUrl = data.workflowRunsUrl || `https://github.com/${owner}/${repo}/actions/workflows/generate_avatar_short.yml`;
        setKaggleRunStatus({
          status: 'queued',
          stageText: 'Dispatched to Kaggle Dual-T4 Cloud GPU pool. Awaiting runner...',
          url: workflowUrl,
        });

        let pollCount = 0;
        const pollInterval = setInterval(async () => {
          pollCount++;
          try {
            const statusRes = await fetch(`/api/avatar/render?action=status&owner=${owner}&repo=${repo}&targetTag=spaces-live-stage-test-20261029`, {
              headers: {
                ...(config.githubToken ? { 'Authorization': `token ${config.githubToken}` } : {})
              }
            });
            const statusData = await statusRes.json().catch(() => ({}));
            if (statusData && statusData.ok) {
              const runUrl = statusData.htmlUrl || workflowUrl;
              setKaggleRunStatus({
                runId: statusData.runId,
                status: statusData.status,
                conclusion: statusData.conclusion,
                url: runUrl,
                stageText: statusData.status === 'in_progress'
                  ? 'Kaggle Dual-T4 active: synthesizing EchoMimic / Wav2Lip neural lip-sync...'
                  : statusData.status === 'queued'
                    ? 'Job queued on GitHub runner / Kaggle pool...'
                    : `Job ${statusData.status} (${statusData.conclusion || 'processing'})`
              });

              if (statusData.status === 'in_progress') {
                setRenderProgress(p => Math.min(92, Math.max(p, 30 + Math.min(55, pollCount * 3))));
              }

              if (statusData.status === 'completed') {
                clearInterval(pollInterval);
                if (kagglePollTimerRef.current === pollInterval) {
                  kagglePollTimerRef.current = null;
                }
                setIsPollingKaggle(false);
                setIsRendering(false);

                if (statusData.conclusion === 'success') {
                  setRenderProgress(100);
                  const effectiveVideoUrl = statusData.videoUrl || statusData.directReleaseUrl || '/output/episodes/talking_avatar_short.mp4';
                  setRenderedJob({
                    jobId: `kaggle_${statusData.runId || Date.now()}`,
                    resolution: aspectRatio === '9-16' ? '1080x1920' : aspectRatio === '1-1' ? '1080x1080' : '1920x1080',
                    fps: 30,
                    durationSec: totalDuration,
                    renderMode: 'Kaggle Dual-T4 (EchoMimic Neural LipSync)',
                    videoUrl: effectiveVideoUrl,
                  });
                  setRenderWarning(null);
                  showToast('🎉 Neural Talking Avatar rendered with Kaggle Dual-T4 GPU!');
                } else {
                  const errMsg = `Kaggle GPU run ended with: ${statusData.conclusion || 'failed'}.`;
                  setRenderError(errMsg);
                  setRenderProgress(0);
                  showToast(`❌ ${errMsg}`);
                }
              }
            }
          } catch (pollErr: any) {
            console.warn('Kaggle status poll error:', pollErr);
          }
        }, 8000);

        kagglePollTimerRef.current = pollInterval;
        return;
      }

      // ── MODE 2: LOCAL FFmpeg DRAFT PREVIEW ──
      const payload: Record<string, any> = {
        engine: 'local',
        personaId: selectedPersona.id,
        avatarUrl: selectedPersona.avatarUrl,
        avatarBase64: selectedPersona.isCustom ? selectedPersona.avatarUrl : undefined,
        audioUrl: selectedAudio.url,
        audioBase64: selectedAudio.base64,
        backdropId: selectedBackdrop.id,
        cameraAngle,
        aspectRatio,
        lipSyncTightness,
        headSwayAmplitude,
        eyeGazeMode,
        blinkRate,
        microExpressionScale,
        showMeshOverlay,
        showPipExhibit
      };

      const res = await fetch('/api/avatar/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(payload)
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || `Avatar render failed (HTTP ${res.status}).`);
      }
      if (!data || typeof data.jobId !== 'string' || typeof data.videoUrl !== 'string') {
        throw new Error('Avatar renderer returned an incomplete job response.');
      }
      if (renderAbortRef.current !== controller) return;

      setRenderProgress(100);
      setRenderedJob({
        jobId: data.jobId,
        resolution: typeof data.resolution === 'string' ? data.resolution : '1920x1080',
        fps: Number.isFinite(Number(data.fps)) ? Number(data.fps) : 30,
        durationSec: Number.isFinite(Number(data.durationSec)) ? Number(data.durationSec) : totalDuration,
        renderMode: typeof data.renderMode === 'string' ? data.renderMode : 'Local FFmpeg Draft',
        warning: typeof data.warning === 'string' ? data.warning : undefined,
        videoUrl: data.videoUrl
      });

      if (Number.isFinite(Number(data.durationSec)) && Number(data.durationSec) > 0) {
        setTotalDuration(Number(data.durationSec));
        setCurrentTime(0);
      }

      if (typeof data.warning === 'string' && data.warning.trim()) {
        setRenderWarning(data.warning);
        showToast(`⚠️ ${data.warning}`);
      } else {
        showToast(`🎬 Rendered ${data.resolution || '1080p'} avatar draft (${data.jobId.slice(0, 16)}).`);
      }
    } catch (e: any) {
      if (e?.name === 'AbortError' || renderAbortRef.current !== controller) return;
      const message = e instanceof Error ? e.message : 'Avatar render failed.';
      setRenderError(message);
      setRenderedJob(null);
      setRenderProgress(0);
      setIsRendering(false);
      setIsPollingKaggle(false);
      if (kagglePollTimerRef.current) {
        clearInterval(kagglePollTimerRef.current);
        kagglePollTimerRef.current = null;
      }
      showToast(`❌ ${message}`);
    } finally {
      clearInterval(progressTimer);
      if (renderAbortRef.current === controller && renderEngine !== 'kaggle') {
        renderAbortRef.current = null;
        setIsRendering(false);
      }
    }
  };

  // Route avatar video clip into Montage Studio
  const handleSendToMontage = () => {
    if (!renderedJob?.videoUrl) {
      const message = 'Render an avatar video successfully before sending it to Montage Studio.';
      setRenderError(message);
      showToast(`⚠️ ${message}`);
      return;
    }

    montage.addClip({
      id: renderedJob.jobId,
      title: `[AVATAR] ${selectedPersona.name}`,
      quote: `${selectedPersona.name} in ${selectedBackdrop.name} (${aspectRatio} ${cameraAngle})`,
      speaker: selectedPersona.name,
      sourceTitle: 'LivePortrait / EchoMimic Neural Stage',
      audioUrl: renderedJob.videoUrl,
      startSec: 0,
      endSec: totalDuration,
      sourceDurationSec: totalDuration,
      category: 'Neural Avatar Video',
      severity: 7
    });

    montage.openDrawer();
    showToast(`🎬 "${selectedPersona.name}" avatar routed into Montage Studio timeline!`);
  };

  // Live Avatar Transform State for Real-Time Preview
  const [liveSway, setLiveSway] = useState({ x: 0, y: 0, rot: 0, isBlinking: false, mouthScale: 1 });

  useEffect(() => {
    let animId: number;
    let tick = 0;

    const loop = () => {
      tick++;

      // 1. Head Sway & Nodding calculation
      const swaySpeed = isPlaying ? 0.045 : 0.025;
      const swayScale = (headSwayAmplitude / 100);
      const swayX = Math.sin(tick * swaySpeed) * (swayScale * 18);
      const swayY = Math.cos(tick * (swaySpeed * 0.75)) * (swayScale * 10);
      const swayRot = Math.sin(tick * swaySpeed) * (swayScale * 4.5);

      // 2. Gaze Offset
      let gazeOffsetY = 0;
      let gazeOffsetX = 0;
      if (eyeGazeMode === 'notes') {
        gazeOffsetY = 6;
      } else if (eyeGazeMode === 'wandering') {
        gazeOffsetX = Math.sin(tick * 0.015) * 4;
        gazeOffsetY = Math.cos(tick * 0.02) * 2;
      }

      // 3. Dynamic Blink calculation from blinkRate (blinks per minute)
      const blinkIntervalFrames = Math.max(40, Math.round(3600 / Math.max(6, blinkRate)));
      const isBlinking = (tick % blinkIntervalFrames) < 5;

      // 4. Lip-sync mouth scale (reactive to isPlaying and lipSyncTightness)
      const mouthScale = isPlaying 
        ? 1 + (Math.abs(Math.sin(tick * 0.35)) * (lipSyncTightness / 100) * 0.18)
        : 1;

      setLiveSway({
        x: Math.round((swayX + gazeOffsetX) * 10) / 10,
        y: Math.round((swayY + gazeOffsetY) * 10) / 10,
        rot: Math.round(swayRot * 10) / 10,
        isBlinking,
        mouthScale
      });

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [headSwayAmplitude, eyeGazeMode, blinkRate, lipSyncTightness, isPlaying]);

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
          const r = 85 + Math.sin(tick * 0.1 + i) * 2;
          const x = centerX + Math.cos(angle) * r;
          const y = centerY + Math.sin(angle) * (r * 1.15);
          points.push({ x, y });
        }

        ctx.beginPath();
        points.forEach((pt, i) => {
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();

        points.forEach(pt => {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2);
          ctx.fill();
        });

        // Mouth mesh (speaking action reactive to isPlaying)
        const mouthOpen = isPlaying ? Math.abs(Math.sin(tick * 0.25)) * 12 : 2;
        ctx.beginPath();
        ctx.ellipse(centerX, centerY + 50, 20, 5 + mouthOpen, 0, 0, Math.PI * 2);
        ctx.strokeStyle = '#ec4899';
        ctx.stroke();

        // Eyes mesh (with dynamic blink rate)
        const isBlinking = tick % Math.max(30, 200 - blinkRate * 5) < 4;
        const eyeHeight = isBlinking ? 1 : 6;
        ctx.beginPath();
        ctx.ellipse(centerX - 28, centerY - 12, 11, eyeHeight, 0, 0, Math.PI * 2);
        ctx.ellipse(centerX + 28, centerY - 12, 11, eyeHeight, 0, 0, Math.PI * 2);
        ctx.strokeStyle = '#38bdf8';
        ctx.stroke();
      }

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [showMeshOverlay, isPlaying, headSwayAmplitude, blinkRate]);

  // Filtered personas
  const filteredPersonas = useMemo(() => {
    if (personaFilter === 'all') return personas;
    return personas.filter(p => p.category === personaFilter);
  }, [personas, personaFilter]);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-slate-950 text-slate-100 overflow-hidden select-none relative">
      {/* ── HIDDEN AUDIO DRIVER ── */}
      <audio
        ref={audioPlayerRef}
        src={selectedAudio.url}
        onTimeUpdate={handleAudioTimeUpdate}
        onEnded={handleAudioEnded}
        preload="metadata"
        className="hidden"
      />

      {/* ── CROP MODAL FOR CUSTOM AVATAR ── */}
      {cropModalFile && (
        <AvatarCropModal
          file={cropModalFile}
          speakerName="Custom Host Avatar"
          onCancel={() => setCropModalFile(null)}
          onConfirm={handleCustomFaceConfirmed}
        />
      )}

      {/* ── HIDDEN FILE INPUTS ── */}
      <input
        ref={faceInputRef}
        type="file"
        accept="image/*"
        onChange={handleFaceFileChosen}
        className="hidden"
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        onChange={handleAudioFileChosen}
        className="hidden"
      />

      {/* ── FLOATING TOAST NOTIFICATION ── */}
      {toastMessage && (
        <div className="absolute top-5 right-6 z-50 p-3 px-4 rounded-xl bg-slate-900/95 border border-indigo-500/40 text-indigo-200 text-xs font-semibold shadow-2xl shadow-indigo-950/60 flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <Sparkles size={14} className="text-indigo-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ── ERROR / WARNING BANNER ── */}
      {(renderError || renderWarning) && (
        <div
          className={`mx-6 mt-4 p-3 rounded-xl border text-xs flex items-start gap-2 ${
            renderError
              ? 'bg-rose-950/40 border-rose-500/40 text-rose-200'
              : 'bg-amber-950/40 border-amber-500/40 text-amber-200'
          }`}
          role="status"
          aria-live="polite"
        >
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="font-bold">{renderError ? 'Avatar render failed' : 'Avatar render completed with a warning'}</p>
            <p className="mt-0.5 break-words">{renderError || renderWarning}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setRenderError(null);
              setRenderWarning(null);
            }}
            className="ml-auto text-slate-400 hover:text-white"
            aria-label="Dismiss avatar render status"
          >
            ×
          </button>
        </div>
      )}

      {/* ── KAGGLE FINISHED BANNER ── */}
      {kaggleRunStatus?.status === 'completed' && kaggleRunStatus?.conclusion === 'success' && !renderedJob && !renderError && (
        <div className="mx-6 mt-4 p-3 rounded-xl border border-emerald-500/40 bg-emerald-950/40 text-emerald-200 text-xs flex items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <Check size={16} className="text-emerald-400 shrink-0" />
            <div>
              <p className="font-bold text-white">🎉 Kaggle Dual-T4 Neural Avatar Video is Ready! (Job #{kaggleRunStatus.runId})</p>
              <p className="text-[11px] text-emerald-300/80">Completed on GitHub Actions with EchoMimic / Wav2Lip neural lip-sync.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setRenderedJob({
                jobId: `kaggle_${kaggleRunStatus.runId || Date.now()}`,
                resolution: aspectRatio === '9-16' ? '1080x1920' : aspectRatio === '1-1' ? '1080x1080' : '1920x1080',
                fps: 30,
                durationSec: totalDuration,
                renderMode: 'Kaggle Dual-T4 (EchoMimic Neural LipSync)',
                videoUrl: `/output/episodes/talking_avatar_short.mp4?t=${Date.now()}`,
              });
              showToast('🎬 Loaded Kaggle Dual-T4 Neural Avatar video!');
            }}
            className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md shadow-emerald-900/40 cursor-pointer shrink-0 transition-colors"
          >
            Load Rendered Video
          </button>
        </div>
      )}

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
                LivePortrait / EchoMimic Pipeline Ready
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              4-Step End-to-End Workflow: Face Rig → Driving Audio → Performance Calibration → 4K Neural Export
            </p>
          </div>
        </div>

        {/* Global Studio Action Shortcuts & Aspect Ratio */}
        <div className="flex items-center gap-2.5">
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

          <button
            onClick={handleRenderVideo}
            disabled={isRendering}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white shadow-lg transition-all cursor-pointer disabled:opacity-50 ${
              renderEngine === 'kaggle'
                ? 'bg-gradient-to-r from-purple-600 via-indigo-600 to-cyan-500 hover:from-purple-500 hover:to-cyan-400 shadow-purple-900/40'
                : 'bg-gradient-to-r from-indigo-600 to-slate-700 hover:from-indigo-500 hover:to-slate-600 shadow-indigo-900/30'
            }`}
          >
            {isRendering ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                <span>{renderEngine === 'kaggle' ? 'Cloud GPU' : 'Rendering'} {renderProgress}%</span>
              </>
            ) : (
              <>
                {renderEngine === 'kaggle' ? (
                  <Sparkles size={14} className="text-amber-300 fill-amber-300" />
                ) : (
                  <Zap size={14} className="fill-current" />
                )}
                <span>{renderEngine === 'kaggle' ? 'Render Episode (Kaggle Dual-T4)' : 'Render Draft (Local Preview)'}</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* ── 3-COLUMN WORKSPACE ── */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {/* ── LEFT DOCK: STEP 1 (FACE) & STEP 2 (AUDIO) & VIRTUAL SET ── */}
        <aside className="w-full lg:w-80 border-r border-slate-800 bg-slate-900/40 p-5 overflow-y-auto space-y-6">
          {/* STEP 1: ACTIVE PERSONA & FACE SELECTOR */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-full bg-indigo-600 text-[10px] text-white flex items-center justify-center font-bold">1</span>
                Host Persona Rig
              </h3>
              <button
                onClick={() => faceInputRef.current?.click()}
                className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 cursor-pointer"
                title="Upload custom portrait photo for 512x512 crop"
              >
                <Upload size={11} /> + Upload Face
              </button>
            </div>

            {/* Filter pills */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-[10px] font-semibold mb-2.5">
              {(['all', 'host', 'speaker', 'custom'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setPersonaFilter(f)}
                  className={`flex-1 py-1 rounded-lg capitalize transition-colors cursor-pointer ${
                    personaFilter === f ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {f === 'all' ? 'All' : f === 'host' ? 'Hosts' : f === 'speaker' ? 'Archive' : 'Custom'}
                </button>
              ))}
            </div>

            {/* Persona Cards List */}
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {filteredPersonas.map(persona => {
                const isSelected = selectedPersona.id === persona.id;
                return (
                  <button
                    key={persona.id}
                    onClick={() => setSelectedPersona(persona)}
                    className={`w-full text-left p-2 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-gradient-to-r from-indigo-950/60 to-violet-950/60 border-indigo-500/80 shadow-md shadow-indigo-500/20'
                        : 'bg-slate-950/50 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900/40'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-lg overflow-hidden border border-white/10 shrink-0 bg-slate-900 flex items-center justify-center relative shadow-sm">
                        {persona.avatarUrl ? (
                          <img src={persona.avatarUrl} alt={persona.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-base">{persona.avatarEmoji}</span>
                        )}
                        {isSelected && (
                          <div className="absolute inset-0 bg-indigo-500/20 ring-1 ring-indigo-400" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <h4 className="text-[11px] font-bold text-white truncate">{persona.name}</h4>
                          <span className="text-[9px] font-mono text-emerald-400 font-bold">{persona.stability}%</span>
                        </div>
                        <p className="text-[10px] text-slate-400 truncate">{persona.type}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* STEP 2: DRIVING AUDIO / VOICE TRACK SELECTOR */}
          <div className="pt-3 border-t border-slate-800/80">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-full bg-violet-600 text-[10px] text-white flex items-center justify-center font-bold">2</span>
                Driving Audio Source
              </h3>
              <button
                onClick={() => audioInputRef.current?.click()}
                className="text-[10px] font-bold text-violet-400 hover:text-violet-300 flex items-center gap-1 px-2 py-0.5 rounded bg-violet-500/10 border border-violet-500/20 cursor-pointer"
                title="Upload custom WAV or MP3 speech file"
              >
                <Upload size={11} /> + Upload WAV
              </button>
            </div>

            <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
              {audioSources.map(audio => {
                const isSelected = selectedAudio.id === audio.id;
                return (
                  <button
                    key={audio.id}
                    onClick={() => setSelectedAudio(audio)}
                    className={`w-full text-left p-2 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-gradient-to-r from-violet-950/60 to-purple-950/60 border-violet-500/80 shadow-md shadow-violet-500/20'
                        : 'bg-slate-950/50 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900/40'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <Music size={13} className={isSelected ? 'text-violet-400 shrink-0' : 'text-slate-500 shrink-0'} />
                        <span className="text-[11px] font-bold text-white truncate">{audio.name}</span>
                      </div>
                      <span className="text-[10px] font-mono text-violet-300 font-bold shrink-0 ml-2">
                        {formatTimecode(audio.durationSec)}
                      </span>
                    </div>
                    {audio.description && (
                      <p className="text-[9px] text-slate-400 truncate mt-0.5 pl-5">{audio.description}</p>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* VIRTUAL STUDIO BACKDROP */}
          <div className="pt-3 border-t border-slate-800/80">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2.5 flex items-center gap-1.5">
              <Tv size={14} className="text-cyan-400" /> Virtual Studio Set
            </h3>
            <div className="space-y-1.5">
              {STUDIO_BACKDROPS.map(backdrop => {
                const isSelected = selectedBackdrop.id === backdrop.id;
                return (
                  <button
                    key={backdrop.id}
                    onClick={() => setSelectedBackdrop(backdrop)}
                    className={`w-full flex items-center justify-between p-2 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
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

          {/* CAMERA ANGLE & OVERLAYS */}
          <div className="pt-3 border-t border-slate-800/80 space-y-3">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
                <Eye size={14} className="text-violet-400" /> Camera Angle
              </h3>
              <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-[11px] font-semibold text-center">
                <button
                  onClick={() => setCameraAngle('front')}
                  className={`py-1 rounded-lg transition-all cursor-pointer ${
                    cameraAngle === 'front' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Frontal 0°
                </button>
                <button
                  onClick={() => setCameraAngle('three-quarter')}
                  className={`py-1 rounded-lg transition-all cursor-pointer ${
                    cameraAngle === 'three-quarter' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  3/4 Desk
                </button>
                <button
                  onClick={() => setCameraAngle('cinematic')}
                  className={`py-1 rounded-lg transition-all cursor-pointer ${
                    cameraAngle === 'cinematic' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Cinematic
                </button>
              </div>
            </div>

            <div className="space-y-1.5 pt-1">
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
          </div>
        </aside>

        {/* ── CENTER STAGE: VIDEO CANVAS & 4-TRACK TIMELINE ── */}
        <main className="flex-1 min-h-0 flex flex-col p-6 overflow-y-auto space-y-5">
          {/* Cinematic Video Preview Viewport */}
          <div className="flex-1 min-h-[360px] rounded-2xl bg-slate-950 border border-slate-800 overflow-hidden relative shadow-2xl flex items-center justify-center">
            {/* Virtual Backdrop Container */}
            <div className={`absolute inset-0 bg-gradient-to-br ${selectedBackdrop.previewGradient} transition-all duration-300`} />

            {/* 1. COMPLETED STATE: REAL RENDERED MP4 ACTIVE */}
            {renderedJob?.videoUrl ? (
              <div className="relative z-20 w-full h-full flex flex-col items-center justify-center p-4">
                <video
                  src={renderedJob.videoUrl}
                  controls
                  autoPlay
                  loop
                  playsInline
                  onError={() => {
                    const message = `The rendered video could not be loaded from ${renderedJob.videoUrl}.`;
                    setRenderError(message);
                    showToast(`❌ ${message}`);
                  }}
                  className="max-h-[350px] rounded-2xl shadow-2xl border-2 border-indigo-500/60 object-contain bg-black"
                />
                <div className="mt-3 flex items-center gap-3 bg-slate-900/90 backdrop-blur-md px-4 py-1.5 rounded-full border border-slate-700 shadow-xl">
                  <span className="text-[10px] font-mono text-emerald-400 font-bold flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    Rendered MP4 Active ({renderedJob.resolution} @ {renderedJob.fps}fps) — {renderedJob.renderMode || 'Kaggle Dual-T4'}
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
            ) : isRendering ? (
              /* 2. GENERATING STATE: EXPLICIT STAGE PROGRESS OVERLAY */
              <div className="relative z-30 w-full h-full flex flex-col items-center justify-center p-6 space-y-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in">
                <div className="relative w-16 h-16 flex items-center justify-center">
                  <div className="absolute inset-0 rounded-full border-4 border-indigo-500/20 animate-ping" />
                  <div className="w-14 h-14 rounded-full border-4 border-t-indigo-500 border-r-violet-500 border-b-cyan-400 border-l-transparent animate-spin" />
                  <Zap size={20} className="text-indigo-400 absolute animate-pulse" />
                </div>

                <div className="text-center max-w-md space-y-1">
                  <h3 className="text-sm font-bold text-white tracking-wide uppercase flex items-center justify-center gap-2">
                    {renderEngine === 'kaggle' ? (
                      <>
                        <Sparkles size={14} className="text-purple-400" />
                        <span>Kaggle Dual-T4 Neural Video Generation</span>
                      </>
                    ) : (
                      <>
                        <SlidersHorizontal size={14} className="text-indigo-400" />
                        <span>Local Draft Compositor Rendering</span>
                      </>
                    )}
                  </h3>
                  <p className="text-xs font-mono text-indigo-300">
                    {renderEngine === 'kaggle'
                      ? (kaggleRunStatus?.stageText || (
                          renderProgress < 30
                            ? '[1/3] Submitting EchoMimicV3 kernel to Kaggle Cloud GPU pool...'
                            : renderProgress < 85
                              ? '[2/3] Kaggle Dual Tesla T4 active: Wav2Lip neural lip-sync synthesizing...'
                              : '[3/3] Uploading talking avatar MP4 release asset...'
                        ))
                      : (
                          renderProgress < 25
                            ? '[1/4] Extracting 16kHz Mel-Spectrogram & Phonemes...'
                            : renderProgress < 55
                              ? '[2/4] Synthesizing Motion Coefficients...'
                              : renderProgress < 85
                                ? '[3/4] Head Pose & Mesh Overlay Deformation...'
                                : '[4/4] Compositing Local Draft Preview via FFmpeg...'
                        )
                    }
                  </p>
                  {renderEngine === 'kaggle' && kaggleRunStatus?.url && (
                    <div className="pt-1">
                      <a
                        href={kaggleRunStatus.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 rounded-lg text-purple-200 text-xs font-semibold transition-colors shadow-sm"
                      >
                        <ExternalLink size={12} />
                        <span>View Live Job {kaggleRunStatus.runId ? `#${kaggleRunStatus.runId} ` : ''}on GitHub Actions ↗</span>
                      </a>
                    </div>
                  )}
                </div>

                <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-full h-3 p-0.5 overflow-hidden shadow-inner">
                  <div
                    className="h-full bg-gradient-to-r from-indigo-500 via-violet-500 to-cyan-400 rounded-full transition-all duration-300 shadow-lg shadow-indigo-500/50"
                    style={{ width: `${renderProgress}%` }}
                  />
                </div>

                <div className="flex items-center justify-between w-full max-w-sm text-[11px] font-mono text-slate-400">
                  <span className="truncate max-w-[140px]">{selectedPersona.name}</span>
                  <span className="text-white font-bold">{renderProgress}%</span>
                  <span>{aspectRatio.toUpperCase()} • 30fps</span>
                </div>

                <button
                  onClick={() => {
                    renderAbortRef.current?.abort();
                    if (kagglePollTimerRef.current) clearInterval(kagglePollTimerRef.current);
                    setIsRendering(false);
                    setIsPollingKaggle(false);
                    setRenderProgress(0);
                    showToast('🛑 Generation canceled by user');
                  }}
                  className="mt-2 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-rose-400 hover:text-rose-300 border border-rose-500/30 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <X size={13} /> Cancel Generation
                </button>
              </div>
            ) : (
              /* 3. IDLE STATE: DISPLAY ACTIVE PORTRAIT IMAGE & HUD */
              <div className="relative z-10 flex flex-col items-center justify-center text-center p-6 space-y-3">
                {/* Active Avatar Portrait Frame with Live Real-Time Rig Simulation */}
                <div
                  className="relative w-48 h-48 md:w-56 md:h-56 rounded-full bg-gradient-to-b from-indigo-950/80 via-slate-900 to-slate-950 border-2 border-indigo-500/50 p-1.5 shadow-2xl shadow-indigo-500/30 flex items-center justify-center overflow-hidden group transition-transform duration-75 ease-out"
                  style={{
                    transform: `translate3d(${liveSway.x}px, ${liveSway.y}px, 0) rotate(${liveSway.rot}deg)`
                  }}
                >
                  {/* Reactivity Glow Ring */}
                  <div
                    className={`absolute inset-0 bg-radial from-violet-500/40 via-transparent to-transparent ${
                      isPlaying ? 'animate-pulse' : ''
                    }`}
                  />

                  {/* Real Portrait Photo */}
                  <img
                    src={selectedPersona.avatarUrl || '/avatars/logan.jpg'}
                    alt={selectedPersona.name}
                    className="w-full h-full object-cover rounded-full filter contrast-105 transition-transform duration-75"
                    style={{
                      transform: `scale(${liveSway.mouthScale})`
                    }}
                  />

                  {/* Real-Time Eyelid Blink Simulation */}
                  {liveSway.isBlinking && (
                    <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-[1px] rounded-full pointer-events-none flex items-center justify-center animate-in fade-in duration-75">
                      <div className="w-24 h-1 bg-slate-900/90 rounded-full" />
                    </div>
                  )}

                  {/* Canvas Wireframe Overlay */}
                  <canvas
                    ref={canvasRef}
                    width={240}
                    height={240}
                    className="absolute inset-0 w-full h-full pointer-events-none"
                  />

                  {/* Playback Badge on Portrait */}
                  <div className="absolute bottom-2 inset-x-0 mx-auto w-fit px-2.5 py-0.5 rounded-full bg-black/85 backdrop-blur-md border border-white/20 text-[9px] font-mono text-indigo-200 shadow-xl flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${isPlaying ? 'bg-emerald-400 animate-ping' : 'bg-indigo-400'}`} />
                    <span>{isPlaying ? '• Audio Driving Active' : '• Ready / Idle Loop'}</span>
                  </div>
                </div>

                {/* Persona Name & Subtitle Preview */}
                <div className="text-center space-y-1">
                  <h4 className="text-xs font-bold text-white tracking-wide">{selectedPersona.name}</h4>
                  <div className="max-w-md px-4 py-2 rounded-xl bg-black/80 backdrop-blur-md border border-white/10 text-center shadow-xl">
                    <p className="text-xs md:text-sm font-extrabold text-white tracking-tight leading-snug">
                      "Tonight we are pulling the thread on the <span className="text-amber-400 bg-amber-400/20 px-1 rounded">2026 archive</span> on record."
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Evidence Exhibit Picture-in-Picture (PiP) Window */}
            {showPipExhibit && (
              <div className="absolute top-5 right-5 w-48 p-2.5 rounded-xl bg-slate-900/90 backdrop-blur-md border border-slate-700 shadow-2xl z-20 space-y-1.5">
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

            {/* Viewport Status Overlays with Real-Time Telemetry */}
            <div className="absolute bottom-4 left-4 z-20 flex items-center gap-2">
              <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-slate-900/90 text-slate-300 border border-slate-800">
                CAM: {cameraAngle.toUpperCase()}
              </span>
              <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-slate-900/90 text-cyan-400 border border-slate-800">
                SWAY: {liveSway.rot}°
              </span>
              <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-slate-900/90 text-indigo-300 border border-slate-800">
                GAZE: {eyeGazeMode.toUpperCase()}
              </span>
              <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-slate-900/90 text-violet-300 border border-slate-800 truncate max-w-[130px]">
                VOX: {selectedAudio.name}
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
                  title={isPlaying ? 'Pause Audio Preview' : 'Play Synchronized Driving Audio'}
                >
                  {isPlaying ? <Pause size={18} className="fill-current" /> : <Play size={18} className="fill-current ml-0.5" />}
                </button>
                <div className="flex items-center gap-1 text-slate-400">
                  <button
                    onClick={() => handleSeek(currentTime - 1)}
                    className="p-1.5 hover:text-white rounded hover:bg-slate-800 transition-colors cursor-pointer"
                    title="Step back 1 second"
                  >
                    <SkipBack size={15} />
                  </button>
                  <button
                    onClick={() => handleSeek(currentTime + 1)}
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
                <span>{formatTimecode(totalDuration * 0.2)}</span>
                <span>{formatTimecode(totalDuration * 0.4)}</span>
                <span>{formatTimecode(totalDuration * 0.6)}</span>
                <span>{formatTimecode(totalDuration * 0.8)}</span>
                <span>{formatTimecode(totalDuration)}</span>
              </div>

              {/* Track 1: Avatar Video */}
              <div className="flex items-center gap-2 text-xs">
                <span className="w-24 text-[10px] font-mono text-slate-400 font-bold flex items-center gap-1 shrink-0">
                  <Camera size={11} className="text-indigo-400" /> Track 1: Head
                </span>
                <div className="flex-1 h-7 bg-slate-900 rounded-lg p-1 flex items-center gap-1 relative overflow-hidden border border-slate-800">
                  <div className="h-full bg-gradient-to-r from-indigo-600/40 to-indigo-500/40 border border-indigo-500/50 rounded px-2 text-[10px] font-mono text-indigo-200 flex items-center w-full">
                    {selectedPersona.name} (LivePortrait 60fps Stream)
                  </div>
                </div>
              </div>

              {/* Track 2: Speech Audio (VoxCPM-2) - INTERACTIVE SOURCE */}
              <div className="flex items-center gap-2 text-xs">
                <span className="w-24 text-[10px] font-mono text-violet-400 font-bold flex items-center gap-1 shrink-0">
                  <Radio size={11} className="text-violet-400" /> Track 2: Vox
                </span>
                <div
                  onClick={() => audioInputRef.current?.click()}
                  className="flex-1 h-7 bg-slate-900 rounded-lg p-1 flex items-center gap-1 relative overflow-hidden border border-violet-500/40 cursor-pointer hover:border-violet-400 group"
                  title="Click to change or upload driving audio"
                >
                  <div className="h-full bg-gradient-to-r from-violet-600/40 to-purple-600/40 border border-violet-500/50 rounded px-2 text-[10px] font-mono text-violet-200 flex items-center justify-between w-full">
                    <span className="truncate">Active Audio: {selectedAudio.name}</span>
                    <span className="text-[9px] text-violet-300 opacity-80 group-hover:opacity-100 flex items-center gap-1">
                      <Upload size={10} /> Switch / Upload
                    </span>
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
                  handleSeek(ratio * totalDuration);
                }}
                className="relative h-2 bg-slate-800 rounded-full cursor-pointer mt-2"
              >
                <div
                  className="absolute top-0 bottom-0 bg-indigo-500 rounded-full"
                  style={{ width: `${totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>
        </main>

        {/* ── RIGHT DRAWER: STEP 3 (PERFORMANCE RIG & EXPORT) ── */}
        <aside className="w-full lg:w-80 border-l border-slate-800 bg-slate-900/40 p-5 overflow-y-auto space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-full bg-cyan-600 text-[10px] text-white flex items-center justify-center font-bold">3</span>
              Performance Rig
            </h3>
            <span className="text-[10px] font-mono text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
              LivePortrait
            </span>
          </div>

          {/* Engine Selection: Kaggle Dual-T4 GPU vs Local Draft */}
          <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-200 font-bold flex items-center gap-1.5">
                <Zap size={13} className="text-amber-400" />
                Render Engine
              </span>
              <span className="text-[10px] font-mono text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20">
                {renderEngine === 'kaggle' ? 'Tesla T4 Dual' : 'FFmpeg Local'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 bg-slate-900 p-1 rounded-lg border border-slate-800 text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => setRenderEngine('kaggle')}
                className={`py-1.5 px-2 rounded-md flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  renderEngine === 'kaggle'
                    ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold shadow-md shadow-purple-900/40'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Sparkles size={12} className="text-amber-300 shrink-0" />
                <span className="truncate">Cloud GPU</span>
              </button>
              <button
                type="button"
                onClick={() => setRenderEngine('local')}
                className={`py-1.5 px-2 rounded-md flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  renderEngine === 'local'
                    ? 'bg-slate-800 text-slate-100 font-bold border border-slate-700'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <SlidersHorizontal size={12} className="shrink-0" />
                <span className="truncate">Draft Fast</span>
              </button>
            </div>
            {renderEngine === 'kaggle' && (
              <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-300 font-medium">Diffusion Latent Steps</span>
                  <span className="font-mono text-xs font-bold text-indigo-400">
                    {latentSteps} steps ({latentSteps <= 4 ? 'Fast Draft' : 'High Quality'})
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-[10px] font-semibold">
                  <button
                    type="button"
                    onClick={() => setLatentSteps(6)}
                    className={`py-1 px-2 rounded transition-all cursor-pointer ${
                      latentSteps === 6
                        ? 'bg-indigo-600/40 border border-indigo-500/60 text-white font-bold'
                        : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    6 Steps (Standard)
                  </button>
                  <button
                    type="button"
                    onClick={() => setLatentSteps(4)}
                    className={`py-1 px-2 rounded transition-all cursor-pointer ${
                      latentSteps === 4
                        ? 'bg-indigo-600/40 border border-indigo-500/60 text-white font-bold'
                        : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    4 Steps (Draft Fast)
                  </button>
                </div>
              </div>
            )}
            <p className="text-[10px] text-slate-400 leading-normal">
              {renderEngine === 'kaggle'
                ? '⚡ Dispatches to Kaggle Tesla Dual-T4 worker for neural EchoMimic diffusion lip-syncing.'
                : '⚡ Runs instant local FFmpeg draft (simulated head sway without neural lip-sync).'}
            </p>
          </div>

          {/* Lip-Sync Tightness Slider */}
          <div className="space-y-1.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-semibold flex items-center gap-1">
                Lip-Sync Tightness
              </span>
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
            <div className="flex items-center justify-between text-[10px] text-slate-500">
              <span>Viseme Closing Latency</span>
              <span className="text-indigo-400 font-mono">Neural Viseme Engine</span>
            </div>
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
            <div className="flex items-center justify-between text-[10px] text-slate-500">
              <span>Cervical Rotation</span>
              <span className="text-indigo-400 font-mono">Euler Angle Rig</span>
            </div>
          </div>

          {/* Eye Gaze Direction Mode */}
          <div className="space-y-2 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
              <span className="flex items-center gap-1.5">
                <Eye size={13} className="text-cyan-400" /> Eye Gaze Tracking
              </span>
              <span className="text-[10px] text-cyan-400 font-mono">Gaze Vector Target</span>
            </div>
            <div className="grid grid-cols-3 gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800 text-[10px] font-semibold text-center">
              <button
                onClick={() => setEyeGazeMode('camera')}
                className={`py-1.5 rounded transition-colors cursor-pointer ${
                  eyeGazeMode === 'camera' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
                title="Direct eye contact locked on camera lens"
              >
                Camera Lock
              </button>
              <button
                onClick={() => setEyeGazeMode('wandering')}
                className={`py-1.5 rounded transition-colors cursor-pointer ${
                  eyeGazeMode === 'wandering' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
                title="Natural conversational eye wandering"
              >
                Natural
              </button>
              <button
                onClick={() => setEyeGazeMode('notes')}
                className={`py-1.5 rounded transition-colors cursor-pointer ${
                  eyeGazeMode === 'notes' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
                title="Looking down at script notes or evidence desk"
              >
                At Notes
              </button>
            </div>
          </div>

          {/* Micro-Expressions & Blink Rate */}
          <div className="space-y-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
              <span>Micro-Expressions</span>
              <span className="text-[10px] text-violet-400 font-mono">FACS Landmarks</span>
            </div>

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
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                } else {
                  handleRenderVideo();
                }
              }}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <Download size={14} /> {renderedJob ? 'Download Master 4K MP4' : 'Render & Export 4K MP4'}
            </button>
            <button
              onClick={handleSendToMontage}
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
  if (!Number.isFinite(sec) || sec < 0) return '00:00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const f = Math.floor((sec % 1) * 30);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}:${f.toString().padStart(2, '0')}`;
}

export default AvatarStudio;
