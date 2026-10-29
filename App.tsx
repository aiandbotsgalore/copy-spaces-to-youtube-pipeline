import React, { useState, useEffect, useCallback, useRef, Suspense, Component } from 'react';
import {
  Terminal, Settings, FolderGit2, FileText, Zap,
  Github, Eye, History, Rocket, ChevronRight, ChevronDown,
  Mic2, BookOpen, FlaskConical, Clock, Library, FileSearch, PlusCircle, LayoutDashboard, Flame, AudioWaveform,
  Film, Loader2, Archive, Bookmark, AlertCircle, CheckCircle2, Bot, Scale, Video,
  PanelLeftClose, PanelLeftOpen
} from 'lucide-react';
import PlayerBar from './components/PlayerBar';
import { PlayerProvider } from './contexts/PlayerContext';
import { MontageProvider } from './contexts/MontageContext';
import { CopilotProvider, useCopilot } from './contexts/CopilotContext';
import { ConfigProvider, useConfig, DEFAULT_CONFIG } from './contexts/ConfigContext';
import { MontageReelDrawer } from './components/MontageReelDrawer';
import { CopilotCommandPalette } from './components/copilot/CopilotCommandPalette';
import { PipelineHealthWidget } from './components/PipelineHealthWidget';
import { EnhancedConfig, GitHubUser, PipelineFile } from './types';
import { loadStoredToken, saveToken } from './utils/storage';
import { validateToken } from './utils/github';
import { exportPipelineZip } from './utils/exportZip';
import { getActivePanelFromHash, syncHashWithPanel } from './components/registry/studios';

// Code-split / Lazy-loaded Panels
const DashboardOverview = React.lazy(() => import('./components/DashboardOverview'));
const SubmitSpacePanel = React.lazy(() => import('./components/SubmitSpacePanel'));
const LibraryPanel = React.lazy(() => import('./components/LibraryPanel'));
const TranscriptPanel = React.lazy(() => import('./components/TranscriptPanel'));
const ClipsPanel = React.lazy(() => import('./components/ClipsPanel').then(m => ({ default: m.ClipsPanel })));
const InvestigativeRadar = React.lazy(() => import('./components/InvestigativeRadar').then(m => ({ default: m.InvestigativeRadar })));
const MontageStudio = React.lazy(() => import('./components/MontageStudio'));
const ScriptStudio = React.lazy(() => import('./components/ScriptStudio'));
const VoiceProfileLibrary = React.lazy(() => import('./components/VoiceProfileLibrary'));
const VoxStudio = React.lazy(() => import('./components/VoxStudio'));
const AvatarStudio = React.lazy(() => import('./components/AvatarStudio'));
const RunHistory = React.lazy(() => import('./components/RunHistory'));
const RSSPreview = React.lazy(() => import('./components/RSSPreview'));
const LiveQueuePanel = React.lazy(() => import('./components/LiveQueuePanel'));
const GitHubConnect = React.lazy(() => import('./components/GitHubConnect'));
const DeployWizard = React.lazy(() => import('./components/DeployWizard'));
const FeaturePanel = React.lazy(() => import('./components/FeaturePanel'));
const BatchUrlEditor = React.lazy(() => import('./components/BatchUrlEditor'));
const ConfigurationPanel = React.lazy(() => import('./components/ConfigurationPanel'));
const FileViewer = React.lazy(() => import('./components/FileViewer'));
const AICopilotPanel = React.lazy(() => import('./components/AICopilotPanel').then(m => ({ default: m.AICopilotPanel })));
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
  | 'script-studio'
  | 'voice-profiles'
  | 'vox-studio'
  | 'avatar-studio'
  | 'ai-copilot'
  | `file:${string}`;

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: string;
  badgeColor?: string;
  collapsed?: boolean;
}

const NavItem: React.FC<NavItemProps> = ({ icon, label, active, onClick, badge, badgeColor, collapsed }) => (
  <button
    onClick={onClick}
    title={collapsed ? label : undefined}
    className={`w-full flex items-center ${collapsed ? 'justify-center p-2.5' : 'justify-between px-3 py-2'} group text-sm font-medium rounded-lg transition-all ${
      active
        ? 'bg-indigo-500/15 text-indigo-300'
        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
    }`}
  >
    <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-3 min-w-0'}`}>
      <span className={active ? 'text-indigo-400' : 'text-slate-500 group-hover:text-slate-400'}>{icon}</span>
      {!collapsed && <span className="truncate">{label}</span>}
    </div>
    {!collapsed && (
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {badge && (
          <span className={`text-[11px] px-1.5 py-0.5 rounded font-bold ${badgeColor || 'bg-slate-700 text-slate-400'}`}>
            {badge}
          </span>
        )}
        {active && <ChevronRight size={12} className="opacity-50" />}
      </div>
    )}
  </button>
);

const CopilotAppBridge: React.FC<{
  setActivePanel: (panel: Panel) => void;
  setSelectedTranscriptId: (id: number | string | null) => void;
  activePanel: Panel;
}> = ({ setActivePanel, setSelectedTranscriptId, activePanel }) => {
  const { setActivePanelNavHandler, setLoadEpisodeHandler, setContextPayload } = useCopilot();

  useEffect(() => {
    setActivePanelNavHandler((panel: string) => {
      setActivePanel(panel as Panel);
    });
    setLoadEpisodeHandler((tag: string) => {
      setSelectedTranscriptId(tag);
      setActivePanel('transcripts');
    });
  }, [setActivePanelNavHandler, setLoadEpisodeHandler, setActivePanel, setSelectedTranscriptId]);

  useEffect(() => {
    setContextPayload(prev => ({
      ...prev,
      activeTab: activePanel,
    }));
  }, [activePanel, setContextPayload]);

  return null;
};

function AppContent() {
  const {
    config,
    updateConfig,
  } = useConfig();
  const [activePanel, setActivePanelState] = useState<Panel>(() => (getActivePanelFromHash() as Panel));
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const setActivePanel = useCallback((panel: Panel) => {
    setActivePanelState(panel);
    syncHashWithPanel(panel);
    setMobileNavOpen(false);
  }, []);

  useEffect(() => {
    const handleHashChange = () => {
      const p = getActivePanelFromHash() as Panel;
      setActivePanelState(p);
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);
  const [selectedTranscriptId, setSelectedTranscriptId] = useState<number | string | null>(null);
  const [githubUser, setGithubUser] = useState<GitHubUser | null>(null);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [studioSidebarCollapsed, setStudioSidebarCollapsed] = useState(true);
  const [isExportingZip, setIsExportingZip] = useState(false);

  const [transcriptNavCollapsed, setTranscriptNavCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('spacepipe:transcripts:nav-collapsed:v1') === 'true'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('spacepipe:transcripts:nav-collapsed:v1', String(transcriptNavCollapsed)); } catch {}
  }, [transcriptNavCollapsed]);
  useEffect(() => {
    const handlePreset = (event: Event) => {
      const preset = (event as CustomEvent<{ preset?: string }>).detail?.preset;
      if (preset === 'full') setTranscriptNavCollapsed(false);
      if (preset === 'compact' || preset === 'minimal') setTranscriptNavCollapsed(true);
    };
    window.addEventListener('spacepipe:transcript-layout', handlePreset);
    return () => window.removeEventListener('spacepipe:transcript-layout', handlePreset);
  }, []);
  const isSidebarRail = (activePanel === 'script-studio' && studioSidebarCollapsed) ||
    (activePanel === 'transcripts' && transcriptNavCollapsed);

  // Panels that live in the collapsed "Settings & Pipeline" group: open it so the active item is visible.
  useEffect(() => {
    if (
      activePanel === 'run-history' ||
      activePanel === 'rss-preview' ||
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
          <CopilotAppBridge
            setActivePanel={setActivePanel}
            setSelectedTranscriptId={setSelectedTranscriptId}
            activePanel={activePanel}
          />
        <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col md:flex-row font-sans">
      {/* Mobile navigation backdrop */}
      {mobileNavOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-slate-950/70 md:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      {/* ── Sidebar ── */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-[min(86vw,20rem)] flex-shrink-0 border-r border-slate-800/80 bg-slate-950 flex flex-col h-screen transition-transform duration-200 md:relative md:sticky md:top-0 md:translate-x-0 ${isSidebarRail ? 'md:w-14' : 'md:w-64'} ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {/* Logo & Collapse button */}
        <div className={`border-b border-slate-800/80 ${isSidebarRail ? 'p-2.5 flex flex-col items-center gap-2' : 'p-5'}`}>
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 bg-indigo-500/15 rounded-xl border border-indigo-500/20 shrink-0">
                <Mic2 className="text-indigo-400" size={isSidebarRail ? 16 : 20} />
              </div>
              {!isSidebarRail && (
                <div className="min-w-0">
                  <h1 className="font-bold text-base tracking-tight text-white leading-none truncate">SpacePipe Gen</h1>
                  <p className="text-[11px] text-slate-500 mt-0.5 truncate">Audio Pipeline Generator</p>
                </div>
              )}
            </div>
            {(activePanel === 'script-studio' || activePanel === 'transcripts') && (
              <button
                onClick={() => activePanel === 'transcripts'
                  ? setTranscriptNavCollapsed(c => !c)
                  : setStudioSidebarCollapsed(c => !c)}
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
                title={isSidebarRail ? "Expand Studio Sidebar" : "Collapse to 56px Rail"}
              >
                {isSidebarRail ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
              </button>
            )}
          </div>
        </div>

        {/* Nav */}
        <nav className={`flex-1 overflow-y-auto ${isSidebarRail ? 'py-3 px-1.5 space-y-3' : 'py-4 px-3 space-y-5'}`}>

          {/* TIER 1 — STUDIO / DAILY OPERATIONS */}
          <div>
            {!isSidebarRail ? (
              <p className="px-3 mb-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-500">🎙️ Studio</p>
            ) : (
              <div className="border-b border-slate-800/60 mb-2 mx-1" />
            )}
            <div className="space-y-1">
              <NavItem
                icon={<LayoutDashboard size={15} />}
                label="Command Center"
                active={activePanel === 'dashboard'}
                onClick={() => setActivePanel('dashboard')}
                collapsed={isSidebarRail}
              />
              <NavItem
                icon={<PlusCircle size={15} />}
                label="Ingest"
                active={activePanel === 'submit-space' || activePanel === 'live-queue'}
                onClick={() => setActivePanel('submit-space')}
                collapsed={isSidebarRail}
              />
              <NavItem
                icon={<Library size={15} />}
                label="Episode Library"
                active={activePanel === 'library'}
                onClick={() => setActivePanel('library')}
                collapsed={isSidebarRail}
              />
              <NavItem
                icon={<FileSearch size={15} />}
                label="Transcripts"
                active={activePanel === 'transcripts'}
                onClick={() => setActivePanel('transcripts')}
                collapsed={isSidebarRail}
              />
              <NavItem
                icon={<Scale size={16} />}
                label="Investigative Radar"
                active={activePanel === 'investigative-radar'}
                onClick={() => setActivePanel('investigative-radar')}
                badge="GraphRAG"
                badgeColor="bg-amber-500/20 text-amber-400 border border-amber-500/30"
                collapsed={isSidebarRail}
              />
              <NavItem
                icon={<Flame size={15} />}
                label="Best Clips"
                active={activePanel === 'clips'}
                onClick={() => setActivePanel('clips')}
                collapsed={isSidebarRail}
              />
              <NavItem
                icon={<Film size={15} />}
                label="Montage Studio"
                active={activePanel === 'montage'}
                onClick={() => setActivePanel('montage')}
                collapsed={isSidebarRail}
              />
              <NavItem
                icon={<FileText size={15} />}
                label="Script Studio"
                active={activePanel === 'script-studio'}
                onClick={() => setActivePanel('script-studio')}
                collapsed={isSidebarRail}
              />
              <NavItem
                icon={<AudioWaveform size={15} />}
                label="Voice Profiles"
                active={activePanel === 'voice-profiles'}
                onClick={() => setActivePanel('voice-profiles')}
                collapsed={isSidebarRail}
              />
              <NavItem
                icon={<Mic2 size={15} />}
                label="Vox Studio"
                active={activePanel === 'vox-studio'}
                onClick={() => setActivePanel('vox-studio')}
                badge="VoxCPM-2"
                badgeColor="bg-violet-500/20 text-violet-300 border border-violet-500/30"
                collapsed={isSidebarRail}
              />
              <NavItem
                icon={<Video size={15} />}
                label="Avatar Studio"
                active={activePanel === 'avatar-studio'}
                onClick={() => setActivePanel('avatar-studio')}
                badge="LivePortrait"
                badgeColor="bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                collapsed={isSidebarRail}
              />
              <NavItem
                icon={<Bot size={15} />}
                label="AI Copilot"
                active={activePanel === 'ai-copilot'}
                onClick={() => setActivePanel('ai-copilot')}
                collapsed={isSidebarRail}
              />
            </div>
          </div>

          {/* TIER 2 — SETTINGS & PIPELINE */}
          <div>
            {isSidebarRail ? (
              <div className="pt-2 border-t border-slate-800/60">
                <NavItem
                  icon={<Settings size={15} />}
                  label="Settings & Configuration"
                  active={settingsExpanded}
                  onClick={() => { setStudioSidebarCollapsed(false); setSettingsExpanded(true); }}
                  collapsed={true}
                />
              </div>
            ) : (
              <>
                <button
                  onClick={() => setSettingsExpanded(e => !e)}
                  className="w-full flex items-center justify-between px-3 mb-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-400 transition-colors"
                >
                  <span>⚙️ Settings &amp; Pipeline</span>
                  <ChevronDown size={12} className={`transition-transform ${settingsExpanded ? 'rotate-180' : ''}`} />
                </button>
                {settingsExpanded && (
                  <div className="space-y-1">
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
              </>
            )}
          </div>
        </nav>

        {!isSidebarRail && (
          <>
            <div className="p-3 border-t border-slate-800/80">
              <PipelineHealthWidget
                config={config}
                compact={true}
                onNavigateToGitHub={() => setActivePanel('github')}
              />
            </div>

            <div className="px-4 py-2 border-t border-slate-800/40 text-[11px] text-slate-500 text-center">
              Generated files comply with DevOps strict mode
            </div>
          </>
        )}
      </aside>

      {/* ── Main Content ── */}
      <main className="flex-1 min-w-0 flex flex-col h-screen overflow-hidden">
        <div className="md:hidden flex items-center gap-3 h-12 shrink-0 px-3 border-b border-slate-800/80 bg-slate-950">
          <button
            type="button"
            aria-label="Open navigation"
            onClick={() => setMobileNavOpen(true)}
            className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800"
          >
            <PanelLeftOpen size={18} />
          </button>
          <span className="text-sm font-semibold text-white truncate">SpacePipe Gen</span>
        </div>
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

        {activePanel === 'clips' && (
          <ClipsPanel config={config} />
        )}

        {activePanel === 'montage' && (
          <MontageStudio config={config} />
        )}

        {activePanel === 'script-studio' && (
          <ScriptStudio onOpenMontage={() => setActivePanel('montage')} />
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

        {activePanel === 'voice-profiles' && (
          <VoiceProfileLibrary
            config={config}
            onOpenTranscript={(id) => {
              setSelectedTranscriptId(id);
              setActivePanel('transcripts');
            }}
          />
        )}

        {activePanel === 'vox-studio' && (
          <VoxStudio config={config} />
        )}

        {activePanel === 'avatar-studio' && (
          <AvatarStudio config={config} />
        )}

        {activePanel === 'ai-copilot' && (
          <AICopilotPanel />
        )}
        </Suspense>
        </PanelErrorBoundary>
      </main>
      <PlayerBar />
      <MontageReelDrawer isHidden={activePanel === 'montage'} />
      <CopilotCommandPalette />
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
