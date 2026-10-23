import React, { useState, useRef, useEffect } from 'react';
import {
  AlertCircle,
  Calendar,
  CheckCircle,
  Clock,
  FileAudio,
  FileText,
  History,
  Link2,
  ListPlus,
  Loader,
  Play,
  Radio,
  Sparkles,
  Tag,
  Trash2,
  UploadCloud,
  Users,
} from 'lucide-react';
import { EnhancedConfig } from '../types';
import {
  appendLineToRepositoryTextFile,
  createOrUpdateRelease,
  dispatchWorkflow,
  uploadReleaseAsset,
} from '../utils/github';
import {
  buildLocalReleasePayload,
  friendlyGitHubError,
  LocalAudioMetadata,
  probeBrowserAudioDuration,
  SubmitAction,
  validateLocalUpload,
  validateSubmission,
} from '../utils/submitSpace';

interface Props {
  config: EnhancedConfig;
  onViewRunHistory: () => void;
  onDispatched?: (url: string) => void;
}

type Action = SubmitAction;
type Notice = { kind: 'success' | 'error'; message: string; action?: Action } | null;
type IngestMode = 'url' | 'file';

const KNOWN_SPEAKER_CHIPS = ['Logan Black', 'Angela', 'Oor', 'Eric Hecker', 'Mary', 'Shane', 'Rick Doty'];

function formatTodayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function cleanTitleFromFilename(filename: string): string {
  return filename
    .replace(/\.[^/.]+$/, '')
    .replace(/^\d{8}_[A-Za-z0-9_-]+_/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SubmitSpacePanel: React.FC<Props> = ({ config, onViewRunHistory, onDispatched }) => {
  const [mode, setMode] = useState<IngestMode>('url');

  // URL mode state
  const [url, setUrl] = useState('');
  const [recordLive, setRecordLive] = useState(false);

  // Local file upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewAudioUrl, setPreviewAudioUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [probingDuration, setProbingDuration] = useState(false);
  const [uploadStepText, setUploadStepText] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [meta, setMeta] = useState<LocalAudioMetadata>({
    title: '',
    speakers: config.authorName || 'Logan Black',
    recordedDate: formatTodayIso(),
    description: '',
    durationFormatted: '00:00:00',
  });

  const [activeAction, setActiveAction] = useState<Action | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    return () => {
      if (previewAudioUrl) URL.revokeObjectURL(previewAudioUrl);
    };
  }, [previewAudioUrl]);

  const handleSelectFile = async (file: File | null) => {
    if (!file) return;
    setSelectedFile(file);
    if (notice) setNotice(null);

    if (previewAudioUrl) URL.revokeObjectURL(previewAudioUrl);
    const objUrl = URL.createObjectURL(file);
    setPreviewAudioUrl(objUrl);

    // Derive default title and date from file if not edited yet
    const inferredTitle = cleanTitleFromFilename(file.name);
    let inferredDate = meta.recordedDate || formatTodayIso();
    if (file.lastModified) {
      const d = new Date(file.lastModified);
      if (!isNaN(d.getTime())) {
        inferredDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
    }

    setMeta(prev => ({
      ...prev,
      title: prev.title.trim() ? prev.title : inferredTitle,
      recordedDate: inferredDate,
      speakers: prev.speakers.trim() ? prev.speakers : (config.authorName || 'Logan Black'),
    }));

    setProbingDuration(true);
    try {
      const dur = await probeBrowserAudioDuration(file);
      setMeta(prev => ({ ...prev, durationFormatted: dur }));
    } finally {
      setProbingDuration(false);
    }
  };

  const handleClearFile = () => {
    setSelectedFile(null);
    if (previewAudioUrl) URL.revokeObjectURL(previewAudioUrl);
    setPreviewAudioUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setMeta(prev => ({ ...prev, durationFormatted: '00:00:00' }));
  };

  const toggleSpeakerChip = (speaker: string) => {
    const currentList = meta.speakers
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const exists = currentList.some(s => s.toLowerCase() === speaker.toLowerCase());
    const nextList = exists
      ? currentList.filter(s => s.toLowerCase() !== speaker.toLowerCase())
      : [...currentList, speaker];
    setMeta(prev => ({ ...prev, speakers: nextList.join(', ') }));
  };

  const submitUrl = async (action: Action) => {
    const trimmedUrl = url.trim();
    const validationError = validateSubmission(trimmedUrl, config);
    if (validationError) {
      setNotice({ kind: 'error', message: validationError, action });
      return;
    }

    setActiveAction(action);
    setNotice(null);
    try {
      if (action === 'run') {
        await dispatchWorkflow(
          config.githubToken,
          config.ownerName,
          config.repoName,
          'ingest.yml',
          {
            space_url: trimmedUrl,
            ...(recordLive ? { record_live: 'true' } : {}),
          }
        );
        onDispatched?.(trimmedUrl);
        setNotice({
          kind: 'success',
          message: recordLive
            ? 'Workflow dispatched: capturing active live stream.'
            : 'Workflow started successfully.',
          action,
        });
      } else {
        await appendLineToRepositoryTextFile(
          config.githubToken,
          config.ownerName,
          config.repoName,
          'batch_queue.txt',
          trimmedUrl,
          'chore(queue): enqueue space'
        );
        setNotice({ kind: 'success', message: 'Space added to the queue.', action });
      }
      setUrl('');
      setRecordLive(false);
    } catch (error) {
      setNotice({ kind: 'error', message: friendlyGitHubError(error, action), action });
    } finally {
      setActiveAction(null);
    }
  };

  const submitLocalUpload = async () => {
    const validationError = validateLocalUpload(selectedFile, meta, config);
    if (validationError || !selectedFile) {
      setNotice({ kind: 'error', message: validationError || 'Select an audio file first.', action: 'upload' });
      return;
    }

    setActiveAction('upload');
    setNotice(null);
    const owner = config.ownerName.trim();
    const repo = config.repoName.trim();

    try {
      const payload = buildLocalReleasePayload(selectedFile, meta);

      // 1. Stage GitHub Release with structured metadata body
      setUploadStepText(`Staging GitHub Release (${payload.releaseTag})…`);
      const release = await createOrUpdateRelease(config.githubToken, owner, repo, {
        tag_name: payload.releaseTag,
        name: payload.releaseName,
        body: payload.releaseBody,
        draft: false,
        prerelease: false,
      });

      // 2. Upload binary audio file to the staged Release
      setUploadStepText(`Uploading ${selectedFile.name} (${formatFileSize(selectedFile.size)}) to Release…`);
      await uploadReleaseAsset(
        config.githubToken,
        owner,
        repo,
        release.id,
        payload.assetName,
        selectedFile,
        payload.contentType,
        release.assets
      );

      // 3. Dispatch ingest.yml with release_tag so it runs through the exact same pipeline
      setUploadStepText(`Dispatching processing pipeline for ${payload.releaseTag}…`);
      await dispatchWorkflow(
        config.githubToken,
        owner,
        repo,
        'ingest.yml',
        {
          release_tag: payload.releaseTag,
        }
      );

      onDispatched?.(payload.releaseTag);
      setNotice({
        kind: 'success',
        message: `Uploaded "${payload.releaseName}" (${payload.releaseTag}) and started the processing pipeline (audio normalization, cloud GPU transcription, clip extraction, and RSS feed update).`,
        action: 'upload',
      });

      handleClearFile();
      setMeta(prev => ({
        ...prev,
        title: '',
        description: '',
        durationFormatted: '00:00:00',
      }));
    } catch (error) {
      setNotice({ kind: 'error', message: friendlyGitHubError(error, 'upload'), action: 'upload' });
    } finally {
      setActiveAction(null);
      setUploadStepText('');
    }
  };

  const isLoading = activeAction !== null;
  const stagedPreview = selectedFile && meta.title.trim() && /^\d{4}-\d{2}-\d{2}$/.test(meta.recordedDate)
    ? buildLocalReleasePayload(selectedFile, meta)
    : null;

  return (
    <div className="h-full overflow-y-auto p-6 md:p-12 max-w-3xl mx-auto w-full pb-24">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-indigo-500/15 border border-indigo-500/20 rounded-xl">
            <Radio size={18} className="text-indigo-400" />
          </div>
          <h2 className="text-2xl font-bold text-white">Submit New Episode</h2>
        </div>
        <p className="text-slate-400 text-sm">
          Ingest a Space/audio link or upload a local audio file from your computer into the episode library.
        </p>
      </div>

      {/* Mode Switcher Tabs */}
      <div className="grid grid-cols-2 gap-2 p-1.5 bg-slate-900/90 border border-slate-800 rounded-xl mb-6">
        <button
          type="button"
          onClick={() => {
            setMode('url');
            if (notice) setNotice(null);
          }}
          disabled={isLoading}
          className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            mode === 'url'
              ? 'bg-indigo-600 text-white shadow-lg'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Link2 size={15} />
          Space or Audio URL
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('file');
            if (notice) setNotice(null);
          }}
          disabled={isLoading}
          className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            mode === 'file'
              ? 'bg-indigo-600 text-white shadow-lg'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <UploadCloud size={15} />
          Upload Local Audio File
        </button>
      </div>

      <div className="space-y-5">
        {mode === 'url' ? (
          <>
            <section className="p-5 md:p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
              <div>
                <label htmlFor="space-url" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Space or audio URL
                </label>
                <input
                  id="space-url"
                  type="url"
                  value={url}
                  onChange={event => {
                    setUrl(event.target.value);
                    if (notice) setNotice(null);
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && !isLoading) void submitUrl('run');
                  }}
                  placeholder="https://x.com/i/spaces/..."
                  disabled={isLoading}
                  autoComplete="url"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-sm text-white font-mono placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60 transition-colors"
                />
                <p className="mt-2 text-[11px] text-slate-400">
                  Supports X Spaces and other audio URLs handled by your ingest workflow.
                </p>
              </div>

              <div className={`p-3.5 rounded-lg border transition-all ${
                recordLive
                  ? 'bg-rose-500/10 border-rose-500/30 ring-1 ring-rose-500/20'
                  : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700'
              }`}>
                <label className="flex items-start gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={recordLive}
                    onChange={e => setRecordLive(e.target.checked)}
                    disabled={isLoading}
                    className="mt-0.5 h-4 w-4 rounded border-slate-700 bg-slate-900 text-rose-500 focus:ring-rose-500/20 focus:ring-offset-0 cursor-pointer"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Radio size={14} className={recordLive ? 'text-rose-400 animate-pulse' : 'text-slate-400'} />
                      <span className={`text-xs font-semibold ${recordLive ? 'text-rose-300' : 'text-slate-300'}`}>
                        Record Live Broadcast (Space currently in progress)
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                      Automated pipelines only ingest completed replays. Check this option only if the Space is actively broadcasting right now and you want to manually record it live.
                    </p>
                  </div>
                </label>
              </div>
            </section>

            <div className="grid md:grid-cols-2 gap-3">
              <section className={`flex flex-col p-5 border rounded-xl transition-all ${
                recordLive
                  ? 'bg-rose-500/[0.08] border-rose-500/30'
                  : 'bg-indigo-500/[0.07] border-indigo-500/25'
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  {recordLive ? <Radio size={16} className="text-rose-400 animate-pulse" /> : <Play size={16} className="text-indigo-400" />}
                  <h3 className="text-sm font-semibold text-white">
                    {recordLive ? 'Record Live Stream Now' : 'Run Now'}
                  </h3>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed mb-5 flex-1">
                  {recordLive
                    ? 'Hooks into the active live stream on GitHub Actions and records until the broadcast concludes.'
                    : 'Starts this Space immediately by dispatching the ingest workflow. The queue is not changed.'}
                </p>
                <button
                  type="button"
                  onClick={() => void submitUrl('run')}
                  disabled={isLoading}
                  className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 text-white text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed ${
                    recordLive
                      ? 'bg-rose-600 hover:bg-rose-500 focus:ring-rose-400'
                      : 'bg-indigo-600 hover:bg-indigo-500 focus:ring-indigo-400'
                  }`}
                >
                  {activeAction === 'run' ? (
                    <Loader size={16} className="animate-spin" />
                  ) : recordLive ? (
                    <Radio size={16} className="animate-pulse" />
                  ) : (
                    <Play size={16} />
                  )}
                  {activeAction === 'run'
                    ? (recordLive ? 'Connecting to Stream…' : 'Starting…')
                    : (recordLive ? 'Record Live Now' : 'Run Now')}
                </button>
              </section>

              <section className={`flex flex-col p-5 border rounded-xl transition-all ${
                recordLive
                  ? 'bg-slate-900/40 border-slate-800 opacity-60'
                  : 'bg-slate-500/[0.05] border-slate-500/20'
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  <ListPlus size={16} className="text-slate-300" />
                  <h3 className="text-sm font-semibold text-white">Add to Queue</h3>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed mb-4 flex-1">
                  Adds this Space to the bottom of <code className="text-slate-300">batch_queue.txt</code> without removing existing URLs.
                </p>
                {recordLive && (
                  <p className="text-[11px] text-amber-400/90 mb-3">
                    ⚠️ Live streams must be captured immediately and cannot be queued for batch processing.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => void submitUrl('queue')}
                  disabled={isLoading || recordLive}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:ring-offset-slate-900"
                >
                  {activeAction === 'queue' ? <Loader size={16} className="animate-spin" /> : <ListPlus size={16} />}
                  {activeAction === 'queue' ? 'Adding…' : 'Add to Queue'}
                </button>
              </section>
            </div>
          </>
        ) : (
          <>
            {/* Local Audio File Selection */}
            <section className="p-5 md:p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-5">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  1. Select Local Audio File
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,.mp3,.m4a,.wav,.flac,.ogg,.aac,.mp4,.webm"
                  onChange={e => {
                    const f = e.target.files?.[0] || null;
                    void handleSelectFile(f);
                  }}
                  disabled={isLoading}
                  className="hidden"
                />

                {!selectedFile ? (
                  <div
                    onDragOver={e => {
                      e.preventDefault();
                      if (!isLoading) setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={e => {
                      e.preventDefault();
                      setDragOver(false);
                      if (isLoading) return;
                      const f = e.dataTransfer.files?.[0] || null;
                      void handleSelectFile(f);
                    }}
                    onClick={() => !isLoading && fileInputRef.current?.click()}
                    className={`flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-xl cursor-pointer transition-all ${
                      dragOver
                        ? 'border-indigo-400 bg-indigo-500/10'
                        : 'border-slate-700/80 bg-slate-950/60 hover:border-indigo-500/50 hover:bg-slate-950'
                    }`}
                  >
                    <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl mb-3 text-indigo-400">
                      <UploadCloud size={26} />
                    </div>
                    <p className="text-sm font-semibold text-slate-200 mb-1">
                      Click to browse or drag and drop an audio file
                    </p>
                    <p className="text-xs text-slate-400">
                      Supports MP3, M4A, WAV, FLAC, OGG, AAC, MP4 (up to 2 GB via GitHub Releases)
                    </p>
                  </div>
                ) : (
                  <div className="p-4 bg-slate-950 border border-indigo-500/30 rounded-xl space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2.5 bg-indigo-500/15 border border-indigo-500/25 rounded-xl text-indigo-400 flex-shrink-0">
                          <FileAudio size={20} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-white truncate">{selectedFile.name}</p>
                          <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-slate-400">
                            <span>{formatFileSize(selectedFile.size)}</span>
                            <span>•</span>
                            <span className="inline-flex items-center gap-1 text-indigo-300 font-mono">
                              <Clock size={11} />
                              {probingDuration ? 'Reading duration…' : meta.durationFormatted || '00:00:00'}
                            </span>
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleClearFile}
                        disabled={isLoading}
                        className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                        title="Remove file"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>

                    {previewAudioUrl && (
                      <audio
                        controls
                        src={previewAudioUrl}
                        className="w-full h-9 rounded-lg"
                      />
                    )}
                  </div>
                )}
              </div>

              {/* Metadata Form */}
              <div className="pt-2 border-t border-slate-800/80 space-y-4">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                    2. Episode Metadata
                  </label>
                  <span className="text-[11px] text-slate-400">
                    Required for RSS feed, Library sorting &amp; AI Speaker Diarization
                  </span>
                </div>

                <div className="grid md:grid-cols-3 gap-4">
                  <div className="md:col-span-2 space-y-1.5">
                    <label htmlFor="local-title" className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                      <FileText size={13} className="text-indigo-400" />
                      Episode Title <span className="text-rose-400">*</span>
                    </label>
                    <input
                      id="local-title"
                      type="text"
                      value={meta.title}
                      onChange={e => {
                        setMeta(prev => ({ ...prev, title: e.target.value }));
                        if (notice) setNotice(null);
                      }}
                      placeholder="e.g. Late Night Debrief on Space Operations"
                      disabled={isLoading}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="local-date" className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                      <Calendar size={13} className="text-indigo-400" />
                      Recording Date <span className="text-rose-400">*</span>
                    </label>
                    <input
                      id="local-date"
                      type="date"
                      value={meta.recordedDate}
                      onChange={e => {
                        setMeta(prev => ({ ...prev, recordedDate: e.target.value }));
                        if (notice) setNotice(null);
                      }}
                      disabled={isLoading}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label htmlFor="local-speakers" className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                    <Users size={13} className="text-indigo-400" />
                    Host / Speakers <span className="text-rose-400">*</span>
                  </label>
                  <input
                    id="local-speakers"
                    type="text"
                    value={meta.speakers}
                    onChange={e => {
                      setMeta(prev => ({ ...prev, speakers: e.target.value }));
                      if (notice) setNotice(null);
                    }}
                    placeholder="e.g. Logan Black, Angela, Rick Doty"
                    disabled={isLoading}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span className="text-[11px] text-slate-400 mr-1">Quick toggle:</span>
                    {KNOWN_SPEAKER_CHIPS.map(spk => {
                      const active = meta.speakers
                        .split(',')
                        .map(s => s.trim().toLowerCase())
                        .includes(spk.toLowerCase());
                      return (
                        <button
                          key={spk}
                          type="button"
                          onClick={() => toggleSpeakerChip(spk)}
                          disabled={isLoading}
                          className={`px-2 py-0.5 rounded-md text-[11px] font-medium border transition-all cursor-pointer ${
                            active
                              ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                              : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-slate-300'
                          }`}
                        >
                          {active ? `✓ ${spk}` : `+ ${spk}`}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="local-desc" className="block text-xs font-semibold text-slate-300">
                    Description / Episode Notes <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <textarea
                    id="local-desc"
                    rows={3}
                    value={meta.description}
                    onChange={e => setMeta(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Add context, topics discussed, or show notes for the podcast RSS feed..."
                    disabled={isLoading}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors resize-y"
                  />
                </div>

                {stagedPreview && (
                  <div className="p-3.5 bg-slate-950/90 border border-slate-800 rounded-xl flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 text-slate-400">
                      <Tag size={13} className="text-indigo-400 flex-shrink-0" />
                      <span>Release Tag:</span>
                      <code className="text-indigo-300 font-mono bg-indigo-500/10 px-2 py-0.5 rounded">
                        {stagedPreview.releaseTag}
                      </code>
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono truncate max-w-xs">
                      {stagedPreview.assetName}
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* Upload Action Card */}
            <section className="p-5 border bg-indigo-500/[0.07] border-indigo-500/25 rounded-xl space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Sparkles size={16} className="text-indigo-400" />
                    <h3 className="text-sm font-semibold text-white">
                      Stage Release &amp; Run Full Processing Pipeline
                    </h3>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Uploads your audio file to a new GitHub Release with structured metadata, then triggers{' '}
                    <code className="text-indigo-300">ingest.yml</code> to normalize MP3 audio, run neural speaker diarization &amp; transcription, extract highlight clips, and update your RSS feeds.
                  </p>
                </div>
              </div>

              {isLoading && uploadStepText && (
                <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-slate-950/80 border border-indigo-500/30 rounded-lg text-xs text-indigo-300">
                  <Loader size={14} className="animate-spin flex-shrink-0 text-indigo-400" />
                  <span>{uploadStepText}</span>
                </div>
              )}

              <button
                type="button"
                onClick={() => void submitLocalUpload()}
                disabled={isLoading || !selectedFile}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg shadow-lg transition-all focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {activeAction === 'upload' ? (
                  <Loader size={16} className="animate-spin" />
                ) : (
                  <UploadCloud size={16} />
                )}
                {activeAction === 'upload'
                  ? 'Uploading & Dispatching Pipeline…'
                  : 'Upload Audio & Start Pipeline'}
              </button>
            </section>
          </>
        )}

        {notice && (
          <div
            aria-live="polite"
            className={`flex items-start gap-3 p-4 border rounded-xl ${
              notice.kind === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30'
                : 'bg-rose-500/10 border-rose-500/30'
            }`}
          >
            {notice.kind === 'success'
              ? <CheckCircle size={17} className="text-emerald-400 flex-shrink-0 mt-0.5" />
              : <AlertCircle size={17} className="text-rose-400 flex-shrink-0 mt-0.5" />}
            <div className="flex-1 min-w-0">
              <p className={`text-sm ${notice.kind === 'success' ? 'text-emerald-300' : 'text-rose-300'}`}>
                {notice.message}
              </p>
              {notice.kind === 'success' && (notice.action === 'run' || notice.action === 'upload') && (
                <button
                  type="button"
                  onClick={onViewRunHistory}
                  className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors focus:outline-none focus:underline cursor-pointer"
                >
                  <History size={13} />
                  View Run History
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SubmitSpacePanel;
