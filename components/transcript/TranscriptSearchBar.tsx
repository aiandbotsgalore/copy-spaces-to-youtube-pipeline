import React from 'react';
import {
  Search, SlidersHorizontal, AlertCircle, X, Loader, Globe, FileText,
  Layers, Radio, Users, ShieldAlert, Headphones, Tag
} from 'lucide-react';
import { Release } from '../../types';
import {
  SearchEngineMode,
  SearchIndexEpisode,
  EpisodeSummary,
} from './useTranscriptSession';

export interface ThematicCategory {
  id: string;
  name: string;
  emoji: string;
  description: string;
  keywords: string[];
}

export const THEMATIC_CATEGORIES: ThematicCategory[] = [
  {
    id: 'ALL',
    name: 'All Categories',
    emoji: '📋',
    description: 'All transcribed turns',
    keywords: [],
  },
  {
    id: 'DOXXING',
    name: 'Doxxing Admissions',
    emoji: '🎯',
    description: 'Admissions of releasing personal info, front door photos, addresses',
    keywords: ['dox', 'doxx', 'doxed', 'doxxing', 'front door', 'address', 'phone number', 'personal info', 'infiltrat', 'second device', 'screenshot'],
  },
  {
    id: 'LEGAL',
    name: 'Lawsuits & Bankruptcy',
    emoji: '⚖️',
    description: 'Threats to bankrupt, sue, drag through court, cease and desist',
    keywords: ['lawsuit', 'bankrupt', 'sue', 'court', 'attorney', 'cease and desist', 'damages', 'out of pocket', 'slap them with', 'powerpoint'],
  },
  {
    id: 'AUTHORITIES',
    name: 'Police, IC3 & CPS',
    emoji: '🚔',
    description: 'Law enforcement reports, federal filings, IC3, CPS, well checks',
    keywords: ['police', 'cop', 'ic3', 'cps', 'well check', 'investigat', 'federal', 'fbi', 'report', 'vital records'],
  },
  {
    id: 'SEXUAL_AI',
    name: 'AI Deepfakes & Predators',
    emoji: '⚠️',
    description: 'Accusations of generating AI porn, platforming predators, deepfakes of minors',
    keywords: ['predator', 'ai porn', 'deepfake', 'pedophile', 'nudes', 'minor', 'porn', 'fucking porn', 'sexual'],
  },
  {
    id: 'HAREM_CULT',
    name: 'AI Harem & Manipulation',
    emoji: '🕸️',
    description: 'Accusations of running an AI harem, triangulating women, psychological ops',
    keywords: ['harem', 'triangulat', 'impressionable', 'cult', 'manipulat', 'validation', 'back channels', 'proxy', 'psychological operations'],
  },
  {
    id: 'MILITARY_CIA',
    name: 'CIA & Military Claims',
    emoji: '🛡️',
    description: 'Claims of intelligence ties, CIA, military clearance, classified tech',
    keywords: ['cia', 'intelligence', 'clearance', 'military', 'defense', 'classified', 'air force', 'contractor', 'ops'],
  },
];

export interface MentionTarget {
  id: string;
  name: string;
  keywords: string[];
}

export const MENTION_TARGETS: MentionTarget[] = [
  { id: 'ALL', name: 'All Mentions', keywords: [] },
  { id: 'LOGAN', name: 'Logan (Host)', keywords: ['logan', 'host'] },
  { id: 'ANGELA', name: 'Angela Maggard', keywords: ['angela', 'maggard'] },
  { id: 'BRIAN', name: 'Brian', keywords: ['brian'] },
  { id: 'DANIELLE', name: 'Danielle', keywords: ['danielle'] },
  { id: 'SULLY', name: 'Sully', keywords: ['sully'] },
  { id: 'TONY', name: 'Tony', keywords: ['tony'] },
  { id: 'DAVID_GRUSCH', name: 'David Grusch', keywords: ['grusch', 'david grusch'] },
];

export interface TranscriptSearchBarProps {
  search: string;
  setSearch: (val: string) => void;
  searchScope: 'current' | 'all';
  setSearchScope: (scope: 'current' | 'all') => void;
  loadGlobalIndex: () => void;
  selectedRelease: Release | null | undefined;
  summaryIndex: EpisodeSummary[] | null;
  globalIndex: SearchIndexEpisode[] | null;
  totalGlobalSegments: number;
  globalIndexLoading: boolean;
  isGlobalFilteringActive: boolean;
  matchCount: number;
  episodeMatchCount: number;
  serverSearching: boolean;
  workerSearching: boolean;
  searchEngineMode: SearchEngineMode;
  setSearchEngineMode: (mode: SearchEngineMode) => void;
  searchFallbackNotice: string | null;
  setSearchFallbackNotice: (notice: string | null) => void;
  selectedGlobalTag: string;
  setSelectedGlobalTag: (tag: string) => void;
  selectedGlobalSpeaker: string;
  setSelectedGlobalSpeaker: (speaker: string) => void;
  allArchiveSpeakers: Array<{ name: string; episodeCount: number; count: number }>;
  selectedMentionTarget: string;
  setSelectedMentionTarget: (target: string) => void;
  selectedCategory: string;
  setSelectedCategory: (cat: string) => void;
  selectedSpeakerEpisodeCount: number;
  angelaEpisodeCount: number;
  speakerZipLoading: boolean;
  audioZipLoading: boolean;
  handleDownloadSpeakerZip: (speaker: string) => void;
  handleDownloadSpeakerAudioZip: (speaker: string) => void;
}

export const TranscriptSearchBar: React.FC<TranscriptSearchBarProps> = ({
  search,
  setSearch,
  searchScope,
  setSearchScope,
  loadGlobalIndex,
  selectedRelease,
  summaryIndex,
  globalIndex,
  totalGlobalSegments,
  globalIndexLoading,
  isGlobalFilteringActive,
  matchCount,
  episodeMatchCount,
  serverSearching,
  workerSearching,
  searchEngineMode,
  setSearchEngineMode,
  searchFallbackNotice,
  setSearchFallbackNotice,
  selectedGlobalTag,
  setSelectedGlobalTag,
  selectedGlobalSpeaker,
  setSelectedGlobalSpeaker,
  allArchiveSpeakers,
  selectedMentionTarget,
  setSelectedMentionTarget,
  selectedCategory,
  setSelectedCategory,
  selectedSpeakerEpisodeCount,
  angelaEpisodeCount,
  speakerZipLoading,
  audioZipLoading,
  handleDownloadSpeakerZip,
  handleDownloadSpeakerAudioZip,
}) => {
  return (
    <div className="p-4 md:px-8 bg-slate-900/90 border-b border-slate-800/80 space-y-3.5 flex-shrink-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Scope Selector */}
          <div className="inline-flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 shadow-inner">
            <button
              onClick={() => { setSearchScope('all'); loadGlobalIndex(); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                searchScope === 'all'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Globe size={13} />
              <span>All Transcripts</span>
              <span className="px-1.5 py-0.2 bg-white/20 rounded-full text-[11px] font-semibold ml-0.5">
                {summaryIndex ? summaryIndex.length : (globalIndex ? globalIndex.length : 241)}
              </span>
            </button>
            {selectedRelease && (
              <button
                onClick={() => setSearchScope('current')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  searchScope === 'current'
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <FileText size={13} />
                <span className="truncate max-w-[150px]">{selectedRelease.name || selectedRelease.tag_name}</span>
              </button>
            )}
          </div>

          <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400 pl-1">
            <Layers size={13} className="text-indigo-400" />
            <span className="font-semibold text-slate-200">
              {totalGlobalSegments > 0 ? totalGlobalSegments.toLocaleString() : '359,000+'}
            </span>
            <span>indexed turns</span>
          </div>
        </div>

        {/* Right status */}
        <div className="flex items-center gap-2">
          {globalIndexLoading && (
            <span className="flex items-center gap-1.5 text-xs text-indigo-400 animate-pulse font-medium">
              <Loader size={12} className="animate-spin" /> Loading transcript database…
            </span>
          )}
          {isGlobalFilteringActive && !globalIndexLoading && (
            <span className="text-xs text-amber-400 font-medium px-2.5 py-1 bg-amber-500/10 border border-amber-500/30 rounded-lg shadow-sm inline-flex items-center gap-1.5">
              {matchCount.toLocaleString()} match{matchCount !== 1 ? 'es' : ''}
              {episodeMatchCount > 0 && ` across ${episodeMatchCount} episode${episodeMatchCount > 1 ? 's' : ''}`}
              {serverSearching ? (
                <span className="px-1.5 py-0.2 bg-indigo-950/80 text-[11px] text-indigo-300 rounded font-mono border border-indigo-500/30 inline-flex items-center gap-1">
                  <Loader size={9} className="animate-spin text-indigo-400" /> Server Rerank
                </span>
              ) : (
                <span className="px-1.5 py-0.2 bg-emerald-950/80 text-[11px] text-emerald-300 rounded font-mono border border-emerald-500/30" title="Background Web Worker search engine active (60fps UI)">
                  ⚡ 60fps Worker
                </span>
              )}
              {searchEngineMode === 'rerank' && (
                <span className="px-1.5 py-0.2 bg-amber-950/80 text-[11px] text-amber-300 rounded font-mono border border-amber-500/30">
                  Deep Rerank
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Fallback Notice Banner */}
      {searchFallbackNotice && (
        <div className="flex items-center justify-between p-2.5 px-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-200 shadow-sm gap-2">
          <span className="flex items-center gap-2">
            <AlertCircle size={14} className="text-amber-400 flex-shrink-0" />
            <span>{searchFallbackNotice}</span>
          </span>
          <button onClick={() => setSearchFallbackNotice(null)} className="text-amber-400 hover:text-white p-1 cursor-pointer">
            <X size={13} />
          </button>
        </div>
      )}

      {/* Global Search Bar and Filter Dropdowns */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[280px]">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-indigo-400" />
          <input
            type="text"
            autoFocus
            placeholder={`Search across all ${summaryIndex?.length || globalIndex?.length || 241} transcripts (e.g. aliens, speaker:Angela, from:Logan)…`}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-9 py-2.5 bg-slate-950 border border-slate-700/90 focus:border-indigo-500 rounded-xl text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 shadow-inner"
          />
          {(workerSearching || serverSearching) && (
            <div className="absolute right-9 top-1/2 -translate-y-1/2 flex items-center gap-1 px-1.5 py-0.5 bg-indigo-950/90 border border-indigo-500/40 rounded text-[11px] text-indigo-300 font-mono shadow-sm pointer-events-none">
              <Loader size={10} className="animate-spin text-indigo-400" />
              <span>{serverSearching ? 'reranking…' : 'off-thread…'}</span>
            </div>
          )}
          {search && !workerSearching && !serverSearching && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1 rounded-md hover:bg-slate-800 transition-colors cursor-pointer"
              title="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Search Engine Retrieval Mode Selector */}
        <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 shadow-sm" title="Search retrieval algorithm">
          <SlidersHorizontal size={12} className={searchEngineMode === 'rerank' ? 'text-amber-400' : 'text-indigo-400'} />
          <select
            value={searchEngineMode}
            onChange={e => setSearchEngineMode(e.target.value as SearchEngineMode)}
            className="bg-transparent text-xs text-slate-300 focus:outline-none cursor-pointer"
            title="Select search algorithm"
          >
            <option value="hybrid" className="bg-slate-900 text-white">Hybrid (BM25 + Vector)</option>
            <option value="rerank" className="bg-slate-900 text-white">Deep Rerank (Cohere 5)</option>
            <option value="lexical" className="bg-slate-900 text-white">Lexical (Keyword)</option>
            <option value="vector" className="bg-slate-900 text-white">Vector (Semantic)</option>
          </select>
        </div>

        {/* Episode filter */}
        {((summaryIndex && summaryIndex.length > 0) || (globalIndex && globalIndex.length > 0)) && (
          <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 shadow-sm">
            <Radio size={12} className="text-indigo-400 flex-shrink-0" />
            <select
              value={selectedGlobalTag}
              onChange={e => setSelectedGlobalTag(e.target.value)}
              className="bg-transparent text-xs text-slate-300 focus:outline-none cursor-pointer max-w-[170px] truncate"
              title="Filter by episode"
            >
              <option value="ALL" className="bg-slate-900 text-white">All Episodes ({(summaryIndex || globalIndex)?.length || 241})</option>
              {(summaryIndex || globalIndex || []).map(ep => (
                <option key={ep.release_tag} value={ep.release_tag} className="bg-slate-900 text-white">
                  {ep.title || ep.release_tag}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Speaker filter — Always visible and accessible */}
        <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 shadow-sm">
          <Users size={12} className="text-emerald-400 flex-shrink-0" />
          <select
            value={selectedGlobalSpeaker}
            onChange={e => {
              setSelectedGlobalSpeaker(e.target.value);
              if (!globalIndex && !globalIndexLoading) {
                loadGlobalIndex();
              }
            }}
            className="bg-transparent text-xs text-slate-300 focus:outline-none cursor-pointer max-w-[170px] truncate"
            title="Filter by speaker across all episodes"
          >
            <option value="ALL" className="bg-slate-900 text-white">
              All Speakers {allArchiveSpeakers.length > 0 ? `(${allArchiveSpeakers.length})` : ''}
            </option>
            {allArchiveSpeakers.map(spk => (
              <option key={spk.name} value={spk.name} className="bg-slate-900 text-white">
                {spk.name.toLowerCase() === 'angela' ? `⭐ ${spk.name}` : spk.name} ({spk.episodeCount} space{spk.episodeCount !== 1 ? 's' : ''}{spk.count > 0 ? `, ${spk.count} turns` : ''})
              </option>
            ))}
          </select>
        </div>

        {/* Target Mention Filter (e.g. Angela talking about Logan) */}
        <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 shadow-sm">
          <ShieldAlert size={12} className="text-amber-400 flex-shrink-0" />
          <select
            value={selectedMentionTarget}
            onChange={e => {
              setSelectedMentionTarget(e.target.value);
              if (!globalIndex && !globalIndexLoading) loadGlobalIndex();
            }}
            className="bg-transparent text-xs text-slate-300 focus:outline-none cursor-pointer max-w-[175px] truncate"
            title="Filter speaker turns mentioning a specific person or topic"
          >
            {MENTION_TARGETS.map(m => (
              <option key={m.id} value={m.id} className="bg-slate-900 text-white">
                {m.name}
              </option>
            ))}
          </select>
        </div>

        {/* Speaker ZIP Download Action Buttons */}
        {selectedGlobalSpeaker !== 'ALL' && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleDownloadSpeakerZip(selectedGlobalSpeaker)}
              disabled={speakerZipLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700 text-slate-200 rounded-lg text-xs font-semibold shadow-sm transition-all cursor-pointer whitespace-nowrap"
              title={`Download all transcripts featuring ${selectedGlobalSpeaker} in one ZIP archive`}
            >
              <FileText size={12} className={speakerZipLoading ? 'animate-bounce text-emerald-400' : 'text-emerald-400'} />
              <span>
                {speakerZipLoading
                  ? 'Creating ZIP…'
                  : `Download ${selectedSpeakerEpisodeCount} Spaces (.zip)`}
              </span>
            </button>
            {selectedGlobalSpeaker.toLowerCase() === 'angela' && (
              <button
                onClick={() => handleDownloadSpeakerAudioZip('Angela')}
                disabled={audioZipLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-md transition-all cursor-pointer whitespace-nowrap"
                title="Download all 47 master audio clips of Angela (.wav & .mp3, 38.6 MB) in one ZIP archive"
              >
                <Headphones size={13} className={audioZipLoading ? 'animate-bounce' : ''} />
                <span>
                  {audioZipLoading ? 'Downloading…' : 'Download Audio Clips (.zip)'}
                </span>
                <span className="px-1.5 py-0.5 bg-emerald-800/80 text-[11px] rounded-full text-emerald-200 font-mono">
                  47 clips
                </span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Quick Speaker Selector & Angela Quick Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs border-t border-slate-800/60 mt-1">
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5 max-w-full">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex-shrink-0 flex items-center gap-1">
            <Users size={11} className="text-emerald-400" /> Featured Speaker:
          </span>
          <button
            onClick={() => {
              setSelectedGlobalSpeaker(selectedGlobalSpeaker === 'Angela' ? 'ALL' : 'Angela');
              if (!globalIndex && !globalIndexLoading) loadGlobalIndex();
            }}
            className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 flex-shrink-0 transition-all cursor-pointer border ${
              selectedGlobalSpeaker === 'Angela'
                ? 'bg-emerald-600 border-emerald-500 text-white shadow-md ring-1 ring-emerald-400'
                : 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300 hover:bg-emerald-900/50 hover:text-white'
            }`}
            title="Filter all spaces featuring Angela"
          >
            <span>⭐ Angela</span>
            <span className="text-[11px] opacity-80">({angelaEpisodeCount} spaces)</span>
          </button>
          <button
            onClick={() => handleDownloadSpeakerZip('Angela')}
            disabled={speakerZipLoading}
            className="px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 flex-shrink-0 bg-slate-900/90 border border-slate-800 text-slate-300 hover:text-emerald-300 hover:border-emerald-500/40 transition-colors cursor-pointer shadow-sm"
            title="Directly download all Angela transcripts as a single ZIP file"
          >
            <FileText size={11} className="text-emerald-400" />
            <span>Download Angela ({angelaEpisodeCount} Spaces .zip)</span>
          </button>
          <button
            onClick={() => handleDownloadSpeakerAudioZip('Angela')}
            disabled={audioZipLoading}
            className="px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 flex-shrink-0 bg-emerald-950/70 border border-emerald-500/50 text-emerald-300 hover:bg-emerald-900/80 hover:text-white transition-all cursor-pointer shadow-sm"
            title="Directly download all 47 master audio clips of Angela as a single ZIP archive (.wav & .mp3)"
          >
            <Headphones size={11} className="text-emerald-400" />
            <span>Download Audio Clips (47 Clips .zip)</span>
          </button>
        </div>

        {selectedGlobalSpeaker !== 'ALL' && (
          <button
            onClick={() => setSelectedGlobalSpeaker('ALL')}
            className="text-[11px] text-slate-400 hover:text-slate-200 underline ml-auto cursor-pointer"
          >
            Reset speaker filter
          </button>
        )}
      </div>

      {/* Thematic Category Dossier Chips */}
      <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-800/60 mt-1">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1 mr-1">
          <Tag size={10} className="text-indigo-400" /> Dossier Themes:
        </span>
        {THEMATIC_CATEGORIES.map(cat => {
          const isSelected = selectedCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => {
                setSelectedCategory(isSelected ? 'ALL' : cat.id);
                if (!globalIndex && !globalIndexLoading) loadGlobalIndex();
              }}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer border ${
                isSelected
                  ? 'bg-indigo-600 border-indigo-400 text-white shadow-md ring-1 ring-indigo-300'
                  : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white'
              }`}
              title={`Filter quotes in theme: ${cat.name}`}
            >
              <span>{cat.emoji}</span>
              <span>{cat.name}</span>
            </button>
          );
        })}
        {selectedCategory !== 'ALL' && (
          <button
            onClick={() => setSelectedCategory('ALL')}
            className="text-[11px] text-slate-400 hover:text-slate-300 underline ml-1 cursor-pointer"
          >
            Reset theme filter
          </button>
        )}
      </div>
    </div>
  );
};
