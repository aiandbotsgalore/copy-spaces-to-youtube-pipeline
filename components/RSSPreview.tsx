import React from 'react';
import { Rss, Copy, Check, Play, ExternalLink, Music } from 'lucide-react';
import { EnhancedConfig } from '../types';

interface Props {
  config: EnhancedConfig;
}

const MOCK_EPISODES = [
  { title: 'Building in Public with the Community', duration: '1:12:34', date: 'May 1, 2026', size: '98.2 MB' },
  { title: 'The Future of AI-Generated Podcasts', duration: '0:48:22', date: 'Apr 28, 2026', size: '66.1 MB' },
  { title: 'Web3 and Creator Economies Deep Dive', duration: '1:05:09', date: 'Apr 24, 2026', size: '89.4 MB' },
];

const RSSPreview: React.FC<Props> = ({ config }) => {
  const [copied, setCopied] = React.useState(false);

  const rssUrl = `https://${config.ownerName}.github.io/${config.repoName}/podcast.xml`;
  const artwork = config.artworkDataUrl || config.imageUrl || null;

  const copyRss = () => {
    navigator.clipboard.writeText(rssUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="h-full overflow-y-auto p-6 md:p-12 max-w-3xl mx-auto w-full">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white mb-2">RSS Feed Preview</h2>
        <p className="text-slate-400 text-sm">
          A preview of how your podcast will appear. The live feed will be available at your GitHub Pages URL after deployment.
        </p>
      </div>

      <div className="space-y-6">
        {/* RSS URL Card */}
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="flex items-center gap-2 mb-2">
            <Rss size={14} className="text-orange-400" />
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Feed URL</span>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 text-xs font-mono text-sky-400 bg-slate-950 px-3 py-2 rounded-lg border border-slate-800 truncate">
              {rssUrl}
            </code>
            <button
              onClick={copyRss}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
            >
              {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-[10px] text-slate-600 mt-2">
            Submit this URL to Apple Podcasts, YouTube Podcasts, Spotify for Podcasters, or any podcast directory.
          </p>
        </div>

        {/* Podcast Player Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          {/* Header */}
          <div className="flex items-start gap-4 p-5">
            <div className="flex-shrink-0 w-20 h-20 rounded-xl overflow-hidden bg-slate-800 ring-1 ring-slate-700">
              {artwork ? (
                <img src={artwork} alt="Artwork" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Music size={28} className="text-slate-600" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-400 mb-1">Podcast</p>
              <h3 className="text-lg font-bold text-white leading-tight truncate">
                {config.podcastTitle || 'Your Podcast Title'}
              </h3>
              <p className="text-sm text-slate-400 mt-0.5 truncate">
                {config.authorName || 'Author Name'}
              </p>
              <p className="text-xs text-slate-600 mt-1 line-clamp-2 leading-relaxed">
                {config.podcastDescription || 'Your podcast description will appear here.'}
              </p>
            </div>
          </div>

          {/* Submit links */}
          <div className="px-5 pb-4 flex gap-2 flex-wrap">
            {['Apple Podcasts', 'Spotify', 'YouTube Podcasts'].map(s => (
              <div key={s} className="px-2.5 py-1 bg-slate-800 rounded-full text-[10px] text-slate-500 font-medium">
                {s}
              </div>
            ))}
          </div>

          {/* Episode list */}
          <div className="border-t border-slate-800">
            <div className="px-5 py-3 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Episodes</span>
              <span className="text-[10px] text-slate-600">Sample preview</span>
            </div>
            <div className="divide-y divide-slate-800/50">
              {MOCK_EPISODES.map((ep, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-800/30 transition-colors group">
                  <button className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-indigo-500/10 group-hover:bg-indigo-500/20 rounded-full transition-colors">
                    <Play size={12} className="text-indigo-400 translate-x-0.5" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{ep.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{ep.date} · {ep.duration} · {ep.size}</p>
                  </div>
                  <div className="w-20 hidden sm:block">
                    <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-500/40 rounded-full" style={{ width: `${30 + i * 20}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-slate-800/50">
              <p className="text-[10px] text-slate-700 italic text-center">
                Live episodes will appear here after your first ingest run
              </p>
            </div>
          </div>
        </div>

        {/* Platform submission links */}
        <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Submit your feed</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {[
              { name: 'Apple Podcasts', url: 'https://podcastsconnect.apple.com/' },
              { name: 'YouTube Podcasts', url: 'https://www.youtube.com/podcasts' },
              { name: 'Spotify for Podcasters', url: 'https://podcasters.spotify.com/' },
              { name: 'Amazon Music / Audible', url: 'https://podcasters.amazon.com/' },
            ].map(p => (
              <a
                key={p.name}
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between px-3 py-2.5 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors group"
              >
                <span className="text-xs font-medium text-slate-300 group-hover:text-white transition-colors">{p.name}</span>
                <ExternalLink size={11} className="text-slate-600 group-hover:text-slate-400 transition-colors" />
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RSSPreview;
