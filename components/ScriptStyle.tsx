/**
 * Logan's style card and editorial rules (Phase 5), and the recordings of a multi-recording project.
 * The card is built automatically from every segment Logan speaks in the archive plus his narration
 * examples; Logan never picks episodes. Everything shown comes from /api/script.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, CloudDownload, ExternalLink, FileText, FolderSync, Link2, Loader2, Plus, RefreshCw, Search, Trash2, Upload, Wand2, X } from 'lucide-react';
import type { ScriptEvidenceDoc, ScriptProject } from '../utils/scriptTypes';
import {
  loadRoleChoice, scriptApi, type PaperTrailPair, type ProjectResponse, type RelatedHit, type StyleState,
} from '../utils/scriptClient';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
const btn = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const btnPrimary = `${btn} bg-indigo-600 border-indigo-500 text-white hover:bg-indigo-500`;
const btnGhost = `${btn} bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800`;
const input = 'bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-indigo-500';
const n = (x: number) => x.toLocaleString('en-US');

/* ---------------------------------------------------------------------------------------------- */
/* Style card and rules                                                                           */
/* ---------------------------------------------------------------------------------------------- */

export function StylePanel() {
  const [st, setSt] = useState<StyleState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rule, setRule] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try { setSt(await scriptApi.style()); } catch (e: any) { setError(e?.message || String(e)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!st?.building && !st?.distilling) return;
    const t = setInterval(() => void refresh(), 1500);
    return () => clearInterval(t);
  }, [st?.building, st?.distilling, refresh]);
  const run = async (fn: () => Promise<StyleState>) => {
    setBusy(true); setError(null);
    try { setSt(await fn()); } catch (e: any) { setError(e?.message || String(e)); } finally { setBusy(false); }
  };

  if (!st) return <div className="text-xs text-slate-400 flex items-center gap-2">{error || <><Loader2 size={12} className="animate-spin" /> Checking the archive…</>}</div>;
  const c = st.card;
  const explicit = st.rules.filter(r => r.source === 'explicit');
  const learned = st.rules.filter(r => r.source !== 'explicit');
  const toNext = Math.max(0, st.distillEvery - st.decisionsSinceDistill);

  return (
    <div className="space-y-4 text-xs">
      {error && <div className="rounded-md border border-rose-700/60 bg-rose-950/30 p-2 text-rose-200 flex items-start gap-2"><span className="flex-1">{error}</span><button onClick={() => setError(null)}><X size={12} /></button></div>}
      <div className="flex items-start gap-3">
        <div className="flex-1 space-y-1">
          <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2"><BookOpen size={14} className="text-indigo-400" /> Logan's style card</h2>
          <p className="text-slate-400">Built automatically from every segment Logan speaks in the archive ({n(st.recordingsWithLogan)} recordings) and his narration examples ({st.narrationFiles.join(', ') || 'none found'}). The first draft builds it; it is rebuilt when the archive grows or the examples change. Drafts, revisions and critiques all use it.</p>
          <div className={cx(st.freshness.fresh ? 'text-emerald-400' : 'text-amber-300')}>{st.freshness.reason}</div>
          {st.building && <div className="text-indigo-300 flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> {st.progress || 'Building'}…</div>}
          {st.lastError && !st.building && <div className="text-rose-300">Last build failed ({st.lastError.code}): {st.lastError.message}</div>}
        </div>
        <button className={btnGhost} disabled={busy || st.building} onClick={() => void run(() => scriptApi.buildStyle(loadRoleChoice()))}><RefreshCw size={12} /> {c ? 'Rebuild now' : 'Build now'}</button>
      </div>

      {c && <>
        <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3 space-y-1 text-slate-400">
          <div>Built {new Date(c.createdAt).toLocaleString()} by {c.provider} ({c.model}); prompts {c.traitsPromptVersion}, {c.promptVersion}.</div>
          <div>Coverage: {n(c.coverage.segmentsMeasured)} segments in {c.coverage.recordingsWithLogan} of {c.coverage.recordingsScanned} recordings measured in code; the model read {n(c.coverage.turnsRead)} of his longer turns from {c.coverage.recordingsRead} recordings ({c.coverage.batches} batch{c.coverage.batches === 1 ? '' : 'es'}{c.coverage.batchesFailed.length ? `, ${c.coverage.batchesFailed.length} failed: ${c.coverage.batchesFailed.join('; ')}` : ''}). {c.coverage.examplesDropped} quoted example{c.coverage.examplesDropped === 1 ? ' was' : 's were'} not found in the sources and dropped.</div>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          {(['live', 'polished'] as const).map(k => (
            <div key={k} className="rounded-md border border-slate-800 p-3 space-y-1.5">
              <div className="font-semibold text-slate-100">{k === 'live' ? 'Live: how he talks in his Spaces' : 'Polished: his written narration'}</div>
              <div className="text-slate-300">{c[k].summary}</div>
              <ul className="space-y-1">
                {c[k].traits.map(t => <li key={t.trait} className="text-slate-300">• {t.trait}{t.examples.length ? <span className="text-slate-500"> — {t.examples.map(e => `"${e}"`).join(' / ')}</span> : null}</li>)}
              </ul>
            </div>
          ))}
        </div>
        {c.avoid.length > 0 && <div className="text-slate-400"><span className="text-slate-200">Avoid:</span> {c.avoid.join('; ')}</div>}
        <details className="text-slate-400">
          <summary className="cursor-pointer text-slate-300">Measured over all of Logan's speech</summary>
          <div className="mt-2 grid md:grid-cols-2 gap-x-6 gap-y-1">
            <div>{n(c.stats.words)} words, {n(c.stats.speakingMinutes)} minutes, {c.stats.firstDate} to {c.stats.lastDate}</div>
            <div>{c.stats.shareOfSpeech}% of the speech in the recordings he is in; {c.stats.wordsPerMinute} words per minute</div>
            <div>Turns: {n(c.stats.turns)}, mean {c.stats.meanTurnWords} words, median {c.stats.medianTurnWords}</div>
            <div>Sentences: mean {c.stats.meanSentenceWords} words, {c.stats.shortSentenceShare}% short, {c.stats.questionShare}% questions</div>
            <div>Fillers per 100 words: {Object.entries(c.stats.fillersPer100Words).map(([k, v]) => `${k} ${v}`).join(', ')}</div>
            <div>Openers: {c.stats.topOpeners.slice(0, 6).map(o => `"${o.opener}" ${o.share}%`).join(', ')}</div>
            <div className="md:col-span-2">Phrases he uses more than the others in the same Spaces: {c.stats.signaturePhrases.map(p => `"${p.phrase}" (x${p.ratio})`).join(', ') || 'none stand out'}</div>
          </div>
        </details>
      </>}

      <div className="rounded-md border border-slate-800 p-3 space-y-2">
        <div className="font-semibold text-slate-100">Editorial rules</div>
        <div className="text-slate-400">Your rules are fixed. Learned rules are distilled by the critic from your accept and reject decisions every {st.distillEvery} decisions ({toNext ? `${toNext} to go` : 'due now'}); a learned rule needs at least two supporting decisions, and one you remove is never learned again.</div>
        {st.distilling && <div className="text-indigo-300 flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Distilling…</div>}
        {st.lastDistill && <div className={st.lastDistill.ok ? 'text-slate-300' : 'text-rose-300'}>Last distill {new Date(st.lastDistill.at).toLocaleString()}: {st.lastDistill.message}</div>}
        <div className="flex gap-2">
          <input className={cx(input, 'flex-1')} placeholder="Add your own rule, e.g. Say when each Space was recorded." value={rule} onChange={e => setRule(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && rule.trim()) void run(async () => { const r = await scriptApi.styleRule({ add: rule }); setRule(''); return r; }); }} />
          <button className={btnPrimary} disabled={!rule.trim() || busy} onClick={() => void run(async () => { const r = await scriptApi.styleRule({ add: rule }); setRule(''); return r; })}><Plus size={12} /> Add</button>
          <button className={btnGhost} disabled={busy || st.distilling || !st.decisionsSinceDistill} title="Distil learned rules from your decisions now" onClick={() => void run(() => scriptApi.distill(loadRoleChoice()))}><Wand2 size={12} /> Distil now</button>
        </div>
        {[['Your rules', explicit], ['Learned', learned]].map(([label, list]) => (
          <div key={label as string}>
            <div className="text-[11px] uppercase tracking-wide text-slate-500 mt-1">{label as string}</div>
            {(list as StyleState['rules']).length === 0 ? <div className="text-slate-500">None yet.</div> : (list as StyleState['rules']).map(r => (
              <div key={r.rule} className="flex items-center gap-2 py-0.5">
                <span className="flex-1 text-slate-200">{r.rule}</span>
                {r.source !== 'explicit' && <span className="text-slate-500">{r.source === 'rejected' ? 'from rejections' : 'from approvals'}, {r.weight} decisions</span>}
                <button className="text-slate-500 hover:text-rose-400" title="Remove" onClick={() => void run(() => scriptApi.styleRule({ remove: r.rule }))}><Trash2 size={11} /></button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Recordings of a project                                                                        */
/* ---------------------------------------------------------------------------------------------- */

export function RecordingsPanel({ data, viewTag, onView, act, episodes }: {
  data: ProjectResponse; viewTag: string; onView: (tag: string) => void;
  act: (label: string, fn: () => Promise<unknown>) => Promise<void>; episodes: { releaseTag: string; title: string }[];
}) {
  const p = data.project;
  const multiFormat = p.format === 'thematic_multi' || p.format === 'investigative';
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState(p.thesis || '');
  const [hits, setHits] = useState<RelatedHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [filter, setFilter] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const search = async () => {
    setSearching(true); setErr(null);
    try { setHits((await scriptApi.related(p.id, q)).hits); } catch (e: any) { setErr(e?.message || String(e)); } finally { setSearching(false); }
  };
  const add = (tag: string) => act('Adding recording', () => scriptApi.updateProject(p.id, { addSourceTags: [tag] })).then(() => setHits(h => h?.filter(x => x.releaseTag !== tag) || null));
  const f = filter.trim().toLowerCase();
  const shown = f ? episodes.filter(e => !p.sourceTags.includes(e.releaseTag) && (e.title.toLowerCase().includes(f) || e.releaseTag.toLowerCase().includes(f))).slice(0, 30) : [];

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <div className="text-[11px] uppercase tracking-wide text-slate-500 flex-1">Recordings ({p.sourceTags.length})</div>
        <button className={btnGhost} onClick={() => setAdding(a => !a)}><Plus size={11} /> Add</button>
      </div>
      {(multiFormat || p.sourceTags.length > 1) && (
        <textarea className={cx(input, 'w-full')} rows={2} placeholder="Thesis question this episode answers" defaultValue={p.thesis || ''} key={p.thesis || ''}
          onBlur={e => { if (e.target.value !== (p.thesis || '')) void act('Saving thesis', () => scriptApi.updateProject(p.id, { thesis: e.target.value })); }} />
      )}
      {data.recordings.map(r => (
        <div key={r.releaseTag} className={cx('flex items-center gap-1 text-[11px] rounded px-1 py-0.5', r.releaseTag === viewTag ? 'bg-slate-800' : 'hover:bg-slate-900')}>
          <button className="flex-1 text-left truncate" title={`${r.title} (${r.releaseTag})`} onClick={() => onView(r.releaseTag)}>
            {p.sourceTags.length > 1 && <span className="text-indigo-300">{r.key} </span>}<span className="text-slate-400">{r.date || 'undated'} </span><span className="text-slate-200">{r.title}</span>
          </button>
          <span className={r.analysed ? 'text-emerald-400' : 'text-slate-500'} title={r.analysed ? 'Analysed' : 'Not analysed yet'}>{r.analysed ? '✓' : '·'}</span>
          {p.sourceTags.length > 1 && <button className="text-slate-500 hover:text-rose-400" title="Remove from project" onClick={() => void act('Removing recording', () => scriptApi.updateProject(p.id, { removeSourceTags: [r.releaseTag] }))}><X size={11} /></button>}
        </div>
      ))}
      {p.sourceTags.length > 1 && <div className="text-[11px] text-slate-500">Prompts cite each recording by its key and date; one quote never spans two recordings.</div>}
      {adding && (
        <div className="rounded-md border border-slate-800 p-2 space-y-1.5">
          <div className="text-[11px] text-slate-400">Find recordings that talk about the thesis (code search over every transcript):</div>
          <div className="flex gap-1">
            <input className={cx(input, 'flex-1')} value={q} placeholder="Words to look for" onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void search(); }} />
            <button className={btnGhost} disabled={searching || !q.trim()} onClick={() => void search()}>{searching ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />}</button>
          </div>
          {err && <div className="text-[11px] text-rose-300">{err}</div>}
          {hits && hits.length === 0 && <div className="text-[11px] text-slate-500">No other recording uses those words.</div>}
          {hits?.map(h => (
            <div key={h.releaseTag} className="text-[11px] border-t border-slate-800 pt-1">
              <div className="flex items-center gap-1"><span className="text-slate-400">{h.date}</span><span className="flex-1 truncate text-slate-200" title={h.releaseTag}>{h.title}</span><button className={btnGhost} onClick={() => void add(h.releaseTag)}>Add</button></div>
              <div className="text-slate-500">{Object.entries(h.terms).filter(([, v]) => v).map(([k, v]) => `${k} ×${v}`).join(', ')}</div>
              {h.samples.map(s => <div key={s.start} className="text-slate-400 italic truncate" title={s.text}>{s.speaker}: {s.text}</div>)}
            </div>
          ))}
          <input className={cx(input, 'w-full')} placeholder="Or filter all episodes by title or tag" value={filter} onChange={e => setFilter(e.target.value)} />
          {shown.map(e => <div key={e.releaseTag} className="flex items-center gap-1 text-[11px]"><span className="flex-1 truncate text-slate-300" title={e.releaseTag}>{e.title}</span><button className={btnGhost} onClick={() => void add(e.releaseTag)}>Add</button></div>)}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* The Paper Trail (investigative)                                                                */
/* ---------------------------------------------------------------------------------------------- */

export function PaperTrailPanel({ projectId, sourceTags, act }: { projectId: string; sourceTags: string[]; act: (label: string, fn: () => Promise<unknown>) => Promise<void> }) {
  const [pt, setPt] = useState<{ quotes: { quoteId: string }[]; pairs: PaperTrailPair[] } | null>(null);
  const key = sourceTags.join(',');
  useEffect(() => { scriptApi.paperTrail(projectId).then(setPt).catch(() => setPt({ quotes: [], pairs: [] })); }, [projectId, key]);
  if (!pt) return null;
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">The Paper Trail</div>
      <div className="text-[11px] text-slate-500">{pt.quotes.length} curated quote{pt.quotes.length === 1 ? '' : 's'} in these recordings. Claims that quote one are linked to it.</div>
      {pt.pairs.map(p => (
        <div key={p.pairId} className="text-[11px] border border-slate-800 rounded p-1.5 space-y-0.5">
          <div className="text-slate-200">{p.title}</div>
          {([['Before', p.pre, p.preQuote], ['After', p.post, p.postQuote]] as const).map(([label, side, quote]) => (
            <div key={label} className="text-slate-400"><span className="text-slate-500">{label}, {side.date}:</span> {quote ? `${quote.speaker}: "${quote.text.slice(0, 160)}${quote.text.length > 160 ? '…' : ''}"` : side.quoteId}</div>
          ))}
          {p.missingTags.map(t => p.missingTranscripts.includes(t)
            ? <div key={t} className="text-amber-300">{t} has no transcript on disk.</div>
            : <button key={t} className={btnGhost} onClick={() => void act('Adding recording', () => scriptApi.updateProject(projectId, { addSourceTags: [t] }))}><Plus size={11} /> Add {t}</button>)}
        </div>
      ))}
    </div>
  );
}


export function EvidencePanel({ project, onReload, act }: { project: ScriptProject; onReload: () => void; act: (label: string, fn: () => Promise<unknown>) => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [docName, setDocName] = useState('');
  const [docContent, setDocContent] = useState('');
  const [docType, setDocType] = useState<'text' | 'markdown' | 'notes'>('text');
  const fileRef = useRef<HTMLInputElement>(null);
  const [driveOpen, setDriveOpen] = useState(false);
  const [driveFolderUrl, setDriveFolderUrl] = useState(project.googleDriveFolderUrl || '');
  const [driveApiKey, setDriveApiKey] = useState(() => {
    try { return localStorage.getItem('spacepipe_gdrive_api_key') || ''; } catch { return ''; }
  });
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveStatus, setDriveStatus] = useState<{ ok: boolean; message: string; needsKey?: boolean } | null>(null);

  const docs = project.evidenceDocs || [];

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const documents: { name: string; content: string; type: string }[] = [];
    for (const f of files) {
      const text = await f.text();
      documents.push({
        name: f.name,
        content: text,
        type: f.name.endsWith('.md') ? 'markdown' : 'text',
      });
    }
    await act('Adding evidence files', async () => {
      await scriptApi.addEvidence(project.id, documents);
      onReload();
    });
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleManualAdd = async () => {
    if (!docContent.trim()) return;
    await act('Adding evidence text', async () => {
      await scriptApi.addEvidence(project.id, [{
        name: docName.trim() || 'Research Notes',
        content: docContent.trim(),
        type: docType,
      }]);
      setDocName('');
      setDocContent('');
      setAdding(false);
      onReload();
    });
  };

  const handleRemove = async (docId: string) => {
    await act('Removing evidence', async () => {
      await scriptApi.removeEvidence(project.id, docId);
      onReload();
    });
  };

  const handleSyncDrive = async (overrideKey?: string) => {
    if (!driveFolderUrl.trim()) return;
    setDriveLoading(true);
    setDriveStatus(null);
    const keyToUse = overrideKey !== undefined ? overrideKey : driveApiKey;
    try {
      if (keyToUse.trim()) {
        try { localStorage.setItem('spacepipe_gdrive_api_key', keyToUse.trim()); } catch { /* ignore */ }
      }
      const res = await scriptApi.fetchGoogleDrive({
        url: driveFolderUrl.trim(),
        apiKey: keyToUse.trim() || undefined,
      });

      if (!res.ok) {
        setDriveStatus({
          ok: false,
          message: res.message || 'Could not fetch Google Drive folder.',
          needsKey: res.code === 'AUTH_REQUIRED' || res.code === 'DRIVE_API_403' || res.code === 'DRIVE_API_401',
        });
        return;
      }

      if (!res.files || !res.files.length) {
        setDriveStatus({
          ok: true,
          message: res.message || 'No text or markdown documents found in folder.',
        });
        return;
      }

      const imported = res.files.map(f => ({
        name: f.name,
        content: f.content,
        type: f.type || 'text',
        sourceUrl: f.sourceUrl,
        source: 'google_drive',
      }));

      await act('Importing Google Drive evidence', async () => {
        await scriptApi.addEvidence(project.id, imported, driveFolderUrl.trim());
        onReload();
      });

      setDriveStatus({
        ok: true,
        message: `Imported ${res.files.length} document(s) from Google Drive folder.`,
      });
    } catch (err: any) {
      setDriveStatus({
        ok: false,
        message: err?.message || 'Error communicating with Google Drive service.',
      });
    } finally {
      setDriveLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wide text-slate-500 flex items-center gap-1.5 font-semibold">
          <BookOpen size={12} className="text-indigo-400" /> Evidence & Context ({docs.length})
        </div>
        <div className="flex items-center gap-1">
          <button className={btnGhost} onClick={() => fileRef.current?.click()} title="Upload evidence files (.txt, .md, .json, .csv)">
            <Upload size={11} /> File
          </button>
          <button className={btnGhost} onClick={() => setAdding(a => !a)} title="Type or paste evidence">
            <Plus size={11} /> Paste
          </button>
          <button
            className={cx(btnGhost, (driveOpen || project.googleDriveFolderUrl) && 'text-indigo-300 border-indigo-500/50 bg-indigo-950/40')}
            onClick={() => setDriveOpen(d => !d)}
            title="Connect or sync Google Drive folder"
          >
            <FolderSync size={11} /> Drive
          </button>
          <input ref={fileRef} type="file" multiple accept=".txt,.md,.json,.csv,.text" className="hidden" onChange={handleFileUpload} />
        </div>
      </div>
      <div className="text-[11px] text-slate-500">
        AI models gather factual context and quotes from these reference documents during outline, draft, and refinement.
      </div>

      {(driveOpen || (project.googleDriveFolderUrl && !driveStatus && !adding)) && (
        <div className="rounded border border-indigo-800/60 bg-indigo-950/30 p-2.5 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-indigo-300 text-[11px] flex items-center gap-1.5">
              <FolderSync size={12} className="text-indigo-400" /> Google Drive Evidence Folder
            </span>
            {(project.googleDriveFolderUrl || driveFolderUrl) && (
              <a
                href={(project.googleDriveFolderUrl || driveFolderUrl).startsWith('http') ? (project.googleDriveFolderUrl || driveFolderUrl) : `https://drive.google.com/drive/folders/${project.googleDriveFolderUrl || driveFolderUrl}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-indigo-400 hover:text-indigo-200 flex items-center gap-1"
              >
                Open in Drive <ExternalLink size={9} />
              </a>
            )}
          </div>
          <div className="text-[10px] text-slate-400">
            Provide a Google Drive folder link. The AI reads all files in the folder for research context.
          </div>
          <div className="flex items-center gap-1.5">
            <input
              className={cx(input, 'flex-1 text-[11px]')}
              placeholder="https://drive.google.com/drive/folders/your-folder-id"
              value={driveFolderUrl}
              onChange={e => {
                setDriveFolderUrl(e.target.value);
                setDriveStatus(null);
              }}
            />
            <button
              className={btnPrimary}
              disabled={!driveFolderUrl.trim() || driveLoading}
              onClick={() => handleSyncDrive()}
              title="Sync documents from Google Drive into project evidence"
            >
              {driveLoading ? <Loader2 size={11} className="animate-spin" /> : <CloudDownload size={11} />}
              Sync
            </button>
          </div>
          {driveStatus && (
            <div className={cx('text-[11px] p-2 rounded border', driveStatus.ok ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300' : 'bg-amber-950/40 border-amber-800 text-amber-300')}>
              <div>{driveStatus.message}</div>
              {driveStatus.needsKey && (
                <div className="pt-1.5 border-t border-amber-800/40 mt-1 space-y-1">
                  <div className="text-[10px] text-amber-200">Google Drive API Key or OAuth Token:</div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="password"
                      className={cx(input, 'flex-1 text-[10px] h-6')}
                      placeholder="AIzaSy... or OAuth Bearer Token"
                      value={driveApiKey}
                      onChange={e => setDriveApiKey(e.target.value)}
                    />
                    <button className={btnGhost} disabled={!driveApiKey.trim() || driveLoading} onClick={() => handleSyncDrive(driveApiKey)}>
                      Retry
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {adding && (
        <div className="rounded border border-slate-700 bg-slate-900/80 p-2 space-y-2 text-xs">
          <input className={cx(input, 'w-full')} placeholder="Document title (e.g., Leaked Memo, Interview Notes)" value={docName} onChange={e => setDocName(e.target.value)} />
          <textarea className={cx(input, 'w-full h-24 font-mono text-[11px] resize-y')} placeholder="Paste reference text or evidence here..." value={docContent} onChange={e => setDocContent(e.target.value)} />
          <div className="flex justify-end gap-1.5">
            <button className={btnGhost} onClick={() => { setAdding(false); setDocContent(''); }}>Cancel</button>
            <button className={btnPrimary} disabled={!docContent.trim()} onClick={handleManualAdd}>Add Document</button>
          </div>
        </div>
      )}

      {docs.length === 0 ? (
        <div className="text-[11px] text-slate-500 italic">No reference documents attached yet.</div>
      ) : (
        <div className="space-y-1.5">
          {docs.map((doc: ScriptEvidenceDoc) => (
            <div key={doc.id} className="rounded border border-slate-800 bg-slate-950/40 p-1.5 text-[11px] space-y-1">
              <div className="flex items-center gap-1">
                <FileText size={12} className="text-slate-400 shrink-0" />
                <span className="font-medium text-slate-200 truncate flex-1" title={doc.name}>{doc.name}</span>
                {((doc as any).source === 'google_drive' || (doc as any).sourceUrl?.includes('drive.google.com')) && (
                  <span className="text-[9px] px-1 py-0.2 rounded bg-indigo-950 text-indigo-300 border border-indigo-800/60 shrink-0">
                    Drive
                  </span>
                )}
                <span className="text-[10px] text-slate-500">{doc.sizeBytes ? `${Math.round(doc.sizeBytes / 1024)} KB` : ''}</span>
                <button className="text-slate-500 hover:text-rose-400 p-0.5" title="Remove evidence document" onClick={() => handleRemove(doc.id)}>
                  <Trash2 size={11} />
                </button>
              </div>
              <p className="text-[10px] text-slate-400 line-clamp-2 font-mono whitespace-pre-wrap">{doc.content.slice(0, 160)}...</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
