import React, { useState } from 'react';
import { Rocket, CheckCircle, XCircle, Loader, Github, ExternalLink, AlertCircle, RefreshCw } from 'lucide-react';
import { EnhancedConfig, DeployStep } from '../types';
import { repoExists, createRepo, pushFile, enablePages, dataUrlToBase64 } from '../utils/github';
import {
  generateIngestYaml,
  generateIngestScript,
  generateReadme,
  generateQueueFile,
  generateTestAudioYaml,
  generateMonitorYaml,
} from '../utils/templates';

interface Props {
  config: EnhancedConfig;
}

type DeployState = 'idle' | 'running' | 'done' | 'error';

const initialSteps = (config: EnhancedConfig): DeployStep[] => {
  const steps: DeployStep[] = [
    { id: 'validate', label: 'Validate configuration', status: 'pending' },
    { id: 'repo', label: 'Create or connect repository', status: 'pending' },
    { id: 'workflow', label: 'Push workflow files', status: 'pending' },
    { id: 'script', label: 'Push ingest script', status: 'pending' },
    { id: 'queue', label: 'Push queue files', status: 'pending' },
    { id: 'readme', label: 'Push documentation', status: 'pending' },
  ];
  if (config.artworkDataUrl) {
    steps.push({ id: 'artwork', label: 'Upload artwork', status: 'pending' });
  }
  if (config.enableScheduledMonitoring) {
    steps.push({ id: 'monitor', label: 'Push monitor workflow', status: 'pending' });
  }
  steps.push({ id: 'pages', label: 'Configure GitHub Pages', status: 'pending' });
  return steps;
};

const StepRow: React.FC<{ step: DeployStep }> = ({ step }) => (
  <div className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
    step.status === 'running' ? 'bg-indigo-500/10' :
    step.status === 'done' ? 'bg-emerald-500/5' :
    step.status === 'error' ? 'bg-red-500/10' : 'bg-slate-900/50'
  }`}>
    <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
      {step.status === 'pending' && <span className="w-2 h-2 rounded-full bg-slate-700" />}
      {step.status === 'running' && <Loader size={16} className="text-indigo-400 animate-spin" />}
      {step.status === 'done' && <CheckCircle size={16} className="text-emerald-400" />}
      {step.status === 'error' && <XCircle size={16} className="text-red-400" />}
    </div>
    <div className="flex-1 min-w-0">
      <span className={`text-sm ${
        step.status === 'running' ? 'text-white font-medium' :
        step.status === 'done' ? 'text-emerald-300' :
        step.status === 'error' ? 'text-red-400' :
        'text-slate-500'
      }`}>{step.label}</span>
      {step.message && (
        <p className={`text-xs mt-0.5 ${step.status === 'error' ? 'text-red-400' : 'text-slate-500'}`}>
          {step.message}
        </p>
      )}
    </div>
  </div>
);

const DeployWizard: React.FC<Props> = ({ config }) => {
  const [steps, setSteps] = useState<DeployStep[]>([]);
  const [deployState, setDeployState] = useState<DeployState>('idle');
  const [repoUrl, setRepoUrl] = useState('');

  const isReady = config.githubToken && config.ownerName && config.repoName;

  const updateStep = (
    setter: React.Dispatch<React.SetStateAction<DeployStep[]>>,
    id: string,
    updates: Partial<DeployStep>
  ) => {
    setter(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const deploy = async () => {
    const freshSteps = initialSteps(config);
    setSteps(freshSteps);
    setDeployState('running');
    setRepoUrl('');

    const update = (id: string, updates: Partial<DeployStep>) =>
      setSteps(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));

    const { githubToken: token, ownerName: owner, repoName: repo } = config;
    const fullRepoUrl = `https://github.com/${owner}/${repo}`;

    try {
      // Step 1: Validate
      update('validate', { status: 'running' });
      if (!token || !owner || !repo) throw Object.assign(new Error('Missing token, owner, or repo name.'), { stepId: 'validate' });
      if (config.batchUrls?.some(u => u.trim() && !u.startsWith('http')))
        throw Object.assign(new Error('Some batch URLs appear invalid.'), { stepId: 'validate' });
      update('validate', { status: 'done', message: `Deploying to ${owner}/${repo}` });

      // Step 2: Repo
      update('repo', { status: 'running' });
      const exists = await repoExists(token, owner, repo);
      if (!exists) {
        await createRepo(token, repo, config.podcastDescription || `${config.podcastTitle} — SpacePipe`);
        update('repo', { status: 'done', message: 'Created new repository' });
      } else {
        update('repo', { status: 'done', message: 'Connected to existing repository' });
      }
      setRepoUrl(fullRepoUrl);

      // Brief pause for new repos to initialize
      if (!exists) await new Promise(r => setTimeout(r, 2000));

      // Step 3: Workflow files
      update('workflow', { status: 'running' });
      await pushFile(token, owner, repo, '.github/workflows/ingest.yml', generateIngestYaml(config), 'ci: add SpacePipe ingest workflow');
      await pushFile(token, owner, repo, '.github/workflows/test_audio.yml', generateTestAudioYaml(config), 'ci: add audio test workflow');
      update('workflow', { status: 'done' });

      // Step 4: Ingest script
      update('script', { status: 'running' });
      await pushFile(token, owner, repo, 'scripts/ingest.sh', generateIngestScript(config), 'chore: add ingest script');
      const requirements = config.enableTranscription ? 'yt-dlp\nopenai-whisper\n' : 'yt-dlp\n';
      await pushFile(token, owner, repo, 'requirements.txt', requirements, 'chore: add requirements.txt');
      update('script', { status: 'done' });

      // Step 5: Queue files
      update('queue', { status: 'running' });
      await pushFile(token, owner, repo, 'space_queue.txt', '# SpacePipe: paste a URL here and commit to trigger the pipeline\n', 'chore: initialize space queue [skip ci]');
      if (config.batchUrls?.filter(u => u.trim()).length > 0) {
        await pushFile(token, owner, repo, 'batch_queue.txt', generateQueueFile(config), 'chore: initialize batch queue with URLs');
      } else {
        await pushFile(token, owner, repo, 'batch_queue.txt', '', 'chore: initialize batch queue');
      }
      update('queue', { status: 'done' });

      // Step 6: README
      update('readme', { status: 'running' });
      await pushFile(token, owner, repo, 'README.md', generateReadme(config), 'docs: add SpacePipe README');
      update('readme', { status: 'done' });

      // Step 7: Artwork (conditional)
      if (steps.find(s => s.id === 'artwork')) {
        update('artwork', { status: 'running' });
        try {
          const base64 = await dataUrlToBase64(config.artworkDataUrl);
          await pushFile(token, owner, repo, 'artwork.jpg', base64, 'chore: add podcast artwork', true);
          update('artwork', { status: 'done' });
        } catch {
          update('artwork', { status: 'error', message: 'Artwork upload failed (non-critical)' });
        }
      }

      // Step 8: Monitor workflow (conditional)
      if (steps.find(s => s.id === 'monitor')) {
        update('monitor', { status: 'running' });
        await pushFile(token, owner, repo, '.github/workflows/monitor.yml', generateMonitorYaml(config), 'ci: add batch queue monitor workflow');
        update('monitor', { status: 'done' });
      }

      // Step 9: GitHub Pages
      update('pages', { status: 'running' });
      try {
        await enablePages(token, owner, repo);
        update('pages', { status: 'done', message: 'Pages configured via Actions' });
      } catch {
        update('pages', { status: 'done', message: 'Pages will be configured on first workflow run' });
      }

      setDeployState('done');
    } catch (e) {
      const err = e as Error & { stepId?: string };
      const failId = err.stepId || steps.find(s => s.status === 'running')?.id || 'validate';
      setSteps(prev => prev.map(s =>
        s.id === failId ? { ...s, status: 'error', message: err.message } :
        s.status === 'running' ? { ...s, status: 'error' } : s
      ));
      setDeployState('error');
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 md:p-12 max-w-2xl mx-auto w-full">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white mb-2">Deploy to GitHub</h2>
        <p className="text-slate-400 text-sm">
          Push all generated pipeline files directly to your GitHub repository in one click.
        </p>
      </div>

      {!isReady ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="p-4 bg-slate-800 rounded-2xl mb-4">
            <AlertCircle size={28} className="text-slate-500" />
          </div>
          <p className="text-slate-400 text-sm font-medium">Setup required</p>
          <p className="text-slate-600 text-xs mt-2 max-w-xs">
            Connect your GitHub account and fill in Repository Details in the Configuration panel before deploying.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Pre-flight summary */}
          {deployState === 'idle' && (
            <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">What will be deployed</p>
              <div className="space-y-2 text-sm text-slate-400">
                <div className="flex justify-between"><span>Repository</span><span className="text-sky-400 font-mono text-xs">{config.ownerName}/{config.repoName}</span></div>
                <div className="flex justify-between"><span>Podcast</span><span className="text-slate-300 text-right truncate max-w-48">{config.podcastTitle}</span></div>
                <div className="flex justify-between"><span>Transcription</span><span className={config.enableTranscription ? 'text-emerald-400' : 'text-slate-600'}>{config.enableTranscription ? 'Enabled' : 'Disabled'}</span></div>
                <div className="flex justify-between"><span>Slack alerts</span><span className={config.enableSlackWebhook ? 'text-emerald-400' : 'text-slate-600'}>{config.enableSlackWebhook ? 'Enabled' : 'Disabled'}</span></div>
                <div className="flex justify-between"><span>Discord alerts</span><span className={config.enableDiscordWebhook ? 'text-emerald-400' : 'text-slate-600'}>{config.enableDiscordWebhook ? 'Enabled' : 'Disabled'}</span></div>
                <div className="flex justify-between"><span>Batch monitor</span><span className={config.enableScheduledMonitoring ? 'text-emerald-400' : 'text-slate-600'}>{config.enableScheduledMonitoring ? config.scheduledCron || 'Enabled' : 'Disabled'}</span></div>
                <div className="flex justify-between"><span>Queued URLs</span><span className="text-slate-300">{config.batchUrls?.filter(u => u.trim()).length || 0}</span></div>
                <div className="flex justify-between"><span>Artwork</span><span className={config.artworkDataUrl ? 'text-emerald-400' : 'text-slate-600'}>{config.artworkDataUrl ? 'Upload' : config.imageUrl ? 'URL (not uploaded)' : 'None'}</span></div>
              </div>
              <button
                onClick={deploy}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl shadow-lg shadow-indigo-500/20 transition-all active:scale-95"
              >
                <Rocket size={18} />
                Deploy Pipeline
              </button>
            </div>
          )}

          {/* Steps progress */}
          {steps.length > 0 && (
            <div className="space-y-2">
              {steps.map(step => <StepRow key={step.id} step={step} />)}
            </div>
          )}

          {/* Success */}
          {deployState === 'done' && (
            <div className="p-5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle size={20} className="text-emerald-400" />
                <span className="text-base font-semibold text-emerald-400">Deployment complete!</span>
              </div>
              <p className="text-sm text-slate-400">
                All pipeline files have been pushed. The ingest workflow will trigger when you add a URL to <code className="bg-slate-800 px-1 rounded text-slate-300">space_queue.txt</code> or run it manually.
              </p>
              <div className="flex gap-2 flex-wrap">
                {repoUrl && (
                  <a href={repoUrl} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors">
                    <Github size={13} />
                    Open Repository
                  </a>
                )}
                {repoUrl && (
                  <a href={`${repoUrl}/actions`} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors">
                    <ExternalLink size={13} />
                    View Actions
                  </a>
                )}
              </div>
              <button
                onClick={() => { setDeployState('idle'); setSteps([]); }}
                className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                <RefreshCw size={12} />
                Deploy again
              </button>
            </div>
          )}

          {/* Error retry */}
          {deployState === 'error' && (
            <button
              onClick={deploy}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl transition-colors"
            >
              <RefreshCw size={16} />
              Retry Deployment
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default DeployWizard;
