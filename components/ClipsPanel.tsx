import React, { useState, useEffect, useRef } from 'react';
import {
  Flame,
  Play,
  Pause,
  Download,
  Copy,
  Check,
  Search,
  Volume2,
  Sparkles,
  Clock,
  User,
  ExternalLink,
  RefreshCw,
  Radio,
  ArrowUpDown,
  RotateCcw,
  RotateCw,
  Gauge
} from 'lucide-react';

interface ClipItem {
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
}

const formatEpisodeTitle = (ep?: string) => {
  if (!ep) return 'Unknown Space';
  let clean = ep.replace(/^20\d{6}_[a-zA-Z0-9]+_/, '');
  clean = clean.replace(/_/g, ' ').replace(/-/g, ' ').trim();
  return clean || ep;
};

export const ClipsPanel: React.FC = () => {
  const [clips, setClips] = useState<ClipItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'episode' | 'viral' | 'duration-desc' | 'duration-asc'>('episode');
  const [activeClipIndex, setActiveClipIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [clipSpeed, setClipSpeed] = useState(1);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

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

            // A. Check if release contains rich clips metadata JSON (e.g. *_clips.json or clips_catalog.json)
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
                      // Match MP3 asset in this release
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

                      // Check if already in combinedClips to replace placeholder or update URL
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

            // B. Also scan any standalone clip MP3 assets in this release
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
    } catch {
      setClips([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClips();
  }, []);

  const categories = ['ALL', ...Array.from(new Set(clips.map(c => c.category || 'Highlights')))];

  const filteredClips = clips
    .filter(c => {
      const matchesCategory = selectedCategory === 'ALL' || c.category === selectedCategory;
      const query = search.toLowerCase().trim();
      if (!query) return matchesCategory;

      const epTitle = formatEpisodeTitle(c.episode).toLowerCase();
      const matchesSearch =
        c.title.toLowerCase().includes(query) ||
        c.reason.toLowerCase().includes(query) ||
        c.transcript_snippet.toLowerCase().includes(query) ||
        (c.speakers && c.speakers.some(s => s.toLowerCase().includes(query))) ||
        (c.episode && c.episode.toLowerCase().includes(query)) ||
        epTitle.includes(query);

      return matchesCategory && matchesSearch;
    })
    .sort((a, b) => {
      if (sortBy === 'episode') {
        const epA = formatEpisodeTitle(a.episode).toLowerCase();
        const epB = formatEpisodeTitle(b.episode).toLowerCase();
        const epCmp = epA.localeCompare(epB, undefined, { numeric: true });
        if (epCmp !== 0) return epCmp;
        return (a.start_seconds || 0) - (b.start_seconds || 0);
      }
      if (sortBy === 'viral') {
        return (b.viral_score || 0) - (a.viral_score || 0);
      }
      if (sortBy === 'duration-desc') {
        return (b.duration || 0) - (a.duration || 0);
      }
      if (sortBy === 'duration-asc') {
        return (a.duration || 0) - (b.duration || 0);
      }
      return 0;
    });

  const getAudioUrl = (clip: ClipItem): string => {
    if (!clip.file_path) return '';
    if (clip.file_path.startsWith('http://') || clip.file_path.startsWith('https://')) {
      return clip.file_path;
    }
    // Normalize path to web-accessible /clips/... URL
    const rel = clip.file_path.replace(/\\/g, '/');
    const part = rel.includes('best_saved_clips/')
      ? rel.split('best_saved_clips/')[1]
      : rel.includes('clips/')
      ? rel.split('clips/')[1]
      : rel;
    return `/clips/${part}`;
  };

  const handlePlayClip = (idx: number) => {
    const clip = filteredClips[idx];
    if (!clip) return;

    if (activeClipIndex === idx && audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play();
        setIsPlaying(true);
      }
      return;
    }

    setActiveClipIndex(idx);
    const url = getAudioUrl(clip);
    if (audioRef.current) {
      audioRef.current.src = url;
      audioRef.current.playbackRate = clipSpeed;
      audioRef.current.play();
      setIsPlaying(true);
    }
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

  const handleCopyQuote = (idx: number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(idx);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatSec = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 md:p-10 pb-36 max-w-6xl mx-auto w-full space-y-6">
      {/* Audio element */}
      <audio
        ref={audioRef}
        onTimeUpdate={() => {
          if (audioRef.current) {
            setCurrentTime(audioRef.current.currentTime);
            setDuration(audioRef.current.duration || 0);
          }
        }}
        onEnded={() => setIsPlaying(false)}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-400">
              <Flame size={20} />
            </div>
            <h2 className="text-2xl font-bold text-white">Best Saved Clips</h2>
            <span className="px-2.5 py-0.5 text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30 rounded-full">
              AI Highlights
            </span>
          </div>
          <p className="text-slate-400 text-xs">
            Funniest punchlines, wildest stories, and top moments curated by Gemini 2.5 Flash from your Space replays.
          </p>
        </div>

        <button
          onClick={loadClips}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-colors"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh Library
        </button>
      </div>

      {/* Filters & Search & Sort */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search moments by topic, punchline, episode, or speaker..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          {/* Sort By Dropdown */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-400">
              <ArrowUpDown size={13} className="text-indigo-400" />
              <span className="text-[11px] text-slate-500 hidden sm:inline">Sort:</span>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as any)}
                className="bg-transparent text-white font-medium focus:outline-none cursor-pointer text-xs pr-1"
              >
                <option value="episode" className="bg-slate-900 text-white">Space Episode Name (Default)</option>
                <option value="viral" className="bg-slate-900 text-white">Viral Score (Highest)</option>
                <option value="duration-desc" className="bg-slate-900 text-white">Duration (Longest)</option>
                <option value="duration-asc" className="bg-slate-900 text-white">Duration (Shortest)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-all whitespace-nowrap cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
                  : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800'
              }`}
            >
              {cat === 'ALL' ? 'All Moments' : cat}
            </button>
          ))}
        </div>
      </div>

      {/* Persistent Now Playing Bar if active */}
      {activeClipIndex !== null && filteredClips[activeClipIndex] && (
        <div className="p-4 bg-indigo-950/40 border border-indigo-500/30 rounded-2xl shadow-xl flex flex-col sm:flex-row items-center justify-between gap-4 backdrop-blur">
          <div className="flex items-center gap-2.5 min-w-0 w-full sm:w-auto">
            {/* Skip back 15s */}
            <button
              onClick={() => handleSkipClip(-15)}
              className="group relative p-2 text-slate-400 hover:text-white hover:bg-slate-800/80 rounded-full transition-all cursor-pointer flex-shrink-0"
              title="Skip back 15s"
              aria-label="Skip back 15 seconds"
            >
              <RotateCcw size={15} />
              <span className="absolute -bottom-1 -right-0.5 text-[8px] font-bold text-slate-400 group-hover:text-indigo-300">
                15
              </span>
            </button>

            {/* Play/Pause */}
            <button
              onClick={() => handlePlayClip(activeClipIndex)}
              className="w-10 h-10 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center flex-shrink-0 shadow-lg shadow-indigo-600/30 cursor-pointer transition-all hover:scale-105"
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} className="translate-x-0.5" />}
            </button>

            {/* Skip forward 15s */}
            <button
              onClick={() => handleSkipClip(15)}
              className="group relative p-2 text-slate-400 hover:text-white hover:bg-slate-800/80 rounded-full transition-all cursor-pointer flex-shrink-0"
              title="Skip ahead 15s"
              aria-label="Skip ahead 15 seconds"
            >
              <RotateCw size={15} />
              <span className="absolute -bottom-1 -right-0.5 text-[8px] font-bold text-slate-400 group-hover:text-indigo-300">
                15
              </span>
            </button>

            {/* Speed toggle */}
            <button
              onClick={handleCycleClipSpeed}
              className="px-2 py-1 bg-slate-900 hover:bg-slate-800 text-indigo-300 border border-slate-800 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors flex-shrink-0 cursor-pointer"
              title="Change Playback Speed"
            >
              <Gauge size={11} />
              <span>{clipSpeed}x</span>
            </button>

            <div className="min-w-0 ml-1">
              <p className="text-xs font-semibold text-white truncate">
                {filteredClips[activeClipIndex].title}
              </p>
              <p className="text-[11px] text-indigo-300/70 truncate flex items-center gap-1.5">
                <span>{filteredClips[activeClipIndex].category}</span>
                <span>•</span>
                <span>{formatSec(currentTime)} / {formatSec(duration || filteredClips[activeClipIndex].duration || 0)}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-1/2">
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
            <a
              href={getAudioUrl(filteredClips[activeClipIndex])}
              download
              className="p-2 text-slate-400 hover:text-emerald-400 hover:bg-slate-800/80 rounded-lg transition-colors flex-shrink-0"
              title="Download MP3 Clip"
            >
              <Download size={15} />
            </a>
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="text-center py-20">
          <RefreshCw size={24} className="animate-spin text-slate-500 mx-auto mb-3" />
          <p className="text-xs text-slate-400">Loading highlights library...</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && filteredClips.length === 0 && (
        <div className="text-center py-20 bg-slate-900/50 border border-slate-800 rounded-2xl p-8 max-w-md mx-auto">
          <Sparkles size={32} className="text-amber-400/60 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-white mb-1">No Clips Found</h3>
          <p className="text-xs text-slate-500 mb-4">
            {search ? 'Try adjusting your search query or category filter.' : 'Run the AI highlight extractor to generate your first set of clips.'}
          </p>
          <code className="text-[10px] bg-slate-950 text-indigo-300 p-2 rounded block text-left">
            python scripts/find_and_cut_best_clips.py --all --limit 3
          </code>
        </div>
      )}

      {/* Clips Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredClips.map((clip, idx) => {
          const isThisPlaying = activeClipIndex === idx && isPlaying;
          const starsCount = Math.min(5, Math.max(1, Math.round((clip.viral_score || 8) / 2)));
          const audioUrl = getAudioUrl(clip);

          return (
            <div
              key={idx}
              className={`p-5 rounded-2xl border transition-all flex flex-col justify-between ${
                isThisPlaying
                  ? 'bg-slate-900/90 border-indigo-500/50 shadow-lg shadow-indigo-500/10'
                  : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div>
                {/* Top badge row */}
                <div className="flex items-center justify-between gap-2 mb-2.5">
                  <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-slate-800 text-indigo-300 rounded-md border border-slate-700">
                    {clip.category || 'Highlight'}
                  </span>
                  <div className="flex items-center gap-1 text-amber-400 text-xs" title={`Viral Score: ${clip.viral_score}/10`}>
                    {'⭐'.repeat(starsCount)}
                    <span className="text-[10px] font-bold text-slate-400 ml-1">
                      {clip.viral_score}/10
                    </span>
                  </div>
                </div>

                {/* Space Episode Banner */}
                {clip.episode && (
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-sky-400 bg-sky-950/40 border border-sky-800/40 px-2.5 py-1 rounded-lg mb-2.5 w-fit max-w-full">
                    <Radio size={12} className="flex-shrink-0 text-sky-400" />
                    <span className="truncate" title={formatEpisodeTitle(clip.episode)}>
                      {formatEpisodeTitle(clip.episode)}
                    </span>
                  </div>
                )}

                {/* Title */}
                <h3 className="text-sm font-bold text-white mb-1.5 leading-snug">
                  {clip.title}
                </h3>

                {/* Why It's Great */}
                <p className="text-xs text-slate-400 mb-3 line-clamp-2 leading-relaxed">
                  {clip.reason}
                </p>

                {/* Quote Box */}
                <div className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-xl mb-3.5 relative group">
                  <p className="text-[11px] text-slate-300 italic line-clamp-3 leading-relaxed">
                    "{clip.transcript_snippet}"
                  </p>
                  <button
                    onClick={() => handleCopyQuote(idx, clip.transcript_snippet)}
                    className="absolute right-2 top-2 p-1 bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Copy Quote"
                  >
                    {copiedId === idx ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                  </button>
                </div>
              </div>

              {/* Footer Meta & Controls */}
              <div>
                <div className="flex items-center gap-3 text-[11px] text-slate-500 mb-3.5 flex-wrap">
                  <span className="flex items-center gap-1">
                    <Clock size={11} />
                    {clip.duration ? `${clip.duration.toFixed(0)}s` : 'Clip'}
                  </span>
                  {clip.speakers && clip.speakers.length > 0 && (
                    <span className="flex items-center gap-1 truncate max-w-[200px]">
                      <User size={11} />
                      {clip.speakers.join(', ')}
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-800/60">
                  <button
                    onClick={() => handlePlayClip(idx)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                      isThisPlaying
                        ? 'bg-amber-500 text-slate-950 hover:bg-amber-400 shadow-md shadow-amber-500/20'
                        : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/20'
                    }`}
                  >
                    {isThisPlaying ? <Pause size={13} /> : <Play size={13} className="translate-x-0.5" />}
                    {isThisPlaying ? 'Pause Clip' : 'Play Highlight'}
                  </button>

                  <div className="flex items-center gap-1">
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
        })}
      </div>
    </div>
  );
};
