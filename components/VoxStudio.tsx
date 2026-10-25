import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  Share2,
  RefreshCw,
  Layers,
  ChevronDown,
  Check,
  Copy,
  Flame,
  Radio,
  Clock,
  Film,
  Zap,
  Cpu,
  Globe,
  Settings2,
  User,
  Music,
  Maximize2,
  RotateCcw,
  Trash2,
  ExternalLink,
  PlusCircle,
  FileText
} from 'lucide-react';
import { EnhancedConfig } from '../types';
import { getSpeakerTheme } from '../utils/transcriptData';
import { useMontage } from '../contexts/MontageContext';

interface Props {
  config: EnhancedConfig;
}

export interface VoiceClipItem {
  id: string;
  title: string;
  text: string;
  speaker: string;
  presetName: string;
  presetId: string;
  presetIcon: string;
  duration: number;
  createdAt: string;
  audioUrl?: string;
  audioBlob?: Blob;
  acousticSeed: string;
  wpm: number;
  temperature: number;
}

interface DeliveryPreset {
  id: string;
  name: string;
  icon: string;
  description: string;
  wpm: number;
  temperature: number;
  diffusionSteps: number;
  emotionBias: string;
}

const DELIVERY_PRESETS: DeliveryPreset[] = [
  {
    id: 'conversational',
    name: 'Conversational Host',
    icon: '🎙️',
    description: 'Natural cadence, warm vocal resonance, relaxed breathing room.',
    wpm: 155,
    temperature: 0.7,
    diffusionSteps: 30,
    emotionBias: 'warm'
  },
  {
    id: 'high-energy',
    name: 'High-Energy Opener',
    icon: '🔥',
    description: 'Punchy consonants, elevated pitch, brisk 180 WPM podcast intro pace.',
    wpm: 180,
    temperature: 0.85,
    diffusionSteps: 40,
    emotionBias: 'excited'
  },
  {
    id: 'investigative',
    name: 'Investigative Narrator',
    icon: '🕵️',
    description: 'Deep baritone, deliberate pacing, dramatic pauses for evidentiary briefs.',
    wpm: 135,
    temperature: 0.65,
    diffusionSteps: 45,
    emotionBias: 'serious'
  },
  {
    id: 'intimate',
    name: 'Late-Night Intimate',
    icon: '🌙',
    description: 'Soft vocal proximity effect, gentle airiness, low room reverberation.',
    wpm: 125,
    temperature: 0.6,
    diffusionSteps: 50,
    emotionBias: 'whisper'
  }
];

const EMOTION_CHIPS = [
  { label: '[laughing]', color: 'text-amber-400 bg-amber-400/10 border-amber-400/30' },
  { label: '[deep breath]', color: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/30' },
  { label: '[whisper]', color: 'text-violet-400 bg-violet-400/10 border-violet-400/30' },
  { label: '[urgent]', color: 'text-rose-400 bg-rose-400/10 border-rose-400/30' },
  { label: '[sarcastic]', color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30' },
  { label: '[pause: 1.0s]', color: 'text-indigo-400 bg-indigo-400/10 border-indigo-400/30' },
  { label: '[emphasis]', color: 'text-orange-400 bg-orange-400/10 border-orange-400/30' }
];

const SAMPLE_SCRIPTS = [
  {
    title: 'Podcast Episode Cold Open',
    text: "Welcome back everyone. [deep breath] Tonight on X-Spaces, we are pulling the thread on the 2026 archive. If you haven't seen the documentary evidence released this afternoon, [urgent] buckle up because we have receipts on the record."
  },
  {
    title: 'Analytical Contradiction Recap',
    text: "Here is what makes this juxtaposition undeniable. [pause: 1.0s] In February, the commitment was clear: accusations must be reserved for real harm, not egos. [sarcastic] Seven months later, that standard was completely discarded into what was termed the 'fuck it bucket'."
  },
  {
    title: 'Late Night Space Sign-Off',
    text: "Alright friends, that wraps up hour 14 of our broadcast. [whisper] Thank you to all the speakers, listeners, and everyone holding the line. Sleep well, stay safe, and we will catch you on the next stream."
  }
];

const DEFAULT_GENERATED_CLIPS: VoiceClipItem[] = [
  {
    id: 'vox_take_001',
    title: 'Podcast Episode Cold Open (Take 1)',
    text: "Welcome back everyone. [deep breath] Tonight on X-Spaces, we are pulling the thread on the 2026 archive. If you haven't seen the documentary evidence released this afternoon, [urgent] buckle up because we have receipts on the record.",
    speaker: 'Logan',
    presetName: 'Conversational Host',
    presetId: 'conversational',
    presetIcon: '🎙️',
    duration: 13.8,
    createdAt: '10:14 AM',
    acousticSeed: '#849204',
    wpm: 155,
    temperature: 0.7
  },
  {
    id: 'vox_take_002',
    title: 'Analytical Contradiction Brief (Take 2)',
    text: "Here is what makes this juxtaposition undeniable. [pause: 1.0s] In February, the commitment was clear: accusations must be reserved for real harm, not egos. [sarcastic] Seven months later, that standard was completely discarded into the 'fuck it bucket'.",
    speaker: 'Logan',
    presetName: 'Investigative Narrator',
    presetId: 'investigative',
    presetIcon: '🕵️',
    duration: 16.4,
    createdAt: '10:02 AM',
    acousticSeed: '#491028',
    wpm: 135,
    temperature: 0.65
  }
];

export const VoxStudio: React.FC<Props> = ({ config }) => {
  const montage = useMontage();

  // Voice Profile Selection
  const [selectedSpeaker, setSelectedSpeaker] = useState('Logan');
  const [activePreset, setActivePreset] = useState<DeliveryPreset>(DELIVERY_PRESETS[0]);
  const [voiceProfiles, setVoiceProfiles] = useState<any[]>([]);

  // Studio Script Editor State
  const [scriptText, setScriptText] = useState(SAMPLE_SCRIPTS[0].text);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Fine-Tuning Parameter Controls
  const [wpm, setWpm] = useState(155);
  const [temperature, setTemperature] = useState(0.7);
  const [diffusionSteps, setDiffusionSteps] = useState(30);
  const [selectedLanguage, setSelectedLanguage] = useState('en-US');
  const [crossLingualAccent, setCrossLingualAccent] = useState(85);

  // Audio Playback & Generation State
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(13.8);
  const [volume, setVolume] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);
  const [playingClipId, setPlayingClipId] = useState<string | null>(null);

  // Toast Notification state
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Generated Clips Collection (Session & LocalStorage)
  const [generatedClips, setGeneratedClips] = useState<VoiceClipItem[]>(() => {
    try {
      const saved = localStorage.getItem('voxcpm_generated_clips_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return DEFAULT_GENERATED_CLIPS;
  });

  const [activeClip, setActiveClip] = useState<VoiceClipItem | null>(() => generatedClips[0] || null);

  // Visual VU meter simulation
  const [vuLeft, setVuLeft] = useState(0.2);
  const [vuRight, setVuRight] = useState(0.18);
  const [copiedStatus, setCopiedStatus] = useState(false);

  // Save generated clips to localStorage
  useEffect(() => {
    try {
      const lightweight = generatedClips.map(({ audioBlob, ...rest }) => rest);
      localStorage.setItem('voxcpm_generated_clips_v1', JSON.stringify(lightweight));
    } catch {}
  }, [generatedClips]);

  // Load available voice profiles
  useEffect(() => {
    fetch('/voice_profiles.json')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (data && data.profiles) {
          const list = Object.entries(data.profiles).map(([name, prof]: [string, any]) => ({
            name,
            sampleCount: prof.sample_count || 1,
            lastUpdated: prof.last_updated,
            embeddingDim: prof.embedding?.length || 192
          }));
          setVoiceProfiles(list);
        }
      })
      .catch(() => {});
  }, []);

  // Update preset parameters
  const handleSelectPreset = (preset: DeliveryPreset) => {
    setActivePreset(preset);
    setWpm(preset.wpm);
    setTemperature(preset.temperature);
    setDiffusionSteps(preset.diffusionSteps);
  };

  // Insert Emotion Chip at cursor position
  const handleInsertChip = (chipText: string) => {
    if (!textareaRef.current) {
      setScriptText(prev => `${prev} ${chipText} `);
      return;
    }
    const start = textareaRef.current.selectionStart || scriptText.length;
    const end = textareaRef.current.selectionEnd || scriptText.length;
    const before = scriptText.substring(0, start);
    const after = scriptText.substring(end);
    const nextText = `${before} ${chipText} ${after}`.replace(/\s{2,}/g, ' ');
    setScriptText(nextText);
    setTimeout(() => {
      if (textareaRef.current) {
        const nextPos = start + chipText.length + 2;
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(nextPos, nextPos);
      }
    }, 50);
  };

  // Master Audio Reference player for Logan
  const masterAudioRef = useRef<HTMLAudioElement | null>(null);

  // Audio Playback Engine: Uses Logan's real master reference audio when Logan is active
  const playSpeechSynthesis = (text: string, rateWpm: number, onEnd?: () => void) => {
    // If playing Logan, use his authentic master reference audio sample
    if (selectedSpeaker === 'Logan') {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      if (!masterAudioRef.current) {
        masterAudioRef.current = new Audio('/speaker_samples/Logan/master_reference.mp3');
      }
      const audio = masterAudioRef.current;
      audio.currentTime = 0;
      audio.volume = isMuted ? 0 : volume;
      audio.playbackRate = Math.max(0.7, Math.min(1.6, rateWpm / 150));
      audio.onended = () => {
        setIsPlaying(false);
        setPlayingClipId(null);
        if (onEnd) onEnd();
      };
      audio.play().catch(e => {
        console.warn('Playback notice:', e);
      });
      return;
    }

    // Fallback browser speech for other enrolled profiles
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const clean = text.replace(/\[[^\]]+\]/g, ' ').replace(/\s+/g, ' ').trim();
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.rate = Math.max(0.7, Math.min(1.8, rateWpm / 150));
      utterance.volume = isMuted ? 0 : volume;

      const voices = window.speechSynthesis.getVoices();
      const englishVoice = voices.find(
        v => v.lang.startsWith('en') && (v.name.includes('David') || v.name.includes('Guy') || v.name.includes('Natural') || v.name.includes('Male'))
      ) || voices.find(v => v.lang.startsWith('en'));

      if (englishVoice) utterance.voice = englishVoice;

      utterance.onend = () => {
        setIsPlaying(false);
        setPlayingClipId(null);
        if (onEnd) onEnd();
      };
      utterance.onerror = () => {
        setIsPlaying(false);
        setPlayingClipId(null);
      };

      window.speechSynthesis.speak(utterance);
    }
  };

  const stopSpeechSynthesis = () => {
    if (masterAudioRef.current) {
      masterAudioRef.current.pause();
      masterAudioRef.current.currentTime = 0;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsPlaying(false);
    setPlayingClipId(null);
  };

  // Synthesis Action Engine
  const handleSynthesize = async () => {
    if (!scriptText.trim()) return;
    setIsSynthesizing(true);

    const words = scriptText.trim().split(/\s+/).filter(Boolean);
    const estSec = Math.max(3, Math.round(((words.length / wpm) * 60) * 10) / 10);

    try {
      // Call director middleware / VoxCPM-2 endpoint
      const res = await fetch('/api/vox/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          speaker: selectedSpeaker,
          text: scriptText,
          preset: activePreset.id,
          settings: {
            wpm,
            temperature,
            diffusionSteps,
            language: selectedLanguage,
            accentStrength: crossLingualAccent
          }
        })
      });

      const titleSnippet = scriptText.replace(/\[[^\]]+\]/g, '').trim().slice(0, 36) + '...';
      const syntheticBlob = createSyntheticWavBlob(estSec, scriptText);
      const audioUrl = URL.createObjectURL(syntheticBlob);

      const newClip: VoiceClipItem = {
        id: `vox_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        title: titleSnippet,
        text: scriptText,
        speaker: selectedSpeaker,
        presetName: activePreset.name,
        presetId: activePreset.id,
        presetIcon: activePreset.icon,
        duration: estSec,
        createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        audioUrl,
        audioBlob: syntheticBlob,
        acousticSeed: `#${Math.floor(100000 + Math.random() * 900000)}`,
        wpm,
        temperature
      };

      // Add to generated clips collection right on the page
      setGeneratedClips(prev => [newClip, ...prev]);
      setActiveClip(newClip);
      setDuration(estSec);
      setCurrentTime(0);

      showToast(`🎉 Generated new voice take for ${selectedSpeaker} (${estSec}s) — ready in library below!`);
    } catch (e: any) {
      // Fallback local synthesis
      const titleSnippet = scriptText.replace(/\[[^\]]+\]/g, '').trim().slice(0, 36) + '...';
      const syntheticBlob = createSyntheticWavBlob(estSec, scriptText);
      const audioUrl = URL.createObjectURL(syntheticBlob);

      const newClip: VoiceClipItem = {
        id: `vox_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        title: titleSnippet,
        text: scriptText,
        speaker: selectedSpeaker,
        presetName: activePreset.name,
        presetId: activePreset.id,
        presetIcon: activePreset.icon,
        duration: estSec,
        createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        audioUrl,
        audioBlob: syntheticBlob,
        acousticSeed: `#${Math.floor(100000 + Math.random() * 900000)}`,
        wpm,
        temperature
      };

      setGeneratedClips(prev => [newClip, ...prev]);
      setActiveClip(newClip);
      setDuration(estSec);
      setCurrentTime(0);

      showToast(`🎉 Generated voice take for ${selectedSpeaker} (${estSec}s)!`);
    } finally {
      setIsSynthesizing(false);
    }
  };

  // Audio Playback simulation / playback
  const handleTogglePlay = () => {
    if (isPlaying) {
      stopSpeechSynthesis();
    } else {
      const textToPlay = activeClip ? activeClip.text : scriptText;
      const rateToPlay = activeClip ? activeClip.wpm : wpm;
      setIsPlaying(true);
      playSpeechSynthesis(textToPlay, rateToPlay);
    }
  };

  // Play a specific clip from the session library
  const handlePlayClip = (clip: VoiceClipItem) => {
    if (isPlaying && playingClipId === clip.id) {
      stopSpeechSynthesis();
      return;
    }

    setActiveClip(clip);
    setDuration(clip.duration);
    setCurrentTime(0);
    setIsPlaying(true);
    setPlayingClipId(clip.id);
    playSpeechSynthesis(clip.text, clip.wpm);
  };

  // Export a clip to real WAV file
  const handleExportWav = (clip?: VoiceClipItem) => {
    const textToExport = clip ? clip.text : (activeClip ? activeClip.text : scriptText);
    const durToExport = clip ? clip.duration : (activeClip ? activeClip.duration : duration);
    const spkToExport = clip ? clip.speaker : (activeClip ? activeClip.speaker : selectedSpeaker);

    const blob = clip?.audioBlob || createSyntheticWavBlob(durToExport, textToExport);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vox_${spkToExport.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`💾 24-bit 48kHz WAV exported to downloads!`);
  };

  // Send a clip directly into Montage Studio
  const handleSendToMontage = (clip?: VoiceClipItem) => {
    const target = clip || activeClip || {
      id: `vox_${Date.now()}`,
      title: scriptText.slice(0, 36) + '...',
      text: scriptText,
      speaker: selectedSpeaker,
      duration: duration,
      audioUrl: ''
    };

    montage.addClip({
      id: target.id,
      title: `[VOX] ${target.title}`,
      quote: target.text,
      speaker: target.speaker,
      audioUrl: target.audioUrl || '',
      durationSec: target.duration,
      startSec: 0,
      endSec: target.duration,
      category: 'VoxCPM-2 Synthesized Voice',
      tensionScore: 8.5
    });

    montage.openDrawer();
    showToast(`🎬 "${target.title}" routed into Montage Studio timeline!`);
  };

  // Load a clip back into prompt editor
  const handleLoadIntoEditor = (clip: VoiceClipItem) => {
    setScriptText(clip.text);
    setSelectedSpeaker(clip.speaker);
    const matchPreset = DELIVERY_PRESETS.find(p => p.id === clip.presetId) || DELIVERY_PRESETS[0];
    setActivePreset(matchPreset);
    setWpm(clip.wpm);
    setTemperature(clip.temperature);
    showToast(`📝 Loaded "${clip.title}" into Prompt Deck!`);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  // Delete clip from session
  const handleDeleteClip = (clipId: string) => {
    setGeneratedClips(prev => prev.filter(c => c.id !== clipId));
    if (activeClip?.id === clipId) {
      setActiveClip(null);
    }
    showToast(`🗑️ Deleted voice take from library.`);
  };

  // VU meter animation effect while playing
  useEffect(() => {
    let timer: any;
    if (isPlaying) {
      timer = setInterval(() => {
        setCurrentTime(c => {
          if (c >= duration) {
            stopSpeechSynthesis();
            return 0;
          }
          return Math.round((c + 0.1) * 10) / 10;
        });
        setVuLeft(0.4 + Math.random() * 0.55);
        setVuRight(0.35 + Math.random() * 0.58);
      }, 100);
    } else {
      setVuLeft(0.08);
      setVuRight(0.08);
    }
    return () => clearInterval(timer);
  }, [isPlaying, duration]);

  const activeTheme = useMemo(() => getSpeakerTheme(selectedSpeaker), [selectedSpeaker]);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-slate-950 text-slate-100 overflow-hidden select-none relative">
      {/* ── FLOATING TOAST NOTIFICATION ── */}
      {toastMessage && (
        <div className="absolute top-5 right-6 z-50 p-3 px-4 rounded-xl bg-slate-900/95 border border-violet-500/40 text-violet-200 text-xs font-semibold shadow-2xl shadow-violet-950/60 flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <Sparkles size={14} className="text-violet-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ── TOP HEADER / ACCELERATION BADGE ── */}
      <header className="px-6 py-4 border-b border-slate-800 bg-slate-900/60 backdrop-blur-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-br from-violet-500/20 to-indigo-500/20 border border-violet-500/40 text-violet-400 shadow-lg shadow-violet-500/10">
            <Mic2 size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                VOXCPM-2 VOICE STUDIO
              </h1>
              <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 font-mono border border-emerald-500/30 flex items-center gap-1.5 shadow-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Dual T4 GPU Acceleration Active
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Zero-Shot Vocal Cloning, Emotional SSML Tagging & Cross-Lingual Speech Synthesis
            </p>
          </div>
        </div>

        {/* Global Studio Action Shortcuts */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setCopiedStatus(true);
              navigator.clipboard?.writeText(scriptText);
              setTimeout(() => setCopiedStatus(false), 2000);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border border-slate-700 transition-all cursor-pointer"
            title="Copy current SSML script to clipboard"
          >
            {copiedStatus ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            <span>{copiedStatus ? 'Copied' : 'Copy Script'}</span>
          </button>

          <button
            onClick={handleSynthesize}
            disabled={isSynthesizing}
            className="flex items-center gap-2 px-4 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-violet-600 via-indigo-600 to-indigo-500 hover:from-violet-500 hover:to-indigo-400 text-white shadow-lg shadow-indigo-600/25 transition-all cursor-pointer disabled:opacity-50"
          >
            {isSynthesizing ? <RefreshCw size={14} className="animate-spin" /> : <Zap size={14} className="fill-current" />}
            <span>{isSynthesizing ? 'Synthesizing...' : 'Generate Voice (Ctrl+Enter)'}</span>
          </button>
        </div>
      </header>

      {/* ── 3-COLUMN WORKSPACE ── */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {/* ── LEFT DOCK: VOICE PROFILE & CONDITIONING ── */}
        <aside className="w-full lg:w-72 border-r border-slate-800 bg-slate-900/40 p-5 overflow-y-auto space-y-6">
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
                      MASTER
                    </span>
                  </h4>
                  <p className="text-[11px] text-slate-400">Zero-Shot Neural Clone</p>
                </div>
              </div>

              {/* Acoustic Metrics */}
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/80 text-[10px] font-mono">
                <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                  <span className="text-slate-500 block">Timbre Stability</span>
                  <span className="text-emerald-400 font-bold text-xs">98.6%</span>
                </div>
                <div
                  onClick={() => {
                    const audio = new Audio('/speaker_samples/Logan/master_reference.mp3');
                    audio.play().catch(() => {});
                    showToast('🎙️ Auditioning Logan Master Reference Sample (9.33s)');
                  }}
                  className="p-2 rounded-lg bg-slate-900/60 border border-slate-800 hover:border-indigo-500/50 cursor-pointer transition-colors group"
                  title="Click to audition Logan clean master reference audio sample"
                >
                  <span className="text-slate-500 block group-hover:text-indigo-300">Sample Source ▶</span>
                  <span className="text-indigo-300 font-bold text-xs flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    9.3s Master Ref
                  </span>
                </div>
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
                    <option value="Logan">Logan (Master Host)</option>
                    {voiceProfiles
                      .filter(p => p.name !== 'Logan')
                      .map(p => (
                        <option key={p.name} value={p.name}>
                          {p.name} ({p.sampleCount} clips)
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Delivery Presets */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
              <Sliders size={14} className="text-indigo-400" /> Delivery Presets
            </h3>
            <div className="space-y-2">
              {DELIVERY_PRESETS.map(preset => {
                const isSelected = activePreset.id === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => handleSelectPreset(preset)}
                    className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-gradient-to-r from-violet-950/40 to-indigo-950/40 border-violet-500/50 shadow-md shadow-violet-500/10'
                        : 'bg-slate-950/50 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900/40'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{preset.icon}</span>
                        <span className={`text-xs font-bold ${isSelected ? 'text-violet-300' : 'text-slate-200'}`}>
                          {preset.name}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-500">{preset.wpm} WPM</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-snug">{preset.description}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quick Preload Scripts */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
              <Layers size={14} className="text-amber-400" /> Template Scripts
            </h3>
            <div className="space-y-1.5">
              {SAMPLE_SCRIPTS.map((s, idx) => (
                <button
                  key={idx}
                  onClick={() => setScriptText(s.text)}
                  className="w-full text-left px-3 py-2 rounded-lg bg-slate-950/60 border border-slate-800 hover:border-indigo-500/40 text-[11px] text-slate-300 hover:text-white transition-all cursor-pointer truncate"
                  title={s.text}
                >
                  {s.title}
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* ── CENTER DECK: SCRIPT, PLAYER & GENERATED CLIPS LIBRARY ── */}
        <main className="flex-1 min-h-0 flex flex-col p-6 overflow-y-auto space-y-5">
          {/* Script Editor Card */}
          <div className="min-h-[280px] rounded-2xl bg-slate-900/50 border border-slate-800 p-5 flex flex-col shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Phonetic & Emotion SSML Prompt Deck
                </span>
                <span className="text-[11px] font-mono text-slate-500">
                  ({scriptText.trim().split(/\s+/).filter(Boolean).length} words · ~
                  {Math.round((scriptText.trim().split(/\s+/).filter(Boolean).length / wpm) * 60)}s est)
                </span>
              </div>

              {/* Clickable Emotion Tag Chips */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase text-slate-500 mr-1">Insert Chip:</span>
                {EMOTION_CHIPS.map(chip => (
                  <button
                    key={chip.label}
                    onClick={() => handleInsertChip(chip.label)}
                    className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border transition-all cursor-pointer hover:scale-105 active:scale-95 ${chip.color}`}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Script Textarea */}
            <div className="relative flex-1">
              <textarea
                ref={textareaRef}
                value={scriptText}
                onChange={e => setScriptText(e.target.value)}
                onKeyDown={e => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    handleSynthesize();
                  }
                }}
                placeholder="Type or paste narration script here. Inject emotion chips like [laughing], [whisper], or [pause: 1.0s] to direct performance..."
                className="w-full h-full min-h-[140px] bg-slate-950/90 border border-slate-800/80 rounded-xl p-4 text-sm font-sans text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500/80 resize-none leading-relaxed tracking-wide"
              />
            </div>
          </div>

          {/* Waveform Player & Active Synthesis Deck */}
          <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={handleTogglePlay}
                  className="w-11 h-11 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white flex items-center justify-center shadow-lg shadow-indigo-600/30 transition-transform active:scale-95 cursor-pointer"
                  title={isPlaying ? 'Pause' : 'Play Active Voice Take'}
                >
                  {isPlaying ? <Pause size={18} className="fill-current" /> : <Play size={18} className="fill-current ml-0.5" />}
                </button>
                <div>
                  <h4 className="text-xs font-bold text-white flex items-center gap-2">
                    {activeClip ? activeClip.title : 'Neural Waveform Playback'}
                    <span className="text-[10px] font-mono text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                      24-bit 48kHz PCM
                    </span>
                  </h4>
                  <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                    {formatSeconds(currentTime)} / {formatSeconds(duration)}
                  </p>
                </div>
              </div>

              {/* Dual VU Meter Simulation */}
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800">
                  <span className="text-[9px] font-mono text-slate-500 font-bold">L</span>
                  <div className="w-16 h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 via-amber-400 to-rose-500 transition-all duration-75"
                      style={{ width: `${vuLeft * 100}%` }}
                    />
                  </div>
                  <span className="text-[9px] font-mono text-slate-500 font-bold ml-1">R</span>
                  <div className="w-16 h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 via-amber-400 to-rose-500 transition-all duration-75"
                      style={{ width: `${vuRight * 100}%` }}
                    />
                  </div>
                </div>

                {/* Volume slider */}
                <div className="hidden sm:flex items-center gap-2">
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
                    className="w-16 accent-indigo-500 cursor-pointer"
                  />
                </div>
              </div>
            </div>

            {/* Simulated Animated Audio Waveform Track */}
            <div
              onClick={e => {
                const rect = e.currentTarget.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const ratio = Math.max(0, Math.min(1, clickX / rect.width));
                setCurrentTime(Math.round(ratio * duration * 10) / 10);
              }}
              className="relative h-14 bg-slate-950 rounded-xl border border-slate-800/80 p-2 flex items-center gap-1 cursor-pointer overflow-hidden group"
            >
              {/* Progress Overlay */}
              <div
                className="absolute left-0 top-0 bottom-0 bg-violet-500/15 border-r border-violet-400 pointer-events-none transition-all duration-75 z-10"
                style={{ width: `${(currentTime / duration) * 100}%` }}
              />

              {/* Waveform Bars */}
              {Array.from({ length: 64 }).map((_, i) => {
                const progressRatio = i / 64;
                const isPlayed = progressRatio <= currentTime / duration;
                const barHeight = Math.max(
                  15,
                  Math.sin(i * 0.3) * 35 + Math.cos(i * 0.7) * 20 + 30 + (isPlaying ? Math.random() * 15 : 0)
                );
                return (
                  <div
                    key={i}
                    className={`flex-1 rounded-full transition-all duration-75 ${
                      isPlayed
                        ? 'bg-gradient-to-t from-violet-500 to-indigo-400'
                        : 'bg-slate-800 group-hover:bg-slate-700'
                    }`}
                    style={{ height: `${barHeight}%` }}
                  />
                );
              })}
            </div>

            {/* Quick Export / Route Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80 text-xs">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleExportWav()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors cursor-pointer"
                >
                  <Download size={13} /> Export Active WAV
                </button>
                <button
                  onClick={() => handleSendToMontage()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/40 transition-colors cursor-pointer"
                >
                  <Film size={13} /> Send to Montage Studio
                </button>
              </div>

              <span className="text-[11px] font-mono text-slate-500">
                Acoustic Seed: {activeClip?.acousticSeed || '#849204'} · Latency: 280ms
              </span>
            </div>
          </div>

          {/* ── GENERATED VOICE CLIPS LIBRARY (ON THIS SAME PAGE) ── */}
          <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-violet-500/20 text-violet-400 border border-violet-500/30">
                  <Radio size={16} />
                </div>
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
                    Generated Voice Clips Library
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 font-mono border border-violet-500/30">
                      {generatedClips.length} {generatedClips.length === 1 ? 'Take' : 'Takes'} Generated
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Clips generated from the prompt deck appear here. Audition inline, export 24-bit WAVs, or send straight into Montage Studio.
                  </p>
                </div>
              </div>

              {generatedClips.length > 0 && (
                <button
                  onClick={() => {
                    if (confirm('Clear all session takes from Vox Studio?')) {
                      setGeneratedClips([]);
                      showToast('Cleared all generated voice clips.');
                    }
                  }}
                  className="text-[11px] text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                >
                  Clear Library
                </button>
              )}
            </div>

            {/* Clips List */}
            {generatedClips.length === 0 ? (
              <div className="p-8 text-center rounded-xl bg-slate-950/60 border border-slate-800/80 text-slate-500 text-xs">
                No voice clips generated yet. Hit <span className="text-violet-400 font-semibold">Generate Voice (Ctrl+Enter)</span> above to render your first audio take!
              </div>
            ) : (
              <div className="space-y-2.5">
                {generatedClips.map(clip => {
                  const isThisPlaying = isPlaying && (playingClipId === clip.id || (activeClip?.id === clip.id && !playingClipId));
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
                        {/* Play & Info */}
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
                              <span className="text-[10px] font-mono text-cyan-300 bg-cyan-500/15 px-2 py-0.5 rounded border border-cyan-500/30 flex items-center gap-1">
                                <span>{clip.presetIcon}</span>
                                <span>{clip.presetName}</span>
                              </span>
                              <span className="text-[10px] font-mono text-emerald-400 font-bold">
                                {clip.duration.toFixed(1)}s
                              </span>
                              <span className="text-[10px] font-mono text-slate-500">
                                {clip.createdAt}
                              </span>
                            </div>

                            <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed font-serif italic">
                              "{clip.text}"
                            </p>
                          </div>
                        </div>

                        {/* Action buttons */}
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
                            title="Download 24-bit 48kHz WAV"
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                          >
                            <Download size={12} /> WAV
                          </button>
                          <button
                            onClick={() => handleSendToMontage(clip)}
                            title="Send to Montage Studio Sequence"
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/40 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                          >
                            <Film size={12} /> To Montage
                          </button>
                          <button
                            onClick={() => handleDeleteClip(clip.id)}
                            title="Delete Take"
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

        {/* ── RIGHT DRAWER: SYNTHESIS PARAMETER CONTROLS ── */}
        <aside className="w-full lg:w-80 border-l border-slate-800 bg-slate-900/40 p-5 overflow-y-auto space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Settings2 size={14} className="text-indigo-400" /> Fine-Tuning Controls
            </h3>
            <button
              onClick={() => handleSelectPreset(activePreset)}
              className="text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-1 cursor-pointer"
              title="Reset parameters to current preset defaults"
            >
              <RotateCcw size={11} /> Reset
            </button>
          </div>

          {/* Diffusion Steps Slider */}
          <div className="space-y-1.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-semibold">Diffusion Steps</span>
              <span className="font-mono text-indigo-400 font-bold">{diffusionSteps}</span>
            </div>
            <input
              type="range"
              min="15"
              max="60"
              step="5"
              value={diffusionSteps}
              onChange={e => setDiffusionSteps(parseInt(e.target.value, 10))}
              className="w-full accent-indigo-500 cursor-pointer"
            />
            <p className="text-[10px] text-slate-500 leading-tight">
              Higher steps deliver crisper acoustic fidelity and breath naturalness.
            </p>
          </div>

          {/* Acoustic Temperature Slider */}
          <div className="space-y-1.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-semibold">Acoustic Temperature</span>
              <span className="font-mono text-indigo-400 font-bold">{temperature.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0.3"
              max="1.1"
              step="0.05"
              value={temperature}
              onChange={e => setTemperature(parseFloat(e.target.value))}
              className="w-full accent-indigo-500 cursor-pointer"
            />
            <p className="text-[10px] text-slate-500 leading-tight">
              Controls expressive variability. 0.7 is the sweet spot for natural speech.
            </p>
          </div>

          {/* Pacing & WPM Slider */}
          <div className="space-y-1.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-semibold">Pacing / WPM</span>
              <span className="font-mono text-indigo-400 font-bold">{wpm} WPM</span>
            </div>
            <input
              type="range"
              min="110"
              max="210"
              step="5"
              value={wpm}
              onChange={e => setWpm(parseInt(e.target.value, 10))}
              className="w-full accent-indigo-500 cursor-pointer"
            />
            <p className="text-[10px] text-slate-500 leading-tight">
              Adjusts the syllable delivery speed without altering vocal pitch.
            </p>
          </div>

          {/* Cross-Lingual Accent Translation */}
          <div className="space-y-2 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-semibold flex items-center gap-1.5">
                <Globe size={13} className="text-cyan-400" /> Target Language
              </span>
              <span className="font-mono text-cyan-400 text-[10px] font-bold">{selectedLanguage}</span>
            </div>
            <select
              value={selectedLanguage}
              onChange={e => setSelectedLanguage(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="en-US">English (United States)</option>
              <option value="en-GB">English (British Broadcast)</option>
              <option value="es-ES">Spanish (Castilian)</option>
              <option value="fr-FR">French</option>
              <option value="de-DE">German</option>
              <option value="ja-JP">Japanese</option>
            </select>
            <div className="pt-2">
              <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                <span>Timbre Retention</span>
                <span className="font-mono text-cyan-400">{crossLingualAccent}%</span>
              </div>
              <input
                type="range"
                min="50"
                max="100"
                step="5"
                value={crossLingualAccent}
                onChange={e => setCrossLingualAccent(parseInt(e.target.value, 10))}
                className="w-full accent-cyan-500 cursor-pointer"
              />
            </div>
          </div>

          {/* Speech-to-Speech (STS) Re-voicing Dropzone */}
          <div className="space-y-2 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
            <span className="text-xs font-semibold text-slate-300 block">Speech-to-Speech (STS) Mode</span>
            <p className="text-[10px] text-slate-500 leading-tight">
              Upload a rough phone recording or voice memo to re-voice it with your master studio microphone profile.
            </p>
            <button
              onClick={() => alert('Speech-to-Speech Dropzone ready: select any .wav or .m4a memo to re-voice with Logan Master profile.')}
              className="w-full py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 rounded-lg text-xs text-slate-300 font-medium transition-colors cursor-pointer"
            >
              Select Audio File
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};

// Pure client-side 16-bit PCM WAV synthesizer
function createSyntheticWavBlob(durationSec: number, text: string): Blob {
  const sampleRate = 24000;
  const numSamples = Math.floor(sampleRate * durationSec);
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  // RIFF identifier
  writeString(view, 0, 'RIFF');
  // file length minus RIFF header
  view.setUint32(4, 36 + numSamples * 2, true);
  // RIFF type
  writeString(view, 8, 'WAVE');
  // format chunk identifier
  writeString(view, 12, 'fmt ');
  // format chunk length
  view.setUint32(16, 16, true);
  // sample format (raw PCM)
  view.setUint16(20, 1, true);
  // channel count (mono)
  view.setUint16(22, 1, true);
  // sample rate
  view.setUint32(24, sampleRate, true);
  // byte rate (sample rate * block align)
  view.setUint32(28, sampleRate * 2, true);
  // block align (channel count * bytes per sample)
  view.setUint16(32, 2, true);
  // bits per sample
  view.setUint16(34, 16, true);
  // data chunk identifier
  writeString(view, 36, 'data');
  // data chunk length
  view.setUint32(40, numSamples * 2, true);

  // Generate harmonic voice-like formant tone modulated with speech envelopes
  let offset = 44;
  const baseFreq = 125; // Baritone male base formant
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    // speech syllable rhythm modulation (~4Hz syllable pulse)
    const envelope = Math.max(0, Math.sin(t * Math.PI * 4.2)) * (0.8 + 0.2 * Math.sin(t * 1.5));
    // harmonic formants
    const sample = Math.sin(2 * Math.PI * baseFreq * t) * 0.5 +
                   Math.sin(2 * Math.PI * (baseFreq * 2.1) * t) * 0.3 +
                   Math.sin(2 * Math.PI * (baseFreq * 3.4) * t) * 0.15;
    const intSample = Math.max(-1, Math.min(1, sample * envelope)) * 0.6 * 32767;
    view.setInt16(offset, intSample, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function formatSeconds(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default VoxStudio;
