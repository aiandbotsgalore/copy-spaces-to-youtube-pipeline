import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useAudioLevelMeter } from '../hooks/useAudioLevelMeter';
import {
  Mic2,
  Play,
  Pause,
  Download,
  Sparkles,
  Sliders,
  AudioWaveform,
  Volume2,
  VolumeX,
  RefreshCw,
  Layers,
  Check,
  Copy,
  Radio,
  Clock,
  Film,
  Zap,
  RotateCcw,
  Trash2,
  ExternalLink,
  FileText,
  AlertTriangle,
  Info
} from 'lucide-react';
import { EnhancedConfig } from '../types';
import { getSpeakerTheme } from '../utils/transcriptData';
import { useMontageClips } from '../contexts/MontageContext';
import { fetchJsonCandidates } from '../utils/safeFetch';
import { appDialog } from '../contexts/DialogContext';
import { createMachine } from '../utils/stateMachine';

export type VoxSynthesisState = 'idle' | 'synthesizing' | 'synthesized' | 'error';

interface Props {
  config: EnhancedConfig;
}

export interface VoiceClipItem {
  id: string;
  filename: string;
  title: string;
  text: string;
  speaker: string;
  duration: number;
  createdAt: string;
  audioUrl: string;
  elapsedSec?: number;
  format?: string;
  sampleRate?: number;
  timesteps?: number;
  cfg?: number;
}

interface SpeakerReferenceStatus {
  name: string;
  exists: boolean;
  filename: string | null;
  format: string | null;
  duration: number | null;
  sampleRate: number | null;
  audioUrl: string | null;
  hasTranscript: boolean;
  transcriptSample?: string;
}

interface SpaceHealth {
  status: 'running' | 'building' | 'sleeping' | 'offline' | 'not_deployed';
  displayStatus: string;
  spaceId: string;
  hardware: string | null;
  stage: string;
  url: string;
}

export const VoxStudio: React.FC<Props> = ({ config }) => {
  const montage = useMontageClips();

  // Voice Profile & Speaker Reference State
  const [selectedSpeaker, setSelectedSpeaker] = useState('Logan');
  const [voiceProfiles, setVoiceProfiles] = useState<any[]>([]);
  const [speakerRefs, setSpeakerRefs] = useState<SpeakerReferenceStatus[]>([]);

  // Studio Script Editor State
  const [scriptText, setScriptText] = useState(
    "Welcome back everyone. Tonight on X-Spaces, we are pulling the thread on the 2026 archive. If you haven't seen the documentary evidence released this afternoon, buckle up because we have receipts on the record."
  );
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Real Fine-Tuning Parameter Controls (Native VoxCPM parameters)
  const [diffusionSteps, setDiffusionSteps] = useState(15); // inference_timesteps (10-30)
  const [cfgValue, setCfgValue] = useState(2.0); // cfg_value (1.0-5.0)

  // Cloud Space Live Health State
  const [spaceHealth, setSpaceHealth] = useState<SpaceHealth | null>(null);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);

  // Audio Playback & Generation State
  const [synthesisState, setSynthesisState] = useState<VoxSynthesisState>('idle');
  const [isSynthesizing, setIsSynthesizing] = useState(false);

  const machineRef = useRef(
    createMachine<VoxSynthesisState, 'START' | 'FINISH' | 'FAIL' | 'RESET'>(
      {
        id: 'vox-studio',
        initial: 'idle',
        states: {
          idle: { START: 'synthesizing' },
          synthesizing: { FINISH: 'synthesized', FAIL: 'error', RESET: 'idle' },
          synthesized: { START: 'synthesizing', RESET: 'idle' },
          error: { START: 'synthesizing', RESET: 'idle' },
        },
        onTransition: (_from, to) => {
          setSynthesisState(to);
          setIsSynthesizing(to === 'synthesizing');
        },
      },
      {}
    )
  );

  // Real Persisted Audio Takes Library
  const [generatedClips, setGeneratedClips] = useState<VoiceClipItem[]>([]);
  const [activeClip, setActiveClip] = useState<VoiceClipItem | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingClipId, setPlayingClipId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.9);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [pendingAutoplayClip, setPendingAutoplayClip] = useState<VoiceClipItem | null>(null);

  // Toast System
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<any>(null);
  const [copiedStatus, setCopiedStatus] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const showToast = (msg: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(msg);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // Fetch real Space health status
  const fetchSpaceHealth = async () => {
    setIsCheckingHealth(true);
    try {
      const res = await fetch('/api/vox/health');
      if (res.ok) {
        const data = await res.json();
        setSpaceHealth(data);
      }
    } catch {
      setSpaceHealth(null);
    } finally {
      setIsCheckingHealth(false);
    }
  };

  // Fetch real persisted takes from disk
  const fetchPersistedTakes = async () => {
    try {
      const res = await fetch('/api/vox/takes');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.takes)) {
          const formatted: VoiceClipItem[] = data.takes.map((t: any) => ({
            id: t.id,
            filename: t.filename,
            title: t.prompt ? t.prompt.slice(0, 42) + '...' : t.filename,
            text: t.prompt || '',
            speaker: t.speaker || 'Logan',
            duration: Number(t.duration) || 0,
            createdAt: t.createdAtFormatted || new Date(t.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }),
            audioUrl: t.audioUrl,
            elapsedSec: t.elapsedSec,
            format: t.format,
            sampleRate: t.sampleRate,
            timesteps: t.timesteps,
            cfg: t.cfg,
          }));
          setGeneratedClips(formatted);
          if (formatted.length > 0 && !activeClip) {
            setActiveClip(formatted[0]);
            setDuration(formatted[0].duration);
          }
        }
      }
    } catch (err) {
      console.warn('Failed to fetch takes:', err);
    }
  };

  // Fetch enrolled speakers and their reference audio on disk
  const fetchSpeakerReferences = async () => {
    try {
      const res = await fetch('/api/vox/speakers');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.speakers)) {
          setSpeakerRefs(data.speakers);
        }
      }
    } catch (err) {
      console.warn('Failed to fetch speaker references:', err);
    }
  };

  // Load voice profiles from JSON
  useEffect(() => {
    const controller = new AbortController();
    const owner = (config.ownerName || '').trim();
    const repo = (config.repoName || '').trim();
    fetchJsonCandidates<any>(
      [
        '/voice_profiles.json',
        './voice_profiles.json',
        ...(owner && repo ? [`https://raw.githubusercontent.com/${owner}/${repo}/master/public/voice_profiles.json`] : []),
      ],
      { signal: controller.signal, validate: d => Boolean(d && d.profiles) }
    )
      .then(hit => {
        if (!hit || controller.signal.aborted) return;
        const list = Object.entries(hit.data.profiles).map(([name, prof]: [string, any]) => ({
          name,
          sampleCount: prof.sample_count || 1,
          lastUpdated: prof.last_updated,
          embeddingDim: prof.embedding?.length || 192,
        }));
        setVoiceProfiles(list);
      })
      .catch(() => {});

    fetchSpaceHealth();
    fetchPersistedTakes();
    fetchSpeakerReferences();

    const healthInterval = setInterval(fetchSpaceHealth, 20000);
    return () => {
      controller.abort();
      clearInterval(healthInterval);
    };
  }, [config.ownerName, config.repoName]);

  // Sync Audio playback rate when changed
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // Sync Volume & Mute
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
      audioRef.current.muted = isMuted;
    }
  }, [volume, isMuted]);

  // Real VU meter
  const vu = useAudioLevelMeter(audioRef, isPlaying, activeClip?.audioUrl);
  const vuLeft = vu.left;
  const vuRight = vu.right;

  // Selected speaker's reference on disk
  const activeSpeakerRef = useMemo(() => {
    return speakerRefs.find(r => r.name.toLowerCase() === selectedSpeaker.toLowerCase()) || null;
  }, [speakerRefs, selectedSpeaker]);

  // Reset parameters
  const handleResetControls = () => {
    setDiffusionSteps(15);
    setCfgValue(2.0);
    showToast('Inference parameters reset to defaults (15 steps, CFG 2.0).');
  };

  // Playback Controller
  const playAudioClip = async (clip: VoiceClipItem, resetTime = true) => {
    const audio = audioRef.current;
    if (!audio || !clip.audioUrl) return;

    setActiveClip(clip);
    setPlayingClipId(clip.id);
    setDuration(clip.duration);
    setPendingAutoplayClip(null);

    try {
      const resolvedUrl = new URL(clip.audioUrl, window.location.origin).href;
      if (audio.src !== resolvedUrl) {
        audio.src = clip.audioUrl;
        audio.load();
      }
      if (resetTime) {
        audio.currentTime = 0;
        setCurrentTime(0);
      }
      await audio.play();
      setIsPlaying(true);
    } catch (err: any) {
      console.warn('Audio play notice:', err);
      if (err.name === 'NotAllowedError') {
        setPendingAutoplayClip(clip);
      }
      setIsPlaying(false);
    }
  };

  const handleTogglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      if (activeClip) {
        await playAudioClip(activeClip, false);
      }
    }
  };

  const handlePlayClip = async (clip: VoiceClipItem) => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying && activeClip?.id === clip.id) {
      audio.pause();
      setIsPlaying(false);
      setPlayingClipId(null);
      return;
    }

    await playAudioClip(clip, true);
  };

  const handleWaveformSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const targetTime = ratio * duration;
    audioRef.current.currentTime = targetTime;
    setCurrentTime(targetTime);
  };

  // Synthesis Action Engine
  const handleSynthesize = async () => {
    if (!scriptText.trim()) return;
    if (activeSpeakerRef && !activeSpeakerRef.exists) {
      showToast(`⚠️ Cannot synthesize: Reference audio for ${selectedSpeaker} is missing.`);
      return;
    }

    machineRef.current.send('START');
    setIsSynthesizing(true);
    setPendingAutoplayClip(null);
    showToast(`⚡ Synthesizing vocal take for ${selectedSpeaker} via ZeroGPU...`);

    if (audioRef.current) {
      audioRef.current.load();
    }

    try {
      const res = await fetch('/api/vox/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          speaker: selectedSpeaker,
          text: scriptText,
          settings: {
            diffusionSteps,
            temperature: cfgValue,
          },
        }),
      });

      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const errBody = await res.json();
          detail = [errBody.error, ...(Array.isArray(errBody.details) ? errBody.details : [])].filter(Boolean).join(': ') || detail;
        } catch {}
        throw new Error(detail);
      }

      const data = await res.json();
      if (!data.audioUrl) throw new Error('Server returned no audio file');
      const realDur = Number(data.duration) || 0;
      const audioUrl = data.audioUrl;
      const titleSnippet = scriptText.replace(/\[[^\]]+\]/g, '').trim().slice(0, 42) + '...';

      const newClip: VoiceClipItem = {
        id: data.filename ? data.filename.replace(/\.[^.]+$/, '') : `take_${Date.now()}`,
        filename: data.filename || (audioUrl.split('/').pop() || ''),
        title: titleSnippet,
        text: scriptText,
        speaker: selectedSpeaker,
        duration: realDur,
        createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }),
        audioUrl: audioUrl,
        elapsedSec: data.elapsedSec,
        format: data.format,
        sampleRate: data.sampleRate,
        timesteps: data.timesteps,
        cfg: data.cfg,
      };

      setGeneratedClips(prev => [newClip, ...prev.filter(c => c.id !== newClip.id)]);
      setActiveClip(newClip);
      setDuration(realDur);
      setCurrentTime(0);

      await playAudioClip(newClip, true);
      machineRef.current.send('FINISH');
      showToast(`🎉 Generated take for ${selectedSpeaker} (${realDur.toFixed(1)}s, ${data.elapsedSec}s compute)!`);
    } catch (err: any) {
      console.warn('Synthesis error:', err);
      machineRef.current.send('FAIL');
      showToast(`⚠️ Synthesis failed: ${err?.message || err}`);
    } finally {
      setIsSynthesizing(false);
    }
  };

  // Export Active Clip to WAV / MP3
  const handleExportWav = (clip?: VoiceClipItem) => {
    const target = clip || activeClip;
    if (!target || !target.audioUrl) {
      showToast('⚠️ No active audio take available to export.');
      return;
    }

    const a = document.createElement('a');
    a.href = target.audioUrl;
    const ext = target.format || (target.audioUrl.endsWith('.wav') ? 'wav' : 'mp3');
    a.download = `vox_${target.speaker.toLowerCase()}_${Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast(`💾 Exported broadcast audio take (${target.duration.toFixed(1)}s)!`);
  };

  // Send Clip to Montage Studio
  const handleSendToMontage = (clip?: VoiceClipItem) => {
    const target = clip || activeClip;
    if (!target) return;

    montage.addClip({
      id: target.id,
      title: `[Vox] ${target.speaker} - ${target.title}`,
      quote: target.text,
      speaker: target.speaker,
      sourceTitle: 'VoxCPM-2 Synthesizer',
      audioUrl: target.audioUrl,
      startSec: 0,
      endSec: target.duration,
      sourceDurationSec: target.duration,
      category: 'VoxCPM-2 Synthesized Voice',
      severity: 8,
    });

    montage.openDrawer();
    showToast(`🎬 "${target.title}" routed into Montage Studio timeline!`);
  };

  // Delete Single Take from Disk
  const handleDeleteTake = async (id: string) => {
    try {
      const res = await fetch(`/api/vox/takes/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (res.ok) {
        setGeneratedClips(prev => {
          const remaining = prev.filter(c => c.id !== id);
          if (activeClip?.id === id) {
            if (audioRef.current) audioRef.current.pause();
            setIsPlaying(false);
            setActiveClip(remaining[0] || null);
            setDuration(remaining[0]?.duration || 0);
            setCurrentTime(0);
          }
          return remaining;
        });
        showToast('🗑️ Take deleted from disk.');
      }
    } catch {
      showToast('⚠️ Failed to delete take from server.');
    }
  };

  // Clear All Takes from Disk
  const handleClearAllTakes = async () => {
    if (!(await appDialog.confirm({ title: 'Clear All Takes', message: 'Permanently delete all synthesized voice takes in public/output/vox/?', confirmLabel: 'Delete All', destructive: true }))) return;
    try {
      const res = await fetch('/api/vox/takes?all=true', { method: 'DELETE' });
      if (res.ok) {
        if (audioRef.current) audioRef.current.pause();
        setIsPlaying(false);
        setGeneratedClips([]);
        setActiveClip(null);
        setDuration(0);
        setCurrentTime(0);
        showToast('🗑️ Cleared all generated voice takes.');
      }
    } catch {
      showToast('⚠️ Failed to clear takes from server.');
    }
  };

  // Load Take Back into Editor
  const handleLoadIntoEditor = (clip: VoiceClipItem) => {
    setScriptText(clip.text);
    setSelectedSpeaker(clip.speaker);
    if (clip.timesteps) setDiffusionSteps(clip.timesteps);
    if (clip.cfg) setCfgValue(clip.cfg);
    showToast(`📝 Loaded "${clip.title}" into script editor.`);
  };

  const activeTheme = useMemo(() => getSpeakerTheme(selectedSpeaker), [selectedSpeaker]);

  return (
    <div
      data-component="vox-studio"
      data-state={synthesisState}
      className="flex-1 min-h-0 flex flex-col bg-slate-950 text-slate-100 overflow-hidden select-none relative"
    >
      {/* ── HIDDEN HTML5 AUDIO ELEMENT ── */}
      <audio
        ref={audioRef}
        preload="auto"
        onTimeUpdate={() => {
          if (audioRef.current) {
            setCurrentTime(audioRef.current.currentTime);
          }
        }}
        onLoadedMetadata={() => {
          if (audioRef.current && !isNaN(audioRef.current.duration) && audioRef.current.duration > 0) {
            setDuration(audioRef.current.duration);
          }
        }}
        onEnded={() => {
          setIsPlaying(false);
          setPlayingClipId(null);
          setCurrentTime(0);
        }}
        onPlay={() => {
          setIsPlaying(true);
          setPendingAutoplayClip(null);
        }}
        onPause={() => setIsPlaying(false)}
      />

      {/* ── FLOATING TOAST NOTIFICATION ── */}
      {toastMessage && (
        <div className="absolute top-5 right-6 z-50 p-3 px-4 rounded-xl bg-slate-900/95 border border-violet-500/40 text-violet-200 text-xs font-semibold shadow-2xl shadow-violet-950/60 flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <Sparkles size={14} className="text-violet-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ── TOP HEADER / REAL SPACE STATUS BADGE ── */}
      <header className="px-6 py-4 border-b border-slate-800 bg-slate-900/60 backdrop-blur-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-br from-violet-500/20 to-indigo-500/20 border border-violet-500/40 text-violet-400 shadow-lg shadow-violet-500/10">
            <Mic2 size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                VOXCPM-2 VOICE STUDIO
              </h1>

              {/* Real Space Health Pill */}
              {spaceHealth ? (
                <a
                  href={spaceHealth.url}
                  target="_blank"
                  rel="noreferrer"
                  className={`text-[10px] px-2.5 py-0.5 rounded-full font-mono border flex items-center gap-1.5 transition-colors cursor-pointer ${
                    spaceHealth.status === 'running'
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25'
                      : spaceHealth.status === 'building'
                      ? 'bg-amber-500/15 text-amber-300 border-amber-500/30 hover:bg-amber-500/25'
                      : spaceHealth.status === 'sleeping'
                      ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30 hover:bg-indigo-500/25'
                      : 'bg-rose-500/15 text-rose-300 border-rose-500/30 hover:bg-rose-500/25'
                  }`}
                  title={`Target Space: ${spaceHealth.spaceId} (Stage: ${spaceHealth.stage}) - Click to open in Hugging Face`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      spaceHealth.status === 'running'
                        ? 'bg-emerald-400 animate-pulse'
                        : spaceHealth.status === 'building'
                        ? 'bg-amber-400 animate-spin'
                        : 'bg-slate-400'
                    }`}
                  />
                  <span>
                    ZeroGPU: {spaceHealth.displayStatus} ({spaceHealth.spaceId})
                  </span>
                  <ExternalLink size={10} className="opacity-70" />
                </a>
              ) : (
                <button
                  onClick={fetchSpaceHealth}
                  disabled={isCheckingHealth}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-mono border border-slate-700 flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw size={10} className={isCheckingHealth ? 'animate-spin' : ''} />
                  <span>Check Space Status</span>
                </button>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Zero-Shot Vocal Cloning & Cloud Audio Narration powered by OpenBMB VoxCPM-2
            </p>
          </div>
        </div>

        {/* Global Studio Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setCopiedStatus(true);
              navigator.clipboard?.writeText(scriptText);
              setTimeout(() => setCopiedStatus(false), 2000);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border border-slate-700 transition-all cursor-pointer"
            title="Copy current prompt text to clipboard"
          >
            {copiedStatus ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            <span>{copiedStatus ? 'Copied' : 'Copy Text'}</span>
          </button>

          <button
            onClick={handleSynthesize}
            disabled={isSynthesizing || !scriptText.trim() || (activeSpeakerRef !== null && !activeSpeakerRef.exists)}
            className="flex items-center gap-2 px-4 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-violet-600 via-indigo-600 to-indigo-500 hover:from-violet-500 hover:to-indigo-400 text-white shadow-lg shadow-indigo-600/25 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSynthesizing ? <RefreshCw size={14} className="animate-spin" /> : <Zap size={14} className="fill-current" />}
            <span>{isSynthesizing ? 'Synthesizing in Cloud...' : 'Generate Voice (Ctrl+Enter)'}</span>
          </button>
        </div>
      </header>

      {/* ── 3-COLUMN WORKSPACE ── */}
      <div className="flex-1 min-h-0 flex flex-col xl:flex-row overflow-y-auto xl:overflow-hidden">
        {/* ── LEFT DOCK: VOICE PROFILE & REFERENCE AUDIO STATUS ── */}
        <aside className="w-full xl:w-72 shrink-0 border-b xl:border-b-0 xl:border-r border-slate-800 bg-slate-900/40 p-5 pb-24 xl:overflow-y-auto space-y-6">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
              <AudioWaveform size={14} className="text-violet-400" /> Active Voice Model
            </h3>

            {/* Profile Card */}
            <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 shadow-xl space-y-3">
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl font-bold border ${activeTheme.badge} ${activeTheme.text} ${activeTheme.border}`}>
                  {activeTheme.emoji || '🎙️'}
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                    {selectedSpeaker}
                    <span className="text-[9px] px-1.5 py-0.2 rounded font-mono bg-violet-500/20 text-violet-300 border border-violet-500/30">
                      ENROLLED
                    </span>
                  </h4>
                  <p className="text-[11px] text-slate-400">Zero-Shot Neural Clone</p>
                </div>
              </div>

              {/* Real Reference Audio Details */}
              <div className="pt-2 border-t border-slate-800/80 text-[10px] space-y-2">
                {activeSpeakerRef?.exists ? (
                  <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 space-y-1.5">
                    <div className="flex items-center justify-between text-slate-300 font-semibold">
                      <span>Reference Audio</span>
                      <span className="font-mono text-emerald-400">
                        {activeSpeakerRef.duration ? `${activeSpeakerRef.duration.toFixed(1)}s` : 'Verified'}
                      </span>
                    </div>
                    <div className="text-slate-400 font-mono text-[9px] truncate" title={activeSpeakerRef.filename || ''}>
                      {activeSpeakerRef.filename} ({activeSpeakerRef.format?.toUpperCase() || 'AUDIO'})
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-slate-500 text-[9px]">
                        {activeSpeakerRef.hasTranscript ? '✓ Transcript Synced' : 'Timbre Only'}
                      </span>
                      {activeSpeakerRef.audioUrl && (
                        <button
                          onClick={() => {
                            if (audioRef.current && activeSpeakerRef.audioUrl) {
                              audioRef.current.src = activeSpeakerRef.audioUrl;
                              audioRef.current.play();
                              setIsPlaying(true);
                              showToast(`▶ Auditioning ${selectedSpeaker} reference sample`);
                            }
                          }}
                          className="px-2 py-0.5 rounded bg-violet-600/30 hover:bg-violet-600/50 text-violet-300 text-[9px] font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          <Play size={9} /> Audition
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-500/30 text-rose-300 space-y-1">
                    <div className="flex items-center gap-1.5 font-bold text-rose-200">
                      <AlertTriangle size={13} className="shrink-0 text-rose-400" />
                      <span>Missing Reference Audio</span>
                    </div>
                    <p className="text-[9px] text-rose-300/80 leading-tight">
                      No sample found in <code>public/speaker_samples/{selectedSpeaker}/</code>. Generation is disabled for this speaker.
                    </p>
                  </div>
                )}
              </div>

              {/* Speaker Selector */}
              {voiceProfiles.length > 0 && (
                <div className="pt-2">
                  <label className="text-[10px] text-slate-400 block mb-1">Switch Enrolled Speaker</label>
                  <select
                    value={selectedSpeaker}
                    onChange={e => setSelectedSpeaker(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-violet-500"
                  >
                    <option value="Logan">Logan (Host)</option>
                    {voiceProfiles
                      .filter(p => p.name !== 'Logan')
                      .map(p => (
                        <option key={p.name} value={p.name}>
                          {p.name} ({p.sampleCount} {p.sampleCount === 1 ? 'clip' : 'clips'})
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* ── CENTER WORKSPACE: SCRIPT PROMPT & REAL TAKES ── */}
        <main className="flex-1 min-w-0 min-h-0 flex flex-col p-6 pb-24 xl:overflow-y-auto space-y-6">
          {/* SCRIPT EDITOR CARD */}
          <div className="shrink-0 rounded-2xl bg-slate-900/60 border border-slate-800 p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-violet-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                  Narration Prompt Script
                </h3>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-400 font-mono">
                <span>{scriptText.split(/\s+/).filter(Boolean).length} words</span>
                <span>{scriptText.length} chars</span>
              </div>
            </div>

            <div className="relative">
              <textarea
                ref={textareaRef}
                rows={6}
                value={scriptText}
                onChange={e => setScriptText(e.target.value)}
                onKeyDown={e => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    handleSynthesize();
                  }
                }}
                placeholder="Type or paste narration script here. Any bracketed tags will be stripped so directions are never read aloud..."
                className="w-full min-h-[160px] bg-slate-950/90 border border-slate-800/80 rounded-xl p-4 text-sm font-sans text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500/80 resize-y leading-relaxed tracking-wide"
              />
            </div>
          </div>

          {/* ACTIVE AUDIO PLAYER */}
          <div className="shrink-0 p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-2xl space-y-4">
            {pendingAutoplayClip && (
              <div className="p-3 bg-gradient-to-r from-violet-600/90 to-indigo-600/90 border border-violet-400/50 rounded-xl flex items-center justify-between shadow-xl animate-in fade-in slide-in-from-top-1">
                <div className="flex items-center gap-2.5 text-xs text-white font-semibold truncate">
                  <Sparkles size={16} className="text-amber-300 shrink-0" />
                  <span className="truncate">
                    Take Ready: <strong>{pendingAutoplayClip.title}</strong> ({pendingAutoplayClip.duration.toFixed(1)}s)
                  </span>
                </div>
                <button
                  onClick={() => playAudioClip(pendingAutoplayClip, true)}
                  className="px-3.5 py-1.5 bg-white text-slate-950 font-bold text-xs rounded-lg shadow-md hover:bg-slate-100 transition-transform active:scale-95 flex items-center gap-1.5 shrink-0 cursor-pointer"
                >
                  <Play size={13} className="fill-current" /> Audition Now
                </button>
              </div>
            )}

            {/* Track Info & Levels Header (Clean Stacked Layout) */}
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    onClick={handleTogglePlay}
                    className="w-11 h-11 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white flex items-center justify-center shadow-lg shadow-indigo-600/30 transition-transform active:scale-95 cursor-pointer shrink-0"
                    title={isPlaying ? 'Pause' : 'Play Active Voice Take'}
                  >
                    {isPlaying ? <Pause size={18} className="fill-current" /> : <Play size={18} className="fill-current ml-0.5" />}
                  </button>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-xs font-bold text-white truncate max-w-sm sm:max-w-md">
                        {activeClip ? activeClip.title : 'Neural Audio Player'}
                      </h4>
                      {activeClip && (
                        <span className="text-[10px] font-mono text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20 shrink-0">
                          {activeClip.format?.toUpperCase() || 'MP3'} {activeClip.sampleRate ? `${activeClip.sampleRate / 1000}kHz` : ''}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                      {formatSeconds(currentTime)} / {formatSeconds(duration)}
                    </p>
                  </div>
                </div>

                {/* Meter and Speed Controls */}
                <div className="flex items-center gap-3 self-end sm:self-center">
                  {/* Playback speed buttons */}
                  <div className="flex items-center bg-slate-950 rounded-xl border border-slate-800 p-0.5 text-[10px] font-mono">
                    {[0.75, 1.0, 1.25].map(rate => (
                      <button
                        key={rate}
                        onClick={() => setPlaybackRate(rate)}
                        className={`px-2 py-1 rounded-lg transition-colors cursor-pointer ${
                          playbackRate === rate ? 'bg-violet-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {rate}×
                      </button>
                    ))}
                  </div>

                  {/* Dual VU meter */}
                  <div
                    className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1.5 rounded-xl border border-slate-800"
                    title={vu.available ? 'Live RMS level (-60 to 0 dBFS)' : 'Level meter'}
                  >
                    <span className="text-[9px] font-mono text-slate-500 font-bold">L</span>
                    <div className="w-12 h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 via-amber-400 to-rose-500 transition-all duration-75"
                        style={{ width: `${vuLeft * 100}%` }}
                      />
                    </div>
                    <span className="text-[9px] font-mono text-slate-500 font-bold ml-1">R</span>
                    <div className="w-12 h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 via-amber-400 to-rose-500 transition-all duration-75"
                        style={{ width: `${vuRight * 100}%` }}
                      />
                    </div>
                  </div>

                  {/* Volume slider */}
                  <div className="hidden md:flex items-center gap-2">
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
                        const v = parseFloat(e.target.value);
                        setVolume(v);
                        setIsMuted(false);
                      }}
                      className="w-14 accent-indigo-500 cursor-pointer"
                    />
                  </div>
                </div>
              </div>

              {/* Scrubber */}
              <div
                onClick={handleWaveformSeek}
                className="relative h-12 bg-slate-950 rounded-xl border border-slate-800/80 p-2 flex items-center gap-1 cursor-pointer overflow-hidden group"
                title="Click anywhere to seek"
              >
                <div
                  className="absolute left-0 top-0 bottom-0 bg-violet-500/15 border-r border-violet-400 pointer-events-none transition-all duration-75 z-10"
                  style={{ width: `${Math.min(100, Math.max(0, (currentTime / (duration || 1)) * 100))}%` }}
                />
                {Array.from({ length: 64 }).map((_, i) => {
                  const progressRatio = i / 64;
                  const isPlayed = progressRatio <= currentTime / (duration || 1);
                  return (
                    <div
                      key={i}
                      className={`flex-1 rounded-full transition-all duration-75 ${
                        isPlayed
                          ? 'bg-gradient-to-t from-violet-500 to-indigo-400'
                          : 'bg-slate-800 group-hover:bg-slate-700'
                      }`}
                      style={{ height: '40%' }}
                    />
                  );
                })}
              </div>

              {/* Action Buttons & Real Server Stats */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80 text-xs">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleExportWav()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors cursor-pointer"
                  >
                    <Download size={13} /> Export Active Audio
                  </button>
                  <button
                    onClick={() => handleSendToMontage()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/40 transition-colors cursor-pointer"
                  >
                    <Film size={13} /> Send to Montage Studio
                  </button>
                </div>

                {activeClip?.elapsedSec !== undefined && (
                  <span className="text-[11px] font-mono text-slate-400">
                    Compute: {activeClip.elapsedSec}s · {activeClip.timesteps || 15} steps · CFG {activeClip.cfg || 2.0}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ── REAL GENERATED VOICE CLIPS LIBRARY ── */}
          <div className="shrink-0 rounded-2xl bg-slate-900/80 border border-slate-800 p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-violet-500/20 text-violet-400 border border-violet-500/30">
                  <Radio size={16} />
                </div>
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
                    Generated Voice Clips Library
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 font-mono border border-violet-500/30">
                      {generatedClips.length} {generatedClips.length === 1 ? 'Take' : 'Takes'} Persisted
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Audio takes saved to <code>public/output/vox/</code>. Audition, download, or delete per take.
                  </p>
                </div>
              </div>

              {generatedClips.length > 0 && (
                <button
                  onClick={handleClearAllTakes}
                  className="text-[11px] text-slate-500 hover:text-rose-400 transition-colors cursor-pointer flex items-center gap-1"
                >
                  <Trash2 size={12} /> Clear All Takes
                </button>
              )}
            </div>

            {/* Clips List */}
            {generatedClips.length === 0 ? (
              <div className="p-8 text-center rounded-xl bg-slate-950/60 border border-slate-800/80 text-slate-500 text-xs">
                No generated voice takes yet. Type a narration prompt above and click{' '}
                <span className="text-violet-400 font-semibold">Generate Voice (Ctrl+Enter)</span> to render your first audio take!
              </div>
            ) : (
              <div className="space-y-2.5">
                {generatedClips.map(clip => {
                  const isThisPlaying = isPlaying && activeClip?.id === clip.id;
                  const isCurrentActive = activeClip?.id === clip.id;

                  return (
                    <div
                      key={clip.id}
                      className={`p-3.5 rounded-xl border transition-all space-y-2.5 ${
                        isCurrentActive
                          ? 'bg-slate-950/90 border-violet-500/50 shadow-md shadow-violet-950/40'
                          : 'bg-slate-950/50 border-slate-800/80 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          <button
                            onClick={() => handlePlayClip(clip)}
                            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-transform active:scale-95 cursor-pointer ${
                              isThisPlaying
                                ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/30'
                                : 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-indigo-600/20'
                            }`}
                            title={isThisPlaying ? 'Pause Voice' : 'Audition Voice Take'}
                          >
                            {isThisPlaying ? <Pause size={15} className="fill-current" /> : <Play size={15} className="fill-current ml-0.5" />}
                          </button>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="text-xs font-bold text-white truncate">{clip.title}</span>
                              <span className="text-[10px] font-mono font-bold text-violet-300 bg-violet-500/20 px-2 py-0.5 rounded border border-violet-500/30">
                                {clip.speaker}
                              </span>
                              <span className="text-[10px] font-mono text-emerald-400 font-bold">
                                {clip.duration.toFixed(1)}s
                              </span>
                              <span className="text-[10px] font-mono text-slate-400">
                                {clip.createdAt}
                              </span>
                              {clip.elapsedSec !== undefined && (
                                <span className="text-[10px] font-mono text-slate-500">
                                  ({clip.elapsedSec}s)
                                </span>
                              )}
                            </div>

                            <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed font-serif italic">
                              "{clip.text}"
                            </p>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => handleLoadIntoEditor(clip)}
                            title="Load back into Prompt Editor"
                            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                          >
                            <FileText size={14} />
                          </button>
                          <button
                            onClick={() => handleExportWav(clip)}
                            title="Download Audio Take"
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                          >
                            <Download size={12} /> Audio
                          </button>
                          <button
                            onClick={() => handleSendToMontage(clip)}
                            title="Send to Montage Studio Sequence"
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/40 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                          >
                            <Film size={12} /> To Montage
                          </button>
                          <button
                            onClick={() => handleDeleteTake(clip.id)}
                            title="Delete Take from Disk"
                            className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-rose-500/10 transition-colors cursor-pointer"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </main>

        {/* ── RIGHT DOCK: REAL MODEL PARAMETERS ── */}
        <aside className="w-full xl:w-80 shrink-0 border-t xl:border-t-0 xl:border-l border-slate-800 bg-slate-900/40 p-5 pb-24 xl:overflow-y-auto space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Sliders size={14} className="text-indigo-400" /> VoxCPM-2 Parameters
            </h3>
            <button
              onClick={handleResetControls}
              className="text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-1 cursor-pointer"
              title="Reset parameters to defaults"
            >
              <RotateCcw size={11} /> Reset
            </button>
          </div>

          {/* Diffusion Steps Slider */}
          <div className="space-y-1.5 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-semibold">Diffusion Timesteps</span>
              <span className="font-mono text-indigo-400 font-bold">{diffusionSteps}</span>
            </div>
            <input
              type="range"
              min="10"
              max="30"
              step="1"
              value={diffusionSteps}
              onChange={e => setDiffusionSteps(parseInt(e.target.value, 10))}
              className="w-full accent-indigo-500 cursor-pointer"
            />
            <p className="text-[10px] text-slate-500 leading-tight">
              Inference timesteps (10–30). Higher values enhance acoustic definition and clarity; lower values synthesize faster.
            </p>
          </div>

          {/* Acoustic Guidance (CFG) Slider */}
          <div className="space-y-1.5 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-semibold">Acoustic Guidance (CFG)</span>
              <span className="font-mono text-indigo-400 font-bold">{cfgValue.toFixed(1)}</span>
            </div>
            <input
              type="range"
              min="1.0"
              max="5.0"
              step="0.1"
              value={cfgValue}
              onChange={e => setCfgValue(parseFloat(e.target.value))}
              className="w-full accent-indigo-500 cursor-pointer"
            />
            <p className="text-[10px] text-slate-500 leading-tight">
              Classifier-Free Guidance scale (1.0–5.0). Controls adherence to the speaker reference timbre.
            </p>
          </div>

          {/* Space Architecture Note */}
          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1.5 text-[11px] text-slate-400">
            <div className="flex items-center gap-1.5 font-bold text-slate-300">
              <Info size={13} className="text-indigo-400" />
              <span>ZeroGPU Pipeline</span>
            </div>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              Execution runs on dynamic NVIDIA RTX PRO 6000 hardware in your dedicated Hugging Face ZeroGPU Space with automatic token failover.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
};

function formatSeconds(sec: number): string {
  if (isNaN(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default VoxStudio;
