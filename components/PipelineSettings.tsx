import React, { useCallback, useEffect, useState } from 'react';
import { Database, Film, HardDrive, Mic, Radio, Rocket, ShieldCheck, X } from 'lucide-react';
import { useConfig } from '../contexts/ConfigContext';
import { clearAllAudioCache, getAllCachedAudioKeys, pruneAudioCache } from '../utils/audioCache';

type Tag = 'live' | 'deploy' | 'pending';

const TAGS: Record<Tag, { text: string; title: string; cls: string }> = {
  live: { text: 'applies now', title: 'Takes effect immediately.', cls: 'text-emerald border-emerald/30 bg-emerald/10' },
  deploy: { text: 'applies on deploy', title: 'Written into the generated workflow files the next time you deploy.', cls: 'text-cyan border-cyan/30 bg-cyan/10' },
  pending: { text: 'saved · not wired yet', title: 'Saved in your config, but the generated workflow templates do not read it yet, so it has no effect on runs.', cls: 'text-amber border-amber/30 bg-amber/10' },
};

const TagChip: React.FC<{ tag: Tag }> = ({ tag }) => (
  <span title={TAGS[tag].title} className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${TAGS[tag].cls}`}>
    {TAGS[tag].text}
  </span>
);

const Section: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <section className="rounded-xl border border-line bg-card/60">
    <header className="flex items-center gap-2.5 px-5 py-3.5 border-b border-line">
      <span className="text-a0">{icon}</span>
      <h3 className="text-sm font-semibold text-white">{title}</h3>
    </header>
    <div className="divide-y divide-line">{children}</div>
  </section>
);

const Row: React.FC<{ label: string; hint?: string; tag?: Tag; children: React.ReactNode }> = ({ label, hint, tag, children }) => (
  <div className="flex items-center justify-between gap-6 px-5 py-3.5">
    <div className="min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[13px] text-slate-100">{label}</span>
        {tag && <TagChip tag={tag} />}
      </div>
      {hint && <p className="text-xs text-slate-400 mt-0.5 max-w-md">{hint}</p>}
    </div>
    <div className="flex-shrink-0">{children}</div>
  </div>
);

const Toggle: React.FC<{ on: boolean; onChange: (v: boolean) => void; label: string }> = ({ on, onChange, label }) => (
  <button
    role="switch"
    aria-checked={on}
    aria-label={label}
    onClick={() => onChange(!on)}
    className={`relative w-10 h-[22px] rounded-full border transition-colors cursor-pointer ${on ? 'bg-a1 border-a1' : 'bg-row border-line'}`}
  >
    <span className={`absolute top-[2px] left-[2px] w-4 h-4 rounded-full bg-white transition-transform ${on ? 'translate-x-[18px]' : ''}`} />
  </button>
);

const fieldCls = 'bg-row border border-line rounded-lg px-3 py-1.5 text-[13px] text-slate-100 focus:outline-none focus:border-a1';

const NumberField: React.FC<{ value: number; min: number; max: number; step?: number; onChange: (n: number) => void; label: string }> = ({ value, min, max, step = 1, onChange, label }) => (
  <input
    type="number"
    aria-label={label}
    value={value}
    min={min}
    max={max}
    step={step}
    onChange={e => {
      const n = Number(e.target.value);
      if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
    }}
    className={`${fieldCls} w-24 font-mono text-right`}
  />
);

const fmtBytes = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);

export const PipelineSettings: React.FC = () => {
  const { config, updateConfig } = useConfig();
  const [hostDraft, setHostDraft] = useState('');
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [cachedCount, setCachedCount] = useState(0);

  const refreshStorage = useCallback(async () => {
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.quota) setUsage({ used: est.usage ?? 0, quota: est.quota });
    } catch { /* estimate unsupported */ }
    setCachedCount((await getAllCachedAudioKeys()).length);
  }, []);
  useEffect(() => { refreshStorage(); }, [refreshStorage]);

  const hosts = config.watchedHosts ?? [];
  const addHost = () => {
    const h = hostDraft.trim().replace(/^@/, '');
    if (!h || hosts.includes(h)) { setHostDraft(''); return; }
    updateConfig({ watchedHosts: [...hosts, h] });
    setHostDraft('');
  };

  return (
    <div className="h-full overflow-y-auto bg-bg">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-5">
        <div>
          <h2 className="text-xl font-semibold text-white">Pipeline Settings</h2>
          <p className="text-sm text-slate-400 mt-1">
            Each setting is tagged: it applies now, applies when you redeploy, or is saved but not yet wired into the workflow templates.
          </p>
        </div>

        <Section icon={<Radio size={16} />} title="Ingest">
          <Row label="Scheduled monitoring" hint="Poll for new Spaces on the cron schedule below." tag="deploy">
            <Toggle on={config.enableScheduledMonitoring} onChange={v => updateConfig({ enableScheduledMonitoring: v })} label="Scheduled monitoring" />
          </Row>
          <Row label="Cron schedule" tag="deploy">
            <input
              aria-label="Cron schedule"
              value={config.scheduledCron}
              onChange={e => updateConfig({ scheduledCron: e.target.value })}
              className={`${fieldCls} w-40 font-mono`}
            />
          </Row>
          <Row label="Watched hosts" hint="Spaces from these hosts are picked up automatically." tag="pending">
            <div className="flex flex-col items-end gap-2 max-w-[320px]">
              <div className="flex flex-wrap gap-1.5 justify-end">
                {hosts.map(h => (
                  <span key={h} className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-a1/10 border border-a1/30 text-xs text-slate-100">
                    @{h}
                    <button aria-label={`Remove ${h}`} onClick={() => updateConfig({ watchedHosts: hosts.filter(x => x !== h) })} className="p-0.5 text-slate-400 hover:text-white cursor-pointer"><X size={11} /></button>
                  </span>
                ))}
              </div>
              <input
                aria-label="Add a watched host"
                placeholder="@handle, then Enter"
                value={hostDraft}
                onChange={e => setHostDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addHost(); } }}
                className={`${fieldCls} w-44`}
              />
            </div>
          </Row>
          <Row label="Concurrent downloads" tag="pending">
            <NumberField value={config.ingestConcurrency ?? 1} min={1} max={4} onChange={n => updateConfig({ ingestConcurrency: n })} label="Concurrent downloads" />
          </Row>
          <Row label="Audio format" tag="pending">
            <select aria-label="Audio format" value={config.audioFormat ?? 'mp3'} onChange={e => updateConfig({ audioFormat: e.target.value as 'mp3' | 'm4a' | 'opus' })} className={fieldCls}>
              <option value="mp3">MP3</option>
              <option value="m4a">M4A</option>
              <option value="opus">Opus</option>
            </select>
          </Row>
        </Section>

        <Section icon={<ShieldCheck size={16} />} title="Strict Mode">
          <Row label="Fail the run on any warning" hint="Stops publishing when a step reports a recoverable problem." tag="pending">
            <Toggle on={!!config.strictMode} onChange={v => updateConfig({ strictMode: v })} label="Strict mode" />
          </Row>
        </Section>

        <Section icon={<Mic size={16} />} title="Transcription">
          <Row label="Transcribe new episodes" tag="deploy">
            <Toggle on={config.enableTranscription} onChange={v => updateConfig({ enableTranscription: v })} label="Transcribe new episodes" />
          </Row>
          <Row label="Model" tag="pending">
            <select aria-label="Transcription model" value={config.transcriptionModel ?? 'large-v3'} onChange={e => updateConfig({ transcriptionModel: e.target.value })} className={fieldCls}>
              <option value="large-v3">large-v3</option>
              <option value="medium">medium</option>
              <option value="small">small</option>
            </select>
          </Row>
          <Row label="Language" tag="pending">
            <input aria-label="Transcription language" value={config.transcriptionLanguage ?? 'en'} onChange={e => updateConfig({ transcriptionLanguage: e.target.value })} className={`${fieldCls} w-20 font-mono`} />
          </Row>
          <Row label="Keep raw recordings" hint="Retain the original download next to the processed audio." tag="pending">
            <Toggle on={!!config.keepRawRecordings} onChange={v => updateConfig({ keepRawRecordings: v })} label="Keep raw recordings" />
          </Row>
        </Section>

        <Section icon={<Film size={16} />} title="Clips">
          <Row label="Minimum score" hint="Suggested-clip marks on the transcript timeline below this score are hidden." tag="live">
            <NumberField value={config.clipMinScore ?? 7} min={1} max={10} onChange={n => updateConfig({ clipMinScore: n })} label="Minimum clip score" />
          </Row>
          <Row label="Maximum length (seconds)" hint="Longer suggestions are hidden." tag="live">
            <NumberField value={config.clipMaxLengthSec ?? 180} min={15} max={900} step={15} onChange={n => updateConfig({ clipMaxLengthSec: n })} label="Maximum clip length" />
          </Row>
          <Row label="Auto-suggest clips after transcription" tag="pending">
            <Toggle on={config.autoSuggestClips ?? true} onChange={v => updateConfig({ autoSuggestClips: v })} label="Auto-suggest clips" />
          </Row>
        </Section>

        <Section icon={<Rocket size={16} />} title="Publishing">
          <Row label="Podcast title" tag="deploy">
            <input aria-label="Podcast title" value={config.podcastTitle} onChange={e => updateConfig({ podcastTitle: e.target.value })} className={`${fieldCls} w-64`} />
          </Row>
          <Row label="Author" tag="deploy">
            <input aria-label="Author" value={config.authorName} onChange={e => updateConfig({ authorName: e.target.value })} className={`${fieldCls} w-64`} />
          </Row>
          <Row label="Slack notifications" tag="deploy">
            <Toggle on={config.enableSlackWebhook} onChange={v => updateConfig({ enableSlackWebhook: v })} label="Slack notifications" />
          </Row>
          <Row label="Discord notifications" tag="deploy">
            <Toggle on={config.enableDiscordWebhook} onChange={v => updateConfig({ enableDiscordWebhook: v })} label="Discord notifications" />
          </Row>
        </Section>

        <Section icon={<HardDrive size={16} />} title="Storage">
          <Row label="Browser audio cache" hint={`${cachedCount} cached file${cachedCount === 1 ? '' : 's'}. Cached audio makes scrubbing instant.`} tag="live">
            <button
              onClick={async () => { await clearAllAudioCache(); refreshStorage(); }}
              disabled={cachedCount === 0}
              className="px-3 py-1.5 rounded-lg border border-line text-xs font-medium text-slate-200 hover:bg-row disabled:opacity-40 cursor-pointer"
            >
              Clear cache
            </button>
          </Row>
          <Row label="Cache retention" hint="Cached audio older than this is removed. Entries with no download date are kept." tag="live">
            <select
              aria-label="Cache retention"
              value={config.cacheRetentionDays ?? 0}
              onChange={async e => {
                const days = Number(e.target.value);
                updateConfig({ cacheRetentionDays: days });
                if (days > 0) { await pruneAudioCache(days); refreshStorage(); }
              }}
              className={fieldCls}
            >
              <option value={0}>Keep forever</option>
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </select>
          </Row>
          <div className="px-5 py-4">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
              <span className="flex items-center gap-1.5"><Database size={12} /> Browser storage used</span>
              <span className="font-mono">{usage ? `${fmtBytes(usage.used)} of ${fmtBytes(usage.quota)}` : 'unavailable'}</span>
            </div>
            <div className="h-1.5 rounded-full bg-row overflow-hidden">
              <div className="h-full bg-a1" style={{ width: usage ? `${Math.min(100, Math.max(1, (usage.used / usage.quota) * 100))}%` : '0%' }} />
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
};

export default PipelineSettings;
