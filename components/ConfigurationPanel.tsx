import React, { useState } from 'react';
import {
  Archive, AlertCircle, CheckCircle2, Bookmark, Github, Mic2, BookOpen, Clock, Zap, FolderGit2
} from 'lucide-react';
import { useConfig } from '../contexts/ConfigContext';
import ArtworkUpload from './ArtworkUpload';

interface ConfigurationPanelProps {
  onNavigate: (panel: string) => void;
  onExportZip: () => void;
  isExportingZip: boolean;
}

export const ConfigurationPanel: React.FC<ConfigurationPanelProps> = ({
  onNavigate,
  onExportZip,
  isExportingZip,
}) => {
  const {
    config,
    updateConfig,
    validationErrors,
    profiles,
    activeProfileId,
    saveCurrentAsProfile,
    loadProfile,
    deleteProfile,
  } = useConfig();

  const [newProfileName, setNewProfileName] = useState('');

  const handleInput = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    updateConfig({ [name]: value });
  };

  return (
    <div className="h-full overflow-y-auto p-6 md:p-12 max-w-4xl mx-auto w-full">
      <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">Pipeline Configuration</h2>
          <p className="text-slate-400 text-sm">
            Fill in your repository details and podcast metadata. All values are injected into the generated workflow files.
          </p>
        </div>

        {/* Profiles & Zip Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={onExportZip}
            disabled={isExportingZip}
            className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg shadow-md transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            <Archive size={14} />
            {isExportingZip ? 'Packaging...' : 'Export ZIP'}
          </button>
        </div>
      </div>

      {/* Validation Banner */}
      {validationErrors.length > 0 ? (
        <div className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs space-y-1.5">
          <div className="flex items-center gap-2 font-semibold">
            <AlertCircle size={15} className="text-amber-400 flex-shrink-0" />
            <span>Configuration Warnings ({validationErrors.length})</span>
          </div>
          <ul className="list-disc pl-5 space-y-0.5 text-amber-200/80">
            {validationErrors.map((err, idx) => (
              <li key={idx}><strong>{err.field}:</strong> {err.message}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="mb-6 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 size={15} className="text-emerald-400 flex-shrink-0" />
          <span>Configuration parameters pass validation checks.</span>
        </div>
      )}

      {/* Profile Management Bar */}
      <div className="mb-8 p-4 bg-slate-900 border border-slate-800 rounded-xl flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Bookmark size={16} className="text-indigo-400 flex-shrink-0" />
          <span className="text-xs font-semibold text-slate-300 whitespace-nowrap">Saved Profiles:</span>
          <select
            value={activeProfileId || ''}
            onChange={(e) => {
              if (e.target.value) loadProfile(e.target.value);
            }}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="">Default / Current Working Session</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {activeProfileId && (
            <button
              onClick={() => deleteProfile(activeProfileId)}
              className="text-xs text-rose-400 hover:text-rose-300 px-2 py-1 bg-rose-500/10 hover:bg-rose-500/20 rounded border border-rose-500/20 cursor-pointer"
              title="Delete profile"
            >
              Delete
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="New profile name..."
            value={newProfileName}
            onChange={(e) => setNewProfileName(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={() => {
              if (newProfileName.trim()) {
                saveCurrentAsProfile(newProfileName.trim());
                setNewProfileName('');
              }
            }}
            disabled={!newProfileName.trim()}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-medium rounded-lg transition-colors border border-slate-700 cursor-pointer"
          >
            Save Preset
          </button>
        </div>
      </div>

      <div className="grid gap-8">
        {/* Repository Details */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
            <Github size={16} className="text-slate-400" />
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-widest">Repository Details</h3>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400">Owner / Username</label>
              <input
                type="text"
                name="ownerName"
                placeholder="e.g. octocat"
                value={config.ownerName}
                onChange={handleInput}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
              />
              <p className="text-[11px] text-slate-500">Your GitHub username</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400">Repository Name</label>
              <input
                type="text"
                name="repoName"
                placeholder="e.g. spaces-archive"
                value={config.repoName}
                onChange={handleInput}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
              />
              <p className="text-[11px] text-slate-500">New or existing repo name</p>
            </div>
          </div>
        </section>

        {/* Podcast Metadata */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
            <Mic2 size={16} className="text-slate-400" />
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-widest">Podcast Metadata</h3>
          </div>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400">Podcast Title</label>
              <input
                type="text"
                name="podcastTitle"
                placeholder="e.g. Engineering Spaces"
                value={config.podcastTitle}
                onChange={handleInput}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400">Description</label>
              <input
                type="text"
                name="podcastDescription"
                placeholder="e.g. A collection of great discussions..."
                value={config.podcastDescription}
                onChange={handleInput}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400">Author Name</label>
                <input
                  type="text"
                  name="authorName"
                  placeholder="e.g. Jane Smith"
                  value={config.authorName}
                  onChange={handleInput}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400">Email</label>
                <input
                  type="email"
                  name="email"
                  placeholder="e.g. hello@example.com"
                  value={config.email}
                  onChange={handleInput}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
                />
                <p className="text-[11px] text-slate-500">Used for iTunes owner verification</p>
              </div>
            </div>
          </div>
        </section>

        {/* Artwork */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
            <BookOpen size={16} className="text-slate-400" />
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-widest">Artwork</h3>
          </div>
          <ArtworkUpload config={config} onChange={updateConfig} />
        </section>

        {/* Platform support note */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
            <Clock size={16} className="text-slate-400" />
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-widest">Supported Platforms</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { name: 'Twitter / X Spaces', color: 'text-slate-300' },
              { name: 'YouTube', color: 'text-rose-400' },
              { name: 'Clubhouse', color: 'text-green-400' },
              { name: 'LinkedIn Audio', color: 'text-slate-300' },
              { name: 'SoundCloud', color: 'text-amber-400' },
              { name: 'Twitch VODs', color: 'text-indigo-400' },
              { name: 'Any yt-dlp URL', color: 'text-slate-400' },
              { name: '1000+ more...', color: 'text-slate-500' },
            ].map(p => (
              <div key={p.name} className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg">
                <span className={`text-[11px] font-medium ${p.color}`}>{p.name}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Actions */}
        <div className="flex flex-wrap gap-3 pt-2">
          <button
            onClick={() => onNavigate('features')}
            className="flex items-center gap-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium rounded-lg transition-all cursor-pointer"
          >
            <Zap size={15} />
            Configure Features
          </button>
          <button
            onClick={() => onNavigate('file:.github/workflows/ingest.yml')}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg shadow-lg transition-all active:scale-95 cursor-pointer"
          >
            <FolderGit2 size={15} />
            View Generated Files
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfigurationPanel;
