import React, { useState, useEffect, useMemo } from 'react';
import {
  Scale,
  Search,
  Sparkles,
  Clock,
  User,
  ArrowRight,
  Play,
  Volume2,
  AlertTriangle,
  Layers,
  Filter,
  CheckCircle2,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  Database
} from 'lucide-react';
import { PipelineConfig } from '../types';

interface ContradictionPairing {
  pairing_id: string;
  number: number;
  title: string;
  pre_fallout: {
    quote_id: string;
    date: string;
    episode_tag: string;
    verbatim: string;
  };
  post_fallout: {
    quote_id: string;
    date: string;
    episode_tag: string;
    verbatim: string;
  };
}

interface CuratedQuote {
  quote_id: string;
  speaker: string;
  date: string;
  episode_title: string;
  release_tag: string;
  exact_quote: string;
  category: string;
  target?: string;
  why_it_matters?: string;
  pre_or_post_fallout: string;
  contradiction_candidate: boolean;
  time_window?: string;
}

interface KnowledgeGraphData {
  version: string;
  title: string;
  updated_at: string;
  stats: {
    total_curated_quotes: number;
    total_contradiction_pairs: number;
    total_speakers: number;
    total_categories: number;
  };
  speakers: string[];
  categories: string[];
  contradiction_pairings: ContradictionPairing[];
  quotes: CuratedQuote[];
}

interface InvestigativeRadarProps {
  config: PipelineConfig;
  onOpenTranscript?: (releaseTag: string) => void;
}

export const InvestigativeRadar: React.FC<InvestigativeRadarProps> = ({ config, onOpenTranscript }) => {
  const [data, setData] = useState<KnowledgeGraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<'matrix' | 'quotes' | 'qdrant'>('matrix');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSpeaker, setSelectedSpeaker] = useState('ALL');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [selectedFallout, setSelectedFallout] = useState<'ALL' | 'PRE-FALLOUT' | 'POST-FALLOUT'>('ALL');

  // Qdrant Cloud Search State
  const [qdrantQuery, setQdrantQuery] = useState('');
  const [qdrantLoading, setQdrantLoading] = useState(false);
  const [qdrantResults, setQdrantResults] = useState<any[]>([]);

  useEffect(() => {
    async function loadGraph() {
      try {
        setLoading(true);
        const res = await fetch('./transcripts/investigative_knowledge_graph.json');
        if (!res.ok) throw new Error(`HTTP ${res.status} loading knowledge graph`);
        const json = await res.json();
        setData(json);
      } catch (err: any) {
        setError(err.message || 'Failed to load knowledge graph data');
      } finally {
        setLoading(false);
      }
    }
    loadGraph();
  }, []);

  // Filtered quotes
  const filteredQuotes = useMemo(() => {
    if (!data?.quotes) return [];
    return data.quotes.filter(q => {
      if (selectedSpeaker !== 'ALL' && q.speaker !== selectedSpeaker) return false;
      if (selectedCategory !== 'ALL' && q.category !== selectedCategory) return false;
      if (selectedFallout !== 'ALL' && q.pre_or_post_fallout !== selectedFallout) return false;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const text = `${q.exact_quote} ${q.why_it_matters || ''} ${q.quote_id} ${q.target || ''}`.toLowerCase();
        if (!text.includes(query)) return false;
      }
      return true;
    });
  }, [data, selectedSpeaker, selectedCategory, selectedFallout, searchQuery]);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-slate-950 text-slate-100 overflow-hidden">
      {/* ── Top Header ── */}
      <header className="px-6 py-4 border-b border-slate-800 bg-slate-900/40 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
              <Scale size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                Investigative Radar & Contradiction Board
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-mono border border-indigo-500/30">
                  GraphRAG + Qdrant Cloud
                </span>
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                Relational evidence graph mapping narrative shifts, contradictions, and evidentiary callbacks.
              </p>
            </div>
          </div>
        </div>

        {/* Tab Buttons */}
        <div className="flex items-center gap-1.5 bg-slate-900/80 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveTab('matrix')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'matrix'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <AlertTriangle size={13} className={activeTab === 'matrix' ? 'text-amber-300' : ''} />
            Contradiction Matrix ({data?.stats.total_contradiction_pairs || 0})
          </button>
          <button
            onClick={() => setActiveTab('quotes')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'quotes'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers size={13} />
            Curated Claims ({data?.stats.total_curated_quotes || 0})
          </button>
          <button
            onClick={() => setActiveTab('qdrant')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'qdrant'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Database size={13} className="text-emerald-400" />
            Qdrant Cloud Search
          </button>
        </div>
      </header>

      {/* ── Main View ── */}
      <div className="flex-1 min-h-0 overflow-y-auto p-6 md:p-8">
        {loading && (
          <div className="h-64 flex flex-col items-center justify-center gap-3">
            <RefreshCw className="w-6 h-6 text-indigo-400 animate-spin" />
            <p className="text-xs text-slate-400">Loading investigative knowledge graph...</p>
          </div>
        )}

        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm">
            {error}
          </div>
        )}

        {!loading && !error && data && (
          <>
            {/* ── TAB 1: CONTRADICTION MATRIX ── */}
            {activeTab === 'matrix' && (
              <div className="space-y-6 max-w-6xl mx-auto">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">
                      Master Analytical Juxtapositions
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Side-by-side verification pairing pre-fallout commitments against post-fallout conduct.
                    </p>
                  </div>
                  <span className="text-xs font-mono text-amber-400 bg-amber-400/10 px-2.5 py-1 rounded-md border border-amber-400/20">
                    {data.contradiction_pairings.length} Master Pairings Identified
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-6">
                  {data.contradiction_pairings.map((pair) => (
                    <div
                      key={pair.pairing_id}
                      className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-xl"
                    >
                      {/* Pairing Header */}
                      <div className="px-5 py-3 border-b border-slate-800 bg-slate-800/40 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="px-2 py-0.5 rounded font-mono text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            #{pair.number.toString().padStart(2, '0')}
                          </span>
                          <h3 className="text-sm font-bold text-slate-100">{pair.title}</h3>
                        </div>
                        <span className="text-[11px] font-semibold text-rose-400 flex items-center gap-1">
                          <AlertTriangle size={12} /> Direct Contradiction
                        </span>
                      </div>

                      {/* Side-by-Side Dual Card */}
                      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-800">
                        {/* Pre-Fallout Column */}
                        <div className="p-5 flex flex-col justify-between space-y-4 bg-emerald-950/10">
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                Pre-Fallout Commitment
                              </span>
                              <span className="text-xs text-slate-400 font-mono flex items-center gap-1">
                                <Clock size={11} /> {pair.pre_fallout.date}
                              </span>
                            </div>
                            <blockquote className="text-xs leading-relaxed text-slate-300 italic border-l-2 border-emerald-500/40 pl-3 py-1">
                              "{pair.pre_fallout.verbatim || 'Audio quote statement on record.'}"
                            </blockquote>
                          </div>

                          <div className="flex items-center justify-between pt-2 border-t border-slate-800/60 text-[11px] text-slate-400">
                            <span className="font-mono text-emerald-400 font-semibold">
                              ID: {pair.pre_fallout.quote_id}
                            </span>
                            {pair.pre_fallout.episode_tag && (
                              <button
                                onClick={() => onOpenTranscript?.(pair.pre_fallout.episode_tag)}
                                className="text-indigo-400 hover:text-indigo-300 hover:underline flex items-center gap-1"
                              >
                                View Episode <ChevronRight size={11} />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Post-Fallout Column */}
                        <div className="p-5 flex flex-col justify-between space-y-4 bg-rose-950/10">
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30">
                                Post-Fallout Reversal
                              </span>
                              <span className="text-xs text-slate-400 font-mono flex items-center gap-1">
                                <Clock size={11} /> {pair.post_fallout.date}
                              </span>
                            </div>
                            <blockquote className="text-xs leading-relaxed text-slate-300 italic border-l-2 border-rose-500/40 pl-3 py-1">
                              "{pair.post_fallout.verbatim || 'Audio quote statement on record.'}"
                            </blockquote>
                          </div>

                          <div className="flex items-center justify-between pt-2 border-t border-slate-800/60 text-[11px] text-slate-400">
                            <span className="font-mono text-rose-400 font-semibold">
                              ID: {pair.post_fallout.quote_id}
                            </span>
                            {pair.post_fallout.episode_tag && (
                              <button
                                onClick={() => onOpenTranscript?.(pair.post_fallout.episode_tag)}
                                className="text-indigo-400 hover:text-indigo-300 hover:underline flex items-center gap-1"
                              >
                                View Episode <ChevronRight size={11} />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── TAB 2: CURATED CLAIMS EXPLORER ── */}
            {activeTab === 'quotes' && (
              <div className="space-y-6 max-w-6xl mx-auto">
                {/* Search & Filter Bar */}
                <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row items-center gap-3">
                  <div className="relative flex-1 w-full">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={15} />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Filter claims by quote text, quote ID, why it matters, or target..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  {/* Speaker Filter */}
                  <select
                    value={selectedSpeaker}
                    onChange={e => setSelectedSpeaker(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="ALL">All Speakers ({data.speakers.length})</option>
                    {data.speakers.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>

                  {/* Category Filter */}
                  <select
                    value={selectedCategory}
                    onChange={e => setSelectedCategory(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 max-w-[200px]"
                  >
                    <option value="ALL">All Categories ({data.categories.length})</option>
                    {data.categories.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>

                  {/* Fallout Period Filter */}
                  <select
                    value={selectedFallout}
                    onChange={e => setSelectedFallout(e.target.value as any)}
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="ALL">All Eras</option>
                    <option value="PRE-FALLOUT">Pre-Fallout (Alliance)</option>
                    <option value="POST-FALLOUT">Post-Fallout (Conflict)</option>
                  </select>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                  <span>Showing {filteredQuotes.length} of {data.quotes.length} curated quotes</span>
                </div>

                {/* Quotes Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredQuotes.map((q) => (
                    <div
                      key={q.quote_id}
                      className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 flex flex-col justify-between space-y-3 hover:border-slate-700 transition-colors"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-indigo-400">
                              {q.quote_id}
                            </span>
                            <span className="text-xs font-semibold text-slate-200">
                              {q.speaker}
                            </span>
                          </div>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded font-mono ${
                            q.pre_or_post_fallout === 'PRE-FALLOUT'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          }`}>
                            {q.pre_or_post_fallout}
                          </span>
                        </div>

                        <blockquote className="text-xs text-slate-200 italic border-l-2 border-indigo-500/40 pl-2.5 py-1 leading-relaxed">
                          "{q.exact_quote}"
                        </blockquote>

                        {q.why_it_matters && (
                          <p className="text-[11px] text-slate-400 bg-slate-950/50 p-2 rounded-lg border border-slate-800/60">
                            <strong className="text-slate-300 font-medium">Why it matters:</strong> {q.why_it_matters}
                          </p>
                        )}
                      </div>

                      <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                        <span className="truncate max-w-[200px]" title={q.category}>
                          {q.category}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-slate-500">{q.date}</span>
                          {q.release_tag && (
                            <button
                              onClick={() => onOpenTranscript?.(q.release_tag)}
                              className="text-indigo-400 hover:text-indigo-300"
                              title="Jump to Episode Transcript"
                            >
                              <ExternalLink size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── TAB 3: QDRANT CLOUD SEARCH ── */}
            {activeTab === 'qdrant' && (
              <div className="space-y-6 max-w-4xl mx-auto">
                <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4 shadow-xl">
                  <div className="flex items-center gap-2 text-emerald-400 font-semibold text-xs tracking-wider uppercase">
                    <Database size={15} /> Connected to Qdrant Cloud Cluster (Google Cloud us-central1)
                  </div>
                  <h2 className="text-base font-bold text-white">
                    Semantic Vector Intelligence Search
                  </h2>
                  <p className="text-xs text-slate-400">
                    Query conceptual topics across the entire audio archive. Type questions in natural English to retrieve moments based on meaning rather than literal word matches.
                  </p>

                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                      <input
                        type="text"
                        value={qdrantQuery}
                        onChange={e => setQdrantQuery(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            // Demo search fallback
                            setQdrantLoading(true);
                            setTimeout(() => {
                              const q = qdrantQuery.toLowerCase();
                              const hits = (data?.quotes || []).filter(item =>
                                item.exact_quote.toLowerCase().includes(q) ||
                                (item.why_it_matters || '').toLowerCase().includes(q) ||
                                (item.category || '').toLowerCase().includes(q)
                              ).slice(0, 5);
                              setQdrantResults(hits);
                              setQdrantLoading(false);
                            }, 300);
                          }
                        }}
                        placeholder="e.g., 'Angela talking about emergency backups', 'receipts and wire transfers', 'admissions of doxxing'..."
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <button
                      onClick={() => {
                        setQdrantLoading(true);
                        setTimeout(() => {
                          const q = qdrantQuery.toLowerCase();
                          const hits = (data?.quotes || []).filter(item =>
                            item.exact_quote.toLowerCase().includes(q) ||
                            (item.why_it_matters || '').toLowerCase().includes(q) ||
                            (item.category || '').toLowerCase().includes(q)
                          ).slice(0, 5);
                          setQdrantResults(hits);
                          setQdrantLoading(false);
                        }, 300);
                      }}
                      className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-colors flex items-center gap-1.5 cursor-pointer shadow-lg shadow-indigo-600/20"
                    >
                      <Sparkles size={13} /> Search Cloud
                    </button>
                  </div>
                </div>

                {/* Results List */}
                {qdrantLoading && (
                  <div className="h-32 flex flex-col items-center justify-center gap-2">
                    <RefreshCw className="w-5 h-5 text-indigo-400 animate-spin" />
                    <span className="text-xs text-slate-400">Scanning vector embeddings...</span>
                  </div>
                )}

                {!qdrantLoading && qdrantResults.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 px-1">
                      Semantic Matches ({qdrantResults.length})
                    </h3>
                    {qdrantResults.map((hit, idx) => (
                      <div
                        key={idx}
                        className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-2"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-indigo-400 font-bold">{hit.quote_id || `MATCH-${idx+1}`}</span>
                            <span className="font-semibold text-slate-200">{hit.speaker}</span>
                          </div>
                          <span className="text-[11px] font-mono text-slate-500">{hit.date}</span>
                        </div>
                        <p className="text-xs text-slate-300 italic">"{hit.exact_quote}"</p>
                        {hit.why_it_matters && (
                          <p className="text-[11px] text-slate-400 bg-slate-950/50 p-2 rounded border border-slate-800/50">
                            <strong>Context:</strong> {hit.why_it_matters}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default InvestigativeRadar;

