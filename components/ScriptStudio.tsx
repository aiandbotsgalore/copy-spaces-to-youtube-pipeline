/**
 * Script Studio: write and refine a documentary script from one or several of Logan's recordings, on his machine.
 * Talks only to /api/script (server/scriptStudioMiddleware.ts). Every status shown comes from the
 * server: provider health checks, run events, gate results and judge reasons. Nothing is published.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowDown, ArrowUp, Check, CheckCircle2, ChevronLeft, CircleSlash, Download, FileText, History, Loader2, Lock,
  Pause, Play, Plus, RefreshCw, RotateCcw, Save, Scissors, Search, Square, Trash2, Unlock, Upload, Wand2, X, XCircle,
} from 'lucide-react';
import { usePlayer } from '../contexts/PlayerContext';
import {
  loadRoleChoice, PROJECT_STORAGE_KEY, ROLE_SPECS, saveRoleChoice, scriptApi, ScriptApiError, streamRun,
  type ProjectResponse, type RoleChoice, type RunResponse, type StatusResponse,
} from '../utils/scriptClient';
import { estimateRuntime } from '../utils/scriptGates';
import ScriptQuality, { LogTable } from './ScriptQuality';
import { AudioPanel, usePreviewJob } from './ScriptAudio';
import { PaperTrailPanel, RecordingsPanel, StylePanel } from './ScriptStyle';
import { namesForTag, renameKey } from '../utils/scriptNames';
import { countTakes, hasValidTake } from '../utils/scriptAudio';
import type { LogEntry } from '../utils/scriptQuality';
import type { Block, EpisodeFormat, RoleMap, RunEvent, Segment, StudioClip } from '../utils/scriptTypes';
import { EPISODE_FORMATS, NARRATIVE_FUNCTIONS } from '../utils/scriptTypes';

interface TranscriptRow { id: string; start: number; end: number; speaker: string; text: string }

const FORMAT_LABELS: Record<EpisodeFormat, string> = {
  narrative_doc: 'Narrative documentary', investigative: 'Investigative', best_of: 'Best of', interview: 'Interview',
  thematic_multi: 'Thematic (multi-episode)', commentary: 'Commentary', short_highlight: 'Short highlight',
};
const ROLES: (keyof RoleMap)[] = ['analyst', 'critic', 'reviser', 'judge', 'factcheck', 'polish'];

const hms = (s: number) => {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(sec).padStart(2, '0')}`;
};
const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
const btn = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const btnPrimary = `${btn} bg-indigo-600 border-indigo-500 text-white hover:bg-indigo-500`;
const btnGhost = `${btn} bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800`;
const card = 'rounded-lg border border-slate-800 bg-slate-900/60';
const input = 'bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-indigo-500';

function ErrorBox({ error, onClose }: { error: unknown; onClose: () => void }) {
  if (!error) return null;
  const e = error as ScriptApiError;
  return (
    <div className="rounded-md border border-rose-700/60 bg-rose-950/40 p-3 text-xs text-rose-100">
      <div className="flex items-start gap-2">
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-rose-400" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold">{e.code ? `${e.code}: ` : ''}{e.message || String(error)}</div>
          {e.resetHint && <div className="mt-1 text-rose-200">{e.resetHint}</div>}
          {e.raw && <details className="mt-1"><summary className="cursor-pointer text-rose-300">Raw output</summary><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-[11px] text-rose-200/80">{e.raw}</pre></details>}
        </div>
        <button onClick={onClose} className="text-rose-300 hover:text-white" aria-label="Dismiss"><X size={14} /></button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Setup screen                                                                                    */
/* ---------------------------------------------------------------------------------------------- */

function SetupScreen({ status, onRecheck, checking, onOpen }: { status: StatusResponse | null; onRecheck: () => void; checking: boolean; onOpen: (id: string) => void }) {
  const [episodes, setEpisodes] = useState<{ releaseTag: string; title: string }[]>([]);
  const [projects, setProjects] = useState<{ id: string; title: string; updatedAt: number; sourceTags: string[] }[]>([]);
  const [filter, setFilter] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [minutes, setMinutes] = useState(15);
  const [newFormat, setNewFormat] = useState<EpisodeFormat | ''>('');
  const [thesis, setThesis] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<'projects' | 'style' | 'quality'>('projects');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scriptApi.episodes().then(r => setEpisodes(r.episodes)).catch(setError);
    scriptApi.projects().then(r => setProjects(r.projects)).catch(setError);
  }, []);
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return episodes.filter(e => !f || e.title.toLowerCase().includes(f) || e.releaseTag.toLowerCase().includes(f)).slice(0, 200);
  }, [episodes, filter]);

  const create = async () => {
    setCreating(true); setError(null);
    try {
      const r = await scriptApi.createProject(picked, minutes * 60, { format: newFormat || (picked.length > 1 ? 'thematic_multi' : null), thesis: thesis.trim() || undefined });
      onOpen(r.project.id);
    } catch (e) { setError(e); } finally { setCreating(false); }
  };
  const importFile = async (f: File) => {
    setError(null);
    try {
      const data = JSON.parse(await f.text());
      let r;
      try { r = await scriptApi.importProject(data, false); } catch (e) {
        if (e instanceof ScriptApiError && e.code === 'CONFLICT' && window.confirm(`${e.message}\n\nReplace the existing project?`)) r = await scriptApi.importProject(data, true);
        else throw e;
      }
      onOpen(r.project.id);
    } catch (e) { setError(e); }
  };

  const subOk = status && status.providers['claude_cli:sonnet']?.ok && status.providers['codex_cli']?.ok;
  const fbOk = status && status.providers['ci:claude-haiku-5.5']?.ok && status.providers['ci:gpt-6-luna']?.ok;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-white flex items-center gap-2"><FileText size={18} className="text-indigo-400" /> Script Studio</h1>
        <p className="text-sm text-slate-400 mt-1">Turns one recording, or several for a thematic or investigative episode, into a documentary script with narration and clips in Logan's voice, then refines it in the background. Every quote is checked against the transcript in code.</p>
      </div>
      <ErrorBox error={error} onClose={() => setError(null)} />
      <div className="flex gap-1">
        <button className={tab === 'projects' ? btnPrimary : btnGhost} onClick={() => setTab('projects')}>Projects</button>
        <button className={tab === 'style' ? btnPrimary : btnGhost} onClick={() => setTab('style')}>Logan's style</button>
        <button className={tab === 'quality' ? btnPrimary : btnGhost} onClick={() => setTab('quality')}>Quality and logs</button>
      </div>
      {tab === 'style' ? <section className={cx(card, 'p-4')}><StylePanel /></section> : tab === 'quality' ? <section className={cx(card, 'p-4')}><ScriptQuality onOpenProject={onOpen} /></section> : <>
      <section className={cx(card, 'p-4')}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-100">Model providers on this computer</h2>
          <button className={btnGhost} onClick={onRecheck} disabled={checking}>{checking ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Check again</button>
        </div>
        {!status ? <div className="text-xs text-slate-400">Checking…</div> : (
          <div className="grid md:grid-cols-2 gap-2">
            {Object.entries(status.providers).map(([spec, h]) => (
              <div key={spec} className="rounded-md border border-slate-800 bg-slate-950/60 p-2.5">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-100">
                  {h.ok ? <CheckCircle2 size={13} className="text-emerald-400" /> : <XCircle size={13} className="text-rose-400" />}
                  {spec} <span className="text-slate-500 font-normal">({h.model})</span>
                </div>
                <div className="text-[11px] text-slate-400 mt-1 break-words">{h.detail}{h.binPath ? ` — ${h.binPath}` : ''}</div>
              </div>
            ))}
          </div>
        )}
        {status && (
          <div className="mt-3 text-[11px] text-slate-400 space-y-1">
            <div>Default (subscriptions): Claude Code writes and critiques, Codex ({status.defaults.subscription.judge}) judges and fact-checks. {subOk ? <span className="text-emerald-400">Ready.</span> : <span className="text-amber-400">Install and sign in to both CLIs (claude, then codex login) to use it.</span>}</div>
            <div>Fallback (CheaperInference, per-run dollar cap): {fbOk ? <span className="text-emerald-400">key configured.</span> : <span className="text-slate-500">needs CHEAPER_INFERENCE_API_KEY in .env.local.</span>}</div>
            <div>Projects are saved in {status.storeDir}.{status.interruptedAtStart ? ` ${status.interruptedAtStart} run(s) were interrupted by the last server restart and can be resumed.` : ''}</div>
          </div>
        )}
      </section>

      <section className={cx(card, 'p-4 space-y-3')}>
        <h2 className="text-sm font-semibold text-slate-100">New script</h2>
        <div className="flex items-center gap-2">
          <Search size={13} className="text-slate-500" />
          <input className={cx(input, 'flex-1')} placeholder="Filter episodes by title or tag" value={filter} onChange={e => setFilter(e.target.value)} />
        </div>
        <div className="max-h-56 overflow-y-auto rounded-md border border-slate-700 bg-slate-950">
          {shown.map(e => {
            const on = picked.includes(e.releaseTag);
            return (
              <label key={e.releaseTag} className={cx('flex items-center gap-2 px-2 py-1 text-xs cursor-pointer', on ? 'bg-indigo-950/60 text-white' : 'text-slate-300 hover:bg-slate-900')}>
                <input type="checkbox" checked={on} onChange={() => setPicked(p => (on ? p.filter(t => t !== e.releaseTag) : [...p, e.releaseTag].slice(0, 12)))} />
                <span className="truncate flex-1">{e.title}</span><span className="text-slate-500">{e.releaseTag}</span>
              </label>
            );
          })}
        </div>
        <div className="text-[11px] text-slate-500">{picked.length === 0 ? 'Pick one recording, or several (up to 12) for a thematic or investigative episode. You can add more later.' : `${picked.length} picked: ${picked.join(', ')}`}</div>
        {picked.length > 1 && (
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <select className={input} value={newFormat || 'thematic_multi'} onChange={e => setNewFormat(e.target.value as EpisodeFormat)}>
              {EPISODE_FORMATS.map(f => <option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}
            </select>
            <input className={cx(input, 'flex-1')} placeholder="Thesis question the episode answers (optional)" value={thesis} onChange={e => setThesis(e.target.value)} />
          </div>
        )}
        <div className="flex items-center gap-3 text-xs text-slate-300">
          <label className="flex items-center gap-2">Target length <input type="number" min={1} max={240} className={cx(input, 'w-20')} value={minutes} onChange={e => setMinutes(Math.max(1, Number(e.target.value) || 1))} /> min</label>
          <div className="flex-1" />
          <button className={btnPrimary} disabled={!picked.length || creating} onClick={create}>{creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Create project</button>
        </div>
      </section>

      <section className={cx(card, 'p-4')}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-slate-100">Saved projects</h2>
          <button className={btnGhost} onClick={() => fileRef.current?.click()}><Upload size={12} /> Import project JSON</button>
          <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
        </div>
        {projects.length === 0 ? <div className="text-xs text-slate-500">No projects yet.</div> : (
          <ul className="divide-y divide-slate-800">
            {projects.map(p => (
              <li key={p.id} className="py-2 flex items-center gap-2 text-xs">
                <span className="text-slate-100 flex-1 truncate">{p.title}</span>
                <span className="text-slate-500">{p.sourceTags.join(', ')}</span>
                <span className="text-slate-500">{new Date(p.updatedAt).toLocaleString()}</span>
                <button className={btnGhost} onClick={() => onOpen(p.id)}>Open</button>
              </li>
            ))}
          </ul>
        )}
      </section>
      </>}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Block editor                                                                                    */
/* ---------------------------------------------------------------------------------------------- */

function BlockView({ block, clip, onChange, onRemove, onMove, onPlay, onClaim, playing }: {
  block: Block; clip?: StudioClip; onChange: (b: Block) => void; onRemove: () => void; onMove: (d: -1 | 1) => void;
  onPlay: () => void; onClaim: (t: number) => void; playing: boolean;
}) {
  const lockBtn = (
    <button className="text-slate-400 hover:text-white" title={block.locked ? 'Locked: the loop will not change this block' : 'Lock this block'} onClick={() => onChange({ ...block, locked: !block.locked } as Block)}>
      {block.locked ? <Lock size={13} className="text-amber-400" /> : <Unlock size={13} />}
    </button>
  );
  const tools = (
    <div className="flex items-center gap-1.5 shrink-0">
      {lockBtn}
      <button className="text-slate-500 hover:text-white" onClick={() => onMove(-1)} title="Move up"><ArrowUp size={13} /></button>
      <button className="text-slate-500 hover:text-white" onClick={() => onMove(1)} title="Move down"><ArrowDown size={13} /></button>
      <button className="text-slate-500 hover:text-rose-400" onClick={onRemove} title="Remove block"><Trash2 size={13} /></button>
    </div>
  );
  if (block.kind === 'narration') {
    return (
      <div className={cx('rounded-md border p-2.5', block.locked ? 'border-amber-700/50 bg-amber-950/10' : 'border-slate-800 bg-slate-950/50')}>
        <div className="flex items-center gap-2 mb-1.5 text-[11px] uppercase tracking-wide text-slate-500">
          <span className="text-indigo-300">Narration</span><span>{block.mode}</span>
          {hasValidTake(block) ? (
            <>
              <button onClick={onPlay} className="text-indigo-300 hover:text-white" title="Play the Vox take">{playing ? <Pause size={13} /> : <Play size={13} />}</button>
              <span className="normal-case text-slate-300">{block.takeSec.toFixed(1)} s Vox take</span>
            </>
          ) : (
            <span className="normal-case" title="Words at 155 per minute; preview the audio for the real length">{block.takeUrl ? 'take is for older wording, ' : ''}about {((block.text.trim().split(/\s+/).filter(Boolean).length / 155) * 60).toFixed(1)} s, estimated</span>
          )}
          <div className="flex-1" />{tools}
        </div>
        <textarea className="w-full bg-transparent text-sm text-slate-100 leading-relaxed resize-y min-h-[3rem] focus:outline-none" value={block.text}
          onChange={e => onChange({ ...block, text: e.target.value })} rows={Math.min(8, Math.max(2, Math.ceil(block.text.length / 90)))} />
        {block.claims.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {block.claims.map((c, i) => (
              <button key={i} onClick={() => onClaim(c.segStart)} title={`${c.speaker}: “${c.verbatim}”`}
                className="text-[11px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 max-w-[22rem] truncate">
                {c.speaker} {hms(c.segStart)} “{c.verbatim}”
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  if (block.kind === 'clip') {
    return (
      <div className={cx('rounded-md border p-2.5', block.locked ? 'border-amber-700/50 bg-amber-950/10' : 'border-emerald-900/50 bg-emerald-950/10')}>
        <div className="flex items-center gap-2 mb-1 text-[11px] uppercase tracking-wide text-slate-500">
          <button onClick={onPlay} className="text-emerald-300 hover:text-white" title="Play this cut">{playing ? <Pause size={13} /> : <Play size={13} />}</button>
          <span className="text-emerald-300">Clip</span>
          <span className="normal-case text-slate-300 truncate">{clip?.title || block.clipId}</span>
          <span>{clip?.speaker}</span>
          <span>{hms(block.inSec)}–{hms(block.outSec)} ({(block.outSec - block.inSec).toFixed(1)} s, {block.trimBasis})</span>
          <span className="text-slate-400">{block.fn}</span>
          <div className="flex-1" />{tools}
        </div>
        <p className="text-sm text-slate-200 italic">“{block.keptText}”</p>
        {block.flag && <p className="mt-1 text-[11px] text-amber-300 flex items-center gap-1"><AlertTriangle size={11} /> {block.flag}</p>}
        {!clip && <p className="mt-1 text-[11px] text-rose-300">This clip is no longer in the project.</p>}
      </div>
    );
  }
  if (block.kind === 'pause') {
    return (
      <div className="rounded-md border border-slate-800 bg-slate-950/40 px-2.5 py-1.5 flex items-center gap-2 text-xs text-slate-400">
        Pause <input type="number" step={0.5} min={0} max={10} className={cx(input, 'w-16')} value={block.sec} onChange={e => onChange({ ...block, sec: Math.max(0, Number(e.target.value) || 0) })} /> s
        <div className="flex-1" />{tools}
      </div>
    );
  }
  return (
    <div className="rounded-md border border-fuchsia-900/50 bg-fuchsia-950/10 px-2.5 py-1.5 flex items-center gap-2 text-xs text-fuchsia-200">
      Music marker: {block.cue.replace('_', ' ')} <span className="text-slate-400">{block.note}</span>
      <span className="text-[10px] text-slate-500">(label only; music is added outside the app)</span>
      <div className="flex-1" />{tools}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Main                                                                                            */
/* ---------------------------------------------------------------------------------------------- */

export default function ScriptStudio({ onOpenMontage }: { onOpenMontage?: () => void } = {}) {
  const player = usePlayer();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(() => { try { return localStorage.getItem(PROJECT_STORAGE_KEY); } catch { return null; } });
  const [data, setData] = useState<ProjectResponse | null>(null);
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [roles, setRoles] = useState<RoleChoice>(loadRoleChoice);
  const [showRoles, setShowRoles] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [runInfo, setRunInfo] = useState<RunResponse | null>(null);
  const [rows, setRows] = useState<TranscriptRow[]>([]);
  const [query, setQuery] = useState('');
  const [focusTime, setFocusTime] = useState<number | null>(null);
  const [sel, setSel] = useState<{ from?: number; to?: number }>({});
  const [renames, setRenames] = useState<Record<string, string>>({});
  const [logEntries, setLogEntries] = useState<LogEntry[] | null>(null);
  const [viewVersion, setViewVersion] = useState<{ id: string; diff: { blockId: string; change: string }[] } | null>(null);
  const [viewTag, setViewTag] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<{ releaseTag: string; title: string }[]>([]);
  const stopRef = useRef<{ id: string; at: number } | null>(null);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  // When a preview finishes, refresh the takes without throwing away edits made meanwhile.
  const preview = usePreviewJob(projectId, () => {
    if (!projectId) return;
    void scriptApi.project(projectId).then(r => { setData(r); if (!dirtyRef.current) setSegments(r.head ? r.head.segments : null); }).catch(setError);
  });
  const stopStream = useRef<(() => void) | null>(null);

  const recheck = useCallback(async () => {
    setChecking(true);
    try { setStatus(await scriptApi.status()); } catch (e) { setError(e); } finally { setChecking(false); }
  }, []);
  useEffect(() => { void recheck(); }, [recheck]);
  useEffect(() => { saveRoleChoice(roles); }, [roles]);
  useEffect(() => { try { if (projectId) localStorage.setItem(PROJECT_STORAGE_KEY, projectId); else localStorage.removeItem(PROJECT_STORAGE_KEY); } catch { /* ignore */ } }, [projectId]);

  const load = useCallback(async (id: string) => {
    try {
      const r = await scriptApi.project(id);
      setData(r);
      setSegments(r.head ? r.head.segments : null);
      setDirty(false);
      return r;
    } catch (e) {
      if (e instanceof ScriptApiError && e.status === 404) setProjectId(null);
      setError(e);
      return null;
    }
  }, []);

  // Open project: load it, its transcript, and attach to an active run if any.
  useEffect(() => {
    if (!projectId) { setData(null); return; }
    void load(projectId).then(r => {
      if (!r) return;
      const live = r.runs.find(x => x.active) || r.runs.find(x => x.status === 'paused_limit' || x.status === 'interrupted');
      if (live) setRunId(live.id);
      setViewTag(r.project.sourceTags[0]);
    });
  }, [projectId, load]);
  useEffect(() => { if (projectId && !episodes.length) scriptApi.episodes().then(r => setEpisodes(r.episodes)).catch(() => undefined); }, [projectId, episodes.length]);

  // Follow a run's events.
  const refreshRun = useCallback(async (pid: string, rid: string) => {
    try { setRunInfo(await scriptApi.run(pid, rid)); } catch (e) { setError(e); }
  }, []);
  useEffect(() => {
    stopStream.current?.();
    setEvents([]);
    setRunInfo(null);
    if (!projectId || !runId) return;
    void refreshRun(projectId, runId);
    stopStream.current = streamRun(projectId, runId, ev => {
      setEvents(prev => (prev.some(p => p.seq === ev.seq) ? prev : [...prev, ev]));
      if (ev.type === 'decision' || ev.type === 'finished' || ev.type === 'status') void refreshRun(projectId, runId);
    }, () => { void refreshRun(projectId, runId); void load(projectId); });
    return () => stopStream.current?.();
  }, [projectId, runId, refreshRun, load]);

  // Stop clip playback at the cut's out point.
  useEffect(() => {
    const s = stopRef.current;
    if (s && player.current?.id === s.id && player.isPlaying && player.currentTime >= s.at) { player.togglePlay(); stopRef.current = null; }
  }, [player.currentTime, player.current, player.isPlaying, player]);

  const project = data?.project;
  const tag = project && project.sourceTags.includes(viewTag) ? viewTag : project?.sourceTags[0] || '';
  // The transcript shown on the left: one recording of the project at a time.
  useEffect(() => {
    if (!tag) { setRows([]); return; }
    setSel({}); setFocusTime(null);
    fetch(`/transcripts/episodes/${encodeURIComponent(tag)}.json`).then(res => res.json()).then(j => {
      setRows((j.segments || []).map((s: any, i: number) => ({ id: `u${i}`, start: Number(s.start) || 0, end: Number(s.end) || 0, speaker: String(s.speaker || 'Unknown'), text: String(s.text || '') })));
    }).catch(() => setRows([]));
  }, [tag]);
  const analysis = data?.analyses[tag] || null;
  const allAnalysed = !!project && project.sourceTags.every(t => data?.analyses[t]);
  const stats = data?.speakerStats[tag];
  const clipsById = useMemo(() => Object.fromEntries((project?.clips || []).map(c => [c.clipId, c])), [project]);
  const runtime = useMemo(() => (segments ? estimateRuntime(segments) : null), [segments]);
  const names = namesForTag(project?.speakerNames, tag);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    if (dirty && !window.confirm('You have unsaved edits. Continue and discard them?')) return;
    setBusy(label); setError(null);
    try { await fn(); if (projectId) await load(projectId); } catch (e) { setError(e); } finally { setBusy(null); }
  };

  if (!projectId || !project) {
    return <SetupScreen status={status} checking={checking} onRecheck={recheck} onOpen={id => { setRunId(null); setProjectId(id); }} />;
  }

  const editBlock = (segI: number, scI: number, bI: number, next: Block | null, move?: -1 | 1) => {
    setSegments(prev => {
      if (!prev) return prev;
      const copy: Segment[] = JSON.parse(JSON.stringify(prev));
      const blocks = copy[segI].scenes[scI].blocks;
      if (move) {
        const j = bI + move;
        if (j < 0 || j >= blocks.length) return prev;
        [blocks[bI], blocks[j]] = [blocks[j], blocks[bI]];
      } else if (next) blocks[bI] = next;
      else blocks.splice(bI, 1);
      return copy;
    });
    setDirty(true);
  };
  const addNarration = (segI: number, scI: number) => {
    setSegments(prev => {
      if (!prev) return prev;
      const copy: Segment[] = JSON.parse(JSON.stringify(prev));
      copy[segI].scenes[scI].blocks.push({ id: `b_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, kind: 'narration', text: 'New narration.', mode: 'live', claims: [] });
      return copy;
    });
    setDirty(true);
  };
  const save = () => act('Saving', async () => {
    if (!segments) return;
    await scriptApi.saveVersion(project.id, project.headVersionId, segments, 'Edit');
    setDirty(false);
  });
  const playTake = (b: Extract<Block, { kind: 'narration' }>) => {
    if (!hasValidTake(b)) return;
    const id = `script:${b.id}`;
    if (player.current?.id === id) { player.togglePlay(); return; }
    stopRef.current = null;
    player.play({ id, title: `Narration: ${b.text.slice(0, 60)}`, audioUrl: b.takeUrl });
  };
  const playClip = (b: Extract<Block, { kind: 'clip' }>) => {
    const c = clipsById[b.clipId];
    if (!c) return;
    const id = `script:${b.id}`;
    if (player.current?.id === id && player.isPlaying) { player.togglePlay(); return; }
    const off = c.audioOffsetSec || 0;
    stopRef.current = { id, at: off + b.outSec };
    player.play({ id, title: c.title, audioUrl: c.audioUrl }, off + b.inSec);
  };

  const run = runInfo?.run;
  const runActive = !!run?.active;
  const critiques = (run?.critiques || (events.filter(e => e.type === 'critique').slice(-1)[0]?.data as any[] | undefined)) as any[] | undefined;

  const searchRows = (() => {
    const q = query.trim().toLowerCase();
    if (focusTime != null && !q) {
      const i = rows.findIndex(r => r.end >= focusTime);
      return rows.slice(Math.max(0, i - 3), Math.max(0, i - 3) + 30);
    }
    if (!q) return rows.slice(0, 60);
    return rows.filter(r => r.text.toLowerCase().includes(q) || (names[r.speaker] || r.speaker).toLowerCase().includes(q)).slice(0, 100);
  })();
  const pick = (i: number) => setSel(s => (s.from == null || s.to != null ? { from: i } : i < s.from ? { from: i, to: s.from } : { from: s.from, to: i }));

  const stage = {
    analysis: allAnalysed, outline: !!data?.head, draft: !!data?.head?.segments.some(s => s.scenes.some(sc => sc.blocks.length)),
  };
  const headVersion = data?.versions.find(v => v.id === project.headVersionId);

  return (
    <div className="h-full flex flex-col bg-slate-950 text-slate-200">
      {/* Header */}
      <div className="border-b border-slate-800 px-4 py-2 flex flex-wrap items-center gap-2">
        <button className={btnGhost} onClick={() => { if (dirty && !window.confirm('Discard unsaved edits?')) return; setProjectId(null); setRunId(null); }}><ChevronLeft size={12} /> Projects</button>
        <input className={cx(input, 'w-64 font-semibold')} value={project.title} onChange={e => setData(d => (d ? { ...d, project: { ...d.project, title: e.target.value } } : d))}
          onBlur={e => void scriptApi.updateProject(project.id, { title: e.target.value }).catch(setError)} />
        <select className={input} value={project.format || ''} onChange={e => void act('Saving format', () => scriptApi.updateProject(project.id, { format: e.target.value || null }))}>
          <option value="">Format: not set</option>
          {EPISODE_FORMATS.map(f => <option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}
        </select>
        <label className="text-xs text-slate-400 flex items-center gap-1">Target
          <input type="number" min={1} className={cx(input, 'w-16')} defaultValue={Math.round(project.targetRuntimeSec / 60)} key={project.targetRuntimeSec}
            onBlur={e => void act('Saving length', () => scriptApi.updateProject(project.id, { targetRuntimeSec: Math.max(1, Number(e.target.value) || 1) * 60 }))} /> min
        </label>
        {runtime && segments && <span className={cx('text-xs', data?.gates?.runtimeOk ? 'text-emerald-400' : 'text-amber-400')}>Now {hms(runtime.sec)}{runtime.estimated ? (() => { const t = countTakes(segments); return t.withTake ? ` (${t.withTake} of ${t.narration} narration lines measured from Vox takes, the rest estimated at 155 wpm)` : ' (narration estimated at 155 wpm)'; })() : countTakes(segments).narration ? ' (narration measured from Vox takes)' : ''}</span>}
        <div className="flex-1" />
        <button className={btnGhost} onClick={() => setShowRoles(s => !s)}>Models: {roles.mode === 'subscription' ? 'subscriptions' : `fallback, cap $${roles.maxUsd.toFixed(2)}`}</button>
        {runActive ? (
          <button className={btnGhost} onClick={() => void scriptApi.cancel(project.id, run!.id).catch(setError)}><Square size={12} /> Cancel run</button>
        ) : (
          <button className={btnPrimary} disabled={!stage.draft || !!busy || dirty} title={dirty ? 'Save your edits first' : ''}
            onClick={() => void act('Starting refinement', async () => { const r = await scriptApi.refine(project.id, roles); setRunId(r.runId); })}><Wand2 size={12} /> Refine</button>
        )}
        {!runActive && (
          <button className={btnGhost} disabled={!stage.draft || !!busy || dirty} title="Critique every segment once and change nothing"
            onClick={() => void act('Critiquing', async () => { const r = await scriptApi.refine(project.id, roles, { critiqueOnly: true }); setRunId(r.runId); })}>Critique only</button>
        )}
        {run && <span className="text-xs text-slate-400">Run: <span className={cx(run.status === 'running' && 'text-indigo-300', run.status === 'paused_limit' && 'text-amber-300', run.status === 'finished' && 'text-emerald-300', run.status === 'failed' && 'text-rose-300')}>{run.status.replace('_', ' ')}</span>{run.status === 'running' ? `, round ${run.currentRound + 1} of ${run.maxRounds}` : ''}{run.mode === 'fallback' ? `, $${run.spentUsd.toFixed(4)} of $${run.maxUsd.toFixed(2)}` : ''}</span>}
      </div>
      {showRoles && (
        <div className="border-b border-slate-800 px-4 py-2 flex flex-wrap items-center gap-3 text-xs bg-slate-900/50">
          <label className="flex items-center gap-1">Mode
            <select className={input} value={roles.mode} onChange={e => setRoles(r => ({ ...r, mode: e.target.value as RoleChoice['mode'], roleMap: {} }))}>
              <option value="subscription">Subscriptions (Claude Code + Codex)</option>
              <option value="fallback">Fallback (CheaperInference)</option>
            </select>
          </label>
          {ROLES.filter(r => roles.mode === 'fallback' || r !== 'polish').map(r => {
            const def = (roles.mode === 'fallback' ? status?.defaults.fallback : status?.defaults.subscription)?.[r] || '';
            return (
              <label key={r} className="flex items-center gap-1">{r}
                <select className={input} value={roles.roleMap[r] || ''} onChange={e => setRoles(x => ({ ...x, roleMap: { ...x.roleMap, [r]: e.target.value || undefined } }))}>
                  <option value="">default ({def})</option>
                  {ROLE_SPECS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            );
          })}
          <label className="flex items-center gap-1">Dollar cap per run <input type="number" min={0} step={0.05} className={cx(input, 'w-20')} value={roles.maxUsd} onChange={e => setRoles(r => ({ ...r, maxUsd: Math.max(0, Number(e.target.value) || 0) }))} /></label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={roles.episodePass !== false} onChange={e => setRoles(r => ({ ...r, episodePass: e.target.checked }))} /> Episode structure pass after the scene rounds</label>
          {roles.mode === 'fallback' && <label className="flex items-center gap-1" title="One claude-sonnet-5.5 call through CheaperInference; the result waits for your review"><input type="checkbox" checked={!!roles.polish} onChange={e => setRoles(r => ({ ...r, polish: e.target.checked }))} /> Final narration polish</label>}
          <span className="text-slate-500">Judge and fact check must be a different model family from the reviser; the server refuses otherwise.</span>
        </div>
      )}
      {(error || busy) && <div className="px-4 pt-2 space-y-2">
        {busy && <div className="text-xs text-indigo-300 flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> {busy}…</div>}
        <ErrorBox error={error} onClose={() => setError(null)} />
      </div>}

      <div className="flex-1 min-h-0 grid grid-cols-[18rem_minmax(0,1fr)_22rem]">
        {/* Left: stages, speakers, transcript, clip bin */}
        <aside className="border-r border-slate-800 overflow-y-auto p-3 space-y-4">
          <div className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">Stages</div>
            <StageRow done={stage.analysis} label={project.sourceTags.length > 1 ? `Analyse the ${project.sourceTags.length} recordings` : 'Analyse the episode'} note={project.sourceTags.length > 1 ? `${project.sourceTags.filter(t => data?.analyses[t]).length} of ${project.sourceTags.length} analysed` : analysis ? `${analysis.moments.length} moments, ${analysis.themes.length} themes${analysis.chunks.some(c => !c.ok) ? `; ${analysis.chunks.filter(c => !c.ok).length} chunk(s) failed` : ''}` : undefined}
              action={<button className={btnGhost} disabled={!!busy} onClick={() => void act('Analysing (one model call per transcript chunk), then tagging clips', async () => {
                const r = await scriptApi.analyze(project.id, roles, stage.analysis);
                if ('error' in r.tagging) setError(new ScriptApiError(0, r.tagging.code, `The analysis is saved, but clip tagging failed: ${r.tagging.error}`));
              })}>{stage.analysis ? 'Re-run' : 'Run'}</button>} />
            <StageRow done={stage.outline} label="Outline" action={<button className={btnGhost} disabled={!!busy || !stage.analysis} onClick={() => void act('Outlining', () => scriptApi.outline(project.id, roles))}>{stage.outline ? 'New outline' : 'Run'}</button>} />
            <StageRow done={stage.draft} label="Draft narration and clips" action={<button className={btnGhost} disabled={!!busy || !stage.outline} title="The first draft builds Logan's style card from the whole archive if there is none yet"
              onClick={() => void act('Drafting each segment (building the style card first if needed)', async () => { const r = await scriptApi.draft(project.id, roles); setNotice(r.style.warning || (r.style.built ? "Built Logan's style card from the archive before drafting." : null)); })}>Run</button>} />
            <StageRow done={run?.status === 'finished'} label="Refine (background)" note={run ? `${run.status.replace('_', ' ')}${run.stopReason ? `: ${run.stopReason.replace(/_/g, ' ')}` : ''}` : 'Use Refine in the header.'} />
          </div>

          {notice && <div className="text-[11px] text-indigo-200 flex items-start gap-1"><span className="flex-1">{notice}</span><button onClick={() => setNotice(null)}><X size={11} /></button></div>}

          {data && <RecordingsPanel data={data} viewTag={tag} onView={setViewTag} act={act} episodes={episodes} />}
          {project.format === 'investigative' && <PaperTrailPanel projectId={project.id} sourceTags={project.sourceTags} act={act} />}

          {data?.transcriptChanged.length ? <div className="text-[11px] text-amber-300">The transcript changed on disk since this project was created. Re-run the analysis.</div> : null}

          {stats && stats.unnamedShare > 0.2 && (
            <div className="rounded-md border border-amber-700/50 bg-amber-950/20 p-2 space-y-1.5">
              <div className="text-[11px] text-amber-200 flex items-center gap-1"><AlertTriangle size={11} /> {Math.round(stats.unnamedShare * 100)}% of speech has no speaker name. Name them so quotes and narration attribute correctly.</div>
              {stats.topUnnamed.map(u => (
                <label key={u.speaker} className="flex items-center gap-1 text-[11px] text-slate-300">{u.speaker} ({hms(u.sec)})
                  <input className={cx(input, 'flex-1')} placeholder="Name" value={renames[u.speaker] ?? names[u.speaker] ?? ''} onChange={e => setRenames(r => ({ ...r, [u.speaker]: e.target.value }))} />
                </label>
              ))}
              <button className={btnGhost} onClick={() => void act('Saving names', () => scriptApi.updateProject(project.id, { speakerNames: { ...project.speakerNames, ...Object.fromEntries(Object.entries(renames).map(([raw, v]) => [renameKey(project.sourceTags.length, tag, raw), v])) } }).then(() => setRenames({})))}>Save names</button>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">Transcript{project.sourceTags.length > 1 ? ` (${data?.recordings.find(r => r.releaseTag === tag)?.key || ''} ${data?.recordings.find(r => r.releaseTag === tag)?.date || ''})` : ''}</div>
            <input className={cx(input, 'w-full')} placeholder="Search words or speaker" value={query} onChange={e => { setQuery(e.target.value); setFocusTime(null); }} />
            <div className="text-[11px] text-slate-500">Click a line, then another, to select a range to add as a clip.</div>
            <ul className="space-y-0.5 max-h-80 overflow-y-auto">
              {searchRows.map(r => {
                const i = Number(r.id.slice(1));
                const inSel = sel.from != null && i >= sel.from && i <= (sel.to ?? sel.from);
                const near = focusTime != null && r.start <= focusTime && r.end >= focusTime;
                return (
                  <li key={r.id}>
                    <button onClick={() => pick(i)} className={cx('w-full text-left text-[11px] rounded px-1.5 py-1', inSel ? 'bg-indigo-900/50' : near ? 'bg-slate-800' : 'hover:bg-slate-900')}>
                      <span className="text-slate-500">{hms(r.start)} </span><span className="text-indigo-300">{names[r.speaker] || r.speaker}: </span><span className="text-slate-300">{r.text}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {sel.from != null && (
              <div className="flex items-center gap-1">
                <button className={btnGhost} onClick={() => void act('Adding clip', () => scriptApi.addClip(project.id, `u${sel.from}`, `u${sel.to ?? sel.from}`, tag)).then(() => setSel({}))}><Scissors size={12} /> Add u{sel.from}{sel.to != null ? `–u${sel.to}` : ''} as a clip</button>
                <button className="text-slate-500 hover:text-white" onClick={() => setSel({})}><X size={12} /></button>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-1">
              <div className="text-[11px] uppercase tracking-wide text-slate-500 flex-1">Clip bin ({project.clips.length})</div>
              <button className={btnGhost} disabled={!!busy || !stage.analysis || !project.clips.length} title="Tag each clip with its narrative function (your own tags are kept)"
                onClick={() => void act('Tagging clips', () => scriptApi.tagClips(project.id, roles, true))}>Tag clips</button>
            </div>
            {project.clips.length === 0 && <div className="text-[11px] text-slate-500">No catalog clips for this episode. Add clips from the transcript above.</div>}
            {[...NARRATIVE_FUNCTIONS, undefined].map(fn => {
              const list = project.clips.filter(c => c.fn === fn);
              if (!list.length) return null;
              return (
                <div key={fn || 'untagged'}>
                  <div className="text-[11px] text-slate-400">{fn ? fn.replace('_', ' ') : 'untagged'}</div>
                  {list.map(c => (
                    <div key={c.clipId} className="flex items-center gap-1 text-[11px] text-slate-300 py-0.5" title={c.fnRationale ? `${c.fnRationale}\n\n${c.text}` : c.text}>
                      <span className="truncate flex-1">{project.sourceTags.length > 1 && <span className="text-indigo-300">{data?.recordings.find(r => r.releaseTag === c.releaseTag)?.key} </span>}{c.title}</span><span className="text-slate-500">{hms(c.durationSec)}</span>
                      <select className="bg-slate-950 border border-slate-800 rounded text-[10px] text-slate-400 max-w-[6.5rem]" value={c.fn || ''} title="Narrative function"
                        onChange={e => void act('Retagging', () => scriptApi.retagClip(project.id, c.clipId, e.target.value || null))}>
                        <option value="">untagged</option>
                        {NARRATIVE_FUNCTIONS.map(f => <option key={f} value={f}>{f.replace('_', ' ')}</option>)}
                      </select>
                      <button className="text-slate-500 hover:text-rose-400" title="Remove from project" onClick={() => void act('Removing clip', () => scriptApi.updateProject(project.id, { removeClipIds: [c.clipId] }))}><Trash2 size={11} /></button>
                    </div>
                  ))}
                </div>
              );
            })}
            {project.excludedClips.length > 0 && <details className="text-[11px] text-slate-500"><summary>{project.excludedClips.length} excluded</summary>{project.excludedClips.map(x => <div key={x.clipId}>{x.clipId}: {x.reason}</div>)}</details>}
          </div>

          {analysis && (
            <details className="text-[11px] text-slate-300" open={!stage.outline}>
              <summary className="text-[11px] uppercase tracking-wide text-slate-500 cursor-pointer">Analysis ({analysis.provider} {analysis.model})</summary>
              {analysis.themes.map(t => <div key={t.id} className="mt-1"><span className="text-indigo-300">{t.label}:</span> {t.summary}</div>)}
              {analysis.moments.map(m => (
                <button key={m.id} className="block text-left mt-1 hover:text-white" onClick={() => { setQuery(''); setFocusTime(m.start); }}>
                  <span className="text-slate-500">{hms(m.start)} {m.kind}</span> {m.why}
                </button>
              ))}
              {analysis.openQuestions.length > 0 && <div className="mt-1 text-slate-400">Open questions: {analysis.openQuestions.join(' · ')}</div>}
            </details>
          )}
        </aside>

        {/* Center: block editor */}
        <main className="overflow-y-auto p-4 space-y-4">
          <div className="flex items-center gap-2">
            <div className="text-sm text-slate-300">{headVersion ? `${headVersion.label || 'Version'} · ${headVersion.author} · ${new Date(headVersion.createdAt).toLocaleString()}` : 'No script yet'}</div>
            <div className="flex-1" />
            {dirty && <span className="text-xs text-amber-300">Unsaved edits</span>}
            <button className={btnGhost} disabled={!dirty} onClick={() => { setSegments(data?.head?.segments || null); setDirty(false); }}><RotateCcw size={12} /> Discard</button>
            <button className={btnPrimary} disabled={!dirty || !!busy} onClick={() => void save()}><Save size={12} /> Save version</button>
          </div>
          {data?.gates && (data.gates.failures.length ? (
            <div className="rounded-md border border-amber-700/50 bg-amber-950/20 p-2 text-[11px] text-amber-200 space-y-0.5">
              <div className="font-semibold">Checks on the current version</div>
              {data.gates.failures.map((f, i) => <div key={i}>• {f}</div>)}
            </div>
          ) : <div className="text-[11px] text-emerald-400 flex items-center gap-1"><Check size={11} /> Quotes verbatim, clip cuts in bounds, locks intact, runtime within 10% of target.</div>)}
          {data?.formatChecks && project.format && data.formatChecks.soft.length > 0 && (
            <div className="rounded-md border border-slate-800 bg-slate-900/40 p-2 text-[11px] space-y-0.5">
              <div className="font-semibold text-slate-300">{FORMAT_LABELS[project.format]} format notes</div>
              {data.formatChecks.soft.map(f => <div key={f.key} className="text-slate-400">· {f.message}</div>)}
              <div className="text-slate-500">Notes go to the critic; they never block a change. Hard format rules appear under the checks above.</div>
            </div>
          )}
          {!segments && <div className="text-sm text-slate-500">Run the analysis, then the outline and the draft from the left.</div>}
          {segments?.map((seg, segI) => (
            <section key={seg.id} className="space-y-3">
              <h2 className="text-base font-semibold text-white">{seg.title}</h2>
              {seg.notDrafted && <div className="text-xs text-rose-300">Not drafted: {seg.notDrafted}</div>}
              {seg.scenes.map((sc, scI) => (
                <div key={sc.id} className={cx(card, 'p-3 space-y-2')}>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-slate-100">{sc.title}</h3>
                    <span className="text-xs text-slate-500 flex-1 truncate">{sc.purpose}</span>
                    {run?.refinedSceneIds.includes(sc.id) && <span className="text-[10px] text-indigo-300">refined this run</span>}
                    {sc.blocks.some(b => b.kind === 'narration') && (
                      <button className="text-[11px] text-slate-400 hover:text-white disabled:opacity-40" disabled={dirty || preview.running} title={dirty ? 'Save your edits first' : 'Speak this scene\'s narration with Vox'}
                        onClick={() => void preview.start(sc.id)}>Preview scene</button>
                    )}
                  </div>
                  {sc.blocks.length === 0 && <div className="text-xs text-slate-500">No blocks yet{sc.suggestedClipIds?.length ? `; suggested clips: ${sc.suggestedClipIds.map(id => clipsById[id]?.title || id).join(', ')}` : ''}.</div>}
                  {sc.blocks.map((b, bI) => (
                    <BlockView key={b.id} block={b} clip={b.kind === 'clip' ? clipsById[b.clipId] : undefined}
                      playing={player.current?.id === `script:${b.id}` && player.isPlaying}
                      onChange={nb => editBlock(segI, scI, bI, nb)} onRemove={() => editBlock(segI, scI, bI, null)} onMove={d => editBlock(segI, scI, bI, null, d)}
                      onPlay={() => (b.kind === 'clip' ? playClip(b) : b.kind === 'narration' ? playTake(b) : undefined)} onClaim={t => { setQuery(''); setFocusTime(t); }} />
                  ))}
                  <button className={btnGhost} onClick={() => addNarration(segI, scI)}><Plus size={12} /> Narration</button>
                </div>
              ))}
            </section>
          ))}
        </main>

        {/* Right: run, critiques, candidates, versions */}
        <aside className="border-l border-slate-800 overflow-y-auto p-3 space-y-4 text-xs">
          <AudioPanel project={project} head={data?.head || null} dirty={dirty} roles={roles} runActive={runActive} preview={preview}
            onRunStarted={id => setRunId(id)} onOpenMontage={onOpenMontage} onError={setError} />
          {run && (
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Refinement run</div>
              {run.pausedInfo && (
                <div className="rounded-md border border-amber-700/50 bg-amber-950/20 p-2 space-y-1.5">
                  <div className="text-amber-200">Paused: {run.pausedInfo.role} on {run.pausedInfo.provider}: {run.pausedInfo.code}. {run.pausedInfo.message}</div>
                  <ResumeControls status={status} run={run} onResume={(sw, cap) => void act('Resuming', async () => { await scriptApi.resume(project.id, run.id, sw, cap); setRunId(null); setTimeout(() => setRunId(run.id), 0); })} />
                </div>
              )}
              {run.status === 'interrupted' && !run.pausedInfo && <button className={btnGhost} onClick={() => void act('Resuming', async () => { await scriptApi.resume(project.id, run.id); setRunId(null); setTimeout(() => setRunId(run.id), 0); })}><Play size={12} /> Resume at round {run.currentRound + 1}</button>}
              <button className={btnGhost} onClick={() => logEntries ? setLogEntries(null) : void scriptApi.log(run.id).then(r => setLogEntries(r.entries)).catch(setError)}>{logEntries ? 'Hide call log' : 'Call log'}</button>
              {logEntries && <LogTable entries={logEntries} />}
              <ol className="space-y-0.5 max-h-56 overflow-y-auto">
                {events.map(e => (
                  <li key={e.seq} className={cx('text-[11px]', e.type === 'error' ? 'text-rose-300' : e.type === 'judge' || e.type === 'decision' ? 'text-indigo-200' : 'text-slate-400')}>
                    <span className="text-slate-600">{new Date(e.at).toLocaleTimeString()} </span>{e.message}{e.durationMs ? ` (${(e.durationMs / 1000).toFixed(1)} s)` : ''}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {critiques && critiques.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Latest critiques</div>
              {critiques.map((c: any) => (
                <div key={c.id} className="rounded border border-slate-800 p-1.5">
                  <div className={cx('font-medium', c.severity === 'blocker' ? 'text-rose-300' : c.severity === 'major' ? 'text-amber-300' : 'text-slate-300')}>{c.severity} · {c.criterion}{c.level === 'episode' ? ` · structure (${c.structuralKind || 'arc'})` : ''}</div>
                  <div className="text-slate-300">{c.issue}</div>
                  <div className="text-slate-500">Fix: {c.proposedFix}</div>
                </div>
              ))}
            </div>
          )}
          {runInfo && runInfo.candidates.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Candidates</div>
              {runInfo.candidates.map(c => {
                const d = c.decision;
                return (
                  <div key={c.id} className={cx('rounded-md border p-2 space-y-1', d?.loopAccepted ? 'border-emerald-700/60' : 'border-slate-800')}>
                    <div className="flex items-center gap-1">
                      <span className="font-medium text-slate-100">{c.id}</span>
                      {(() => {
                        const better = d?.reviewOnly ? !!d.judge && d.judge.consensus !== 'rejected' : !!d?.loopAccepted;
                        const label = d?.reviewOnly ? (d.judge ? (better ? 'judge: better' : 'judge: not better') : 'not judged') : better ? 'loop: better' : 'loop: not better';
                        return <span className={better ? 'text-emerald-300' : 'text-slate-400'}>{label}</span>;
                      })()}
                      {d?.loganDecision && <span className="text-indigo-300">you: {d.loganDecision}</span>}
                    </div>
                    {d?.gates.failures.map((f, i) => <div key={i} className="text-amber-300">• {f}</div>)}
                    {d?.gates.factcheck?.map((f, i) => <div key={i} className={f.label === 'supported' ? 'text-emerald-300/80' : 'text-amber-300'}>Fact check: {f.label}. {f.note}</div>)}
                    {d?.reviewOnly && <div className="text-indigo-300">{d.reviewOnly}</div>}
                    {d?.notJudged && <div className="text-slate-400">{d.notJudged}</div>}
                    {d?.judge && <div className="text-slate-300">Judge {d.judge.model}: AB={d.judge.winnerAB}, BA={d.judge.winnerBA} ({d.judge.consensus.replace(/_/g, ' ')}). {d.judge.reasons.join(' ')}</div>}
                    <DiffList diff={c.diff} />
                    {!d?.loganDecision && (
                      <div className="flex gap-1">
                        <button className={btnPrimary} disabled={dirty} onClick={() => void act('Accepting', () => scriptApi.decide(project.id, c.id, 'accept', '', roles))}><Check size={12} /> Accept</button>
                        <button className={btnGhost} onClick={() => { const reason = window.prompt('Why reject it? (saved to editorial memory, optional)') ?? ''; void act('Rejecting', () => scriptApi.decide(project.id, c.id, 'reject', reason, roles)); }}><CircleSlash size={12} /> Reject</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-wide text-slate-500 flex items-center gap-1"><History size={11} /> Versions</div>
            {[...(data?.versions || [])].reverse().map(v => (
              <div key={v.id} className={cx('flex items-center gap-1 rounded px-1 py-0.5', v.id === project.headVersionId && 'bg-slate-800')}>
                <button className="flex-1 text-left truncate text-slate-300 hover:text-white" onClick={() => void scriptApi.version(project.id, v.id).then(r => setViewVersion({ id: v.id, diff: r.diff })).catch(setError)}>
                  {new Date(v.createdAt).toLocaleTimeString()} {v.label || v.author}{v.decision?.loganDecision ? ` (${v.decision.loganDecision}ed)` : ''}
                </button>
                {v.id !== project.headVersionId && <button className="text-slate-500 hover:text-white" title="Make this the current version" onClick={() => void act('Rolling back', () => scriptApi.setHead(project.id, v.id))}><RotateCcw size={11} /></button>}
              </div>
            ))}
            {viewVersion && <div className="rounded border border-slate-800 p-1.5"><div className="flex items-center text-slate-400">Changes in {viewVersion.id} vs its parent <div className="flex-1" /><button onClick={() => setViewVersion(null)}><X size={11} /></button></div><DiffList diff={viewVersion.diff as any} /></div>}
          </div>
          <a className={btnGhost} href={scriptApi.exportUrl(project.id)} download={`script-project-${project.id}.json`}><Download size={12} /> Export project JSON</a>
        </aside>
      </div>
    </div>
  );
}

function StageRow({ done, label, note, action }: { done: boolean; label: string; note?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      {done ? <CheckCircle2 size={13} className="mt-0.5 text-emerald-400 shrink-0" /> : <div className="mt-1 w-2.5 h-2.5 rounded-full border border-slate-600 shrink-0" />}
      <div className="flex-1 min-w-0"><div className="text-xs text-slate-200">{label}</div>{note && <div className="text-[11px] text-slate-500">{note}</div>}</div>
      {action}
    </div>
  );
}

function DiffList({ diff }: { diff: { blockId: string; change: string; before?: any; after?: any }[] }) {
  if (!diff.length) return <div className="text-slate-500">No block changes.</div>;
  const show = (b: any) => (b?.kind === 'narration' ? b.text : b?.kind === 'clip' ? `[clip] “${b.keptText}”` : b?.kind === 'music' ? `[music ${b.cue}]` : b?.kind === 'pause' ? `[pause ${b.sec}s]` : '');
  return (
    <ul className="space-y-1">
      {diff.map(d => (
        <li key={`${d.blockId}${d.change}`} className="text-[11px]">
          {d.before && d.change !== 'added' && <div className="text-rose-300/80 line-through decoration-rose-500/40">{show(d.before)}</div>}
          {d.after && d.change !== 'removed' && <div className="text-emerald-300/90">{show(d.after)}</div>}
        </li>
      ))}
    </ul>
  );
}

function ResumeControls({ status, run, onResume }: { status: StatusResponse | null; run: RunResponse['run']; onResume: (sw?: { role: string; spec: string }, maxUsd?: number) => void }) {
  const [spec, setSpec] = useState('');
  const [cap, setCap] = useState(run.maxUsd || 0.5);
  const role = run.pausedInfo?.role && run.pausedInfo.role !== 'unknown' && run.pausedInfo.role !== 'store' ? run.pausedInfo.role : '';
  return (
    <div className="space-y-1">
      <button className={btnGhost} onClick={() => onResume()}><Play size={12} /> Resume as is</button>
      {role && (
        <div className="flex flex-wrap items-center gap-1">
          <span>or switch {role} to</span>
          <select className={input} value={spec} onChange={e => setSpec(e.target.value)}>
            <option value="">choose</option>
            {ROLE_SPECS.filter(s => s !== (run.roleMap as any)[role]).map(s => <option key={s} value={s}>{s}{status?.providers[s] && !status.providers[s].ok ? ' (not available)' : ''}</option>)}
          </select>
          {spec.startsWith('ci:') && <label className="flex items-center gap-1">cap $<input type="number" min={0} step={0.05} className={cx(input, 'w-16')} value={cap} onChange={e => setCap(Math.max(0, Number(e.target.value) || 0))} /></label>}
          <button className={btnGhost} disabled={!spec} onClick={() => onResume({ role, spec }, spec.startsWith('ci:') ? cap : undefined)}>Switch and resume</button>
        </div>
      )}
    </div>
  );
}
