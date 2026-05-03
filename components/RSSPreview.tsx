import React, { useState } from 'react';
import { Rss, Copy, Check, Play, ExternalLink, Music, RefreshCw, CheckCircle, AlertCircle, Loader } from 'lucide-react';
import { EnhancedConfig } from '../types';
import { fetchRssXml } from '../utils/github';

interface Props {
  config: EnhancedConfig;
}

interface LiveEpisode {
  title: string;
  duration: string;
  pubDate: string;
  url: string;
  size: string;
  guid: string;
}

function parseRssEpisodes(xml: string): LiveEpisode[] {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const items = Array.from(doc.querySelectorAll('item'));
    return items.map(item => {
      const enc = item.querySelector('enclosure');
      const dur = item.querySelector('duration');
      return {
        title: item.querySelector('title')?.textContent || 'Untitled',
        duration: dur?.textContent || '',
        pubDate: item.querySelector('pubDate')?.textContent || '',
        url: enc?.getAttribute('url') || '',
        size: enc ? formatBytes(Number(enc.getAttribute('length') || 0)) : '',
        guid: item.querySelector('guid')?.textContent || '',
      };
    });
  } catch {
    return [];
  }
}

function parseRssTitle(xml: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    return doc.querySelector('channel > title')?.textContent || '';
  } catch {
    return '';
  }
}

function formatBytes(b: number): string {
  if (!b) return '';
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function formatPubDate(d: string): string {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return d;
  }
}

const MOCK_EPISODES = [
  { title: 'Building in Public with the Community', duration: '1:12:34', pubDate: 'May 1, 2026', url: '', size: '98.2 MB', guid: '1' },
  { title: 'The Future of AI-Generated Podcasts', duration: '0:48:22', pubDate: 'Apr 28, 2026', url: '', size: '66.1 MB', guid: '2' },
  { title: 'Web3 and Creator Economies Deep Dive', duration: '1:05:09', pubDate: 'Apr 24, 2026', url: '', size: '89.4 MB', guid: '3' },
];

const RSSPreview: React.FC<Props> = ({ config }) => {
  const [copied, setCopied] = useState(false);
  const [liveXml, setLiveXml] = useState('');
  const [liveEpisodes, setLiveEpisodes] = useState<LiveEpisode[]>([]);
  const [liveTitle, setLiveTitle] = useState('');
  const [fetchState, setFetchState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [fetchError, setFetchError] = useState('');

  const rssUrl = `https://${config.ownerName.trim()}.github.io/${config.repoName.trim()}/podcast.xml`;
  const artwork = config.artworkDataUrl || config.imageUrl || null;

  const copyRss = () => {
    navigator.clipboard.writeText(rssUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const validateLiveFeed = async () => {
    if (!config.ownerName || !config.repoName) {
      setFetchError('Enter your GitHub username and repository name in Configuration first.');
      setFetchState('error');
      return;
    }
    setFetchState('loading');
    setFetchError('');
    try {
      const xml = await fetchRssXml(rssUrl);
      const episodes = parseRssEpisodes(xml);
      const title = parseRssTitle(xml);
      if (!xml.includes('<rss')) throw new Error('Response does not appear to be a valid RSS feed.');
      setLiveXml(xml);
      setLiveEpisodes(episodes);
      setLiveTitle(title);
      setFetchState('ok');
    } catch (e) {
      const msg = (e as Error).message;
      const friendly = msg === 'Failed to fetch'
        ? `Could not reach ${rssUrl} — the GitHub Pages site may not be deployed yet, or the repository name / username is incorrect.`
        : msg;
      setFetchError(friendly);
      setFetchState('error');
    }
  };

  const isLiveMode = fetchState === 'ok';
  const displayEpisodes = isLiveMode ? liveEpisodes : MOCK_EPISODES;

  return (
    <div className="h-full overflow-y-auto p-6 md:p-12 max-w-3xl mx-auto w-full">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white mb-2">RSS Feed Preview</h2>
        <p className="text-slate-400 text-sm">
          Preview your podcast feed. Use "Validate Live Feed" to fetch and verify the actual deployed feed.
        </p>
      </div>

      <div className="space-y-6">
        {/* RSS URL Card */}
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="flex items-center gap-2 mb-2">
            <Rss size={14} className="text-orange-400" />
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Feed URL</span>
          </div>
          <div className="flex items-center gap-2 mb-3">
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

          {/* Live validation */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={validateLiveFeed}
              disabled={fetchState === 'loading' || !config.ownerName || !config.repoName}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              {fetchState === 'loading' ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {fetchState === 'loading' ? 'Fetching…' : 'Validate Live Feed'}
            </button>

            {fetchState === 'ok' && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                <CheckCircle size={12} />
                Live feed valid · {liveEpisodes.length} episode{liveEpisodes.length !== 1 ? 's' : ''}
                {liveTitle && liveTitle !== config.podcastTitle && (
                  <span className="text-slate-500 ml-1">— "{liveTitle}"</span>
                )}
              </span>
            )}

            {fetchState === 'error' && (
              <span className="flex items-center gap-1.5 text-xs text-red-400">
                <AlertCircle size={12} />
                {fetchError}
              </span>
            )}
          </div>

          <p className="text-[10px] text-slate-600 mt-2">
            Submit this URL to Apple Podcasts, YouTube Podcasts, Spotify, or any podcast directory.
          </p>
        </div>

        {/* Podcast Player Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
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
              <div className="flex items-center gap-2 mb-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-400">Podcast</p>
                {isLiveMode && (
                  <span className="text-[9px] px-1.5 py-0.5 bg-emerald-500/15 text-emerald-400 rounded font-bold">LIVE</span>
                )}
              </div>
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

          <div className="px-5 pb-4 flex gap-2 flex-wrap">
            {['Apple Podcasts', 'Spotify', 'YouTube Podcasts'].map(s => (
              <div key={s} className="px-2.5 py-1 bg-slate-800 rounded-full text-[10px] text-slate-500 font-medium">{s}</div>
            ))}
          </div>

          {/* Episode list */}
          <div className="border-t border-slate-800">
            <div className="px-5 py-3 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Episodes</span>
              <span className="text-[10px] text-slate-600">
                {isLiveMode ? `${liveEpisodes.length} live episodes` : 'Sample preview'}
              </span>
            </div>
            <div className="divide-y divide-slate-800/50">
              {displayEpisodes.length === 0 && isLiveMode && (
                <p className="px-5 py-4 text-xs text-slate-600 text-center italic">No episodes in the live feed yet.</p>
              )}
              {displayEpisodes.map((ep, i) => (
                <div key={ep.guid || i} className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-800/30 transition-colors group">
                  <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-indigo-500/10 group-hover:bg-indigo-500/20 rounded-full transition-colors">
                    {ep.url ? (
                      <a href={ep.url} className="flex items-center justify-center w-full h-full">
                        <Play size={12} className="text-indigo-400 translate-x-0.5" />
                      </a>
                    ) : (
                      <Play size={12} className="text-indigo-400 translate-x-0.5" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{ep.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {formatPubDate(ep.pubDate)}
                      {ep.duration && ` · ${ep.duration}`}
                      {ep.size && ` · ${ep.size}`}
                    </p>
                  </div>
                  {ep.url && (
                    <a href={ep.url} className="p-1 text-slate-600 hover:text-slate-300 transition-colors" title="Download">
                      <ExternalLink size={12} />
                    </a>
                  )}
                </div>
              ))}
            </div>
            {!isLiveMode && (
              <div className="px-5 py-3 border-t border-slate-800/50">
                <p className="text-[10px] text-slate-700 italic text-center">
                  Live episodes appear after your first ingest run · Use "Validate Live Feed" to fetch actual data
                </p>
              </div>
            )}
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
