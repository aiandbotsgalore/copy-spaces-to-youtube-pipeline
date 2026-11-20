import React from 'react';
import { VoiceDialog, voiceButton, voiceInput, voicePrimary } from './VoiceSampleEditor';
import type { ColorOption } from './types';

interface Props {
  creating: boolean;
  name: string;
  setName: (value: string) => void;
  role: string;
  setRole: (value: string) => void;
  color: string;
  setColor: (value: string) => void;
  emoji: string;
  setEmoji: (value: string) => void;
  notes: string;
  setNotes: (value: string) => void;
  canPause: boolean;
  paused: boolean;
  setPaused: (value: boolean) => void;
  hasGitHub: boolean;
  error: string;
  onSave: () => void;
  onClose: () => void;
  roleOptions: string[];
  colorOptions: ColorOption[];
  emojiOptions: string[];
}

export function VoiceProfileModal({
  creating, name, setName, role, setRole, color, setColor, emoji, setEmoji, notes, setNotes,
  canPause, paused, setPaused, hasGitHub, error, onSave, onClose, roleOptions, colorOptions, emojiOptions,
}: Props) {
  return (
    <VoiceDialog title={creating ? 'Add a person' : 'Edit profile'} onClose={onClose}>
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); onSave(); }}>
        <label className="block space-y-1 text-sm text-slate-200">
          <span>Display name</span>
          <input autoFocus required value={name} className={voiceInput} onChange={event => setName(event.target.value)} />
        </label>
        <details className="rounded-lg border border-slate-700 px-3 py-2" open={creating ? undefined : true}>
          <summary className="cursor-pointer text-sm font-medium text-slate-200">Profile details</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm text-slate-200">
              <span>Role</span>
              <select value={role} onChange={event => setRole(event.target.value)} className={voiceInput}>
                {Array.from(new Set([...roleOptions, role])).map(value => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm text-slate-200">
              <span>Label color</span>
              <select value={color} onChange={event => setColor(event.target.value)} className={voiceInput}>
                {colorOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm text-slate-200">
              <span>Profile icon</span>
              <select value={emoji} onChange={event => setEmoji(event.target.value)} className={voiceInput}>
                {Array.from(new Set([...emojiOptions, emoji])).map(value => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm text-slate-200 sm:col-span-2">
              <span>Notes</span>
              <textarea rows={2} value={notes} className={voiceInput} onChange={event => setNotes(event.target.value)} />
            </label>
          </div>
        </details>
        {canPause && (
          <div className="space-y-1 rounded-lg border border-slate-700 p-3">
            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input type="checkbox" checked={paused} onChange={event => setPaused(event.target.checked)} /> Pause suggestions for this voice
            </label>
            <p className="text-xs text-slate-400">{hasGitHub
              ? 'Use Sync to GitHub in More tools to apply this setting to future cloud processing.'
              : 'Saved in this browser. Connect GitHub in Settings to apply it to cloud processing.'}</p>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={voiceButton} onClick={onClose}>Cancel</button>
          <button type="submit" className={voicePrimary} disabled={!name.trim()}>{creating ? 'Continue to voice sample' : 'Save profile'}</button>
        </div>
      </form>
    </VoiceDialog>
  );
}
