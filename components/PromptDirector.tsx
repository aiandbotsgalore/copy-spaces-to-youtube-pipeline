import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Wand2, Settings, Loader2, Send, RotateCcw, Undo2, Redo2, AlertTriangle,
  ChevronDown, ChevronRight, Lock, CheckCircle2, ListOrdered, Sparkles, X,
  Info, Play, Pause, Check, Clock, Film, Layers, Tag
} from 'lucide-react';
import { useMontage, HARD_EXCLUDE_PHRASE, getCategoryEscalationWeight } from '../contexts/MontageContext';
import type { MontageClipItem } from '../contexts/MontageContext';
import { generateCuts, refineTimeline } from '../utils/directorRuntime';
import type { GenerateAllResult } from '../utils/directorRuntime';
import { browserRuntimeDeps, LAST_PROMPT_KEY } from '../utils/directorBrowser';
import { fetchDirectorStatus } from '../utils/directorClient';
import { loadDirectorKey, loadDirectorPrefs } from '../utils/storage';
import { ARCHETYPES, CUT_IDS, STATIC_PILLS, targetForCut } from '../utils/directorProfile';
import { buildSequencePlan, formatClock } from '../utils/sequencePlan';
import type { CutId, DirectorErrorCode } from '../utils/directorTypes';
import { extractQuotesFromPrompt, isExactQuotesPrompt } from '../utils/quoteExtractor';
import type { ExtractedQuote } from '../utils/quoteExtractor';
import { matchAllQuotes } from '../utils/quoteMatcher';
import type { QuoteMatchResult } from '../utils/quoteMatcher';
import { buildExactTimeline } from '../utils/exactTimelineBuilder';
import { DirectorSettings } from './DirectorSettings';

interface LogEntry {
  instruction: string;
  summary: string;
  changes: string[];
  rejected: string[];
}
interface UiError {
  code: DirectorErrorCode | 'NO_CANDIDATES';
  message: string;
}

const REFINE_PILLS = [
  'Shorten by about 10 seconds',
  'Strengthen the opening',
  'Add more breathing room between clips',
  'Remove the weakest clip',
];

const HINTS: Partial<Record<UiError['code'], string>> = {
  NO_KEY: 'Add an API key to continue.',
  UNAUTHORIZED: 'Check the key in settings.',
  RATE_LIMIT: 'Wait a moment, then try again.',
  TIMEOUT: 'The model took too long. Try again or choose a shorter target.',
  UPSTREAM: 'The gateway had a problem. Try again shortly.',
  MODEL_NOT_FOUND: 'Pick another model in settings.',
  BAD_OUTPUT: 'The model returned something unusable. Try again.',
  SERVER_UNAVAILABLE: 'Start the app with npm run dev.',
  FORBIDDEN_ORIGIN: 'The Director only accepts requests from this computer.',
};

export const PromptDirector: React.FC<{ pool: MontageClipItem[]; filteredPool: MontageClipItem[] }> = ({ pool, filteredPool }) => {
  const {
    clips,
    replaceClips,
    undo,
    redo,
    canUndo,
    canRedo,
    gapSeconds,
    targetDurationSec,
    isBlacklisted,
    isAuditioning,
    startAudition,
    stopAudition,
  } = useMontage();

  const [open, setOpen] = useState(true);
  const [prompt, setPrompt] = useState(() => {
    try {
      return localStorage.getItem(LAST_PROMPT_KEY) || '';
    } catch {
      return '';
    }
  });
  const [phase, setPhase] = useState<'idle' | 'generating' | 'refining'>('idle');
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<GenerateAllResult<MontageClipItem> | null>(null);
  const [active, setActive] = useState<CutId | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [instruction, setInstruction] = useState('');
  const [logs, setLogs] = useState<Partial<Record<CutId, LogEntry[]>>>({});
  const [snapshot, setSnapshot] = useState<MontageClipItem[] | null>(null);
  const [usage, setUsage] = useState<{ model: string; prompt: number; completion: number } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [userModeOverride, setUserModeOverride] = useState<'exact' | 'creative' | null>(null);
  const [showQuoteList, setShowQuoteList] = useState(false);
  const [exactMontageNotice, setExactMontageNotice] = useState<{ totalCount: number; matchedCount: number; runtimeSec: number } | null>(null);

  const ctrlRef = useRef<AbortController | null>(null);
  const draftsRef = useRef<Partial<Record<CutId, MontageClipItem[]>>>({});
  const generatedPromptRef = useRef('');
  const busy = phase !== 'idle';

  useEffect(() => () => ctrlRef.current?.abort(), []);

  const extractedQuotes: ExtractedQuote[] = useMemo(() => extractQuotesFromPrompt(prompt), [prompt]);
  const detectedExact = useMemo(() => isExactQuotesPrompt(prompt) && extractedQuotes.length > 0, [prompt, extractedQuotes]);
  const activeMode: 'exact' | 'creative' = userModeOverride ?? (detectedExact ? 'exact' : 'creative');

  const quoteMatches: QuoteMatchResult[] = useMemo(() => {
    if (extractedQuotes.length === 0) return [];
    const basePool = loadDirectorPrefs().limitToFilters && filteredPool.length > 0 ? filteredPool : pool;
    const firstPass = matchAllQuotes(extractedQuotes, basePool);
    if (basePool !== pool) {
      return firstPass.map(m => {
        if (m.matchedClip) return m;
        const secondPass = matchAllQuotes([m.quote], pool);
        return secondPass[0] || m;
      });
    }
    return firstPass;
  }, [extractedQuotes, pool, filteredPool]);

  const matchedCount = useMemo(() => quoteMatches.filter(m => m.matchedClip !== null).length, [quoteMatches]);

  const assembleExact = () => {
    if (quoteMatches.length === 0 || busy) return;
    setError(null);
    setWarnings([]);

    const timeline = buildExactTimeline(quoteMatches, { defaultGapSec: gapSeconds });
    if (timeline.clips.length === 0) {
      setError({
        code: 'NO_CANDIDATES',
        message: 'None of the provided quotes could be matched in the clip library. Try adding the source episodes or clips first.',
      });
      return;
    }

    try {
      localStorage.setItem(LAST_PROMPT_KEY, prompt.trim());
    } catch {}

    if (!clips.some(c => c.director)) setSnapshot(clips.length > 0 ? clips : null);

    replaceClips(timeline.clips);

    const missing = quoteMatches.filter(m => !m.matchedClip);
    if (missing.length > 0) {
      setWarnings([
        `Assembled ${timeline.matchedCount} of ${quoteMatches.length} quotes. Could not find matches in the library for: ${missing.map(m => `"${m.quote.cleanText.slice(0, 35)}..."`).join(', ')}`,
      ]);
    } else {
      setWarnings([]);
    }

    const totalRuntime = timeline.clips.reduce((sum, c) => sum + (c.endSec - c.startSec) + (c.gapAfterSec ?? 0), 0);
    setExactMontageNotice({
      totalCount: quoteMatches.length,
      matchedCount: timeline.matchedCount,
      runtimeSec: totalRuntime,
    });
    setResult(null);
    setActive(null);
  };

  const pills = useMemo(() => {
    const counts = new Map<string, number>();
    pool.forEach(c => {
      if (c.category) counts.set(c.category, (counts.get(c.category) || 0) + 1);
    });
    const top = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([cat]) => `${Math.round(targetDurationSec)}s montage focused on "${cat}" clips`);
    return [...STATIC_PILLS, ...top];
  }, [pool, targetDurationSec]);

  const poolOptions = () => ({
    isBlacklisted,
    hardExcludePhrase: HARD_EXCLUDE_PHRASE,
    escalationWeight: getCategoryEscalationWeight,
    cap: loadDirectorPrefs().candidateCap,
  });
  const sourcePool = () => (loadDirectorPrefs().limitToFilters ? filteredPool : pool);

  const preflight = async (): Promise<UiError | null> => {
    const st = await fetchDirectorStatus(true);
    if (!st) return { code: 'SERVER_UNAVAILABLE', message: 'The Director needs the app server; a static build has no AI endpoint.' };
    if (!st.keyConfigured && !loadDirectorKey()) return { code: 'NO_KEY', message: 'No API key is configured for the Director.' };
    return null;
  };

  const generate = async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    setError(null);
    setWarnings([]);
    const src = sourcePool();
    if (src.length === 0) {
      setError({ code: 'NO_CANDIDATES', message: 'The clip library is empty or still loading.' });
      return;
    }
    const pre = await preflight();
    if (pre) {
      setError(pre);
      return;
    }

    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setPhase('generating');
    setProgress('Checking clip durations and asking for three cuts (up to 90 s)…');
    try {
      const r = await generateCuts(
        { pool: src, userPrompt: text, targetSec: targetDurationSec, defaultGapSec: gapSeconds, signal: ctrl.signal, ...poolOptions() },
        browserRuntimeDeps()
      );
      if (ctrl.signal.aborted) return;
      if (r.ok === false) {
        setError({ code: r.code, message: r.message });
        return;
      }
      const okCuts = CUT_IDS.filter(id => r.outcomes[id].ok === true);
      if (okCuts.length === 0) {
        const first = r.outcomes[CUT_IDS[0]];
        setError(first.ok === false ? { code: first.code, message: first.message } : { code: 'BAD_OUTPUT', message: 'No cut could be built.' });
        return;
      }
      try {
        localStorage.setItem(LAST_PROMPT_KEY, text);
      } catch {}
      generatedPromptRef.current = text;
      draftsRef.current = {};
      setLogs({});
      if (!clips.some(c => c.director)) setSnapshot(clips.length > 0 ? clips : null);
      setResult(r);
      const firstOk = r.outcomes[okCuts[0]];
      if (firstOk.ok === true) {
        setActive(okCuts[0]);
        replaceClips(firstOk.clips);
        const used = okCuts.reduce(
          (acc, id) => {
            const o = r.outcomes[id];
            return o.ok === true ? { p: acc.p + o.usage.promptTokens, c: acc.c + o.usage.completionTokens, m: o.model } : acc;
          },
          { p: 0, c: 0, m: '' }
        );
        setUsage({ model: used.m, prompt: used.p, completion: used.c });
        const w: string[] = [];
        CUT_IDS.forEach(id => {
          const o = r.outcomes[id];
          if (o.ok === false) w.push(`${ARCHETYPES[id].title}: ${o.message}`);
          else o.warnings.forEach(x => w.push(`${ARCHETYPES[id].title}: ${x}`));
        });
        setWarnings(w);
      }
    } finally {
      setPhase('idle');
      setProgress('');
      ctrlRef.current = null;
    }
  };

  const switchCut = (id: CutId) => {
    if (!result || id === active || busy) return;
    const o = result.outcomes[id];
    if (o.ok !== true) return;
    if (active) draftsRef.current[active] = clips;
    setActive(id);
    replaceClips(draftsRef.current[id] ?? o.clips);
  };

  const handleAuditionCut = (id: CutId) => {
    if (!result) return;
    const o = result.outcomes[id];
    if (o.ok !== true) return;

    if (id === active && isAuditioning) {
      stopAudition();
      return;
    }

    if (id !== active) {
      if (active) draftsRef.current[active] = clips;
      setActive(id);
      replaceClips(draftsRef.current[id] ?? o.clips);
    }
    setTimeout(() => {
      startAudition();
    }, 60);
  };

  const handleApplyCut = (id: CutId) => {
    switchCut(id);
  };

  const refine = async (text: string) => {
    const instr = text.trim();
    if (!instr || !active || !result || busy) return;
    setError(null);
    const pre = await preflight();
    if (pre) {
      setError(pre);
      return;
    }
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setPhase('refining');
    setProgress('Revising the timeline…');
    try {
      const r = await refineTimeline(
        {
          cutId: active,
          clips,
          pool: sourcePool(),
          userPrompt: generatedPromptRef.current || prompt,
          instruction: instr,
          targetSec: targetForCut(active, targetDurationSec),
          defaultGapSec: gapSeconds,
          signal: ctrl.signal,
          ...poolOptions(),
        },
        browserRuntimeDeps()
      );
      if (ctrl.signal.aborted) return;
      if (r.ok === false) {
        setError({ code: r.code, message: r.message });
        return;
      }
      replaceClips(r.clips);
      setInstruction('');
      setLogs(prev => ({
        ...prev,
        [active]: [...(prev[active] || []), { instruction: instr, summary: r.summary, changes: r.changelog, rejected: r.rejected }],
      }));
      setUsage(u => ({
        model: r.model,
        prompt: (u?.prompt || 0) + r.usage.promptTokens,
        completion: (u?.completion || 0) + r.usage.completionTokens,
      }));
    } finally {
      setPhase('idle');
      setProgress('');
      ctrlRef.current = null;
    }
  };

  const cancel = () => ctrlRef.current?.abort();

  const activeRuntime = buildSequencePlan(clips, gapSeconds).totalSec;
  const lockedCount = clips.filter(c => c.locked).length;
  const activeLog = (active && logs[active]) || [];

  return (
    <div className="border-b border-slate-800/80 bg-transparent">
      <div className="px-5 py-2.5 flex items-center justify-between gap-2">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-2 text-sm font-bold text-white cursor-pointer"
          aria-expanded={open}
        >
          {open ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
          <Wand2 size={15} className="text-indigo-400" />
          AI Prompt Director
        </button>
        <div className="flex items-center gap-1">
          <button
            onClick={undo}
            disabled={!canUndo || busy}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-25 cursor-pointer"
            title="Undo last timeline change"
          >
            <Undo2 size={13} />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo || busy}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-25 cursor-pointer"
            title="Redo"
          >
            <Redo2 size={13} />
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
            title="Director settings (API key, model)"
          >
            <Settings size={13} />
          </button>
        </div>
      </div>

      {open && (
        <div className="px-5 pb-3 space-y-2.5 text-xs">
          {/* Mode Switcher */}
          <div className="flex items-center justify-between border-b border-slate-800/60 pb-2">
            <div className="flex items-center gap-1.5 p-0.5 bg-slate-900 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => setUserModeOverride('exact')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                  activeMode === 'exact'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <ListOrdered size={12} />
                <span>Exact Quotes Mode</span>
                {extractedQuotes.length > 0 && (
                  <span className={`px-1.5 py-0.2 rounded-full text-[11px] font-bold ${
                    activeMode === 'exact' ? 'bg-emerald-800 text-emerald-100' : 'bg-slate-800 text-slate-300'
                  }`}>
                    {matchedCount}/{extractedQuotes.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setUserModeOverride('creative')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                  activeMode === 'creative'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Sparkles size={12} />
                <span>3 Creative Cuts</span>
              </button>
            </div>

            {detectedExact && userModeOverride === null && (
              <span className="text-[11px] text-emerald-400 font-medium flex items-center gap-1">
                <CheckCircle2 size={11} /> Auto-detected quotes
              </span>
            )}
          </div>

          <textarea
            value={prompt}
            onChange={e => {
              setPrompt(e.target.value);
              if (exactMontageNotice) setExactMontageNotice(null);
            }}
            onKeyDown={e => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                if (activeMode === 'exact' && quoteMatches.length > 0) {
                  assembleExact();
                } else {
                  void generate();
                }
              }
            }}
            disabled={busy}
            rows={activeMode === 'exact' && extractedQuotes.length > 2 ? 4 : 2}
            placeholder={
              activeMode === 'exact'
                ? 'Paste your quotes here, e.g. “People sat in spaces fantasizing about different ways to murder me.” “Coming from a man who said he wanted to bash my skull in.”'
                : 'Describe the montage you want, e.g. “90 seconds, chronological, from the first trust-building statements to the public reversal”.'
            }
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-y disabled:opacity-60"
          />

          {/* Quote matches preview list */}
          {extractedQuotes.length > 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden text-[11px]">
              <button
                type="button"
                onClick={() => setShowQuoteList(s => !s)}
                className="w-full px-3 py-1.5 flex items-center justify-between text-left hover:bg-slate-800/40 cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  {matchedCount === extractedQuotes.length ? (
                    <CheckCircle2 size={13} className="text-emerald-400" />
                  ) : (
                    <AlertTriangle size={13} className="text-amber-400" />
                  )}
                  <span className="font-semibold text-slate-200">
                    Detected {extractedQuotes.length} quote{extractedQuotes.length !== 1 ? 's' : ''}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-mono ${
                    matchedCount === extractedQuotes.length
                      ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/30'
                      : 'bg-amber-950/80 text-amber-300 border border-amber-500/30'
                  }`}>
                    {matchedCount} / {extractedQuotes.length} matched in library
                  </span>
                </div>
                <span className="text-slate-400 text-[11px]">
                  {showQuoteList ? 'Hide details ▲' : 'Show matched clips ▼'}
                </span>
              </button>

              {showQuoteList && (
                <div className="border-t border-slate-800/80 p-2 space-y-1.5 max-h-48 overflow-y-auto">
                  {quoteMatches.map((m, idx) => (
                    <div
                      key={idx}
                      className={`p-2 rounded-lg border flex items-start gap-2 ${
                        m.matchedClip
                          ? 'bg-slate-950/60 border-slate-800'
                          : 'bg-rose-950/20 border-rose-900/40 text-rose-300'
                      }`}
                    >
                      <span className="font-mono text-[11px] text-slate-400 mt-0.5 w-4 text-right">
                        {idx + 1}.
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-white font-medium truncate">
                          "{m.quote.cleanText}"
                        </div>
                        {m.matchedClip ? (
                          <div className="text-[11px] text-emerald-400 mt-0.5 flex items-center gap-2 flex-wrap">
                            <span>✓ Matched: {m.matchedClip.title}</span>
                            {m.matchedClip.speaker && (
                              <span className="text-slate-400">({m.matchedClip.speaker})</span>
                            )}
                            <span className="text-slate-400 font-mono">
                              dur: {(m.matchedClip.endSec - m.matchedClip.startSec).toFixed(1)}s
                            </span>
                            {idx < quoteMatches.length - 1 && (
                              <span className="text-indigo-400 font-mono">
                                +{m.matchedClip.gapAfterSec ?? 0.35}s gap
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="text-[11px] text-amber-400/90 mt-0.5">
                            ⚠️ Not found in current clip library
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {matchedCount < extractedQuotes.length && (
                <div className="px-3 py-2 bg-amber-950/30 border-t border-amber-900/40 text-[11px] text-amber-300 flex items-start gap-2">
                  <Info size={13} className="text-amber-400 mt-0.5 shrink-0" />
                  <div className="space-y-0.5 leading-relaxed">
                    <span className="font-semibold text-amber-200">
                      {matchedCount === 0 ? 'None of these quotes are in the pre-cut clips library.' : `${extractedQuotes.length - matchedCount} quote(s) could not be matched.`}
                    </span>{' '}
                    <span>
                      If these quotes are from raw space episodes (e.g. Sept 30 Space), use the <strong>Transcript Search</strong> panel to locate the spoken turns and click <em>"Send to Montage"</em> to create audio clips. Exact Quotes Mode only pulls from indexed audio clips in your library.
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Quick prompt pills */}
          <div className={`flex flex-wrap gap-1.5 ${result || (activeMode === 'exact' && prompt.trim()) ? 'hidden' : ''}`}>
            {activeMode === 'exact' && !prompt.trim() ? (
              <button
                onClick={() => setPrompt('BUILD A MONTAGE USING THESE QUOTES\n“People sat in spaces fantasizing about different ways to murder me.”\n“Coming from a man who said he wanted to bash my skull in.”\n“You don\'t get to step on my neck.”\n“I won\'t give an inch.”\n“I\'ve already filed. I\'m not afraid.”\n“I\'m declaring war.”')}
                className="px-2.5 py-1 rounded-full bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-700/50 text-[11px] text-emerald-300 cursor-pointer"
              >
                Load example 6-quotes prompt
              </button>
            ) : (
              pills.map(p => (
                <button
                  key={p}
                  onClick={() => setPrompt(p)}
                  disabled={busy}
                  className="px-2 py-0.5 rounded-full bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] text-slate-300 cursor-pointer disabled:opacity-40"
                >
                  {p}
                </button>
              ))
            )}
          </div>

          {/* Primary Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {activeMode === 'exact' ? (
              <>
                <button
                  onClick={assembleExact}
                  disabled={busy || quoteMatches.length === 0 || matchedCount === 0}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold shadow-md disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1.5 transition-colors"
                  title={
                    matchedCount === 0
                      ? 'No quotes matched in pre-cut library. Add or clip them from transcripts first.'
                      : 'Assemble timeline with these exact quotes in order (Ctrl+Enter)'
                  }
                >
                  <Send size={13} />
                  <span>
                    {matchedCount === 0 && extractedQuotes.length > 0
                      ? `Assemble Montage (0 / ${extractedQuotes.length} in library)`
                      : matchedCount < extractedQuotes.length && extractedQuotes.length > 0
                      ? `Assemble Montage (${matchedCount} / ${extractedQuotes.length} matched)`
                      : 'Assemble Montage (Send)'}
                  </span>
                </button>
                <button
                  onClick={generate}
                  disabled={!prompt.trim() || busy}
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg font-medium border border-slate-700 text-xs cursor-pointer flex items-center gap-1.5"
                  title="Or explore these quotes with 3 creative AI variations"
                >
                  <Wand2 size={12} /> Generate 3 cuts instead
                </button>
              </>
            ) : (
              <>
                {phase === 'generating' ? (
                  <button onClick={cancel} className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-bold cursor-pointer">
                    Cancel
                  </button>
                ) : (
                  <button
                    onClick={generate}
                    disabled={!prompt.trim() || busy}
                    className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold shadow-md disabled:opacity-40 cursor-pointer flex items-center gap-1.5"
                    title="Build three competing cuts (Ctrl+Enter)"
                  >
                    <Wand2 size={12} /> {result ? 'Regenerate three cuts' : 'Generate three cuts'}
                  </button>
                )}
                {quoteMatches.length > 0 && (
                  <button
                    onClick={assembleExact}
                    disabled={busy}
                    className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-emerald-400 rounded-lg font-medium border border-emerald-500/30 text-xs cursor-pointer flex items-center gap-1.5"
                    title="Assemble exact quotes in order"
                  >
                    <Send size={12} /> Assemble exact quotes ({matchedCount}/{quoteMatches.length})
                  </button>
                )}
              </>
            )}
            {busy && (
              <span className="text-slate-400 flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" /> {progress}
              </span>
            )}
          </div>

          {/* Success notice */}
          {exactMontageNotice && (
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-200">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={15} className="text-emerald-400 flex-shrink-0" />
                <div>
                  <span className="font-bold">Montage Assembled!</span> Placed {exactMontageNotice.matchedCount} of {exactMontageNotice.totalCount} quotes on timeline ({formatClock(exactMontageNotice.runtimeSec)}).
                </div>
              </div>
              <button
                onClick={() => setExactMontageNotice(null)}
                className="text-emerald-400 hover:text-white p-1 rounded-md cursor-pointer"
                title="Dismiss"
              >
                <X size={13} />
              </button>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-2.5 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-200" role="alert">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <div>{error.message}</div>
                {HINTS[error.code] && <div className="text-rose-300/80 mt-0.5">{HINTS[error.code]}</div>}
              </div>
              {(error.code === 'NO_KEY' || error.code === 'UNAUTHORIZED' || error.code === 'MODEL_NOT_FOUND') && (
                <button
                  onClick={() => setShowSettings(true)}
                  className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-semibold cursor-pointer"
                >
                  {error.code === 'MODEL_NOT_FOUND' ? 'Pick model' : 'Add key'}
                </button>
              )}
            </div>
          )}

          {result && (
            <div className="space-y-3">
              {/* 3 Creative Cuts Comparison Cards Header */}
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Sparkles size={13} className="text-amber-400" />
                  3 Creative Cuts Comparison
                </span>
                <span className="text-[11px] text-slate-400 font-mono">
                  Target: {targetDurationSec}s
                </span>
              </div>

              {/* Side-by-side comparison cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                {CUT_IDS.map(id => {
                  const o = result.outcomes[id];
                  const isActive = id === active;
                  if (o.ok === false) {
                    return (
                      <div key={id} className="p-3 rounded-xl border border-slate-800 bg-slate-900/40 text-slate-400 space-y-1.5 opacity-60">
                        <div className="font-bold text-xs text-slate-400">{ARCHETYPES[id].title}</div>
                        <p className="text-[11px] text-slate-400">Unavailable: {o.message.slice(0, 80)}</p>
                      </div>
                    );
                  }

                  const runtime = isActive ? activeRuntime : o.runtimeSec;
                  const delta = runtime - o.targetSec;
                  const isWithinTolerance = Math.abs(delta) <= Math.max(2, o.targetSec * 0.05);
                  const isAuditioningThis = isAuditioning && isActive;

                  const cutClips = draftsRef.current[id] ?? o.clips;
                  const categories = Array.from(new Set(cutClips.map(c => c.category).filter(Boolean)));

                  return (
                    <div
                      key={id}
                      className={`p-3 rounded-xl border flex flex-col justify-between transition-all ${
                        isActive
                          ? 'border-indigo-400 bg-indigo-950/40 shadow-lg ring-1 ring-indigo-400/40'
                          : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                      }`}
                    >
                      <div className="space-y-2">
                        {/* Header & Badges */}
                        <div className="flex items-start justify-between gap-1.5">
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-xs text-white tracking-tight">{ARCHETYPES[id].title}</span>
                              {isActive && (
                                <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">
                                  Active
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-400 line-clamp-1">{o.tagline}</p>
                          </div>
                          <span className="font-mono text-[10px] text-slate-400 px-1.5 py-0.5 rounded bg-slate-800 flex-shrink-0">
                            {cutClips.length} clips
                          </span>
                        </div>

                        {/* Duration Badge & Delta */}
                        <div className="flex items-center justify-between bg-slate-950/70 border border-slate-800/80 rounded-lg px-2 py-1 text-[11px] font-mono">
                          <span className="text-white font-bold flex items-center gap-1">
                            <Clock size={11} className="text-indigo-400" />
                            {formatClock(runtime)}
                          </span>
                          <span className="text-slate-400">/ {formatClock(o.targetSec)}</span>
                          <span className={`text-[10px] font-semibold px-1 rounded ${
                            isWithinTolerance
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : delta > 0
                              ? 'bg-rose-500/20 text-rose-300'
                              : 'bg-cyan-500/20 text-cyan-300'
                          }`}>
                            {isWithinTolerance ? '±0s On-Target' : delta > 0 ? `+${delta.toFixed(1)}s` : `${delta.toFixed(1)}s`}
                          </span>
                        </div>

                        {/* Narrative tags */}
                        {categories.length > 0 && (
                          <div className="flex items-center gap-1 flex-wrap">
                            {categories.slice(0, 3).map(cat => (
                              <span key={cat} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-300 font-medium">
                                #{cat}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Key Quotes Excerpt Preview */}
                        <div className="space-y-1 pt-1 border-t border-slate-800/60">
                          {cutClips.slice(0, 2).map((c, qIdx) => (
                            <div key={qIdx} className="text-[11px] text-slate-300 line-clamp-1 italic">
                              <span className="text-indigo-300 not-italic font-semibold mr-1">{c.speaker}:</span>
                              "{c.quote}"
                            </div>
                          ))}
                          {cutClips.length > 2 && (
                            <span className="text-[10px] text-slate-400 italic block">
                              +{cutClips.length - 2} more scene turn{cutClips.length - 2 !== 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Action buttons: 1-Click Audition & Apply to Timeline */}
                      <div className="flex items-center gap-1.5 pt-2.5 mt-2 border-t border-slate-800/60">
                        <button
                          onClick={() => handleAuditionCut(id)}
                          className={`flex-1 flex items-center justify-center gap-1 py-1 px-2 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                            isAuditioningThis
                              ? 'bg-amber-500 text-slate-950 font-black'
                              : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                          }`}
                          title="Audition this cut with sample-accurate playback"
                        >
                          {isAuditioningThis ? <Pause size={11} /> : <Play size={11} />}
                          <span>{isAuditioningThis ? 'Auditioning' : 'Audition'}</span>
                        </button>

                        <button
                          onClick={() => handleApplyCut(id)}
                          disabled={busy || isActive}
                          className={`flex-1 flex items-center justify-center gap-1 py-1 px-2 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                            isActive
                              ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 cursor-default'
                              : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                          }`}
                        >
                          {isActive ? (
                            <>
                              <Check size={11} />
                              <span>Applied</span>
                            </>
                          ) : (
                            <span>Apply to Timeline</span>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Refinement */}
              {active && (
                <div className="space-y-1.5">
                  {activeLog.map((entry, i) => (
                    <div key={i} className="p-2 rounded-xl bg-slate-900/70 border border-slate-800">
                      <div className="text-slate-400">You: {entry.instruction}</div>
                      <div className="text-slate-200 mt-0.5">{entry.summary}</div>
                      {(entry.changes.length > 0 || entry.rejected.length > 0) && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {entry.changes.map((c, k) => (
                            <span key={`c${k}`} className="px-1.5 py-0.5 rounded-md bg-emerald-950/50 border border-emerald-500/30 text-emerald-300 text-[11px]">
                              {c}
                            </span>
                          ))}
                          {entry.rejected.map((c, k) => (
                            <span key={`r${k}`} className="px-1.5 py-0.5 rounded-md bg-amber-950/40 border border-amber-500/30 text-amber-300 text-[11px]">
                              {c}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-1.5">
                    {REFINE_PILLS.map(p => (
                      <button
                        key={p}
                        onClick={() => void refine(p)}
                        disabled={busy}
                        className="px-2 py-0.5 rounded-full bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] text-slate-300 cursor-pointer disabled:opacity-40"
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={instruction}
                      onChange={e => setInstruction(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') void refine(instruction);
                      }}
                      disabled={busy}
                      placeholder="Refine this cut: “drop the third clip”, “open with something shorter”…"
                      className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
                    />
                    {phase === 'refining' ? (
                      <button onClick={cancel} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-semibold cursor-pointer">
                        Cancel
                      </button>
                    ) : (
                      <button
                        onClick={() => void refine(instruction)}
                        disabled={!instruction.trim() || busy}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg disabled:opacity-40 cursor-pointer"
                        title="Send"
                      >
                        <Send size={13} />
                      </button>
                    )}
                  </div>
                  {lockedCount > 0 && (
                    <div className="text-[11px] text-slate-400 flex items-center gap-1">
                      <Lock size={10} /> {lockedCount} locked clip{lockedCount !== 1 ? 's' : ''} will not be changed.
                    </div>
                  )}
                </div>
              )}

              {warnings.length > 0 && (
                <details className="text-[11px] text-amber-300/90">
                  <summary className="cursor-pointer">{warnings.length} note{warnings.length !== 1 ? 's' : ''} from the Director run</summary>
                  <ul className="list-disc ml-4 mt-1 space-y-0.5">
                    {warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <div>
              {snapshot && (
                <button
                  onClick={() => {
                    replaceClips(snapshot);
                    setSnapshot(null);
                    setActive(null);
                    setResult(null);
                  }}
                  disabled={busy}
                  className="flex items-center gap-1 text-slate-400 hover:text-white cursor-pointer disabled:opacity-40"
                >
                  <RotateCcw size={10} /> Restore previous timeline
                </button>
              )}
            </div>
            {usage && (
              <span className="font-mono">
                {usage.model} · {usage.prompt.toLocaleString()} in / {usage.completion.toLocaleString()} out
              </span>
            )}
          </div>
        </div>
      )}

      {showSettings && <DirectorSettings onClose={() => setShowSettings(false)} onChanged={() => setError(null)} />}
    </div>
  );
};

export default PromptDirector;
