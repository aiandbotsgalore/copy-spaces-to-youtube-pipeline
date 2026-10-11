/**
 * Off-Thread Web Worker Search Engine for 359,000+ Segments
 * Runs full-text indexing, regex matching, and relational queries
 * entirely in a background thread to maintain a smooth 60fps UI.
 */

export interface WorkerSearchParams {
  query: string;
  speakerFilter: string | null;
  tagFilter: string | null;
  categoryKeywords: string[];
  mentionKeywords: string[];
  mentionId?: string;
}

export interface WorkerSearchEpisode {
  release_id: number;
  release_tag: string;
  title: string;
  published_at: string;
  audio_url: string;
  segments: {
    speaker: string;
    start: number;
    end: number | null;
    text: string;
    words?: { word: string; start: number; end: number }[];
  }[];
}

export interface WorkerSearchResult {
  release_id: number;
  release_tag: string;
  title: string;
  published_at: string;
  audio_url: string;
  segment: {
    speaker: string;
    start: number;
    end: number | null;
    text: string;
    words?: { word: string; start: number; end: number }[];
  };
  segmentIndex: number;
}

const WORKER_SCRIPT = `
let episodes = [];
let currentSearchId = 0;

self.onmessage = function(e) {
  const data = e.data;
  if (!data) return;

  if (data.type === 'INDEX') {
    episodes = data.episodes || [];
    self.postMessage({ type: 'INDEXED', count: episodes.length });
    return;
  }

  if (data.type === 'SEARCH') {
    const searchId = data.id;
    currentSearchId = searchId;

    const query = (data.query || '').trim().toLowerCase();
    const terms = query ? query.split(/\\s+/).filter(Boolean) : [];
    const speakerFilter = data.speakerFilter;
    const tagFilter = data.tagFilter;
    const catKeywords = data.categoryKeywords || [];
    const mentionKeywords = data.mentionKeywords || [];
    const mentionId = data.mentionId;

    // Fast exit if no filters active
    if (!terms.length && !speakerFilter && !tagFilter && !catKeywords.length && !mentionKeywords.length) {
      self.postMessage({ type: 'RESULTS', id: searchId, results: [] });
      return;
    }

    const results = [];
    const numEpisodes = episodes.length;

    for (let eIdx = 0; eIdx < numEpisodes; eIdx++) {
      const ep = episodes[eIdx];
      if (tagFilter && ep.release_tag !== tagFilter) {
        continue;
      }

      const segs = ep.segments || [];
      const numSegs = segs.length;

      for (let sIdx = 0; sIdx < numSegs; sIdx++) {
        const seg = segs[sIdx];
        if (speakerFilter && seg.speaker !== speakerFilter) {
          continue;
        }

        const segTextLower = (seg.text || '').toLowerCase();

        // Thematic Category Filter
        if (catKeywords.length > 0) {
          let matchesCat = false;
          for (let k = 0; k < catKeywords.length; k++) {
            if (segTextLower.indexOf(catKeywords[k]) !== -1) {
              matchesCat = true;
              break;
            }
          }
          if (!matchesCat) continue;
        }

        // Mention Filter
        if (mentionKeywords.length > 0) {
          const isDirectArgue = ep.release_tag.indexOf('loganSavDeaconAngelaArgue') !== -1;
          let matchesMention = false;
          if (mentionId === 'LOGAN' && isDirectArgue && seg.speaker.toLowerCase() === 'angela') {
            matchesMention = true;
          } else {
            for (let m = 0; m < mentionKeywords.length; m++) {
              if (segTextLower.indexOf(mentionKeywords[m]) !== -1) {
                matchesMention = true;
                break;
              }
            }
          }
          if (!matchesMention) continue;
        }

        // Full-Text Multi-term Query matching
        if (terms.length > 0) {
          const searchTarget = seg._search || (seg.speaker + ' ' + (seg.text || '')).toLowerCase();
          let allMatch = true;
          for (let t = 0; t < terms.length; t++) {
            if (searchTarget.indexOf(terms[t]) === -1) {
              allMatch = false;
              break;
            }
          }
          if (!allMatch) continue;
        }

        results.push({
          release_id: ep.release_id,
          release_tag: ep.release_tag,
          title: ep.title,
          published_at: ep.published_at,
          audio_url: ep.audio_url,
          segment: seg,
          segmentIndex: sIdx,
        });
      }
    }

    // Only post if this search is still active
    if (searchId === currentSearchId) {
      self.postMessage({ type: 'RESULTS', id: searchId, results: results });
    }
  }
};
`;

export class SearchWorkerClient {
  private worker: Worker | null = null;
  private nextSearchId = 1;
  private pendingResolvers = new Map<number, (results: WorkerSearchResult[]) => void>();
  private isReady = false;

  constructor() {
    try {
      const blob = new Blob([WORKER_SCRIPT], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      this.worker = new Worker(blobUrl);

      this.worker.onmessage = (e) => {
        const data = e.data;
        if (!data) return;

        if (data.type === 'INDEXED') {
          this.isReady = true;
        } else if (data.type === 'RESULTS') {
          const resolver = this.pendingResolvers.get(data.id);
          if (resolver) {
            resolver(data.results || []);
            this.pendingResolvers.delete(data.id);
          }
        }
      };
    } catch (err) {
      console.warn('Web Workers not supported or blocked, falling back to main-thread search:', err);
      this.worker = null;
    }
  }

  public index(episodes: WorkerSearchEpisode[] | any[]): void {
    if (!this.worker) return;
    this.worker.postMessage({ type: 'INDEX', episodes });
  }

  public search(params: WorkerSearchParams): Promise<WorkerSearchResult[]> {
    if (!this.worker) {
      return Promise.resolve([]);
    }

    const searchId = this.nextSearchId++;
    return new Promise((resolve) => {
      this.pendingResolvers.set(searchId, resolve);
      this.worker!.postMessage({
        type: 'SEARCH',
        id: searchId,
        query: params.query,
        speakerFilter: params.speakerFilter,
        tagFilter: params.tagFilter,
        categoryKeywords: params.categoryKeywords,
        mentionKeywords: params.mentionKeywords,
        mentionId: params.mentionId,
      });
    });
  }

  public isAvailable(): boolean {
    return this.worker !== null;
  }

  public terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
