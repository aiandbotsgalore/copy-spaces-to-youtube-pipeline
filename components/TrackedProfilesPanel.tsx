import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Radio,
  CheckCircle2,
  AlertTriangle,
  Clock,
  RefreshCw,
  ExternalLink,
  Search,
  UserCheck,
  ShieldCheck,
  Sparkles,
  Filter,
  Plus,
  Volume2,
  Mic,
  Eye,
  Check,
  Info,
} from 'lucide-react';
import { EnhancedConfig, WorkflowRun } from '../types';
import { dispatchWorkflow } from '../utils/github';
import { friendlyGitHubError } from '../utils/submitSpace';
import { useWorkflowRuns, isActiveRun } from '../hooks/useWorkflowRuns';

export interface TrackedProfileItem {
  id: string;
  handle: string;
  displayName: string;
  role: string;
  avatarEmoji: string;
  color: string;
  isCoreHost?: boolean;
  watchSources: Array<'x-timeline' | 'spacesdashboard'>;
  pollSchedule: string;
  voiceProfileKey?: string;
  custom?: boolean;
}

// Authoritative tracked accounts for SpacePipe auto-detection & SpacesDashboard sync
export const BASE_TRACKED_PROFILES: TrackedProfileItem[] = [
  {
    id: 'angela',
    handle: 'AngelaMaggard3',
    displayName: 'Angela Maggard',
    role: 'Primary Subject / Space Host',
    avatarEmoji: '🌸',
    color: 'pink',
    isCoreHost: true,
    watchSources: ['x-timeline', 'spacesdashboard'],
    pollSchedule: 'Every 2 hrs (Cron :13) + SpacesDashboard (Every 6 hrs)',
    voiceProfileKey: 'Angela',
  },
  {
    id: 'logan',
    handle: 'LoganBlack',
    displayName: 'Logan Black',
    role: 'First-Person Narrator / Host',
    avatarEmoji: '🎙️',
    color: 'indigo',
    isCoreHost: true,
    watchSources: ['x-timeline'],
    pollSchedule: 'Every 2 hrs (Cron :13)',
    voiceProfileKey: 'Logan',
  },
  {
    id: 'shane',
    handle: 'TurtleOfTime12',
    displayName: 'Shane / Turtle of Time',
    role: 'Co-Host / Space Participant',
    avatarEmoji: '🔥',
    color: 'amber',
    isCoreHost: true,
    watchSources: ['x-timeline'],
    pollSchedule: 'Every 2 hrs (Cron :13)',
    voiceProfileKey: 'Shane',
  },
  {
    id: 'oor',
    handle: 'Oor',
    displayName: 'Oor',
    role: 'Featured Speaker / Space Host',
    avatarEmoji: '⚡',
    color: 'sky',
    isCoreHost: true,
    watchSources: ['x-timeline'],
    pollSchedule: 'Every 2 hrs (Cron :13)',
    voiceProfileKey: 'Oor',
  },
  {
    id: 'mary',
    handle: 'txrrxstrxxl',
    displayName: 'Mary / txrrxstrxxl',
    role: 'Co-Host / Space Host',
    avatarEmoji: '👩‍🎨',
    color: 'purple',
    isCoreHost: true,
    watchSources: ['x-timeline'],
    pollSchedule: 'Every 2 hrs (Cron :13)',
    voiceProfileKey: 'Mary',
  },
  {
    id: 'god-sauce',
    handle: 'GodSawUs',
    displayName: 'God Sauce',
    role: 'Special Guest / Broadcaster',
    avatarEmoji: '✨',
    color: 'amber',
    watchSources: ['x-timeline'],
    pollSchedule: 'Every 2 hrs (Cron :13)',
    voiceProfileKey: 'God Sauce',
  },
  {
    id: 'eric-hecker',
    handle: 'erichecker',
    displayName: 'Eric Hecker',
    role: 'Special Guest',
    avatarEmoji: '🛸',
    color: 'emerald',
    watchSources: ['x-timeline'],
    pollSchedule: 'Every 2 hrs (Cron :13)',
    voiceProfileKey: 'Eric Hecker',
  },
  {
    id: 'rick-doty',
    handle: 'rickdoty',
    displayName: 'Rick Doty',
    role: 'Special Guest / Researcher',
    avatarEmoji: '🛸',
    color: 'emerald',
    watchSources: ['x-timeline'],
    pollSchedule: 'Every 2 hrs (Cron :13)',
    voiceProfileKey: 'Rick Doty',
  },
  {
    id: 'rose',
    handle: 'Rose',
    displayName: 'Rose',
    role: 'Speaker / Recurring Participant',
    avatarEmoji: '🌹',
    color: 'rose',
    watchSources: ['x-timeline'],
    pollSchedule: 'Every 2 hrs (Cron :13)',
    voiceProfileKey: 'Rose',
  },
  {
    id: 'kimball',
    handle: 'UFOkimball',
    displayName: 'Kimball',
    role: 'UFO X Researcher / Host',
    avatarEmoji: '🔭',
    color: 'cyan',
    watchSources: ['x-timeline'],
    pollSchedule: 'Every 2 hrs (Cron :13)',
  },
  {
    id: 'gabe',
    handle: 'Gabe_Trust',
    displayName: 'Gabe',
    role: 'Space Host / Participant',
    avatarEmoji: '🛡️',
    color: 'teal',
    watchSources: ['x-timeline'],
    pollSchedule: 'Every 2 hrs (Cron :13)',
  },
  {
    id: 'kaalos',
    handle: 'Kaalos_',
    displayName: 'Kaalos',
    role: 'Space Host / Participant',
    avatarEmoji: '🪐',
    color: 'blue',
    watchSources: ['x-timeline'],
    pollSchedule: 'Every 2 hrs (Cron :13)',
  },
  {
    id: 'shadow-nexus',
    handle: 'shdw_nxs',
    displayName: 'Shadow Nexus',
    role: 'Space Host / Broadcaster',
    avatarEmoji: '🌑',
    color: 'violet',
    watchSources: ['x-timeline'],
    pollSchedule: 'Every 2 hrs (Cron :13)',
  },
  {
    id: 'deciphering-tv',
    handle: 'DecipheringTV',
    displayName: 'Deciphering TV',
    role: 'Media Producer / Broadcaster',
    avatarEmoji: '📡',
    color: 'emerald',
    watchSources: ['x-timeline'],
    pollSchedule: 'Every 2 hrs (Cron :13)',
  },
  {
    id: 'red-panda-koala',
    handle: 'RedPandaKoala',
    displayName: 'Red Panda Koala',
    role: 'Documentary Filmmaker',
    avatarEmoji: '🐨',
    color: 'rose',
    watchSources: ['x-timeline'],
    pollSchedule: 'Every 2 hrs (Cron :13)',
  },
  {
    id: 'tupacabra',
    handle: 'tupacabra',
    displayName: 'Tupacabra',
    role: 'Space Host / Broadcaster',
    avatarEmoji: '🐺',
    color: 'violet',
    watchSources: ['x-timeline'],
    pollSchedule: 'Every 2 hrs (Cron :13)',
  },
  {
    id: 'stop-the-madness',
    handle: 'StopTehMadness',
    displayName: 'Stop The Madness',
    role: 'Space Host / Broadcaster',
    avatarEmoji: '🛑',
    color: 'rose',
    watchSources: ['x-timeline'],
    pollSchedule: 'Every 2 hrs (Cron :13)',
  },
  {
    id: 'steve',
    handle: 'YOIMSTEVE_',
    displayName: 'Steve',
    role: 'Space Participant',
    avatarEmoji: '🧢',
    color: 'sky',
    watchSources: ['x-timeline'],
    pollSchedule: 'Every 2 hrs (Cron :13)',
  },
];

interface VoiceProfileData {
  name: string;
  role?: string;
  identity_verified?: boolean;
  sample_audio_url?: string;
  embedding?: number[];
  notes?: string;
}

interface VoiceProfilesCatalogJson {
  version?: string;
  profiles: Record<string, VoiceProfileData>;
}

interface Props {
  config: EnhancedConfig;
  onNavigateVoiceProfiles?: () => void;
  onSelectHandleForIngest?: (handle: string) => void;
  onUpdateWatchedHosts?: (hosts: string[]) => void;
}

function timeAgo(dateString?: string): string {
  if (!dateString) return 'Never';
  const now = Date.now();
  const past = new Date(dateString).getTime();
  if (isNaN(past)) return 'Recently';
  const diffSec = Math.max(0, Math.floor((now - past) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

export const TrackedProfilesPanel: React.FC<Props> = ({
  config,
  onNavigateVoiceProfiles,
  onSelectHandleForIngest,
  onUpdateWatchedHosts,
}) => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'verified' | 'needs_audio' | 'watched_only'>('all');
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  // New handle quick addition
  const [newHandle, setNewHandle] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  // Local Voice Catalog data
  const [voiceCatalog, setVoiceCatalog] = useState<Record<string, VoiceProfileData>>({});
  const [catalogLoaded, setCatalogLoaded] = useState(false);

  // Workflow runs for checking real-time status and last run timestamps
  const { runs, loading: runsLoading, refresh: refreshRuns } = useWorkflowRuns(config);

  const owner = (config.ownerName || '').trim();
  const repo = (config.repoName || '').trim();
  const hasCredentials = !!(config.githubToken && owner && repo);

  // Load public/voice_profiles.json on mount
  useEffect(() => {
    let active = true;
    const fetchCatalog = async () => {
      try {
        const res = await fetch('/voice_profiles.json');
        if (res.ok) {
          const data = (await res.json()) as VoiceProfilesCatalogJson;
          if (active && data?.profiles) {
            setVoiceCatalog(data.profiles);
            setCatalogLoaded(true);
          }
        }
      } catch (err) {
        console.warn('Could not fetch /voice_profiles.json directly', err);
      }
    };
    fetchCatalog();
    return () => {
      active = false;
    };
  }, []);

  // Merge base profiles with any custom watchedHosts in config
  const profilesList = useMemo(() => {
    const list = [...BASE_TRACKED_PROFILES];
    const existingHandles = new Set(list.map(p => p.handle.toLowerCase()));

    if (config.watchedHosts && Array.isArray(config.watchedHosts)) {
      config.watchedHosts.forEach(h => {
        const clean = h.trim().replace(/^@/, '');
        if (clean && !existingHandles.has(clean.toLowerCase())) {
          existingHandles.add(clean.toLowerCase());
          list.push({
            id: `custom-${clean.toLowerCase()}`,
            handle: clean,
            displayName: `@${clean}`,
            role: 'Custom Tracked Account',
            avatarEmoji: '🛰️',
            color: 'indigo',
            watchSources: ['x-timeline'],
            pollSchedule: 'Every 2 hrs (Cron :13)',
            custom: true,
          });
        }
      });
    }

    return list;
  }, [config.watchedHosts]);

  // Extract latest auto-detect workflow runs
  const autoDetectRun = useMemo(() => {
    return runs.find(
      r =>
        r.name === 'Auto-Detect & Ingest Spaces' ||
        (r.path && r.path.includes('auto_detect_spaces.yml'))
    );
  }, [runs]);

  const spacesDashboardRun = useMemo(() => {
    return runs.find(
      r =>
        r.name === 'Sync SpacesDashboard Speaker Queue' ||
        (r.path && r.path.includes('spacesdashboard_sync.yml'))
    );
  }, [runs]);

  const isScanningNow = autoDetectRun ? isActiveRun(autoDetectRun) : scanning;

  // Determine App & Voice presence for each profile
  const profileDetails = useMemo(() => {
    return profilesList.map(profile => {
      let voiceData: VoiceProfileData | undefined;

      if (profile.voiceProfileKey && voiceCatalog[profile.voiceProfileKey]) {
        voiceData = voiceCatalog[profile.voiceProfileKey];
      } else {
        // Fallback fuzzy search by handle or displayName
        const matchKey = Object.keys(voiceCatalog).find(
          k =>
            k.toLowerCase() === profile.handle.toLowerCase() ||
            k.toLowerCase() === profile.displayName.toLowerCase()
        );
        if (matchKey) voiceData = voiceCatalog[matchKey];
      }

      const hasEmbedding =
        Array.isArray(voiceData?.embedding) && voiceData.embedding.length === 192;
      const hasSampleAudio = Boolean(voiceData?.sample_audio_url?.trim());
      const isVerified = voiceData?.identity_verified === true;

      let inAppStatus: 'verified' | 'needs_audio' | 'watched_only' = 'watched_only';
      if (hasEmbedding && hasSampleAudio && isVerified) {
        inAppStatus = 'verified';
      } else if (voiceData) {
        inAppStatus = 'needs_audio';
      }

      // Last checked calculation based on monitoring source
      let lastCheckedIso = autoDetectRun?.updated_at || autoDetectRun?.created_at;
      if (
        profile.watchSources.includes('spacesdashboard') &&
        spacesDashboardRun &&
        spacesDashboardRun.updated_at > (lastCheckedIso || '')
      ) {
        lastCheckedIso = spacesDashboardRun.updated_at;
      }

      return {
        ...profile,
        voiceData,
        inAppStatus,
        hasEmbedding,
        hasSampleAudio,
        isVerified,
        lastCheckedIso,
      };
    });
  }, [profilesList, voiceCatalog, autoDetectRun, spacesDashboardRun]);

  // Filtered and searched list
  const filteredProfiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return profileDetails.filter(p => {
      const matchesSearch =
        !q ||
        p.handle.toLowerCase().includes(q) ||
        p.displayName.toLowerCase().includes(q) ||
        p.role.toLowerCase().includes(q);

      if (!matchesSearch) return false;

      if (filter === 'verified') return p.inAppStatus === 'verified';
      if (filter === 'needs_audio') return p.inAppStatus === 'needs_audio';
      if (filter === 'watched_only') return p.inAppStatus === 'watched_only';
      return true;
    });
  }, [profileDetails, search, filter]);

  // Trigger manual auto-detection scan on GitHub Actions
  const handleScanAllNow = async () => {
    if (!hasCredentials) {
      setNotice({
        kind: 'error',
        message: 'GitHub credentials missing. Set Token, Owner, and Repo in Configuration.',
      });
      return;
    }

    setScanning(true);
    setNotice(null);

    const allHandles = profileDetails.map(p => p.handle).join(',');

    try {
      await dispatchWorkflow(
        config.githubToken,
        owner,
        repo,
        'auto_detect_spaces.yml',
        { x_handles: allHandles }
      );
      setNotice({
        kind: 'success',
        message: `🛰️ Auto-detection scan dispatched for ${profileDetails.length} monitored accounts. GitHub Actions runner started.`,
      });
      await refreshRuns(true);
    } catch (err) {
      setNotice({
        kind: 'error',
        message: friendlyGitHubError(err, 'triggering auto-detection scan'),
      });
    } finally {
      setScanning(false);
    }
  };

  // Add custom handle
  const handleAddHandle = () => {
    const clean = newHandle.trim().replace(/^@/, '');
    if (!clean) return;

    const currentWatched = config.watchedHosts || [];
    if (!currentWatched.some(h => h.toLowerCase() === clean.toLowerCase())) {
      const updated = [...currentWatched, clean];
      if (onUpdateWatchedHosts) {
        onUpdateWatchedHosts(updated);
      } else {
        config.watchedHosts = updated;
      }
    }
    setNewHandle('');
    setShowAddForm(false);
    setNotice({
      kind: 'success',
      message: `Added @${clean} to watched hosts watchlist.`,
    });
  };

  // Stats summary counts
  const verifiedCount = profileDetails.filter(p => p.inAppStatus === 'verified').length;
  const needsAudioCount = profileDetails.filter(p => p.inAppStatus === 'needs_audio').length;
  const watchedOnlyCount = profileDetails.filter(p => p.inAppStatus === 'watched_only').length;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col h-full shadow-xl">
      {/* Header */}
      <div className="p-4 md:p-5 border-b border-slate-800/80 bg-slate-950/40">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-500/15 border border-indigo-500/30 rounded-lg text-indigo-400">
              <Radio size={16} className={isScanningNow ? 'animate-pulse text-rose-400' : ''} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white tracking-wide">
                  Tracked Profiles &amp; Hosts
                </h3>
                <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-full font-mono">
                  {profileDetails.length}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Monitored for new Space broadcasts &amp; speaker diarization
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleScanAllNow}
            disabled={isScanningNow || !hasCredentials}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm transition-all cursor-pointer"
            title="Trigger GitHub Actions Auto-Detect workflow for all handles now"
          >
            <RefreshCw size={12} className={isScanningNow ? 'animate-spin' : ''} />
            <span>{isScanningNow ? 'Scanning…' : 'Scan Now'}</span>
          </button>
        </div>

        {/* Global Schedule & Telemetry Banner */}
        <div className="p-2.5 bg-slate-950/80 border border-slate-800 rounded-lg flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                isScanningNow
                  ? 'bg-amber-400 animate-ping'
                  : 'bg-emerald-400 animate-pulse'
              }`}
            />
            <span className="text-slate-300 font-medium">
              {isScanningNow ? 'Active Auto-Detection Scan in Progress' : 'Continuous Cron Active'}
            </span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-400 font-mono">Every 2h (:13)</span>
          </div>

          <div className="flex items-center gap-1.5 text-slate-400">
            <Clock size={11} className="text-indigo-400" />
            <span>Last checked:</span>
            <span className="text-slate-200 font-semibold font-mono">
              {autoDetectRun ? timeAgo(autoDetectRun.updated_at) : 'Active'}
            </span>
            {autoDetectRun?.conclusion === 'success' && (
              <span className="text-emerald-400 font-bold text-[10px]">✓</span>
            )}
          </div>
        </div>

        {notice && (
          <div
            className={`mt-2.5 p-2.5 rounded-lg border text-xs flex items-center justify-between gap-2 ${
              notice.kind === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}
          >
            <span>{notice.message}</span>
            <button
              onClick={() => setNotice(null)}
              className="text-slate-400 hover:text-white text-xs"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Search & Filter Controls */}
      <div className="p-3 border-b border-slate-800/80 bg-slate-900/60 space-y-2">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search handle, name, or role..."
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-2 text-slate-400 hover:text-white text-xs"
            >
              ✕
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px] no-scrollbar">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-2 py-1 rounded-md font-medium transition-colors cursor-pointer ${
              filter === 'all'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            All ({profileDetails.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('verified')}
            className={`flex items-center gap-1 px-2 py-1 rounded-md font-medium transition-colors cursor-pointer ${
              filter === 'verified'
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-950 text-emerald-400 hover:text-emerald-300 border border-slate-800'
            }`}
          >
            <ShieldCheck size={11} />
            Enrolled ({verifiedCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter('needs_audio')}
            className={`flex items-center gap-1 px-2 py-1 rounded-md font-medium transition-colors cursor-pointer ${
              filter === 'needs_audio'
                ? 'bg-amber-600 text-white'
                : 'bg-slate-950 text-amber-400 hover:text-amber-300 border border-slate-800'
            }`}
          >
            <AlertTriangle size={11} />
            Needs Sample ({needsAudioCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter('watched_only')}
            className={`flex items-center gap-1 px-2 py-1 rounded-md font-medium transition-colors cursor-pointer ${
              filter === 'watched_only'
                ? 'bg-slate-700 text-white'
                : 'bg-slate-950 text-slate-400 hover:text-slate-300 border border-slate-800'
            }`}
          >
            <Eye size={11} />
            Watchlist ({watchedOnlyCount})
          </button>
        </div>
      </div>

      {/* Profiles List */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60 p-2 space-y-1 max-h-[560px]">
        {filteredProfiles.length === 0 ? (
          <div className="py-10 text-center text-slate-400 text-xs">
            No tracked profiles match "{search}".
          </div>
        ) : (
          filteredProfiles.map((p, idx) => {
            return (
              <div
                key={p.id}
                className="p-3 rounded-lg hover:bg-slate-800/40 border border-transparent hover:border-slate-800 transition-all group"
              >
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex items-start gap-2.5 min-w-0">
                    {/* Avatar Emoji */}
                    <div className="w-8 h-8 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center text-base flex-shrink-0 shadow-inner group-hover:border-slate-700">
                      {p.avatarEmoji || '🎙️'}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-bold text-white truncate">
                          {p.displayName}
                        </span>
                        <a
                          href={`https://x.com/${p.handle}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] font-mono text-indigo-400 hover:text-indigo-300 hover:underline flex items-center gap-0.5"
                          title="Open on X / Twitter"
                        >
                          @{p.handle}
                          <ExternalLink size={9} className="opacity-70" />
                        </a>
                      </div>

                      <div className="text-[11px] text-slate-400 truncate mt-0.5">
                        {p.role}
                      </div>
                    </div>
                  </div>

                  {/* App & Voice Status Badge */}
                  <div className="flex-shrink-0 text-right">
                    {p.inAppStatus === 'verified' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        <ShieldCheck size={11} className="text-emerald-400" />
                        Enrolled (192-d)
                      </span>
                    ) : p.inAppStatus === 'needs_audio' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                        <AlertTriangle size={11} className="text-amber-400" />
                        Sample Needed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-950 text-slate-400 border border-slate-800">
                        <Radio size={10} className="text-slate-400" />
                        Monitored
                      </span>
                    )}
                  </div>
                </div>

                {/* Sub-details / Telemetry row */}
                <div className="mt-2.5 pt-2 border-t border-slate-800/40 flex items-center justify-between gap-2 text-[10px] text-slate-400">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="flex items-center gap-1">
                      <Clock size={10} className="text-indigo-400" />
                      Checked {timeAgo(p.lastCheckedIso)}
                    </span>
                    <span>·</span>
                    <span className="text-slate-400">
                      {p.watchSources.includes('spacesdashboard')
                        ? 'X + SpacesDashboard'
                        : 'X Auto-Detect'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {p.inAppStatus === 'needs_audio' && onNavigateVoiceProfiles && (
                      <button
                        type="button"
                        onClick={onNavigateVoiceProfiles}
                        className="text-amber-400 hover:text-amber-300 font-medium cursor-pointer underline text-[10px]"
                      >
                        Enroll Audio →
                      </button>
                    )}
                    {p.inAppStatus === 'verified' && onNavigateVoiceProfiles && (
                      <button
                        type="button"
                        onClick={onNavigateVoiceProfiles}
                        className="text-indigo-400 hover:text-indigo-300 cursor-pointer text-[10px]"
                      >
                        Voice Profile
                      </button>
                    )}
                    {onSelectHandleForIngest && (
                      <button
                        type="button"
                        onClick={() => onSelectHandleForIngest(p.handle)}
                        className="text-slate-400 hover:text-white cursor-pointer text-[10px]"
                        title="Submit space for this host"
                      >
                        Ingest Space →
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer / Quick Add Handle */}
      <div className="p-3 border-t border-slate-800/80 bg-slate-950/60">
        {!showAddForm ? (
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 rounded-lg border border-dashed border-indigo-500/30 transition-colors cursor-pointer"
          >
            <Plus size={13} />
            Add Custom Tracked Account
          </button>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newHandle}
                onChange={e => setNewHandle(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAddHandle();
                  if (e.key === 'Escape') setShowAddForm(false);
                }}
                placeholder="Twitter / X handle (e.g. news_speaker)"
                autoFocus
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder:text-slate-400 focus:outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={handleAddHandle}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg cursor-pointer"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-2 py-1.5 text-slate-400 hover:text-white text-xs cursor-pointer"
              >
                Cancel
              </button>
            </div>
            <p className="text-[10px] text-slate-400">
              Handle will be saved to watched hosts and scanned on subsequent auto-detect runs.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TrackedProfilesPanel;
