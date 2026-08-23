import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  FileText, RefreshCw, AlertCircle, Search, ChevronDown, Loader,
  ExternalLink, Play, Pause, Volume2, Copy, Check, Download,
  SlidersHorizontal, ArrowDownCircle, Sparkles
} from 'lucide-react';
import { Release, EnhancedConfig } from '../types';
import { getReleases, fetchReleaseAssetText, dispatchWorkflow } from '../utils/github';
import { usePlayer, NowPlayingEpisode } from '../contexts/PlayerContext';

interface Props {
  config: EnhancedConfig;
  initialReleaseId?: number | null;
}

export interface ParsedUtterance {
  id: string;
  startSec: number;
  endSec: number | null;
  startLabel: string;
  endLabel: string;
  speaker: string;
  text: string;
  raw: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function parseTimeToSeconds(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.trim().replace(/^\[|\]$/g, '').split(':').map(Number);
  if (parts.length === 3) {
    return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
  }
  if (parts.length === 2) {
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  }
  return Number(timeStr) || 0;
}

function formatSeconds(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
}

const SPEAKER_PALETTE: Record<string, { bg: string; text: string; border: string; badge: string; dot: string }> = {
  'A': { bg: 'bg-emerald-500/10', text: 'text-emerald-300', border: 'border-emerald-500/30', badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', dot: 'bg-emerald-400' },
  'B': { bg: 'bg-sky-500/10', text: 'text-sky-300', border: 'border-sky-500/30', badge: 'bg-sky-500/20 text-sky-300 border-sky-500/40', dot: 'bg-sky-400' },
  'C': { bg: 'bg-purple-500/10', text: 'text-purple-300', border: 'border-purple-500/30', badge: 'bg-purple-500/20 text-purple-300 border-purple-500/40', dot: 'bg-purple-400' },
  'D': { bg: 'bg-amber-500/10', text: 'text-amber-300', border: 'border-amber-500/30', badge: 'bg-amber-500/20 text-amber-300 border-amber-500/40', dot: 'bg-amber-400' },
  'E': { bg: 'bg-rose-500/10', text: 'text-rose-300', border: 'border-rose-500/30', badge: 'bg-rose-500/20 text-rose-300 border-rose-500/40', dot: 'bg-rose-400' },
  'F': { bg: 'bg-cyan-500/10', text: 'text-cyan-300', border: 'border-cyan-500/30', badge: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40', dot: 'bg-cyan-400' },
};

function getSpeakerTheme(speaker: string) {
  const match = speaker.match(/([A-Z0-9])/i);
  const key = (match ? match[1].toUpperCase() : speaker.slice(-1).toUpperCase()) || 'A';
  return SPEAKER_PALETTE[key] || {
    bg: 'bg-indigo-500/10',
    text: 'text-indigo-300',
    border: 'border-indigo-500/30',
    badge: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
    dot: 'bg-indigo-400',
  };
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return parts.map((p, i) =>
    p.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="bg-amber-400/30 text-amber-200 rounded px-0.5 font-medium">{p}</mark>
      : p
  );
}

function parseTranscriptData(rawContent: string): ParsedUtterance[] {
  if (!rawContent.trim()) return [];

  // 1. Try parsing JSON format
  try {
    const json = JSON.parse(rawContent);
    if (json && Array.isArray(json.segments) && json.segments.length > 0) {
      return json.segments.map((seg: any, idx: number) => {
        const startSec = typeof seg.start === 'number' ? (seg.start > 1000 ? seg.start / 1000 : seg.start) : 0;
        const endSec = typeof seg.end === 'number' ? (seg.end > 1000 ? seg.end / 1000 : seg.end) : null;
        const spk = seg.speaker || 'Speaker A';
        const formattedSpeaker = spk.startsWith('Speaker') ? spk : `Speaker ${spk}`;
        return {
          id: `seg-${idx}`,
          startSec,
          endSec,
          startLabel: formatSeconds(startSec),
          endLabel: endSec ? formatSeconds(endSec) : '',
          speaker: formattedSpeaker,
          text: (seg.text || '').trim(),
          raw: `[${formatSeconds(startSec)}] ${formattedSpeaker}: ${seg.text}`,
        };
      });
    }
  } catch {
    // Proceed to text parsing
  }

  // 2. Parse plain text line by line
  const lines = rawContent.split(/\r?\n/);
  const utterances: ParsedUtterance[] = [];
  const lineRegex = /^\[?(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:-\s*(\d{1,2}:\d{2}(?::\d{2})?))?\]?\s*(?:Speaker\s+([A-Za-z0-9_]+)|([A-Za-z0-9_]+))?\s*:\s*(.*)$/i;

  let currentUtterance: ParsedUtterance | null = null;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const match = trimmed.match(lineRegex);
    if (match) {
      if (currentUtterance) {
        utterances.push(currentUtterance);
      }
      const startStr = match[1];
      const endStr = match[2];
      const speakerId = match[3] || match[4] || 'A';
      const text = match[5] || '';
      const startSec = parseTimeToSeconds(startStr);
      const endSec = endStr ? parseTimeToSeconds(endStr) : null;
      const formattedSpeaker = speakerId.startsWith('Speaker') ? speakerId : `Speaker ${speakerId}`;

      currentUtterance = {
        id: `line-${index}`,
        startSec,
        endSec,
        startLabel: formatSeconds(startSec),
        endLabel: endSec ? formatSeconds(endSec) : '',
        speaker: formattedSpeaker,
        text,
        raw: trimmed,
      };
    } else if (currentUtterance) {
      currentUtterance.text += ` ${trimmed}`;
      currentUtterance.raw += `\n${trimmed}`;
    } else {
      utterances.push({
        id: `raw-${index}`,
        startSec: index * 10,
        endSec: null,
        startLabel: formatSeconds(index * 10),
        endLabel: '',
        speaker: 'Transcript',
        text: trimmed,
        raw: trimmed,
      });
    }
  });

  if (currentUtterance) {
    utterances.push(currentUtterance);
  }

  return utterances;
}

const TranscriptPanel: React.FC<Props> = ({ config, initialReleaseId }) => {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(initialReleaseId || null);
  const [transcriptRaw, setTranscriptRaw] = useState('');
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState('');
  const [search, setSearch] = useState('');
  const [speakerFilter, setSpeakerFilter] = useState('ALL');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeSuccess, setTranscribeSuccess] = useState('');

  const currentLoadedIdRef = useRef<number | null>(null);

  const { play, seek, currentTime, isPlaying, current, togglePlay } = usePlayer();

  const hasCredentials = !!(config.githubToken && config.ownerName && config.repoName);

  const fetchReleases = useCallback(async () => {
    if (!hasCredentials) return;
    setLoading(true);
    setError('');
    try {
      const data = await getReleases(config.githubToken, config.ownerName.trim(), config.repoName.trim());
      const withTranscripts = data.filter(r =>
        r.assets.some(a => a.name.endsWith('.txt') || a.name.endsWith('.json'))
      );
      setReleases(withTranscripts.length > 0 ? withTranscripts : data);
      setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [config.githubToken, config.ownerName, config.repoName, hasCredentials]);

  useEffect(() => {
    if (hasCredentials && !loaded && !loading) {
      fetchReleases();
    }
  }, [hasCredentials, loaded, loading, fetchReleases]);

  const loadTranscript = useCallback(async (release: Release) => {
    const asset = release.assets.find(a => a.name.endsWith('.json')) ||
                  release.assets.find(a => a.name.endsWith('.txt'));
    setSelectedId(release.id);
    setSearch('');
    setSpeakerFilter('ALL');
    setTranscribeSuccess('');

    if (!asset) {
      setTranscriptRaw('');
      setTranscriptError('');
      return;
    }

    setTranscriptLoading(true);
    setTranscriptError('');
    setTranscriptRaw('');

    try {
      const text = await fetchReleaseAssetText(
        config.githubToken,
        asset,
        config.ownerName.trim(),
        config.repoName.trim()
      );
      setTranscriptRaw(text);
    } catch (e) {
      setTranscriptError((e as Error).message);
    } finally {
      setTranscriptLoading(false);
    }
  }, [config.githubToken, config.ownerName, config.repoName]);

  const handleGenerateTranscript = async () => {
    if (!selectedRelease || !hasCredentials) return;
    setTranscribing(true);
    setTranscribeSuccess('');
    setTranscriptError('');
    try {
      await dispatchWorkflow(
        config.githubToken,
        config.ownerName.trim(),
        config.repoName.trim(),
        'transcribe_episode.yml',
        { release_tag: selectedRelease.tag_name }
      );
      setTranscribeSuccess(`Workflow dispatched for ${selectedRelease.tag_name}! AssemblyAI is processing the audio in GitHub Actions. Click 'Refresh' once the job finishes.`);
    } catch (e) {
      setTranscriptError(`Failed to trigger transcription: ${(e as Error).message}`);
    } finally {
      setTranscribing(false);
    }
  };

  useEffect(() => {
    if (releases.length > 0 && selectedId) {
      if (currentLoadedIdRef.current !== selectedId) {
        const rel = releases.find(r => r.id === selectedId);
        if (rel) {
          currentLoadedIdRef.current = selectedId;
          loadTranscript(rel);
        }
      }
    } else if (releases.length > 0 && !selectedId) {
      const firstWithTranscript = releases.find(r =>
        r.assets.some(a => a.name.endsWith('.txt') || a.name.endsWith('.json'))
      ) || releases[0];
      if (firstWithTranscript && currentLoadedIdRef.current !== firstWithTranscript.id) {
        currentLoadedIdRef.current = firstWithTranscript.id;
        loadTranscript(firstWithTranscript);
      }
    }
  }, [releases, selectedId, loadTranscript]);

  const selectedRelease = releases.find(r => r.id === selectedId);
  const mp3Asset = selectedRelease?.assets.find(a => a.name.endsWith('.mp3'));
  const isCurrentEpisodePlaying = current?.id === selectedRelease?.id && isPlaying;

  const utterances = useMemo(() => {
    return parseTranscriptData(transcriptRaw);
  }, [transcriptRaw]);

  const uniqueSpeakers = useMemo(() => {
    const s = new Set<string>();
    utterances.forEach(u => s.add(u.speaker));
    return Array.from(s);
  }, [utterances]);

  const filteredUtterances = useMemo(() => {
    return utterances.filter(u => {
      if (speakerFilter !== 'ALL' && u.speaker !== speakerFilter) {
        return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        return u.text.toLowerCase().includes(q) || u.speaker.toLowerCase().includes(q);
      }
      return true;
    });
  }, [utterances, speakerFilter, search]);

  const matchCount = useMemo(() => {
    if (!search.trim()) return 0;
    const q = search.toLowerCase();
    return utterances.filter(u => u.text.toLowerCase().includes(q)).length;
  }, [search, utterances]);

  const activeUtteranceIndex = useMemo(() => {
    if (current?.id !== selectedRelease?.id || !utterances.length) return -1;
    for (let i = 0; i < utterances.length; i++) {
      const u = utterances[i];
      const nextU = utterances[i + 1];
      const end = u.endSec ?? (nextU ? nextU.startSec : u.startSec + 30);
      if (currentTime >= u.startSec && currentTime < end) {
        return i;
      }
    }
    return -1;
  }, [current, selectedRelease, utterances, currentTime]);

  useEffect(() => {
    if (autoScroll && activeUtteranceIndex >= 0) {
      const el = document.getElementById(`utterance-card-${activeUtteranceIndex}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [autoScroll, activeUtteranceIndex]);

  const handlePlayUtterance = (startSec: number) => {
    if (!selectedRelease || !mp3Asset) return;
    const nowPlaying: NowPlayingEpisode = {
      id: selectedRelease.id,
      title: selectedRelease.name || selectedRelease.tag_name,
      audioUrl: mp3Asset.browser_download_url,
    };

    if (current?.id !== selectedRelease.id) {
      play(nowPlaying);
      setTimeout(() => seek(startSec), 150);
    } else {
      seek(startSec);
      if (!isPlaying) togglePlay();
    }
  };

  const handlePlayEpisodeToggle = () => {
    if (!selectedRelease || !mp3Asset) return;
    const nowPlaying: NowPlayingEpisode = {
      id: selectedRelease.id,
      title: selectedRelease.name || selectedRelease.tag_name,
      audioUrl: mp3Asset.browser_download_url,
    };

    if (current?.id === selectedRelease.id) {
      togglePlay();
    } else {
      play(nowPlaying);
    }
  };

  const handleCopyTranscript = () => {
    if (!utterances.length) return;
    const formatted = utterances
      .map(u => `[${u.startLabel}${u.endLabel ? ` - ${u.endLabel}` : ''}] ${u.speaker}:\n${u.text}`)
      .join('\n\n');
    navigator.clipboard.writeText(formatted);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadTranscript = (format: 'txt' | 'json') => {
    if (!utterances.length || !selectedRelease) return;
    const baseName = (selectedRelease.name || selectedRelease.tag_name).replace(/[^a-zA-Z0-9_-]/g, '_');
    let blob: Blob;
    let filename: string;

    if (format === 'json') {
      const data = {
        episode: selectedRelease.name || selectedRelease.tag_name,
        tag: selectedRelease.tag_name,
        published_at: selectedRelease.published_at,
        segments: utterances.map(u => ({
          start: u.startSec,
          end: u.endSec,
          speaker: u.speaker,
          text: u.text,
        })),
      };
      blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      filename = `${baseName}_transcript.json`;
    } else {
      const text = utterances
        .map(u => `[${u.startLabel}${u.endLabel ? ` - ${u.endLabel}` : ''}] ${u.speaker}: ${u.text}`)
        .join('\n\n');
      blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      filename = `${baseName}_transcript.txt`;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full overflow-hidden flex flex-col bg-slate-950">
      {/* ── Top Header ── */}
      <div className="p-6 md:px-10 md:py-6 border-b border-slate-800 flex items-center justify-between gap-4 flex-shrink-0 bg-slate-900/40">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-white tracking-tight">Interactive Transcripts</h2>
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
              <Sparkles size={11} /> Diarized
            </span>
          </div>
          <p className="text-slate-400 text-xs mt-1">
            Click any timestamp or speaker quote to jump audio playback instantly.
          </p>
        </div>

        <button
          onClick={fetchReleases}
          disabled={loading || !hasCredentials}
          className="flex items-center gap-2 px-3.5 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 rounded-lg transition-colors border border-slate-700"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {!hasCredentials && (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
          <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl mb-4">
            <AlertCircle size={28} className="text-slate-500" />
          </div>
          <p className="text-slate-300 text-sm font-medium">GitHub Connection Required</p>
          <p className="text-slate-500 text-xs mt-1 max-w-sm">Connect your GitHub Personal Access Token to load transcripts from your repository releases.</p>
        </div>
      )}

      {hasCredentials && error && (
        <div className="mx-6 md:mx-10 mt-4 flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
          <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {hasCredentials && loaded && releases.length === 0 && !error && (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
          <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl mb-4">
            <FileText size={28} className="text-slate-500" />
          </div>
          <p className="text-slate-300 text-sm font-medium">No Episodes Found</p>
          <p className="text-slate-500 text-xs mt-1 max-w-sm">Run your ingest pipeline to download Spaces and generate transcripts.</p>
        </div>
      )}

      {hasCredentials && loaded && releases.length > 0 && (
        <div className="flex-1 flex min-h-0">
          {/* ── Sidebar: Episode List ── */}
          <div className="w-72 md:w-80 flex-shrink-0 border-r border-slate-800 overflow-y-auto bg-slate-950/70 divide-y divide-slate-900">
            <div className="p-3 bg-slate-900/50 border-b border-slate-800">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                Select Episode ({releases.length})
              </span>
            </div>

            {releases.map(release => {
              const hasTxt = release.assets.some(a => a.name.endsWith('.txt') || a.name.endsWith('.json'));
              const isSelected = selectedId === release.id;
              const isPlayingThis = current?.id === release.id && isPlaying;

              return (
                <button
                  key={release.id}
                  onClick={() => loadTranscript(release)}
                  className={`w-full text-left p-3.5 transition-all flex items-start gap-3 group relative ${
                    isSelected
                      ? 'bg-indigo-600/15 border-l-4 border-l-indigo-500 text-white'
                      : 'hover:bg-slate-900/80 text-slate-300'
                  }`}
                >
                  <div className={`mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    isPlayingThis ? 'bg-indigo-500 text-white animate-pulse' : isSelected ? 'bg-indigo-500/20 text-indigo-400' : 'bg-slate-800 text-slate-500 group-hover:text-slate-300'
                  }`}>
                    {isPlayingThis ? <Volume2 size={13} /> : <FileText size={13} />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-semibold truncate ${isSelected ? 'text-white font-bold' : 'text-slate-300'}`}>
                      {release.name || release.tag_name}
                    </p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-[10px] text-slate-500">{formatDate(release.published_at)}</span>
                      {hasTxt ? (
                        <span className="px-1.5 py-0.2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded text-[9px] font-medium">
                          Transcript Ready
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.2 bg-slate-800 text-slate-500 rounded text-[9px]">
                          Audio Only
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* ── Main View: Interactive Player & Transcript ── */}
          <div className="flex-1 flex flex-col min-w-0 bg-slate-950">
            {!selectedRelease && (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                <ChevronDown size={28} className="text-slate-700 mb-3 rotate-90" />
                <p className="text-slate-500 text-sm">Select an episode from the sidebar to view its transcript</p>
              </div>
            )}

            {selectedRelease && (
              <>
                {/* ── Episode Sticky Player Header ── */}
                <div className="p-4 md:px-6 bg-slate-900/90 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {mp3Asset && (
                      <button
                        onClick={handlePlayEpisodeToggle}
                        className={`w-10 h-10 rounded-xl flex items-center justify-center font-medium shadow-md transition-all ${
                          isCurrentEpisodePlaying
                            ? 'bg-indigo-500 text-white shadow-indigo-500/30'
                            : 'bg-indigo-600 hover:bg-indigo-500 text-white hover:scale-105 shadow-indigo-600/20'
                        }`}
                        title={isCurrentEpisodePlaying ? 'Pause Audio' : 'Play Episode Audio'}
                      >
                        {isCurrentEpisodePlaying ? <Pause size={16} /> : <Play size={16} className="translate-x-0.5" />}
                      </button>
                    )}

                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-white truncate max-w-md">
                        {selectedRelease.name || selectedRelease.tag_name}
                      </h3>
                      <p className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                        <span>{formatDate(selectedRelease.published_at)}</span>
                        {utterances.length > 0 && (
                          <>
                            <span>•</span>
                            <span className="text-indigo-400 font-medium">{utterances.length} speaker turns</span>
                          </>
                        )}
                        {uniqueSpeakers.length > 0 && (
                          <>
                            <span>•</span>
                            <span className="text-emerald-400">{uniqueSpeakers.length} speaker{uniqueSpeakers.length > 1 ? 's' : ''} identified</span>
                          </>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Copy button */}
                    <button
                      onClick={handleCopyTranscript}
                      disabled={!utterances.length}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-xs font-medium rounded-lg transition-colors border border-slate-700"
                      title="Copy formatted transcript to clipboard"
                    >
                      {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                      {copied ? 'Copied!' : 'Copy'}
                    </button>

                    {/* Download button */}
                    <button
                      onClick={() => handleDownloadTranscript('txt')}
                      disabled={!utterances.length}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-xs font-medium rounded-lg transition-colors border border-slate-700"
                      title="Download transcript (.txt)"
                    >
                      <Download size={12} />
                      .txt
                    </button>

                    <button
                      onClick={() => handleDownloadTranscript('json')}
                      disabled={!utterances.length}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-xs font-medium rounded-lg transition-colors border border-slate-700"
                      title="Download structured data (.json)"
                    >
                      <Download size={12} />
                      .json
                    </button>

                    <a
                      href={selectedRelease.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-colors border border-slate-800"
                      title="View release on GitHub"
                    >
                      <ExternalLink size={13} />
                    </a>
                  </div>
                </div>

                {/* ── Filter & Search Toolbar ── */}
                <div className="p-3 md:px-6 bg-slate-900/50 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-[240px]">
                    <div className="relative flex-1 max-w-sm">
                      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input
                        type="text"
                        placeholder="Search transcript text or speaker…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
                      />
                    </div>

                    {search && (
                      <span className="text-xs text-amber-400 font-medium">
                        {matchCount} match{matchCount !== 1 ? 'es' : ''}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    {/* Speaker filter */}
                    {uniqueSpeakers.length > 1 && (
                      <div className="flex items-center gap-1.5">
                        <SlidersHorizontal size={12} className="text-slate-500" />
                        <select
                          value={speakerFilter}
                          onChange={e => setSpeakerFilter(e.target.value)}
                          className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
                        >
                          <option value="ALL">All Speakers ({utterances.length})</option>
                          {uniqueSpeakers.map(spk => (
                            <option key={spk} value={spk}>{spk}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Auto-scroll toggle */}
                    <button
                      onClick={() => setAutoScroll(!autoScroll)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg transition-colors border ${
                        autoScroll
                          ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30 font-medium'
                          : 'bg-slate-900 text-slate-500 border-slate-800'
                      }`}
                      title="Automatically scroll to follow playback"
                    >
                      <ArrowDownCircle size={12} />
                      Auto-Scroll {autoScroll ? 'ON' : 'OFF'}
                    </button>
                  </div>
                </div>

                {/* ── Transcript Content / Utterance Feed ── */}
                <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-3">
                  {transcriptLoading && (
                    <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
                      <Loader size={24} className="animate-spin text-indigo-400" />
                      <span className="text-xs font-medium">Loading diarized transcript…</span>
                    </div>
                  )}

                  {transcriptError && (
                    <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs">
                      <p className="font-semibold">Could not load transcript</p>
                      <p className="mt-1 opacity-80">{transcriptError}</p>
                    </div>
                  )}

                  {!transcriptLoading && !transcriptError && !transcriptRaw && (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-8 max-w-md mx-auto py-16">
                      <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-4 text-indigo-400">
                        <Sparkles size={26} />
                      </div>
                      <h4 className="text-base font-bold text-white mb-1">No Transcript Generated Yet</h4>
                      <p className="text-slate-400 text-xs mb-6">
                        This episode has audio published, but has not been transcribed with AssemblyAI speaker diarization yet.
                      </p>

                      {transcribeSuccess ? (
                        <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-300 text-xs mb-4 text-left w-full">
                          <p className="font-semibold flex items-center gap-1.5"><Check size={14} /> Job Dispatched</p>
                          <p className="mt-1 opacity-90">{transcribeSuccess}</p>
                        </div>
                      ) : (
                        <button
                          onClick={handleGenerateTranscript}
                          disabled={transcribing}
                          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shadow-lg shadow-indigo-600/20 transition-all hover:scale-105"
                        >
                          {transcribing ? <Loader size={14} className="animate-spin" /> : <Sparkles size={14} />}
                          {transcribing ? 'Dispatching GitHub Action…' : '⚡ Transcribe with AssemblyAI Now'}
                        </button>
                      )}
                    </div>
                  )}

                  {!transcriptLoading && !transcriptError && transcriptRaw && filteredUtterances.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-20 text-center text-slate-500">
                      <Search size={28} className="mb-2 text-slate-600" />
                      <p className="text-xs font-medium">No speaker turns match your current search/filter.</p>
                    </div>
                  )}

                  {!transcriptLoading && !transcriptError && filteredUtterances.map((utterance, idx) => {
                    const isPlayingThisUtterance = activeUtteranceIndex === idx;
                    const theme = getSpeakerTheme(utterance.speaker);

                    return (
                      <div
                        id={`utterance-card-${idx}`}
                        key={utterance.id}
                        onClick={() => handlePlayUtterance(utterance.startSec)}
                        className={`p-4 rounded-xl border transition-all cursor-pointer group relative ${
                          isPlayingThisUtterance
                            ? 'bg-indigo-950/40 border-indigo-500/70 shadow-lg shadow-indigo-500/10 ring-1 ring-indigo-500/30'
                            : 'bg-slate-900/60 border-slate-800/80 hover:bg-slate-900 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <div className="flex items-center gap-2">
                            {/* Speaker Tag */}
                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-bold ${theme.badge}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${theme.dot}`} />
                              {utterance.speaker}
                            </span>

                            {/* Timestamp Seek Button */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePlayUtterance(utterance.startSec);
                              }}
                              className="flex items-center gap-1 text-[11px] font-mono font-medium px-2 py-0.5 rounded bg-slate-800 text-slate-300 group-hover:text-indigo-300 group-hover:bg-indigo-500/20 transition-colors"
                              title="Click to seek playback to this moment"
                            >
                              <Play size={9} className="text-indigo-400 translate-x-0.2" />
                              <span>{utterance.startLabel}</span>
                              {utterance.endLabel && (
                                <span className="text-slate-500 group-hover:text-indigo-400/60 font-normal">
                                  - {utterance.endLabel}
                                </span>
                              )}
                            </button>
                          </div>

                          {isPlayingThisUtterance && (
                            <span className="flex items-center gap-1.5 text-[10px] font-bold text-indigo-400 uppercase tracking-wider bg-indigo-500/15 px-2 py-0.5 rounded-full border border-indigo-500/30 animate-pulse">
                              <Volume2 size={11} /> Speaking Now
                            </span>
                          )}
                        </div>

                        {/* Spoken Text */}
                        <p className={`text-sm leading-relaxed transition-colors ${
                          isPlayingThisUtterance ? 'text-white font-medium' : 'text-slate-300'
                        }`}>
                          {highlightMatch(utterance.text, search)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default TranscriptPanel;
