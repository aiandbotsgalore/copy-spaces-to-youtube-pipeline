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
  RefreshCw
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

export const ClipsPanel: React.FC = () => {
  const [clips, setClips] = useState<ClipItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [activeClipIndex, setActiveClipIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const loadClips = async () => {
    setLoading(true);
    try {
      const res = await fetch('/clips/clips_catalog.json');
      if (res.ok) {
        const data = await res.json();
        setClips(Array.isArray(data) ? data : []);
      } else {
        setClips([]);
      }
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

  const filteredClips = clips.filter(c => {
    const matchesCategory = selectedCategory === 'ALL' || c.category === selectedCategory;
    const query = search.toLowerCase().trim();
    if (!query) return matchesCategory;

    const matchesSearch =
      c.title.toLowerCase().includes(query) ||
      c.reason.toLowerCase().includes(query) ||
      c.transcript_snippet.toLowerCase().includes(query) ||
      (c.speakers && c.speakers.some(s => s.toLowerCase().includes(query))) ||
      (c.episode && c.episode.toLowerCase().includes(query));

    return matchesCategory && matchesSearch;
  });

  const getAudioUrl = (clip: ClipItem): string => {
    if (!clip.file_path) return '';
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
      audioRef.current.play();
      setIsPlaying(true);
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
    <div className="max-w-6xl mx-auto space-y-6">
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

      {/* Filters & Search */}
      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search moments by topic, punchline, or speaker..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
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
          <div className="flex items-center gap-3 min-w-0 w-full sm:w-auto">
            <button
              onClick={() => handlePlayClip(activeClipIndex)}
              className="w-10 h-10 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center flex-shrink-0 shadow-lg shadow-indigo-600/30 cursor-pointer transition-all hover:scale-105"
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} className="translate-x-0.5" />}
            </button>
            <div className="min-w-0">
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
