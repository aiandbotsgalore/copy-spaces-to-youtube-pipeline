import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  AudioWaveform, Plus, Search, Filter, Sparkles, Check, X, Save, Loader, AlertCircle, CheckCircle2, Trash2,
  Edit3, ExternalLink, Download, Upload, RefreshCw, Users, HelpCircle, Camera, Bot
} from 'lucide-react';
import { EnhancedConfig, VoiceProfile, VoiceProfilesCatalog, VoiceSample, Release, DeadLetterJob } from '../types';
import { useCopilot } from '../contexts/CopilotContext';
import { readRepositoryTextFile, writeRepositoryTextFile, writeRepositoryBinaryFile, getReleases, dispatchWorkflow } from '../utils/github';
import { loadDeadLetterQueue, saveDeadLetterQueue, removeFromDeadLetterQueue } from '../utils/storage';
import { VoiceSamples } from './voice/VoiceSamples';
import { VoiceSampleEditor } from './voice/VoiceSampleEditor';
import { getVoiceSamples, updateVoiceSamples, updateVoiceProfile, readVoiceCatalog, mergeVoiceCatalog,
  voiceMatchingStatus, getConfirmationCounts, VOICE_CATALOG_KEY } from '../utils/voiceProfiles';
import { VoiceProfileModal } from './voice/VoiceProfileModal';
import { RawJsonViewerModal } from './voice/RawJsonViewerModal';
import { PipelineArchitectureModal } from './voice/PipelineArchitectureModal';
import { SeparationMatrixModal } from './voice/SeparationMatrixModal';
import { DiscoveredCandidatesModal } from './voice/DiscoveredCandidatesModal';
import { resizeImageToDataUrl } from '../utils/imageResize';
import { AvatarCropModal } from './AvatarCropModal';

interface Props {
  config: EnhancedConfig;
  onOpenTranscript?: (releaseId: number | string, seconds?: number) => void;
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
  const catalogRef = useRef(catalog);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [sampleFilter, setSampleFilter] = useState<'ALL' | 'WITH_SAMPLES' | 'WITHOUT_SAMPLES'>('ALL');
  const [sortBy, setSortBy] = useState<'name' | 'samples' | 'updated'>('samples');

  const [savingGitHub, setSavingGitHub] = useState(false);
  const [retryingDlqId, setRetryingDlqId] = useState<string | null>(null);
  const [dlqList, setDlqList] = useState<DeadLetterJob[]>(() => loadDeadLetterQueue());
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modals
  const [modalMode, setModalMode] = useState<'CREATE' | 'EDIT' | 'DIARIZATION_INFO' | 'RAW_JSON' | 'SEPARATION_MATRIX' | 'CANDIDATES' | null>(null);
  const [targetProfile, setTargetProfile] = useState<VoiceProfile | null>(null);
  const [targetProfileId, setTargetProfileId] = useState<string | null>(null);
  const [sampleEditor, setSampleEditor] = useState<{ id: string; sample?: VoiceSample; suggested?: VoiceSample } | null>(null);
  const [suggestedSample, setSuggestedSample] = useState<VoiceSample>();
  const [sampleFeedback, setSampleFeedback] = useState<{ id: string; text: string } | null>(null);
  const [preparationRequested, setPreparationRequested] = useState<string | null>(null);

  // Form State
  const [formName, setFormName] = useState('');
  const [formRole, setFormRole] = useState('Speaker');
  const [formColor, setFormColor] = useState('indigo');
  const [formEmoji, setFormEmoji] = useState('🎙️');
  const [formNotes, setFormNotes] = useState('');
  const [formPaused, setFormPaused] = useState(false);
  const [formError, setFormError] = useState('');

  const [episodes, setEpisodes] = useState<Release[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(true);
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
          if (remoteJson?.profiles) {
            const publicProfiles = loadedData?.profiles;
            if (publicProfiles) {
              for (const [id, profile] of Object.entries<VoiceProfile>(remoteJson.profiles)) {
                const publicAudio = publicProfiles[id]?.sample_audio_url;
                if (!profile.samples && !profile.sample_audio_url && publicAudio) profile.sample_audio_url = publicAudio;
              }
            }
            loadedData = remoteJson;
          }
        }
      } catch {
        // ignore
      }
    }

    const merged = mergeVoiceCatalog(loadedData || DEFAULT_CATALOG, readVoiceCatalog());

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

    catalogRef.current = merged;
    setCatalog(merged);
    setLoading(false);
  }, [hasGitHub, config.githubToken, owner, repo]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    let current = true;
    setEpisodes([]);
    if (!owner || !repo) {
      setEpisodesLoading(false);
      return;
    }
    setEpisodesLoading(true);
    getReleases(config.githubToken, owner, repo)
      .then(results => { if (current) setEpisodes(results); })
      .catch(() => {})
      .finally(() => { if (current) setEpisodesLoading(false); });
    return () => { current = false; };
  }, [config.githubToken, owner, repo]);

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
      const p = catalog.profiles[speakerName];
      const nextCatalog = p ? updateVoiceProfile(catalog, speakerName, { ...p, avatar_url: dataUrl }) : catalog;
      if (p) saveCatalogLocal(nextCatalog);

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
            const withAvatar = updateVoiceProfile(nextCatalog, speakerName, { ...p, avatar_url: rawUrl });
            saveCatalogLocal(withAvatar);
            const content = JSON.stringify(withAvatar, null, 2);
            await writeRepositoryTextFile(
              config.githubToken,
              owner,
              repo,
              'voice_profiles.json',
              content,
              `chore(profiles): update avatar_url for ${speakerName}`,
              'master'
            );
            try {
              await writeRepositoryTextFile(
                config.githubToken,
                owner,
                repo,
                'public/voice_profiles.json',
                content,
                `chore(profiles): sync public/voice_profiles.json for ${speakerName}`,
                'master'
              );
            } catch {
              // optional secondary sync
            }
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
    catalogRef.current = next;
    setCatalog(next);
    try {
      localStorage.setItem(VOICE_CATALOG_KEY, JSON.stringify(next));
    } catch {
      return false;
    }
    try {
      // Also sync to spacepipe_saved_speakers for TranscriptPanel compatibility
      const savedSpeakersList = Object.entries(next.profiles).map(([id, p]) => ({
        id,
        voiceProfileId: id,
        name: p.name,
        role: p.role || 'Speaker',
        avatarEmoji: p.avatar_emoji || '🎙️',
        color: p.color || 'indigo',
      }));
      localStorage.setItem('spacepipe_saved_speakers', JSON.stringify(savedSpeakersList));
    } catch {
      // The profile catalog is already saved.
    }
    return true;
  };

  const syncCatalog = async () => {
    const remote = await readRepositoryTextFile(config.githubToken, owner, repo, 'voice_profiles.json', 'master');
    const local = catalogRef.current;
    const next = remote?.content ? mergeVoiceCatalog(JSON.parse(remote.content), local) : local;
    const content = JSON.stringify(next, null, 2);
    await writeRepositoryTextFile(config.githubToken, owner, repo, 'voice_profiles.json', content,
      'chore(profiles): update voice profiles', 'master');
    saveCatalogLocal(mergeVoiceCatalog(next, catalogRef.current));
    try {
      await writeRepositoryTextFile(config.githubToken, owner, repo, 'public/voice_profiles.json', content,
        'chore(profiles): sync public voice profiles', 'master');
    } catch {
      // Enrollment and matching use the root catalog.
    }
  };

  const handleSaveToGitHub = async () => {
    if (!hasGitHub) return;
    setSavingGitHub(true);
    setStatusMsg(null);
    try {
      await syncCatalog();
      setStatusMsg({ type: 'success', text: 'Voice profiles synced to GitHub.' });
    } catch (err) {
      setStatusMsg({ type: 'error', text: `Couldn’t sync profiles: ${(err as Error).message}` });
    } finally {
      setSavingGitHub(false);
    }
  };

  const enrollSavedSample = async (id: string, sample: VoiceSample) => {
    setSavingGitHub(true);
    try {
      await syncCatalog();
      const profile = catalogRef.current.profiles[id];
      const saved = profile && getVoiceSamples(profile).find(item => item.id === sample.id);
      if (!saved || saved.audio_url !== sample.audio_url || saved.start_sec !== sample.start_sec || saved.end_sec !== sample.end_sec) {
        throw new Error('This sample changed while syncing. Open it again before preparing the voice.');
      }
      const start = sample.start_sec ?? 0;
      await dispatchWorkflow(config.githubToken, owner, repo, 'enroll_voice.yml', {
        speaker_name: id,
        role: profile.role || 'Speaker',
        audio_url: sample.audio_url,
        sample_id: sample.id,
        ...(sample.end_sec === undefined ? {} : { segments_json: JSON.stringify([{ start, duration: sample.end_sec - start }]) }),
      });
      setPreparationRequested(id);
      setSampleFeedback({ id, text: 'Clip sent for preparation. Check matching status after it finishes.' });
    } catch (err) {
      setSampleFeedback({ id, text: `Couldn’t prepare the voice: ${(err as Error).message}` });
    } finally {
      setSavingGitHub(false);
    }
  };

  const handleOpenCreate = () => {
    setTargetProfile(null);
    setTargetProfileId(null);
    setFormName('');
    setFormRole('Speaker');
    setFormColor('indigo');
    setFormEmoji('🎙️');
    setFormNotes('');
    setFormPaused(false);
    setFormError('');
    setSuggestedSample(undefined);
    setModalMode('CREATE');
  };

  const handleOpenEdit = (id: string, profile: VoiceProfile) => {
    setTargetProfile(profile);
    setTargetProfileId(id);
    setFormName(profile.name);
    setFormRole(profile.role || 'Speaker');
    setFormColor(profile.color || 'indigo');
    setFormEmoji(profile.avatar_emoji || '🎙️');
    setFormNotes(profile.notes || '');
    setFormPaused(profile.suggestions_paused === true);
    setFormError('');
    setModalMode('EDIT');
  };

  const handleSaveForm = () => {
    const name = formName.trim();
    if (!name) return;
    const latest = catalogRef.current;
    const existingId = Object.entries(latest.profiles).find(([, profile]) => profile.name.toLowerCase() === name.toLowerCase())?.[0];
    if (existingId && existingId !== targetProfileId) {
      setFormError('A profile already uses this name. Open that profile to add a sample.');
      return;
    }
    const id = targetProfileId ?? (Object.hasOwn(latest.profiles, name) || Object.hasOwn(latest.removed_profiles ?? {}, name) ? crypto.randomUUID() : name);
    const previous = latest.profiles[id];
    const profile: VoiceProfile = {
      ...previous,
      name,
      role: formRole,
      color: formColor,
      avatar_emoji: formEmoji,
      notes: formNotes,
      suggestions_paused: formPaused || previous?.suggestions_paused ? formPaused : undefined,
    };
    const saved = saveCatalogLocal(updateVoiceProfile(latest, id, profile));
    setModalMode(null);
    if (!saved) setStatusMsg({ type: 'error', text: 'Browser storage is unavailable. This change is available for this session only.' });
    if (targetProfileId) {
      if (saved) setSampleFeedback({ id, text: 'Profile saved in this browser.' });
    } else {
      setSearch('');
      setRoleFilter('ALL');
      setSampleFilter('ALL');
      setSampleEditor({ id, suggested: suggestedSample });
    }
  };

  const updateSamples = (id: string, samples: VoiceSample[], success: string) => {
    const latest = catalogRef.current;
    const previous = latest.profiles[id];
    if (!previous) return;
    const updated = updateVoiceSamples(previous, samples);
    const saved = saveCatalogLocal(updateVoiceProfile(latest, id, updated));
    setSampleFeedback({ id, text: saved ? success : 'Browser storage is unavailable. This change is available for this session only.' });
  };

  const handleDeleteProfile = (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete the voice profile for "${name}"?`)) return;

    const now = new Date().toISOString();
    const nextCatalog: VoiceProfilesCatalog = {
      ...catalog,
      updated_at: now,
      profiles: { ...catalog.profiles },
      removed_profiles: { ...catalog.removed_profiles, [id]: now },
    };
    delete nextCatalog.profiles[id];
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
    let list = Object.entries(catalog.profiles);

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(([, p]) =>
        p.name.toLowerCase().includes(q) ||
        (p.role && p.role.toLowerCase().includes(q)) ||
        (p.notes && p.notes.toLowerCase().includes(q))
      );
    }

    // Role filter
    if (roleFilter !== 'ALL') {
      list = list.filter(([, p]) => p.role === roleFilter);
    }

    // Embedding filter
    if (sampleFilter === 'WITH_SAMPLES') {
      list = list.filter(([, p]) => getVoiceSamples(p).length > 0);
    } else if (sampleFilter === 'WITHOUT_SAMPLES') {
      list = list.filter(([, p]) => getVoiceSamples(p).length === 0);
    }

    // Sort
    list.sort(([, a], [, b]) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'samples') return getVoiceSamples(b).length - getVoiceSamples(a).length;
      if (sortBy === 'updated') {
        const tA = a.last_updated ? new Date(a.last_updated).getTime() : 0;
        const tB = b.last_updated ? new Date(b.last_updated).getTime() : 0;
        return tB - tA;
      }
      return 0;
    });

    return list;
  }, [catalog, search, roleFilter, sampleFilter, sortBy]);

  // Statistics
  const stats = useMemo(() => {
    const all: VoiceProfile[] = Object.values<VoiceProfile>(catalog.profiles || {});
    const enrolled = all.filter(p => p.embedding && p.embedding.length === 192);
    const pending = all.length - enrolled.length;
    return {
      total: all.length,
      enrolled: enrolled.length,
      pending,
      withSamples: all.filter(p => getVoiceSamples(p).length > 0).length,
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

  const uploadSample = async (id: string, file: File) => {
    if (!hasGitHub) throw new Error('Configure GitHub in Settings to upload recordings.');
    const filename = file.name.replace(/[^a-zA-Z0-9._ -]/g, '_');
    const folder = id.replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/^\.+$/, '_');
    const repoPath = `speaker_samples/${folder}/${crypto.randomUUID()}-${filename}`;
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('Couldn’t read this recording.'));
      reader.readAsDataURL(file);
    });
    await writeRepositoryBinaryFile(config.githubToken, owner, repo, repoPath, base64, 'feat(voice): add a voice sample', 'master');
    return repoPath;
  };

  const resolveSampleUrl = (url: string) => {
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    const clean = url.replace(/^\/+/, '');
    if (clean.startsWith('speaker_samples/')) {
      const encoded = clean.split('/').map(encodeURIComponent).join('/');
      // In local dev, use local byte-range streamer; on deployed web instances, use Cloudflare R2 CDN
      if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
        return `/${encoded}`;
      }
      return `https://pub-b492226ab4ed45d692e9f14794366106.r2.dev/${encoded}`;
    }
    if (url.startsWith('/')) return url;
    if (!owner || !repo) return `/${clean.split('/').map(encodeURIComponent).join('/')}`;
    const path = clean.split('/').map(encodeURIComponent).join('/');
    return `https://raw.githubusercontent.com/${owner}/${repo}/master/${path}`;
  };

  const confirmations = getConfirmationCounts();

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
              <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight">Voice Profiles</h1>
            </div>
            <p className="text-xs text-slate-400 max-w-2xl">
              Pick a person to listen to their clips or add a voice sample.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleOpenCreate}
              className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800"
            >
              <Plus size={15} /> Add a person
            </button>

            <details className="relative">
              <summary className="cursor-pointer rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200">More tools</summary>
              <div className="absolute right-0 top-full z-30 mt-2 flex w-56 flex-col gap-2 rounded-xl border border-slate-700 bg-slate-950 p-2 shadow-xl">
            <button
              onClick={handleSaveToGitHub}
              disabled={savingGitHub || !hasGitHub}
              title={hasGitHub ? 'Apply profile changes to cloud processing' : 'Connect GitHub in Settings to sync'}
              className="flex items-center gap-2 px-3.5 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 disabled:opacity-40 text-emerald-300 border border-emerald-500/40 rounded-lg text-xs font-bold transition-all cursor-pointer shadow-sm"
            >
              {savingGitHub ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
              {savingGitHub ? 'Syncing…' : 'Sync to GitHub'}
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
              onClick={() => setModalMode('CANDIDATES')}
              className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600/15 hover:bg-indigo-600/25 text-indigo-300 border border-indigo-500/30 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              title="Review recurring unassigned speakers discovered across archive transcripts"
            >
              <Users size={14} className="text-indigo-400" />
              <span>Discovered Candidates</span>
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
            </details>
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
          <div className="flex min-w-0 grow basis-[28rem] flex-wrap items-center gap-3">
            <div className="relative min-w-[11rem] flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                aria-label="Find a person"
                placeholder="Find a person"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-8 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
              {search && (
                <button aria-label="Clear person search" onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Embedding filter */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
              <button
                onClick={() => setSampleFilter('ALL')}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                  sampleFilter === 'ALL' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                All ({stats.total})
              </button>
              <button
                onClick={() => setSampleFilter('WITH_SAMPLES')}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                  sampleFilter === 'WITH_SAMPLES' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Has samples ({stats.withSamples})
              </button>
              <button
                onClick={() => setSampleFilter('WITHOUT_SAMPLES')}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                  sampleFilter === 'WITHOUT_SAMPLES' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                No samples ({stats.total - stats.withSamples})
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
              {Object.keys(catalog.profiles).length ? 'Try a different name or clear the filters.' : 'Add a person, then choose a short clip of them speaking.'}
            </p>
            {Object.keys(catalog.profiles).length ? (
              <button type="button" className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold"
                onClick={() => { setSearch(''); setRoleFilter('ALL'); setSampleFilter('ALL'); }}>Clear filters</button>
            ) : (
              <button type="button" className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white" onClick={handleOpenCreate}>Add a person</button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {profileList.map(([id, profile]) => {
              const samples = getVoiceSamples(profile);
              const matching = voiceMatchingStatus(profile);
              const confirmed = confirmations.get(id) ?? 0;
              const requested = preparationRequested === id && matching === 'needs-preparation';
              const colorTheme = COLOR_OPTIONS.find(c => c.id === profile.color) || COLOR_OPTIONS[0];

              return (
                <div
                  key={id}
                  className="group self-start space-y-3 rounded-xl border border-slate-800 bg-slate-900/70 p-4 transition-colors hover:border-slate-700"
                >
                    {/* Card Header: Avatar, Name, Role */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-13 h-13 rounded-2xl flex items-center justify-center text-xl shadow-md border ${colorTheme.badge} flex-shrink-0 group-hover:scale-105 transition-transform overflow-hidden relative group/avatar bg-slate-950`}>
                          <span aria-hidden="true">{profile.avatar_emoji || '🎙️'}</span>
                          <img src={profile.avatar_url || getDefaultSpeakerAvatar(profile.name)} alt=""
                            className="absolute inset-0 h-full w-full object-cover"
                            onError={event => { event.currentTarget.style.display = 'none'; }} />
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
                              onChange={(e) => handleUploadSpeakerAvatar(id, e.target.files?.[0])}
                            />
                          </label>
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-base font-bold text-white truncate tracking-tight">{profile.name}</h3>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-semibold border border-slate-700">
                              {profile.role || 'Speaker'}
                            </span>
                            {samples.length > 0 && (
                              <span className="text-[11px] text-slate-400 font-mono">
                                {samples.length} saved sample{samples.length !== 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Top Action Buttons */}
                      <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleOpenEdit(id, profile)}
                          className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                          title="Edit Profile"
                          aria-label={`Edit profile for ${profile.name}`}
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          onClick={() => handleDeleteProfile(id, profile.name)}
                          className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                          title="Delete Profile"
                          aria-label={`Delete profile for ${profile.name}`}
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

                    <div className="space-y-1">
                      {matching === 'empty' && <p className="text-sm text-slate-300">Add a short clip of {profile.name} speaking alone.</p>}
                      {matching === 'needs-preparation' && (
                        <>
                          <p className="text-sm font-medium text-slate-200">{requested ? 'Preparation requested' : 'Matching needs setup'}</p>
                          {!requested && <p className="text-xs text-slate-400">{hasGitHub
                            ? 'Open a saved sample and choose Prepare voice.'
                            : 'Connect GitHub in Settings to prepare this voice for matching.'}</p>}
                        </>
                      )}
                      {matching === 'needs-verification' && (
                        <>
                          <p className="text-sm font-medium text-slate-200">Voice check needed</p>
                          <p className="text-xs text-slate-400">The clip was prepared. A person needs to verify whose voice it is before it can be used for matching.</p>
                        </>
                      )}
                      {matching === 'ready' && <p className="text-sm font-medium text-emerald-300">Ready for voice matching</p>}
                      {matching === 'paused' && <p className="text-sm font-medium text-slate-200">Suggestions paused <button type="button"
                        className="ml-1 text-xs text-indigo-300 underline" onClick={() => handleOpenEdit(id, profile)}>Edit setting</button></p>}
                      {confirmed > 0 && <p className="text-xs text-slate-400">Names confirmed in {confirmed} episode{confirmed === 1 ? '' : 's'}</p>}
                      {(requested || matching === 'needs-verification') && hasGitHub && (
                        <button type="button" disabled={loading || savingGitHub}
                          className="text-xs font-semibold text-indigo-300 underline disabled:opacity-50"
                          onClick={() => { void loadCatalog(); }}>Check matching status</button>
                      )}
                      {sampleFeedback?.id === id && <p role="status" className="text-xs text-slate-200">{sampleFeedback.text}</p>}
                    </div>
                    <VoiceSamples
                      profile={profile}
                      resolveUrl={resolveSampleUrl}
                      onEdit={sample => setSampleEditor({ id, sample })}
                      onRemove={sample => {
                        const current = catalogRef.current.profiles[id];
                        if (current) updateSamples(id, getVoiceSamples(current).filter(item => item.id !== sample.id), 'Sample removed.');
                      }}
                      onPrepare={hasGitHub && !savingGitHub && matching === 'needs-preparation'
                        ? sample => enrollSavedSample(id, sample) : undefined}
                      onOpenEpisode={onOpenTranscript}
                    />
                </div>
              );
            })}
          </div>
        )}


      </div>

      {/* ── Extracted Voice Profile Modals ── */}
      {(modalMode === 'CREATE' || modalMode === 'EDIT') && (
        <VoiceProfileModal
          creating={modalMode === 'CREATE'}
          name={formName} setName={setFormName}
          role={formRole} setRole={setFormRole}
          color={formColor} setColor={setFormColor}
          emoji={formEmoji} setEmoji={setFormEmoji}
          notes={formNotes} setNotes={setFormNotes}
          canPause={!!targetProfile && (targetProfile.suggestions_paused === true || voiceMatchingStatus(targetProfile) === 'ready')}
          paused={formPaused} setPaused={setFormPaused}
          hasGitHub={hasGitHub} error={formError} onSave={handleSaveForm} onClose={() => setModalMode(null)}
          roleOptions={ROLE_OPTIONS} colorOptions={COLOR_OPTIONS} emojiOptions={EMOJI_OPTIONS}
        />
      )}

      {sampleEditor && catalog.profiles[sampleEditor.id] && (
        <VoiceSampleEditor
          name={catalog.profiles[sampleEditor.id].name}
          episodes={episodes} episodesLoading={episodesLoading}
          resolveUrl={resolveSampleUrl} canUpload={hasGitHub}
          sample={sampleEditor.sample} suggested={sampleEditor.suggested}
          onUpload={file => uploadSample(sampleEditor.id, file)}
          onClose={() => setSampleEditor(null)}
          onSave={sample => {
            const current = catalogRef.current.profiles[sampleEditor.id];
            if (!current) { setSampleEditor(null); return; }
            const samples = getVoiceSamples(current);
            const trim = sampleEditor.sample;
            updateSamples(sampleEditor.id, trim ? samples.map(item => item.id === trim.id ? sample : item) : [...samples, sample],
              trim ? 'Trim saved in this browser.' : 'Voice sample saved in this browser.');
            setSampleEditor(null);
            if (trim) setPreparationRequested(previous => previous === sampleEditor.id ? null : previous);
          }}
        />
      )}

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

      <DiscoveredCandidatesModal
        isOpen={modalMode === 'CANDIDATES'}
        onClose={() => setModalMode(null)}
        onEnrollCandidate={candidate => {
          handleOpenCreate();
          setFormName(candidate.suggested_name !== 'Unidentified Speaker' ? candidate.suggested_name : '');
          setFormRole('Special Guest');
          setFormNotes(`Found in ${candidate.episode_count} episodes.`);
          const clip = candidate.sample_clips?.[0];
          if (clip?.audio_url) setSuggestedSample({
            id: crypto.randomUUID(), source: 'episode', audio_url: clip.audio_url, release_tag: clip.episode_tag,
            start_sec: clip.start, end_sec: clip.end,
          });
        }}
      />
    </div>
  );
};

export default VoiceProfileLibrary;
