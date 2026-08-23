import React, { useState, useEffect, useRef } from 'react';
import {
  Terminal, Settings, FolderGit2, FileText, Zap,
  Github, Eye, History, Rocket, List, ChevronRight, ChevronDown,
  Mic2, BookOpen, FlaskConical, Clock, Library, FileSearch, PlusCircle, LayoutDashboard
} from 'lucide-react';
import FileViewer from './components/FileViewer';
import GitHubConnect from './components/GitHubConnect';
import FeaturePanel from './components/FeaturePanel';
import BatchUrlEditor from './components/BatchUrlEditor';
import ArtworkUpload from './components/ArtworkUpload';
import RSSPreview from './components/RSSPreview';
import RunHistory from './components/RunHistory';
import DeployWizard from './components/DeployWizard';
import LibraryPanel from './components/LibraryPanel';
import TranscriptPanel from './components/TranscriptPanel';
import SubmitSpacePanel from './components/SubmitSpacePanel';
import DashboardOverview from './components/DashboardOverview';
import LiveQueuePanel from './components/LiveQueuePanel';
import PlayerBar from './components/PlayerBar';
import { PlayerProvider } from './contexts/PlayerContext';
import { EnhancedConfig, GitHubUser, PipelineFile } from './types';
import { saveConfig, loadConfig, loadStoredToken } from './utils/storage';
import {
  generateIngestYaml,
  generateIngestScript,
  generateReadme,
  generateQueueFile,
  generateTestAudioYaml,
  generateMonitorYaml,
} from './utils/templates';

const DEFAULT_CONFIG: EnhancedConfig = {
  repoName: 'copy-spaces-to-youtube-pipeline',
  ownerName: 'aiandbotsgalore',
  podcastTitle: 'Logan Black X Spaces',
  podcastDescription: 'Automated audio ingestion pipeline powered by GitHub Actions. Supports Twitter/X Spaces, YouTube, Clubhouse, LinkedIn Audio, and any platform supported by yt-dlp.',
  authorName: 'Logan Black',
  email: 'loganblack0@gmail.com',
  imageUrl: '',
  githubToken: '',
  artworkDataUrl: '',
  platforms: ['twitter', 'youtube', 'clubhouse', 'linkedin'],
  batchUrls: [],
  enableTranscription: false,
  enableSlackWebhook: false,
  slackWebhookUrl: '',
  enableDiscordWebhook: false,
  discordWebhookUrl: '',
  enableScheduledMonitoring: false,
  scheduledCron: '0 */2 * * *',
};

function buildInitialConfig(): EnhancedConfig {
  const stored = loadConfig();
  const storedToken = loadStoredToken();
  return {
    ...DEFAULT_CONFIG,
    ...stored,
    githubToken: storedToken,
    artworkDataUrl: '',
    enableTranscription: false,
    enableSlackWebhook: false,
    enableDiscordWebhook: false,
    enableScheduledMonitoring: false,
  };
}

const STATIC_FILES: PipelineFile[] = [
  {
    path: '.github/workflows/ingest.yml',
    name: 'Workflow',
    language: 'yaml',
    content: generateIngestYaml,
    description: 'Main GitHub Action: download, release, RSS, notifications',
  },
  {
    path: 'scripts/ingest.sh',
    name: 'Ingest Script',
    language: 'bash',
    content: generateIngestScript,
    description: 'Multi-platform download script powered by yt-dlp',
  },
  {
    path: 'batch_queue.txt',
    name: 'Batch Queue',
    language: 'text',
    content: generateQueueFile,
    description: 'Multi-URL queue file — one URL per line',
  },
  {
    path: 'README.md',
    name: 'Documentation',
    language: 'markdown',
    content: generateReadme,
    description: 'Full usage documentation for your repository',
  },
  {
    path: '.github/workflows/test_audio.yml',
    name: 'Test Workflow',
    language: 'yaml',
    content: generateTestAudioYaml,
    description: 'Verify runner has ffmpeg and yt-dlp installed',
  },
];

type Panel =
  | 'dashboard'
  | 'github'
  | 'config'
  | 'features'
  | 'batch'
  | 'submit-space'
  | 'rss-preview'
  | 'run-history'
  | 'live-queue'
  | 'deploy'
  | 'library'
  | 'transcripts'
  | `file:${string}`;

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: string;
  badgeColor?: string;
}

const NavItem: React.FC<NavItemProps> = ({ icon, label, active, onClick, badge, badgeColor }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center justify-between group px-3 py-2 text-sm font-medium rounded-lg transition-all ${
      active
        ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/20'
        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
    }`}
  >
    <div className="flex items-center gap-3 min-w-0">
      <span className={active ? 'text-indigo-400' : 'text-slate-600 group-hover:text-slate-400'}>{icon}</span>
      <span className="truncate">{label}</span>
    </div>
    <div className="flex items-center gap-1.5 flex-shrink-0">
      {badge && (
        <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${badgeColor || 'bg-slate-700 text-slate-400'}`}>
          {badge}
        </span>
      )}
      {active && <ChevronRight size={12} className="opacity-50" />}
    </div>
  </button>
);

export default function App() {
  const [config, setConfig] = useState<EnhancedConfig>(buildInitialConfig);
  const [activePanel, setActivePanel] = useState<Panel>('dashboard');
  const [githubUser, setGithubUser] = useState<GitHubUser | null>(null);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Always reset feature toggles to off on mount — never restore from localStorage
  useEffect(() => {
    setConfig(c => ({
      ...c,
      enableTranscription: false,
      enableSlackWebhook: false,
      enableDiscordWebhook: false,
      enableScheduledMonitoring: false,
    }));
  }, []);

  // Debounced config save to localStorage on every change
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveConfig(config);
    }, 500);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [config]);

  const updateConfig = (updates: Partial<EnhancedConfig>) => {
    setConfig(prev => ({ ...prev, ...updates }));
  };

  const handleInput = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    const trimmed = ['ownerName', 'repoName', 'email'].includes(name) ? value.trim() : value;
    updateConfig({ [name]: trimmed });
  };

  const monitorFile: PipelineFile = {
    path: '.github/workflows/monitor.yml',
    name: 'Monitor Workflow',
    language: 'yaml',
    content: generateMonitorYaml,
    description: 'Scheduled batch queue processor',
  };

  const allFiles = config.enableScheduledMonitoring
    ? [...STATIC_FILES, monitorFile]
    : STATIC_FILES;

  const activeFile = activePanel.startsWith('file:')
    ? allFiles.find(f => `file:${f.path}` === activePanel)
    : null;

  const fileIcon = (name: string) => {
    if (name.includes('Workflow') || name.includes('Monitor')) return <FolderGit2 size={15} />;
    if (name === 'Batch Queue' || name === 'Documentation') return <FileText size={15} />;
    if (name === 'Test Workflow') return <FlaskConical size={15} />;
    return <Terminal size={15} />;
  };

  const featuresOn = [
    config.enableTranscription,
    config.enableSlackWebhook,
    config.enableDiscordWebhook,
    config.enableScheduledMonitoring,
  ].filter(Boolean).length;

  return (
    <PlayerProvider>
    <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col md:flex-row font-sans">
      {/* ── Sidebar ── */}
      <aside className="w-full md:w-64 flex-shrink-0 border-r border-slate-800/80 bg-slate-950 flex flex-col h-screen sticky top-0">
        {/* Logo */}
        <div className="p-5 border-b border-slate-800/80">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-indigo-500/15 rounded-xl border border-indigo-500/20">
              <Mic2 className="text-indigo-400" size={20} />
            </div>
            <div>
              <h1 className="font-bold text-base tracking-tight text-white leading-none">SpacePipe Gen</h1>
              <p className="text-[10px] text-slate-600 mt-0.5">Audio Pipeline Generator</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-5">

          {/* TIER 1 — STUDIO / DAILY OPERATIONS */}
          <div>
            <p className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-600">🎙️ Studio</p>
            <div className="space-y-1">
              <NavItem
                icon={<LayoutDashboard size={15} />}
                label="Command Center"
                active={activePanel === 'dashboard'}
                onClick={() => setActivePanel('dashboard')}
              />
              <NavItem
                icon={<PlusCircle size={15} />}
                label="Submit New Space"
                active={activePanel === 'submit-space'}
                onClick={() => setActivePanel('submit-space')}
              />
              <NavItem
                icon={<Library size={15} />}
                label="Episode Library"
                active={activePanel === 'library'}
                onClick={() => setActivePanel('library')}
              />
              <NavItem
                icon={<FileSearch size={15} />}
                label="Transcripts"
                active={activePanel === 'transcripts'}
                onClick={() => setActivePanel('transcripts')}
                badge={config.enableTranscription ? 'on' : undefined}
                badgeColor="bg-amber-500/20 text-amber-400"
              />
              <NavItem
                icon={<History size={15} />}
                label="Run History"
                active={activePanel === 'run-history'}
                onClick={() => setActivePanel('run-history')}
              />
              <NavItem
                icon={<Eye size={15} />}
                label="RSS Feed Preview"
                active={activePanel === 'rss-preview'}
                onClick={() => setActivePanel('rss-preview')}
              />
              <NavItem
                icon={<List size={15} />}
                label="Batch Queue"
                active={activePanel === 'live-queue'}
                onClick={() => setActivePanel('live-queue')}
              />
            </div>
          </div>

          {/* TIER 2 — SETTINGS & PIPELINE (collapsed by default) */}
          <div>
            <button
              onClick={() => setSettingsExpanded(e => !e)}
              className="w-full flex items-center justify-between px-3 mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-600 hover:text-slate-400 transition-colors"
            >
              <span>⚙️ Settings &amp; Pipeline</span>
              <ChevronDown size={12} className={`transition-transform ${settingsExpanded ? 'rotate-180' : ''}`} />
            </button>
            {settingsExpanded && (
              <div className="space-y-1">
                <NavItem
                  icon={<Settings size={15} />}
                  label="Configuration"
                  active={activePanel === 'config'}
                  onClick={() => setActivePanel('config')}
                />
                <NavItem
                  icon={<Zap size={15} />}
                  label="Feature Toggles"
                  active={activePanel === 'features'}
                  onClick={() => setActivePanel('features')}
                  badge={featuresOn > 0 ? `${featuresOn} on` : undefined}
                  badgeColor="bg-indigo-500/20 text-indigo-400"
                />
                <NavItem
                  icon={<Rocket size={15} />}
                  label="Deploy to GitHub"
                  active={activePanel === 'deploy'}
                  onClick={() => setActivePanel('deploy')}
                  badge={githubUser ? 'Ready' : undefined}
                  badgeColor="bg-emerald-500/20 text-emerald-400"
                />
                <NavItem
                  icon={<Github size={15} />}
                  label="GitHub Connection"
                  active={activePanel === 'github'}
                  onClick={() => setActivePanel('github')}
                  badge={githubUser ? githubUser.login.slice(0, 10) : 'Connect'}
                  badgeColor={githubUser ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500'}
                />

                <p className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-slate-700">Generated Code Files</p>
                {allFiles.map(file => (
                  <NavItem
                    key={file.path}
                    icon={fileIcon(file.name)}
                    label={file.name}
                    active={activePanel === `file:${file.path}`}
                    onClick={() => setActivePanel(`file:${file.path}`)}
                  />
                ))}
              </div>
            )}
          </div>
        </nav>

        <div className="p-4 border-t border-slate-800/80 text-[10px] text-slate-700 text-center">
          Generated files comply with DevOps strict mode
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="flex-1 min-w-0 flex flex-col h-screen overflow-hidden">

        {activePanel === 'dashboard' && (
          <DashboardOverview
            config={config}
            onNavigate={panel => setActivePanel(panel)}
          />
        )}

        {activePanel === 'live-queue' && (
          <LiveQueuePanel config={config} />
        )}

        {activePanel === 'github' && (
          <GitHubConnect
            token={config.githubToken}
            user={githubUser}
            onTokenChange={token => updateConfig({ githubToken: token })}
            onUserChange={user => {
              setGithubUser(user);
              if (user) updateConfig({ ownerName: user.login });
            }}
          />
        )}

        {activePanel === 'config' && (
          <div className="h-full overflow-y-auto p-6 md:p-12 max-w-4xl mx-auto w-full">
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-white mb-2">Pipeline Configuration</h2>
              <p className="text-slate-400 text-sm">
                Fill in your repository details and podcast metadata. All values are injected into the generated workflow files.
              </p>
            </div>

            <div className="grid gap-8">
              {/* Repository Details */}
              <section className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
                  <Github size={16} className="text-slate-500" />
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
                    <p className="text-[10px] text-slate-600">Your GitHub username</p>
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
                    <p className="text-[10px] text-slate-600">New or existing repo name</p>
                  </div>
                </div>
              </section>

              {/* Podcast Metadata */}
              <section className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
                  <Mic2 size={16} className="text-slate-500" />
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
                      <p className="text-[10px] text-slate-600">Used for iTunes owner verification</p>
                    </div>
                  </div>
                </div>
              </section>

              {/* Artwork */}
              <section className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
                  <BookOpen size={16} className="text-slate-500" />
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-widest">Artwork</h3>
                </div>
                <ArtworkUpload config={config} onChange={updateConfig} />
              </section>

              {/* Platform support note */}
              <section className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
                  <Clock size={16} className="text-slate-500" />
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-widest">Supported Platforms</h3>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { name: 'Twitter / X Spaces', color: 'text-sky-400' },
                    { name: 'YouTube', color: 'text-red-400' },
                    { name: 'Clubhouse', color: 'text-green-400' },
                    { name: 'LinkedIn Audio', color: 'text-blue-400' },
                    { name: 'SoundCloud', color: 'text-orange-400' },
                    { name: 'Twitch VODs', color: 'text-purple-400' },
                    { name: 'Any yt-dlp URL', color: 'text-slate-400' },
                    { name: '1000+ more...', color: 'text-slate-600' },
                  ].map(p => (
                    <div key={p.name} className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg">
                      <span className={`text-[10px] font-medium ${p.color}`}>{p.name}</span>
                    </div>
                  ))}
                </div>
              </section>

              {/* Actions */}
              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  onClick={() => setActivePanel('features')}
                  className="flex items-center gap-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium rounded-xl transition-all"
                >
                  <Zap size={15} />
                  Configure Features
                </button>
                <button
                  onClick={() => setActivePanel('file:.github/workflows/ingest.yml')}
                  className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-xl shadow-lg shadow-indigo-500/20 transition-all active:scale-95"
                >
                  <FolderGit2 size={15} />
                  View Generated Files
                </button>
              </div>
            </div>
          </div>
        )}

        {activePanel === 'features' && (
          <FeaturePanel config={config} onChange={updateConfig} />
        )}

        {activePanel === 'batch' && (
          <BatchUrlEditor config={config} onChange={updateConfig} />
        )}

        {activePanel.startsWith('file:') && activeFile && (
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            <header className="px-6 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">{activeFile.name}</h2>
                <p className="text-xs text-slate-500 mt-0.5">{activeFile.path}</p>
              </div>
            </header>
            <div className="flex-1 p-4 md:p-6 overflow-hidden">
              <FileViewer file={activeFile} config={config} />
            </div>
          </div>
        )}

        {activePanel === 'rss-preview' && (
          <RSSPreview config={config} />
        )}

        {activePanel === 'run-history' && (
          <RunHistory config={config} />
        )}

        {activePanel === 'submit-space' && (
          <SubmitSpacePanel
            config={config}
            onViewRunHistory={() => setActivePanel('run-history')}
          />
        )}

        {activePanel === 'deploy' && (
          <DeployWizard config={config} />
        )}

        {activePanel === 'library' && (
          <LibraryPanel config={config} />
        )}

        {activePanel === 'transcripts' && (
          <TranscriptPanel config={config} />
        )}
      </main>
      <PlayerBar />
    </div>
    </PlayerProvider>
  );
}
