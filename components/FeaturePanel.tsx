import React from 'react';
import { Mic, Bell, BellOff, Clock, Zap, Info } from 'lucide-react';
import { EnhancedConfig } from '../types';

interface Props {
  config: EnhancedConfig;
  onChange: (updates: Partial<EnhancedConfig>) => void;
}

interface ToggleRowProps {
  enabled: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
  badge?: string;
  children?: React.ReactNode;
}

const ToggleRow: React.FC<ToggleRowProps> = ({ enabled, onToggle, icon, title, description, badge, children }) => (
  <div className={`p-5 rounded-xl border transition-colors ${enabled ? 'bg-indigo-500/5 border-indigo-500/30' : 'bg-slate-900 border-slate-800'}`}>
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <div className={`p-2 rounded-lg mt-0.5 ${enabled ? 'bg-indigo-500/20 text-indigo-400' : 'bg-slate-800 text-slate-500'}`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-white">{title}</span>
            {badge && (
              <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded font-medium">{badge}</span>
            )}
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">{description}</p>
        </div>
      </div>
      <button
        onClick={onToggle}
        className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors ${enabled ? 'bg-indigo-500' : 'bg-slate-700'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
      </button>
    </div>
    {enabled && children && <div className="mt-4 ml-11 space-y-3">{children}</div>}
  </div>
);

const FeaturePanel: React.FC<Props> = ({ config, onChange }) => {
  return (
    <div className="h-full overflow-y-auto p-6 md:p-12 max-w-3xl mx-auto w-full">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white mb-2">Pipeline Features</h2>
        <p className="text-slate-400 text-sm">
          Toggle optional pipeline steps. Enabled features are automatically injected into the generated workflow files.
        </p>
      </div>

      <div className="space-y-4">
        <ToggleRow
          enabled={config.enableTranscription}
          onToggle={() => onChange({ enableTranscription: !config.enableTranscription })}
          icon={<Mic size={16} />}
          title="AssemblyAI Diarized Transcription"
          badge="API key required"
          description="Transcribe each episode with speaker identification using AssemblyAI. Outputs a plain-text transcript with per-speaker timestamps and a JSON file with segment data. Requires an ASSEMBLYAI_API_KEY GitHub secret."
        >
          <div className="space-y-3">
            <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <Info size={13} className="text-amber-400 mt-0.5 flex-shrink-0" />
              <div className="space-y-1.5">
                <p className="text-xs text-amber-300/80 font-medium">Setup required — add your API key as a GitHub Secret</p>
                <ol className="text-[10px] text-amber-300/60 space-y-1 list-none">
                  <li>1. Get a free API key at <a href="https://www.assemblyai.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-amber-300">assemblyai.com</a></li>
                  <li>2. In your GitHub repo: Settings → Secrets and variables → Actions</li>
                  <li>3. Add a secret named <code className="bg-amber-900/30 px-1 rounded">ASSEMBLYAI_API_KEY</code></li>
                </ol>
              </div>
            </div>
            <div className="flex items-start gap-2 p-3 bg-slate-800/60 border border-slate-700 rounded-lg">
              <Info size={13} className="text-slate-500 mt-0.5 flex-shrink-0" />
              <div className="text-[10px] text-slate-500 space-y-0.5">
                <p>Transcript format: <code className="text-slate-400">[00:00:01 - 00:00:06] SPEAKER_A: text here</code></p>
                <p>Models tried in order: <code className="text-slate-400">universal-3-pro</code> → <code className="text-slate-400">universal-2</code></p>
                <p>Both <code className="text-slate-400">.txt</code> and <code className="text-slate-400">.json</code> files are uploaded to each GitHub Release.</p>
              </div>
            </div>
          </div>
        </ToggleRow>

        <ToggleRow
          enabled={config.enableSlackWebhook}
          onToggle={() => onChange({ enableSlackWebhook: !config.enableSlackWebhook })}
          icon={<Bell size={16} />}
          title="Slack Notifications"
          description="Post a message to a Slack channel whenever an episode is published or fails. Requires a Slack Incoming Webhook URL stored as a GitHub Secret."
        >
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-400">Preview Webhook URL</label>
            <input
              type="text"
              placeholder="https://hooks.slack.com/services/..."
              value={config.slackWebhookUrl}
              onChange={e => onChange({ slackWebhookUrl: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-indigo-500 transition-colors"
            />
            <p className="text-[10px] text-slate-600">
              This is for your reference only. The actual value must be set as <code className="bg-slate-800 px-1 rounded text-slate-400">SLACK_WEBHOOK_URL</code> in your repo's Secrets.
            </p>
          </div>
        </ToggleRow>

        <ToggleRow
          enabled={config.enableDiscordWebhook}
          onToggle={() => onChange({ enableDiscordWebhook: !config.enableDiscordWebhook })}
          icon={<BellOff size={16} />}
          title="Discord Notifications"
          description="Post a message to a Discord channel whenever an episode is published or fails. Requires a Discord Webhook URL stored as a GitHub Secret."
        >
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-400">Preview Webhook URL</label>
            <input
              type="text"
              placeholder="https://discord.com/api/webhooks/..."
              value={config.discordWebhookUrl}
              onChange={e => onChange({ discordWebhookUrl: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-indigo-500 transition-colors"
            />
            <p className="text-[10px] text-slate-600">
              Set as <code className="bg-slate-800 px-1 rounded text-slate-400">DISCORD_WEBHOOK_URL</code> in your repo's Secrets.
            </p>
          </div>
        </ToggleRow>

        <ToggleRow
          enabled={config.enableScheduledMonitoring}
          onToggle={() => onChange({ enableScheduledMonitoring: !config.enableScheduledMonitoring })}
          icon={<Clock size={16} />}
          title="Scheduled Batch Processing"
          description="Adds a monitor workflow that runs on a schedule and automatically promotes URLs from batch_queue.txt to the ingest pipeline one at a time."
        >
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-400">Cron Schedule (UTC)</label>
            <input
              type="text"
              placeholder="0 */2 * * *"
              value={config.scheduledCron}
              onChange={e => onChange({ scheduledCron: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-indigo-500 transition-colors"
            />
            <div className="flex gap-2 flex-wrap">
              {[
                { label: 'Every 2h', value: '0 */2 * * *' },
                { label: 'Every 6h', value: '0 */6 * * *' },
                { label: 'Daily', value: '0 9 * * *' },
                { label: 'Hourly', value: '0 * * * *' },
              ].map(p => (
                <button
                  key={p.value}
                  onClick={() => onChange({ scheduledCron: p.value })}
                  className={`px-2 py-1 text-[10px] rounded border transition-colors ${
                    config.scheduledCron === p.value
                      ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-400'
                      : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </ToggleRow>

        <div className="p-4 bg-slate-900/50 border border-slate-800 rounded-xl flex items-start gap-3">
          <Zap size={16} className="text-slate-500 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-slate-500">
            All enabled features are automatically reflected in the generated workflow YAML. Click <strong className="text-slate-400">Pipeline Files → Workflow</strong> to preview the output.
          </p>
        </div>
      </div>
    </div>
  );
};

export default FeaturePanel;
