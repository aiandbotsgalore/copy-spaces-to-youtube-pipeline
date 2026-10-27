/**
 * Script Studio quality checks (Phase 3): the judge compared with Logan's decisions, the judge's order
 * consistency, prompt version comparisons and the call logs. Everything is computed by the server from
 * saved decisions and logs; nothing here calls a model.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { scriptApi } from '../utils/scriptClient';
import type { AgreementStats, CallStatsRow, LogEntry, LogSummary, PromptOutcomeRow, QualityReport } from '../utils/scriptQuality';

const pct = (x: number | null | undefined) => (x == null ? 'n/a' : `${Math.round(x * 100)}%`);
const th = 'text-left font-medium text-slate-400 px-2 py-1 border-b border-slate-800';
const td = 'px-2 py-1 border-b border-slate-900 text-slate-200 whitespace-nowrap';
const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function AgreementRow({ label, a }: { label: string; a: AgreementStats }) {
  return (
    <tr>
      <td className={td}>{label}</td><td className={td}>{a.pairs}</td><td className={td}>{a.conclusive}</td>
      <td className={td}>{a.agree}</td><td className={td}>{a.disagree}</td><td className={td}>{a.inconclusive}</td>
      <td className={td}>{pct(a.agreementRate)}</td><td className={td}>{a.kappa == null ? 'n/a' : a.kappa.toFixed(2)}</td>
    </tr>
  );
}
const AgreementHead = () => (
  <thead><tr><th className={th}></th><th className={th}>Decided</th><th className={th}>Judge picked a side</th><th className={th}>Agree</th><th className={th}>Disagree</th><th className={th}>Judge undecided</th><th className={th}>Agreement</th><th className={th}>Kappa</th></tr></thead>
);

export function LogTable({ entries }: { entries: LogEntry[] }) {
  const [failedOnly, setFailedOnly] = useState(false);
  const [role, setRole] = useState('');
  const roles = useMemo(() => [...new Set(entries.map(e => e.role || '?'))].sort(), [entries]);
  const shown = entries.filter(e => (!failedOnly || e.ok === false) && (!role || e.role === role));
  const total = shown.reduce<{ ms: number; cost: number; inTok: number; outTok: number }>((s, e) => ({ ms: s.ms + (e.durationMs || 0), cost: s.cost + (e.costUsd || 0), inTok: s.inTok + (e.inTok || 0), outTok: s.outTok + (e.outTok || 0) }), { ms: 0, cost: 0, inTok: 0, outTok: 0 });
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-3 text-[11px] text-slate-400">
        <label className="flex items-center gap-1"><input type="checkbox" checked={failedOnly} onChange={e => setFailedOnly(e.target.checked)} /> Failed calls only</label>
        <select className="bg-slate-950 border border-slate-700 rounded px-1 py-0.5" value={role} onChange={e => setRole(e.target.value)}>
          <option value="">All roles</option>{roles.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <span>{shown.length} calls · {sec(total.ms)} · {total.inTok.toLocaleString()} in / {total.outTok.toLocaleString()} out tokens{total.cost ? ` · $${total.cost.toFixed(4)}` : ''}</span>
      </div>
      <div className="overflow-x-auto max-h-80 overflow-y-auto">
        <table className="w-full text-[11px]">
          <thead><tr><th className={th}>Time</th><th className={th}>Role</th><th className={th}>Step</th><th className={th}>Provider / model</th><th className={th}>Prompt</th><th className={th}>Result</th><th className={th}>Time taken</th><th className={th}>Tokens</th><th className={th}>Cost</th></tr></thead>
          <tbody>
            {shown.map((e, i) => (
              <tr key={i} title={e.message || ''}>
                <td className={td}>{e.at ? new Date(e.at).toLocaleTimeString() : ''}</td><td className={td}>{e.role}</td><td className={td}>{e.label}</td>
                <td className={td}>{e.provider} {e.model}</td><td className={td}>{e.promptVersion}</td>
                <td className={td}>{e.ok ? <span className="text-emerald-300">ok</span> : <span className="text-rose-300">{e.code}{e.message ? `: ${e.message.slice(0, 80)}` : ''}</span>}</td>
                <td className={td}>{e.durationMs != null ? sec(e.durationMs) : ''}</td>
                <td className={td}>{e.inTok != null ? `${e.inTok}/${e.outTok ?? 0}` : ''}</td><td className={td}>{e.costUsd ? `$${e.costUsd.toFixed(4)}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ScriptQuality({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  const [q, setQ] = useState<Awaited<ReturnType<typeof scriptApi.quality>> | null>(null);
  const [logs, setLogs] = useState<LogSummary[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true); setError(null);
    try { const [a, b] = await Promise.all([scriptApi.quality(), scriptApi.logs()]); setQ(a); setLogs(b.logs); } catch (e: any) { setError(e?.message || String(e)); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (open) scriptApi.log(open).then(r => setEntries(r.entries)).catch(e => setError(e?.message || String(e))); }, [open]);

  if (!q) return <div className="text-xs text-slate-400 flex items-center gap-2">{loading ? <><Loader2 size={12} className="animate-spin" /> Loading…</> : error}</div>;
  const r: QualityReport = q.report;
  const current = new Set(Object.values(q.currentPromptVersions));
  return (
    <div className="space-y-5 text-xs">
      <div className="flex items-center gap-2">
        <p className="text-slate-400 flex-1">Computed from your saved decisions and call logs; nothing to set up and no model calls. Refreshed after every accept or reject.</p>
        <button className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-700 text-slate-200 hover:bg-slate-800" onClick={() => void load()}><RefreshCw size={12} /> Refresh</button>
      </div>
      {error && <div className="text-rose-300">{error}</div>}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-100">The judge compared with your decisions</h3>
        <p className="text-slate-400">The judge's pick (from both orders) against your accept or reject, on {r.sampled} of {r.totalJudged} judged changes{r.totalJudged > r.sampleMax ? ` (a fixed sample of ${r.sampleMax})` : ''}. Kappa corrects agreement for chance: 0 is chance, 1 is full agreement.</p>
        {r.note && <div className="text-amber-300 flex items-center gap-1"><AlertTriangle size={12} /> {r.note}</div>}
        <table className="text-[11px]"><AgreementHead /><tbody>
          <AgreementRow label="All" a={r.overall} />
          {Object.entries(r.byJudgeModel).map(([k, a]) => <AgreementRow key={k} label={`Judge ${k}`} a={a} />)}
          {Object.entries(r.byLevel).map(([k, a]) => <AgreementRow key={k} label={`${k} changes`} a={a} />)}
          {Object.entries(r.byConsensus).map(([k, a]) => <AgreementRow key={k} label={`Loop rule: ${k.replace(/_/g, ' ')}`} a={a} />)}
        </tbody></table>
        {r.order.judged > 0 && <div className="text-slate-300">Order consistency: of {r.order.judged} judged pairs, {r.order.consistent} gave the same answer in both orders, {r.order.sameLetter} picked the same letter both times (a position preference), {r.order.tieOrSplit} tied once.</div>}
        {r.disagreements.length > 0 && (
          <div className="space-y-1">
            <div className="text-slate-400">Recent disagreements</div>
            {r.disagreements.map(d => (
              <div key={d.candidateId} className="flex items-center gap-2 text-slate-300">
                <span>{new Date(d.createdAt).toLocaleString()}</span><span>judge preferred the {d.judgePrefers}</span><span>you {d.logan}ed</span>
                <span className="text-slate-500">{d.candidateId}</span>
                <button className="text-indigo-300 hover:text-white" onClick={() => onOpenProject(d.projectId)}>Open project</button>
              </div>
            ))}
          </div>
        )}
        {q.history.length > 1 && (
          <div className="text-slate-400">Over time: {q.history.slice(-8).map(h => `${pct(h.agreementRate)} (${h.conclusive})`).join(' → ')}</div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-100">Prompt versions</h3>
        {q.prompts.length === 0 ? <div className="text-slate-500">No loop candidates yet.</div> : <table className="text-[11px]">
          <thead><tr><th className={th}>Prompt</th><th className={th}>Candidates</th><th className={th}>Passed gates</th><th className={th}>Judged</th><th className={th}>Loop accepted</th><th className={th}>You accepted</th><th className={th}>You rejected</th><th className={th}>Waiting</th></tr></thead>
          <tbody>{q.prompts.map((p: PromptOutcomeRow) => (
            <tr key={p.promptVersion}>
              <td className={td}>{p.promptVersion}{current.has(p.promptVersion) ? '' : <span className="text-slate-500"> (older)</span>}</td>
              <td className={td}>{p.candidates}</td><td className={td}>{p.gatesPassed} ({pct(p.candidates ? p.gatesPassed / p.candidates : null)})</td><td className={td}>{p.judged}</td>
              <td className={td}>{p.loopAccepted}</td><td className={td}>{p.loganAccepted}</td><td className={td}>{p.loganRejected}</td><td className={td}>{p.pending}</td>
            </tr>
          ))}</tbody>
        </table>}
        {q.calls.length === 0 ? <div className="text-slate-500">No model calls logged yet.</div> : <table className="text-[11px]">
          <thead><tr><th className={th}>Prompt</th><th className={th}>Role</th><th className={th}>Provider / model</th><th className={th}>Calls</th><th className={th}>Failed</th><th className={th}>Avg</th><th className={th}>p90</th><th className={th}>Tokens in/out</th><th className={th}>Cost</th></tr></thead>
          <tbody>{q.calls.map((c: CallStatsRow) => (
            <tr key={`${c.promptVersion}|${c.role}|${c.provider}|${c.model}`}>
              <td className={td}>{c.promptVersion}</td><td className={td}>{c.role}</td><td className={td}>{c.provider} {c.model}</td><td className={td}>{c.calls}</td>
              <td className={td} title={Object.entries(c.failureCodes).map(([k, v]) => `${k}: ${v}`).join(', ')}>{c.failures}{c.failures ? ` (${Object.keys(c.failureCodes).join(', ')})` : ''}</td>
              <td className={td}>{sec(c.avgMs)}</td><td className={td}>{sec(c.p90Ms)}</td><td className={td}>{c.inTok.toLocaleString()}/{c.outTok.toLocaleString()}</td><td className={td}>{c.costUsd ? `$${c.costUsd.toFixed(4)}` : '$0'}</td>
            </tr>
          ))}</tbody>
        </table>}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-100">Call logs</h3>
        <table className="text-[11px]">
          <thead><tr><th className={th}>Log</th><th className={th}>Calls</th><th className={th}>Failed</th><th className={th}>Model time</th><th className={th}>Cost</th><th className={th}>Last call</th><th className={th}></th></tr></thead>
          <tbody>{logs.map(l => (
            <tr key={l.runId}>
              <td className={td}>{l.runId === 'interactive' ? 'Analysis, outline and drafts' : l.runId}</td><td className={td}>{l.calls}</td><td className={td}>{l.failures}</td>
              <td className={td}>{sec(l.totalMs)}</td><td className={td}>{l.costUsd ? `$${l.costUsd.toFixed(4)}` : '$0'}</td><td className={td}>{l.lastAt ? new Date(l.lastAt).toLocaleString() : ''}</td>
              <td className={td}><button className="text-indigo-300 hover:text-white" onClick={() => setOpen(open === l.runId ? null : l.runId)}>{open === l.runId ? 'Hide' : 'View'}</button></td>
            </tr>
          ))}</tbody>
        </table>
        {open && <LogTable entries={entries} />}
      </section>
    </div>
  );
}
