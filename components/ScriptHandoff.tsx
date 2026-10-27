/**
 * Optional Grok Bot deep pass by file handoff (Phase 6). Logan exports pack.json (the script, the
 * transcripts, his style card, the rules and the result schema), gives it to Grok Bot, and imports the
 * result.json it returns. The import is checked in code: candidates go through the loop's gates and wait
 * for Logan's accept or reject; fact-check evidence and suggested recordings keep only verbatim quotes.
 * Nothing is pushed or published from here.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Check, CircleSlash, Download, Loader2, Plus, Upload } from 'lucide-react';
import { scriptApi, type HandoffView } from '../utils/scriptClient';
import type { HandoffKind } from '../server/scriptHandoff';
import type { BlockDiff } from '../utils/scriptGates';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
const btn = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const btnPrimary = `${btn} bg-indigo-600 border-indigo-500 text-white hover:bg-indigo-500`;
const btnGhost = `${btn} bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800`;

const KINDS: { kind: HandoffKind; label: string; note: string }[] = [
  { kind: 'refine', label: 'Refine', note: 'Up to five rewritten scenes, each checked by the same gates as the loop.' },
  { kind: 'factcheck', label: 'Fact check', note: 'Every narration block checked against the whole archive.' },
  { kind: 'storyline', label: 'Storyline', note: 'Other recordings that belong in this story, with quotes.' },
];

export function HandoffPanel({ projectId, headVersionId, sourceTags, act, dirty, DiffView }: {
  projectId: string; headVersionId: string | null; sourceTags: string[]; dirty: boolean;
  act: (label: string, fn: () => Promise<unknown>) => Promise<void>;
  DiffView: (p: { diff: BlockDiff[] }) => ReactElement;
}) {
  const [kind, setKind] = useState<HandoffKind>('refine');
  const [list, setList] = useState<HandoffView[] | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async () => { try { setList((await scriptApi.handoffs(projectId)).handoffs); } catch { setList([]); } }, [projectId]);
  useEffect(() => { void refresh(); }, [refresh, headVersionId]);
  const run = (label: string, fn: () => Promise<unknown>) => act(label, fn).then(refresh);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const text = await f.text();
    if (file.current) file.current.value = '';
    await run('Checking the Grok Bot result', async () => {
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { throw new Error(`${f.name} is not JSON.`); }
      await scriptApi.importHandoff(projectId, parsed);
    });
  };

  return (
    <div className="space-y-2 text-xs">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">Grok Bot deep pass (optional)</div>
      <div className="text-slate-400">Export a pack, give it to Grok Bot for a long pass, then import the result.json it returns. Everything imported is checked here; nothing is pushed or published.</div>
      <div className="flex flex-wrap gap-1">
        {KINDS.map(k => <button key={k.kind} className={cx(btn, kind === k.kind ? 'bg-slate-700 border-slate-500 text-slate-100' : 'bg-slate-900 border-slate-700 text-slate-400')} title={k.note} onClick={() => setKind(k.kind)}>{k.label}</button>)}
      </div>
      <div className="text-slate-500">{KINDS.find(k => k.kind === kind)!.note}</div>
      <div className="flex gap-1">
        <button className={btnGhost} disabled={!headVersionId || dirty} title={dirty ? 'Save your edits first' : undefined} onClick={() => void run('Building the pack', () => scriptApi.exportHandoff(projectId, kind))}><Download size={12} /> Export pack</button>
        <button className={btnGhost} disabled={!list?.length} onClick={() => file.current?.click()}><Upload size={12} /> Import result</button>
        <input ref={file} type="file" accept="application/json,.json" className="hidden" onChange={e => void onFile(e.target.files?.[0])} />
      </div>
      {list === null && <div className="text-slate-500 flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Loading</div>}
      {list?.map(h => {
        const last = h.imports[h.imports.length - 1];
        return (
          <div key={h.requestId} className="rounded-md border border-slate-800 p-2 space-y-1">
            <div className="flex items-center gap-1">
              <span className="font-medium text-slate-100">{KINDS.find(k => k.kind === h.kind)?.label}</span>
              <span className="text-slate-500">of {h.baseVersionId}</span>
              <span className="flex-1" />
              <span className={h.status === 'imported' ? 'text-emerald-300' : 'text-slate-400'}>{h.status}</span>
            </div>
            <div className="text-slate-500">{h.requestId} · {new Date(h.createdAt).toLocaleString()} · {(h.packBytes / 1024).toFixed(0)} KB</div>
            {last && <>
              {last.report && <details><summary className="cursor-pointer text-slate-300">Grok Bot's report</summary><pre className="whitespace-pre-wrap text-slate-300 mt-1">{last.report}</pre></details>}
              {last.warnings.map((w, i) => <div key={i} className="text-amber-300">• {w}</div>)}
              {last.candidates.filter(c => c.error).map((c, i) => <div key={i} className="text-rose-300">{c.label}: not saved. {c.error}</div>)}
              {last.candidates.filter(c => c.versionId).map(c => {
                const view = h.candidates.find(x => x.versionId === c.versionId);
                return (
                  <div key={c.versionId} className="rounded border border-slate-800 p-1.5 space-y-1">
                    <div className="flex items-center gap-1"><span className="font-medium text-slate-100">{c.label}</span><span className="text-slate-500">{c.versionId}</span>{view?.loganDecision && <span className="text-indigo-300">you: {view.loganDecision}</span>}</div>
                    {c.summary && <div className="text-slate-300">{c.summary}</div>}
                    {c.failures?.map((f, i) => <div key={i} className="text-amber-300">• {f}</div>)}
                    <div className="text-slate-400">Not judged in the app.</div>
                    {view && <DiffView diff={view.diff} />}
                    {view && !view.loganDecision && (
                      <div className="flex gap-1">
                        <button className={btnPrimary} disabled={dirty} onClick={() => void run('Accepting', () => scriptApi.decide(projectId, c.versionId!, 'accept'))}><Check size={12} /> Accept</button>
                        <button className={btnGhost} onClick={() => { const reason = window.prompt('Why reject it? (saved to editorial memory, optional)') ?? ''; void run('Rejecting', () => scriptApi.decide(projectId, c.versionId!, 'reject', reason)); }}><CircleSlash size={12} /> Reject</button>
                      </div>
                    )}
                  </div>
                );
              })}
              {last.factchecks.map(f => (
                <div key={f.blockId} className="rounded border border-slate-800 p-1.5 space-y-0.5">
                  <div className={f.label === 'supported' ? 'text-emerald-300' : 'text-amber-300'}>{f.blockId}: {f.label}. <span className="text-slate-300">{f.note}</span></div>
                  {f.evidence.map((e, i) => <div key={i} className="text-slate-400">"{e.verbatim}" <span className="text-slate-500">— {e.speaker}, {e.releaseTag} {e.utteranceIds.join(', ')}</span></div>)}
                  {f.droppedEvidence > 0 && <div className="text-slate-500">{f.droppedEvidence} quote{f.droppedEvidence === 1 ? '' : 's'} not found in the transcripts and dropped.</div>}
                </div>
              ))}
              {last.recordings.map(r => (
                <div key={r.releaseTag} className="rounded border border-slate-800 p-1.5 space-y-0.5">
                  <div className="flex items-center gap-1"><span className="font-medium text-slate-100 flex-1">{r.title || r.releaseTag}</span><span className="text-slate-500">{r.date || ''}</span>
                    {!r.alreadySource && !sourceTags.includes(r.releaseTag) && <button className={btnGhost} onClick={() => void run('Adding recording', () => scriptApi.updateProject(projectId, { addSourceTags: [r.releaseTag] }))}><Plus size={11} /> Add</button>}
                  </div>
                  <div className="text-slate-300">{r.why}</div>
                  {r.quotes.map((q, i) => <div key={i} className="text-slate-400">"{q.verbatim}" <span className="text-slate-500">— {q.speaker}, {q.utteranceIds.join(', ')}</span></div>)}
                </div>
              ))}
            </>}
          </div>
        );
      })}
    </div>
  );
}
