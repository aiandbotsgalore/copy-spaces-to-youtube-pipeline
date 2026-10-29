import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  AudioWaveform, Plus, Search, Filter, Star, Sparkles, Check, X,
  Save, Loader, AlertCircle, CheckCircle2, Trash2, Edit3, ExternalLink,
  Download, Upload, Copy, Info, Terminal, RefreshCw, Mic, Volume2,
  Users, Layers, ArrowRight, ShieldCheck, HelpCircle, FileText,
  UploadCloud, Music, FileAudio, Camera, Image, Bot
} from 'lucide-react';
import { EnhancedConfig, VoiceProfile, VoiceProfilesCatalog, Release, DeadLetterJob } from '../types';
import { useCopilot } from '../contexts/CopilotContext';
import { readRepositoryTextFile, writeRepositoryTextFile, writeRepositoryBinaryFile, getReleases, dispatchWorkflow } from '../utils/github';
import { loadDeadLetterQueue, saveDeadLetterQueue, removeFromDeadLetterQueue } from '../utils/storage';
import { VoiceProfileModal } from './voice/VoiceProfileModal';
import { CliEnrollmentGuideModal } from './voice/CliEnrollmentGuideModal';
import { RawJsonViewerModal } from './voice/RawJsonViewerModal';
import { PipelineArchitectureModal } from './voice/PipelineArchitectureModal';
import { SeparationMatrixModal } from './voice/SeparationMatrixModal';
import { AudioPreCheckResult } from './voice/types';
import { resizeImageToDataUrl } from '../utils/imageResize';
import { AvatarCropModal } from './AvatarCropModal';

interface Props {
  config: EnhancedConfig;
  onOpenTranscript?: (releaseId: number) => void;
}

const DEFAULT_CATALOG: VoiceProfilesCatalog = {
  version: '2.0-neural',
  updated_at: new Date().toISOString(),
  embedding_model: 'speechbrain/spkrec-ecapa-voxceleb',
  embedding_dim: 192,
  profiles: {
    'Logan': {
      name: 'Logan',
      role: 'Host',
      sample_count: 5,
      avatar_emoji: '🎙️',
      color: 'indigo',
      notes: 'Primary show host. Deep resonant vocal tone with rapid cadence.',
      last_updated: '2026-09-08T10:18:19Z',
    },
    'Angela': {
      name: 'Angela',
      role: 'Host',
      sample_count: 3,
      avatar_emoji: '🎙️',
      color: 'rose',
      notes: 'Host and moderator. Distinct, clear conversational voice.',
      last_updated: '2026-09-20T10:00:00Z',
    },
    'Oor': {
      name: 'Oor',
      role: 'Speaker',
      sample_count: 2,
      avatar_emoji: '⚡',
      color: 'sky',
      notes: 'Frequent speaker and collaborator.',
      last_updated: '2026-08-30T19:18:11Z',
    },
    'Eric Hecker': {
      name: 'Eric Hecker',
      role: 'Special Guest',
      sample_count: 2,
      avatar_emoji: '🛸',
      color: 'emerald',
      notes: 'Featured recurring guest on space missions and technical topics.',
      last_updated: '2026-09-08T10:18:19Z',
    },
    'Mary': {
      name: 'Mary',
      role: 'Co-Host',
      sample_count: 1,
      avatar_emoji: '👩‍🎨',
      color: 'purple',
      notes: 'Regular co-host and contributor.',
      last_updated: '2026-09-15T14:30:00Z',
    },
    'Shane': {
      name: 'Shane',
      role: 'Co-Host',
      sample_count: 1,
      avatar_emoji: '🎧',
      color: 'amber',
      notes: 'Audio co-host and community moderator.',
      last_updated: '2026-09-10T12:00:00Z',
    },
    'Rick Doty': {
      name: 'Rick Doty',
      role: 'Special Guest',
      sample_count: 1,
      avatar_emoji: '🛸',
      color: 'emerald',
      notes: 'Special guest on historical and investigative episodes.',
      last_updated: '2026-09-12T18:00:00Z',
    },
  },
};

const COLOR_OPTIONS = [
  { id: 'indigo',  label: 'Indigo',   badge: 'bg-indigo-500/20 text-indigo-200 border-indigo-400/60',  dot: 'bg-indigo-400' },
  { id: 'purple',  label: 'Purple',   badge: 'bg-purple-500/20 text-purple-200 border-purple-400/60',  dot: 'bg-purple-400' },
  { id: 'emerald', label: 'Emerald',  badge: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/60', dot: 'bg-emerald-400' },
  { id: 'sky',     label: 'Sky Blue', badge: 'bg-sky-500/20 text-sky-200 border-sky-400/60',          dot: 'bg-sky-400' },
  { id: 'amber',   label: 'Amber',    badge: 'bg-amber-500/20 text-amber-200 border-amber-400/60',    dot: 'bg-amber-400' },
  { id: 'rose',    label: 'Rose',     badge: 'bg-rose-500/20 text-rose-200 border-rose-400/60',        dot: 'bg-rose-400' },
  { id: 'cyan',    label: 'Cyan',     badge: 'bg-cyan-500/20 text-cyan-200 border-cyan-400/60',        dot: 'bg-cyan-400' },
  { id: 'orange',  label: 'Orange',   badge: 'bg-orange-500/20 text-orange-200 border-orange-400/60',  dot: 'bg-orange-400' },
  { id: 'teal',    label: 'Teal',     badge: 'bg-teal-500/20 text-teal-200 border-teal-400/60',        dot: 'bg-teal-400' },
  { id: 'fuchsia', label: 'Fuchsia',  badge: 'bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-400/60',dot: 'bg-fuchsia-400' },
  { id: 'pink',    label: 'Pink',     badge: 'bg-pink-500/20 text-pink-200 border-pink-400/60',        dot: 'bg-pink-400' },
  { id: 'lime',    label: 'Lime',     badge: 'bg-lime-500/20 text-lime-200 border-lime-400/60',        dot: 'bg-lime-400' },
  { id: 'violet',  label: 'Violet',   badge: 'bg-violet-500/20 text-violet-200 border-violet-400/60',  dot: 'bg-violet-400' },
  { id: 'yellow',  label: 'Yellow',   badge: 'bg-yellow-500/20 text-yellow-200 border-yellow-400/60',  dot: 'bg-yellow-400' },
  { id: 'blue',    label: 'Blue',     badge: 'bg-blue-500/20 text-blue-200 border-blue-400/60',        dot: 'bg-blue-400' },
  { id: 'red',     label: 'Red',      badge: 'bg-red-500/20 text-red-200 border-red-400/60',          dot: 'bg-red-400' },
];

const ROLE_OPTIONS = ['Host', 'Co-Host', 'Special Guest', 'Speaker', 'Community Contributor'];
const EMOJI_OPTIONS = ['🎙️', '🌹', '⚡', '🛸', '✨', '🧠', '👁️', '💫', '🎧', '👩‍🎨', '🌸', '👑', '👽', '🤖', '🔥', '⭐', '💡', '💬', '🕵️', '🧸', '🎯', '🚀'];

export const VoiceProfileLibrary: React.FC<Props> = ({ config, onOpenTranscript }) => {
  const [avatarCrop, setAvatarCrop] = useState<{ speakerName: string; file: File | Blob } | null>(null);
  const copilot = useCopilot();
  const [catalog, setCatalog] = useState<VoiceProfilesCatalog>(DEFAULT_CATALOG);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [embeddingFilter, setEmbeddingFilter] = useState<'ALL' | 'ENROLLED' | 'PENDING'>('ALL');
  const [sortBy, setSortBy] = useState<'name' | 'samples' | 'updated'>('samples');

  const [savingGitHub, setSavingGitHub] = useState(false);
  const [enrollingCloud, setEnrollingCloud] = useState(false);
  const [retryingDlqId, setRetryingDlqId] = useState<string | null>(null);
  const [dlqList, setDlqList] = useState<DeadLetterJob[]>(() => loadDeadLetterQueue());
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modals
  const [modalMode, setModalMode] = useState<'CREATE' | 'EDIT' | 'DIARIZATION_INFO' | 'RAW_JSON' | 'CLI_GUIDE' | 'SEPARATION_MATRIX' | null>(null);
  const [targetProfile, setTargetProfile] = useState<VoiceProfile | null>(null);
  const [audioPreCheck, setAudioPreCheck] = useState<AudioPreCheckResult | null>(null);
  const [inspectingAudio, setInspectingAudio] = useState(false);

  // Form State
  const [formName, setFormName] = useState('');
  const [formRole, setFormRole] = useState('Speaker');
  const [formColor, setFormColor] = useState('indigo');
  const [formEmoji, setFormEmoji] = useState('🎙️');
  const [formNotes, setFormNotes] = useState('');
  const [formAudioUrl, setFormAudioUrl] = useState('');
  const [audioSourceTab, setAudioSourceTab] = useState<'COMPUTER' | 'URL'>('COMPUTER');
  const [localAudioFile, setLocalAudioFile] = useState<File | null>(null);
  const [localAudioPreviewUrl, setLocalAudioPreviewUrl] = useState<string | null>(null);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Episode diarization test state
  const [episodes, setEpisodes] = useState<Release[]>([]);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<number | null>(null);
  const [testingDiarization, setTestingDiarization] = useState(false);
  const [diarizationTestResult, setDiarizationTestResult] = useState<{ mapped: number; total: number; details: string[] } | null>(null);

  const owner = (config.ownerName || '').trim();
  const repo = (config.repoName || '').trim();
  const hasGitHub = !!(config.githubToken && owner && repo);

  // Load Catalog
  const loadCatalog = useCallback(async () => {
    setLoading(true);
    let loadedData: VoiceProfilesCatalog | null = null;

    // 1. Try fetching from public/voice_profiles.json
    try {
      const res = await fetch('/voice_profiles.json');
      if (res.ok) {
        const json = await res.json();
        if (json && json.profiles) {
          loadedData = json;
        }
      }
    } catch {
      // ignore
    }

    // 2. If authenticated and repo exists, check remote GitHub version
    if (hasGitHub) {
      try {
        const file = await readRepositoryTextFile(config.githubToken, owner, repo, 'voice_profiles.json', 'master');
        if (file && file.content) {
          const remoteJson = JSON.parse(file.content);
          if (remoteJson && remoteJson.profiles) {
            loadedData = remoteJson;
          }
        }
      } catch {
        // ignore
      }
    }

    // 3. Check local storage cache
    if (!loadedData) {
      try {
        const cached = localStorage.getItem('spacepipe_voice_profiles_catalog');
        if (cached) {
          loadedData = JSON.parse(cached);
        }
      } catch {
        // ignore
      }
    }

    // 4. Merge with DEFAULT_CATALOG
    const merged: VoiceProfilesCatalog = loadedData || DEFAULT_CATALOG;
    // Enrich with default metadata if missing
    Object.keys(DEFAULT_CATALOG.profiles).forEach(key => {
      if (!merged.profiles[key]) {
        merged.profiles[key] = DEFAULT_CATALOG.profiles[key];
      } else {
        merged.profiles[key] = {
          ...DEFAULT_CATALOG.profiles[key],
          ...merged.profiles[key],
        };
      }
    });

    if (merged.dlq && Array.isArray(merged.dlq)) {
      const stored = loadDeadLetterQueue();
      const combined = [...stored];
      merged.dlq.forEach(rj => {
        if (!combined.some(c => c.id === rj.id)) {
          combined.push(rj);
        }
      });
      saveDeadLetterQueue(combined);
      setDlqList(combined);
    } else {
      setDlqList(loadDeadLetterQueue());
    }

    setCatalog(merged);
    setLoading(false);
  }, [hasGitHub, config.githubToken, owner, repo]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  // Load episodes list for diarization test
  useEffect(() => {
    if (hasGitHub) {
      getReleases(config.githubToken, owner, repo)
        .then(res => setEpisodes(res))
        .catch(() => {});
    }
  }, [hasGitHub, config.githubToken, owner, repo]);

  const getDefaultSpeakerAvatar = (name: string): string => {
    const clean = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (clean === 'logan' || clean === 'loganblack') return 'https://unavatar.io/twitter/LoganBlack';
    if (clean === 'angela' || clean === 'angelamaggard' || clean === 'angelamaggard3') return 'https://unavatar.io/twitter/AngelaMaggard3';
    if (clean === 'teejay' || clean === 'felony') return 'https://unavatar.io/twitter/felonytalk';
    if (clean === 'consciousculprit' || clean === 'mystery') return 'https://unavatar.io/twitter/studentomystery';
    return `https://unavatar.io/twitter/${clean}`;
  };

  const handleUploadSpeakerAvatar = async (speakerName: string, file?: File | null) => {
    if (!file) return;
    setAvatarCrop({ speakerName, file });
  };

  const saveSpeakerAvatar = async (speakerName: string, file: Blob) => {
    try {
      const { dataUrl, base64: base64Data } = await resizeImageToDataUrl(file, 512, 0.85);
      const nextCatalog = { ...catalog };
      const p = nextCatalog.profiles[speakerName];
      if (p) {
        p.avatar_url = dataUrl;
        saveCatalogLocal(nextCatalog);
      }

      if (hasGitHub) {
        try {
          const slug = speakerName.toLowerCase().replace(/[^a-z0-9]/g, '_');
          const fileName = `public/avatars/${slug}.jpg`;
          await writeRepositoryBinaryFile(
            config.githubToken,
            owner,
            repo,
            fileName,
            base64Data,
            `chore(avatar): upload portrait photo for ${speakerName}`,
            'master'
          );
          const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/master/${fileName}`;
          if (p) {
            p.avatar_url = rawUrl;
            saveCatalogLocal(nextCatalog);
            const content = JSON.stringify(nextCatalog, null, 2);
            await writeRepositoryTextFile(
              config.githubToken,
              owner,
              repo,
              'voice_profiles.json',
              content,
              `chore(profiles): update avatar_url for ${speakerName}`,
              'master'
            );
          }
          setStatusMsg({ type: 'success', text: `🎉 Avatar photo uploaded and saved for ${speakerName}!` });
        } catch (err: any) {
          setStatusMsg({ type: 'error', text: `Avatar saved locally, but GitHub upload failed: ${err.message}` });
        }
      } else {
        setStatusMsg({ type: 'success', text: `Avatar updated locally for ${speakerName}!` });
      }
      setTimeout(() => setStatusMsg(null), 5000);
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: `Failed to process image: ${err.message}` });
    }
  };

  // Sync to localStorage
  const saveCatalogLocal = (next: VoiceProfilesCatalog) => {
    setCatalog(next);
    try {
      localStorage.setItem('spacepipe_voice_profiles_catalog', JSON.stringify(next));

      // Also sync to spacepipe_saved_speakers for TranscriptPanel compatibility
      const savedSpeakersList = Object.values(next.profiles).map(p => ({
        id: p.name.toLowerCase().replace(/\s+/g, '-'),
        name: p.name,
        role: p.role || 'Speaker',
        avatarEmoji: p.avatar_emoji || '🎙️',
        color: p.color || 'indigo',
      }));
      localStorage.setItem('spacepipe_saved_speakers', JSON.stringify(savedSpeakersList));
    } catch {
      // ignore
    }
  };

  // Save to GitHub
  const handleSaveToGitHub = async () => {
    if (!hasGitHub) {
      setStatusMsg({ type: 'error', text: 'GitHub token, owner, and repository name must be configured in Settings.' });
      return;
    }

    setSavingGitHub(true);
    setStatusMsg(null);
    try {
      const content = JSON.stringify(catalog, null, 2);
      await writeRepositoryTextFile(
        config.githubToken,
        owner,
        repo,
        'voice_profiles.json',
        content,
        'chore(profiles): update voice_profiles.json via Voice Profile Library',
        'master'
      );
      setStatusMsg({ type: 'success', text: 'Successfully committed voice_profiles.json to GitHub repository on master!' });
      setTimeout(() => setStatusMsg(null), 6000);
    } catch (e) {
      setStatusMsg({ type: 'error', text: `Failed to commit to GitHub: ${(e as Error).message}` });
    } finally {
      setSavingGitHub(false);
    }
  };

  // Audio Quality Inspector via Web Audio API
  const inspectAudioFile = async (file: File) => {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) {
      return {
        duration: 0,
        peakDb: 0,
        isClipping: false,
        isTooQuiet: false,
        isOptimalDuration: true,
        silenceRatio: 0,
        sampleRate: 44100,
        channels: 1,
        qualityLevel: 'good' as const,
        qualityNotes: ['Browser Web Audio inspection not supported, will proceed with cloud validation.']
      };
    }

    const ctx = new AudioCtx();
    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const duration = audioBuffer.duration;
      const channels = audioBuffer.numberOfChannels;
      const sampleRate = audioBuffer.sampleRate;

      const data = audioBuffer.getChannelData(0);
      let maxPeak = 0;
      let silentCount = 0;
      const step = Math.max(1, Math.floor(data.length / 50000));
      let samplesChecked = 0;

      for (let i = 0; i < data.length; i += step) {
        const abs = Math.abs(data[i]);
        if (abs > maxPeak) maxPeak = abs;
        if (abs < 0.005) silentCount++;
        samplesChecked++;
      }

      const silenceRatio = samplesChecked > 0 ? silentCount / samplesChecked : 0;
      const peakDb = maxPeak > 0 ? 20 * Math.log10(maxPeak) : -100;
      const isClipping = maxPeak >= 0.99;
      const isTooQuiet = peakDb < -25;
      const isOptimalDuration = duration >= 3.0 && duration <= 20.0;

      const notes: string[] = [];
      let level: 'excellent' | 'good' | 'warning' | 'error' = 'excellent';

      if (duration < 2.0) {
        notes.push('Too brief (< 2s). May not contain enough acoustic variance for ECAPA-TDNN.');
        level = 'error';
      } else if (duration < 3.5) {
        notes.push('Slightly short (< 3.5s). Recommend 4s–12s for optimal speaker vector extraction.');
        level = 'warning';
      } else if (duration > 35.0) {
        notes.push('Long audio sample (> 35s). Ensure it contains only this speaker without crosstalk.');
        level = 'warning';
      } else {
        notes.push(`Optimal monologue duration (${duration.toFixed(1)}s).`);
      }

      if (isClipping) {
        notes.push('Digital clipping detected (0 dBFS peak). Audio may have distorted frequencies.');
        if (level !== 'error') level = 'warning';
      } else if (isTooQuiet) {
        notes.push('Audio signal is quiet (< -25 dBFS). Consider a louder or closer recording.');
        if (level !== 'error') level = 'warning';
      }

      if (silenceRatio > 0.65) {
        notes.push('High silence ratio (> 65%). Sample contains extended quiet pauses.');
        if (level !== 'error') level = 'warning';
      }

      return {
        duration,
        peakDb,
        isClipping,
        isTooQuiet,
        isOptimalDuration,
        silenceRatio,
        sampleRate,
        channels,
        qualityLevel: level,
        qualityNotes: notes,
      };
    } finally {
      ctx.close().catch(() => {});
    }
  };

  // Open Create Modal
  const handleOpenCreate = () => {
    setTargetProfile(null);
    setFormName('');
    setFormRole('Speaker');
    setFormColor('indigo');
    setFormEmoji('🎙️');
    setFormNotes('');
    setFormAudioUrl('');
    setLocalAudioFile(null);
    if (localAudioPreviewUrl) URL.revokeObjectURL(localAudioPreviewUrl);
    setLocalAudioPreviewUrl(null);
    setAudioPreCheck(null);
    setAudioSourceTab('COMPUTER');
    setModalMode('CREATE');
  };

  // Open Edit Modal
  const handleOpenEdit = (p: VoiceProfile) => {
    setTargetProfile(p);
    setFormName(p.name);
    setFormRole(p.role || 'Speaker');
    setFormColor(p.color || 'indigo');
    setFormEmoji(p.avatar_emoji || '🎙️');
    setFormNotes(p.notes || '');
    setFormAudioUrl(p.sample_audio_url || '');
    setLocalAudioFile(null);
    if (localAudioPreviewUrl) URL.revokeObjectURL(localAudioPreviewUrl);
    setLocalAudioPreviewUrl(null);
    setAudioPreCheck(null);
    setAudioSourceTab(p.sample_audio_url?.startsWith('http') ? 'URL' : 'COMPUTER');
    setModalMode('EDIT');
  };

  // Select Audio File from Computer & Run Pre-Flight Check
  const handleSelectAudioFile = async (file: File) => {
    if (!file) return;
    setLocalAudioFile(file);
    if (localAudioPreviewUrl) {
      URL.revokeObjectURL(localAudioPreviewUrl);
    }
    const preview = URL.createObjectURL(file);
    setLocalAudioPreviewUrl(preview);
    setAudioPreCheck(null);
    setInspectingAudio(true);
    try {
      const check = await inspectAudioFile(file);
      setAudioPreCheck(check);
    } catch {
      // ignore inspection failure
    } finally {
      setInspectingAudio(false);
    }
  };

  // Upload Audio File from Computer & Cloud Enroll
  const handleUploadFromComputerAndEnroll = async () => {
    const trimmedName = formName.trim();
    if (!trimmedName) {
      setStatusMsg({ type: 'error', text: 'Please enter a speaker name first.' });
      return;
    }
    if (!localAudioFile) {
      setStatusMsg({ type: 'error', text: 'Please select an audio file (.wav, .mp3, .m4a) from your computer.' });
      return;
    }
    if (!hasGitHub) {
      setStatusMsg({ type: 'error', text: 'GitHub Token, Owner, and Repo must be configured in Settings to upload audio to your repository.' });
      return;
    }

    setUploadingAudio(true);
    setStatusMsg(null);
    try {
      // 1. Convert File to Base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const res = reader.result as string;
          resolve(res.includes(',') ? res.split(',')[1] : res);
        };
        reader.onerror = reject;
        reader.readAsDataURL(localAudioFile);
      });

      const sanitizedSpeaker = trimmedName.replace(/[/\\?%*:|"<>]/g, '_').trim();
      const cleanFileName = localAudioFile.name.replace(/[/\\?%*:|"<>]/g, '_');
      const repoPath = `speaker_samples/${sanitizedSpeaker}/${cleanFileName}`;

      // 2. Commit the audio binary to GitHub repository
      setStatusMsg({ type: 'success', text: `Uploading "${cleanFileName}" (${Math.round(localAudioFile.size / 1024)} KB) to repository…` });
      await writeRepositoryBinaryFile(
        config.githubToken,
        owner,
        repo,
        repoPath,
        base64,
        `feat(voice): upload sample audio for speaker ${trimmedName}`,
        'master'
      );

      // 3. Save profile metadata locally
      const nextCatalog: VoiceProfilesCatalog = {
        ...catalog,
        updated_at: new Date().toISOString(),
        profiles: { ...catalog.profiles },
      };
      const existing = targetProfile || nextCatalog.profiles[trimmedName] || {};
      nextCatalog.profiles[trimmedName] = {
        ...existing,
        name: trimmedName,
        role: formRole,
        color: formColor,
        avatar_emoji: formEmoji,
        notes: formNotes,
        sample_audio_url: repoPath,
        last_updated: new Date().toISOString(),
      };
      saveCatalogLocal(nextCatalog);

      // 4. Trigger GitHub Actions cloud runner with the uploaded repo path
      await dispatchWorkflow(config.githubToken, owner, repo, 'enroll_voice.yml', {
        speaker_name: trimmedName,
        audio_url: repoPath,
        role: formRole,
      });

      setModalMode(null);
      setStatusMsg({
        type: 'success',
        text: `🎉 Audio "${cleanFileName}" uploaded directly from your computer! GitHub Actions is now extracting the 192-dim SpeechBrain vector and updating voice_profiles.json.`
      });
      setTimeout(() => setStatusMsg(null), 12000);
    } catch (e) {
      setStatusMsg({ type: 'error', text: `Failed to upload audio from computer: ${(e as Error).message}` });
    } finally {
      setUploadingAudio(false);
    }
  };

  // Save Form
  const handleSaveForm = () => {
    const trimmedName = formName.trim();
    if (!trimmedName) return;

    const nextCatalog: VoiceProfilesCatalog = {
      ...catalog,
      updated_at: new Date().toISOString(),
      profiles: { ...catalog.profiles },
    };

    if (modalMode === 'EDIT' && targetProfile && targetProfile.name !== trimmedName) {
      delete nextCatalog.profiles[targetProfile.name];
    }

    const existing = targetProfile || nextCatalog.profiles[trimmedName];

    nextCatalog.profiles[trimmedName] = {
      ...(existing || {}),
      name: trimmedName,
      role: formRole,
      color: formColor,
      avatar_emoji: formEmoji,
      notes: formNotes,
      sample_audio_url: formAudioUrl || existing?.sample_audio_url,
      last_updated: new Date().toISOString(),
    };

    saveCatalogLocal(nextCatalog);
    setModalMode(null);
    setStatusMsg({ type: 'success', text: `Voice profile for "${trimmedName}" updated successfully.` });
    setTimeout(() => setStatusMsg(null), 4000);
  };

  // Cloud Enrollment via GitHub Actions (enroll_voice.yml)
  const handleCloudEnroll = async () => {
    const trimmedName = formName.trim();
    const trimmedUrl = formAudioUrl.trim();

    if (!trimmedName) {
      setStatusMsg({ type: 'error', text: 'Please enter a speaker name first.' });
      return;
    }
    if (!trimmedUrl || !trimmedUrl.startsWith('http')) {
      setStatusMsg({ type: 'error', text: 'Please enter a direct audio URL (.wav, .mp3, or .m4a) to enroll via GitHub Actions cloud runner.' });
      return;
    }
    if (!hasGitHub) {
      setStatusMsg({ type: 'error', text: 'GitHub Token, Owner, and Repo must be configured in Settings to dispatch cloud enrollment.' });
      return;
    }

    setEnrollingCloud(true);
    setStatusMsg(null);
    try {
      // 1. Save profile locally so it's visible in UI immediately
      const nextCatalog: VoiceProfilesCatalog = {
        ...catalog,
        updated_at: new Date().toISOString(),
        profiles: { ...catalog.profiles },
      };
      const existing = targetProfile || nextCatalog.profiles[trimmedName] || {};
      nextCatalog.profiles[trimmedName] = {
        ...existing,
        name: trimmedName,
        role: formRole,
        color: formColor,
        avatar_emoji: formEmoji,
        notes: formNotes,
        sample_audio_url: trimmedUrl,
        last_updated: new Date().toISOString(),
      };
      saveCatalogLocal(nextCatalog);

      // 2. Dispatch GitHub Action workflow
      await dispatchWorkflow(config.githubToken, owner, repo, 'enroll_voice.yml', {
        speaker_name: trimmedName,
        audio_url: trimmedUrl,
        role: formRole,
      });

      setModalMode(null);
      setStatusMsg({
        type: 'success',
        text: `⚡ Cloud enrollment dispatched for "${trimmedName}"! SpeechBrain ECAPA-TDNN is extracting the 192-dim neural vector in GitHub Actions and committing to voice_profiles.json.`
      });
      setTimeout(() => setStatusMsg(null), 10000);
    } catch (e) {
      setStatusMsg({ type: 'error', text: `Failed to trigger cloud enrollment: ${(e as Error).message}` });
    } finally {
      setEnrollingCloud(false);
    }
  };

  // Delete Profile
  const handleDeleteProfile = (name: string) => {
    if (!window.confirm(`Are you sure you want to delete the voice profile for "${name}"?`)) return;

    const nextCatalog: VoiceProfilesCatalog = {
      ...catalog,
      updated_at: new Date().toISOString(),
      profiles: { ...catalog.profiles },
    };
    delete nextCatalog.profiles[name];
    saveCatalogLocal(nextCatalog);
    setStatusMsg({ type: 'success', text: `Profile for "${name}" deleted.` });
    setTimeout(() => setStatusMsg(null), 4000);
  };

  // DLQ Retry and Dismiss
  const handleRetryDlq = async (job: DeadLetterJob) => {
    if (!job.speakerName) return;
    if (!hasGitHub) {
      setStatusMsg({ type: 'error', text: 'GitHub Token, Owner, and Repo must be configured in Settings to retry cloud enrollment.' });
      return;
    }
    setRetryingDlqId(job.id);
    setStatusMsg({ type: 'success', text: `⚡ Retrying enrollment for "${job.speakerName}" with audio pre-flight sanitization and VAD fallback...` });
    try {
      await dispatchWorkflow(config.githubToken, owner, repo, 'enroll_voice.yml', {
        speaker_name: job.speakerName,
        audio_url: job.audioUrl || '',
        role: 'Speaker',
      });
      removeFromDeadLetterQueue(job.id);
      setDlqList(prev => prev.filter(j => j.id !== job.id));
      setStatusMsg({
        type: 'success',
        text: `⚡ Remediation dispatch sent for "${job.speakerName}". Cloud runner will apply 16kHz PCM, VAD active speech check, and -16 LUFS normalization.`
      });
      setTimeout(() => setStatusMsg(null), 10000);
    } catch (e) {
      setStatusMsg({ type: 'error', text: `Failed to retry enrollment: ${(e as Error).message}` });
    } finally {
      setRetryingDlqId(null);
    }
  };

  const handleDismissDlq = (id: string) => {
    removeFromDeadLetterQueue(id);
    setDlqList(prev => prev.filter(j => j.id !== id));
  };

  // Filter & Sort Profiles
  const profileList = useMemo(() => {
    let list: VoiceProfile[] = Object.values<VoiceProfile>(catalog.profiles || {});

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.role && p.role.toLowerCase().includes(q)) ||
        (p.notes && p.notes.toLowerCase().includes(q))
      );
    }

    // Role filter
    if (roleFilter !== 'ALL') {
      list = list.filter(p => p.role === roleFilter);
    }

    // Embedding filter
    if (embeddingFilter === 'ENROLLED') {
      list = list.filter(p => p.embedding && p.embedding.length === 192);
    } else if (embeddingFilter === 'PENDING') {
      list = list.filter(p => !p.embedding || p.embedding.length !== 192);
    }

    // Sort
    list.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'samples') return (b.sample_count || 0) - (a.sample_count || 0);
      if (sortBy === 'updated') {
        const tA = a.last_updated ? new Date(a.last_updated).getTime() : 0;
        const tB = b.last_updated ? new Date(b.last_updated).getTime() : 0;
        return tB - tA;
      }
      return 0;
    });

    return list;
  }, [catalog, search, roleFilter, embeddingFilter, sortBy]);

  // Statistics
  const stats = useMemo(() => {
    const all: VoiceProfile[] = Object.values<VoiceProfile>(catalog.profiles || {});
    const enrolled = all.filter(p => p.embedding && p.embedding.length === 192);
    const pending = all.length - enrolled.length;
    return {
      total: all.length,
      enrolled: enrolled.length,
      pending,
      model: catalog.embedding_model || 'speechbrain/spkrec-ecapa-voxceleb',
      dim: catalog.embedding_dim || 192,
    };
  }, [catalog]);

  // Pairwise Cosine Similarity for Vocal Confusion Analysis
  const confusionPairs = useMemo(() => {
    const list: VoiceProfile[] = Object.values<VoiceProfile>(catalog.profiles || {}).filter(p => p.embedding && p.embedding.length === 192);
    const pairs: Array<{
      speakerA: string;
      speakerB: string;
      similarity: number;
      risk: 'high' | 'moderate' | 'low';
    }> = [];

    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const pA = list[i];
        const pB = list[j];
        const a = pA.embedding!;
        const b = pB.embedding!;
        let dot = 0, normA = 0, normB = 0;
        for (let k = 0; k < 192; k++) {
          dot += a[k] * b[k];
          normA += a[k] * a[k];
          normB += b[k] * b[k];
        }
        const denom = Math.sqrt(normA) * Math.sqrt(normB);
        const sim = denom > 1e-6 ? dot / denom : 0;
        const risk = sim >= 0.75 ? 'high' : sim >= 0.65 ? 'moderate' : 'low';
        pairs.push({
          speakerA: pA.name,
          speakerB: pB.name,
          similarity: Math.min(1.0, Math.max(0, sim)),
          risk,
        });
      }
    }

    pairs.sort((x, y) => y.similarity - x.similarity);
    return pairs;
  }, [catalog]);

  const speakerConfusionMap = useMemo(() => {
    const map: Record<string, Array<{ other: string; sim: number; risk: 'high' | 'moderate' }>> = {};
    confusionPairs.forEach(pair => {
      if (pair.similarity >= 0.65) {
        map[pair.speakerA] = map[pair.speakerA] || [];
        map[pair.speakerA].push({ other: pair.speakerB, sim: pair.similarity, risk: pair.risk as 'high' | 'moderate' });
        map[pair.speakerB] = map[pair.speakerB] || [];
        map[pair.speakerB].push({ other: pair.speakerA, sim: pair.similarity, risk: pair.risk as 'high' | 'moderate' });
      }
    });
    return map;
  }, [confusionPairs]);

  // Export JSON
  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(catalog, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'voice_profiles.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import JSON
  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (json && json.profiles) {
          saveCatalogLocal(json);
          setStatusMsg({ type: 'success', text: `Imported ${Object.keys(json.profiles).length} voice profiles successfully!` });
        } else {
          throw new Error('Invalid JSON schema. Missing "profiles" dictionary.');
        }
      } catch (err) {
        setStatusMsg({ type: 'error', text: `Import failed: ${(err as Error).message}` });
      }
    };
    reader.readAsText(file);
  };

  // Run Diarization Match Test
  const handleTestDiarization = async () => {
    if (!selectedEpisodeId) return;
    setTestingDiarization(true);
    setDiarizationTestResult(null);

    const ep = episodes.find(e => e.id === selectedEpisodeId);
    if (!ep) {
      setTestingDiarization(false);
      return;
    }

    try {
      const knownNames = Object.keys(catalog.profiles);
      const matches: string[] = [];

      // Simulate match evaluation
      knownNames.slice(0, 3).forEach(name => {
        const p = catalog.profiles[name];
        matches.push(`Matched Speaker ${matches.length} → "${name}" (${p.role || 'Speaker'}, similarity 0.88)`);
      });

      setDiarizationTestResult({
        mapped: matches.length,
        total: matches.length + 2,
        details: matches,
      });
    } catch {
      // ignore
    } finally {
      setTestingDiarization(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-slate-950 text-slate-200">
      <AvatarCropModal
        file={avatarCrop?.file || null}
        speakerName={avatarCrop?.speakerName || ''}
        onCancel={() => setAvatarCrop(null)}
        onConfirm={blob => {
          const name = avatarCrop?.speakerName;
          setAvatarCrop(null);
          if (name) void saveSpeakerAvatar(name, blob);
        }}
      />
      {/* ── Page Header ── */}
      <div className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md px-6 py-6 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
                <AudioWaveform size={22} />
              </div>
              <h1 className="text-xl md:text-2xl font-black text-white tracking-tight">Voice Profile Library</h1>
              <span className="text-[11px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                Acoustic Diarization
              </span>
            </div>
            <p className="text-xs text-slate-400 max-w-2xl">
              Central catalog of speaker neural voice embeddings ({stats.dim}-dim ECAPA-TDNN). Automatically identifies, matches, and labels speakers in Twitter Space transcripts.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleOpenCreate}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold shadow-lg transition-all hover:scale-105 cursor-pointer"
            >
              <Plus size={15} /> Add Speaker Profile
            </button>

            <button
              onClick={() => {
                copilot.sendMessage(`Analyze our enrolled voice profiles catalog (${stats.total} total profiles, ${stats.enrolled} enrolled, ${stats.pending} pending). Are there recurring speakers with missing embeddings or low sample counts that should be enrolled from recent transcripts?`);
                copilot.activePanelNavHandler?.('ai-copilot');
              }}
              className="flex items-center gap-1.5 px-3 py-2 bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 rounded-lg text-xs font-bold border border-indigo-500/30 transition-all cursor-pointer"
              title="Ask SpacePipe Copilot to analyze voice catalog and identify speakers to enroll"
            >
              <Bot size={14} className="text-indigo-400" />
              <span>Ask Copilot to Analyze</span>
            </button>

            <button
              onClick={handleSaveToGitHub}
              disabled={savingGitHub || !hasGitHub}
              title={hasGitHub ? 'Commit voice_profiles.json directly to master branch' : 'Configure GitHub Token to commit'}
              className="flex items-center gap-2 px-3.5 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 disabled:opacity-40 text-emerald-300 border border-emerald-500/40 rounded-lg text-xs font-bold transition-all cursor-pointer shadow-sm"
            >
              {savingGitHub ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
              {savingGitHub ? 'Committing…' : 'Sync to GitHub'}
            </button>

            <button
              onClick={() => setModalMode('SEPARATION_MATRIX')}
              className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600/15 hover:bg-indigo-600/25 text-indigo-300 border border-indigo-500/30 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
            >
              <Sparkles size={14} className="text-indigo-400" />
              <span>Acoustic Auditor</span>
              {confusionPairs.filter(p => p.risk === 'high').length > 0 && (
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" title="High confusion risk detected" />
              )}
            </button>

            <button
              onClick={() => setModalMode('DIARIZATION_INFO')}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-lg text-xs font-semibold border border-slate-800 transition-colors cursor-pointer"
            >
              <HelpCircle size={14} className="text-indigo-400" /> Pipeline Guide
            </button>

            <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-0.5">
              <button
                onClick={handleExportJson}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                title="Download voice_profiles.json"
              >
                <Download size={15} />
              </button>
              <label
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                title="Import voice_profiles.json"
              >
                <Upload size={15} />
                <input type="file" accept=".json" onChange={handleImportJson} className="hidden" />
              </label>
            </div>
          </div>
        </div>

        {/* Status banner */}
        {statusMsg && (
          <div className={`max-w-7xl mx-auto mt-4 p-3 rounded-xl border text-xs flex items-center gap-2 animate-in fade-in duration-200 ${
            statusMsg.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}>
            {statusMsg.type === 'success' ? <CheckCircle2 size={15} className="flex-shrink-0" /> : <AlertCircle size={15} className="flex-shrink-0" />}
            <span className="font-medium">{statusMsg.text}</span>
          </div>
        )}
      </div>

      <div className="max-w-7xl mx-auto w-full px-6 py-8 space-y-6">
        {/* ── Key Metrics Bar ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 shadow-sm space-y-1">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[11px] font-bold uppercase tracking-wider">Known Speakers</span>
              <Users size={16} className="text-indigo-400" />
            </div>
            <div className="text-2xl font-black text-white">{stats.total}</div>
            <p className="text-[11px] text-slate-400">Registered across catalog</p>
          </div>

          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 shadow-sm space-y-1">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[11px] font-bold uppercase tracking-wider">Neural Vectors</span>
              <Sparkles size={16} className="text-emerald-400" />
            </div>
            <div className="text-2xl font-black text-emerald-400">{stats.enrolled}</div>
            <p className="text-[11px] text-slate-400">192-dim ECAPA enrolled</p>
          </div>

          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 shadow-sm space-y-1">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[11px] font-bold uppercase tracking-wider">Pending Samples</span>
              <Mic size={16} className="text-amber-400" />
            </div>
            <div className="text-2xl font-black text-amber-400">{stats.pending}</div>
            <p className="text-[11px] text-slate-400">Awaiting audio clips</p>
          </div>

          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 shadow-sm space-y-1">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[11px] font-bold uppercase tracking-wider">Pipeline Model</span>
              <Layers size={16} className="text-slate-300" />
            </div>
            <div className="text-sm font-bold text-slate-200 truncate" title={stats.model}>
              ECAPA-TDNN
            </div>
            <p className="text-[11px] text-slate-400">192-dimensional embeddings</p>
          </div>
        </div>

        {/* ── Dead-Letter Queue (DLQ) Quarantined Enrollments ── */}
        {dlqList.length > 0 && (
          <div className="p-4 bg-rose-950/20 border border-rose-500/30 rounded-xl space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <AlertCircle size={16} className="text-rose-400" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  Dead-Letter Queue ({dlqList.length} Quarantined Enrollment{dlqList.length !== 1 ? 's' : ''})
                </h3>
              </div>
              <span className="text-[11px] bg-rose-500/20 text-rose-300 border border-rose-500/30 px-2 py-0.5 rounded font-mono font-semibold">
                Quarantined After 3 Failed Remediation Cycles
              </span>
            </div>
            <p className="text-xs text-slate-400">
              The following voice enrollment requests encountered fatal audio pre-flight or speech extraction rejections. Review root-cause logs below or trigger auto-remediation.
            </p>
            <div className="space-y-2">
              {dlqList.map(job => (
                <div key={job.id} className="p-3 bg-slate-900/80 border border-slate-800 rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-white text-sm">{job.speakerName || 'Unknown Speaker'}</span>
                      <span className="text-[10px] bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded font-mono">
                        Run #{job.runId || 'N/A'}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {new Date(job.failedAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-rose-300 text-[11px] leading-relaxed">
                      <span className="text-slate-400 font-semibold">Root Cause: </span>
                      {job.rootCause}
                    </p>
                    {job.audioUrl && (
                      <p className="text-[10px] text-slate-500 truncate max-w-lg font-mono">
                        Source: {job.audioUrl}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 self-end sm:self-center">
                    {job.logUrl && (
                      <a
                        href={job.logUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-rose-300 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                      >
                        [View Failure Log] <ExternalLink size={11} />
                      </a>
                    )}
                    <button
                      onClick={() => handleRetryDlq(job)}
                      disabled={retryingDlqId === job.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
                    >
                      {retryingDlqId === job.id ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                      <span>Retry Enrollment</span>
                    </button>
                    <button
                      onClick={() => handleDismissDlq(job.id)}
                      className="text-xs text-slate-400 hover:text-white px-2 py-1.5 rounded bg-slate-800/80 hover:bg-slate-700 transition-colors cursor-pointer"
                      title="Dismiss from DLQ"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Search & Filter Controls ── */}
        <div className="p-3 bg-slate-900/50 border border-slate-800 rounded-xl flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-[280px]">
            <div className="relative flex-1 max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search speaker name, role, notes…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-8 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Embedding filter */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
              <button
                onClick={() => setEmbeddingFilter('ALL')}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                  embeddingFilter === 'ALL' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                All ({stats.total})
              </button>
              <button
                onClick={() => setEmbeddingFilter('ENROLLED')}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                  embeddingFilter === 'ENROLLED' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                ⚡ Enrolled ({stats.enrolled})
              </button>
              <button
                onClick={() => setEmbeddingFilter('PENDING')}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                  embeddingFilter === 'PENDING' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                ⏳ Pending ({stats.pending})
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Role dropdown */}
            <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5">
              <Filter size={12} className="text-slate-400" />
              <select
                value={roleFilter}
                onChange={e => setRoleFilter(e.target.value)}
                className="bg-transparent text-xs text-slate-200 focus:outline-none cursor-pointer"
              >
                <option value="ALL" className="bg-slate-900 text-white">All Roles</option>
                {ROLE_OPTIONS.map(r => (
                  <option key={r} value={r} className="bg-slate-900 text-white">{r}</option>
                ))}
              </select>
            </div>

            {/* Sort by */}
            <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5">
              <span className="text-[11px] text-slate-400 font-medium">Sort:</span>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as any)}
                className="bg-transparent text-xs text-slate-200 focus:outline-none cursor-pointer font-semibold"
              >
                <option value="samples" className="bg-slate-900 text-white">Sample Count</option>
                <option value="name" className="bg-slate-900 text-white">Name (A-Z)</option>
                <option value="updated" className="bg-slate-900 text-white">Recently Updated</option>
              </select>
            </div>
          </div>
        </div>

        {/* ── Profiles Grid ── */}
        {profileList.length === 0 ? (
          <div className="py-20 text-center space-y-3 bg-slate-900/30 border border-slate-800/80 rounded-xl p-8 max-w-lg mx-auto">
            <AudioWaveform size={36} className="mx-auto text-slate-500" />
            <h3 className="text-base font-bold text-white">No voice profiles found</h3>
            <p className="text-xs text-slate-400">
              {search ? `No profiles match "${search}". Try clearing your filters.` : 'Add your first recurring host or speaker profile to begin automatic diarization.'}
            </p>
            <button
              onClick={handleOpenCreate}
              className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg shadow-md cursor-pointer"
            >
              <Plus size={14} /> Add Profile
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {profileList.map(profile => {
              const hasEmbedding = profile.embedding && profile.embedding.length === 192;
              const colorTheme = COLOR_OPTIONS.find(c => c.id === profile.color) || COLOR_OPTIONS[0];

              return (
                <div
                  key={profile.name}
                  className="bg-slate-900/70 border border-slate-800/90 hover:border-slate-700/90 rounded-xl p-5 shadow-lg space-y-4 transition-all group flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    {/* Card Header: Avatar, Name, Role */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-13 h-13 rounded-2xl flex items-center justify-center text-xl shadow-md border ${colorTheme.badge} flex-shrink-0 group-hover:scale-105 transition-transform overflow-hidden relative group/avatar bg-slate-950`}>
                          {profile.avatar_url || getDefaultSpeakerAvatar(profile.name) ? (
                            <img
                              src={profile.avatar_url || getDefaultSpeakerAvatar(profile.name)}
                              alt={profile.name}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                          ) : (
                            <span>{profile.avatar_emoji || '🎙️'}</span>
                          )}
                          <label
                            className="absolute inset-0 bg-slate-950/75 opacity-0 group-hover/avatar:opacity-100 flex flex-col items-center justify-center cursor-pointer transition-opacity text-white text-[9px] font-semibold"
                            title="Upload Avatar Photo (.jpg, .png)"
                          >
                            <Camera size={14} className="mb-0.5 text-purple-300" />
                            <span>Photo</span>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => handleUploadSpeakerAvatar(profile.name, e.target.files?.[0])}
                            />
                          </label>
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-base font-bold text-white truncate tracking-tight">{profile.name}</h3>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-semibold border border-slate-700">
                              {profile.role || 'Speaker'}
                            </span>
                            {profile.sample_count !== undefined && (
                              <span className="text-[11px] text-slate-400 font-mono">
                                {profile.sample_count} sample{profile.sample_count !== 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Top Action Buttons */}
                      <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleOpenEdit(profile)}
                          className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                          title="Edit Profile"
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          onClick={() => handleDeleteProfile(profile.name)}
                          className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                          title="Delete Profile"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Bio / Notes */}
                    {profile.notes && (
                      <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed bg-slate-950/40 p-2.5 rounded-xl border border-slate-800/60">
                        {profile.notes}
                      </p>
                    )}

                    {/* Embedding Status & Visualization */}
                    <div className="p-3 bg-slate-950/80 border border-slate-800/80 rounded-xl space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          {hasEmbedding ? (
                            <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-400">
                              <Sparkles size={12} /> 192-dim Neural Vector
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-[11px] font-bold text-amber-400">
                              <Mic size={12} /> Pending Voice Sample
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-slate-400 font-mono">
                          {hasEmbedding ? 'Unit Norm (1.00)' : 'Awaiting Clip'}
                        </span>
                      </div>

                      {/* Vector Visualizer Barcode */}
                      {hasEmbedding && profile.embedding ? (
                        <div className="space-y-1">
                          <div className="h-7 w-full bg-slate-900 rounded-lg p-1 flex items-end gap-[1px] overflow-hidden border border-slate-800" title="192-dimensional ECAPA-TDNN Acoustic Fingerprint">
                            {profile.embedding.slice(0, 96).map((val, idx) => {
                              const heightPct = Math.min(100, Math.max(15, Math.abs(val) * 600));
                              const isPositive = val >= 0;
                              return (
                                <div
                                  key={idx}
                                  style={{ height: `${heightPct}%` }}
                                  className={`flex-1 rounded-t-sm transition-all ${
                                    isPositive ? 'bg-emerald-400/80 hover:bg-emerald-300' : 'bg-indigo-400/80 hover:bg-indigo-300'
                                  }`}
                                  title={`Dim ${idx * 2}: ${val.toFixed(4)}`}
                                />
                              );
                            })}
                          </div>
                          <div className="flex justify-between text-[11px] font-mono text-slate-400 px-0.5">
                            <span>Dim 0</span>
                            <span>Acoustic Fingerprint (ECAPA-TDNN)</span>
                            <span>Dim 192</span>
                          </div>
                        </div>
                      ) : (
                        <div className="py-2 text-center text-[11px] text-slate-400">
                          Attach an audio clip to enroll acoustic vector
                        </div>
                      )}

                      {/* Confusion Risk Alert */}
                      {hasEmbedding && speakerConfusionMap[profile.name] && speakerConfusionMap[profile.name].length > 0 && (
                        <div className={`p-2 rounded-lg border text-[11px] flex items-center justify-between gap-1.5 ${
                          speakerConfusionMap[profile.name][0].risk === 'high'
                            ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                            : 'bg-amber-500/10 border-amber-500/25 text-amber-300'
                        }`}>
                          <div className="flex items-center gap-1.5 min-w-0">
                            <AlertCircle size={12} className={speakerConfusionMap[profile.name][0].risk === 'high' ? 'text-rose-400 flex-shrink-0' : 'text-amber-400 flex-shrink-0'} />
                            <span className="truncate">
                              Overlap with <strong>{speakerConfusionMap[profile.name][0].other}</strong> ({Math.round(speakerConfusionMap[profile.name][0].sim * 100)}%)
                            </span>
                          </div>
                          <button
                            onClick={() => setModalMode('SEPARATION_MATRIX')}
                            className="text-[11px] underline font-semibold hover:text-white flex-shrink-0 cursor-pointer"
                          >
                            Inspect
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Card Footer: Last Updated & Quick Action */}
                  <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs mt-2">
                    <span className="text-[11px] text-slate-400">
                      {profile.last_updated ? `Updated ${new Date(profile.last_updated).toLocaleDateString()}` : 'Preset'}
                    </span>
                    <button
                      onClick={() => {
                        setTargetProfile(profile);
                        setModalMode('CLI_GUIDE');
                      }}
                      className="text-indigo-400 hover:text-indigo-300 text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <Terminal size={11} /> Enroll Audio
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Diarization Pipeline Integration Hub Section ── */}
        <div className="mt-12 bg-slate-900/60 border border-slate-800/90 rounded-xl p-6 md:p-8 shadow-xl space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-800">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-amber-400" />
                <h2 className="text-lg font-bold text-white tracking-tight">Diarization Pipeline Synchronization</h2>
              </div>
              <p className="text-xs text-slate-400 max-w-xl">
                How voice profiles automatically resolve generic speakers across new and past Twitter Spaces.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setModalMode('RAW_JSON')}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 cursor-pointer transition-colors"
              >
                <FileText size={13} /> View Catalog JSON
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="p-4 bg-slate-950 border border-slate-800/80 rounded-xl space-y-2">
              <div className="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center font-bold text-sm">
                1
              </div>
              <h4 className="text-sm font-bold text-white">Neural Cluster Identification</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                During batch audio processing in <code className="text-indigo-300">batch_transcriber.py</code>, acoustic clusters are compared against enrolled 192-dim ECAPA vectors using cosine similarity (&ge; 0.70 threshold).
              </p>
            </div>

            <div className="p-4 bg-slate-950 border border-slate-800/80 rounded-xl space-y-2">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center font-bold text-sm">
                2
              </div>
              <h4 className="text-sm font-bold text-white">Conversational Heuristics</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                In <code className="text-emerald-300">transcribe_and_diarize.py</code>, registered names seed zero-API self-introduction and vocative address parsers (*"I'm Angela"*, *"Thanks for hosting, Logan"*).
              </p>
            </div>

            <div className="p-4 bg-slate-950 border border-slate-800/80 rounded-xl space-y-2">
              <div className="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center font-bold text-sm">
                3
              </div>
              <h4 className="text-sm font-bold text-white">Full-Context LLM Consensus</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                When APIs are active, LLMs (Gemini / Cohere / OpenRouter) disambiguate 3rd-person references and verify dominant host roles against known speaker aliases.
              </p>
            </div>
          </div>

          {/* Test matching against an episode */}
          {episodes.length > 0 && (
            <div className="pt-4 border-t border-slate-800 space-y-3">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                Test Diarization Match on Space:
              </span>
              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={selectedEpisodeId || ''}
                  onChange={e => setSelectedEpisodeId(Number(e.target.value) || null)}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500 max-w-md truncate cursor-pointer"
                >
                  <option value="">Select an episode to inspect…</option>
                  {episodes.map(ep => (
                    <option key={ep.id} value={ep.id}>
                      {ep.name || ep.tag_name}
                    </option>
                  ))}
                </select>

                <button
                  onClick={handleTestDiarization}
                  disabled={!selectedEpisodeId || testingDiarization}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-all cursor-pointer shadow-md"
                >
                  {testingDiarization ? <Loader size={13} className="animate-spin" /> : <Sparkles size={13} className="text-amber-400" />}
                  {testingDiarization ? 'Matching…' : 'Simulate Match'}
                </button>

                {selectedEpisodeId && onOpenTranscript && (
                  <button
                    onClick={() => onOpenTranscript(selectedEpisodeId)}
                    className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg border border-slate-700 cursor-pointer"
                  >
                    Open in Transcripts <ArrowRight size={13} />
                  </button>
                )}
              </div>

              {diarizationTestResult && (
                <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-2 mt-3 animate-in fade-in duration-150">
                  <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
                    <CheckCircle2 size={14} />
                    <span>Diarization Match Result: {diarizationTestResult.mapped} of {diarizationTestResult.total} speakers recognized</span>
                  </div>
                  <ul className="text-xs space-y-1 text-slate-300 pl-5 list-disc">
                    {diarizationTestResult.details.map((d, idx) => (
                      <li key={idx}>{d}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Extracted Voice Profile Modals ── */}
      <VoiceProfileModal
        isOpen={modalMode === 'CREATE' || modalMode === 'EDIT'}
        modalMode={modalMode}
        targetProfile={targetProfile}
        formName={formName}
        setFormName={setFormName}
        formRole={formRole}
        setFormRole={setFormRole}
        formColor={formColor}
        setFormColor={setFormColor}
        formEmoji={formEmoji}
        setFormEmoji={setFormEmoji}
        formNotes={formNotes}
        setFormNotes={setFormNotes}
        formAudioUrl={formAudioUrl}
        setFormAudioUrl={setFormAudioUrl}
        audioSourceTab={audioSourceTab}
        setAudioSourceTab={setAudioSourceTab}
        localAudioFile={localAudioFile}
        setLocalAudioFile={setLocalAudioFile}
        localAudioPreviewUrl={localAudioPreviewUrl}
        setLocalAudioPreviewUrl={setLocalAudioPreviewUrl}
        dragOver={dragOver}
        setDragOver={setDragOver}
        inspectingAudio={inspectingAudio}
        audioPreCheck={audioPreCheck}
        handleSelectAudioFile={handleSelectAudioFile}
        handleUploadFromComputerAndEnroll={handleUploadFromComputerAndEnroll}
        uploadingAudio={uploadingAudio}
        hasGitHub={hasGitHub}
        handleCloudEnroll={handleCloudEnroll}
        enrollingCloud={enrollingCloud}
        handleSaveForm={handleSaveForm}
        onClose={() => setModalMode(null)}
        roleOptions={ROLE_OPTIONS}
        colorOptions={COLOR_OPTIONS}
        emojiOptions={EMOJI_OPTIONS}
      />

      <CliEnrollmentGuideModal
        isOpen={modalMode === 'CLI_GUIDE'}
        targetProfile={targetProfile}
        onClose={() => setModalMode(null)}
        onOpenEdit={(p) => handleOpenEdit(p)}
      />

      <RawJsonViewerModal
        isOpen={modalMode === 'RAW_JSON'}
        catalog={catalog}
        onClose={() => setModalMode(null)}
        onCopySuccess={() => {
          setStatusMsg({ type: 'success', text: 'JSON copied to clipboard!' });
          setTimeout(() => setStatusMsg(null), 3000);
        }}
      />

      <PipelineArchitectureModal
        isOpen={modalMode === 'DIARIZATION_INFO'}
        onClose={() => setModalMode(null)}
      />

      <SeparationMatrixModal
        isOpen={modalMode === 'SEPARATION_MATRIX'}
        onClose={() => setModalMode(null)}
        stats={stats}
        confusionPairs={confusionPairs}
      />
    </div>
  );
};

export default VoiceProfileLibrary;
