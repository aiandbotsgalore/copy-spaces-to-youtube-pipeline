import React, { useState, useEffect } from 'react';
import { Github, CheckCircle, AlertCircle, Loader, ExternalLink, X, KeyRound } from 'lucide-react';
import { GitHubUser } from '../types';
import { validateToken } from '../utils/github';
import { saveToken, loadStoredToken, hasStoredToken } from '../utils/storage';

interface Props {
  token: string;
  user: GitHubUser | null;
  onTokenChange: (token: string) => void;
  onUserChange: (user: GitHubUser | null) => void;
}

const GitHubConnect: React.FC<Props> = ({ token, user, onTokenChange, onUserChange }) => {
  const [input, setInput] = useState(token);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setInput(token);
  }, [token]);

  const handleConnect = async () => {
    if (!input.trim()) return;
    setLoading(true);
    setError('');
    try {
      const u = await validateToken(input.trim());
      onTokenChange(input.trim());
      onUserChange(u);
      saveToken(input.trim());
    } catch (e) {
      setError((e as Error).message);
      onUserChange(null);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = () => {
    onUserChange(null);
    setError('');
    setInput(loadStoredToken());
  };

  const storedTokenExists = hasStoredToken();

  return (
    <div className="h-full overflow-y-auto p-6 md:p-12 max-w-2xl mx-auto w-full">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white mb-2">GitHub Connection</h2>
        <p className="text-slate-400 text-sm">
          Connect your GitHub account to deploy pipeline files directly to a repository with one click.
        </p>
      </div>

      {user ? (
        <div className="space-y-6">
          <div className="flex items-center gap-4 p-5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
            <img src={user.avatar_url} alt={user.login} className="w-12 h-12 rounded-full ring-2 ring-emerald-500/50" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <CheckCircle size={16} className="text-emerald-400" />
                <span className="text-sm font-semibold text-emerald-400">Connected</span>
              </div>
              <p className="text-white font-medium">{user.name || user.login}</p>
              <p className="text-slate-400 text-xs">@{user.login}</p>
            </div>
            <button
              onClick={handleDisconnect}
              className="p-2 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-colors"
              title="Disconnect"
            >
              <X size={18} />
            </button>
          </div>

          {storedTokenExists && (
            <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
              <KeyRound size={13} className="text-emerald-400 flex-shrink-0" />
              <p className="text-xs text-emerald-300">
                Your token is permanently saved in this browser.
              </p>
            </div>
          )}

          <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-400 space-y-2">
            <p className="font-medium text-slate-300">What you can do now:</p>
            <ul className="space-y-1 list-none">
              <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> Deploy all pipeline files directly to GitHub</li>
              <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> Create a new repository automatically</li>
              <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> Browse your episode library</li>
              <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> View workflow run history with live monitoring</li>
              <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> Upload artwork to your repo</li>
            </ul>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                Personal Access Token
              </label>
              <input
                type="password"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleConnect()}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-sm text-white font-mono focus:outline-none focus:border-indigo-500 transition-colors"
              />
              {error && (
                <div className="flex items-center gap-2 text-red-400 text-xs">
                  <AlertCircle size={13} />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 p-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-lg">
              <KeyRound size={13} className="text-indigo-400 flex-shrink-0" />
              <p className="text-xs text-indigo-300">
                Tokens are saved permanently in this browser so you never have to re-enter them.
              </p>
            </div>

            <button
              onClick={handleConnect}
              disabled={!input.trim() || loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            >
              {loading ? <Loader size={16} className="animate-spin" /> : <Github size={16} />}
              {loading ? 'Connecting...' : 'Connect'}
            </button>
          </div>

          <div className="p-4 bg-slate-900/50 border border-slate-800 rounded-xl space-y-3">
            <p className="text-sm font-medium text-slate-300">How to create a token:</p>
            <ol className="text-xs text-slate-500 space-y-2 list-none">
              <li className="flex gap-3"><span className="text-indigo-400 font-bold">1.</span> Go to GitHub Settings → Developer Settings → Personal Access Tokens</li>
              <li className="flex gap-3"><span className="text-indigo-400 font-bold">2.</span> Click "Generate new token (classic)"</li>
              <li className="flex gap-3"><span className="text-indigo-400 font-bold">3.</span> Select scopes: <code className="bg-slate-800 px-1 rounded text-slate-300">repo</code>, <code className="bg-slate-800 px-1 rounded text-slate-300">workflow</code></li>
              <li className="flex gap-3"><span className="text-indigo-400 font-bold">4.</span> Copy and paste the token above</li>
            </ol>
            <a
              href="https://github.com/settings/tokens/new"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors mt-2"
            >
              <ExternalLink size={12} />
              Open GitHub token page
            </a>
          </div>

          <p className="text-xs text-slate-600 text-center">
            Your token is only sent to the GitHub API. It is never sent to any other server.
          </p>
        </div>
      )}
    </div>
  );
};

export default GitHubConnect;
