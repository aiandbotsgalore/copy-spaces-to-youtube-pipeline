import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { Release, VoiceSample } from '../../types';
import { getEpisodeRecordedDate } from '../../utils/dates';
import { pickAudioMp3Asset } from '../../utils/transcriptData';
import { formatVoiceTimestamp, parseVoiceTimestamp, searchVoiceEpisodes } from '../../utils/voiceProfiles';

export const voiceButton = 'rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50';
export const voicePrimary = 'rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50';
export const voiceInput = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100';

export function VoiceDialog({ title, children, onClose, busy }: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const heading = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog ref={dialog} aria-labelledby={heading}
      onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 text-slate-100 shadow-2xl backdrop:bg-slate-950/80 sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 id={heading} className="text-lg font-semibold">{title}</h2>
        <button type="button" aria-label="Close" className="rounded p-1 text-slate-300 hover:bg-slate-800" onClick={onClose} disabled={busy}><X size={18} /></button>
      </div>
      {children}
    </dialog>
  );
}

export function VoiceClipPlayer({ url, start = 0, end, audioRef, label = 'Voice sample', onDuration, onUnavailable, onPosition, previewEnd }: {
  url: string;
  start?: number;
  end?: number;
  audioRef?: React.Ref<HTMLAudioElement>;
  label?: string;
  onDuration?: (seconds: number) => void;
  onUnavailable?: () => void;
  onPosition?: (seconds: number) => void;
  previewEnd?: React.RefObject<number | null>;
}) {
  const [playbackError, setPlaybackError] = useState('');
  return (
    <div className="space-y-1">
      <audio ref={audioRef} className="h-10 w-full" aria-label={label} controls preload="metadata" src={url}
        onLoadedMetadata={event => {
          const audio = event.currentTarget;
          if (start > 0 && start < audio.duration) audio.currentTime = start;
          if (Number.isFinite(audio.duration)) onDuration?.(audio.duration);
        }}
        onTimeUpdate={event => {
          const audio = event.currentTarget;
          onPosition?.(audio.currentTime);
          if (audio.paused || audio.seeking) return;
          if (audio.currentTime + 0.1 < start) {
            audio.pause();
            setPlaybackError('This recording couldn’t jump to the selected start.');
          }
          const stop = previewEnd?.current ?? end;
          if (stop !== undefined && audio.currentTime >= stop) {
            if (previewEnd) previewEnd.current = null;
            audio.pause();
          }
        }}
        onPlay={event => {
          const audio = event.currentTarget;
          setPlaybackError('');
          if (audio.currentTime < start || (end !== undefined && audio.currentTime >= end)) audio.currentTime = start;
        }}
        onError={() => {
          setPlaybackError('This audio couldn’t be played.');
          onUnavailable?.();
        }} />
      {playbackError && <p role="status" className="text-xs text-amber-300">{playbackError}</p>}
    </div>
  );
}

interface EditorProps {
  name: string;
  episodes: Release[];
  episodesLoading: boolean;
  resolveUrl: (url: string) => string;
  canUpload: boolean;
  sample?: VoiceSample;
  suggested?: VoiceSample;
  onUpload: (file: File) => Promise<string>;
  onSave: (sample: VoiceSample) => void;
  onClose: () => void;
}

export function VoiceSampleEditor({ name, episodes, episodesLoading, resolveUrl, canUpload, sample, suggested, onUpload, onSave, onClose }: EditorProps) {
  const [mode, setMode] = useState<'episode' | 'file' | 'link'>(suggested || episodes.length || episodesLoading ? 'episode' : canUpload ? 'file' : 'link');
  const [query, setQuery] = useState('');
  const [episode, setEpisode] = useState<Release | null>(null);
  const [candidate, setCandidate] = useState(suggested);
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState('');
  const [start, setStart] = useState(() => {
    const seconds = sample?.start_sec ?? suggested?.start_sec;
    return seconds === undefined ? '' : formatVoiceTimestamp(seconds);
  });
  const [end, setEnd] = useState(() => {
    const seconds = sample?.end_sec ?? suggested?.end_sec;
    return seconds === undefined ? '' : formatVoiceTimestamp(seconds);
  });
  const [duration, setDuration] = useState<number | null>(null);
  const [position, setPosition] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const audioRef = useRef<HTMLAudioElement>(null);
  const previewEnd = useRef<number | null>(null);
  const matching = useMemo(() => searchVoiceEpisodes(episodes, query), [episodes, query]);

  useEffect(() => {
    if (!file) {
      setFileUrl('');
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setFileUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const sourceUrl = sample?.audio_url ?? (mode === 'episode' ? candidate?.audio_url ?? pickAudioMp3Asset(episode)?.browser_download_url : undefined);
  const playerUrl = sourceUrl ? resolveUrl(sourceUrl) : mode === 'file' ? fileUrl : '';
  const minimum = sample?.start_sec ?? 0;
  const maximum = sample?.end_sec ?? duration;
  const typedStart = parseVoiceTimestamp(start);
  const typedEnd = parseVoiceTimestamp(end);
  const startSeconds = sample?.start_sec !== undefined && start === formatVoiceTimestamp(sample.start_sec)
    ? sample.start_sec : typedStart === null ? null : Math.max(minimum, typedStart);
  const endSeconds = sample?.end_sec !== undefined && end === formatVoiceTimestamp(sample.end_sec)
    ? sample.end_sec : typedEnd === null || maximum === null ? typedEnd : Math.min(maximum, typedEnd);
  const rangeValid = typedStart !== null && typedEnd !== null && startSeconds !== null && endSeconds !== null
    && typedStart + 0.001 >= minimum && startSeconds < endSeconds && (maximum === null || typedEnd <= maximum + 0.001);
  const chooseEpisode = (next: Release | null) => {
    setCandidate(undefined);
    setEpisode(next);
    setDuration(null);
    setPosition(0);
    setStart('');
    setEnd('');
    setError('');
    previewEnd.current = null;
  };

  const preview = async () => {
    const audio = audioRef.current;
    if (!audio || startSeconds === null || endSeconds === null) return;
    setError('');
    let jumped = true;
    const seek = () => {
      if (Math.abs(audio.currentTime - startSeconds) > 0.15) {
        jumped = false;
        audio.pause();
        previewEnd.current = null;
        setError('This recording couldn’t jump to that time.');
      }
    };
    try {
      audio.pause();
      audio.currentTime = startSeconds;
      if (audio.seeking) audio.addEventListener('seeked', seek, { once: true });
      else seek();
      if (!jumped) return;
      previewEnd.current = endSeconds;
      await audio.play();
    } catch {
      previewEnd.current = null;
      setError('This clip couldn’t be played.');
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (sample || mode === 'episode') {
      if (!rangeValid || startSeconds === null || endSeconds === null || !sourceUrl) return;
      const selection = { start_sec: startSeconds, end_sec: endSeconds };
      if (sample) onSave({ ...sample, ...selection });
      else if (candidate) onSave({ ...candidate, ...selection });
      else if (episode) onSave({
        id: crypto.randomUUID(), source: 'episode', audio_url: sourceUrl, release_id: episode.id,
        release_tag: episode.tag_name, label: episode.name || episode.tag_name, ...selection,
      });
    } else if (mode === 'link') {
      if (!/^https?:\/\//i.test(url.trim())) {
        setError('Enter a direct link starting with https:// or http://.');
        return;
      }
      onSave({ id: crypto.randomUUID(), source: 'link', audio_url: url.trim() });
    } else if (file) {
      setBusy(true);
      try {
        const savedUrl = await onUpload(file);
        onSave({ id: crypto.randomUUID(), source: 'upload', audio_url: savedUrl, label: file.name });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Couldn’t upload the recording.');
      } finally {
        setBusy(false);
      }
    }
  };

  const selectingRange = !!sample || mode === 'episode';
  const disabled = busy || (selectingRange ? !sourceUrl || !rangeValid : mode === 'file' ? !canUpload || !file : !url.trim());
  return (
    <VoiceDialog title={sample ? `Trim ${name}’s clip` : `Add a voice sample for ${name}`} onClose={onClose} busy={busy}>
      <form className="space-y-5" onSubmit={save}>
        {!sample && (
          <>
            <p className="text-sm text-slate-300">Choose a short clip where {name} speaks alone.</p>
            <label className="block space-y-1 text-sm text-slate-200">
              <span>Where is the recording?</span>
              <select className={voiceInput} value={mode} disabled={busy} onChange={event => {
                chooseEpisode(null);
                setFile(null);
                setUrl('');
                setMode(event.target.value as typeof mode);
              }}>
                <option value="episode">From an episode</option>
                <option value="file">From my computer</option>
                <option value="link">From an audio link</option>
              </select>
            </label>
          </>
        )}
        {!sample && mode === 'episode' && (
          episode || candidate ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-700 px-3 py-2">
              <span className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]">{episode?.name || episode?.tag_name || candidate?.label || candidate?.release_tag}</span>
              <button type="button" className={voiceButton} onClick={() => chooseEpisode(null)}>Change episode</button>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block space-y-1 text-sm text-slate-200">
                <span>Find an episode</span>
                <span className="relative block">
                  <Search size={15} className="absolute left-3 top-3 text-slate-400" />
                  <input className={`${voiceInput} pl-9`} type="search" placeholder="Search by title or date" value={query} onChange={event => setQuery(event.target.value)} />
                </span>
              </label>
              {matching.length > 0 ? (
                <>
                  <p className="text-xs text-slate-400" role="status">{query.trim() ? `${matching.length} matching episode${matching.length === 1 ? '' : 's'}` : 'Recent episodes'}</p>
                  <ul aria-label="Episode results" className="max-h-52 divide-y divide-slate-800 overflow-y-auto rounded-lg border border-slate-700">
                    {matching.slice(0, 15).map(item => (
                      <li key={item.id}><button type="button" onClick={() => chooseEpisode(item)} className="flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-slate-800 focus-visible:bg-slate-800">
                        <span className="[overflow-wrap:anywhere]">{item.name || item.tag_name}</span>
                        <span className="text-xs text-slate-400">{getEpisodeRecordedDate(item).displayDate}</span>
                      </button></li>
                    ))}
                  </ul>
                  {matching.length > 15 && <p className="text-xs text-slate-400">Showing the first 15. Search by title or date to narrow the list.</p>}
                </>
              ) : <p role="status" className="text-sm text-slate-300">{episodesLoading ? 'Loading episodes…' : query.trim() ? 'No episodes match this search.' : 'No episode recordings are available. Try an audio link or a file from your computer.'}</p>}
            </div>
          )
        )}
        {!sample && mode === 'file' && (canUpload ? (
          <label className="block space-y-1 text-sm text-slate-200"><span>Choose an audio file</span>
            <input className={voiceInput} type="file" accept="audio/*,.m4a,.wav,.mp3" disabled={busy} onChange={event => setFile(event.target.files?.[0] ?? null)} />
            <span className="block text-xs text-slate-400">The file is saved in your connected GitHub repository.</span>
          </label>
        ) : <p className="text-sm text-slate-300">Connect your GitHub repository in Settings to upload a file. You can still use an episode or an audio link.</p>)}
        {!sample && mode === 'link' && (
          <label className="block space-y-1 text-sm text-slate-200"><span>Direct link to the audio file</span>
            <input className={voiceInput} type="url" value={url} placeholder="https://…" onChange={event => setUrl(event.target.value)} />
          </label>
        )}
        {playerUrl && (
          <VoiceClipPlayer key={playerUrl} url={playerUrl} audioRef={audioRef} label="Recording preview" start={sample?.start_sec} end={sample?.end_sec}
            onDuration={setDuration} onUnavailable={() => setDuration(null)} onPosition={setPosition} previewEnd={previewEnd} />
        )}
        {selectingRange && sourceUrl && (
          <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-950/70 p-3">
            <p className="text-sm text-slate-200">Listen or scrub to the moment you want, then set the start and end.</p>
            <p className="text-xs tabular-nums text-slate-400">Player at {formatVoiceTimestamp(position)}</p>
            <div className="grid grid-cols-2 gap-3">
              {([{ label: 'Start', value: start, set: setStart }, { label: 'End', value: end, set: setEnd }]).map(marker => (
                <div key={marker.label} className="space-y-2">
                  <label className="block space-y-1 text-sm text-slate-200">
                    <span>{marker.label} time</span>
                    <input className={`${voiceInput} tabular-nums`} placeholder="mm:ss" value={marker.value} onChange={event => marker.set(event.target.value)} />
                  </label>
                  <button type="button" className={voiceButton} disabled={duration === null} onClick={() => {
                    const audio = audioRef.current;
                    if (audio) marker.set(formatVoiceTimestamp(audio.currentTime));
                  }}>Set {marker.label.toLowerCase()}</button>
                </div>
              ))}
            </div>
            {start && end && (rangeValid
              ? <p className="text-xs text-slate-400">Clip length {formatVoiceTimestamp(endSeconds! - startSeconds!)}</p>
              : <p className="text-xs text-amber-300">Choose a start and end inside the recording, with the end after the start.</p>)}
            <button type="button" className={voiceButton} disabled={!rangeValid || duration === null} onClick={() => void preview()}>Play selected clip</button>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={voiceButton} disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className={voicePrimary} disabled={disabled}>{busy ? 'Uploading…' : sample ? 'Save trim' : 'Save sample'}</button>
        </div>
      </form>
    </VoiceDialog>
  );
}
