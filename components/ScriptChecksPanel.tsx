import React from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Loader2, Search, XCircle } from 'lucide-react';
import type { GateResult } from '../utils/scriptTypes';

export type EvidenceFinding = {
  index: number;
  status: 'supported' | 'overstated' | 'misattributed' | 'unsupported' | 'uncertain';
  rationale: string;
};

export type EvidencePairingView = {
  narrationBlockId: string;
  narrationText: string;
  sceneId: string;
  segmentId: string;
  pairingStatus: 'paired' | 'unpaired' | 'needs_review';
  pairingNote?: string;
  claims?: { quoteId?: string; releaseTag?: string; speakerRaw?: string; speakerName?: string; speakerConfirmed: boolean; verbatim?: string; provenanceStatus: string; statusNote?: string }[];
  tapeBlock?: { blockId: string; clipId: string; quoteId?: string; releaseTag?: string; speakerRaw: string; speakerName?: string; speakerConfirmed: boolean; exactTapeText: string; utteranceIds: string[]; provenanceStatus: string; warnings: string[] };
};

export interface EvidenceCheckResult {
  versionId: string;
  findings: EvidenceFinding[];
  pairings: EvidencePairingView[];
  warnings: string[];
  spentUsd?: number;
  provider?: string;
  model?: string;
  error?: { code: string; message: string };
}

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');
const pill = 'rounded px-1.5 py-0.5 text-[10px] font-medium border';

export default function ScriptChecksPanel({
  gates,
  review,
  loading,
  error,
  dirty,
  onReview,
  onJump,
}: {
  gates?: (GateResult & { ok?: boolean }) | null;
  review: EvidenceCheckResult | null;
  loading: boolean;
  error?: string | null;
  dirty?: boolean;
  onReview: () => void;
  onJump: (sceneId: string) => void;
}) {
  const failures = gates?.failures || [];
  const warnings = [...(gates?.warnings || []), ...(review?.warnings || [])];
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 space-y-3" aria-labelledby="script-checks-heading">
      <div className="flex flex-wrap items-center gap-2">
        <div className="font-semibold text-sm text-slate-100" id="script-checks-heading">Script checks</div>
        <span className="text-[10px] text-slate-500">Deterministic gates run on save; semantic review is manual.</span>
        <button type="button" className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-indigo-500/60 bg-indigo-600/90 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40" onClick={onReview} disabled={loading || !!dirty} title={dirty ? 'Save the version before reviewing evidence.' : 'Run the explicit evidence review'}>
          {loading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />} Review Evidence
        </button>
      </div>
      {dirty && <div className="text-[11px] text-amber-300">Save your edits before review; this action checks the saved head version.</div>}
      {error && <div className="rounded border border-rose-700/50 bg-rose-950/30 p-2 text-[11px] text-rose-200">Review error: {error}</div>}
      {review?.error && <div className="rounded border border-amber-700/50 bg-amber-950/30 p-2 text-[11px] text-amber-200">Semantic review unavailable ({review.error.code}): {review.error.message}</div>}

      <div className="grid gap-2 md:grid-cols-2">
        <div className="rounded border border-slate-800 bg-slate-950/60 p-2 space-y-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Deterministic blockers</div>
          {failures.length ? failures.map((f, i) => <div key={i} className="flex gap-1.5 text-[11px] text-rose-200"><XCircle size={13} className="mt-0.5 shrink-0 text-rose-400" />{f}</div>) : <div className="flex gap-1.5 text-[11px] text-emerald-300"><CheckCircle2 size={13} />None</div>}
        </div>
        <div className="rounded border border-slate-800 bg-slate-950/60 p-2 space-y-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Warnings and advisories</div>
          {warnings.length ? warnings.map((w, i) => <div key={i} className="flex gap-1.5 text-[11px] text-amber-200"><AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-400" />{w}</div>) : <div className="text-[11px] text-slate-500">None</div>}
        </div>
      </div>

      {review && <div className="space-y-2">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">
          Evidence pairing <span className="font-normal normal-case text-slate-600">{review.provider ? `· ${review.provider}${review.model ? ` / ${review.model}` : ''}` : '· deterministic only'}</span>
          {typeof review.spentUsd === 'number' && <span className="font-normal normal-case text-slate-600">· ${review.spentUsd.toFixed(4)}</span>}
        </div>
        {review.pairings.map((pair, index) => {
          const finding = review.findings.find(f => f.index === index);
          const tape = pair.tapeBlock;
          return <div key={pair.narrationBlockId} className="rounded border border-slate-800 bg-slate-950/40 p-2.5 space-y-2">
            <div className="flex items-start gap-2">
              <button type="button" onClick={() => onJump(pair.sceneId)} className="mt-0.5 text-indigo-300 hover:text-indigo-200" title="Jump to script scene"><ChevronRight size={14} /></button>
              <div className="min-w-0 flex-1"><div className="text-[11px] text-slate-200 line-clamp-2">{pair.narrationText}</div><div className="mt-1 flex flex-wrap gap-1.5"><span className={cx(pill, pair.pairingStatus === 'paired' ? 'border-emerald-700/60 text-emerald-300' : pair.pairingStatus === 'needs_review' ? 'border-amber-700/60 text-amber-300' : 'border-slate-700 text-slate-400')}>{pair.pairingStatus.replace('_', ' ')}</span>{tape && <span className={cx(pill, 'border-slate-700 text-slate-400')}>clip {tape.clipId}</span>}{tape?.quoteId && <span className={cx(pill, 'border-slate-700 text-slate-400')}>source {tape.quoteId}</span>}</div></div>
            </div>
            {tape && <div className="pl-5 text-[11px] text-slate-400 space-y-1"><div><span className="text-slate-500">Speaker:</span> {tape.speakerName || tape.speakerRaw} <span className={cx(pill, 'ml-1', tape.speakerConfirmed ? 'border-emerald-700/60 text-emerald-300' : 'border-amber-700/60 text-amber-300')}>{tape.speakerConfirmed ? 'explicitly confirmed' : 'unconfirmed label'}</span></div><div className="text-slate-500">{tape.releaseTag || 'source unresolved'} · {tape.utteranceIds.join(', ') || 'no utterance IDs'} · provenance: {tape.provenanceStatus}</div><div className="italic text-slate-500">“{tape.exactTapeText}”</div></div>}
            {pair.claims?.map((claim, i) => <div key={i} className="pl-5 text-[11px] text-slate-400"><span className="text-slate-500">Claim {claim.quoteId || 'without source'}:</span> {claim.speakerName || claim.speakerRaw || 'speaker unresolved'} · {claim.provenanceStatus}{claim.statusNote ? ` — ${claim.statusNote}` : ''}</div>)}
            {pair.pairingNote && <div className="pl-5 text-[11px] text-amber-300">{pair.pairingNote}</div>}
            {finding && <div className="pl-5 text-[11px] text-indigo-200"><span className={cx(pill, 'mr-1.5 border-indigo-700/60 text-indigo-300')}>{finding.status}</span>{finding.rationale}</div>}
          </div>;
        })}
        {review.findings.filter(f => !Number.isInteger(f.index) || f.index < 0 || f.index >= review.pairings.length).map((finding, index) => (
          <div key={`unmapped-${index}`} className="rounded border border-amber-800/50 bg-amber-950/20 p-2 text-[11px] text-amber-200">
            <span className={cx(pill, 'mr-1.5 border-amber-700/60')}>{finding.status}</span>{finding.rationale}
          </div>
        ))}
        {!review.pairings.length && <div className="text-[11px] text-slate-500">No narration evidence pairings were found.</div>}
      </div>}
    </section>
  );
}
