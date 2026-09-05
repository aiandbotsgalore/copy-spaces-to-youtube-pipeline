import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Flame,
  Play,
  Pause,
  Download,
  Copy,
  Check,
  Search,
  Volume2,
  VolumeX,
  Sparkles,
  Clock,
  User,
  RefreshCw,
  Radio,
  ArrowUpDown,
  RotateCcw,
  RotateCw,
  Gauge,
  LayoutGrid,
  LayoutList,
  Layers,
  ChevronDown,
  ChevronRight,
  SkipForward,
  SkipBack,
  SlidersHorizontal,
  Star,
  Repeat,
  X,
  Share2
} from 'lucide-react';
import { usePlayer } from '../contexts/PlayerContext';

export interface ClipItem {
  title: string;
  category: string;
  start_seconds: number;
  end_seconds: number;
  duration?: number;
  speakers: string[];
  viral_score: number;
  reason: string;
  transcript_snippet: string;
  episode?: string;
  file_path?: string;
  download_url?: string;
}

const formatEpisodeTitle = (ep?: string) => {
  if (!ep) return 'Unknown Space';
  let clean = ep.replace(/^20\d{6}_[a-zA-Z0-9]+_/, '');
  clean = clean.replace(/_/g, ' ').replace(/-/g, ' ').trim();
  return clean || ep;
};

const getCategoryColor = (cat: string) => {
  const c = (cat || '').toLowerCase();
  if (c.includes('humor') || c.includes('banter')) {
    return {
      badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
      pill: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
      icon: '🔥'
    };
  }
  if (c.includes('story') || c.includes('wild')) {
    return {
      badge: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
      pill: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
      icon: '🛸'
    };
  }
  if (c.includes('rant')) {
    return {
      badge: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
      pill: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
      icon: '⚡'
    };
  }
  if (c.includes('quote') || c.includes('golden')) {
    return {
      badge: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
      pill: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
      icon: '💬'
    };
  }
  return {
    badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    pill: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    icon: '✨'
  };
};

export const ClipsPanel: React.FC = () => {
  const [clips, setClips] = useState<ClipItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Search & Filter state
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedEpisode, setSelectedEpisode] = useState<string>('ALL');
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>('ALL');
  const [onlyTopRated, setOnlyTopRated] = useState(false);
  const [sortBy, setSortBy] = useState<'viral' | 'newest' | 'oldest' | 'episode-az' | 'duration-desc' | 'duration-asc'>('viral');
  const [viewMode, setViewMode] = useState<'grouped' | 'grid' | 'list'>('grouped');
  const [expandedEpisodes, setExpandedEpisodes] = useState<Record<string, boolean>>({});

  // Audio Playback state
  const [activeClip, setActiveClip] = useState<ClipItem | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [clipSpeed, setClipSpeed] = useState(1);
  const [volume, setVolume] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);
  const [autoNext, setAutoNext] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const globalPlayer = usePlayer();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Auto-pause clips player if global episode player starts playing
  useEffect(() => {
    if (globalPlayer.isPlaying && isPlaying) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setIsPlaying(false);
    }
  }, [globalPlayer.isPlaying, isPlaying]);

  const loadClips = async () => {
    setLoading(true);
    try {
      let combinedClips: ClipItem[] = [];

      // 1. Fetch static local catalog
      try {
        const res = await fetch('/clips/clips_catalog.json');
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) combinedClips = [...data];
        }
      } catch (e) {
        console.warn('Local clips catalog not found, checking remote releases...', e);
      }

      // 2. Fetch live clips directly from GitHub Releases API
      try {
        const ghRes = await fetch('https://api.github.com/repos/aiandbotsgalore/copy-spaces-to-youtube-pipeline/releases?per_page=50');
        if (ghRes.ok) {
          const releases = await ghRes.json();
          const seenFiles = new Set(
            combinedClips.map(c => (c.file_path ? c.file_path.split(/[\\/]/).pop()?.toLowerCase() : ''))
          );

          for (const r of releases) {
            const relTitle = r.name || r.tag_name || 'Space Episode';
            const assets: any[] = r.assets || [];

            // Rich clips JSON
            const clipsJsonAsset = assets.find((a: any) =>
              a.name && (a.name.endsWith('_clips.json') || a.name === 'clips_catalog.json')
            );

            if (clipsJsonAsset) {
              try {
                const jRes = await fetch(clipsJsonAsset.browser_download_url);
                if (jRes.ok) {
                  const metaClips = await jRes.json();
                  if (Array.isArray(metaClips)) {
                    for (const mc of metaClips) {
                      const mcStart = Math.round(mc.start_seconds || 0);
                      const matchingMp3 = assets.find((a: any) => {
                        const aname = (a.name || '').toLowerCase();
                        if (!aname.includes('m') || !aname.includes('s')) return false;
                        const cBase = (mc.file_path || '').split(/[\\/]/).pop()?.toLowerCase() || '';
                        if (cBase && aname === cBase) return true;
                        const m = aname.match(/^(?:(\d+)h)?(\d+)m(\d+)s/);
                        if (m) {
                          const h = parseInt(m[1] || '0', 10);
                          const mi = parseInt(m[2] || '0', 10);
                          const s = parseInt(m[3] || '0', 10);
                          const aStart = h * 3600 + mi * 60 + s;
                          return Math.abs(aStart - mcStart) <= 5;
                        }
                        return false;
                      });

                      const audioUrl = matchingMp3 ? matchingMp3.browser_download_url : (mc.file_path || '');
                      const existingIdx = combinedClips.findIndex(ec => {
                        const ecName = (ec.file_path || '').split(/[\\/]/).pop()?.toLowerCase();
                        return (matchingMp3 && ecName === matchingMp3.name.toLowerCase()) ||
                               (ec.title.toLowerCase() === mc.title.toLowerCase() && Math.abs((ec.start_seconds || 0) - mcStart) <= 5);
                      });

                      if (existingIdx >= 0) {
                        combinedClips[existingIdx] = {
                          ...combinedClips[existingIdx],
                          ...mc,
                          episode: mc.episode || relTitle,
                          file_path: audioUrl || combinedClips[existingIdx].file_path
                        };
                      } else {
                        combinedClips.push({
                          ...mc,
                          episode: mc.episode || relTitle,
                          file_path: audioUrl
                        });
                      }

                      if (matchingMp3) seenFiles.add(matchingMp3.name.toLowerCase());
                    }
                  }
                }
              } catch (jErr) {
                console.warn('Could not parse release clips metadata JSON:', jErr);
              }
            }

            // Standalone clip MP3s
            for (const a of assets) {
              const fname: string = a.name || '';
              if ((fname.endsWith('.mp3') || (!fname.includes('.') && fname.includes('m') && fname.includes('s'))) && fname.includes('m') && fname.includes('s')) {
                const baseName = fname.toLowerCase();
                if (!seenFiles.has(baseName)) {
                  seenFiles.add(baseName);
                  const stem = fname.replace(/\.mp3$/, '');
                  const match = stem.match(/^(?:(\d+)h)?(\d+)m(\d+)s_(.*)$/);
                  let startSec = 0;
                  let title = stem;
                  if (match) {
                    const h = parseInt(match[1] || '0', 10);
                    const m = parseInt(match[2] || '0', 10);
                    const s = parseInt(match[3] || '0', 10);
                    startSec = h * 3600 + m * 60 + s;
                    title = match[4].replace(/_/g, ' ').replace(/\./g, "'").trim();
                  }
                  combinedClips.push({
                    title: title,
                    category: 'Highlights',
                    start_seconds: startSec,
                    end_seconds: startSec + 60,
                    duration: 60,
                    speakers: ['Speaker'],
                    viral_score: 9,
                    reason: `AI selected highlight moment from ${relTitle}.`,
                    transcript_snippet: `Highlight moment from ${relTitle}`,
                    episode: relTitle,
                    file_path: a.browser_download_url,
                  });
                }
              }
            }
          }
        }
      } catch (err) {
        console.warn('Could not fetch live GitHub release clips:', err);
      }

      setClips(combinedClips);
      // Auto expand all episodes initially
      const initialExpanded: Record<string, boolean> = {};
      combinedClips.forEach(c => {
        if (c.episode) initialExpanded[c.episode] = true;
      });
      setExpandedEpisodes(initialExpanded);
    } catch {
      setClips([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClips();
  }, []);

  // Filter Categories & Counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: clips.length };
    clips.forEach(c => {
      const cat = c.category || 'Highlights';
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return counts;
  }, [clips]);

  const categories = useMemo(() => {
    const unique = Array.from(new Set(clips.map(c => c.category || 'Highlights')));
    return ['ALL', ...unique];
  }, [clips]);

  // Unique Episodes list with clip count
  const episodeList = useMemo(() => {
    const epMap: Record<string, number> = {};
    clips.forEach(c => {
      const ep = c.episode || 'Unknown Space';
      epMap[ep] = (epMap[ep] || 0) + 1;
    });
    return Object.entries(epMap).map(([name, count]) => ({ name, count }));
  }, [clips]);

  // Unique Speakers list
  const speakerList = useMemo(() => {
    const spkSet = new Set<string>();
    clips.forEach(c => {
      (c.speakers || []).forEach(s => {
        if (s && s !== 'Speaker') spkSet.add(s);
      });
    });
    return Array.from(spkSet).sort();
  }, [clips]);

  // Filtered and Sorted Clips
  const filteredClips = useMemo(() => {
    return clips
      .filter(c => {
        const matchesCategory = selectedCategory === 'ALL' || c.category === selectedCategory;
        const matchesEpisode = selectedEpisode === 'ALL' || c.episode === selectedEpisode;
        const matchesSpeaker = selectedSpeaker === 'ALL' || (c.speakers && c.speakers.includes(selectedSpeaker));
        const matchesTopRated = !onlyTopRated || (c.viral_score >= 9);

        const query = search.toLowerCase().trim();
        if (!query) return matchesCategory && matchesEpisode && matchesSpeaker && matchesTopRated;

        const epTitle = formatEpisodeTitle(c.episode).toLowerCase();
        const matchesSearch =
          c.title.toLowerCase().includes(query) ||
          (c.reason && c.reason.toLowerCase().includes(query)) ||
          (c.transcript_snippet && c.transcript_snippet.toLowerCase().includes(query)) ||
          (c.speakers && c.speakers.some(s => s.toLowerCase().includes(query))) ||
          (c.episode && c.episode.toLowerCase().includes(query)) ||
          epTitle.includes(query);

        return matchesCategory && matchesEpisode && matchesSpeaker && matchesTopRated && matchesSearch;
      })
      .sort((a, b) => {
        if (sortBy === 'viral') {
          return (b.viral_score || 0) - (a.viral_score || 0);
        }
        if (sortBy === 'newest') {
          const epA = a.episode || '';
          const epB = b.episode || '';
          return epB.localeCompare(epA, undefined, { numeric: true });
        }
        if (sortBy === 'oldest') {
          const epA = a.episode || '';
          const epB = b.episode || '';
          return epA.localeCompare(epB, undefined, { numeric: true });
        }
        if (sortBy === 'episode-az') {
          const epA = formatEpisodeTitle(a.episode).toLowerCase();
          const epB = formatEpisodeTitle(b.episode).toLowerCase();
          const epCmp = epA.localeCompare(epB);
          if (epCmp !== 0) return epCmp;
          return (a.start_seconds || 0) - (b.start_seconds || 0);
        }
        if (sortBy === 'duration-desc') {
          return (b.duration || 0) - (a.duration || 0);
        }
        if (sortBy === 'duration-asc') {
          return (a.duration || 0) - (b.duration || 0);
        }
        return 0;
      });
  }, [clips, selectedCategory, selectedEpisode, selectedSpeaker, onlyTopRated, search, sortBy]);

  // Grouped by Episode
  const groupedClips = useMemo(() => {
    const groups: Record<string, ClipItem[]> = {};
    filteredClips.forEach(c => {
      const epKey = c.episode || 'Unknown Space';
      if (!groups[epKey]) groups[epKey] = [];
      groups[epKey].push(c);
    });
    return groups;
  }, [filteredClips]);

  const getAudioUrl = (clip: ClipItem): string => {
    if (!clip.file_path) return '';
    if (clip.file_path.startsWith('http://') || clip.file_path.startsWith('https://')) {
      return clip.file_path;
    }
    const rel = clip.file_path.replace(/\\/g, '/');
    const part = rel.includes('best_saved_clips/')
      ? rel.split('best_saved_clips/')[1]
      : rel.includes('clips/')
      ? rel.split('clips/')[1]
      : rel;
    return `/clips/${part}`;
  };

  const handlePlayClip = (clip: ClipItem) => {
    if (activeClip && activeClip.title === clip.title && audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        if (globalPlayer.isPlaying) {
          globalPlayer.close();
        }
        audioRef.current.play();
        setIsPlaying(true);
      }
      return;
    }

    if (globalPlayer.isPlaying) {
      globalPlayer.close();
    }

    setActiveClip(clip);
    const url = getAudioUrl(clip);
    if (audioRef.current) {
      audioRef.current.src = url;
      audioRef.current.playbackRate = clipSpeed;
      audioRef.current.volume = isMuted ? 0 : volume;
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleNextClip = () => {
    if (!activeClip || filteredClips.length === 0) return;
    const currIdx = filteredClips.findIndex(c => c.title === activeClip.title);
    const nextIdx = (currIdx + 1) % filteredClips.length;
    handlePlayClip(filteredClips[nextIdx]);
  };

  const handlePrevClip = () => {
    if (!activeClip || filteredClips.length === 0) return;
    const currIdx = filteredClips.findIndex(c => c.title === activeClip.title);
    const prevIdx = (currIdx - 1 + filteredClips.length) % filteredClips.length;
    handlePlayClip(filteredClips[prevIdx]);
  };

  const handleSkipClip = (deltaSeconds: number) => {
    if (audioRef.current) {
      const maxDur = audioRef.current.duration || duration || Infinity;
      const target = Math.max(0, Math.min(audioRef.current.currentTime + deltaSeconds, maxDur));
      audioRef.current.currentTime = target;
      setCurrentTime(target);
    }
  };

  const handleCycleClipSpeed = () => {
    const speeds = [1.0, 1.25, 1.5, 2.0];
    const nextIdx = (speeds.indexOf(clipSpeed) + 1) % speeds.length;
    const nextSpeed = speeds[nextIdx];
    setClipSpeed(nextSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextSpeed;
    }
  };

  const handleToggleMute = () => {
    if (audioRef.current) {
      const newMuted = !isMuted;
      setIsMuted(newMuted);
      audioRef.current.volume = newMuted ? 0 : volume;
    }
  };

  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    setIsMuted(newVol === 0);
    if (audioRef.current) {
      audioRef.current.volume = newVol;
    }
  };

  const handleCopyQuote = (clipTitle: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(clipTitle);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleEpisodeExpand = (ep: string) => {
    setExpandedEpisodes(prev => ({
      ...prev,
      [ep]: !prev[ep]
    }));
  };

  const toggleExpandAll = () => {
    const allExpanded = Object.values(expandedEpisodes).every(Boolean);
    const next: Record<string, boolean> = {};
    Object.keys(groupedClips).forEach(k => {
      next[k] = !allExpanded;
    });
    setExpandedEpisodes(next);
  };

  const formatSec = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 md:p-8 pb-40 max-w-7xl mx-auto w-full space-y-6">
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        onTimeUpdate={() => {
          if (audioRef.current) {
            setCurrentTime(audioRef.current.currentTime);
            setDuration(audioRef.current.duration || 0);
          }
        }}
        onEnded={() => {
          setIsPlaying(false);
          if (autoNext) {
            handleNextClip();
          }
        }}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
      />

      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-amber-500/10 via-indigo-500/10 to-transparent p-5 rounded-2xl border border-slate-800">
        <div>
          <div className="flex items-center gap-3 mb-1.5 flex-wrap">
            <div className="p-2 bg-amber-500/20 border border-amber-500/30 rounded-xl text-amber-400">
              <Flame size={22} className="animate-pulse" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Best Saved Clips & Highlights</h1>
            <span className="px-2.5 py-0.5 text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-full flex items-center gap-1">
              <Sparkles size={11} /> {clips.length} Curated Moments
            </span>
            <span className="px-2.5 py-0.5 text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-full">
              {episodeList.length} Spaces
            </span>
          </div>
          <p className="text-slate-400 text-xs sm:text-sm max-w-3xl">
            Viral punchlines, wild stories, passionate rants, and golden moments curated by Gemini 2.5 Flash from your Space archives.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto flex-shrink-0">
          <button
            onClick={loadClips}
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white text-xs font-medium rounded-xl transition-all cursor-pointer shadow-sm"
            title="Refresh clip library from GitHub Releases"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin text-indigo-400' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Search, Filter & View Controls Bar */}
      <div className="space-y-3 bg-slate-900/60 p-4 rounded-2xl border border-slate-800 backdrop-blur-sm">
        {/* Row 1: Search + View Modes + Sort */}
        <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
          {/* Search Bar */}
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by punchline, quote, topic, speaker, or Space title..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-9 py-2.5 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors shadow-inner"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-0.5 rounded cursor-pointer"
                title="Clear Search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap justify-between sm:justify-end">
            {/* View Mode Toggle */}
            <div className="flex items-center bg-slate-950 p-1 border border-slate-800 rounded-xl">
              <button
                onClick={() => setViewMode('grouped')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer ${
                  viewMode === 'grouped'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Group by Space Episode (Accordion)"
              >
                <Layers size={13} />
                <span className="hidden sm:inline">By Space</span>
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer ${
                  viewMode === 'grid'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Grid Cards View"
              >
                <LayoutGrid size={13} />
                <span className="hidden sm:inline">Grid</span>
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer ${
                  viewMode === 'list'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Compact List / Tracklist View"
              >
                <LayoutList size={13} />
                <span className="hidden sm:inline">List</span>
              </button>
            </div>

            {/* Sort Dropdown */}
            <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-300">
              <ArrowUpDown size={13} className="text-indigo-400 flex-shrink-0" />
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as any)}
                className="bg-transparent text-white font-medium focus:outline-none cursor-pointer text-xs pr-1"
              >
                <option value="viral" className="bg-slate-900 text-white">⭐ Highest Viral Score</option>
                <option value="newest" className="bg-slate-900 text-white">📅 Newest Space First</option>
                <option value="oldest" className="bg-slate-900 text-white">⏳ Oldest Space First</option>
                <option value="episode-az" className="bg-slate-900 text-white">🔤 Space Name (A-Z)</option>
                <option value="duration-desc" className="bg-slate-900 text-white">⏱️ Longest Clips</option>
                <option value="duration-asc" className="bg-slate-900 text-white">⚡ Shortest Quick-Bites</option>
              </select>
            </div>
          </div>
        </div>

        {/* Row 2: Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 scrollbar-thin">
          {categories.map(cat => {
            const count = categoryCounts[cat] || 0;
            const isSelected = selectedCategory === cat;
            const color = getCategoryColor(cat);
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-xl font-medium transition-all whitespace-nowrap cursor-pointer ${
                  isSelected
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 font-semibold'
                    : 'bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800/80'
                }`}
              >
                <span>{cat === 'ALL' ? '🌐 All Moments' : `${color.icon} ${cat}`}</span>
                <span className={`px-1.5 py-0.2 rounded-md text-[10px] font-bold ${
                  isSelected ? 'bg-indigo-800 text-indigo-100' : 'bg-slate-800 text-slate-400'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Row 3: Space Episode Selector + Speaker Filter + Top Rated Toggle */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/80 text-xs text-slate-400">
          <span className="flex items-center gap-1 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">
            <SlidersHorizontal size={11} /> Filters:
          </span>

          {/* Episode Select */}
          <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800">
            <Radio size={12} className="text-sky-400 flex-shrink-0" />
            <select
              value={selectedEpisode}
              onChange={e => setSelectedEpisode(e.target.value)}
              className="bg-transparent text-slate-300 text-xs focus:outline-none cursor-pointer max-w-[200px] truncate"
            >
              <option value="ALL" className="bg-slate-900 text-white">All Spaces ({episodeList.length})</option>
              {episodeList.map(ep => (
                <option key={ep.name} value={ep.name} className="bg-slate-900 text-white">
                  {formatEpisodeTitle(ep.name)} ({ep.count})
                </option>
              ))}
            </select>
          </div>

          {/* Speaker Select */}
          {speakerList.length > 0 && (
            <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800">
              <User size={12} className="text-emerald-400 flex-shrink-0" />
              <select
                value={selectedSpeaker}
                onChange={e => setSelectedSpeaker(e.target.value)}
                className="bg-transparent text-slate-300 text-xs focus:outline-none cursor-pointer max-w-[150px] truncate"
              >
                <option value="ALL" className="bg-slate-900 text-white">All Speakers</option>
                {speakerList.map(spk => (
                  <option key={spk} value={spk} className="bg-slate-900 text-white">
                    {spk}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Top Rated 9-10 Toggle */}
          <button
            onClick={() => setOnlyTopRated(!onlyTopRated)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all cursor-pointer ${
              onlyTopRated
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm'
                : 'bg-slate-950 text-slate-400 hover:text-slate-200 border-slate-800'
            }`}
          >
            <Star size={12} className={onlyTopRated ? 'text-amber-400 fill-amber-400' : 'text-slate-500'} />
            <span>9-10 Viral Only</span>
          </button>

          {/* Autoplay Next Toggle */}
          <button
            onClick={() => setAutoNext(!autoNext)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all cursor-pointer ml-auto ${
              autoNext
                ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                : 'bg-slate-950 text-slate-500 border-slate-800 hover:text-slate-400'
            }`}
            title="Automatically play the next clip when one finishes"
          >
            <Repeat size={12} className={autoNext ? 'text-indigo-400' : 'text-slate-500'} />
            <span>Autoplay Next: {autoNext ? 'ON' : 'OFF'}</span>
          </button>

          {/* Expand/Collapse All for Grouped View */}
          {viewMode === 'grouped' && (
            <button
              onClick={toggleExpandAll}
              className="text-[11px] text-slate-400 hover:text-white px-2 py-1 bg-slate-950 hover:bg-slate-850 border border-slate-800 rounded-lg transition-colors cursor-pointer"
            >
              Toggle All
            </button>
          )}
        </div>
      </div>

      {/* Results Count Bar */}
      <div className="flex items-center justify-between text-xs text-slate-500 px-1">
        <span>
          Showing <strong className="text-white">{filteredClips.length}</strong> of {clips.length} highlight moments
          {selectedEpisode !== 'ALL' && ` in "${formatEpisodeTitle(selectedEpisode)}"`}
          {selectedCategory !== 'ALL' && ` • ${selectedCategory}`}
        </span>
        {activeClip && (
          <span className="flex items-center gap-1.5 text-indigo-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span>Now Playing: <strong>{activeClip.title}</strong></span>
          </span>
        )}
      </div>

      {/* Loading State */}
      {loading && (
        <div className="text-center py-24 bg-slate-900/30 border border-slate-800/80 rounded-2xl">
          <RefreshCw size={28} className="animate-spin text-amber-400 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-white mb-1">Loading Highlight Clips...</h3>
          <p className="text-xs text-slate-400">Aggregating curated moments from GitHub Releases and local catalog</p>
        </div>
      )}

      {/* Empty State */}
      {!loading && filteredClips.length === 0 && (
        <div className="text-center py-20 bg-slate-900/40 border border-slate-800 rounded-2xl p-8 max-w-md mx-auto">
          <Sparkles size={36} className="text-amber-400/70 mx-auto mb-3" />
          <h3 className="text-base font-bold text-white mb-1">No Moments Found</h3>
          <p className="text-xs text-slate-400 mb-4 leading-relaxed">
            {search || selectedCategory !== 'ALL' || selectedEpisode !== 'ALL'
              ? 'No clips match your active filters. Try clearing your search or resetting category filters.'
              : 'No highlight clips have been generated yet. Process an episode to create your first highlights.'}
          </p>
          {(search || selectedCategory !== 'ALL' || selectedEpisode !== 'ALL' || onlyTopRated) && (
            <button
              onClick={() => {
                setSearch('');
                setSelectedCategory('ALL');
                setSelectedEpisode('ALL');
                setSelectedSpeaker('ALL');
                setOnlyTopRated(false);
              }}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl transition-all shadow-md shadow-indigo-600/30 cursor-pointer"
            >
              Reset All Filters
            </button>
          )}
        </div>
      )}

      {/* VIEW MODE 1: Grouped by Space Episode (Accordion) */}
      {!loading && viewMode === 'grouped' && (
        <div className="space-y-4">
          {Object.entries(groupedClips).map(([epName, epClips]) => {
            const isExpanded = expandedEpisodes[epName] !== false; // default open
            const isPlayingThisEpisode = activeClip && activeClip.episode === epName && isPlaying;

            return (
              <div
                key={epName}
                className="bg-slate-900/50 border border-slate-800/90 rounded-2xl overflow-hidden transition-all shadow-sm"
              >
                {/* Episode Accordion Header */}
                <div className="flex items-center justify-between p-4 bg-slate-900/80 hover:bg-slate-850/90 transition-colors border-b border-slate-800/60 flex-wrap sm:flex-nowrap gap-3">
                  <div
                    onClick={() => toggleEpisodeExpand(epName)}
                    className="flex items-center gap-3 cursor-pointer flex-1 min-w-0"
                  >
                    <button
                      className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                      title={isExpanded ? 'Collapse Space' : 'Expand Space'}
                    >
                      {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    </button>
                    <div className="p-2 bg-sky-500/10 border border-sky-500/20 rounded-xl text-sky-400 flex-shrink-0">
                      <Radio size={16} />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-sm sm:text-base font-bold text-white truncate flex items-center gap-2">
                        <span>{formatEpisodeTitle(epName)}</span>
                        {isPlayingThisEpisode && (
                          <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-semibold bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                            <Volume2 size={11} className="animate-bounce" /> Playing
                          </span>
                        )}
                      </h2>
                      <p className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                        <span className="font-semibold text-indigo-300">{epClips.length} {epClips.length === 1 ? 'Highlight' : 'Highlights'}</span>
                        <span>•</span>
                        <span>Avg Rating: {(epClips.reduce((acc, c) => acc + (c.viral_score || 8), 0) / epClips.length).toFixed(1)}/10</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => {
                        if (epClips.length > 0) {
                          handlePlayClip(epClips[0]);
                        }
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600/90 hover:bg-indigo-600 text-white rounded-xl text-xs font-semibold transition-all shadow-sm shadow-indigo-600/20 cursor-pointer"
                      title="Play all clips from this Space sequentially"
                    >
                      <Play size={12} className="translate-x-0.2" />
                      <span>Play Space Highlights</span>
                    </button>
                  </div>
                </div>

                {/* Episode Clips Grid */}
                {isExpanded && (
                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-950/30">
                    {epClips.map((clip, idx) => renderClipCard(clip, idx))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* VIEW MODE 2: Standard Grid View */}
      {!loading && viewMode === 'grid' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredClips.map((clip, idx) => renderClipCard(clip, idx))}
        </div>
      )}

      {/* VIEW MODE 3: Compact Tracklist / Table View */}
      {!loading && viewMode === 'list' && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden shadow-lg">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4 w-12 text-center">#</th>
                  <th className="py-3 px-4">Highlight Moment</th>
                  <th className="py-3 px-4 hidden md:table-cell">Space Episode</th>
                  <th className="py-3 px-4 hidden sm:table-cell">Category</th>
                  <th className="py-3 px-4 hidden lg:table-cell">Speakers</th>
                  <th className="py-3 px-4 text-center w-20">Duration</th>
                  <th className="py-3 px-4 text-center w-24">Viral</th>
                  <th className="py-3 px-4 text-right w-24">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredClips.map((clip, idx) => {
                  const isThisPlaying = activeClip && activeClip.title === clip.title && isPlaying;
                  const catColor = getCategoryColor(clip.category);
                  const starsCount = Math.min(5, Math.max(1, Math.round((clip.viral_score || 8) / 2)));

                  return (
                    <tr
                      key={idx}
                      className={`hover:bg-slate-850/70 transition-colors group ${
                        isThisPlaying ? 'bg-indigo-950/40 text-white font-medium' : ''
                      }`}
                    >
                      {/* Play / Index */}
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => handlePlayClip(clip)}
                          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
                            isThisPlaying
                              ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/30'
                              : 'bg-slate-800 group-hover:bg-indigo-600 text-slate-300 group-hover:text-white'
                          }`}
                          title={isThisPlaying ? 'Pause' : 'Play'}
                        >
                          {isThisPlaying ? <Pause size={13} /> : <Play size={13} className="translate-x-0.2" />}
                        </button>
                      </td>

                      {/* Title & Quote */}
                      <td className="py-3 px-4 max-w-sm">
                        <div className="font-semibold text-white text-xs mb-0.5 group-hover:text-indigo-300 transition-colors">
                          {clip.title}
                        </div>
                        <p className="text-[11px] text-slate-400 italic line-clamp-1">
                          "{clip.transcript_snippet}"
                        </p>
                      </td>

                      {/* Episode */}
                      <td className="py-3 px-4 hidden md:table-cell max-w-xs truncate text-sky-400">
                        <span className="truncate block" title={formatEpisodeTitle(clip.episode)}>
                          {formatEpisodeTitle(clip.episode)}
                        </span>
                      </td>

                      {/* Category */}
                      <td className="py-3 px-4 hidden sm:table-cell whitespace-nowrap">
                        <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-md border ${catColor.badge}`}>
                          {catColor.icon} {clip.category || 'Highlight'}
                        </span>
                      </td>

                      {/* Speakers */}
                      <td className="py-3 px-4 hidden lg:table-cell text-slate-400 max-w-[140px] truncate">
                        {clip.speakers && clip.speakers.length > 0 ? clip.speakers.join(', ') : 'Speakers'}
                      </td>

                      {/* Duration */}
                      <td className="py-3 px-4 text-center font-mono text-[11px] text-slate-400 whitespace-nowrap">
                        {clip.duration ? `${clip.duration.toFixed(0)}s` : '60s'}
                      </td>

                      {/* Viral Score */}
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        <span className="text-amber-400 text-xs font-bold flex items-center justify-center gap-1" title={`${clip.viral_score}/10`}>
                          <Flame size={12} className="text-amber-400" />
                          <span>{clip.viral_score}</span>
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleCopyQuote(clip.title, clip.transcript_snippet)}
                            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                            title="Copy Quote"
                          >
                            {copiedId === clip.title ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                          </button>
                          <a
                            href={getAudioUrl(clip)}
                            download
                            className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded-lg transition-colors"
                            title="Download MP3"
                          >
                            <Download size={13} />
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PERSISTENT PRO AUDIO DOCK (Sticky at bottom when any clip is active) */}
      {activeClip && (
        <div className="fixed bottom-4 left-4 right-4 max-w-5xl mx-auto z-50 animate-in fade-in slide-in-from-bottom-5 duration-300">
          <div className="p-3.5 sm:p-4 bg-slate-950/95 border border-indigo-500/40 rounded-2xl shadow-2xl shadow-black/80 backdrop-blur-xl flex flex-col md:flex-row items-center justify-between gap-3 sm:gap-4">
            {/* Left: Info & Soundwave */}
            <div className="flex items-center gap-3 min-w-0 w-full md:w-auto">
              <div className="relative">
                <button
                  onClick={() => handlePlayClip(activeClip)}
                  className="w-11 h-11 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white flex items-center justify-center flex-shrink-0 shadow-lg shadow-indigo-600/40 cursor-pointer transition-all hover:scale-105 active:scale-95"
                  title={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? <Pause size={20} /> : <Play size={20} className="translate-x-0.5" />}
                </button>
                {isPlaying && (
                  <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-slate-950 animate-pulse" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs sm:text-sm font-bold text-white truncate max-w-[280px]">
                    {activeClip.title}
                  </h4>
                  <span className={`hidden sm:inline-block px-2 py-0.2 text-[9px] font-bold uppercase rounded-md border ${getCategoryColor(activeClip.category).badge}`}>
                    {activeClip.category}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 truncate flex items-center gap-1.5 mt-0.5">
                  <span className="text-sky-400 font-medium">{formatEpisodeTitle(activeClip.episode)}</span>
                  <span>•</span>
                  <span className="font-mono text-slate-300">
                    {formatSec(currentTime)} / {formatSec(duration || activeClip.duration || 0)}
                  </span>
                </p>
              </div>
            </div>

            {/* Middle: Controls & Timeline */}
            <div className="flex flex-col items-center gap-2 w-full md:w-1/2">
              <div className="flex items-center gap-3">
                {/* Prev */}
                <button
                  onClick={handlePrevClip}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-900 rounded-lg transition-colors cursor-pointer"
                  title="Previous Clip"
                >
                  <SkipBack size={16} />
                </button>

                {/* Back 15s */}
                <button
                  onClick={() => handleSkipClip(-15)}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-900 rounded-lg transition-colors cursor-pointer relative"
                  title="Skip back 15s"
                >
                  <RotateCcw size={15} />
                  <span className="text-[8px] font-bold absolute -bottom-1 -right-0.5 text-indigo-300">15</span>
                </button>

                {/* Ahead 15s */}
                <button
                  onClick={() => handleSkipClip(15)}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-900 rounded-lg transition-colors cursor-pointer relative"
                  title="Skip ahead 15s"
                >
                  <RotateCw size={15} />
                  <span className="text-[8px] font-bold absolute -bottom-1 -right-0.5 text-indigo-300">15</span>
                </button>

                {/* Next */}
                <button
                  onClick={handleNextClip}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-900 rounded-lg transition-colors cursor-pointer"
                  title="Next Clip"
                >
                  <SkipForward size={16} />
                </button>

                {/* Speed toggle */}
                <button
                  onClick={handleCycleClipSpeed}
                  className="px-2 py-0.5 bg-slate-900 hover:bg-slate-850 text-indigo-300 border border-slate-800 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
                  title="Cycle Playback Speed"
                >
                  <Gauge size={10} />
                  <span>{clipSpeed}x</span>
                </button>
              </div>

              {/* Progress Bar */}
              <div className="w-full flex items-center gap-2">
                <span className="text-[10px] font-mono text-slate-400 min-w-[32px] text-right">
                  {formatSec(currentTime)}
                </span>
                <input
                  type="range"
                  min="0"
                  max={duration || 100}
                  value={currentTime}
                  onChange={e => {
                    const val = parseFloat(e.target.value);
                    setCurrentTime(val);
                    if (audioRef.current) audioRef.current.currentTime = val;
                  }}
                  className="w-full accent-indigo-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                />
                <span className="text-[10px] font-mono text-slate-400 min-w-[32px]">
                  {formatSec(duration || activeClip.duration || 0)}
                </span>
              </div>
            </div>

            {/* Right: Volume & Download */}
            <div className="flex items-center gap-3 self-end md:self-auto flex-shrink-0">
              {/* Volume Slider */}
              <div className="hidden sm:flex items-center gap-2">
                <button
                  onClick={handleToggleMute}
                  className="text-slate-400 hover:text-white p-1 rounded cursor-pointer"
                  title={isMuted ? 'Unmute' : 'Mute'}
                >
                  {isMuted || volume === 0 ? <VolumeX size={15} className="text-rose-400" /> : <Volume2 size={15} />}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={e => handleVolumeChange(parseFloat(e.target.value))}
                  className="w-16 accent-indigo-500 cursor-pointer h-1 bg-slate-800 rounded-lg"
                  title={`Volume: ${Math.round(volume * 100)}%`}
                />
              </div>

              <a
                href={getAudioUrl(activeClip)}
                download
                className="p-2 bg-slate-900 hover:bg-slate-850 text-slate-300 hover:text-emerald-400 border border-slate-800 rounded-xl transition-colors cursor-pointer"
                title="Download MP3"
              >
                <Download size={15} />
              </a>

              <button
                onClick={() => handleCopyQuote(activeClip.title, activeClip.transcript_snippet)}
                className="p-2 bg-slate-900 hover:bg-slate-850 text-slate-300 hover:text-indigo-400 border border-slate-800 rounded-xl transition-colors cursor-pointer"
                title="Copy Quote Snippet"
              >
                {copiedId === activeClip.title ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // Helper render function for individual clip card
  function renderClipCard(clip: ClipItem, idx: number) {
    const isThisPlaying = activeClip && activeClip.title === clip.title && isPlaying;
    const catColor = getCategoryColor(clip.category);
    const starsCount = Math.min(5, Math.max(1, Math.round((clip.viral_score || 8) / 2)));
    const audioUrl = getAudioUrl(clip);

    return (
      <div
        key={`${clip.title}-${idx}`}
        className={`p-5 rounded-2xl border transition-all flex flex-col justify-between relative group ${
          isThisPlaying
            ? 'bg-slate-900/95 border-indigo-500/70 shadow-xl shadow-indigo-500/10 ring-1 ring-indigo-500/50'
            : 'bg-slate-900/70 border-slate-800/90 hover:border-slate-700 hover:bg-slate-850/80'
        }`}
      >
        <div>
          {/* Top Row: Category + Stars */}
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <span className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-md border ${catColor.badge}`}>
              {catColor.icon} {clip.category || 'Highlight'}
            </span>
            <div className="flex items-center gap-1 text-amber-400 text-xs" title={`Viral Score: ${clip.viral_score}/10`}>
              {'⭐'.repeat(starsCount)}
              <span className="text-[10px] font-bold text-slate-400 ml-1">
                {clip.viral_score}/10
              </span>
            </div>
          </div>

          {/* Space Episode Banner (if not grouped) */}
          {viewMode !== 'grouped' && clip.episode && (
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-sky-400 bg-sky-950/40 border border-sky-800/40 px-2.5 py-1 rounded-lg mb-2.5 w-fit max-w-full">
              <Radio size={12} className="flex-shrink-0 text-sky-400" />
              <span className="truncate" title={formatEpisodeTitle(clip.episode)}>
                {formatEpisodeTitle(clip.episode)}
              </span>
            </div>
          )}

          {/* Title */}
          <h3 className="text-sm sm:text-base font-bold text-white mb-1.5 leading-snug group-hover:text-indigo-200 transition-colors">
            {clip.title}
          </h3>

          {/* Reason */}
          <p className="text-xs text-slate-400 mb-3 line-clamp-2 leading-relaxed">
            {clip.reason}
          </p>

          {/* Quote Dialogue Box */}
          <div className="p-3 bg-slate-950/80 border border-slate-800/90 rounded-xl mb-3.5 relative group/quote">
            <p className="text-[11px] text-slate-300 italic line-clamp-3 leading-relaxed">
              "{clip.transcript_snippet}"
            </p>
            <button
              onClick={() => handleCopyQuote(clip.title, clip.transcript_snippet)}
              className="absolute right-2 top-2 p-1 bg-slate-800/90 hover:bg-slate-700 text-slate-400 hover:text-white rounded opacity-0 group-hover/quote:opacity-100 transition-opacity cursor-pointer shadow-sm"
              title="Copy Quote"
            >
              {copiedId === clip.title ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
            </button>
          </div>
        </div>

        {/* Bottom Metadata & Playback Controls */}
        <div>
          <div className="flex items-center gap-3 text-[11px] text-slate-500 mb-3.5 flex-wrap">
            <span className="flex items-center gap-1 font-mono text-slate-400">
              <Clock size={11} />
              {clip.duration ? `${clip.duration.toFixed(0)}s` : 'Clip'}
            </span>
            {clip.speakers && clip.speakers.length > 0 && (
              <span className="flex items-center gap-1 truncate max-w-[220px]">
                <User size={11} className="text-emerald-400" />
                <span className="text-slate-400">{clip.speakers.join(', ')}</span>
              </span>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-800/70">
            <button
              onClick={() => handlePlayClip(clip)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-md ${
                isThisPlaying
                  ? 'bg-amber-500 text-slate-950 hover:bg-amber-400 shadow-amber-500/20'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/20 hover:scale-[1.02]'
              }`}
            >
              {isThisPlaying ? <Pause size={14} /> : <Play size={14} className="translate-x-0.2" />}
              <span>{isThisPlaying ? 'Pause Moment' : 'Play Moment'}</span>
            </button>

            <div className="flex items-center gap-1">
              <button
                onClick={() => handleCopyQuote(clip.title, clip.transcript_snippet)}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                title="Copy Quote"
              >
                {copiedId === clip.title ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
              </button>
              <a
                href={audioUrl}
                download
                className="p-2 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded-lg transition-colors"
                title="Download MP3"
              >
                <Download size={14} />
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }
};
