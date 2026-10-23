import React, { useEffect, useState } from 'react';
import { X, Loader2, Check, KeyRound, AlertTriangle } from 'lucide-react';
import { fetchDirectorStatus, invalidateDirectorStatus, listDirectorModels, testDirectorConnection } from '../utils/directorClient';
import {
  clearDirectorKey,
  loadDirectorKey,
  loadDirectorModel,
  loadDirectorPrefs,
  saveDirectorKey,
  saveDirectorModel,
  saveDirectorPrefs,
} from '../utils/storage';
import type { DirectorPrefs } from '../utils/storage';
import type { DirectorStatus } from '../utils/directorTypes';
import { DEFAULT_DIRECTOR_MODEL } from '../utils/directorProfile';

export const DirectorSettings: React.FC<{ onClose: () => void; onChanged?: () => void }> = ({ onClose, onChanged }) => {
  const [status, setStatus] = useState<DirectorStatus | null | undefined>(undefined);
  const [backupSaved, setBackupSaved] = useState(!!loadDirectorKey());
  const [keyInput, setKeyInput] = useState('');
  const [model, setModel] = useState(loadDirectorModel());
  const [models, setModels] = useState<string[]>([]);
  const [prefs, setPrefs] = useState<DirectorPrefs>(loadDirectorPrefs());
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = async () => {
    invalidateDirectorStatus();
    setStatus(await fetchDirectorStatus(true));
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!status) return;
    if (!status.keyConfigured && !backupSaved) return;
    let live = true;
    listDirectorModels().then(r => {
      if (!live) return;
      if ('models' in r) setModels(r.models);
    });
    return () => {
      live = false;
    };
  }, [status, backupSaved]);

  const effectiveModel = model || status?.model || DEFAULT_DIRECTOR_MODEL;

  const saveKey = async () => {
    if (!keyInput.trim()) return;
    saveDirectorKey(keyInput.trim());
    setKeyInput('');
    setBackupSaved(true);
    setTestMsg(null);
    await refresh();
    onChanged?.();
  };

  const removeKey = async () => {
    clearDirectorKey();
    setBackupSaved(false);
    setTestMsg(null);
    await refresh();
    onChanged?.();
  };

  const runTest = async () => {
    setTesting(true);
    setTestMsg(null);
    const r = await testDirectorConnection();
    setTesting(false);
    if (r.ok === true) {
      setTestMsg({
        ok: true,
        text: `Connected: ${r.model} in ${(r.ms / 1000).toFixed(1)}s${r.fellBack ? ' (fell back from the configured model)' : ''}.`,
      });
    } else {
      setTestMsg({ ok: false, text: r.message });
    }
  };

  const updatePrefs = (p: DirectorPrefs) => {
    setPrefs(p);
    saveDirectorPrefs(p);
    onChanged?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Director settings">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-white text-sm flex items-center gap-2">
            <KeyRound size={15} className="text-indigo-400" /> Director settings
          </h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white cursor-pointer" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* Key status */}
        <div className="text-xs space-y-2">
          <div className="text-[11px] uppercase font-semibold text-slate-400">API key</div>
          {status === undefined ? (
            <div className="text-slate-400 flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Checking…</div>
          ) : status === null ? (
            <div className="flex items-start gap-2 text-amber-300">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span>The Director endpoint is not reachable. It only exists while the app server is running (<code>npm run dev</code>).</span>
            </div>
          ) : status.keyConfigured ? (
            <div className="flex items-center gap-2 text-emerald-300">
              <Check size={14} /> Key loaded from <code>.env.local</code> on the server. The in-app backup is not used.
            </div>
          ) : backupSaved ? (
            <div className="flex items-center gap-2 text-emerald-300">
              <Check size={14} /> Using the backup key saved in this browser.
            </div>
          ) : (
            <div className="text-slate-300">
              No key found. Set <code>DIRECTOR_API_KEY</code> in <code>.env.local</code> and restart, or save a backup key below.
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              placeholder={backupSaved ? 'Backup key saved (enter a new one to replace)' : 'Backup key (stored in this browser only)'}
              className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={saveKey}
              disabled={!keyInput.trim()}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold disabled:opacity-40 cursor-pointer"
            >
              Save
            </button>
            {backupSaved && (
              <button onClick={removeKey} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs cursor-pointer">
                Remove
              </button>
            )}
          </div>
          <p className="text-[11px] text-slate-400">
            A backup key lives in this browser's local storage and is sent to the local app server only when the server has no key of its own.
          </p>
        </div>

        {/* Model */}
        <div className="text-xs space-y-1.5">
          <div className="text-[11px] uppercase font-semibold text-slate-400">Model</div>
          <input
            list="director-models"
            value={model}
            onChange={e => {
              setModel(e.target.value);
              saveDirectorModel(e.target.value.trim());
            }}
            placeholder={status?.model || DEFAULT_DIRECTOR_MODEL}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
          <datalist id="director-models">
            {models.map(m => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <p className="text-[11px] text-slate-400">Leave empty for the default ({status?.model || DEFAULT_DIRECTOR_MODEL}). Active: {effectiveModel}.</p>
        </div>

        {/* Prefs */}
        <div className="text-xs space-y-2">
          <div className="text-[11px] uppercase font-semibold text-slate-400">Candidates</div>
          <label className="flex items-center justify-between gap-3 text-slate-300">
            <span>Clips shown to the Director</span>
            <input
              type="number"
              min={20}
              max={200}
              value={prefs.candidateCap}
              onChange={e => {
                const n = Math.round(Number(e.target.value));
                updatePrefs({ ...prefs, candidateCap: Number.isFinite(n) ? Math.min(200, Math.max(20, n)) : 80 });
              }}
              className="w-20 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white text-right"
            />
          </label>
          <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={prefs.limitToFilters}
              onChange={e => updatePrefs({ ...prefs, limitToFilters: e.target.checked })}
              className="accent-indigo-500"
            />
            <span>Only use clips matching the current library filters</span>
          </label>
        </div>

        {/* Test */}
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={runTest}
            disabled={testing || status === null || status === undefined}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold border border-slate-700 disabled:opacity-40 cursor-pointer flex items-center gap-1.5"
          >
            {testing && <Loader2 size={12} className="animate-spin" />} Test connection
          </button>
          {testMsg && <span className={`text-xs ${testMsg.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{testMsg.text}</span>}
        </div>
      </div>
    </div>
  );
};

export default DirectorSettings;
