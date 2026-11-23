import React, { useState, useEffect } from 'react';
import { ShieldAlert, ShieldCheck, PauseCircle, PowerOff, AlertTriangle, RefreshCw } from 'lucide-react';

export type KillSwitchLevel = 'resume' | 'pause' | 'permanent';

export const KillSwitchCard: React.FC = () => {
  const [level, setLevel] = useState<KillSwitchLevel>('resume');
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState('');
  const [showConfirm, setShowConfirm] = useState<KillSwitchLevel | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/ascension/kill-switch');
      if (res.ok) {
        const data = await res.json();
        if (data.level) setLevel(data.level);
      }
    } catch {
      // Offline fallback
    }
  };

  useEffect(() => {
    fetchStatus();

    const handleCustomEvent = (e: any) => {
      if (e.detail?.level) setLevel(e.detail.level);
    };
    window.addEventListener('spacepipe:kill-switch', handleCustomEvent);
    return () => window.removeEventListener('spacepipe:kill-switch', handleCustomEvent);
  }, []);

  const handleToggle = async (targetLevel: KillSwitchLevel) => {
    setLoading(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/ascension/kill-switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level: targetLevel,
          reason: reason.trim() || `Manual toggle to ${targetLevel} by operator`,
        }),
      });
      const data = await res.json();
      if (res.ok && data.level) {
        setLevel(data.level);
        setStatusMessage(`Kill switch updated to: ${data.level.toUpperCase()}`);
        window.dispatchEvent(new CustomEvent('spacepipe:kill-switch', { detail: { level: data.level } }));
      } else {
        setStatusMessage(data.error || 'Failed to update kill switch.');
      }
    } catch (err: any) {
      setStatusMessage(err?.message || 'Error contacting Ascension API.');
    } finally {
      setLoading(false);
      setShowConfirm(null);
      setReason('');
    }
  };

  return (
    <div className={`p-5 rounded-xl border transition-all ${
      level === 'permanent'
        ? 'bg-rose-950/20 border-rose-500/50 shadow-md shadow-rose-950/30'
        : level === 'pause'
        ? 'bg-amber-950/20 border-amber-500/50 shadow-md shadow-amber-950/30'
        : 'bg-slate-900 border-slate-800'
    }`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className={`p-2 rounded-lg mt-0.5 ${
            level === 'permanent'
              ? 'bg-rose-500/20 text-rose-400'
              : level === 'pause'
              ? 'bg-amber-500/20 text-amber-400'
              : 'bg-emerald-500/20 text-emerald-400'
          }`}>
            {level === 'permanent' ? (
              <PowerOff size={18} />
            ) : level === 'pause' ? (
              <PauseCircle size={18} />
            ) : (
              <ShieldCheck size={18} />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-semibold text-white">Copilot Ascension Kill Switch</span>
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
                level === 'permanent'
                  ? 'bg-rose-500/30 text-rose-300 border border-rose-500/50'
                  : level === 'pause'
                  ? 'bg-amber-500/30 text-amber-300 border border-amber-500/50'
                  : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
              }`}>
                {level === 'permanent' ? 'Permanent Lock' : level === 'pause' ? 'Paused (Read-Only)' : 'Active (Tier 0-2)'}
              </span>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed mb-3">
              Safeguard switch governing autonomous Copilot operations. When <strong>Paused</strong>, all mutated Tier 1 and Tier 2 hooks (bash exec, workflow writes, voice synthesis) return HTTP 403 while Tier 0 reads remain active.
            </p>

            {/* Quick Action Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={loading || level === 'resume'}
                onClick={() => handleToggle('resume')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  level === 'resume'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 cursor-default'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-700'
                }`}
              >
                <ShieldCheck size={14} />
                Normal (Resume)
              </button>

              <button
                type="button"
                disabled={loading || level === 'pause'}
                onClick={() => setShowConfirm('pause')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  level === 'pause'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 cursor-default'
                    : 'bg-slate-800 text-slate-300 hover:bg-amber-500/20 hover:text-amber-200 border border-slate-700'
                }`}
              >
                <PauseCircle size={14} />
                Pause Execution
              </button>

              <button
                type="button"
                disabled={loading || level === 'permanent'}
                onClick={() => setShowConfirm('permanent')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  level === 'permanent'
                    ? 'bg-rose-500/30 text-rose-300 border border-rose-500/50 cursor-default'
                    : 'bg-slate-800 text-slate-300 hover:bg-rose-500/20 hover:text-rose-200 border border-slate-700'
                }`}
              >
                <PowerOff size={14} />
                Permanent Lockout
              </button>

              <button
                type="button"
                onClick={fetchStatus}
                title="Refresh Status"
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
              >
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>

            {/* Confirmation dialog when clicking Pause or Permanent */}
            {showConfirm && (
              <div className="mt-4 p-3.5 bg-slate-950 border border-slate-800 rounded-lg space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <AlertTriangle size={14} className={showConfirm === 'permanent' ? 'text-rose-400' : 'text-amber-400'} />
                  Confirm Transition to {showConfirm.toUpperCase()}
                </div>
                <p className="text-[11px] text-slate-400">
                  {showConfirm === 'permanent'
                    ? 'Permanent lockout will permanently disable all non-Tier-0 mutations and execution hooks across the entire backend.'
                    : 'Pausing will temporarily block bash execution, workflow file modifications, and direct voice synthesis.'}
                </p>
                <input
                  type="text"
                  placeholder="Optional reason for audit trail..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
                <div className="flex items-center gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setShowConfirm(null)}
                    className="px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggle(showConfirm)}
                    className={`px-3 py-1 text-xs rounded font-medium text-white transition-colors ${
                      showConfirm === 'permanent'
                        ? 'bg-rose-600 hover:bg-rose-500'
                        : 'bg-amber-600 hover:bg-amber-500'
                    }`}
                  >
                    Confirm {showConfirm.toUpperCase()}
                  </button>
                </div>
              </div>
            )}

            {statusMessage && (
              <p className="mt-2 text-[11px] text-indigo-300 font-mono">{statusMessage}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
