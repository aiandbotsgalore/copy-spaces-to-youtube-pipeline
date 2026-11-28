import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Play,
  Pause,
  Download,
  Sparkles,
  Camera,
  RefreshCw,
  Volume2,
  VolumeX,
  Film,
  Zap,
  Check,
  RotateCcw,
  SkipBack,
  SkipForward,
  AlertTriangle,
  Upload,
  Music,
  X,
  SlidersHorizontal,
  Power,
  Terminal,
  Trash2,
  Crop,
} from 'lucide-react';
import { EnhancedConfig } from '../types';
import { AvatarCropModal } from './AvatarCropModal';
import { createMachine } from '../utils/stateMachine';
import { safeFetchJson } from '../utils/safeFetch';
import type {
  AvatarAudioAsset,
  AvatarPortraitAsset,
  AvatarRenderRecord,
} from '../utils/contracts/avatarRender';

export type AvatarRenderState = 'idle' | 'rendering' | 'rendered' | 'error';

interface Props {
  config: EnhancedConfig;
}

export interface AvatarPersona {
  id: string;
  name: string;
  avatarUrl: string;
  fileSizeBytes: number;
  category: 'disk' | 'custom';
  isCustom?: boolean;
}

export interface DrivingAudioSource {
  id: string;
  name: string;
  category: 'sample' | 'vox' | 'upload';
  speaker?: string;
  durationSec: number;
  url: string;
  fileSizeBytes?: number;
  base64?: string;
}

interface RenderedAvatarJob {
  jobId: string;
  resolution: string;
  fps: number;
  videoUrl: string;
  durationSec?: number | null;
  renderMode?: string;
  warning?: string;
  personaName?: string;
}

const FALLBACK_PERSONA: AvatarPersona = {
  id: 'logan',
  name: 'Logan',
  avatarUrl: '/avatars/logan.jpg',
  fileSizeBytes: 0,
  category: 'disk',
};

const FALLBACK_AUDIO: DrivingAudioSource = {
  id: 'sample_logan_avatar_10_15s_logan_sample_01_intro_wav',
  name: 'Logan — Sample 01 Intro',
  category: 'sample',
  speaker: 'Logan',
  durationSec: 13.0,
  url: '/speaker_samples/Logan/avatar_10_15s/logan_sample_01_intro.wav',
  fileSizeBytes: 0,
};

export const AvatarStudio: React.FC<Props> = ({ config: _config }) => {
  // ── STEP 1: PORTRAIT RIG (BACKED BY /api/avatar/assets) ──
  const [personas, setPersonas] = useState<AvatarPersona[]>([FALLBACK_PERSONA]);
  const [selectedPersona, setSelectedPersona] = useState<AvatarPersona>(FALLBACK_PERSONA);
  const [personaFilter, setPersonaFilter] = useState<'all' | 'disk' | 'custom'>('all');
  const [cropModalFile, setCropModalFile] = useState<File | null>(null);
  const faceInputRef = useRef<HTMLInputElement | null>(null);

  // ── STEP 2: DRIVING AUDIO (BACKED BY /api/avatar/assets) ──
  const [audioSources, setAudioSources] = useState<DrivingAudioSource[]>([FALLBACK_AUDIO]);
  const [selectedAudio, setSelectedAudio] = useState<DrivingAudioSource>(FALLBACK_AUDIO);
  const [audioFilter, setAudioFilter] = useState<'all' | 'sample' | 'vox' | 'upload'>('all');
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // ── STEP 3: PERFORMANCE CALIBRATION & RENDER OPTIONS ──
  const [aspectRatio, setAspectRatio] = useState<'16-9' | '9-16' | '1-1'>('16-9');
  const [cropFraming, setCropFraming] = useState<'wide' | 'standard' | 'close-up'>('standard');
  const [renderEngine, setRenderEngine] = useState<'modal' | 'vast' | 'local'>('modal');
  const [modalActiveRender, setModalActiveRender] = useState<{
    active: boolean;
    stepIndex: number;
    stepTotal: number;
    stepLabel: string;
    elapsedSec: number;
  } | null>(null);
  const [modalConfigured, setModalConfigured] = useState(true);
  const [renderQuality, setRenderQuality] = useState<'standard' | 'draft'>('standard');
  const [lipSyncTightness, setLipSyncTightness] = useState(40);
  const [headSwayAmplitude, setHeadSwayAmplitude] = useState(15);
  const [microExpressionScale, setMicroExpressionScale] = useState(25);

  // ── AUDIO PREVIEW TRANSPORT ──
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(FALLBACK_AUDIO.durationSec);
  const [volume, setVolume] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);

  // ── RENDER LIFECYCLE & HISTORY ──
  const [renderState, setRenderState] = useState<AvatarRenderState>('idle');
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderedJob, setRenderedJob] = useState<RenderedAvatarJob | null>(null);
  const [renderHistory, setRenderHistory] = useState<AvatarRenderRecord[]>([]);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderWarning, setRenderWarning] = useState<string | null>(null);
  const [isAssetsLoading, setIsAssetsLoading] = useState(true);

  const renderAbortRef = useRef<AbortController | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // ── VAST.AI SESSION TELEMETRY ──
  const [vastSession, setVastSession] = useState<{
    instanceId?: number | null;
    status: 'offline' | 'provisioning' | 'bootstrapping' | 'ready' | 'paused' | 'error';
    gpuName?: string;
    pricePerHour?: number;
    storageCostPerHr?: number;
    idleSecondsRemaining?: number;
    endpointUrl?: string;
    lastError?: string;
    stageIndex?: number;
    stageTotal?: number;
    stageLabel?: string;
    lastProgressAt?: string;
    elapsedSec?: number;
    estimatedRemainingSec?: number;
    lastHeartbeatAgoSec?: number;
    isStalled?: boolean;
    stallReason?: string;
    recentLogs?: string[];
    activeRender?: {
      active: boolean;
      stepIndex: number;
      stepTotal: number;
      stepLabel: string;
      startedAt: string;
      elapsedSec: number;
    } | null;
  }>({ status: 'offline', stageIndex: 0, stageTotal: 5, recentLogs: [] });
  const [isVastActionLoading, setIsVastActionLoading] = useState(false);
  const [showVastLogs, setShowVastLogs] = useState(false);
  const [telemetryTick, setTelemetryTick] = useState(0);

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(msg);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 4000);
  }, []);

  useEffect(() => () => {
    renderAbortRef.current?.abort();
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  // Load real portraits & driving audio files from disk
  const loadDiskAssets = useCallback(async () => {
    setIsAssetsLoading(true);
    try {
      const data = await safeFetchJson<any>('/api/avatar/assets');
      if (!data) return;
      const diskPortraits: AvatarPersona[] = Array.isArray(data?.portraits)
        ? (data.portraits as AvatarPortraitAsset[]).map(p => ({
            id: p.id,
            name: p.name,
            avatarUrl: p.avatarUrl,
            fileSizeBytes: p.fileSizeBytes,
            category: 'disk' as const,
          }))
        : [];
      const diskAudio: DrivingAudioSource[] = Array.isArray(data?.audioFiles)
        ? (data.audioFiles as AvatarAudioAsset[]).map(a => ({
            id: a.id,
            name: a.name,
            category: a.category,
            speaker: a.speaker,
            durationSec: a.durationSec,
            url: a.url,
            fileSizeBytes: a.fileSizeBytes,
          }))
        : [];

      if (diskPortraits.length > 0) {
        setPersonas(prev => {
          const customOnes = prev.filter(p => p.category === 'custom');
          return [...customOnes, ...diskPortraits];
        });
        setSelectedPersona(prev => {
          if (prev.category === 'custom') return prev;
          return diskPortraits.find(p => p.id === prev.id) || diskPortraits[0];
        });
      }

      if (diskAudio.length > 0) {
        setAudioSources(prev => {
          const uploadedOnes = prev.filter(a => a.category === 'upload');
          return [...uploadedOnes, ...diskAudio];
        });
        setSelectedAudio(prev => {
          if (prev.category === 'upload') return prev;
          return diskAudio.find(a => a.id === prev.id) || diskAudio[0];
        });
      }
    } catch {
      // Keep fallback state if server route unavailable in isolated unit test
    } finally {
      setIsAssetsLoading(false);
    }
  }, []);

  const loadRenderHistory = useCallback(async () => {
    try {
      const data = await safeFetchJson<any>('/api/avatar/renders');
      if (data && Array.isArray(data.renders)) {
        setRenderHistory(data.renders as AvatarRenderRecord[]);
      }
    } catch {}
  }, []);

  useEffect(() => {
    loadDiskAssets();
    loadRenderHistory();
  }, [loadDiskAssets, loadRenderHistory]);

  // Consume pending hand-off image from Copilot Image Studio on mount or via event
  useEffect(() => {
    const applyImageAsAvatar = (imageUrl: string) => {
      if (!imageUrl) return;
      const customPersona: AvatarPersona = {
        id: `gen-avatar-${Date.now()}`,
        name: 'Generated Portrait',
        avatarUrl: imageUrl,
        fileSizeBytes: 0,
        category: 'custom',
        isCustom: true,
      };
      setPersonas(prev => [customPersona, ...prev.filter(p => p.id !== customPersona.id)]);
      setSelectedPersona(customPersona);
      showToast('AI-generated portrait loaded onto rig.');
    };

    try {
      const pending = sessionStorage.getItem('spacepipe_pending_avatar_image');
      if (pending) {
        sessionStorage.removeItem('spacepipe_pending_avatar_image');
        applyImageAsAvatar(pending);
      }
    } catch {}

    const handleAvatarImageEvent = (e: any) => {
      const url = e.detail?.imageUrl || e.detail;
      if (url) applyImageAsAvatar(url);
    };
    window.addEventListener('spacepipe:load-avatar-image', handleAvatarImageEvent);
    return () => {
      window.removeEventListener('spacepipe:load-avatar-image', handleAvatarImageEvent);
    };
  }, [showToast]);

  // Poll Modal render status while rendering on Modal, plus check configuration once on mount
  useEffect(() => {
    let isMounted = true;
    const fetchModalStatus = async () => {
      try {
        const data = await safeFetchJson<any>('/api/avatar/render?action=status');
        if (data && isMounted) {
          setModalConfigured(Boolean(data.modalConfigured));
          setModalActiveRender(data.modalActiveRender || null);
        }
      } catch {}
    };
    fetchModalStatus();
    if (!(isRendering && renderEngine === 'modal')) return;
    const interval = setInterval(fetchModalStatus, 1500);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [isRendering, renderEngine]);

  // Poll Vast.ai session status periodically (fast 2s poll during bootstrap or active render)
  useEffect(() => {
    let isMounted = true;
    const fetchVastStatus = async () => {
      try {
        const data = await safeFetchJson<any>('/api/avatar/vast/status');
        if (data && isMounted) {
          setVastSession(data);
          setTelemetryTick(0);
        }
      } catch {}
    };

    fetchVastStatus();
    const isBusy =
      vastSession.status === 'provisioning' ||
      vastSession.status === 'bootstrapping' ||
      (isRendering && renderEngine === 'vast');
    const interval = setInterval(
      fetchVastStatus,
      isBusy ? 2000 : vastSession.status === 'ready' ? 8000 : renderEngine === 'vast' ? 5000 : 20000
    );
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [vastSession.status, isRendering, renderEngine]);

  // Smooth 1-second local UI timer tick between backend polls
  useEffect(() => {
    const isActiveTimer =
      vastSession.status === 'provisioning' ||
      vastSession.status === 'bootstrapping' ||
      (isRendering && renderEngine !== 'local');
    if (!isActiveTimer) return;
    const t = setInterval(() => setTelemetryTick(prev => prev + 1), 1000);
    return () => clearInterval(t);
  }, [vastSession.status, isRendering, renderEngine]);

  const handleStartVastSession = async (forceNew = false) => {
    setIsVastActionLoading(true);
    try {
      showToast(forceNew ? 'Provisioning a fresh verified US Vast.ai GPU...' : 'Searching verified US Vast.ai GPU offers...');
      const res = await fetch('/api/avatar/vast/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(forceNew ? { forceNew: true } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed starting Vast GPU session');
      setVastSession(data.session || { status: 'provisioning', stageIndex: 1, stageTotal: 5 });
      showToast('Vast GPU instance reserved. Tracking live bootstrap...');
    } catch (e: any) {
      showToast(e.message || 'Error launching Vast GPU');
    } finally {
      setIsVastActionLoading(false);
    }
  };

  const handlePauseVastSession = async () => {
    setIsVastActionLoading(true);
    try {
      showToast('Pausing GPU ($0/hr compute, cached models saved for ~20s resume)...');
      const res = await fetch('/api/avatar/vast/pause', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed pausing Vast GPU session');
      setVastSession(data.session || { status: 'paused', stageIndex: 0, stageTotal: 5 });
      showToast('GPU paused. Resume anytime in ~20s.');
    } catch (e: any) {
      showToast(e.message || 'Error pausing Vast GPU');
    } finally {
      setIsVastActionLoading(false);
    }
  };

  const handleResumeVastSession = async () => {
    setIsVastActionLoading(true);
    try {
      showToast('Waking paused Vast.ai GPU (skipping installs & model downloads)...');
      const res = await fetch('/api/avatar/vast/resume', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed resuming Vast GPU session');
      setVastSession(data.session || { status: 'bootstrapping', stageIndex: 1, stageTotal: 5 });
    } catch (e: any) {
      showToast(e.message || 'Error resuming Vast GPU');
    } finally {
      setIsVastActionLoading(false);
    }
  };

  const handleStopVastSession = async () => {
    setIsVastActionLoading(true);
    try {
      showToast('Destroying Vast GPU instance to stop all billing...');
      const res = await fetch('/api/avatar/vast/stop', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed destroying Vast GPU session');
      setVastSession(data.session || { status: 'offline', stageIndex: 0, stageTotal: 5, recentLogs: [] });
      showToast('Vast GPU destroyed cleanly. All billing stopped.');
    } catch (e: any) {
      showToast(e.message || 'Error destroying Vast GPU');
    } finally {
      setIsVastActionLoading(false);
    }
  };

  const handleRetryVastSession = async () => {
    setIsVastActionLoading(true);
    try {
      showToast('Destroying stalled Vast GPU and provisioning a fresh instance...');
      await fetch('/api/avatar/vast/stop', { method: 'POST' });
      const res = await fetch('/api/avatar/vast/start', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed retrying Vast GPU session');
      setVastSession(data.session || { status: 'provisioning', stageIndex: 1, stageTotal: 5 });
      showToast('Replacement Vast GPU reserved. Tracking live bootstrap...');
    } catch (e: any) {
      showToast(e.message || 'Error retrying Vast GPU');
    } finally {
      setIsVastActionLoading(false);
    }
  };

  const machineRef = useRef(
    createMachine<AvatarRenderState, 'START' | 'FINISH' | 'FAIL' | 'RESET'>(
      {
        id: 'avatar-studio',
        initial: 'idle',
        states: {
          idle: { START: 'rendering' },
          rendering: { FINISH: 'rendered', FAIL: 'error', RESET: 'idle' },
          rendered: { START: 'rendering', RESET: 'idle' },
          error: { START: 'rendering', RESET: 'idle' },
        },
        onTransition: (_from, to) => {
          setRenderState(to);
          setIsRendering(to === 'rendering');
        },
      },
      {}
    )
  );

  // Sync totalDuration whenever selectedAudio changes
  useEffect(() => {
    if (selectedAudio && Number.isFinite(selectedAudio.durationSec) && selectedAudio.durationSec > 0) {
      setTotalDuration(selectedAudio.durationSec);
      setCurrentTime(0);
      setIsPlaying(false);
    }
  }, [selectedAudio]);

  // Synchronize native audio player with isPlaying state
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

  useEffect(() => {
    const audio = audioPlayerRef.current;
    if (audio) {
      audio.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  const handleAudioTimeUpdate = () => {
    const audio = audioPlayerRef.current;
    if (audio && isPlaying) {
      setCurrentTime(Math.round(audio.currentTime * 10) / 10);
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setTotalDuration(Math.round(audio.duration * 10) / 10);
      }
    }
  };

  const handleAudioLoadedMetadata = () => {
    const audio = audioPlayerRef.current;
    if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
      setTotalDuration(Math.round(audio.duration * 10) / 10);
    }
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    if (audioPlayerRef.current) {
      audioPlayerRef.current.currentTime = 0;
    }
  };

  const handleSeek = (timeSec: number) => {
    const clamped = Math.max(0, Math.min(totalDuration, Math.round(timeSec * 10) / 10));
    setCurrentTime(clamped);
    if (audioPlayerRef.current) {
      audioPlayerRef.current.currentTime = clamped;
    }
  };

  // Custom face upload -> Crop Modal -> Base64 persona
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
        name: `Custom Portrait (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`,
        avatarUrl: base64,
        fileSizeBytes: blob.size,
        category: 'custom',
        isCustom: true,
      };
      setPersonas(prev => [newPersona, ...prev]);
      setSelectedPersona(newPersona);
      setCropModalFile(null);
      showToast('Custom face cropped and selected.');
    };
    reader.readAsDataURL(blob);
  };

  // Custom driving audio upload
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
          name: file.name,
          category: 'upload',
          durationSec: dur,
          url,
          fileSizeBytes: file.size,
          base64,
        };
        setAudioSources(prev => [newAudio, ...prev]);
        setSelectedAudio(newAudio);
        setTotalDuration(dur);
        setCurrentTime(0);
        showToast(`Loaded "${file.name}" (${formatDurationShort(dur)}).`);
      };
      reader.readAsDataURL(file);
    };

    if (audioInputRef.current) audioInputRef.current.value = '';
  };

  // ── TRIGGER VIDEO RENDER PIPELINE ──
  const handleRenderVideo = async () => {
    renderAbortRef.current?.abort();
    const controller = new AbortController();
    renderAbortRef.current = controller;

    machineRef.current.send('START');
    setIsRendering(true);
    setRenderProgress(10);
    setRenderError(null);
    setRenderWarning(null);
    setIsPlaying(false);

    const progressTimer = setInterval(() => {
      setRenderProgress(p => (p < 90 ? p + 12 : p));
    }, 280);

    try {
      if (renderEngine === 'vast' && vastSession.status !== 'ready') {
        throw new Error(
          vastSession.status === 'paused'
            ? 'Vast.ai GPU is paused. Click "Resume GPU (~20s)" above first.'
            : 'Vast.ai GPU instance is not ready. Start Vast GPU above or switch to Draft Fast.'
        );
      }

      const payload: Record<string, any> = {
        engine: renderEngine,
        renderQuality,
        personaId: selectedPersona.id,
        personaName: selectedPersona.name,
        avatarUrl: selectedPersona.avatarUrl,
        avatarBase64: selectedPersona.isCustom ? selectedPersona.avatarUrl : undefined,
        audioUrl: selectedAudio.url,
        audioBase64: selectedAudio.base64,
        durationSec: totalDuration,
        cropFraming,
        aspectRatio,
        lipSyncTightness,
        headSwayAmplitude,
        microExpressionScale,
      };

      if (renderEngine === 'modal') {
        showToast('Rendering talking portrait via JoyVASA + LivePortrait FP16 on Modal L40S...');
      } else if (renderEngine === 'vast') {
        showToast('Rendering talking portrait via JoyVASA + LivePortrait on Vast.ai GPU...');
      }

      const vastTimer =
        renderEngine !== 'local'
          ? setInterval(() => {
              setRenderProgress(p => (p < 95 ? p + 3 : p));
            }, 1000)
          : null;

      try {
        const res = await fetch('/api/avatar/render', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify(payload),
        });

        if (vastTimer) clearInterval(vastTimer);
        clearInterval(progressTimer);

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
          fps: Number.isFinite(Number(data.fps)) ? Number(data.fps) : 25,
          durationSec: Number.isFinite(Number(data.durationSec)) ? Number(data.durationSec) : totalDuration,
          renderMode: typeof data.renderMode === 'string' ? data.renderMode : 'Vast.ai JoyVASA + LivePortrait',
          warning: typeof data.warning === 'string' ? data.warning : undefined,
          videoUrl: data.videoUrl,
          personaName: selectedPersona.name,
        });

        if (Number.isFinite(Number(data.durationSec)) && Number(data.durationSec) > 0) {
          setTotalDuration(Number(data.durationSec));
          setCurrentTime(0);
        }

        if (typeof data.warning === 'string' && data.warning.trim()) {
          setRenderWarning(data.warning);
        }

        machineRef.current.send('FINISH');
        setIsRendering(false);
        loadRenderHistory();
        showToast(
          renderEngine === 'vast'
            ? `Rendered ${data.resolution || '1920x1080'} @ ${data.fps || 25}fps in ${data.elapsedSec || 15}s.`
            : `Rendered local FFmpeg draft (${data.resolution || '1920x1080'}).`
        );
      } catch (innerErr) {
        if (vastTimer) clearInterval(vastTimer);
        throw innerErr;
      }
    } catch (e: any) {
      if (e?.name === 'AbortError' || renderAbortRef.current !== controller) return;
      const message = e instanceof Error ? e.message : 'Avatar render failed.';
      machineRef.current.send('FAIL');
      setRenderError(message);
      setRenderedJob(null);
      setRenderProgress(0);
      setIsRendering(false);
      showToast(message);
    } finally {
      clearInterval(progressTimer);
      if (renderAbortRef.current === controller) {
        renderAbortRef.current = null;
        setIsRendering(false);
      }
    }
  };

  const handleDeleteRender = async (jobId: string) => {
    setDeletingJobId(jobId);
    try {
      const res = await fetch(`/api/avatar/renders/${encodeURIComponent(jobId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to delete render (${res.status})`);
      }
      setRenderHistory(prev => prev.filter(r => r.jobId !== jobId));
      if (renderedJob?.jobId === jobId) {
        setRenderedJob(null);
      }
      showToast('Deleted render from disk.');
    } catch (e: any) {
      showToast(e?.message || 'Failed to delete render.');
    } finally {
      setDeletingJobId(null);
    }
  };

  const downloadMp4 = (videoUrl: string, jobId: string) => {
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = `${jobId}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const filteredPersonas = useMemo(() => {
    if (personaFilter === 'all') return personas;
    return personas.filter(p => p.category === personaFilter);
  }, [personas, personaFilter]);

  const filteredAudioSources = useMemo(() => {
    if (audioFilter === 'all') return audioSources;
    return audioSources.filter(a => a.category === audioFilter);
  }, [audioSources, audioFilter]);

  // Framing preview scale matching JoyVASA crop_scale (`wide=2.65`, `standard=2.30`, `close-up=1.95`)
  const previewScale = cropFraming === 'wide' ? 0.92 : cropFraming === 'close-up' ? 1.18 : 1.0;

  return (
    <div
      data-component="avatar-studio"
      data-state={renderState}
      className="flex-1 min-h-0 flex flex-col bg-slate-950 text-slate-100 overflow-hidden select-none relative"
    >
      {/* ── HIDDEN AUDIO DRIVER ── */}
      <audio
        ref={audioPlayerRef}
        src={selectedAudio.url}
        onTimeUpdate={handleAudioTimeUpdate}
        onLoadedMetadata={handleAudioLoadedMetadata}
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
        <div className="absolute top-5 right-6 z-50 p-3 px-4 rounded-xl bg-slate-900/95 border border-indigo-500/40 text-indigo-200 text-xs font-semibold shadow-2xl shadow-indigo-950/60 flex items-center gap-2">
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
            className="ml-auto text-slate-400 hover:text-white cursor-pointer"
            aria-label="Dismiss avatar render status"
          >
            ×
          </button>
        </div>
      )}

      {/* ── TOP HEADER / VAST.AI LIVE TELEMETRY BAR ── */}
      <header className="px-6 py-4 border-b border-slate-800 bg-slate-900/60 backdrop-blur-md space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 border border-indigo-500/40 text-indigo-400 shadow-lg shadow-indigo-500/10">
              <Camera size={22} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-lg font-bold tracking-tight text-white">
                  NEURAL VIDEO AVATAR STUDIO
                </h1>

                {/* Cloud GPU Engine Status Pill */}
                <div className="flex items-center gap-2 bg-slate-950/80 border border-slate-800 rounded-lg px-2.5 py-1 text-xs">
                  {renderEngine === 'modal' && vastSession.status === 'offline' ? (
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1.5 text-emerald-400 font-mono text-[11px] font-bold">
                        <span className={`w-2 h-2 rounded-full ${modalConfigured ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                        {modalConfigured ? 'Modal L40S Serverless · Ready (25fps FP16)' : 'Modal Endpoint Unconfigured'}
                      </span>
                      <span className="text-slate-600">|</span>
                      <span className="text-slate-400 font-mono text-[10px]">
                        $0 idle (5m warm window)
                      </span>
                    </div>
                  ) : vastSession.status === 'ready' ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex items-center gap-1.5 text-emerald-400 font-mono text-[11px] font-bold">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        {vastSession.gpuName || 'GPU'} (${vastSession.pricePerHour ? `${vastSession.pricePerHour.toFixed(2)}/hr` : 'active'})
                      </span>
                      <span className="text-slate-600">|</span>
                      <span className="text-slate-400 font-mono text-[10px]" title="Auto-pauses GPU on idle to save credits while keeping cached models">
                        Idle-Pause:{' '}
                        {vastSession.idleSecondsRemaining !== undefined
                          ? `${Math.floor(vastSession.idleSecondsRemaining / 60)}m ${vastSession.idleSecondsRemaining % 60}s`
                          : '20m'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowVastLogs(v => !v)}
                        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[10px] font-mono flex items-center gap-1 transition-all cursor-pointer"
                        title="Toggle remote GPU worker logs"
                      >
                        <Terminal size={10} />
                        {showVastLogs ? 'Hide Logs' : 'Logs'}
                      </button>
                      <button
                        type="button"
                        onClick={handlePauseVastSession}
                        disabled={isVastActionLoading}
                        className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer disabled:opacity-50"
                        title="Pause GPU ($0/hr compute, ~7¢/day disk) so next session wakes in ~20s"
                      >
                        {isVastActionLoading ? <RefreshCw size={10} className="animate-spin" /> : <Pause size={10} />}
                        Pause
                      </button>
                      <button
                        type="button"
                        onClick={handleStopVastSession}
                        disabled={isVastActionLoading}
                        className="px-2 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer disabled:opacity-50"
                        title="Destroy GPU instance completely ($0/hr compute + $0 storage)"
                      >
                        {isVastActionLoading ? <RefreshCw size={10} className="animate-spin" /> : <Power size={10} />}
                        Destroy
                      </button>
                    </div>
                  ) : vastSession.status === 'paused' ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex items-center gap-1.5 text-amber-300 font-mono text-[11px] font-bold">
                        <Pause size={10} className="text-amber-400" />
                        Paused · {vastSession.gpuName || 'GPU'} (${vastSession.storageCostPerHr ? `${vastSession.storageCostPerHr.toFixed(3)}/hr` : '0.003/hr'} disk)
                      </span>
                      {(vastSession.recentLogs?.length || 0) > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowVastLogs(v => !v)}
                          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[10px] font-mono flex items-center gap-1 transition-all cursor-pointer"
                        >
                          <Terminal size={10} />
                          Logs
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleResumeVastSession}
                        disabled={isVastActionLoading}
                        className="px-2.5 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold flex items-center gap-1 shadow-sm transition-all cursor-pointer disabled:opacity-50"
                        title="Wake paused GPU with cached JoyVASA weights (~15-25s)"
                      >
                        {isVastActionLoading ? <RefreshCw size={10} className="animate-spin" /> : <Play size={10} className="fill-current" />}
                        Resume (~20s)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleStartVastSession(true)}
                        disabled={isVastActionLoading}
                        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[10px] font-semibold cursor-pointer disabled:opacity-50"
                        title="Destroy paused instance and rent a fresh GPU"
                      >
                        New GPU
                      </button>
                      <button
                        type="button"
                        onClick={handleStopVastSession}
                        disabled={isVastActionLoading}
                        className="px-2 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-[10px] font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        title="Destroy paused GPU completely"
                      >
                        <Power size={10} />
                        Destroy
                      </button>
                    </div>
                  ) : vastSession.status === 'provisioning' || vastSession.status === 'bootstrapping' ? (
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1.5 text-cyan-300 font-mono text-[11px] font-bold">
                        <RefreshCw size={11} className="animate-spin text-cyan-400" />
                        Stage {vastSession.stageIndex || 1}/{vastSession.stageTotal || 5}:{' '}
                        {vastSession.gpuName ? `${vastSession.gpuName} · ` : ''}
                        Elapsed {formatMmSs((vastSession.elapsedSec || 0) + telemetryTick)}
                      </span>
                      <span className="text-slate-600">|</span>
                      <span className="text-amber-300 font-mono text-[10px]">
                        Est. ~{formatMmSs(Math.max(0, (vastSession.estimatedRemainingSec || 180) - telemetryTick))} left
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowVastLogs(v => !v)}
                        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[10px] font-mono flex items-center gap-1 transition-all cursor-pointer"
                      >
                        <Terminal size={10} />
                        {showVastLogs ? 'Hide Logs' : 'Logs'}
                      </button>
                      <button
                        type="button"
                        onClick={handleStopVastSession}
                        disabled={isVastActionLoading}
                        className="px-2 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-[10px] font-bold transition-all cursor-pointer disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : vastSession.status === 'error' ? (
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1.5 text-rose-400 font-mono text-[11px] font-bold">
                        <AlertTriangle size={11} />
                        Boot Error
                      </span>
                      <button
                        type="button"
                        onClick={handleRetryVastSession}
                        disabled={isVastActionLoading}
                        className="px-2.5 py-0.5 rounded bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        {isVastActionLoading ? <RefreshCw size={10} className="animate-spin" /> : <RotateCcw size={10} />}
                        Destroy & Retry New GPU
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1.5 text-slate-400 font-mono text-[11px]">
                        <span className="w-2 h-2 rounded-full bg-slate-500" />
                        Vast.ai JoyVASA GPU Offline
                      </span>
                      {(vastSession.recentLogs?.length || 0) > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowVastLogs(v => !v)}
                          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[10px] font-mono flex items-center gap-1 transition-all cursor-pointer"
                        >
                          <Terminal size={10} />
                          Logs
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleStartVastSession(false)}
                        disabled={isVastActionLoading}
                        className="px-2.5 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold flex items-center gap-1 shadow-sm transition-all cursor-pointer disabled:opacity-50"
                        title="Rent an on-demand GPU (~$0.15-$0.35/hr) for real-time 25fps JoyVASA + LivePortrait rendering"
                      >
                        {isVastActionLoading ? <RefreshCw size={10} className="animate-spin" /> : <Zap size={10} className="fill-current" />}
                        Start Vast GPU
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                3-Step Workflow: Face Rig → Driving Audio → Performance Calibration &amp; Export
              </p>
            </div>
          </div>

          {/* Aspect Ratio & Primary Render CTA */}
          <div className="flex items-center gap-2.5">
            <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setAspectRatio('16-9')}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  aspectRatio === '16-9' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                }`}
                title="Landscape 16:9 (1080p Studio / 720p Draft)"
              >
                16:9 (1080p)
              </button>
              <button
                type="button"
                onClick={() => setAspectRatio('9-16')}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  aspectRatio === '9-16' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                }`}
                title="Vertical 9:16 Shorts"
              >
                9:16 Shorts
              </button>
              <button
                type="button"
                onClick={() => setAspectRatio('1-1')}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  aspectRatio === '1-1' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                }`}
                title="Square 1:1"
              >
                1:1
              </button>
            </div>

            <button
              type="button"
              onClick={handleRenderVideo}
              disabled={isRendering || (renderEngine === 'vast' && vastSession.status !== 'ready')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white shadow-lg transition-all cursor-pointer disabled:opacity-50 ${
                renderEngine !== 'local'
                  ? 'bg-gradient-to-r from-purple-600 via-indigo-600 to-cyan-500 hover:from-purple-500 hover:to-cyan-400 shadow-purple-900/40'
                  : 'bg-gradient-to-r from-indigo-600 to-slate-700 hover:from-indigo-500 hover:to-slate-600 shadow-indigo-900/30'
              }`}
            >
              {isRendering ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  <span>{renderEngine === 'modal' ? 'Modal L40S' : renderEngine === 'vast' ? 'JoyVASA GPU' : 'Rendering'} {renderProgress}%</span>
                </>
              ) : (
                <>
                  {renderEngine !== 'local' ? (
                    <Sparkles size={14} className="text-amber-300 fill-amber-300" />
                  ) : (
                    <Zap size={14} className="fill-current" />
                  )}
                  <span>
                    {renderEngine === 'modal'
                      ? 'Render MP4 (Modal L40S)'
                      : renderEngine === 'vast'
                        ? 'Render MP4 (JoyVASA GPU)'
                        : 'Render Draft (Local Preview)'}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* ── LIVE 5-STEP VAST GPU TELEMETRY & LOG PANEL ── */}
        {(vastSession.status === 'provisioning' ||
          vastSession.status === 'bootstrapping' ||
          vastSession.status === 'error' ||
          (vastSession.status === 'ready' && (showVastLogs || vastSession.activeRender?.active)) ||
          ((vastSession.status === 'offline' || vastSession.status === 'paused') && showVastLogs)) && (
          <div className="rounded-xl bg-slate-950/90 border border-slate-800/90 p-3 space-y-2.5 shadow-inner">
            {(vastSession.status === 'provisioning' || vastSession.status === 'bootstrapping') && (
              <>
                <div className="grid grid-cols-5 gap-2">
                  {[
                    { idx: 1, label: '1. Renting GPU' },
                    { idx: 2, label: '2. Installing Deps' },
                    { idx: 3, label: '3. Downloading Models' },
                    { idx: 4, label: '4. Loading VRAM' },
                    { idx: 5, label: '5. Ready' },
                  ].map(step => {
                    const currentIdx = vastSession.stageIndex || 1;
                    const isDone = currentIdx > step.idx;
                    const isActive = currentIdx === step.idx;
                    return (
                      <div key={step.idx} className="space-y-1">
                        <div
                          className={`h-1.5 rounded-full transition-all duration-300 ${
                            isDone
                              ? 'bg-emerald-500'
                              : isActive
                                ? 'bg-gradient-to-r from-cyan-400 to-indigo-500 animate-pulse'
                                : 'bg-slate-800'
                          }`}
                        />
                        <div className="flex items-center justify-between text-[10px] font-mono">
                          <span
                            className={`truncate ${
                              isDone ? 'text-emerald-400 font-bold' : isActive ? 'text-cyan-300 font-bold' : 'text-slate-500'
                            }`}
                          >
                            {isDone ? '✓ ' : ''}{step.label}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {vastSession.isStalled ? (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2 rounded-lg bg-rose-950/60 border border-rose-500/50 text-xs">
                    <div className="flex items-center gap-2 text-rose-200 min-w-0">
                      <AlertTriangle size={14} className="text-rose-400 shrink-0" />
                      <span className="font-mono text-[11px] truncate">
                        Stalled for {(vastSession.lastHeartbeatAgoSec || 90) + telemetryTick}s on{' '}
                        {vastSession.stageLabel || `Stage ${vastSession.stageIndex || 1}`}
                        {vastSession.stallReason ? ` — ${vastSession.stallReason}` : ''}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleRetryVastSession}
                      disabled={isVastActionLoading}
                      className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold flex items-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-50"
                    >
                      {isVastActionLoading ? <RefreshCw size={11} className="animate-spin" /> : <RotateCcw size={11} />}
                      Destroy &amp; Retry New GPU
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono bg-slate-900/70 px-3 py-1.5 rounded-lg border border-slate-800/80">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                      <span className="text-emerald-400 font-semibold shrink-0">
                        Live · updated {(vastSession.lastHeartbeatAgoSec || 0) + telemetryTick}s ago
                      </span>
                      <span className="text-slate-600 shrink-0">|</span>
                      <span className="text-slate-300 truncate">
                        {(vastSession.recentLogs && vastSession.recentLogs.length > 0
                          ? vastSession.recentLogs[vastSession.recentLogs.length - 1]
                          : vastSession.stageLabel) || 'Initializing...'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 text-slate-400">
                      {vastSession.gpuName && (
                        <span className="text-indigo-300 font-semibold">
                          {vastSession.gpuName} (${vastSession.pricePerHour ? vastSession.pricePerHour.toFixed(2) : '0.00'}/hr)
                        </span>
                      )}
                      <span>Elapsed: {formatMmSs((vastSession.elapsedSec || 0) + telemetryTick)}</span>
                      <span className="text-cyan-300">
                        Est. Remaining: ~{formatMmSs(Math.max(0, (vastSession.estimatedRemainingSec || 0) - telemetryTick))}
                      </span>
                    </div>
                  </div>
                )}
              </>
            )}

            {vastSession.status === 'error' && vastSession.lastError && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2 rounded-lg bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200">
                <span className="font-mono text-[11px] truncate">{vastSession.lastError}</span>
                <button
                  type="button"
                  onClick={handleRetryVastSession}
                  disabled={isVastActionLoading}
                  className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-bold flex items-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-50"
                >
                  <RotateCcw size={11} /> Destroy &amp; Retry New GPU
                </button>
              </div>
            )}

            {showVastLogs && (
              <div className="rounded-lg bg-black/90 border border-slate-800 p-2.5 font-mono text-[10px] leading-relaxed text-slate-300 max-h-40 overflow-y-auto space-y-0.5">
                <div className="flex items-center justify-between text-slate-500 border-b border-slate-800/80 pb-1 mb-1">
                  <span>/workspace/avatar_worker.log (last 12 lines)</span>
                  <span>{vastSession.endpointUrl || (vastSession.instanceId ? `Instance #${vastSession.instanceId}` : 'Offline')}</span>
                </div>
                {vastSession.recentLogs && vastSession.recentLogs.length > 0 ? (
                  vastSession.recentLogs.map((line, i) => (
                    <div key={i} className="break-all whitespace-pre-wrap">
                      <span className="text-slate-600 mr-2 select-none">{String(i + 1).padStart(2, '0')}</span>
                      <span
                        className={
                          line.includes('[STAGE')
                            ? 'text-cyan-300 font-bold'
                            : line.toLowerCase().includes('error')
                              ? 'text-rose-400'
                              : 'text-slate-300'
                        }
                      >
                        {line}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text-slate-500 italic">Waiting for remote container logs...</div>
                )}
              </div>
            )}
          </div>
        )}
      </header>

      {/* ── 3-COLUMN WORKSPACE ── */}
      <div className="flex-1 min-h-0 flex flex-col xl:flex-row overflow-y-auto xl:overflow-hidden">
        {/* ── LEFT DOCK: STEP 1 (FACE RIG) & STEP 2 (DRIVING AUDIO) ── */}
        <aside className="w-full xl:w-80 shrink-0 border-b xl:border-b-0 xl:border-r border-slate-800 bg-slate-900/40 p-5 pb-24 xl:overflow-y-auto space-y-6">
          {/* STEP 1: PORTRAIT RIG */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-full bg-indigo-600 text-[10px] text-white flex items-center justify-center font-bold">
                  1
                </span>
                Face Rig ({personas.length})
              </h3>
              <button
                type="button"
                onClick={() => faceInputRef.current?.click()}
                className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 cursor-pointer"
                title="Upload portrait photo for 512x512 crop"
              >
                <Upload size={11} /> + Upload Face
              </button>
            </div>

            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-[10px] font-semibold mb-2.5">
              {(['all', 'disk', 'custom'] as const).map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setPersonaFilter(f)}
                  className={`flex-1 py-1 rounded-lg capitalize transition-colors cursor-pointer ${
                    personaFilter === f ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {f === 'all' ? 'All' : f === 'disk' ? 'Library' : 'Custom'}
                </button>
              ))}
            </div>

            <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
              {filteredPersonas.map(persona => {
                const isSelected = selectedPersona.id === persona.id;
                return (
                  <button
                    key={persona.id}
                    type="button"
                    onClick={() => setSelectedPersona(persona)}
                    className={`w-full text-left p-2 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-gradient-to-r from-indigo-950/60 to-violet-950/60 border-indigo-500/80 shadow-md shadow-indigo-500/20'
                        : 'bg-slate-950/50 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900/40'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-lg overflow-hidden border border-white/10 shrink-0 bg-slate-900 relative shadow-sm">
                        <img src={persona.avatarUrl} alt={persona.name} className="w-full h-full object-cover" />
                        {isSelected && <div className="absolute inset-0 bg-indigo-500/15 ring-1 ring-indigo-400" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-[11px] font-bold text-white truncate">{persona.name}</h4>
                        <p className="text-[10px] font-mono text-slate-400 truncate">
                          {persona.category === 'custom'
                            ? `Custom Upload (${formatKb(persona.fileSizeBytes)})`
                            : `${persona.avatarUrl.split('/').pop()} · ${formatKb(persona.fileSizeBytes)}`}
                        </p>
                      </div>
                      {isSelected && <Check size={13} className="text-indigo-400 shrink-0" />}
                    </div>
                  </button>
                );
              })}
              {!isAssetsLoading && filteredPersonas.length === 0 && (
                <p className="text-[11px] text-slate-500 px-2 py-3 text-center">No portraits in this filter yet.</p>
              )}
            </div>
          </div>

          {/* STEP 2: DRIVING AUDIO / VOICE TRACK SELECTOR */}
          <div className="pt-3 border-t border-slate-800/80">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-full bg-violet-600 text-[10px] text-white flex items-center justify-center font-bold">
                  2
                </span>
                Driving Audio ({audioSources.length})
              </h3>
              <button
                type="button"
                onClick={() => audioInputRef.current?.click()}
                className="text-[10px] font-bold text-violet-400 hover:text-violet-300 flex items-center gap-1 px-2 py-0.5 rounded bg-violet-500/10 border border-violet-500/20 cursor-pointer"
                title="Upload custom WAV or MP3 speech file"
              >
                <Upload size={11} /> + Upload WAV
              </button>
            </div>

            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-[10px] font-semibold mb-2.5">
              {(['all', 'sample', 'vox', 'upload'] as const).map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setAudioFilter(f)}
                  className={`flex-1 py-1 rounded-lg capitalize transition-colors cursor-pointer ${
                    audioFilter === f ? 'bg-violet-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {f === 'all' ? 'All' : f === 'sample' ? 'Samples' : f === 'vox' ? 'Vox' : 'Uploads'}
                </button>
              ))}
            </div>

            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {filteredAudioSources.map(audio => {
                const isSelected = selectedAudio.id === audio.id;
                return (
                  <button
                    key={audio.id}
                    type="button"
                    onClick={() => setSelectedAudio(audio)}
                    className={`w-full text-left p-2 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-gradient-to-r from-violet-950/60 to-purple-950/60 border-violet-500/80 shadow-md shadow-violet-500/20'
                        : 'bg-slate-950/50 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Music size={13} className={isSelected ? 'text-violet-400 shrink-0' : 'text-slate-500 shrink-0'} />
                        <span className="text-[11px] font-bold text-white truncate">{audio.name}</span>
                      </div>
                      <span className="text-[10px] font-mono text-violet-300 font-bold shrink-0">
                        {formatDurationShort(audio.durationSec)}
                      </span>
                    </div>
                    <p className="text-[10px] font-mono text-slate-400 truncate mt-0.5 pl-5">
                      {audio.speaker ? `${audio.speaker} · ` : ''}
                      {audio.category.toUpperCase()}
                      {audio.fileSizeBytes ? ` · ${formatKb(audio.fileSizeBytes)}` : ''}
                    </p>
                  </button>
                );
              })}
              {!isAssetsLoading && filteredAudioSources.length === 0 && (
                <p className="text-[11px] text-slate-500 px-2 py-3 text-center">No audio tracks in this filter yet.</p>
              )}
            </div>
          </div>
        </aside>

        {/* ── CENTER STAGE: PREVIEW VIEWPORT, AUDIO TRANSPORT & RENDER HISTORY ── */}
        <main className="flex-1 min-w-0 min-h-0 flex flex-col p-6 pb-24 xl:overflow-y-auto space-y-5">
          {/* Video Preview Viewport */}
          <div className="min-h-[340px] flex-1 rounded-2xl bg-slate-950 border border-slate-800 overflow-hidden relative shadow-2xl flex items-center justify-center">
            {/* 1. COMPLETED STATE: REAL RENDERED MP4 ACTIVE */}
            {renderedJob?.videoUrl ? (
              <div className="w-full h-full flex flex-col items-center justify-center p-4">
                <video
                  src={renderedJob.videoUrl}
                  controls
                  autoPlay
                  loop
                  playsInline
                  onError={() => {
                    const message = `The rendered video could not be loaded from ${renderedJob.videoUrl}.`;
                    setRenderError(message);
                    showToast(message);
                  }}
                  className="max-h-[360px] rounded-2xl shadow-2xl border border-indigo-500/50 object-contain bg-black"
                />
                <div className="mt-3 flex flex-wrap items-center justify-center gap-3 bg-slate-900/90 px-4 py-1.5 rounded-full border border-slate-700 shadow-xl">
                  <span className="text-[11px] font-mono text-emerald-400 font-bold flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    {renderedJob.resolution} @ {renderedJob.fps}fps — {renderedJob.renderMode || 'Vast.ai JoyVASA + LivePortrait'}
                  </span>
                  <span className="text-slate-600">|</span>
                  <button
                    type="button"
                    onClick={() => setRenderedJob(null)}
                    className="text-[11px] text-slate-300 hover:text-white underline cursor-pointer"
                  >
                    Preview Source Portrait
                  </button>
                </div>
              </div>
            ) : isRendering ? (
              /* 2. GENERATING STATE: EXPLICIT 3-STEP PROGRESS OVERLAY */
              <div className="w-full h-full flex flex-col items-center justify-center p-6 space-y-4 bg-slate-950/90">
                <div className="relative w-16 h-16 flex items-center justify-center">
                  <div className="w-14 h-14 rounded-full border-4 border-t-indigo-500 border-r-violet-500 border-b-cyan-400 border-l-transparent animate-spin" />
                  <Zap size={20} className="text-indigo-400 absolute" />
                </div>

                <div className="text-center max-w-lg space-y-2.5">
                  <h3 className="text-sm font-bold text-white tracking-wide uppercase flex items-center justify-center gap-2">
                    {renderEngine !== 'local' ? (
                      <>
                        <Sparkles size={14} className="text-purple-400" />
                        <span>
                          {renderEngine === 'modal'
                            ? 'JoyVASA + LivePortrait Modal L40S Generation'
                            : 'JoyVASA + LivePortrait Vast GPU Generation'}
                        </span>
                      </>
                    ) : (
                      <>
                        <SlidersHorizontal size={14} className="text-indigo-400" />
                        <span>Local Draft Compositor Rendering</span>
                      </>
                    )}
                  </h3>
                  {renderEngine !== 'local' ? (
                    <div className="space-y-2">
                      {(() => {
                        const activeTelemetry = renderEngine === 'modal' ? modalActiveRender : vastSession.activeRender;
                        const activeIdx = activeTelemetry?.stepIndex || 1;
                        return (
                          <>
                            <p className="text-xs font-mono text-cyan-300 font-bold">
                              {activeTelemetry?.active
                                ? `${activeTelemetry.stepLabel} · Elapsed ${formatMmSs((activeTelemetry.elapsedSec || 0) + telemetryTick)}`
                                : '1. Prepping 16kHz Audio...'}
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 text-[10px] font-mono">
                              {[
                                { idx: 1, label: '1. Prepping 16kHz Audio' },
                                { idx: 2, label: renderEngine === 'modal' ? '2. JoyVASA + LivePortrait L40S' : '2. JoyVASA + LivePortrait GPU' },
                                { idx: 3, label: '3. Local 48kHz Audio Muxing' },
                              ].map(step => {
                                const done = activeIdx > step.idx;
                                const active = activeIdx === step.idx;
                                return (
                                  <div
                                    key={step.idx}
                                    className={`px-2 py-1 rounded border truncate ${
                                      done
                                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                                        : active
                                          ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-200 font-bold'
                                          : 'bg-slate-900 border-slate-800 text-slate-500'
                                    }`}
                                  >
                                    {done ? '✓ ' : ''}{step.label}
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  ) : (
                    <p className="text-xs font-mono text-indigo-300">
                      {renderProgress < 40
                        ? '[1/2] Preparing driving audio & framing crop...'
                        : '[2/2] Encoding local FFmpeg draft MP4...'}
                    </p>
                  )}
                </div>

                <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-full h-3 p-0.5 overflow-hidden shadow-inner">
                  <div
                    className="h-full bg-gradient-to-r from-indigo-500 via-violet-500 to-cyan-400 rounded-full transition-all duration-300"
                    style={{ width: `${renderProgress}%` }}
                  />
                </div>

                <div className="flex items-center justify-between w-full max-w-sm text-[11px] font-mono text-slate-400">
                  <span className="truncate max-w-[140px]">{selectedPersona.name}</span>
                  <span className="text-white font-bold">{renderProgress}%</span>
                  <span>
                    {aspectRatio.toUpperCase()} • {renderQuality === 'draft' ? '720p' : '1080p'} •{' '}
                    {renderEngine !== 'local' ? '25fps' : '25fps draft'}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    renderAbortRef.current?.abort();
                    machineRef.current.send('RESET');
                    setIsRendering(false);
                    setRenderProgress(0);
                    showToast('Generation canceled by user.');
                  }}
                  className="mt-1 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-rose-400 hover:text-rose-300 border border-rose-500/30 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <X size={13} /> Cancel Generation
                </button>
              </div>
            ) : (
              /* 3. IDLE PREVIEW: CLEAN SOURCE PORTRAIT & FRAMING PREVIEW */
              <div className="flex flex-col items-center justify-center text-center p-6 space-y-4">
                <div
                  className={`relative overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900 shadow-2xl flex items-center justify-center ${
                    aspectRatio === '9-16'
                      ? 'w-44 h-72'
                      : aspectRatio === '1-1'
                        ? 'w-60 h-60'
                        : 'w-80 h-48'
                  }`}
                >
                  <img
                    src={selectedPersona.avatarUrl}
                    alt={selectedPersona.name}
                    className="w-full h-full object-cover transition-transform duration-200"
                    style={{ transform: `scale(${previewScale})` }}
                  />
                  <div className="absolute bottom-2 inset-x-0 mx-auto w-fit px-2.5 py-0.5 rounded-full bg-black/80 border border-white/15 text-[10px] font-mono text-slate-200 flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${isPlaying ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'}`} />
                    <span>{isPlaying ? 'Playing Audio Preview' : `${selectedPersona.name} · ${cropFraming}`}</span>
                  </div>
                </div>
                <p className="text-xs text-slate-400 font-mono">
                  {selectedAudio.name} ({formatDurationShort(totalDuration)})
                </p>
              </div>
            )}
          </div>

          {/* Real Synchronized Audio Preview Transport */}
          <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-4 shadow-xl space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsPlaying(prev => !prev)}
                  className="w-9 h-9 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white flex items-center justify-center shadow-md shadow-indigo-600/30 cursor-pointer"
                  title={isPlaying ? 'Pause Driving Audio' : 'Preview Driving Audio'}
                >
                  {isPlaying ? <Pause size={16} className="fill-current" /> : <Play size={16} className="fill-current ml-0.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => handleSeek(currentTime - 1)}
                  className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 cursor-pointer"
                  title="Step back 1 second"
                >
                  <SkipBack size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => handleSeek(currentTime + 1)}
                  className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 cursor-pointer"
                  title="Step forward 1 second"
                >
                  <SkipForward size={14} />
                </button>
                <div className="font-mono text-xs font-bold text-white bg-slate-950 px-3 py-1 rounded-lg border border-slate-800">
                  {formatDurationShort(currentTime)} / {formatDurationShort(totalDuration)}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsMuted(prev => !prev)}
                  className="text-slate-400 hover:text-white cursor-pointer"
                  aria-label="Toggle mute"
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

            <div
              onClick={e => {
                const rect = e.currentTarget.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const ratio = Math.max(0, Math.min(1, clickX / rect.width));
                handleSeek(ratio * totalDuration);
              }}
              className="relative h-2 bg-slate-800 rounded-full cursor-pointer"
              title="Click to seek driving audio"
            >
              <div
                className="absolute top-0 bottom-0 bg-indigo-500 rounded-full transition-all duration-75"
                style={{ width: `${totalDuration > 0 ? Math.min(100, (currentTime / totalDuration) * 100) : 0}%` }}
              />
            </div>
          </div>

          {/* Real Render History Panel (backed by /api/avatar/renders) */}
          <div className="rounded-2xl bg-slate-900/70 border border-slate-800 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Film size={14} className="text-indigo-400" />
                Saved Renders ({renderHistory.length})
              </h3>
              <button
                type="button"
                onClick={loadRenderHistory}
                className="text-[11px] font-mono text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw size={11} /> Refresh
              </button>
            </div>

            {renderHistory.length === 0 ? (
              <p className="text-xs text-slate-500 py-2">No saved MP4 renders in `public/output/episodes/` yet.</p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {renderHistory.map(item => {
                  const isActive = renderedJob?.jobId === item.jobId;
                  return (
                    <div
                      key={item.jobId}
                      className={`flex items-center justify-between gap-3 px-3 py-2 rounded-xl border text-xs transition-all ${
                        isActive
                          ? 'bg-indigo-950/50 border-indigo-500/60'
                          : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setRenderedJob({
                            jobId: item.jobId,
                            videoUrl: item.videoUrl,
                            resolution: item.resolution,
                            fps: item.fps,
                            durationSec: item.durationSec,
                            renderMode: item.renderMode,
                            personaName: item.personaName,
                          })
                        }
                        className="min-w-0 flex-1 text-left cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <Play size={12} className={isActive ? 'text-emerald-400 shrink-0' : 'text-indigo-400 shrink-0'} />
                          <span className="font-semibold text-white truncate">
                            {item.personaName || item.jobId}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400 shrink-0">
                            {item.resolution} @ {item.fps}fps
                          </span>
                        </div>
                        <p className="text-[10px] font-mono text-slate-400 truncate pl-5">
                          {item.renderMode} · {item.durationSec ? formatDurationShort(item.durationSec) : '--:--'} ·{' '}
                          {formatMb(item.fileSizeBytes)}
                        </p>
                      </button>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => downloadMp4(item.videoUrl, item.jobId)}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer"
                          title="Download MP4"
                        >
                          <Download size={13} />
                        </button>
                        <button
                          type="button"
                          disabled={deletingJobId === item.jobId}
                          onClick={() => handleDeleteRender(item.jobId)}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/70 text-slate-400 hover:text-rose-300 cursor-pointer disabled:opacity-50"
                          title="Delete MP4 from disk"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </main>

        {/* ── RIGHT DRAWER: STEP 3 (PERFORMANCE CALIBRATION & EXPORT) ── */}
        <aside className="w-full xl:w-80 shrink-0 border-t xl:border-t-0 xl:border-l border-slate-800 bg-slate-900/40 p-5 pb-24 xl:overflow-y-auto space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-full bg-cyan-600 text-[10px] text-white flex items-center justify-center font-bold">
                3
              </span>
              Performance Rig
            </h3>
            <span className="text-[10px] font-mono text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
              JoyVASA + LivePortrait
            </span>
          </div>

          {/* Engine Selection */}
          <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-200 font-bold flex items-center gap-1.5">
                <Zap size={13} className="text-amber-400" />
                Render Engine
              </span>
              <span className="text-[10px] font-mono text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">
                {renderEngine === 'modal'
                  ? 'Modal L40S (25fps)'
                  : renderEngine === 'vast'
                    ? 'Vast JoyVASA (25fps)'
                    : 'FFmpeg Local'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800 text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => setRenderEngine('modal')}
                className={`py-1.5 px-1.5 rounded-md flex items-center justify-center gap-1 transition-all cursor-pointer ${
                  renderEngine === 'modal'
                    ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold shadow-md shadow-purple-900/40'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Sparkles size={11} className="text-amber-300 shrink-0" />
                <span className="truncate">Modal</span>
              </button>
              <button
                type="button"
                onClick={() => setRenderEngine('vast')}
                className={`py-1.5 px-1.5 rounded-md flex items-center justify-center gap-1 transition-all cursor-pointer ${
                  renderEngine === 'vast'
                    ? 'bg-indigo-600 text-white font-bold shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Zap size={11} className="text-cyan-300 shrink-0" />
                <span className="truncate">Vast</span>
              </button>
              <button
                type="button"
                onClick={() => setRenderEngine('local')}
                className={`py-1.5 px-1.5 rounded-md flex items-center justify-center gap-1 transition-all cursor-pointer ${
                  renderEngine === 'local'
                    ? 'bg-slate-800 text-slate-100 font-bold border border-slate-700'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <SlidersHorizontal size={11} className="shrink-0" />
                <span className="truncate">Draft</span>
              </button>
            </div>
            <p className="text-[10px] text-slate-400 leading-normal">
              {renderEngine === 'modal'
                ? 'Renders 25fps FP16 talking video on Modal L40S serverless GPU (~12–20s warm, $0 idle).'
                : renderEngine === 'vast'
                  ? 'Renders 25fps FP16 talking video with JoyVASA + LivePortrait on Vast.ai GPU.'
                  : 'Runs instant local FFmpeg draft preview without neural lip-sync.'}
            </p>
          </div>

          {/* Quality Selection (wired to renderQuality) */}
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
              <span>Output Quality</span>
              <span className="text-[10px] text-cyan-400 font-mono">
                {renderQuality === 'standard' ? '1080p Studio' : '720p Draft Fast'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800 text-[11px] font-semibold text-center">
              <button
                type="button"
                onClick={() => setRenderQuality('standard')}
                className={`py-1.5 rounded transition-colors cursor-pointer ${
                  renderQuality === 'standard' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                1080p Studio
              </button>
              <button
                type="button"
                onClick={() => setRenderQuality('draft')}
                className={`py-1.5 rounded transition-colors cursor-pointer ${
                  renderQuality === 'draft' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                720p Fast
              </button>
            </div>
          </div>

          {/* Crop Framing (wired to cropFraming) */}
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
              <span className="flex items-center gap-1.5">
                <Crop size={13} className="text-violet-400" /> Crop Framing
              </span>
              <span className="text-[10px] text-violet-400 font-mono">{cropFraming}</span>
            </div>
            <div className="grid grid-cols-3 gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800 text-[11px] font-semibold text-center">
              <button
                type="button"
                onClick={() => setCropFraming('wide')}
                className={`py-1.5 rounded transition-colors cursor-pointer ${
                  cropFraming === 'wide' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Wide
              </button>
              <button
                type="button"
                onClick={() => setCropFraming('standard')}
                className={`py-1.5 rounded transition-colors cursor-pointer ${
                  cropFraming === 'standard' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Standard
              </button>
              <button
                type="button"
                onClick={() => setCropFraming('close-up')}
                className={`py-1.5 rounded transition-colors cursor-pointer ${
                  cropFraming === 'close-up' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Close-Up
              </button>
            </div>
          </div>

          {/* Lip-Sync Tightness Slider (0-100, default 40) */}
          <div className="space-y-1.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-semibold">Lip-Sync Tightness</span>
              <span className="font-mono text-indigo-400 font-bold">{lipSyncTightness}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={lipSyncTightness}
              onChange={e => setLipSyncTightness(parseInt(e.target.value, 10))}
              className="w-full accent-indigo-500 cursor-pointer"
            />
            <div className="flex items-center justify-between text-[10px] text-slate-500">
              <span>Mouth Delta Gain (0.35x–0.90x)</span>
              <span className="text-indigo-400 font-mono">Mult 0.70</span>
            </div>
          </div>

          {/* Head Motion & Sway Slider (0-100, default 15) */}
          <div className="space-y-1.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-semibold">Head Sway &amp; Nodding</span>
              <span className="font-mono text-indigo-400 font-bold">{headSwayAmplitude}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={headSwayAmplitude}
              onChange={e => setHeadSwayAmplitude(parseInt(e.target.value, 10))}
              className="w-full accent-indigo-500 cursor-pointer"
            />
            <div className="flex items-center justify-between text-[10px] text-slate-500">
              <span>0% = Expression Only</span>
              <span className="text-indigo-400 font-mono">Pitch / Yaw / Roll</span>
            </div>
          </div>

          {/* Expression Intensity Slider (0-100, default 25) */}
          <div className="space-y-1.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-semibold">Expression Intensity</span>
              <span className="font-mono text-violet-400 font-bold">{microExpressionScale}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={microExpressionScale}
              onChange={e => setMicroExpressionScale(parseInt(e.target.value, 10))}
              className="w-full accent-violet-500 cursor-pointer"
            />
            <div className="flex items-center justify-between text-[10px] text-slate-500">
              <span>Eyes Attenuated (0.25–0.40x)</span>
              <span className="text-violet-400 font-mono">CFG 1.10–1.45</span>
            </div>
          </div>

          {/* Export Actions */}
          <div className="space-y-2 pt-2 border-t border-slate-800/80">
            {renderedJob ? (
              <>
                <div className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-[11px] text-emerald-300 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-semibold">
                    <Check size={13} className="text-emerald-400" />
                    {renderedJob.resolution} ({renderedJob.fps}fps) Ready
                  </span>
                  <span className="font-mono text-[9px] text-emerald-400/80">{renderedJob.jobId.slice(0, 14)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => downloadMp4(renderedJob.videoUrl, renderedJob.jobId)}
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Download size={14} /> Download Master MP4
                </button>
              </>
            ) : (
              <p className="text-[11px] text-slate-500 text-center">
                Use the header button to render with the current rig calibration.
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};

function formatDurationShort(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const total = Math.round(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatMmSs(totalSec: number = 0): string {
  const safe = Math.max(0, Math.round(totalSec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatKb(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'disk';
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatMb(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '-- MB';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default AvatarStudio;
