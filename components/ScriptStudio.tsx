/**
 * Script Studio: write and refine a documentary script from one or several of Logan's recordings, on his machine.
 * Talks only to /api/script (server/scriptStudioMiddleware.ts). Every status shown comes from the
 * server: provider health checks, run events, gate results and judge reasons. Nothing is published.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowDown, BookOpen, BookmarkPlus, ArrowUp, CloudDownload, ExternalLink, Film, FolderSync, Link2, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleSlash, Disc, Download, FileText, History, Layers, Loader2, Lock, Mic,
  Pause, Play, Plus, RefreshCw, RotateCcw, Save, Scissors, Search, Sparkles, Square, Star, Trash2, Unlock, Upload, Volume2, Wand2, X, XCircle,
} from 'lucide-react';
import { usePlayer } from '../contexts/PlayerContext';
import { useMontage } from '../contexts/MontageContext';
import {
  loadRoleChoice, PROJECT_STORAGE_KEY, ROLE_SPECS, saveRoleChoice, scriptApi, ScriptApiError, streamRun,
  type ProjectResponse, type RoleChoice, type RunResponse, type StatusResponse,
} from '../utils/scriptClient';
import { blockSeconds, estimateRuntime } from '../utils/scriptGates';
import { compileScript, buildManifest } from '../utils/scriptCompile';
import { renderCompiled, RenderError } from '../utils/scriptRender';
import { getSharedAudioContext } from '../utils/sequencePlayer';
import { getCachedAudioUrl } from '../utils/audioCache';
import { toFetchableUrl } from '../utils/audioUrl';
import ScriptQuality, { LogTable } from './ScriptQuality';
import { AudioPanel, usePreviewJob } from './ScriptAudio';
import { EvidencePanel, PaperTrailPanel, RecordingsPanel, StylePanel } from './ScriptStyle';
import { HandoffPanel } from './ScriptHandoff';
import { namesForTag, renameKey } from '../utils/scriptNames';
import { countTakes, hasValidTake } from '../utils/scriptAudio';
import { setUnsavedGuard } from '../utils/unsavedGuard';
import QuoteLibrary, { useLibrary } from './QuoteLibrary';
import ScriptBoard from './ScriptBoard';
import type { ListenOption, ViewEntry } from '../utils/quoteView';
import {
  extractClipsFromText, parseTimeToSeconds, clipsFromBlock, clipDedupeKey, CANONICAL_CLIP_REGEX, INLINE_QUOTE_REGEX, type ParsedManuscriptClip,
} from '../utils/scriptUpload';
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
/* Upload Script & Evidence Modals                                                                */
/* ---------------------------------------------------------------------------------------------- */

function UploadScriptModal({
  isOpen,
  onClose,
  onOpenProject,
  initialTags = [],
  episodes = [],
}: {
  isOpen: boolean;
  onClose: () => void;
  onOpenProject: (id: string) => void;
  initialTags?: string[];
  episodes?: { releaseTag: string; title: string }[];
}) {
  const [title, setTitle] = useState('');
  const [format, setFormat] = useState<EpisodeFormat | ''>('narrative_doc');
  const [minutes, setMinutes] = useState(15);
  const [selectedTags, setSelectedTags] = useState<string[]>(initialTags);
  const [scriptText, setScriptText] = useState('');
  const [scriptFilename, setScriptFilename] = useState('');
  const [evidenceFiles, setEvidenceFiles] = useState<{ name: string; content: string; type: string }[]>([]);
  const [customEvidenceText, setCustomEvidenceText] = useState('');
  const [customEvidenceName, setCustomEvidenceName] = useState('');
  const [driveOpen, setDriveOpen] = useState(false);
  const [driveFolderUrl, setDriveFolderUrl] = useState('');
  const [driveApiKey, setDriveApiKey] = useState(() => {
    try { return localStorage.getItem('spacepipe_gdrive_api_key') || ''; } catch { return ''; }
  });
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveStatus, setDriveStatus] = useState<{ ok: boolean; message: string; needsKey?: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scriptFileRef = useRef<HTMLInputElement>(null);
  const evidenceFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialTags.length) setSelectedTags(initialTags);
  }, [initialTags]);

  if (!isOpen) return null;

  const handleScriptFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setScriptText(text);
      setScriptFilename(file.name);
      if (!title) {
        setTitle(file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' '));
      }
    } catch (err: any) {
      setError(err?.message || 'Could not read script file.');
    }
  };

  const handleEvidenceFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    try {
      const docs = await Promise.all(
        files.map(async f => ({
          name: f.name,
          content: await f.text(),
          type: f.name.endsWith('.md') ? 'markdown' : 'text',
        }))
      );
      setEvidenceFiles(prev => [...prev, ...docs]);
    } catch (err: any) {
      setError(err?.message || 'Could not read evidence file.');
    }
    if (evidenceFileRef.current) evidenceFileRef.current.value = '';
  };

  const addCustomEvidence = () => {
    if (!customEvidenceText.trim()) return;
    setEvidenceFiles(prev => [
      ...prev,
      {
        name: customEvidenceName.trim() || `Notes ${prev.length + 1}`,
        content: customEvidenceText.trim(),
        type: 'text',
      },
    ]);
    setCustomEvidenceText('');
    setCustomEvidenceName('');
  };

  const removeEvidence = (index: number) => {
    setEvidenceFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleFetchGoogleDrive = async (overrideKey?: string) => {
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
          message: res.message || 'Folder linked, but no text or markdown documents were found inside.',
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

      setEvidenceFiles(prev => {
        const existingUrls = new Set(prev.map(p => (p as any).sourceUrl).filter(Boolean));
        const filtered = imported.filter(i => !existingUrls.has(i.sourceUrl));
        return [...prev, ...(filtered.length ? filtered : imported)];
      });

      setDriveStatus({
        ok: true,
        message: `Imported ${res.files.length} document(s) from Google Drive folder for AI context.`,
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scriptText.trim()) {
      setError('Please provide script text or select a script file.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await scriptApi.uploadScript({
        title: title.trim() || scriptFilename || 'Uploaded Script',
        format: format || null,
        targetRuntimeSec: minutes * 60,
        releaseTags: selectedTags.length ? selectedTags : undefined,
        scriptText,
        filename: scriptFilename || undefined,
        evidenceDocs: evidenceFiles.length ? evidenceFiles : undefined,
        googleDriveFolderUrl: driveFolderUrl.trim() || undefined,
      });
      onOpenProject(res.project.id);
      onClose();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-950/60">
          <div className="flex items-center gap-2 text-white font-semibold text-base">
            <Upload size={18} className="text-indigo-400" /> Upload Script & Evidence
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={16} /></button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4 text-xs text-slate-200">
          {error && (
            <div className="rounded-md border border-rose-700/60 bg-rose-950/40 p-2.5 text-xs text-rose-200">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Script Title</label>
              <input
                className={cx(input, 'w-full')}
                placeholder="e.g. The Insider Dossier"
                value={title}
                onChange={e => setTitle(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Episode Format</label>
              <select
                className={cx(input, 'w-full')}
                value={format}
                onChange={e => setFormat(e.target.value as EpisodeFormat)}
              >
                {EPISODE_FORMATS.map(f => (
                  <option key={f} value={f}>{FORMAT_LABELS[f]}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-medium text-slate-300">
                Script Content (Markdown, Plain Text, or JSON)
              </label>
              <div className="flex items-center gap-2">
                <input
                  ref={scriptFileRef}
                  type="file"
                  accept=".txt,.md,.markdown,.json,.text"
                  className="hidden"
                  onChange={handleScriptFile}
                />
                <button
                  type="button"
                  className={btnGhost}
                  onClick={() => scriptFileRef.current?.click()}
                >
                  <Upload size={11} /> Choose Script File
                </button>
                {scriptFilename && (
                  <span className="text-[11px] text-indigo-300 font-mono">{scriptFilename}</span>
                )}
              </div>
            </div>
            <textarea
              className={cx(input, 'w-full h-40 font-mono text-[11px] resize-y leading-relaxed')}
              placeholder="# Act 1: The Investigation&#10;## Scene 1: Introduction&#10;Logan: Here is what we found...&#10;[Pause: 1.5s]&#10;[Music: sting - dramatic tension]"
              value={scriptText}
              onChange={e => setScriptText(e.target.value)}
            />
            <div className="text-[10px] text-slate-500 mt-0.5">
              Markdown headings (# Act, ## Scene) automatically split into segments and scenes. Tags like [Pause: 2s] and [Music: sting] are preserved.
            </div>
          </div>

          <div className="border-t border-slate-800 pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-[11px] font-semibold text-slate-200 flex items-center gap-1.5">
                  <BookOpen size={13} className="text-indigo-400" /> Evidence & Context Documents for AI
                </label>
                <div className="text-[10px] text-slate-400">
                  Upload background documents (articles, memos, transcripts, notes) for the AI models to gather facts and context from.
                </div>
              </div>
              <input
                ref={evidenceFileRef}
                type="file"
                multiple
                accept=".txt,.md,.json,.csv,.text"
                className="hidden"
                onChange={handleEvidenceFiles}
              />
              <button
                type="button"
                className={btnGhost}
                onClick={() => evidenceFileRef.current?.click()}
              >
                <Upload size={11} /> Upload Evidence Files
              </button>
            </div>

            {evidenceFiles.length > 0 && (
              <div className="space-y-1 max-h-32 overflow-y-auto rounded border border-slate-800 p-1.5 bg-slate-950">
                {evidenceFiles.map((doc, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-[11px] text-slate-300 px-1 py-0.5">
                    <FileText size={11} className="text-slate-400 shrink-0" />
                    <span className="truncate flex-1 font-medium">{doc.name}</span>
                    <span className="text-[10px] text-slate-500">
                      {Math.round(doc.content.length / 1024) || 1} KB
                    </span>
                    <button
                      type="button"
                      className="text-slate-500 hover:text-rose-400"
                      onClick={() => removeEvidence(idx)}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <details className="text-[11px] text-slate-400">
              <summary className="cursor-pointer hover:text-slate-200">Or paste custom evidence / notes</summary>
              <div className="mt-2 space-y-1.5">
                <input
                  className={cx(input, 'w-full')}
                  placeholder="Evidence document title (e.g., Leaked Email 2024)"
                  value={customEvidenceName}
                  onChange={e => setCustomEvidenceName(e.target.value)}
                />
                <textarea
                  className={cx(input, 'w-full h-20 font-mono text-[11px] resize-y')}
                  placeholder="Paste context, quotes, or article contents..."
                  value={customEvidenceText}
                  onChange={e => setCustomEvidenceText(e.target.value)}
                />
                <button
                  type="button"
                  className={btnGhost}
                  disabled={!customEvidenceText.trim()}
                  onClick={addCustomEvidence}
                >
                  <Plus size={11} /> Add to Evidence List
                </button>
              </div>
            </details>
          </div>

          <div className="border-t border-slate-800 pt-3 flex items-center justify-between shrink-0">
            <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
            <button
              type="submit"
              className={btnPrimary}
              disabled={!scriptText.trim() || submitting}
            >
              {submitting ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Create Project from Script
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function UploadVersionModal({
  isOpen,
  onClose,
  projectId,
  onUploaded,
}: {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  onUploaded: () => void;
}) {
  const [scriptText, setScriptText] = useState('');
  const [label, setLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setScriptText(text);
      if (!label) setLabel(`Uploaded: ${file.name}`);
    } catch (err: any) {
      setError(err?.message || 'Could not read file.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scriptText.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await scriptApi.uploadScript({
        projectId,
        scriptText,
        label: label.trim() || 'Uploaded script edit',
      });
      onUploaded();
      onClose();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-xl flex flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-950/60">
          <div className="flex items-center gap-2 text-white font-semibold text-sm">
            <Upload size={16} className="text-indigo-400" /> Upload Script Version
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={15} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs text-slate-200">
          {error && <div className="rounded border border-rose-700/60 bg-rose-950/40 p-2 text-rose-200">{error}</div>}

          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Version Label</label>
            <input className={cx(input, 'w-full')} placeholder="e.g. Uploaded: revised_draft.md" value={label} onChange={e => setLabel(e.target.value)} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-medium text-slate-300">Script Content</label>
              <button type="button" className={btnGhost} onClick={() => fileRef.current?.click()}><Upload size={11} /> Choose File</button>
              <input ref={fileRef} type="file" accept=".txt,.md,.json" className="hidden" onChange={handleFile} />
            </div>
            <textarea className={cx(input, 'w-full h-48 font-mono text-[11px] resize-y')} placeholder="Paste updated script or markdown here..." value={scriptText} onChange={e => setScriptText(e.target.value)} />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
            <button type="submit" className={btnPrimary} disabled={!scriptText.trim() || submitting}>
              {submitting ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save as New Version
            </button>
          </div>
        </form>
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
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [onlySelected, setOnlySelected] = useState(false);
  const [visibleCount, setVisibleCount] = useState(60);
  const [loadingEpisodes, setLoadingEpisodes] = useState(true);
  const [limitNotice, setLimitNotice] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const statusTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    scriptApi.episodes().then(r => setEpisodes(r.episodes)).catch(setError).finally(() => setLoadingEpisodes(false));
    scriptApi.projects().then(r => setProjects(r.projects)).catch(setError);
  }, []);

  useEffect(() => { setVisibleCount(60); }, [filter, onlySelected]);

  useEffect(() => {
    if (!statusOpen) return;
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setStatusOpen(false);
        statusTriggerRef.current?.focus();
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [statusOpen]);

  const matches = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return episodes.filter(e =>
      (!onlySelected || picked.includes(e.releaseTag)) &&
      (!f || e.title.toLowerCase().includes(f) || e.releaseTag.toLowerCase().includes(f))
    );
  }, [episodes, filter, onlySelected, picked]);
  const shown = matches.slice(0, visibleCount);
  const format = newFormat || (picked.length > 1 ? 'thematic_multi' : 'narrative_doc');
  const subscriptionReady = !!(status?.providers['claude_cli:sonnet']?.ok && status?.providers['codex_cli']?.ok);
  const fallbackReady = !!(status?.providers['ci:claude-haiku-5.5']?.ok && status?.providers['ci:gpt-6-luna']?.ok);
  const ready = subscriptionReady || fallbackReady;
  const providerCount = status ? Object.values(status.providers).filter(h => h.ok).length : 0;
  const providerTotal = status ? Object.keys(status.providers).length : 0;
  const recentProjects = [...projects].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4);
  const panel = 'rounded-xl border border-[#313A4C] bg-[#12161F]';
  const field = 'w-full rounded-lg border border-[#394256] bg-[#0B0D11] px-3 py-2.5 text-sm text-[#F4F6FA] outline-none transition-colors placeholder:text-[#8994A8] focus:border-[#A496FF] focus:ring-2 focus:ring-[#7357E9]/25';
  const secondaryButton = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[#394256] bg-[#1A2030] px-3 text-sm font-medium text-[#E6EBF4] transition-colors hover:bg-[#273044] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A496FF]';

  const toggleRecording = (id: string) => {
    if (picked.includes(id)) {
      setPicked(p => p.filter(t => t !== id));
      setLimitNotice(false);
    } else if (picked.length >= 12) {
      setLimitNotice(true);
    } else {
      setPicked(p => [...p, id]);
      setLimitNotice(false);
    }
  };

  const closeStatus = () => {
    setStatusOpen(false);
    statusTriggerRef.current?.focus();
  };

  const create = async () => {
    if (creating || !picked.length) return;
    setCreating(true);
    setError(null);
    try {
      const r = await scriptApi.createProject(picked, minutes * 60, {
        format, thesis: thesis.trim() || undefined,
      });
      onOpen(r.project.id);
    } catch (e) { setError(e); } finally { setCreating(false); }
  };

  const importFile = async (f: File) => {
    setError(null);
    try {
      const data = JSON.parse(await f.text());
      let r;
      try { r = await scriptApi.importProject(data, false); } catch (e) {
        if (e instanceof ScriptApiError && e.code === 'CONFLICT' && window.confirm(e.message + '\n\nReplace the existing project?')) r = await scriptApi.importProject(data, true);
        else throw e;
      }
      onOpen(r.project.id);
    } catch (e) { setError(e); }
  };

  const providerName = (spec: string) => {
    const names: Record<string, string> = {
      'claude_cli:sonnet': 'Claude Sonnet',
      'claude_cli:haiku': 'Claude Haiku',
      codex_cli: 'Codex CLI',
      'ci:claude-haiku-5.5': 'Claude Haiku 5.5',
      'ci:gpt-6-luna': 'GPT-6 Luna',
    };
    return names[spec] || spec;
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-[#0B0D11] font-sans text-[#F4F6FA]">
      <div className="mx-auto w-full max-w-[1540px] px-4 pb-20 pt-5 sm:px-6 lg:px-8">
        <header className="mb-7 flex flex-wrap items-center justify-between gap-4 border-b border-[#252C3A] pb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-indigo-400/20 bg-[#211D40]">
              <FileText size={18} className="text-[#A496FF]" />
            </div>
            <div>
              <div className="text-base font-semibold tracking-tight text-[#F4F6FA]">SpacePipe Studio</div>
              <div className="text-xs text-[#ABB5C7]">Script Studio / Workspace</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <nav aria-label="Script Studio sections" className="flex items-center gap-1 rounded-lg border border-[#313A4C] bg-[#12161F] p-1">
              {([
                ['projects', 'Projects'],
                ['style', "Logan's Style"],
                ['quality', 'Quality & Logs'],
              ] as const).map(([key, label]) => (
                <button key={key} type="button" aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}
                  className={cx('rounded-md px-3 py-2 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#A496FF]',
                    tab === key ? 'bg-[#282146] text-white shadow-sm' : 'text-[#ABB5C7] hover:bg-[#1A2030] hover:text-white')}>
                  {label}
                </button>
              ))}
            </nav>
            <button ref={statusTriggerRef} type="button" onClick={() => setStatusOpen(true)}
              aria-label="Open models and connections" aria-haspopup="dialog"
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#313A4C] bg-[#12161F] px-3 text-xs text-[#D8E0ED] transition-colors hover:bg-[#1A2030] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#A496FF]">
              <span className={cx('h-2 w-2 rounded-full', !status ? 'bg-[#E9BD67]' : ready ? 'bg-[#55C9A2]' : 'bg-[#E9BD67]')} />
              <span className="hidden sm:inline">{!status ? 'Checking models' : ready ? 'Models available' : 'Model setup needed'}</span>
              <ChevronDown size={13} className="text-[#ABB5C7]" />
            </button>
          </div>
        </header>

        <div className="mb-6">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#A496FF]">Documentary production</div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-white sm:text-[30px]">Create a documentary project</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#ABB5C7]">
            Build documentary scripts from your recordings and source material.
            Select what to investigate, then shape the story in your project workspace.
          </p>
        </div>

        <ErrorBox error={error} onClose={() => setError(null)} />

        {tab === 'style' ? (
          <section className={cx(panel, 'mt-5 p-5')}><StylePanel /></section>
        ) : tab === 'quality' ? (
          <section className={cx(panel, 'mt-5 p-5')}><ScriptQuality onOpenProject={onOpen} /></section>
        ) : (
          <>
            <button type="button" onClick={() => setStatusOpen(true)}
              className={cx(panel, 'mb-6 flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[#1A2030] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#A496FF]')}>
              <span className="flex items-center gap-3">
                <span className={cx('h-2.5 w-2.5 shrink-0 rounded-full', !status ? 'bg-[#E9BD67]' : ready ? 'bg-[#55C9A2]' : 'bg-[#E9BD67]')} />
                <span className="text-sm font-medium text-[#E6EBF4]">
                  {!status ? 'Checking AI connections…' : subscriptionReady ? 'Subscription tools available' : fallbackReady ? 'Fallback models available' : 'AI connections need attention'}
                </span>
                {status && <span className="hidden text-xs text-[#ABB5C7] sm:inline">{providerCount} of {providerTotal} providers available</span>}
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-[#B8ACFF]">
                View details <ChevronRight size={14} />
              </span>
            </button>

            <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_392px] xl:gap-6">
              <section aria-labelledby="recording-library-heading" className={cx(panel, 'min-w-0 overflow-hidden')}>
                <div className="border-b border-[#313A4C] px-4 pb-4 pt-5 sm:px-5">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 id="recording-library-heading" className="text-lg font-semibold tracking-tight text-[#F4F6FA]">Recording library</h2>
                      <p className="mt-1 text-xs text-[#ABB5C7]">Choose up to 12 source recordings for this project.</p>
                    </div>
                    <span className="rounded-full border border-[#394256] bg-[#1A2030] px-2.5 py-1 text-xs tabular-nums text-[#C4CCDA]">{episodes.length} recordings</span>
                  </div>
                  <div className="relative">
                    <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8994A8]" />
                    <input aria-label="Search titles or recording IDs" className={cx(field, 'h-11 pl-10 pr-10')}
                      placeholder="Search titles or recording IDs…" value={filter} onChange={e => setFilter(e.target.value)} />
                    {filter && <button type="button" aria-label="Clear search" onClick={() => setFilter('')}
                      className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-[#ABB5C7] hover:bg-[#273044] hover:text-white"><X size={14} /></button>}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex gap-2">
                      <button type="button" aria-pressed={!onlySelected} onClick={() => setOnlySelected(false)}
                        className={cx('rounded-full border px-3 py-1.5 text-xs font-medium transition-colors', !onlySelected ? 'border-[#7357E9] bg-[#272141] text-[#DFD8FF]' : 'border-[#394256] text-[#ABB5C7] hover:text-white')}>All recordings</button>
                      <button type="button" aria-pressed={onlySelected} onClick={() => setOnlySelected(true)}
                        className={cx('rounded-full border px-3 py-1.5 text-xs font-medium transition-colors', onlySelected ? 'border-[#7357E9] bg-[#272141] text-[#DFD8FF]' : 'border-[#394256] text-[#ABB5C7] hover:text-white')}>Selected</button>
                    </div>
                    <span className="text-xs font-medium tabular-nums text-[#D8E0ED]">{picked.length} / 12 selected</span>
                  </div>
                </div>

                <div className="flex items-center justify-between border-b border-[#252C3A] bg-[#10141C] px-4 py-2.5 sm:px-5">
                  <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#8994A8]">Source recordings</span>
                  {picked.length > 0 && <button type="button" onClick={() => { setPicked([]); setLimitNotice(false); }}
                    className="text-xs font-medium text-[#B8ACFF] hover:text-white">Clear selection</button>}
                </div>

                <div className="max-h-[520px] min-h-[260px] overflow-y-auto overscroll-contain" role="group" aria-label="Available recordings">
                  {loadingEpisodes ? (
                    <div className="flex min-h-[260px] items-center justify-center gap-2 text-sm text-[#ABB5C7]"><Loader2 size={16} className="animate-spin" /> Loading recordings…</div>
                  ) : shown.length === 0 ? (
                    <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 p-6 text-center">
                      <Search size={24} className="text-[#8994A8]" />
                      <div className="text-sm font-medium text-[#E6EBF4]">{onlySelected && !picked.length ? 'No recordings selected' : 'No recordings match your search'}</div>
                      <div className="text-xs text-[#ABB5C7]">{onlySelected ? 'Select recordings from the library to see them here.' : 'Try another title or recording ID.'}</div>
                      {(filter || onlySelected) && <button type="button" className="text-xs font-medium text-[#B8ACFF] hover:text-white" onClick={() => { setFilter(''); setOnlySelected(false); }}>Show all recordings</button>}
                    </div>
                  ) : shown.map(e => {
                    const selected = picked.includes(e.releaseTag);
                    const atLimit = picked.length >= 12 && !selected;
                    return (
                      <label key={e.releaseTag} className={cx('group flex min-h-[64px] cursor-pointer items-center gap-3 border-b border-[#252C3A] px-4 py-3 transition-colors last:border-b-0 sm:px-5',
                        selected ? 'bg-[#23213D] hover:bg-[#2C274D]' : atLimit ? 'cursor-not-allowed opacity-55' : 'hover:bg-[#1A2030]')}>
                        <input type="checkbox" checked={selected} disabled={atLimit} onChange={() => toggleRecording(e.releaseTag)}
                          aria-label={'Select ' + e.title}
                          className="h-[18px] w-[18px] shrink-0 cursor-pointer accent-[#7357E9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A496FF]" />
                        <span className="min-w-0 flex-1">
                          <span className={cx('block truncate text-sm font-medium', selected ? 'text-[#F4F6FA]' : 'text-[#D8E0ED]')} title={e.title}>{e.title.replace(/_/g, ' ')}</span>
                          <span className="mt-1 block truncate font-mono text-[11px] text-[#8994A8]" title={e.releaseTag}>{e.releaseTag}</span>
                        </span>
                        {selected && <Check size={15} className="shrink-0 text-[#A496FF]" aria-hidden="true" />}
                      </label>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#313A4C] px-4 py-3 sm:px-5">
                  <span className="text-xs tabular-nums text-[#ABB5C7]">
                    {loadingEpisodes ? 'Loading…' : 'Showing ' + shown.length + ' of ' + matches.length + ' matching recordings'}
                  </span>
                  {visibleCount < matches.length && <button type="button" onClick={() => setVisibleCount(n => n + 60)}
                    className="text-xs font-medium text-[#B8ACFF] hover:text-white">Load more</button>}
                </div>
              </section>

              <aside className="min-w-0 space-y-4 xl:sticky xl:top-5" aria-label="Project setup">
                <section className={cx(panel, 'p-5 sm:p-6')}>
                  <div className="mb-5 flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold tracking-tight">New project</h2>
                      <p className="mt-1 text-xs text-[#ABB5C7]">Configure your script workspace</p>
                    </div>
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#211D40] text-[#A496FF]"><Film size={18} /></div>
                  </div>

                  <div className="space-y-5">
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-medium text-[#D8E0ED]">Selected sources</span>
                        <span className="text-xs tabular-nums text-[#ABB5C7]">{picked.length} / 12</span>
                      </div>
                      {picked.length ? (
                        <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-[#313A4C] bg-[#0B0D11] p-2">
                          {picked.map(id => {
                            const episode = episodes.find(e => e.releaseTag === id);
                            return <span key={id} className="inline-flex max-w-full items-center gap-1 rounded-md border border-[#403B65] bg-[#23213D] px-2 py-1 text-[11px] text-[#E6E1FF]">
                              <span className="max-w-[220px] truncate">{(episode?.title || id).replace(/_/g, ' ')}</span>
                              <button type="button" aria-label={'Remove ' + (episode?.title || id)} onClick={() => toggleRecording(id)}
                                className="rounded-sm p-0.5 hover:bg-[#403B65]"><X size={12} /></button>
                            </span>;
                          })}
                        </div>
                      ) : <div className="rounded-lg border border-dashed border-[#394256] bg-[#10141C] px-3 py-4 text-center text-xs text-[#8994A8]">Choose recordings from the library</div>}
                      {(limitNotice || picked.length === 12) && <p className="mt-2 text-xs text-[#E9BD67]" role="status">Maximum 12 recordings. Remove one to select another.</p>}
                    </div>

                    <div>
                      <label htmlFor="studio-documentary-format" className="mb-1.5 block text-xs font-medium text-[#D8E0ED]">Documentary format</label>
                      <select id="studio-documentary-format" className={field} value={format} onChange={e => setNewFormat(e.target.value as EpisodeFormat)}>
                        {EPISODE_FORMATS.map(f => <option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}
                      </select>
                    </div>

                    {picked.length > 1 && <div>
                      <label htmlFor="studio-central-question" className="mb-1.5 block text-xs font-medium text-[#D8E0ED]">Central question <span className="font-normal text-[#8994A8]">(optional)</span></label>
                      <textarea id="studio-central-question" rows={2} className={cx(field, 'resize-y')} value={thesis}
                        onChange={e => setThesis(e.target.value)} placeholder="What question should this story answer?" />
                      <p className="mt-1.5 text-[11px] leading-4 text-[#8994A8]">Give multi-recording stories a shared focus.</p>
                    </div>}

                    <div>
                      <label htmlFor="studio-target-minutes" className="mb-2 block text-xs font-medium text-[#D8E0ED]">Target length</label>
                      <div className="mb-2 grid grid-cols-4 gap-1.5">
                        {[10, 15, 30, 45].map(n => <button type="button" key={n} onClick={() => setMinutes(n)} aria-pressed={minutes === n}
                          className={cx('min-h-9 rounded-lg border text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#A496FF]',
                            minutes === n ? 'border-[#7357E9] bg-[#282146] text-[#E6E1FF]' : 'border-[#394256] bg-[#1A2030] text-[#ABB5C7] hover:text-white')}>{n}m</button>)}
                      </div>
                      <div className="flex items-center gap-2">
                        <input id="studio-target-minutes" type="number" min={1} max={240} className={cx(field, 'w-24 tabular-nums')} value={minutes}
                          onChange={e => setMinutes(Math.min(240, Math.max(1, Number(e.target.value) || 1)))} />
                        <span className="text-xs text-[#ABB5C7]">minutes</span>
                      </div>
                    </div>

                    <button type="button" className={cx(secondaryButton, 'w-full')} onClick={() => setUploadModalOpen(true)}>
                      <Upload size={15} /> Upload script & evidence
                    </button>

                    <div className="border-t border-[#313A4C] pt-5">
                      <button type="button" disabled={!picked.length || creating} onClick={() => void create()}
                        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#7357E9] px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#856EFA] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A496FF] disabled:cursor-not-allowed disabled:bg-[#343044] disabled:text-[#8994A8]">
                        {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                        {creating ? 'Creating project…' : 'Create project'}
                      </button>
                      <p className="mt-2.5 text-center text-[11px] leading-4 text-[#ABB5C7]">
                        {!picked.length ? 'Select at least one recording to continue.' : 'Creates a workspace. Drafting happens inside the project.'}
                      </p>
                    </div>
                  </div>
                </section>

                <section className={cx(panel, 'p-5')} aria-labelledby="studio-recent-heading">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 id="studio-recent-heading" className="text-sm font-semibold text-[#F4F6FA]">Recent projects</h2>
                    <span className="text-xs tabular-nums text-[#8994A8]">{projects.length} total</span>
                  </div>
                  {recentProjects.length ? <div className="divide-y divide-[#313A4C]">
                    {recentProjects.map(p => <div key={p.id} className="flex items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-[#E6EBF4]" title={p.title}>{p.title}</div>
                        <div className="mt-1 text-[11px] text-[#8994A8]">{new Date(p.updatedAt).toLocaleDateString()} · {p.sourceTags.length} source{p.sourceTags.length === 1 ? '' : 's'}</div>
                      </div>
                      <button type="button" onClick={() => onOpen(p.id)}
                        className="rounded-lg border border-[#394256] px-3 py-2 text-xs font-medium text-[#E6EBF4] hover:bg-[#273044] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#A496FF]">Open</button>
                    </div>)}
                  </div> : <div className="py-4 text-xs text-[#8994A8]">No projects yet. Your projects will appear here.</div>}
                </section>
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="flex min-h-10 w-full items-center justify-center gap-2 rounded-lg text-xs font-medium text-[#ABB5C7] transition-colors hover:bg-[#1A2030] hover:text-white">
                  <Upload size={14} /> Import project JSON
                </button>
              </aside>
            </div>
          </>
        )}
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
        <UploadScriptModal isOpen={uploadModalOpen} onClose={() => setUploadModalOpen(false)} onOpenProject={onOpen} initialTags={picked} episodes={episodes} />
      </div>

      {statusOpen && <div className="fixed inset-0 z-40">
        <button type="button" aria-label="Close models and connections" onClick={closeStatus} className="absolute inset-0 h-full w-full cursor-default bg-[#05070C]/75" />
        <aside role="dialog" aria-modal="true" aria-label="Models and connections" className="absolute inset-y-0 right-0 flex w-full max-w-[420px] flex-col border-l border-[#313A4C] bg-[#12161F] shadow-2xl">
          <div className="flex items-start justify-between gap-3 border-b border-[#313A4C] px-6 py-5">
            <div>
              <h2 className="text-lg font-semibold">Models &amp; connections</h2>
              <p className="mt-1 text-xs text-[#ABB5C7]">Availability on this computer</p>
            </div>
            <button type="button" aria-label="Close panel" onClick={closeStatus}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-[#ABB5C7] hover:bg-[#273044] hover:text-white"><X size={18} /></button>
          </div>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-[#ABB5C7]">{!status ? 'Checking model availability…' : providerCount + ' of ' + providerTotal + ' providers available'}</span>
              <button type="button" className={secondaryButton} disabled={checking} onClick={onRecheck}>
                {checking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Check connections
              </button>
            </div>
            {!status ? <div className="text-sm text-[#ABB5C7]">Checking local and fallback providers…</div> : (
              <div className="space-y-2">
                {Object.entries(status.providers).map(([spec, h]) => (
                  <div key={spec} className="rounded-lg border border-[#313A4C] bg-[#0B0D11] p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        {h.ok ? <CheckCircle2 size={15} className="shrink-0 text-[#55C9A2]" /> : <XCircle size={15} className="shrink-0 text-[#E9BD67]" />}
                        <span className="truncate text-sm font-medium text-[#E6EBF4]">{providerName(spec)}</span>
                      </div>
                      <span className={cx('shrink-0 text-[11px]', h.ok ? 'text-[#55C9A2]' : 'text-[#E9BD67]')}>{h.ok ? 'Available' : 'Needs attention'}</span>
                    </div>
                    <div className="mt-1.5 truncate pl-[23px] font-mono text-[11px] text-[#ABB5C7]" title={h.model}>{h.model}</div>
                    <details className="mt-2 pl-[23px] text-xs text-[#ABB5C7]">
                      <summary className="cursor-pointer text-[#B8ACFF]">Technical details</summary>
                      <p className="mt-2 break-words leading-5">{h.detail}</p>
                      {h.binPath && <p className="mt-1 break-all font-mono text-[11px]">{h.binPath}</p>}
                    </details>
                  </div>
                ))}
              </div>
            )}
            {status && <>
              <div className="rounded-lg border border-[#313A4C] p-4">
                <h3 className="text-sm font-semibold">AI routing</h3>
                <div className="mt-3 flex items-center justify-between text-xs"><span className="text-[#ABB5C7]">Subscription tools</span><span className={subscriptionReady ? 'text-[#55C9A2]' : 'text-[#E9BD67]'}>{subscriptionReady ? 'Ready' : 'Needs setup'}</span></div>
                <div className="mt-2 flex items-center justify-between text-xs"><span className="text-[#ABB5C7]">Fallback models</span><span className={fallbackReady ? 'text-[#55C9A2]' : 'text-[#E9BD67]'}>{fallbackReady ? 'Configured' : 'Needs setup'}</span></div>
                <p className="mt-3 text-[11px] leading-4 text-[#8994A8]">Availability does not mean a model is running. Choose model roles inside a project.</p>
              </div>
              {status.interruptedAtStart > 0 && <div className="rounded-lg border border-[#7B633D] bg-[#292315] p-3 text-xs leading-5 text-[#E9BD67]" role="status">
                {status.interruptedAtStart} interrupted run(s) from the last server restart. Open the relevant project to resume.
              </div>}
              <details className="rounded-lg border border-[#313A4C] p-4">
                <summary className="cursor-pointer text-sm font-semibold">Local project storage</summary>
                <p className="mt-3 break-all font-mono text-xs leading-5 text-[#ABB5C7]">{status.storeDir}</p>
              </details>
            </>}
          </div>
        </aside>
      </div>}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Block editor & Auto-growing textarea                                                           */
/* ---------------------------------------------------------------------------------------------- */

function AutoResizeTextarea({
  value,
  onChange,
  className,
  placeholder,
}: {
  value: string;
  onChange: (val: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    if (ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = `${Math.max(38, ref.current.scrollHeight)}px`;
    }
  }, []);

  useEffect(() => {
    resize();
  }, [value, resize]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={e => {
        onChange(e.target.value);
        resize();
      }}
      placeholder={placeholder}
      className={cx('resize-none overflow-hidden transition-all', className)}
    />
  );
}

function BlockView({ block, clip, onChange, onRemove, onMove, onPlay, onClaim, onSavePassage, playing }: {
  block: Block; clip?: StudioClip; onChange: (b: Block) => void; onRemove: () => void; onMove: (d: -1 | 1) => void;
  onPlay: () => void; onClaim: (t: number) => void; onSavePassage?: (text: string) => void; playing: boolean;
}) {
  const lockBtn = (
    <button className="text-slate-400 hover:text-white" title={block.locked ? 'Locked: the loop will not change this block' : 'Lock this block'} onClick={() => onChange({ ...block, locked: !block.locked } as Block)}>
      {block.locked ? <Lock size={13} className="text-amber-400" /> : <Unlock size={13} />}
    </button>
  );
  const tools = (
    <div className="flex items-center gap-1.5 shrink-0">
      {block.locked && <span title="Locked block"><Lock size={12} className="text-amber-400/80 mr-0.5 group-hover:hidden" /></span>}
      <div className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 flex items-center gap-1.5">
        {lockBtn}
        <button className="text-slate-500 hover:text-white" onClick={() => onMove(-1)} title="Move up"><ArrowUp size={13} /></button>
        <button className="text-slate-500 hover:text-white" onClick={() => onMove(1)} title="Move down"><ArrowDown size={13} /></button>
        <button className="text-slate-500 hover:text-rose-400" onClick={onRemove} title="Remove block"><Trash2 size={13} /></button>
      </div>
    </div>
  );

  // 1. Scene / Act Heading (`type: "HEADING"`)
  if (block.type === 'HEADING' || block.kind === 'heading') {
    return (
      <div className="group rounded-md border border-indigo-900/40 bg-indigo-950/20 px-3 py-2 flex items-center gap-2 transition-all">
        <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 shrink-0">
          HEADING (0s)
        </span>
        <input
          className="w-full bg-transparent text-sm font-semibold text-slate-100 focus:outline-none"
          value={block.text}
          onChange={e => onChange({ ...block, text: e.target.value })}
          placeholder="Section / Scene Heading..."
        />
        <span className="text-[10px] text-slate-500 shrink-0">0s · excluded from Vox</span>
        {tools}
      </div>
    );
  }

  // 2. Archival Tape / Broadcast Clips (`type: "ARCHIVAL_CLIP"`)
  if (block.type === 'ARCHIVAL_CLIP' || block.kind === 'clip') {
    const clipTitle = clip?.title || block.spaceTitle || (block.clipNumber ? `Space Clip #${block.clipNumber}` : block.clipId);
    const speakerName = clip?.speaker || block.speaker || 'Tape';
    const durationSec = clip?.durationSec || Math.max(1, block.outSec - block.inSec);

    return (
      <div className={cx(
        'group rounded-md border p-3 transition-all',
        block.locked ? 'border-amber-700/50 bg-amber-950/10' : 'border-teal-800/60 bg-teal-950/15'
      )}>
        <div className="flex items-center gap-2 mb-2 text-[11px] uppercase tracking-wide text-slate-400">
          <button
            onClick={onPlay}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-teal-500/20 text-teal-300 hover:bg-teal-500/30 hover:text-white transition-colors"
            title="Play this archival cut"
          >
            {playing ? <Pause size={12} /> : <Play size={12} />}
            <span>{playing ? 'Pause' : 'Play Clip'}</span>
          </button>
          <span className="px-1.5 py-0.5 rounded font-bold text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30">
            ARCHIVAL CLIP {block.clipNumber ? `#${block.clipNumber}` : ''}
          </span>
          <span className="font-semibold text-teal-200 truncate">{clipTitle}</span>
          {speakerName && <span className="text-slate-300">· {speakerName}</span>}
          {block.date && <span className="text-slate-500">· {block.date}</span>}
          {block.time && <span className="text-slate-500">· {block.time}</span>}
          <div className="flex-1" />
          <span className="text-slate-400 text-[10px] font-mono mr-2">
            {hms(block.inSec)}–{hms(block.outSec)} ({durationSec.toFixed(1)}s)
          </span>
          {tools}
        </div>

        <div className="pl-3 border-l-2 border-teal-500/50 my-1">
          <p className="text-sm text-slate-200 italic font-serif leading-relaxed">
            “{block.keptText}”
          </p>
        </div>

        {/* Inline Waveform / Play Trigger visualization */}
        <div className="mt-2.5 flex items-center gap-2 pt-1 border-t border-teal-900/30 text-[10px] text-teal-400/80">
          <div className="flex items-center gap-0.5 h-3.5 flex-1 opacity-70">
            {[40, 65, 80, 50, 90, 70, 30, 85, 95, 60, 45, 75, 35, 90, 60, 40, 85, 70, 55, 30, 60, 80, 45, 90, 70, 50, 65, 40].map((h, i) => (
              <div key={i} className="flex-1 bg-teal-400/60 rounded-full" style={{ height: `${h}%` }} />
            ))}
          </div>
          <span className="text-slate-500 shrink-0 font-mono text-[10px]">Tape Audio ({durationSec.toFixed(1)}s) · Excluded from Vox</span>
        </div>

        {block.flag && <p className="mt-1 text-[11px] text-amber-300 flex items-center gap-1"><AlertTriangle size={11} /> {block.flag}</p>}
        {!clip && !block.spaceTitle && <p className="mt-1 text-[11px] text-amber-300">Sync clips to link full audio metadata.</p>}
      </div>
    );
  }

  // 3. SFX, Score, & Stage Direction (`type: "CUE"`)
  if (block.kind === 'cue' || (block.type === 'CUE' && block.kind !== 'pause' && block.kind !== 'music')) {
    const cueBlock = block as { id: string; kind: string; sec?: number; text?: string; note?: string; cueType?: string; locked?: boolean };
    const sec = 'sec' in block && typeof (block as any).sec === 'number' ? (block as any).sec : 0;
    const isPause = cueBlock.cueType === 'silence' || cueBlock.cueType === 'beat' || sec > 0;
    const label = 'text' in block && (block as any).text ? (block as any).text : ('note' in block && (block as any).note ? (block as any).note : (isPause ? `${sec}s pause` : 'Cue'));
    return (
      <div className="group rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2 flex items-center gap-2 text-xs transition-all">
        {isPause ? (
          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 shrink-0">
            {cueBlock.cueType === 'beat' ? 'BEAT' : 'SILENCE'}
          </span>
        ) : (
          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/30 shrink-0">
            {cueBlock.cueType === 'sfx' ? 'SFX' : cueBlock.cueType === 'theme' ? 'THEME' : 'CUE'}
          </span>
        )}
        <div className="flex-1 min-w-0 text-slate-300 font-mono text-[11px] truncate">
          {label}
        </div>
        <div className="text-[11px] text-slate-500 shrink-0">
          {isPause ? (
            <span className="text-amber-400 font-mono">{sec}s pause</span>
          ) : (
            <span>0s · direction (excluded from Vox)</span>
          )}
        </div>
        {tools}
      </div>
    );
  }

  // 4. Quoted Transcripts / Evidence Reads (`type: "QUOTE_READ"`)
  if (block.kind === 'narration' && (block.type === 'QUOTE_READ' || block.readEvidence)) {
    const estSec = ((block.text.trim().split(/\s+/).filter(Boolean).length / 155) * 60).toFixed(1);
    return (
      <div className={cx(
        'group rounded-md border border-l-4 border-l-cyan-500 border-slate-800 bg-cyan-950/20 p-3 transition-all',
        block.locked && 'bg-amber-950/10'
      )}>
        <div className="flex items-center gap-2 mb-1.5 text-[11px] uppercase tracking-wide">
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
            LOGAN (READING EVIDENCE)
          </span>
          <span className="normal-case text-slate-400 text-[11px]">
            Spoken quote · about {estSec}s (at 155 wpm)
          </span>
          <div className="flex-1" />
          {tools}
        </div>
        <AutoResizeTextarea
          className="w-full bg-transparent text-sm italic font-serif text-cyan-100 leading-relaxed focus:outline-none"
          value={block.text}
          onChange={val => onChange({ ...block, text: val })}
          placeholder="Logan reading evidence text..."
        />
      </div>
    );
  }

  // 5. Standard Narration (`type: "NARRATION"`)
  if (block.kind === 'narration') {
    return (
      <div className={cx('group rounded-md border p-3 transition-all', block.locked ? 'border-amber-700/50 bg-amber-950/10' : 'border-slate-800 bg-slate-950/50')}>
        <div className="flex items-center gap-2 mb-1.5 text-[11px] uppercase tracking-wide text-slate-500">
          <span className="text-indigo-300 font-semibold">Narration</span>
          <span className="text-slate-400">{block.mode}</span>
          {hasValidTake(block) ? (
            <>
              <button onClick={onPlay} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 hover:text-white" title="Play the Vox take">
                {playing ? <Pause size={12} /> : <Play size={12} />}
                <span>{block.takeSec.toFixed(1)}s take</span>
              </button>
            </>
          ) : (
            <span className="normal-case text-slate-400" title="Words at 155 per minute; preview the audio for the real length">
              {block.takeUrl ? 'take is for older wording, ' : ''}about {((block.text.trim().split(/\s+/).filter(Boolean).length / 155) * 60).toFixed(1)}s (est)
            </span>
          )}
          <div className="flex-1" />
          {onSavePassage && block.text.trim() && (
            <button className="text-slate-500 hover:text-indigo-300 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150" onClick={() => onSavePassage(block.text)} title="Save this narration as a voice example for future drafts">
              <BookmarkPlus size={13} />
            </button>
          )}
          {tools}
        </div>
        <AutoResizeTextarea
          className="w-full bg-transparent text-sm text-slate-100 leading-relaxed focus:outline-none"
          value={block.text}
          onChange={val => onChange({ ...block, text: val })}
          placeholder="Enter narration..."
        />
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

  // 6. Pause tag
  if (block.kind === 'pause') {
    return (
      <div className="group rounded-md border border-slate-800 bg-slate-950/40 px-2.5 py-1.5 flex items-center gap-2 text-xs text-slate-400 transition-all">
        Pause <input type="number" step={0.5} min={0} max={10} className={cx(input, 'w-16')} value={block.sec} onChange={e => onChange({ ...block, sec: Math.max(0, Number(e.target.value) || 0) })} /> s
        <div className="flex-1" />
        {tools}
      </div>
    );
  }

  // 7. Music marker
  return (
    <div className="group rounded-md border border-fuchsia-900/50 bg-fuchsia-950/10 px-2.5 py-1.5 flex items-center gap-2 text-xs text-fuchsia-200 transition-all">
      Music marker: {block.cue.replace('_', ' ')} <span className="text-slate-400">{block.note}</span>
      <span className="text-[10px] text-slate-500">(label only; music is added outside the app)</span>
      <div className="flex-1" />
      {tools}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Main                                                                                            */
/* ---------------------------------------------------------------------------------------------- */

export default function ScriptStudio({ onOpenMontage }: { onOpenMontage?: () => void } = {}) {
  const player = usePlayer();
  const montage = useMontage();
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
  const [showUploadVersionModal, setShowUploadVersionModal] = useState(false);
  const [episodes, setEpisodes] = useState<{ releaseTag: string; title: string }[]>([]);
  const [leftTab, setLeftTab] = useState<'pipeline' | 'evidence' | 'transcripts'>('pipeline');
  const [drawerOpen, setDrawerOpen] = useState<'refine' | 'versions' | null>(null);
  const [collapsedScenes, setCollapsedScenes] = useState<Record<string, boolean>>({});
  const [audioProgress, setAudioProgress] = useState<string | null>(null);
  const stopRef = useRef<{ id: string; at: number } | null>(null);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const [mainView, setMainView] = useState<'script' | 'board' | 'library'>('script');
  const lib = useLibrary(projectId, mainView !== 'script');

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
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);
  // Switching to another panel unmounts this one; the app asks first while edits are unsaved.
  useEffect(() => setUnsavedGuard(() => (dirtyRef.current ? 'Script Studio has unsaved edits.' : null)), []);

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
      const segs = Array.isArray(j) ? j : (Array.isArray(j?.segments) ? j.segments : []);
      setRows(segs.map((s: any, i: number) => ({ id: `u${i}`, start: Number(s.start) || 0, end: Number(s.end) || 0, speaker: String(s.speaker || 'Unknown'), text: String(s.text || '') })));
    }).catch(() => setRows([]));
  }, [tag]);
  const analysis = data?.analyses[tag] || null;
  const allAnalysed = !!project && project.sourceTags.every(t => data?.analyses[t]);
  const stats = data?.speakerStats[tag];
  const clipsById = useMemo(() => {
    const map: Record<string, StudioClip> = {};
    for (const c of project?.clips || []) {
      if (c.clipId) map[c.clipId] = c;
      if (c.id) map[c.id] = c;
    }
    return map;
  }, [project]);
  const runtime = useMemo(() => (segments ? estimateRuntime(segments) : null), [segments]);
  const names = namesForTag(project?.speakerNames, tag);

  const allScenes = useMemo(() => {
    if (!segments) return [];
    return segments.flatMap(seg => seg.scenes.map(sc => ({ ...sc, segmentTitle: seg.title })));
  }, [segments]);

  const sceneRuntimes = useMemo(() => {
    if (!segments) return {};
    const map: Record<string, number> = {};
    for (const seg of segments) {
      for (const sc of seg.scenes) {
        let sec = 0;
        for (const b of sc.blocks) {
          sec += blockSeconds(b).sec;
        }
        map[sc.id] = Math.round(sec);
      }
    }
    return map;
  }, [segments]);

  const takesCount = useMemo(() => {
    return segments ? countTakes(segments) : { withTake: 0, narration: 0 };
  }, [segments]);

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
      copy[segI].scenes[scI].blocks.push({
        id: `b_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        kind: 'narration',
        type: 'NARRATION',
        text: 'New narration.',
        mode: 'live',
        claims: [],
      });
      return copy;
    });
    setDirty(true);
  };

  const toggleScene = (scId: string) => {
    setCollapsedScenes(prev => ({ ...prev, [scId]: !prev[scId] }));
  };

  const save = async (label = 'Edit') => {
    if (!segments || !project) return;
    setBusy('Saving version');
    setError(null);
    try {
      // Send current local editor state/buffer directly to persistence endpoint before re-fetch or state refresh
      const currentSegments = segments;
      const res = await scriptApi.saveVersion(project.id, project.headVersionId, currentSegments, label);
      if (res.headMoved === false) {
        // Saved as a version, but the checks failed, so the head stayed. Keep the edit on screen to fix.
        const r = await scriptApi.project(project.id);
        setData(r);
        setNotice(`Saved as a version, but the head did not move because a check failed: ${res.gates.failures.join(' ')}`);
        return res;
      }
      setDirty(false);
      dirtyRef.current = false;
      if (projectId) {
        await load(projectId);
      }
      setNotice(`Version saved (${label})`);
      return res;
    } catch (e: any) {
      setError(e);
      throw e;
    } finally {
      setBusy(null);
    }
  };

  const playTake = (b: Extract<Block, { kind: 'narration' }>) => {
    if (!hasValidTake(b)) return;
    const id = `script:${b.id}`;
    if (player.current?.id === id) { player.togglePlay(); return; }
    stopRef.current = null;
    player.play({ id, title: `Narration: ${b.text.slice(0, 60)}`, audioUrl: b.takeUrl });
  };

  const playingUrl = player.isPlaying ? player.current?.audioUrl ?? null : null;
  const listenQuote = (e: ViewEntry, o: ListenOption) => {
    const id = `quote:${e.ref}:${o.kind}`;
    if (player.current?.id === id) { player.togglePlay(); return; }
    stopRef.current = null;
    player.play({ id, title: `${e.aqId}: ${o.label}`, audioUrl: o.url });
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

  const syncClipsFromManuscript = async () => {
    if (!segments || !project) return;
    let segmentsChanged = false;
    const updatedSegments: Segment[] = JSON.parse(JSON.stringify(segments));

    // Master list of project clips (existing + newly extracted)
    const catalogClips: StudioClip[] = [...(project.clips || [])];
    const existingById = new Map<string, StudioClip>();
    const existingBySpeakerTime = new Map<string, StudioClip>();
    const existingBySpeakerSec = new Map<string, StudioClip>();

    for (const c of catalogClips) {
      const cid = String(c.clipId || (c as any).id || '');
      if (cid) existingById.set(cid, c);
      const spk = (c.speaker || '').trim().toLowerCase();
      const ts = (c.timestamp || c.time || '').trim();
      if (spk && ts) {
        existingBySpeakerTime.set(`${spk}|${ts}`, c);
        const s = parseTimeToSeconds(ts);
        if (s > 0) existingBySpeakerSec.set(`${spk}|${s}`, c);
      }
    }

    let addedCount = 0;
    const timestampSeed = Date.now();
    let clipIndexCounter = 0;

    /**
     * Resolves an existing clip in the episode catalog or auto-registers a new one.
     * Deduplication key is speaker + timestamp (or existing clipId/id).
     */
    const getOrRegisterCatalogClip = (info: {
      speaker?: string;
      timestamp?: string;
      quote?: string;
      candidateId?: string;
      title?: string;
      clipNumber?: string;
      spaceTitle?: string;
      date?: string;
      durationSec?: number;
    }): StudioClip => {
      const spk = (info.speaker || 'Unknown').trim();
      const normSpk = spk.toLowerCase();
      const rawTs = (info.timestamp || '').trim();
      const sec = parseTimeToSeconds(rawTs);
      const tsKey = normSpk && rawTs ? `${normSpk}|${rawTs}` : '';
      const secKey = normSpk && sec > 0 ? `${normSpk}|${sec}` : '';
      const cid = info.candidateId ? String(info.candidateId) : '';

      // Check if it already exists in the catalog
      let matched: StudioClip | undefined;
      if (tsKey && existingBySpeakerTime.has(tsKey)) {
        matched = existingBySpeakerTime.get(tsKey);
      } else if (secKey && existingBySpeakerSec.has(secKey)) {
        matched = existingBySpeakerSec.get(secKey);
      } else if (cid && existingById.has(cid)) {
        matched = existingById.get(cid);
      }

      if (matched) {
        if (!matched.quote && info.quote) matched.quote = info.quote.trim();
        if (!matched.text && info.quote) matched.text = info.quote.trim();
        if (!matched.timestamp && rawTs) matched.timestamp = rawTs;
        if (!matched.time && rawTs) matched.time = rawTs;
        if (!matched.label) matched.label = `${spk} (${rawTs || '0:00'})`;
        if (!matched.source) matched.source = 'manuscript_extracted';
        return matched;
      }

      // Not found: generate a new clip entry according to specification
      const newId = `clip_${timestampSeed}_${clipIndexCounter++}`;
      const quoteText = (info.quote || '').trim();
      const wordsCount = quoteText.split(/\s+/).filter(Boolean).length;
      const derivedDurationSec = info.durationSec && Number.isFinite(info.durationSec) && info.durationSec > 0
        ? info.durationSec
        : Math.max(1.5, Math.round(((wordsCount / 155) * 60) * 10) / 10);

      const newClip: StudioClip = {
        id: newId,
        clipId: newId,
        speaker: spk,
        timestamp: rawTs || '0:00',
        time: rawTs || '0:00',
        quote: quoteText,
        text: quoteText,
        label: `${spk} (${rawTs || '0:00'})`,
        source: 'manuscript_extracted',
        title: info.title ? info.title.trim() : (info.spaceTitle ? `${info.spaceTitle} (${spk})` : `${spk} (${rawTs || '0:00'})`),
        releaseTag: project.sourceTags[0] || 'catalog',
        audioUrl: '',
        durationSec: derivedDurationSec,
        episodeStartSec: sec,
        fn: 'evidence',
        fnRationale: `Extracted from manuscript: ${spk} (${rawTs || '0:00'})`,
      };

      catalogClips.push(newClip);
      existingById.set(newId, newClip);
      if (tsKey) existingBySpeakerTime.set(tsKey, newClip);
      if (secKey) existingBySpeakerSec.set(secKey, newClip);
      addedCount++;
      return newClip;
    };

    /**
     * Traverses quote pill objects in an array and rebinds them to catalog clip IDs.
     */
    const processPillArray = (items: any[]) => {
      if (!Array.isArray(items)) return;
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const spk = String(item.speaker || item.quoteSpeaker || item.speakerName || '').trim();
        const ts = String(item.time || item.timestamp || '').trim();
        const q = String(item.quote || item.text || item.keptText || '').trim();
        if (spk || ts || q || item.clipId || item.id) {
          const registered = getOrRegisterCatalogClip({
            speaker: spk || 'Tape',
            timestamp: ts,
            quote: q,
            candidateId: item.clipId || item.id,
            title: item.title || item.label,
          });
          if (item.clipId !== registered.clipId || item.id !== registered.id) {
            item.clipId = registered.clipId;
            item.id = registered.id;
            item.source = registered.source || 'manuscript_extracted';
            item.label = registered.label || `${registered.speaker} (${registered.timestamp || registered.time})`;
            segmentsChanged = true;
          }
        }
      }
    };

    const PILL_CONTAINER_KEYS = ['pills', 'quotes', 'clips', 'items', 'children'] as const;

    // 1. Traverse all scenes and blocks in the manuscript
    for (const seg of updatedSegments) {
      for (const sc of seg.scenes) {
        // A. Scene-level quote pills / items
        for (const key of PILL_CONTAINER_KEYS) {
          const arr = (sc as any)[key];
          if (Array.isArray(arr)) processPillArray(arr);
        }

        // B. Scene blocks
        for (let bI = 0; bI < sc.blocks.length; bI++) {
          const b = sc.blocks[bI];

          // Nested pill objects inside the block
          for (const key of PILL_CONTAINER_KEYS) {
            const arr = (b as any)[key];
            if (Array.isArray(arr)) processPillArray(arr);
          }

          // Structured clip blocks
          if (b.kind === 'clip') {
            const registered = getOrRegisterCatalogClip({
              speaker: b.speaker || (clipsById[b.clipId]?.speaker) || 'Tape',
              timestamp: b.time || (clipsById[b.clipId]?.time) || '',
              quote: b.keptText || (clipsById[b.clipId]?.text) || '',
              candidateId: b.clipId,
              title: b.spaceTitle || (clipsById[b.clipId]?.title),
              durationSec: b.outSec > b.inSec ? b.outSec - b.inSec : clipsById[b.clipId]?.durationSec,
            });
            if (b.clipId !== registered.clipId) {
              b.clipId = registered.clipId;
              segmentsChanged = true;
            }
            if (!b.speaker || b.speaker === 'Unknown') {
              b.speaker = registered.speaker;
              segmentsChanged = true;
            }
            if (!b.time) {
              b.time = registered.timestamp || registered.time;
              segmentsChanged = true;
            }
            if (!b.keptText) {
              b.keptText = registered.quote || registered.text;
              segmentsChanged = true;
            }
          }

          // Narration and text scanning for regex matches
          const textToScan = b.kind === 'clip'
            ? (b.keptText || '')
            : ('text' in b && typeof b.text === 'string' ? b.text : ('note' in b && typeof (b as any).note === 'string' ? (b as any).note : ''));

          if (textToScan) {
            const foundClips = extractClipsFromText(textToScan, project.title || 'Archival Tape');
            for (const fc of foundClips) {
              const registered = getOrRegisterCatalogClip({
                speaker: fc.speaker,
                timestamp: fc.time,
                quote: fc.quote,
                candidateId: fc.clipId,
                title: fc.title,
                clipNumber: fc.clipNumber,
                spaceTitle: fc.spaceTitle,
                date: fc.date,
                durationSec: fc.durationSec,
              });

              // Convert standalone narration tags into ARCHIVAL_CLIP blocks
              if (b.kind === 'narration' && foundClips.length === 1 && textToScan.trim().startsWith('[') && textToScan.trim().endsWith(']')) {
                sc.blocks[bI] = {
                  id: b.id,
                  kind: 'clip',
                  type: 'ARCHIVAL_CLIP',
                  clipId: registered.clipId,
                  clipNumber: (registered as any).clipNumber || fc.clipNumber,
                  spaceTitle: (registered as any).spaceTitle || fc.spaceTitle || project.title || 'Archival Tape',
                  date: (registered as any).date || fc.date,
                  time: registered.timestamp || registered.time,
                  speaker: registered.speaker,
                  keptText: registered.quote || registered.text,
                  inSec: 0,
                  outSec: registered.durationSec,
                  trimBasis: 'full',
                  fn: registered.fn || 'evidence',
                  rationale: `Extracted from manuscript: ${registered.speaker} (${registered.timestamp || registered.time})`,
                  locked: false,
                };
                segmentsChanged = true;
              }
            }
          }
        }
      }
    }

    if (catalogClips.length === 0) {
      setNotice('No quote pills, clip blocks, or archival tags were found in this manuscript to sync.');
      return;
    }

    // 4. Update UI State immediately
    setData(prev => {
      if (!prev || !prev.project) return prev;
      return {
        ...prev,
        project: {
          ...prev.project,
          clips: catalogClips,
        },
      };
    });

    if (segmentsChanged) {
      setSegments(updatedSegments);
      setDirty(true);
    }

    // 2b. Persist updated clip catalog into database / backend
    if (addedCount > 0) {
      try {
        await scriptApi.updateProject(project.id, { clips: catalogClips });
        const fresh = await scriptApi.project(project.id);
        if (fresh && fresh.project) {
          setData(fresh);
        }
      } catch (err: any) {
        console.error('Failed to persist synced clips:', err);
      }
      setNotice(`Synced ${addedCount} clip(s) from manuscript into Clip Bin (${catalogClips.length} total).`);
    } else {
      setNotice(`All ${catalogClips.length} archival clip(s) from manuscript are already reconciled in Clip Bin.`);
    }
  };

  const syncClipsFromScript = syncClipsFromManuscript;

  const sendToMontage = () => {
    if (!data?.head) return;
    const c = compileScript(project, data.head, { clipAudioUrl: clipId => scriptApi.clipAudioUrl(project.id, clipId) });
    if (!c || !c.ok) {
      if (c?.blocked?.length) {
        alert(`Cannot send to Montage:\n${c.blocked.map(b => `• ${b.sceneTitle}: ${b.reason}`).join('\n')}`);
      }
      return;
    }
    if (montage.clips.length && !window.confirm(`Replace the ${montage.clips.length} clips on the Montage timeline with this script (${c.items.length} items)? Undo in Montage brings them back.`)) return;
    montage.replaceClips(c.items.map(i => i.item));
    setNotice(`Sent ${c.items.length} items to Montage Studio${c.markers.length ? `; ${c.markers.length} music markers listed` : ''}.`);
    onOpenMontage?.();
  };

  const finishEpisode = async () => {
    if (!data?.head) return;
    const c = compileScript(project, data.head, { clipAudioUrl: clipId => scriptApi.clipAudioUrl(project.id, clipId) });
    if (!c || !c.ok) {
      if (c?.blocked?.length) {
        alert(`Cannot finish episode:\n${c.blocked.map(b => `• ${b.sceneTitle}: ${b.reason}`).join('\n')}`);
      }
      return;
    }
    setNotice(null);
    setAudioProgress('Rendering and mastering audio...');
    try {
      const audioCtx = getSharedAudioContext();
      if (audioCtx.state === 'suspended') { try { await audioCtx.resume(); } catch { /* ignore */ } }
      const out = await renderCompiled(c.items, {
        audioCtx,
        fetchAudio: async url => {
          const src = (await getCachedAudioUrl(url)) || url;
          const res = await fetch(toFetchableUrl(src));
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.arrayBuffer();
        },
        onProgress: setAudioProgress,
      });
      setAudioProgress('Saving render manifest in project...');
      const manifest = buildManifest(project, data.head, c, Date.now(), out.renderedSec, out.measured);
      await scriptApi.saveRenderManifest(project.id, data.head.id, manifest);
      const saved = await scriptApi.uploadRender(project.id, data.head.id, out.wav);
      const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.round(Math.max(0, s) % 60)).padStart(2, '0')}`;
      setNotice(`Finished episode saved: ${mmss(saved.audio?.durationSec || out.totalSec)}, ${(saved.audio!.bytes / 1e6).toFixed(1)} MB, ${out.measured.integratedLufs} LUFS.`);
    } catch (e: any) {
      setError(e instanceof RenderError ? new Error(`Render stopped at block ${e.blockId}: ${e.message}`) : e);
    } finally {
      setAudioProgress(null);
    }
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
    <div id="script-studio" className="h-full flex flex-col bg-slate-950 text-slate-200 overflow-hidden relative font-sans">
      {/* Header */}
      <div className="border-b border-slate-800 px-4 py-2.5 flex flex-wrap items-center gap-2.5 shrink-0 bg-slate-950 z-20">
        <button className={btnGhost} onClick={() => { if (dirty && !window.confirm('Discard unsaved edits?')) return; setProjectId(null); setRunId(null); }}><ChevronLeft size={12} /> Projects</button>
        <input className={cx(input, 'w-60 font-semibold text-white')} value={project.title} onChange={e => setData(d => (d ? { ...d, project: { ...d.project, title: e.target.value } } : d))}
          onBlur={e => void scriptApi.updateProject(project.id, { title: e.target.value }).catch(setError)} />
        <select className={input} value={project.format || ''} onChange={e => void act('Saving format', () => scriptApi.updateProject(project.id, { format: e.target.value || null }))}>
          <option value="">Format: not set</option>
          {EPISODE_FORMATS.map(f => <option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}
        </select>
        <label className="text-xs text-slate-400 flex items-center gap-1">Target
          <input type="number" min={1} className={cx(input, 'w-16')} defaultValue={Math.round(project.targetRuntimeSec / 60)} key={project.targetRuntimeSec}
            onBlur={e => void act('Saving length', () => scriptApi.updateProject(project.id, { targetRuntimeSec: Math.max(1, Number(e.target.value) || 1) * 60 }))} /> min
        </label>
        {runtime && segments && (
          <span className={cx('text-xs font-mono font-medium', data?.gates?.runtimeOk ? 'text-emerald-400' : 'text-amber-400')}>
            Now {hms(runtime.sec)}
          </span>
        )}
        <div className="flex-1" />

        {/* Top Action Bar Group */}
        <button className={btnGhost} onClick={() => setShowRoles(s => !s)} title="Configure model providers and roles">
          Models: {roles.mode === 'subscription' ? 'sub' : `$${roles.maxUsd.toFixed(2)}`}
        </button>

        <button
          className={cx(btnGhost, drawerOpen === 'refine' && 'bg-indigo-950 border-indigo-500 text-indigo-300')}
          onClick={() => setDrawerOpen(d => (d === 'refine' ? null : 'refine'))}
          title="Open AI Refinement & Grok Bot Drawer"
        >
          <Wand2 size={12} className="text-indigo-400" />
          <span>Grok Pass &amp; Refine</span>
          {runActive && <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />}
        </button>

        <button
          className={cx(btnGhost, drawerOpen === 'versions' && 'bg-indigo-950 border-indigo-500 text-indigo-300')}
          onClick={() => setDrawerOpen(d => (d === 'versions' ? null : 'versions'))}
          title="Open Version History Drawer"
        >
          <History size={12} className="text-slate-400" />
          <span>Versions ({data?.versions.length || 0})</span>
        </button>

        <button className={btnGhost} onClick={() => setShowUploadVersionModal(true)} title="Upload a script file or paste text">
          <Upload size={12} /> Upload
        </button>

        <button className={btnPrimary} disabled={!dirty || !!busy} onClick={() => void save()}>
          <Save size={12} /> Save
        </button>
      </div>

      {showRoles && (
        <div className="border-b border-slate-800 px-4 py-2 flex flex-wrap items-center gap-3 text-xs bg-slate-900/60 shrink-0 z-10">
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
          <label className="flex items-center gap-1">Dollar cap <input type="number" min={0} step={0.05} className={cx(input, 'w-20')} value={roles.maxUsd} onChange={e => setRoles(r => ({ ...r, maxUsd: Math.max(0, Number(e.target.value) || 0) }))} /></label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={roles.episodePass !== false} onChange={e => setRoles(r => ({ ...r, episodePass: e.target.checked }))} /> Episode structure pass</label>
        </div>
      )}

      {(error || busy || audioProgress) && (
        <div className="px-4 pt-2 space-y-2 shrink-0 z-10">
          {busy && <div className="text-xs text-indigo-300 flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> {busy}…</div>}
          {audioProgress && <div className="text-xs text-teal-300 flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> {audioProgress}</div>}
          <ErrorBox error={error} onClose={() => setError(null)} />
        </div>
      )}

      {/* Main 2-Pane Work Area: Left Tabbed Column (30%) + Center Script Editor (70%) */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left Consolidated Panel: Top Tabs for Pipeline, Evidence, Transcripts */}
        <aside className="w-80 md:w-88 shrink-0 border-r border-slate-800 flex flex-col bg-slate-950 overflow-hidden">
          {/* Top Tabs */}
          <div className="border-b border-slate-800 bg-slate-950 px-2 pt-2 flex items-center gap-1 shrink-0 text-xs font-medium">
            <button
              className={cx('px-3 py-1.5 border-b-2 transition-colors', leftTab === 'pipeline' ? 'border-indigo-500 text-indigo-300 bg-indigo-950/20' : 'border-transparent text-slate-400 hover:text-slate-200')}
              onClick={() => setLeftTab('pipeline')}
            >
              Pipeline &amp; Stages
            </button>
            <button
              className={cx('px-3 py-1.5 border-b-2 transition-colors flex items-center gap-1.5', leftTab === 'evidence' ? 'border-indigo-500 text-indigo-300 bg-indigo-950/20' : 'border-transparent text-slate-400 hover:text-slate-200')}
              onClick={() => setLeftTab('evidence')}
            >
              <span>Evidence &amp; Context</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-800 text-slate-300 font-mono">
                {(project.evidenceDocs?.length || 0) + (project.sourceTags?.length || 0)}
              </span>
            </button>
            <button
              className={cx('px-3 py-1.5 border-b-2 transition-colors', leftTab === 'transcripts' ? 'border-indigo-500 text-indigo-300 bg-indigo-950/20' : 'border-transparent text-slate-400 hover:text-slate-200')}
              onClick={() => setLeftTab('transcripts')}
            >
              Source Transcripts
            </button>
          </div>

          {/* Tab 1: Pipeline & Stages */}
          {leftTab === 'pipeline' && (
            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              <div className="space-y-1.5">
                <div className="text-[11px] uppercase tracking-wide text-slate-500 font-bold">Pipeline Stages</div>
                <StageRow done={stage.analysis} label={project.sourceTags.length > 1 ? `Analyse ${project.sourceTags.length} recordings` : 'Analyse episode'} note={project.sourceTags.length > 1 ? `${project.sourceTags.filter(t => data?.analyses[t]).length} of ${project.sourceTags.length} analysed` : analysis ? `${analysis.moments.length} moments, ${analysis.themes.length} themes` : undefined}
                  action={<button className={btnGhost} disabled={!!busy} onClick={() => void act('Analysing recordings', async () => {
                    const r = await scriptApi.analyze(project.id, roles, stage.analysis);
                    if ('error' in r.tagging) setError(new ScriptApiError(0, r.tagging.code, `The analysis is saved, but clip tagging failed: ${r.tagging.error}`));
                  })}>{stage.analysis ? 'Re-run' : 'Run'}</button>} />
                <StageRow done={stage.outline} label="Outline" action={<button className={btnGhost} disabled={!!busy || !stage.analysis} onClick={() => void act('Outlining', () => scriptApi.outline(project.id, roles))}>{stage.outline ? 'New outline' : 'Run'}</button>} />
                <StageRow done={stage.draft} label="Draft narration and clips" action={<button className={btnGhost} disabled={!!busy || !stage.outline}
                  onClick={() => void act('Drafting each segment', async () => { const r = await scriptApi.draft(project.id, roles); setNotice(r.style.warning || (r.style.built ? "Built style card from archive." : null)); })}>Run</button>} />
                <StageRow done={run?.status === 'finished'} label="Refine &amp; Polish" note={run ? `${run.status.replace('_', ' ')}` : 'Use AI Refine in header.'} />
              </div>

              {notice && <div className="text-[11px] text-indigo-200 bg-indigo-950/40 p-2 rounded border border-indigo-900/50 flex items-start gap-1"><span className="flex-1">{notice}</span><button onClick={() => setNotice(null)}><X size={11} /></button></div>}

              {/* Clip Bin with Catalog Sync action */}
              <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
                <div className="flex items-center gap-1 justify-between">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 font-bold">Clip Bin ({project.clips.length})</div>
                  <div className="flex items-center gap-1">
                    <button className={btnGhost} onClick={syncClipsFromManuscript} title="Detect all canonical and inline archival tags in manuscript and reconcile with Clip Bin">
                      <FolderSync size={12} className="text-teal-400" /> Sync Clips
                    </button>
                    <button className={btnGhost} disabled={!!busy || !stage.analysis || !project.clips.length} title="Tag each clip with narrative function"
                      onClick={() => void act('Tagging clips', () => scriptApi.tagClips(project.id, roles, true))}>Tag</button>
                  </div>
                </div>
                {project.clips.length === 0 && <div className="text-[11px] text-slate-500 italic">No clips synced yet. Click "Sync Clips" to parse archival tape from manuscript.</div>}
                {[...NARRATIVE_FUNCTIONS, undefined].map(fn => {
                  const list = project.clips.filter(c => c.fn === fn);
                  if (!list.length) return null;
                  return (
                    <div key={fn || 'untagged'} className="space-y-1">
                      <div className="text-[10px] uppercase font-bold text-slate-400">{fn ? fn.replace('_', ' ') : 'untagged'} ({list.length})</div>
                      {list.map(c => (
                        <div key={c.clipId} className="flex items-center gap-1 text-[11px] text-slate-300 py-0.5" title={c.fnRationale ? `${c.fnRationale}\n\n${c.text}` : c.text}>
                          <span className="truncate flex-1">{c.title}</span>
                          <span className="text-slate-500 font-mono text-[10px]">{hms(c.durationSec)}</span>
                          <select className="bg-slate-950 border border-slate-800 rounded text-[10px] text-slate-400 max-w-[6rem]" value={c.fn || ''} title="Narrative function"
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
              </div>

              {analysis && (
                <details className="text-[11px] text-slate-300 pt-2 border-t border-slate-800/80" open={!stage.outline}>
                  <summary className="text-[11px] uppercase tracking-wide text-slate-500 cursor-pointer font-bold">Analysis Insights ({analysis.provider})</summary>
                  {analysis.themes.map(t => <div key={t.id} className="mt-1"><span className="text-indigo-300 font-medium">{t.label}:</span> {t.summary}</div>)}
                  {analysis.moments.map(m => (
                    <button key={m.id} className="block text-left mt-1 hover:text-white" onClick={() => { setQuery(''); setFocusTime(m.start); setLeftTab('transcripts'); }}>
                      <span className="text-slate-500 font-mono">{hms(m.start)} {m.kind}</span> {m.why}
                    </button>
                  ))}
                </details>
              )}
            </div>
          )}

          {/* Tab 2: Evidence & Context */}
          {leftTab === 'evidence' && (
            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              {data && <RecordingsPanel data={data} viewTag={tag} onView={setViewTag} act={act} episodes={episodes} />}
              {project.format === 'investigative' && <PaperTrailPanel projectId={project.id} sourceTags={project.sourceTags} act={act} />}
              <EvidencePanel project={project} onReload={() => void load(project.id)} act={act} />

              {stats && stats.unnamedShare > 0.2 && (
                <div className="rounded-md border border-amber-700/50 bg-amber-950/20 p-2.5 space-y-1.5">
                  <div className="text-[11px] text-amber-200 flex items-center gap-1"><AlertTriangle size={11} /> {Math.round(stats.unnamedShare * 100)}% of speech has no speaker name.</div>
                  {stats.topUnnamed.map(u => (
                    <label key={u.speaker} className="flex items-center gap-1 text-[11px] text-slate-300">{u.speaker} ({hms(u.sec)})
                      <input className={cx(input, 'flex-1')} placeholder="Name" value={renames[u.speaker] ?? names[u.speaker] ?? ''} onChange={e => setRenames(r => ({ ...r, [u.speaker]: e.target.value }))} />
                    </label>
                  ))}
                  <button className={btnGhost} onClick={() => void act('Saving names', () => scriptApi.updateProject(project.id, { speakerNames: { ...project.speakerNames, ...Object.fromEntries(Object.entries(renames).map(([raw, v]) => [renameKey(project.sourceTags.length, tag, raw), v])) } }).then(() => setRenames({})))}>Save names</button>
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Source Transcripts */}
          {leftTab === 'transcripts' && (
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wide text-slate-500 font-bold">Transcript</span>
                {project.sourceTags.length > 1 && (
                  <select className={input} value={tag} onChange={e => setViewTag(e.target.value)}>
                    {project.sourceTags.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                )}
              </div>
              <input className={cx(input, 'w-full')} placeholder="Search words or speaker..." value={query} onChange={e => { setQuery(e.target.value); setFocusTime(null); }} />
              <div className="text-[11px] text-slate-500">Click lines to select quote window and add as clip.</div>
              <ul className="space-y-0.5 max-h-96 overflow-y-auto">
                {searchRows.map(r => {
                  const i = Number(r.id.slice(1));
                  const inSel = sel.from != null && i >= sel.from && i <= (sel.to ?? sel.from);
                  const near = focusTime != null && r.start <= focusTime && r.end >= focusTime;
                  return (
                    <li key={r.id}>
                      <button onClick={() => pick(i)} className={cx('w-full text-left text-[11px] rounded px-1.5 py-1 transition-colors', inSel ? 'bg-indigo-900/50' : near ? 'bg-slate-800' : 'hover:bg-slate-900')}>
                        <span className="text-slate-500 font-mono">{hms(r.start)} </span>
                        <span className="text-indigo-300 font-semibold">{names[r.speaker] || r.speaker}: </span>
                        <span className="text-slate-300">{r.text}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {sel.from != null && (
                <div className="flex items-center gap-1.5 p-2 rounded bg-indigo-950/40 border border-indigo-900/60">
                  <button className={btnPrimary} onClick={() => void act('Adding clip', () => scriptApi.addClip(project.id, `u${sel.from}`, `u${sel.to ?? sel.from}`, tag)).then(() => setSel({}))}><Scissors size={12} /> Add u{sel.from}{sel.to != null ? `–u${sel.to}` : ''} as clip</button>
                  <button className="text-slate-400 hover:text-white" onClick={() => setSel({})}><X size={12} /></button>
                </div>
              )}
            </div>
          )}
        </aside>

        {/* Center Script Editor (55–65%+ Screen Width) */}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden bg-slate-950">
          {/* Main view: the script, the project's Evidence Board, or the shared Evidence Library */}
          <div className="shrink-0 border-b border-slate-800 px-4 pt-2 flex items-center gap-1 text-xs bg-slate-950" role="tablist" aria-label="Main view">
            {([['script', 'Script', FileText], ['board', 'Board', Star], ['library', 'Library', BookOpen]] as const).map(([key, label, Icon]) => (
              <button key={key} role="tab" aria-selected={mainView === key} onClick={() => setMainView(key)}
                className={cx('px-3 py-1.5 border-b-2 -mb-px transition-colors inline-flex items-center gap-1.5', mainView === key ? 'border-indigo-500 text-indigo-300' : 'border-transparent text-slate-400 hover:text-slate-200')}>
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>
          {mainView === 'board' && <ScriptBoard lib={lib} question={lib.board?.question || project.thesis || ''} onOpenLibrary={() => setMainView('library')} onListen={listenQuote} playingUrl={playingUrl} />}
          {mainView === 'library' && <QuoteLibrary lib={lib} projectId={project.id} onListen={listenQuote} playingUrl={playingUrl} />}
          {mainView === 'script' && (<>
          {/* Scene Navigator / Minimap Bar */}
          <div className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-4 py-2 flex items-center gap-2 overflow-x-auto text-xs shrink-0">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 shrink-0 flex items-center gap-1">
              <Layers size={13} className="text-indigo-400" /> Scenes ({allScenes.length}):
            </span>
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              {allScenes.map(sc => (
                <button
                  key={sc.id}
                  onClick={() => document.getElementById(`scene-${sc.id}`)?.scrollIntoView({ behavior: 'smooth' })}
                  className="px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 hover:border-indigo-500/60 hover:bg-slate-850 text-slate-300 hover:text-white shrink-0 flex items-center gap-1.5 transition-colors"
                >
                  <span className="truncate max-w-[140px] font-medium">{sc.title}</span>
                  <span className="text-[10px] font-mono text-slate-500 bg-slate-950 px-1 py-0.2 rounded border border-slate-800/80">
                    {hms(sceneRuntimes[sc.id] || 0)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Script Content Area */}
          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">
            <div className="flex items-center gap-2">
              <div className="text-sm text-slate-300 font-medium">
                {headVersion ? `${headVersion.label || 'Version'} · ${headVersion.author} · ${new Date(headVersion.createdAt).toLocaleTimeString()}` : 'No script loaded yet'}
              </div>
              <div className="flex-1" />
              {dirty && <span className="text-xs text-amber-300 font-medium px-2 py-0.5 rounded bg-amber-950/30 border border-amber-800/40">Unsaved edits</span>}
              <button
                className={btnGhost}
                disabled={!dirty}
                onClick={() => {
                  if (window.confirm('Discard all unsaved edits and revert to the saved version?')) {
                    setSegments(data?.head?.segments || null);
                    setDirty(false);
                    dirtyRef.current = false;
                  }
                }}
              >
                <RotateCcw size={12} /> Discard
              </button>
            </div>

            {data?.gates && (
              <div className="space-y-2">
                {data.gates.failures.length > 0 && (
                  <div className="rounded-md border border-rose-700/50 bg-rose-950/20 p-2.5 text-[11px] text-rose-200 space-y-0.5">
                    <div className="font-semibold text-rose-300">Quality Checks Blockers</div>
                    {data.gates.failures.map((f, i) => <div key={i}>• {f}</div>)}
                  </div>
                )}
                {data.gates.warnings && data.gates.warnings.length > 0 && (
                  <div className="rounded-md border border-amber-700/50 bg-amber-950/20 p-2.5 text-[11px] text-amber-200 space-y-0.5">
                    <div className="font-semibold text-amber-300 flex items-center gap-1">
                      <Check size={12} className="text-emerald-400" /> Quality Checks (Non-blocking Info)
                    </div>
                    {data.gates.warnings.map((w, i) => <div key={i}>• {w}</div>)}
                  </div>
                )}
                {data.gates.failures.length === 0 && (!data.gates.warnings || data.gates.warnings.length === 0) && (
                  <div className="text-[11px] text-emerald-400 flex items-center gap-1">
                    <Check size={12} /> Script verified: quotes verbatim, clip bounds verified, runtime in bounds.
                  </div>
                )}
              </div>
            )}

            {!segments && <div className="text-sm text-slate-500 py-12 text-center">Run the analysis and outline stages from the left panel to generate your documentary script.</div>}

            {/* Segments & Scenes */}
            {segments?.map((seg, segI) => (
              <section key={seg.id} className="space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-1.5">
                  <h2 className="text-base font-bold text-white tracking-tight">{seg.title}</h2>
                  <span className="text-xs text-slate-500">({seg.scenes.length} scenes)</span>
                </div>

                {seg.notDrafted && <div className="text-xs text-rose-300">Not drafted: {seg.notDrafted}</div>}

                {seg.scenes.map((sc, scI) => (
                  <div id={`scene-${sc.id}`} key={sc.id} className={cx(card, 'p-4 space-y-3 transition-all')}>
                    <div className="flex items-center gap-2 border-b border-slate-800/60 pb-2">
                      <button
                        onClick={() => toggleScene(sc.id)}
                        className="p-1 rounded text-slate-400 hover:text-white transition-colors"
                        title={collapsedScenes[sc.id] ? "Expand Scene" : "Collapse Scene"}
                      >
                        {collapsedScenes[sc.id] ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                      </button>
                      <h3 className="text-sm font-semibold text-white">{sc.title}</h3>
                      <span className="text-xs text-slate-400 flex-1 truncate">{sc.purpose}</span>
                      <span className="text-[11px] font-mono text-slate-400 px-2 py-0.5 rounded bg-slate-950 border border-slate-800">
                        {hms(sceneRuntimes[sc.id] || 0)}
                      </span>
                      {sc.blocks.some(b => b.kind === 'narration' && b.type !== 'QUOTE_READ') && (
                        <button
                          className="text-[11px] text-slate-400 hover:text-indigo-300 disabled:opacity-40"
                          disabled={dirty || preview.running}
                          title="Speak this scene's narration with Vox"
                          onClick={() => void preview.start(sc.id)}
                        >
                          Preview scene
                        </button>
                      )}
                    </div>

                    {!collapsedScenes[sc.id] && (
                      <div className="space-y-2.5">
                        {sc.blocks.length === 0 && <div className="text-xs text-slate-500 italic py-2">No blocks in this scene.</div>}
                        {sc.blocks.map((b, bI) => (
                          <BlockView
                            key={b.id}
                            block={b}
                            clip={b.kind === 'clip' ? clipsById[b.clipId] : undefined}
                            playing={player.current?.id === `script:${b.id}` && player.isPlaying}
                            onChange={nb => editBlock(segI, scI, bI, nb)}
                            onRemove={() => editBlock(segI, scI, bI, null)}
                            onMove={d => editBlock(segI, scI, bI, null, d)}
                            onPlay={() => (b.kind === 'clip' ? playClip(b) : b.kind === 'narration' ? playTake(b) : undefined)}
                            onClaim={t => { setQuery(''); setFocusTime(t); setLeftTab('transcripts'); }}
                            onSavePassage={text => { void scriptApi.savePassage(project.id, text).then(() => setNotice('Saved as a voice example.')).catch(setError); }}
                          />
                        ))}
                        <div className="flex items-center gap-2 pt-1">
                          <button className={btnGhost} onClick={() => addNarration(segI, scI)}><Plus size={12} /> Narration</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </section>
            ))}
          </div>

          {/* Sticky Bottom Control Bar for Audio Actions */}
          <div className="sticky bottom-0 bg-slate-900/95 backdrop-blur border-t border-slate-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-2xl z-20 shrink-0">
            <div className="flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">Runtime:</span>
                <span className={cx('font-semibold font-mono', data?.gates?.runtimeOk ? 'text-emerald-400' : 'text-amber-400')}>
                  {runtime ? hms(runtime.sec) : '0:00'}
                </span>
                <span className="text-slate-500">/ {Math.round(project.targetRuntimeSec / 60)} min target</span>
              </div>
              <div className="h-4 w-px bg-slate-800" />
              <div className="text-slate-300 flex items-center gap-1">
                <Mic size={12} className="text-indigo-400" />
                <span>{takesCount.withTake} of {takesCount.narration} narration lines have Vox take</span>
              </div>
              {preview.running && (
                <span className="inline-flex items-center gap-1 text-indigo-300 font-medium animate-pulse">
                  <Loader2 size={12} className="animate-spin" /> Previewing audio...
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {preview.running ? (
                <button className={btnGhost} onClick={() => void preview.cancel()}><Square size={12} /> Stop Preview</button>
              ) : (
                <button className={btnGhost} disabled={!data?.head || dirty || !takesCount.narration} onClick={() => void preview.start()} title="Preview all narration with Vox">
                  <Mic size={12} /> Preview audio
                </button>
              )}
              <button className={btnGhost} disabled={!data?.head || dirty} onClick={sendToMontage} title="Send compiled script to Montage Studio timeline">
                <Film size={12} /> Send to Montage
              </button>
              <button className={btnGhost} disabled={!data?.head || dirty || !!audioProgress} onClick={finishEpisode} title="Render and master final audio episode">
                <Disc size={12} /> Finish episode
              </button>
              <button className={btnPrimary} disabled={!dirty || !!busy} onClick={() => void save()}>
                <Save size={12} /> Save version
              </button>
            </div>
          </div>
          </>)}
        </main>
      </div>

      <UploadVersionModal isOpen={showUploadVersionModal} onClose={() => setShowUploadVersionModal(false)} projectId={project.id} onUploaded={() => void load(project.id)} />

      {/* On-Demand Slide-Over Drawer for Grok Bot Deep Pass, Refine & Versioning */}
      {drawerOpen && (
        <div className="fixed inset-y-0 right-0 w-[500px] max-w-[95vw] z-50 bg-slate-900 border-l border-slate-700 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between bg-slate-950 shrink-0">
            <div className="flex items-center gap-1.5">
              <button
                className={cx(btn, drawerOpen === 'refine' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-300')}
                onClick={() => setDrawerOpen('refine')}
              >
                <Wand2 size={12} /> Grok Pass &amp; Refine
              </button>
              <button
                className={cx(btn, drawerOpen === 'versions' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-300')}
                onClick={() => setDrawerOpen('versions')}
              >
                <History size={12} /> Versions ({data?.versions.length || 0})
              </button>
            </div>
            <button onClick={() => setDrawerOpen(null)} className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors" title="Close drawer">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
            {drawerOpen === 'refine' && (
              <>
                {/* Refinement Run Status */}
                {run && (
                  <div className="space-y-2 p-3 rounded-md border border-slate-800 bg-slate-950">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500 font-bold">Active Refinement Run</div>
                    <div className="text-slate-300 flex items-center gap-2">
                      <span className={cx(run.status === 'running' && 'text-indigo-300 font-semibold', run.status === 'finished' && 'text-emerald-300 font-semibold')}>
                        Status: {run.status.replace('_', ' ')}
                      </span>
                      <span>· Round {run.currentRound + 1} of {run.maxRounds}</span>
                    </div>
                    {run.pausedInfo && (
                      <div className="rounded border border-amber-700/50 bg-amber-950/20 p-2 space-y-1 text-amber-200">
                        <div>Paused: {run.pausedInfo.role} on {run.pausedInfo.provider}: {run.pausedInfo.code}</div>
                        <ResumeControls status={status} run={run} onResume={(sw, cap) => void act('Resuming', async () => { await scriptApi.resume(project.id, run.id, sw, cap); setRunId(null); setTimeout(() => setRunId(run.id), 0); })} />
                      </div>
                    )}
                    <button className={btnGhost} onClick={() => logEntries ? setLogEntries(null) : void scriptApi.log(run.id).then(r => setLogEntries(r.entries)).catch(setError)}>{logEntries ? 'Hide call log' : 'Show call log'}</button>
                    {logEntries && <LogTable entries={logEntries} />}
                    <ol className="space-y-0.5 max-h-48 overflow-y-auto pt-1">
                      {events.map(e => (
                        <li key={e.seq} className={cx('text-[11px]', e.type === 'error' ? 'text-rose-300' : e.type === 'judge' || e.type === 'decision' ? 'text-indigo-200' : 'text-slate-400')}>
                          <span className="text-slate-600">{new Date(e.at).toLocaleTimeString()} </span>{e.message}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {/* Grok Bot Deep Pass Panel */}
                <HandoffPanel projectId={project.id} headVersionId={project.headVersionId} sourceTags={project.sourceTags} act={act} dirty={dirty} DiffView={DiffList} />

                {/* Candidates & Critiques */}
                {critiques && critiques.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500 font-bold">Latest Critiques</div>
                    {critiques.map((c: any) => (
                      <div key={c.id} className="rounded border border-slate-800 p-2 space-y-1">
                        <div className={cx('font-medium', c.severity === 'blocker' ? 'text-rose-300' : c.severity === 'major' ? 'text-amber-300' : 'text-slate-300')}>{c.severity} · {c.criterion}</div>
                        <div className="text-slate-300">{c.issue}</div>
                        <div className="text-slate-400">Fix: {c.proposedFix}</div>
                      </div>
                    ))}
                  </div>
                )}

                {runInfo && runInfo.candidates.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500 font-bold">Candidates ({runInfo.candidates.length})</div>
                    {runInfo.candidates.map(c => {
                      const d = c.decision;
                      return (
                        <div key={c.id} className={cx('rounded-md border p-2.5 space-y-1.5', d?.loopAccepted ? 'border-emerald-700/60' : 'border-slate-800')}>
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-slate-100">{c.id}</span>
                            {d?.loopAccepted && <span className="text-emerald-300">· loop accepted</span>}
                            {d?.loganDecision && <span className="text-indigo-300">· you: {d.loganDecision}</span>}
                          </div>
                          <DiffList diff={c.diff} />
                          {!d?.loganDecision && (
                            <div className="flex gap-1.5 pt-1">
                              <button className={btnPrimary} disabled={dirty} onClick={() => void act('Accepting', () => scriptApi.decide(project.id, c.id, 'accept', '', roles))}><Check size={12} /> Accept</button>
                              <button className={btnGhost} onClick={() => { const reason = window.prompt('Why reject it? (saved to editorial memory, optional)') ?? ''; void act('Rejecting', () => scriptApi.decide(project.id, c.id, 'reject', reason, roles)); }}><CircleSlash size={12} /> Reject</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {drawerOpen === 'versions' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 font-bold flex items-center gap-1"><History size={12} /> Script Versions</div>
                  <a className={btnGhost} href={scriptApi.exportUrl(project.id)} download={`script-project-${project.id}.json`}><Download size={12} /> Export JSON</a>
                </div>
                <div className="space-y-1">
                  {[...(data?.versions || [])].reverse().map(v => (
                    <div key={v.id} className={cx('flex items-center gap-1.5 rounded p-2 border transition-colors', v.id === project.headVersionId ? 'border-indigo-500/60 bg-indigo-950/20' : 'border-slate-800 bg-slate-950')}>
                      <button className="flex-1 text-left truncate text-slate-300 hover:text-white" onClick={() => void scriptApi.version(project.id, v.id).then(r => setViewVersion({ id: v.id, diff: r.diff })).catch(setError)}>
                        <span className="font-semibold text-white">{v.label || v.author}</span>
                        <span className="text-slate-500 text-[10px] ml-2">{new Date(v.createdAt).toLocaleTimeString()}</span>
                      </button>
                      {v.id !== project.headVersionId && (
                        <button className={btnGhost} title="Make this the current version" onClick={() => void act('Rolling back', () => scriptApi.setHead(project.id, v.id))}><RotateCcw size={11} /> Rollback</button>
                      )}
                    </div>
                  ))}
                </div>
                {viewVersion && (
                  <div className="rounded border border-slate-700 bg-slate-950 p-2.5 space-y-1">
                    <div className="flex items-center text-slate-300 font-semibold">Changes in {viewVersion.id} vs parent <div className="flex-1" /><button onClick={() => setViewVersion(null)}><X size={12} /></button></div>
                    <DiffList diff={viewVersion.diff as any} />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
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
