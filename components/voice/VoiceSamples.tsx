import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Plus, Scissors, Trash2 } from 'lucide-react';
import type { VoiceProfile, VoiceSample } from '../../types';
import { formatVoiceTimestamp, getVoiceSamples } from '../../utils/voiceProfiles';
import { VoiceClipPlayer, voiceButton, voicePrimary } from './VoiceSampleEditor';
import { appDialog } from '../../contexts/DialogContext';

interface Props {
  profile: VoiceProfile;
  resolveUrl: (url: string) => string;
  onEdit: (sample?: VoiceSample) => void;
  onRemove: (sample: VoiceSample) => void;
  onPrepare?: (sample: VoiceSample) => Promise<void>;
  onOpenEpisode?: (id: number | string, seconds?: number) => void;
}

export function VoiceSamples({ profile, resolveUrl, onEdit, onRemove, onPrepare, onOpenEpisode }: Props) {
  const samples = getVoiceSamples(profile);
  const [open, setOpen] = useState(false);
  const [preparing, setPreparing] = useState<string | null>(null);
  const previousCount = useRef(samples.length);
  useEffect(() => {
    if (previousCount.current < samples.length) setOpen(true);
    previousCount.current = samples.length;
  }, [samples.length]);

  const first = samples[0];
  if (!first) {
    return <button type="button" className={voicePrimary} onClick={() => onEdit()}>
      <Plus size={14} className="mr-1 inline" /> Add a voice sample
    </button>;
  }

  return (
    <div className="space-y-3">
      {!open && <VoiceClipPlayer key={first.id} url={resolveUrl(first.audio_url)} start={first.start_sec} end={first.end_sec} />}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={voiceButton} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide samples' : 'View samples'}
        </button>
        <button type="button" className={voiceButton} onClick={() => onEdit()}>
          <Plus size={13} className="mr-1 inline" /> Add another sample
        </button>
      </div>
      {open && (
        <div className="space-y-3">
          {samples.map(sample => {
            const source = sample.source === 'episode' ? sample.label || sample.release_tag || 'Episode clip'
              : sample.source === 'upload' ? sample.label || 'Uploaded recording'
                : sample.source === 'link' ? 'Linked recording' : 'Saved recording';
            return (
              <div key={sample.id} className="space-y-2 rounded-lg border border-slate-800 bg-slate-950 p-2.5">
                <p className="break-words text-xs font-semibold text-slate-200">
                  {source}{sample.start_sec !== undefined ? ` · ${formatVoiceTimestamp(sample.start_sec)}` : ''}
                  {sample.end_sec !== undefined ? `–${formatVoiceTimestamp(sample.end_sec)}` : ''}
                </p>
                <VoiceClipPlayer key={`${sample.audio_url}:${sample.start_sec}:${sample.end_sec}`} url={resolveUrl(sample.audio_url)} start={sample.start_sec} end={sample.end_sec} />
                <div className="flex flex-wrap gap-2">
                  {onPrepare && (
                    <button type="button" className={voiceButton} disabled={preparing !== null} onClick={async () => {
                      setPreparing(sample.id);
                      try {
                        await onPrepare(sample);
                      } finally {
                        setPreparing(null);
                      }
                    }}>{preparing === sample.id ? 'Sending clip…' : 'Prepare voice'}</button>
                  )}
                  {sample.source === 'episode' && (sample.release_tag || sample.release_id !== undefined) && onOpenEpisode && (
                    <button type="button" className={voiceButton} onClick={() => onOpenEpisode(sample.release_tag ?? sample.release_id!, sample.start_sec)}>
                      Open in episode <ArrowUpRight size={12} className="inline" />
                    </button>
                  )}
                  <button type="button" className={voiceButton} onClick={() => onEdit(sample)}>
                    <Scissors size={12} className="mr-1 inline" /> Trim
                  </button>
                  <button type="button" className={voiceButton} onClick={async () => {
                    if (await appDialog.confirm({ title: 'Remove Sample', message: 'Remove this sample from the voice profile?', confirmLabel: 'Remove', destructive: true })) {
                      onRemove(sample);
                    }
                  }}>
                    <Trash2 size={12} className="mr-1 inline" /> Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
