import React from 'react';
import {
  Search,
  X,
  Layers,
  LayoutGrid,
  LayoutList,
  ArrowUpDown,
  SlidersHorizontal,
  Radio,
  User,
  Star,
  RotateCcw,
} from 'lucide-react';
import { formatEpisodeTitle, getCategoryColor } from './clipUtils';

export interface ClipFilterBarProps {
  search: string;
  setSearch: (s: string) => void;
  viewMode: 'grouped' | 'grid' | 'list';
  setViewMode: (v: 'grouped' | 'grid' | 'list') => void;
  sortBy: 'newest' | 'viral' | 'oldest' | 'episode-az' | 'duration-desc' | 'duration-asc';
  setSortBy: (s: 'newest' | 'viral' | 'oldest' | 'episode-az' | 'duration-desc' | 'duration-asc') => void;
  categories: string[];
  categoryCounts: Record<string, number>;
  selectedCategory: string;
  setSelectedCategory: (c: string) => void;
  episodes: string[];
  selectedEpisode: string;
  setSelectedEpisode: (e: string) => void;
  speakers: { name: string; count: number }[];
  selectedSpeaker: string;
  setSelectedSpeaker: (s: string) => void;
  onlyTopRated: boolean;
  setOnlyTopRated: (b: boolean) => void;
  totalFilteredCount: number;
  onResetFilters: () => void;
}

export const ClipFilterBar: React.FC<ClipFilterBarProps> = ({
  search,
  setSearch,
  viewMode,
  setViewMode,
  sortBy,
  setSortBy,
  categories,
  categoryCounts,
  selectedCategory,
  setSelectedCategory,
  episodes,
  selectedEpisode,
  setSelectedEpisode,
  speakers,
  selectedSpeaker,
  setSelectedSpeaker,
  onlyTopRated,
  setOnlyTopRated,
  totalFilteredCount,
  onResetFilters,
}) => {
  const hasActiveFilters =
    search.trim() !== '' ||
    selectedCategory !== 'ALL' ||
    selectedEpisode !== 'ALL' ||
    selectedSpeaker !== 'ALL' ||
    onlyTopRated;

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-3.5 backdrop-blur-sm">
      {/* Row 1: Search Bar & Views */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search quotes, titles, topics, or speakers..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-9 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500 transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* View Mode Toggle */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('grouped')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer ${
                viewMode === 'grouped'
                  ? 'bg-indigo-600 text-white shadow-md'
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
                  ? 'bg-indigo-600 text-white shadow-md'
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
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Compact List / Tracklist View"
            >
              <LayoutList size={13} />
              <span className="hidden sm:inline">List</span>
            </button>
          </div>

          {/* Sort Dropdown */}
          <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-300">
            <ArrowUpDown size={13} className="text-indigo-400 flex-shrink-0" />
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as any)}
              className="bg-transparent text-white font-medium focus:outline-none cursor-pointer text-xs pr-1"
            >
              <option value="newest" className="bg-slate-900 text-white">📅 Chronological (Newest First)</option>
              <option value="oldest" className="bg-slate-900 text-white">⏳ Chronological (Oldest First)</option>
              <option value="viral" className="bg-slate-900 text-white">⭐ Highest Viral Score</option>
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
          return (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg font-medium transition-all whitespace-nowrap cursor-pointer ${
                isSelected
                  ? 'bg-indigo-600 text-white shadow-lg font-semibold'
                  : 'bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800/80'
              }`}
            >
              <span>{cat === 'ALL' ? 'All moments' : cat}</span>
              <span className={`px-1.5 py-0.2 rounded-md text-[11px] font-bold ${
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
        <span className="flex items-center gap-1 text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
          <SlidersHorizontal size={11} /> Filters:
        </span>

        {/* Episode Select */}
        <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800">
          <Radio size={12} className="text-slate-300 flex-shrink-0" />
          <select
            value={selectedEpisode}
            onChange={e => setSelectedEpisode(e.target.value)}
            className="bg-transparent text-white font-medium focus:outline-none cursor-pointer max-w-[180px] sm:max-w-[260px] truncate text-xs"
          >
            <option value="ALL" className="bg-slate-900 text-white">All Spaces ({episodes.length})</option>
            {episodes.map(ep => (
              <option key={ep} value={ep} className="bg-slate-900 text-white">
                {formatEpisodeTitle(ep)}
              </option>
            ))}
          </select>
        </div>

        {/* Speaker Select */}
        <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800">
          <User size={12} className="text-emerald-400 flex-shrink-0" />
          <select
            value={selectedSpeaker}
            onChange={e => setSelectedSpeaker(e.target.value)}
            className="bg-transparent text-white font-medium focus:outline-none cursor-pointer text-xs"
          >
            <option value="ALL" className="bg-slate-900 text-white">All Speakers</option>
            {speakers.map(({ name, count }) => (
              <option key={name} value={name} className="bg-slate-900 text-white">
                {name} ({count})
              </option>
            ))}
          </select>
        </div>

        {/* Top-Rated Toggle */}
        <button
          onClick={() => setOnlyTopRated(!onlyTopRated)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
            onlyTopRated
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
              : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
          }`}
        >
          <Star size={12} className={onlyTopRated ? 'text-amber-400 fill-amber-400' : 'text-slate-400'} />
          <span>Top Viral (8+)</span>
        </button>

        {/* Results Counter & Reset */}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-slate-400 font-mono">
            {totalFilteredCount} {totalFilteredCount === 1 ? 'clip' : 'clips'}
          </span>
          {hasActiveFilters && (
            <button
              onClick={onResetFilters}
              className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              <RotateCcw size={10} /> Reset
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
