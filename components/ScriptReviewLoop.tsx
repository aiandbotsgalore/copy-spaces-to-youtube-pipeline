/**
 * Review loop panel: lock the intro explicitly, start a text-only review loop (Gemini and ChatGPT review,
 * Claude revises the body), watch its rounds, and open the one complete revised script it returns.
 */
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, CircleDashed, ExternalLink, Lock, Play, RefreshCw, Square, XCircle } from 'lucide-react';
import type { ScriptProject } from '../utils/scriptTypes';
import { scriptApi, type ReviewRunSummary } from '../utils/scriptClient';
import type { ReviewRun, RoundRecord } from '../server/scriptReviewLoop';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
const SERVICE_NAME: Record<string, string> = { claude_cli: 'Claude', codex_cli: 'ChatGPT', agy_cli: 'Gemini', inception: 'Mercury' };
const fmtTok = (n: number) => n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
const btn = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const btnPrimary = `${btn} bg-indigo-600 border-indigo-500 text-white hover:bg-indigo-500`;
const btnGhost = `${btn} bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800`;
const input = 'bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-indigo-500';

const STATUS_TEXT: Record<ReviewRun['status'], string> = {
  running: 'Running', complete: 'Complete', unfinished: 'Unfinished', cancelled: 'Stopped', failed: 'Failed',
};

function score(r: RoundRecord, id: 'gemini' | 'chatgpt') {
  const o = r.reviews[id];
  if (!o) return <span className="text-slate-500">…</span>;
  if (!o.ok) return <span className="text-rose-300" title={o.message}>failed</span>;
  const blockers = o.review.findings.filter(f => f.blocker).length;
  return <span className={o.review.score >= 90 && !blockers ? 'text-emerald-300' : 'text-amber-200'} title={o.review.summary}>{o.review.score}{blockers ? ` · ${blockers} blocker${blockers === 1 ? '' : 's'}` : ''}</span>;
}

export function ReviewLoopPanel({ project, act }: { project: ScriptProject; act: (label: string, fn: () => Promise<unknown>) => Promise<void> }) {
  const [state, setState] = useState<Awaited<ReturnType<typeof scriptApi.review>> | null>(null);
  const [file, setFile] = useState('THE_PAPER_TRAIL_MASTER_WITH_VERBATIM_INTRO_20261114.md');
  const [refFile, setRefFile] = useState('THE_PAPER_TRAIL_LOCKED_INTRO_USER_VERBATIM_20261114.txt');
  const [candidates, setCandidates] = useState<{ line: string; lineNumber: number; introChars: number }[] | null>(null);
  const [bodyStart, setBodyStart] = useState('');
  const [lockOpen, setLockOpen] = useState(false);
  const [maxCalls, setMaxCalls] = useState(40);
  const [maxUsd, setMaxUsd] = useState(1);
  const [maxRounds, setMaxRounds] = useState(12);
  const [selected, setSelected] = useState<string | null>(null);
  const [run, setRun] = useState<{ run: ReviewRun; active: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    scriptApi.review(project.id).then(s => {
      setState(s);
      setSelected(cur => cur ?? s.runs[0]?.id ?? null);
    }).catch(e => setError(e?.message || String(e)));
  }, [project.id]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (state?.defaults) { setMaxCalls(state.defaults.maxCalls); setMaxUsd(state.defaults.maxUsd); setMaxRounds(state.defaults.maxRounds); }
  }, [state?.defaults]);

  // Follow the selected run; poll while it is running.
  useEffect(() => {
    if (!selected) { setRun(null); return; }
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => scriptApi.reviewRun(project.id, selected).then(r => {
      if (stop) return;
      setRun(r);
      if (r.active || r.run.status === 'running') timer = setTimeout(tick, 4000);
      else refresh();
    }).catch(() => { if (!stop) timer = setTimeout(tick, 8000); });
    void tick();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [project.id, selected, refresh]);

  const lock = state?.lock;
  const running = state?.runs.some(r => r.active);
  const r = run?.run;

  return (
    <div className="space-y-1.5 pt-2 border-t border-slate-800/80 text-[11px]">
      <div className="text-[11px] uppercase tracking-wide text-slate-500 font-bold flex items-center gap-1"><RefreshCw size={12} /> Review loop</div>
      <div className="text-slate-400">
        Gemini and ChatGPT each review the same full script on their own. Claude rewrites the body (never the intro) using both reviews, and it repeats until both score the same revised draft {state?.threshold ?? 90} or higher with nothing that must be fixed, and the changed quotes and facts check out against the sources.
      </div>

      {/* Intro lock */}
      <div className="rounded border border-slate-800 bg-slate-950/40 p-1.5 space-y-0.5">
        <div className="text-slate-300 font-medium flex items-center gap-1"><Lock size={11} /> Locked intro</div>
        {lock ? (
          <>
            <div className="text-slate-400">From {lock.sourceFile}. The body starts at <span className="text-slate-200 font-mono">{lock.bodyStartLine}</span>. Everything before it ({lock.length.toLocaleString()} characters) stays exactly as stored.</div>
            {lock.reference && <div className={lock.reference.missing.length ? 'text-amber-300/90' : 'text-emerald-300/90'}>
              Checked against {lock.reference.file}: {lock.reference.matched} of {lock.reference.paragraphs} passages found.{lock.reference.missing.length ? ` Not found word for word: ${lock.reference.missing.slice(0, 3).join(' / ')}` : ''}
            </div>}
          </>
        ) : <div className="text-amber-300/90">Not set yet. Pick the line where the body starts before running the loop.</div>}
        <button className={btnGhost} onClick={() => setLockOpen(o => !o)}>{lock ? 'Change the intro boundary' : 'Set the intro boundary'}</button>
        {lockOpen && (
          <div className="rounded border border-slate-700 bg-slate-900/80 p-1.5 space-y-1 mt-1">
            <input className={cx(input, 'w-full')} value={file} onChange={e => setFile(e.target.value)} placeholder="Script file in the project folder" />
            <div className="flex gap-1">
              <button className={btnGhost} disabled={!file.trim()} onClick={() => void act('Reading headings', async () => {
                const c = await scriptApi.reviewBoundaries(file.trim());
                setCandidates(c.candidates);
                setBodyStart(lock?.bodyStartLine && c.candidates.some(x => x.line === lock.bodyStartLine) ? lock.bodyStartLine : (c.candidates.find(x => /ACT I\b/i.test(x.line))?.line || ''));
              })}>List headings</button>
            </div>
            {candidates && (
              <select className={cx(input, 'w-full')} value={bodyStart} onChange={e => setBodyStart(e.target.value)}>
                <option value="">Where does the body start?</option>
                {candidates.map(c => <option key={c.lineNumber} value={c.line}>line {c.lineNumber}: {c.line}</option>)}
              </select>
            )}
            <input className={cx(input, 'w-full')} value={refFile} onChange={e => setRefFile(e.target.value)} placeholder="Verbatim intro file to check against (optional)" />
            <div className="flex justify-end gap-1">
              <button className={btnGhost} onClick={() => setLockOpen(false)}>Cancel</button>
              <button className={btnPrimary} disabled={!bodyStart} onClick={() => void act('Locking the intro', async () => {
                await scriptApi.reviewSetIntro({ projectId: project.id, file: file.trim(), bodyStartLine: bodyStart, referenceFile: refFile.trim() || undefined });
                setLockOpen(false);
                refresh();
              })}>Lock everything before this line</button>
            </div>
          </div>
        )}
      </div>

      {/* Start */}
      <div className="rounded border border-slate-800 bg-slate-950/40 p-1.5 space-y-1">
        <div className="text-slate-300 font-medium">Spending limit for one run</div>
        <div className="grid grid-cols-3 gap-1">
          <label className="text-slate-400">Model calls<input type="number" min={4} className={cx(input, 'w-full')} value={maxCalls} onChange={e => setMaxCalls(Number(e.target.value))} /></label>
          <label className="text-slate-400">Paid APIs ($)<input type="number" min={0} step={0.25} className={cx(input, 'w-full')} value={maxUsd} onChange={e => setMaxUsd(Number(e.target.value))} /></label>
          <label className="text-slate-400">Rounds<input type="number" min={2} className={cx(input, 'w-full')} value={maxRounds} onChange={e => setMaxRounds(Number(e.target.value))} /></label>
        </div>
        <div className="text-[10px] text-slate-500">Model calls use your Claude, ChatGPT and Google plans (about 3 per round). Paid APIs are Mercury 3 and Cohere, used only when needed. At the limit the run stops, keeps its strongest draft and is labelled unfinished.</div>
        <button className={cx(btnPrimary, 'max-w-full')} title={lock?.sourceFile} disabled={!lock || !!running} onClick={() => void act('Starting the review loop', async () => {
          const res = await scriptApi.reviewStart({ projectId: project.id, file: lock?.sourceFile, maxCalls, maxUsd, maxRounds });
          setSelected(res.run.id);
          refresh();
        })}><Play size={11} className="shrink-0" /> <span className="truncate">Start review loop</span></button>
      </div>

      {error && <div className="text-rose-300">{error}</div>}

      {/* Runs */}
      {!!state?.runs.length && (
        <select className={cx(input, 'w-full')} value={selected || ''} onChange={e => setSelected(e.target.value)}>
          {state.runs.map((x: ReviewRunSummary) => <option key={x.id} value={x.id}>{new Date(x.createdAt).toLocaleString()} · {STATUS_TEXT[x.status]} · {x.rounds} round{x.rounds === 1 ? '' : 's'} · {x.calls} calls{x.spentUsd ? ` · $${x.spentUsd.toFixed(2)}` : ''}</option>)}
        </select>
      )}
      {r && (
        <div className="rounded border border-slate-800 bg-slate-950/40 p-1.5 space-y-1">
          <div className="flex items-center gap-1 text-slate-200 font-medium">
            {r.status === 'complete' ? <CheckCircle2 size={12} className="text-emerald-400" /> : r.status === 'running' ? <CircleDashed size={12} className="text-indigo-300 animate-spin" /> : <XCircle size={12} className="text-amber-300" />}
            {STATUS_TEXT[r.status]}{r.stopReason && r.status !== 'complete' ? ` (${r.stopReason.replace(/_/g, ' ')})` : ''}
            <span className="ml-auto text-slate-500">{r.calls}/{r.config.maxCalls} calls · ${r.spentUsd.toFixed(2)}/${r.config.maxUsd.toFixed(2)}</span>
          </div>
          {r.message && <div className="text-slate-400">{r.message}</div>}
          {r.usage && Object.keys(r.usage).length > 0 && <div className="text-[10px] text-slate-500">
            Usage so far: {Object.entries(r.usage).map(([k, u]) => `${SERVICE_NAME[k] || k} ${u.calls} call${u.calls === 1 ? '' : 's'}${u.inTok || u.outTok ? `, ${fmtTok(u.inTok)} in / ${fmtTok(u.outTok)} out` : ''}`).join(' · ')}
          </div>}
          <table className="w-full text-left [&_th]:pr-2 [&_td]:pr-2 [&_td]:py-0.5">
            <thead className="text-slate-500"><tr><th>Round</th><th>Draft</th><th>Gemini</th><th>ChatGPT</th><th>Result</th></tr></thead>
            <tbody>
              {r.rounds.map(x => (
                <tr key={x.n} className="align-top border-t border-slate-800/60">
                  <td>{x.n}</td>
                  <td>{x.draftNumber === 0 ? 'original' : `#${x.draftNumber}`}</td>
                  <td>{score(x, 'gemini')}</td>
                  <td>{score(x, 'chatgpt')}</td>
                  <td className="text-slate-400">
                    {x.passed ? (x.draftNumber === 0 ? 'passed, but the original must be revised first' : x.finalCheck ? (x.finalCheck.ok ? 'passed the source check' : `source check: ${x.finalCheck.issues.length} problem(s)`) : 'passed') : x.passBlockers.join('; ')}
                    {x.revision && <div className="text-slate-500">
                      Claude ({x.revision.tacticName.replace('_', ' ')}): {x.revision.applied} edit{x.revision.applied === 1 ? '' : 's'}{x.revision.rejected.length ? `, ${x.revision.rejected.length} not applied` : ''}
                      {x.revision.major.length ? ` · ${x.revision.major.length} major rewrite(s) compared blind, kept ${x.revision.major.map(m => m.kept).join('/')}` : ''}
                      {x.revision.structure ? ' · Mercury scene orders' : ''}
                      {x.revision.material ? ` · searched for material (${x.revision.material.hits} hits${x.revision.material.reranked ? ', Cohere reranked' : ''})` : ''}
                      {x.revision.error ? ` · ${x.revision.error}` : ''}
                    </div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.result && (
            <div className={cx('rounded p-1.5', r.status === 'complete' ? 'bg-emerald-950/40 text-emerald-200' : 'bg-amber-950/30 text-amber-200')}>
              {r.result.label}{r.result.versionId ? ' · saved as a version in the version list' : ''}{r.result.importError ? ` · could not save as a version: ${r.result.importError}` : ''}
              <a className="ml-1 underline inline-flex items-center gap-0.5" href={scriptApi.reviewTextUrl(project.id, r.id)} target="_blank" rel="noreferrer">Open the script <ExternalLink size={10} /></a>
            </div>
          )}
          <div className="flex flex-wrap gap-1">
            {run?.active && <button className={btnGhost} onClick={() => void act('Stopping the review loop', () => scriptApi.reviewCancel(project.id, r.id))}><Square size={11} /> Stop</button>}
            {r.status === 'unfinished' && !run?.active && <button className={btnGhost} onClick={() => void act('Resuming', async () => { await scriptApi.reviewResume({ projectId: project.id, runId: r.id, maxCalls: Math.max(maxCalls, r.config.maxCalls + 12), maxUsd: Math.max(maxUsd, r.config.maxUsd), maxRounds: Math.max(maxRounds, r.config.maxRounds + 4) }); refresh(); setSelected(null); setTimeout(() => setSelected(r.id), 50); })}>Continue with a higher limit</button>}
            {r.status === 'running' && !run?.active && <span className="text-slate-500">Waiting for the server…</span>}
          </div>
        </div>
      )}
    </div>
  );
}
