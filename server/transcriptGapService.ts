import fs from 'node:fs';
import path from 'node:path';

export interface MissingEpisodeItem {
  tag: string;
  name: string;
  dateDisplay?: string;
  timestampMs?: number;
  audioUrl?: string;
  audioSizeBytes?: number;
}

export interface TranscriptGapReport {
  totalReleases: number;
  transcribedCount: number;
  missingCount: number;
  missingEpisodes: MissingEpisodeItem[];
}

/**
 * Normalizes recorded timestamp from GitHub release metadata or tag name.
 */
export function extractRecordedDate(rel: { body?: string; tag_name?: string; name?: string; published_at?: string; created_at?: string }): { timestampMs: number; dateDisplay: string } {
  const body = rel.body || '';

  const mMeta = body.match(/METADATA::(?:EPISODE_DATE|DATE)::(\d{4})[-/]?(\d{2})[-/]?(\d{2})/);
  if (mMeta) {
    const [, y, m, d] = mMeta;
    return { timestampMs: Date.UTC(Number(y), Number(m) - 1, Number(d)), dateDisplay: `${y}-${m}-${d}` };
  }

  const mRec = body.match(/\*\*Recorded:\*\*\s*(\d{4})[-/]?(\d{2})[-/]?(\d{2})/);
  if (mRec) {
    const [, y, m, d] = mRec;
    return { timestampMs: Date.UTC(Number(y), Number(m) - 1, Number(d)), dateDisplay: `${y}-${m}-${d}` };
  }

  const tag = rel.tag_name || '';
  const mTag = tag.match(/^(?:v)?(\d{4})[-_]?(\d{2})[-_]?(\d{2})/);
  if (mTag) {
    const [, y, m, d] = mTag;
    return { timestampMs: Date.UTC(Number(y), Number(m) - 1, Number(d)), dateDisplay: `${y}-${m}-${d}` };
  }

  const fallback = rel.published_at || rel.created_at;
  if (fallback) {
    const dt = new Date(fallback);
    if (!isNaN(dt.getTime())) {
      return { timestampMs: dt.getTime(), dateDisplay: dt.toISOString().slice(0, 10) };
    }
  }

  return { timestampMs: 0, dateDisplay: 'Unknown Date' };
}

/**
 * Diffs repository releases against public/transcripts/episodes to isolate untranscribed episodes with audio.
 */
export function diffTranscriptGaps(
  releases: Array<{
    tag_name?: string;
    name?: string;
    body?: string;
    assets?: Array<{ name: string; size?: number; browser_download_url?: string }>;
    published_at?: string;
    created_at?: string;
  }>,
  episodesDir: string = path.resolve(process.cwd(), 'public/transcripts/episodes')
): TranscriptGapReport {
  const localTags = new Set<string>();

  if (fs.existsSync(episodesDir)) {
    try {
      const files = fs.readdirSync(episodesDir);
      for (const f of files) {
        if (f.endsWith('.json')) {
          localTags.add(f.replace(/\.json$/, ''));
        }
      }
    } catch {
      // ignore
    }
  }

  const missingEpisodes: MissingEpisodeItem[] = [];
  let validAudioReleasesCount = 0;

  for (const rel of releases) {
    const tag = (rel.tag_name || '').trim();
    if (!tag) continue;

    const assets = rel.assets || [];
    const mp3Assets = assets.filter(a => a.name.endsWith('.mp3') && !/^\d+(?:h\d+)?m\d+s_/.test(a.name));
    const audioAsset = mp3Assets[0] || assets.find(a => a.name.endsWith('.mp3'));

    const isPlaceholder = tag.startsWith('test-placeholder') || (rel.name || '').toLowerCase().includes('placeholder') || (audioAsset?.size || 0) < 5000;
    if (!audioAsset || isPlaceholder) {
      continue;
    }

    validAudioReleasesCount++;

    const hasLocalJson = localTags.has(tag);
    const hasReleaseJson = assets.some(a => (a.name.endsWith('.json') && !a.name.endsWith('_clips.json') && a.name !== 'clips_catalog.json') && (a.size || 0) > 100);

    if (!hasLocalJson && !hasReleaseJson) {
      const { timestampMs, dateDisplay } = extractRecordedDate(rel);
      missingEpisodes.push({
        tag,
        name: rel.name || tag,
        dateDisplay,
        timestampMs,
        audioUrl: audioAsset.browser_download_url,
        audioSizeBytes: audioAsset.size,
      });
    }
  }

  // Sort chronologically newest to oldest
  missingEpisodes.sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0));

  const totalReleases = releases.length;
  const missingCount = missingEpisodes.length;
  const transcribedCount = localTags.size;

  return {
    totalReleases,
    transcribedCount,
    missingCount,
    missingEpisodes,
  };
}

/**
 * Appends untranscribed tags to batch_queue.txt for sequential ingestion.
 */
export function enqueueMissingTranscripts(
  missingTags: string[],
  batchQueuePath: string = path.resolve(process.cwd(), 'batch_queue.txt')
): { enqueued: number; totalInQueue: number } {
  const existing = new Set<string>();
  if (fs.existsSync(batchQueuePath)) {
    try {
      const lines = fs.readFileSync(batchQueuePath, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
      for (const l of lines) existing.add(l);
    } catch {
      // ignore
    }
  }

  const toAdd: string[] = [];
  for (const tag of missingTags) {
    if (!existing.has(tag)) {
      toAdd.push(tag);
      existing.add(tag);
    }
  }

  if (toAdd.length > 0) {
    fs.appendFileSync(batchQueuePath, '\n' + toAdd.join('\n') + '\n', 'utf8');
  }

  return {
    enqueued: toAdd.length,
    totalInQueue: existing.size,
  };
}
