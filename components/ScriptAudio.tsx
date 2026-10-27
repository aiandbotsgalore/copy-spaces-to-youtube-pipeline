/**
 * Script Studio audio panel (Phase 4): Vox narration previews in Logan's voice, the spoken-audio
 * critique, Send to Montage, and the finished episode rendered, saved and played in the app.
 * Music cues stay labeled markers: they are listed with their positions and never mixed in.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, Download, Film, Loader2, Mic, Pause, Play, Square } from 'lucide-react';
import { useMontage } from '../contexts/MontageContext';
import { usePlayer } from '../contexts/PlayerContext';
import { getCachedAudioUrl } from '../utils/audioCache';
import { toFetchableUrl } from '../utils/audioUrl';
import { countTakes } from '../utils/scriptAudio';
import { scriptApi, type PreviewJob, type RenderSummary, type RoleChoice } from '../utils/scriptClient';
import { buildManifest, compileScript, type CompileResult } from '../utils/scriptCompile';
import { RenderError, renderCompiled } from '../utils/scriptRender';
import { getSharedAudioContext } from '../utils/sequencePlayer';
import type { ScriptProject, ScriptVersion } from '../utils/scriptTypes';

const btn = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const btnGhost = `${btn} bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800`;
const btnPrimary = `${btn} bg-indigo-600 border-indigo-500 text-white hover:bg-indigo-500`;
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.round(Math.max(0, s) % 60)).padStart(2, '0')}`;

/** The latest preview job of a project, polled while it runs. */
export function usePreviewJob(projectId: string | null, onDone: () => void) {
  const [job, setJob] = useState<PreviewJob | null>(null);
  const [error, setError] = useState<unknown>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const poll = useCallback(async (pid: string) => {
    if (timer.current) clearTimeout(timer.current);
    try {
      const r = await scriptApi.previewStatus(pid);
      setJob(r.job);
      if (r.job?.state === 'running') timer.current = setTimeout(() => void poll(pid), 1500);
      else if (r.job) doneRef.current();
    } catch (e) { setError(e); }
  }, []);

  useEffect(() => {
    setJob(null);
    if (projectId) void scriptApi.previewStatus(projectId).then(r => { setJob(r.job); if (r.job?.state === 'running') void poll(projectId); }).catch(setError);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [projectId, poll]);

  const start = useCallback(async (sceneId?: string) => {
    if (!projectId) return;
    setError(null);
    try {
      const r = await scriptApi.preview(projectId, sceneId);
      setJob(r.job);
      void poll(projectId);
    } catch (e) { setError(e); }
  }, [projectId, poll]);
  const cancel = useCallback(async () => {
    if (!projectId) return;
    try { await scriptApi.cancelPreview(projectId); } catch (e) { setError(e); }
  }, [projectId]);
  return { job, running: job?.state === 'running', start, cancel, error, clearError: () => setError(null) };
}

export function AudioPanel({ project, head, dirty, roles, runActive, preview, onRunStarted, onOpenMontage, onError }: {
  project: ScriptProject; head: ScriptVersion | null; dirty: boolean; roles: RoleChoice; runActive: boolean;
  preview: ReturnType<typeof usePreviewJob>;
  onRunStarted: (runId: string) => void; onOpenMontage?: () => void; onError: (e: unknown) => void;
}) {
  const montage = useMontage();
  const player = usePlayer();
  const [compiled, setCompiled] = useState<CompileResult | null>(null);
  const [renders, setRenders] = useState<RenderSummary[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadRenders = useCallback(() => { void scriptApi.renders(project.id).then(r => setRenders(r.renders)).catch(onError); }, [project.id, onError]);
  useEffect(() => { loadRenders(); setCompiled(null); setNotice(null); }, [loadRenders, head?.id]);

  const takes = head ? countTakes(head.segments) : { withTake: 0, narration: 0 };
  const job = preview.job;
  const compile = () => {
    if (!head) return null;
    const c = compileScript(project, head, { clipAudioUrl: clipId => scriptApi.clipAudioUrl(project.id, clipId) });
    setCompiled(c);
    return c;
  };

  const sendToMontage = () => {
    const c = compile();
    if (!c || !c.ok) return;
    if (montage.clips.length && !window.confirm(`Replace the ${montage.clips.length} clips on the Montage timeline with this script (${c.items.length} items)? Undo in Montage brings them back.`)) return;
    montage.replaceClips(c.items.map(i => i.item));
    setNotice(`Sent ${c.items.length} items to Montage Studio${c.markers.length ? `; ${c.markers.length} music markers are listed below for you to place outside the app` : ''}.`);
    onOpenMontage?.();
  };

  const finish = async () => {
    const c = compile();
    if (!c || !c.ok || !head) return;
    setNotice(null);
    try {
      const audioCtx = getSharedAudioContext();
      if (audioCtx.state === 'suspended') { try { await audioCtx.resume(); } catch { /* decoding works while suspended */ } }
      const out = await renderCompiled(c.items, {
        audioCtx,
        fetchAudio: async url => {
          const src = (await getCachedAudioUrl(url)) || url;
          const res = await fetch(toFetchableUrl(src));
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.arrayBuffer();
        },
        onProgress: setProgress,
      });
      setProgress('Saving the render in the project');
      const manifest = buildManifest(project, head, c, Date.now(), out.renderedSec, out.measured);
      await scriptApi.saveRenderManifest(project.id, head.id, manifest);
      const saved = await scriptApi.uploadRender(project.id, head.id, out.wav);
      setNotice(`Finished episode saved: ${mmss(saved.audio?.durationSec || out.totalSec)}, ${(saved.audio!.bytes / 1e6).toFixed(1)} MB, measured ${out.measured.integratedLufs} LUFS, peak ${out.measured.samplePeakDb} dBFS.`);
      loadRenders();
    } catch (e) {
      onError(e instanceof RenderError ? new Error(`Render stopped at block ${e.blockId}: ${e.message}`) : e);
    } finally {
      setProgress(null);
    }
  };

  const playRender = (r: RenderSummary) => {
    const id = `render:${project.id}:${r.versionId}:${r.audio?.savedAt || r.createdAt}`;
    if (player.current?.id === id) { player.togglePlay(); return; }
    player.play({ id, title: `${project.title} (finished episode)`, audioUrl: scriptApi.renderAudioUrl(project.id, r.versionId), durationLabel: mmss(r.audio?.durationSec || r.totalSec) });
  };

  const noHead = !head;
  return (
    <div className="space-y-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-500 flex items-center gap-1"><AudioLines size={11} /> Audio</div>
      <div className="text-slate-400">
        {takes.narration ? `${takes.withTake} of ${takes.narration} narration lines have a Vox take in your voice.` : 'No narration yet.'}
      </div>
      <div className="flex flex-wrap gap-1">
        {preview.running ? (
          <button className={btnGhost} onClick={() => void preview.cancel()}><Square size={12} /> Stop preview</button>
        ) : (
          <button className={btnGhost} disabled={noHead || dirty || !takes.narration} title={dirty ? 'Save your edits first' : 'Speak every narration line with Vox (cached lines are reused)'}
            onClick={() => void preview.start()}><Mic size={12} /> Preview audio</button>
        )}
        <button className={btnGhost} disabled={noHead || dirty || runActive || takes.withTake === 0} title={takes.withTake === 0 ? 'Preview the audio first' : 'Critique rhythm, breath points, transitions and handoffs using the real take lengths'}
          onClick={() => void scriptApi.refine(project.id, roles, { spoken: true }).then(r => onRunStarted(r.runId)).catch(onError)}>Critique the sound</button>
      </div>
      {job && (
        <div className={job.state === 'failed' ? 'text-amber-300' : 'text-slate-400'}>
          {job.state === 'running' && <Loader2 size={11} className="inline animate-spin mr-1" />}
          Preview{job.sceneId ? ' (one scene)' : ''}: {job.done} of {job.total} lines ready ({job.cached} cached, {job.synthesized} new){job.state === 'running' && job.current ? `, speaking block ${job.current}` : ''}{job.state === 'cancelled' ? ', stopped' : ''}.
          {job.unavailable && <div>{job.unavailable} Lines without a take keep an estimated length.</div>}
        </div>
      )}
      {preview.error ? <div className="text-rose-300">{String((preview.error as any)?.message || preview.error)}</div> : null}

      <div className="flex flex-wrap gap-1 pt-1">
        <button className={btnGhost} disabled={noHead || dirty || !!progress} onClick={sendToMontage} title="Clips, Vox takes and pauses as a Montage timeline"><Film size={12} /> Send to Montage</button>
        <button className={btnPrimary} disabled={noHead || dirty || !!progress} onClick={() => void finish()} title="Render one WAV: 18 ms fades, brought to -16 LUFS integrated (BS.1770, measured) with no sample above -1 dBFS, saved in this project"><Play size={12} /> Finish episode</button>
      </div>
      {progress && <div className="text-indigo-300"><Loader2 size={11} className="inline animate-spin mr-1" />{progress}…</div>}
      {notice && <div className="text-emerald-300">{notice}</div>}
      {compiled && compiled.blocked.length > 0 && (
        <div className="rounded-md border border-amber-700/50 bg-amber-950/20 p-2 space-y-0.5 text-amber-200">
          <div className="font-semibold">Not ready: {compiled.blocked.length} block{compiled.blocked.length === 1 ? '' : 's'} without audio</div>
          {compiled.blocked.map(b => <div key={b.blockId}>• {b.sceneTitle}, block {b.blockId}: {b.reason}</div>)}
        </div>
      )}
      {compiled && compiled.markers.length > 0 && (
        <div className="rounded-md border border-fuchsia-900/50 bg-fuchsia-950/10 p-2 space-y-0.5 text-fuchsia-200">
          <div className="font-semibold">Music markers (positions only; add music outside the app)</div>
          {compiled.markers.map(m => <div key={m.blockId}>• before item {m.beforeItem + 1} ({m.sceneTitle}): {m.cue.replace('_', ' ')}{m.note ? `, ${m.note}` : ''}</div>)}
        </div>
      )}
      {compiled && compiled.leadingPauseSec > 0 && <div className="text-slate-500">A {compiled.leadingPauseSec.toFixed(1)} s pause before the first item is not applied (a timeline starts with its first item).</div>}

      {renders.length > 0 && (
        <div className="space-y-1 pt-1">
          <div className="text-[11px] text-slate-500">Finished episodes</div>
          {renders.map(r => {
            const id = `render:${project.id}:${r.versionId}:${r.audio?.savedAt || r.createdAt}`;
            const playing = player.current?.id === id && player.isPlaying;
            return (
              <div key={r.versionId} className="flex items-center gap-1.5 rounded border border-slate-800 px-1.5 py-1">
                {r.status === 'complete' ? (
                  <button className="text-emerald-300 hover:text-white" onClick={() => playRender(r)} title="Play in the app">{playing ? <Pause size={12} /> : <Play size={12} />}</button>
                ) : <span className="text-amber-300">incomplete</span>}
                <span className="flex-1 truncate text-slate-300" title={r.versionId}>{new Date(r.createdAt).toLocaleString()}{r.versionId === head?.id ? ' (current version)' : ''}</span>
                <span className="text-slate-500" title="Measured integrated loudness">{r.measured ? `${r.measured.integratedLufs} LUFS · ` : ''}{mmss(r.audio?.durationSec || r.totalSec)}</span>
                {r.status === 'complete' && <a className="text-slate-400 hover:text-white" href={scriptApi.renderAudioUrl(project.id, r.versionId)} download={`${project.id}-${r.versionId}.wav`} title="Download WAV"><Download size={12} /></a>}
                <a className="text-slate-400 hover:text-white text-[10px]" href={scriptApi.renderManifestUrl(project.id, r.versionId)} download title="Manifest: every block and source clip">JSON</a>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
