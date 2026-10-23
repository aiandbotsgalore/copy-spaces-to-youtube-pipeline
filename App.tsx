import React, { useState, useEffect, useRef, Suspense, Component } from 'react';
import {
  Terminal, Settings, FolderGit2, FileText, Zap,
  Github, Eye, History, Rocket, ChevronRight, ChevronDown,
  Mic2, BookOpen, FlaskConical, Clock, Library, FileSearch, PlusCircle, LayoutDashboard, Flame, AudioWaveform,
  Film, Loader2, Archive, Bookmark, AlertCircle, CheckCircle2, Bot, Sparkles, Scale
} from 'lucide-react';
import PlayerBar from './components/PlayerBar';
import { PlayerProvider } from './contexts/PlayerContext';
import { MontageProvider } from './contexts/MontageContext';
import { CopilotProvider } from './contexts/CopilotContext';
import { ConfigProvider, useConfig, DEFAULT_CONFIG } from './contexts/ConfigContext';
import { MontageReelDrawer } from './components/MontageReelDrawer';
import { PipelineHealthWidget } from './components/PipelineHealthWidget';
import { ReelChip } from './components/shell/ReelChip';
import { pruneAudioCache } from './utils/audioCache';
import { EnhancedConfig, GitHubUser, PipelineFile } from './types';
import { loadStoredToken, saveToken } from './utils/storage';
import { validateToken } from './utils/github';
import { exportPipelineZip } from './utils/exportZip';

// Code-split / Lazy-loaded Panels
const DashboardOverview = React.lazy(() => import('./components/DashboardOverview'));
const SubmitSpacePanel = React.lazy(() => import('./components/SubmitSpacePanel'));
const LibraryPanel = React.lazy(() => import('./components/LibraryPanel'));
const TranscriptPanel = React.lazy(() => import('./components/TranscriptPanel'));
const ClipsPanel = React.lazy(() => import('./components/ClipsPanel').then(m => ({ default: m.ClipsPanel })));
const MontageStudio = React.lazy(() => import('./components/MontageStudio'));
const VoiceProfileLibrary = React.lazy(() => import('./components/VoiceProfileLibrary'));
const RunHistory = React.lazy(() => import('./components/RunHistory'));
const RSSPreview = React.lazy(() => import('./components/RSSPreview'));
const LiveQueuePanel = React.lazy(() => import('./components/LiveQueuePanel'));
const GitHubConnect = React.lazy(() => import('./components/GitHubConnect'));
const DeployWizard = React.lazy(() => import('./components/DeployWizard'));
const FeaturePanel = React.lazy(() => import('./components/FeaturePanel'));
const BatchUrlEditor = React.lazy(() => import('./components/BatchUrlEditor'));
const PipelineSettings = React.lazy(() => import('./components/PipelineSettings'));
const ConfigurationPanel = React.lazy(() => import('./components/ConfigurationPanel'));
const FileViewer = React.lazy(() => import('./components/FileViewer'));
const AICopilotPanel = React.lazy(() => import('./components/AICopilotPanel').then(m => ({ default: m.AICopilotPanel })));
const InvestigativeRadar = React.lazy(() => import('./components/InvestigativeRadar').then(m => ({ default: m.InvestigativeRadar })));
import {
  generateIngestYaml,
  generateIngestScript,
  generateReadme,
  generateQueueFile,
  generateTestAudioYaml,
  generateMonitorYaml,
} from './utils/templates';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  activePanel?: string;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class PanelErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('PanelErrorBoundary caught error:', error, errorInfo);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (prevProps.activePanel !== this.props.activePanel && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) this.props.onReset();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-950 text-slate-200">
          <div className="w-16 h-16 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 mb-4">
            <Flame size={28} />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Panel Error</h2>
          <p className="text-sm text-slate-400 max-w-md mb-6">
            {this.state.error?.message || 'An unexpected error occurred while loading this view.'}
          </p>
          <div className="flex gap-3">
            <button
              onClick={this.reset}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg shadow-lg transition-all cursor-pointer"
            >
              Try Again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg border border-slate-700 transition-all cursor-pointer"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
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
    name: 'batch_queue.txt',
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
  | 'pipeline-settings'
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
  | 'investigative-radar'
  | 'clips'
  | 'montage'
  | 'voice-profiles'
  | 'ai-copilot'
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
    aria-current={active ? 'page' : undefined}
    className={`w-full flex items-center justify-between group px-3 py-2 text-[13px] font-medium rounded-lg border transition-colors cursor-pointer ${
      active
        ? 'bg-a1/15 text-white border-a1/60'
        : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-card/60'
    }`}
  >
    <div className="flex items-center gap-3 min-w-0">
      <span className={active ? 'text-a0' : 'text-slate-500 group-hover:text-slate-300'}>{icon}</span>
      <span className="truncate">{label}</span>
    </div>
    {badge && (
      <span className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded font-mono font-bold ${badgeColor || 'bg-card text-slate-300'}`}>
        {badge}
      </span>
    )}
  </button>
);

function AppContent() {
  const {
    config,
    updateConfig,
  } = useConfig();
  const [activePanel, setActivePanel] = useState<Panel>('dashboard');
  const [selectedTranscriptId, setSelectedTranscriptId] = useState<number | string | null>(null);
  const [githubUser, setGithubUser] = useState<GitHubUser | null>(null);
  const [settingsExpanded, setSettingsExpanded] = useState(false);

  // Apply the cache-retention setting once per load.
  useEffect(() => {
    if (config.cacheRetentionDays) pruneAudioCache(config.cacheRetentionDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [isExportingZip, setIsExportingZip] = useState(false);

  // Panels that live in the collapsed "Settings & Pipeline" group: open it so the active item is visible.
  useEffect(() => {
    if (
      activePanel === 'run-history' ||
      activePanel === 'rss-preview' ||
      activePanel === 'pipeline-settings' ||
      activePanel === 'config' ||
      activePanel === 'features' ||
      activePanel === 'deploy' ||
      activePanel === 'github' ||
      activePanel.startsWith('file:')
    ) {
      setSettingsExpanded(true);
    }
  }, [activePanel]);

  // Auto-restore and validate stored GitHub token permanently on mount
  useEffect(() => {
    const storedToken = loadStoredToken();
    if (storedToken) {
      validateToken(storedToken)
        .then(u => {
          setGithubUser(u);
          updateConfig({
            githubToken: storedToken,
            ownerName: config.ownerName || u.login,
          });
        })
        .catch(err => {
          console.warn('Stored GitHub token could not be verified on mount:', err);
        });
    }
  }, []);


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

  const handleExportZip = async () => {
    try {
      setIsExportingZip(true);
      await exportPipelineZip(allFiles, config);
    } catch (err) {
      console.error('Failed to export zip:', err);
    } finally {
      setIsExportingZip(false);
    }
  };

  const activeFile = activePanel.startsWith('file:')
    ? allFiles.find(f => `file:${f.path}` === activePanel)
    : null;

  const fileIcon = (name: string) => {
    if (name.includes('Workflow') || name.includes('Monitor')) return <FolderGit2 size={15} />;
    if (name === 'batch_queue.txt' || name === 'Documentation') return <FileText size={15} />;
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
      <MontageProvider>
        <CopilotProvider>
        <div className="min-h-screen bg-bg text-slate-200 flex flex-col md:flex-row font-sans">
      {/* ── Sidebar ── */}
      <aside className="w-full md:w-[clamp(208px,18vw,236px)] flex-shrink-0 border-r border-line bg-bg flex flex-col h-screen sticky top-0">
        <div className="px-4 pt-4 pb-3 flex flex-wrap items-center gap-x-2.5 gap-y-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-a0 to-a1 flex items-center justify-center flex-shrink-0">
            <AudioWaveform size={15} className="text-white" />
          </div>
          <h1 className="font-semibold text-[15px] tracking-tight text-white leading-none">SpacePipe <span className="font-normal text-slate-400">Studio</span></h1>
          <span
            title={githubUser ? `Connected as ${githubUser.login}` : 'No GitHub connection: viewing the local archive'}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-medium ${
              githubUser ? 'border-emerald/30 bg-emerald/10 text-emerald' : 'border-line bg-card text-slate-400'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${githubUser ? 'bg-emerald' : 'bg-slate-500'}`} />
            {githubUser ? 'Online' : 'Local'}
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
          <NavItem
            icon={<Sparkles size={16} />}
            label="AI Studio Copilot"
            active={activePanel === 'ai-copilot'}
            onClick={() => setActivePanel('ai-copilot')}
            badge="AI"
            badgeColor="text-a0"
          />
          <NavItem
            icon={<LayoutDashboard size={16} />}
            label="Command Center"
            active={activePanel === 'dashboard'}
            onClick={() => setActivePanel('dashboard')}
          />
          <NavItem
            icon={<PlusCircle size={16} />}
            label="Ingest"
            active={activePanel === 'submit-space' || activePanel === 'live-queue'}
            onClick={() => setActivePanel('submit-space')}
          />
          <NavItem
            icon={<Library size={16} />}
            label="Episode Library"
            active={activePanel === 'library'}
            onClick={() => setActivePanel('library')}
          />
          <NavItem
            icon={<FileSearch size={16} />}
            label="Transcripts"
            active={activePanel === 'transcripts'}
            onClick={() => setActivePanel('transcripts')}
          />
          <NavItem
            icon={<Scale size={16} />}
            label="Investigative Radar"
            active={activePanel === 'investigative-radar'}
            onClick={() => setActivePanel('investigative-radar')}
            badge="GraphRAG"
            badgeColor="bg-amber-500/20 text-amber-400 border border-amber-500/30"
          />
          <NavItem
            icon={<Flame size={16} />}
            label="Best Clips"
            active={activePanel === 'clips'}
            onClick={() => setActivePanel('clips')}
          />
          <NavItem
            icon={<Film size={16} />}
            label="Montage Studio"
            active={activePanel === 'montage'}
            onClick={() => setActivePanel('montage')}
          />
          <NavItem
            icon={<Bot size={16} />}
            label="Voice Profiles"
            active={activePanel === 'voice-profiles'}
            onClick={() => setActivePanel('voice-profiles')}
          />
        </nav>

        <div className="border-t border-line px-3 pt-2 pb-3 space-y-2 max-h-[55vh] overflow-y-auto">
          <button
            onClick={() => setSettingsExpanded(e => !e)}
            aria-expanded={settingsExpanded}
            className="w-full flex items-center justify-between px-3 py-2 text-[13px] font-medium text-slate-400 hover:text-slate-200 rounded-lg hover:bg-card/60 transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-3"><Settings size={16} className="text-slate-500" /> Pipeline Settings</span>
            <ChevronDown size={13} className={`transition-transform ${settingsExpanded ? 'rotate-180' : ''}`} />
          </button>
            {settingsExpanded && (
              <div className="space-y-1">
                <NavItem
                  icon={<Settings size={15} />}
                  label="Pipeline Settings"
                  active={activePanel === 'pipeline-settings'}
                  onClick={() => setActivePanel('pipeline-settings')}
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
                  icon={<Settings size={15} />}
                  label="Repo & Podcast"
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
                  badgeColor={githubUser ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'}
                />

                <div className="flex items-center justify-between px-3 pt-3 pb-1">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Generated Code Files</p>
                  <button
                    onClick={handleExportZip}
                    disabled={isExportingZip}
                    className="flex items-center gap-1 text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 disabled:opacity-50 transition-colors"
                    title="Download all pipeline files as a ZIP archive"
                  >
                    <Archive size={12} />
                    {isExportingZip ? 'Zipping...' : '.ZIP'}
                  </button>
                </div>
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

          <PipelineHealthWidget
            config={config}
            compact={true}
            onNavigateToGitHub={() => setActivePanel('github')}
          />
          <ReelChip />
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="flex-1 min-w-0 flex flex-col h-screen overflow-hidden">
        <PanelErrorBoundary activePanel={activePanel}>
          <Suspense fallback={
            <div className="flex-1 flex flex-col items-center justify-center h-full p-12 bg-slate-950">
              <Loader2 className="w-8 h-8 text-indigo-400 animate-spin mb-3" />
              <span className="text-xs text-slate-400 font-medium tracking-wide">Loading workspace view...</span>
            </div>
          }>

        {activePanel === 'dashboard' && (
          <DashboardOverview
            config={config}
            onNavigate={panel => setActivePanel(panel)}
          />
        )}

        {activePanel === 'github' && (
          <GitHubConnect
            token={config.githubToken}
            user={githubUser}
            onTokenChange={token => {
              saveToken(token);
              updateConfig({ githubToken: token });
            }}
            onUserChange={user => {
              setGithubUser(user);
              if (user) updateConfig({ ownerName: user.login });
            }}
          />
        )}

        {activePanel === 'pipeline-settings' && <PipelineSettings />}

        {activePanel === 'config' && (
          <ConfigurationPanel
            onNavigate={(panel) => setActivePanel(panel as Panel)}
            onExportZip={handleExportZip}
            isExportingZip={isExportingZip}
          />
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
                <p className="text-xs text-slate-400 mt-0.5">{activeFile.path}</p>
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

        {(activePanel === 'submit-space' || activePanel === 'live-queue') && (
          <div className="flex-1 min-h-0 flex flex-col">
            <div role="tablist" aria-label="Ingest" className="flex-shrink-0 flex items-center gap-1 px-6 md:px-12 pt-4 border-b border-slate-800/80">
              {([
                ['submit-space', 'Submit a Space'],
                ['live-queue', 'Queue'],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={activePanel === id}
                  onClick={() => setActivePanel(id)}
                  className={`px-4 py-2 text-xs font-semibold rounded-t-lg border-b-2 -mb-px transition-colors cursor-pointer ${
                    activePanel === id
                      ? 'text-indigo-300 border-indigo-400'
                      : 'text-slate-400 border-transparent hover:text-slate-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              {activePanel === 'submit-space' ? (
                <SubmitSpacePanel
                  config={config}
                  onViewRunHistory={() => setActivePanel('run-history')}
                />
              ) : (
                <LiveQueuePanel config={config} />
              )}
            </div>
          </div>
        )}

        {activePanel === 'deploy' && (
          <DeployWizard config={config} />
        )}

        {activePanel === 'library' && (
          <LibraryPanel
            config={config}
            onOpenTranscript={(id) => {
              setSelectedTranscriptId(id);
              setActivePanel('transcripts');
            }}
          />
        )}

        {activePanel === 'transcripts' && (
          <TranscriptPanel
            config={config}
            initialReleaseId={selectedTranscriptId}
          />
        )}

        {activePanel === 'investigative-radar' && (
          <InvestigativeRadar
            config={config}
            onOpenTranscript={(id) => {
              setSelectedTranscriptId(id);
              setActivePanel('transcripts');
            }}
          />
        )}

        {activePanel === 'clips' && (
          <ClipsPanel config={config} />
        )}

        {activePanel === 'montage' && (
          <MontageStudio config={config} />
        )}

        {activePanel === 'voice-profiles' && (
          <VoiceProfileLibrary
            config={config}
            onOpenTranscript={(id) => {
              setSelectedTranscriptId(id);
              setActivePanel('transcripts');
            }}
          />
        )}

        {activePanel === 'ai-copilot' && (
          <AICopilotPanel />
        )}
        </Suspense>
        </PanelErrorBoundary>
      </main>
      <PlayerBar />
      <MontageReelDrawer isHidden={activePanel === 'montage'} />
    </div>
    </CopilotProvider>
    </MontageProvider>
    </PlayerProvider>
  );
}

export default function App() {
  return (
    <ConfigProvider>
      <AppContent />
    </ConfigProvider>
  );
}
