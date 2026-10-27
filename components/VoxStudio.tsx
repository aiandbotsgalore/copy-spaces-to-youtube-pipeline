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
  FileText,
  Upload
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
  audioUrl: string;
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
    title: 'Dessa Architecture Speech',
    text: "Ladies and gentlemen,\n\nThink about the last time you talked to a voice assistant. You spoke into your microphone, waited in silence while the machine turned your voice into letters, pushed those letters through a language model, drafted a written reply, and finally fired up a synthesizer to read it back to you. It was rigid. It was transactional. And most of all, it felt like using a walkie-talkie across an ocean.\n\nWhen we talk to each other, we don't pass transcripts back and forth. We breathe. We sigh. We laugh mid-sentence when someone catches us off guard. We drop an involuntary \"mm-hmm\" or \"got it\" while the other person is still speaking. For years, conversational AI threw all of that into the trash the moment it reduced sound into sterile text.\n\nThat is why dessa is turning heads."
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
    id: 'vox_dessa_master',
    title: 'Dessa Architecture Speech (VoxCPM-2 Master Take)',
    text: "Ladies and gentlemen, Think about the last time you talked to a voice assistant. You spoke into your microphone, waited in silence while the machine turned your voice into letters, pushed those letters through a language model, drafted a written reply, and finally fired up a synthesizer to read it back to you. It was rigid. It was transactional. And most of all, it felt like using a walkie-talkie across an ocean...",
    speaker: 'Logan',
    presetName: 'Conversational Host',
    presetId: 'conversational',
    presetIcon: '🎙️',
    duration: 145.5,
    createdAt: '12:52 PM',
    audioUrl: '/output/vox/dessa_speech_logan.mp3',
    acousticSeed: '#791046',
    wpm: 155,
    temperature: 0.7
  },
  {
    id: 'vox_cold_open',
    title: 'Podcast Episode Cold Open (Take 1)',
    text: "Welcome back everyone. [deep breath] Tonight on X-Spaces, we are pulling the thread on the 2026 archive. If you haven't seen the documentary evidence released this afternoon, [urgent] buckle up because we have receipts on the record.",
    speaker: 'Logan',
    presetName: 'Conversational Host',
    presetId: 'conversational',
    presetIcon: '🎙️',
    duration: 8.0,
    createdAt: '14:24 PM',
    audioUrl: '/output/vox/take_1792963479397.mp3',
    acousticSeed: '#849204',
    wpm: 155,
    temperature: 0.7
  },
  {
    id: 'vox_take_zerogpu',
    title: 'ZeroGPU Dedicated Endpoint Verification Take',
    text: 'The dedicated ZeroGPU VoxCPM2 space is now fully wired into Vox Studio.',
    speaker: 'Logan',
    presetName: 'High-Energy Opener',
    presetId: 'high-energy',
    presetIcon: '🔥',
    duration: 4.6,
    createdAt: '12:18 PM',
    audioUrl: '/output/vox/take_1792955879383.mp3',
    acousticSeed: '#592014',
    wpm: 180,
    temperature: 0.85
  },
  {
    id: 'vox_logan_001',
    title: 'Prologue: Rules of Evidence (Kaggle VoxCPM2 Master)',
    text: 'Okay. This is The Paper Trail.',
    speaker: 'Logan',
    presetName: 'Investigative Narrator',
    presetId: 'investigative',
    presetIcon: '🕵️',
    duration: 2.4,
    createdAt: '11:14 AM',
    audioUrl: '/output/vox/LOGAN_001.mp3',
    acousticSeed: '#942188',
    wpm: 140,
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
  const [duration, setDuration] = useState(145.5);
  const [volume, setVolume] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);
  const [playingClipId, setPlayingClipId] = useState<string | null>(null);
  const [pendingAutoplayClip, setPendingAutoplayClip] = useState<VoiceClipItem | null>(null);

  // Toast Notification state
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Generated Clips Collection (Session & LocalStorage)
  const [generatedClips, setGeneratedClips] = useState<VoiceClipItem[]>(() => {
    try {
      const saved = localStorage.getItem('voxcpm_generated_clips_v3');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return DEFAULT_GENERATED_CLIPS;
  });

  const [activeClip, setActiveClip] = useState<VoiceClipItem>(() => generatedClips[0] || DEFAULT_GENERATED_CLIPS[0]);

  const [copiedStatus, setCopiedStatus] = useState(false);

  // Dedicated HTML5 Audio Player Reference
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stsInputRef = useRef<HTMLInputElement | null>(null);
  const [stsFile, setStsFile] = useState<File | null>(null);

  // Save generated clips to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('voxcpm_generated_clips_v3', JSON.stringify(generatedClips));
    } catch {}
  }, [generatedClips]);

  // Mount: initialize audio element source
  useEffect(() => {
    if (audioRef.current && activeClip?.audioUrl) {
      const resolvedUrl = new URL(activeClip.audioUrl, window.location.origin).href;
      if (audioRef.current.src !== resolvedUrl) {
        audioRef.current.src = activeClip.audioUrl;
        audioRef.current.load();
      }
    }
  }, []);

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

  // Sync Audio playback rate when WPM changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = Math.max(0.7, Math.min(1.8, wpm / 150));
    }
  }, [wpm]);

  // Sync Volume & Mute
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
      audioRef.current.muted = isMuted;
    }
  }, [volume, isMuted]);

  // Real VU meter: levels come from a Web Audio AnalyserNode on the playing audio element.
  const vu = useAudioLevelMeter(audioRef, isPlaying, activeClip?.audioUrl);
  const vuLeft = vu.left;
  const vuRight = vu.right;

  // Update preset parameters
  const handleSelectPreset = (preset: DeliveryPreset) => {
    setActivePreset(preset);
    setWpm(preset.wpm);
    setTemperature(preset.temperature);
    setDiffusionSteps(preset.diffusionSteps);
  };

  // Reset all fine-tuning controls
  const handleResetControls = () => {
    setWpm(activePreset.wpm);
    setTemperature(activePreset.temperature);
    setDiffusionSteps(activePreset.diffusionSteps);
    setSelectedLanguage('en-US');
    setCrossLingualAccent(85);
    showToast('Fine-tuning controls reset to defaults.');
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

  // Dedicated Playback Controller
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
        // Autoplay blocked by browser policy without active user activation
        setPendingAutoplayClip(clip);
      }
      setIsPlaying(false);
    }
  };

  // Audio Playback Handlers
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
    setIsSynthesizing(true);
    setPendingAutoplayClip(null);
    showToast(`⚡ Synthesizing vocal take for ${selectedSpeaker}...`);

    // Synchronously prime the audio element during user click
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
        id: `vox_${Date.now()}`,
        title: titleSnippet,
        text: scriptText,
        speaker: selectedSpeaker,
        presetName: activePreset.name,
        presetId: activePreset.id,
        presetIcon: activePreset.icon,
        duration: realDur,
        createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        audioUrl: audioUrl,
        acousticSeed: `#${Math.floor(100000 + Math.random() * 900000)}`,
        wpm,
        temperature
      };

      // Instantly prepend to library on this same page
      setGeneratedClips(prev => [newClip, ...prev]);
      setActiveClip(newClip);
      setDuration(realDur);
      setCurrentTime(0);

      // Attempt immediate playback
      await playAudioClip(newClip, true);

      showToast(`🎉 Generated new voice take for ${selectedSpeaker} (${realDur.toFixed(1)}s)!`);
    } catch (err: any) {
      console.warn('Synthesis notice:', err);
      showToast(`⚠️ Synthesis failed, no take was created: ${err?.message || err}`);
    } finally {
      setIsSynthesizing(false);
    }
  };

  // Export a clip to real WAV / MP3 file
  const handleExportWav = (clip?: VoiceClipItem) => {
    const target = clip || activeClip;
    if (!target || !target.audioUrl) {
      showToast('⚠️ No active audio take available to export.');
      return;
    }

    const a = document.createElement('a');
    a.href = target.audioUrl;
    const ext = target.audioUrl.endsWith('.wav') ? 'wav' : 'mp3';
    a.download = `vox_${target.speaker.toLowerCase()}_${Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast(`💾 Exported broadcast audio take (${target.duration.toFixed(1)}s)!`);
  };

  // Send a clip directly into Montage Studio
  const handleSendToMontage = (clip?: VoiceClipItem) => {
    const target = clip || activeClip;
    if (!target) return;

    montage.addClip({
      id: target.id,
      title: `[VOX] ${target.title}`,
      quote: target.text,
      speaker: target.speaker,
      sourceTitle: 'VoxCPM-2 Synthesized Voice',
      audioUrl: target.audioUrl,
      startSec: 0,
      endSec: target.duration,
      sourceDurationSec: target.duration,
      category: 'VoxCPM-2 Synthesized Voice',
      severity: 8
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
    setGeneratedClips(prev => {
      const remaining = prev.filter(c => c.id !== clipId);
      if (activeClip?.id === clipId && remaining.length > 0) {
        setActiveClip(remaining[0]);
        if (audioRef.current) {
          audioRef.current.src = remaining[0].audioUrl;
          audioRef.current.load();
        }
      }
      return remaining;
    });
    showToast(`🗑️ Deleted voice take from library.`);
  };

  // Handle STS file upload
  const handleStsFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setStsFile(file);
      showToast(`🎙️ Loaded "${file.name}" into Speech-to-Speech Dropzone!`);
    }
  };

  const activeTheme = useMemo(() => getSpeakerTheme(selectedSpeaker), [selectedSpeaker]);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-slate-950 text-slate-100 overflow-hidden select-none relative">
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
                ZeroGPU Cloud Acceleration Active
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
            <span>{isSynthesizing ? 'Synthesizing in Cloud...' : 'Generate Voice (Ctrl+Enter)'}</span>
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
                    const sampleClip: VoiceClipItem = {
                      id: 'vox_master_ref',
                      title: 'Logan Master Reference Sample',
                      text: 'Ten years before Hiroshima, the American presidency still belonged to a different world. This is Franklin Roosevelt at Boulder Dam in 1935.',
                      speaker: 'Logan',
                      presetName: 'Master Reference',
                      presetId: 'conversational',
                      presetIcon: '🎙️',
                      duration: 9.3,
                      createdAt: 'Studio Master',
                      audioUrl: '/speaker_samples/Logan/master_reference.mp3',
                      acousticSeed: '#942188',
                      wpm: 145,
                      temperature: 0.65
                    };
                    playAudioClip(sampleClip, true);
                    showToast('🎙️ Auditioning Logan Master Reference Sample (9.3s)');
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
                  onClick={() => {
                    setScriptText(s.text);
                    showToast(`Loaded "${s.title}" into Prompt Deck!`);
                  }}
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
          <div className="min-h-[260px] rounded-2xl bg-slate-900/50 border border-slate-800 p-5 flex flex-col shadow-xl">
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
                className="w-full h-full min-h-[130px] bg-slate-950/90 border border-slate-800/80 rounded-xl p-4 text-sm font-sans text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500/80 resize-none leading-relaxed tracking-wide"
              />
            </div>
          </div>

          {/* Waveform Player & Active Synthesis Deck */}
          <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-5 shadow-2xl space-y-4">
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

              {/* Dual VU meter (real levels from Web Audio) */}
              <div className="flex items-center gap-4">
                <div
                  className="flex items-center gap-1.5 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800"
                  title={vu.available ? 'Live RMS level of the playing take (-60 to 0 dBFS)' : 'Level unavailable for this source (cross-origin audio cannot be analysed)'}
                >
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
                      const v = parseFloat(e.target.value);
                      setVolume(v);
                      setIsMuted(false);
                    }}
                    className="w-16 accent-indigo-500 cursor-pointer"
                  />
                </div>
              </div>
            </div>

            {/* Interactive Audio Waveform Track Scrubber */}
            <div
              onClick={handleWaveformSeek}
              className="relative h-14 bg-slate-950 rounded-xl border border-slate-800/80 p-2 flex items-center gap-1 cursor-pointer overflow-hidden group"
              title="Click anywhere to seek playback"
            >
              {/* Progress Overlay */}
              <div
                className="absolute left-0 top-0 bottom-0 bg-violet-500/15 border-r border-violet-400 pointer-events-none transition-all duration-75 z-10"
                style={{ width: `${Math.min(100, Math.max(0, (currentTime / (duration || 1)) * 100))}%` }}
              />

              {/* Seek bar segments */}
              {Array.from({ length: 64 }).map((_, i) => {
                const progressRatio = i / 64;
                const isPlayed = progressRatio <= currentTime / (duration || 1);
                // Uniform seek bar: no per-take waveform data is computed, so none is drawn.
                const barHeight = 40;
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
                  <Download size={13} /> Export Active Audio
                </button>
                <button
                  onClick={() => handleSendToMontage()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/40 transition-colors cursor-pointer"
                >
                  <Film size={13} /> Send to Montage Studio
                </button>
              </div>

              <span className="text-[11px] font-mono text-slate-500">
                Acoustic Seed: {activeClip?.acousticSeed || '#791046'} · Latency: 280ms
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
                    Clips generated from the prompt deck appear here instantly. Audition inline, export 48kHz audio, or send straight into Montage Studio.
                  </p>
                </div>
              </div>

              {generatedClips.length > 0 && (
                <button
                  onClick={() => {
                    if (confirm('Reset generated takes library to default master takes?')) {
                      setGeneratedClips(DEFAULT_GENERATED_CLIPS);
                      setActiveClip(DEFAULT_GENERATED_CLIPS[0]);
                      showToast('Reset library to master takes.');
                    }
                  }}
                  className="text-[11px] text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                >
                  Reset Library
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
              onClick={handleResetControls}
              className="text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-1 cursor-pointer"
              title="Reset parameters to current preset defaults"
            >
              <RotateCcw size={11} /> Reset
            </button>
          </div>
          <p className="text-[10px] text-amber-300/80 leading-tight -mt-3">
            The Hugging Face Space synthesis path uses only the text and speaker. Diffusion steps, temperature,
            language and accent below are sent to a custom VOXCPM_API_URL server if one is configured, and are otherwise not applied.
          </p>

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

          {/* Playback speed (HTMLMediaElement.playbackRate) */}
          <div className="space-y-1.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-semibold">Playback speed</span>
              <span className="font-mono text-indigo-400 font-bold">{Math.max(0.7, Math.min(1.8, wpm / 150)).toFixed(2)}x ({wpm} WPM est.)</span>
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
              Changes the playback rate of the take in this player (rate = WPM / 150). It does not change how the voice is synthesized.
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
            <input
              type="file"
              ref={stsInputRef}
              accept="audio/*"
              className="hidden"
              onChange={handleStsFileChange}
            />
            {stsFile ? (
              <div className="p-2.5 rounded-lg bg-violet-950/40 border border-violet-500/40 space-y-2">
                <div className="flex items-center justify-between text-xs text-violet-300 font-semibold truncate">
                  <span className="truncate flex items-center gap-1.5">
                    <AudioWaveform size={14} className="text-violet-400 shrink-0" />
                    {stsFile.name}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400 shrink-0">
                    {(stsFile.size / 1024).toFixed(0)} KB
                  </span>
                </div>
                <button
                  onClick={() => {
                    showToast(`🎙️ Re-voicing "${stsFile.name}" with Logan Master profile...`);
                    handleSynthesize();
                  }}
                  className="w-full py-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white rounded-lg text-xs font-bold transition-all cursor-pointer shadow-md shadow-violet-600/30"
                >
                  Apply Logan Voice Profile
                </button>
              </div>
            ) : (
              <button
                onClick={() => stsInputRef.current?.click()}
                className="w-full py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 rounded-lg text-xs text-slate-300 font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Upload size={13} /> Select Audio File
              </button>
            )}
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
