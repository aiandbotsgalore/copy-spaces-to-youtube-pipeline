/**
 * Web Worker-Offloaded SQLite WASM FTS5 Full-Text Search Engine
 * Backed by OPFS for persistence across 881+ episodes and 1,087,688 transcript turns.
 */

import {
  parseGoogleQuery,
  hasActiveQuery,
  evaluateTurnMatch,
  highlightTranscriptMatches,
  renderTranscriptMatch,
} from './transcriptSearch';

export type { SearchQueryAST } from './transcriptSearch';
export {
  parseGoogleQuery,
  escapeRegex,
  evaluateTurnMatch,
  hasActiveQuery,
  highlightTranscriptMatches,
  renderTranscriptMatch,
} from './transcriptSearch';

export interface WorkerSearchParams {
  query: string;
  episodeId?: string | number;
  speakerFilter?: string | null;
  tagFilter?: string | null;
  limit?: number;
  categoryKeywords?: string[];
  mentionKeywords?: string[];
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
  turn_id: string;
  episode_id: string | number;
  speaker: string;
  text: string;
  start_time: number;
  end_time: number | null;
  rank: number;
  id: string;
  startSec: number;
  endSec: number | null;
  release_id: number | string;
  release_tag: string;
  title?: string;
  published_at?: string;
  audio_url?: string;
  segment: {
    speaker: string;
    start: number;
    end: number | null;
    text: string;
    words?: { word: string; start: number; end: number }[];
  };
  segmentIndex?: number;
}

export class SearchWorkerClient {
  private worker: Worker | null = null;
  private nextSearchId = 1;
  private pendingResolvers = new Map<number, (results: WorkerSearchResult[]) => void>();
  private isReady = false;
  private episodesMeta = new Map<string | number, { title: string; published_at: string; audio_url: string }>();

  constructor() {
    try {
      if (typeof window !== 'undefined' && typeof Worker !== 'undefined') {
        this.worker = new Worker(new URL('../workers/fts-worker.ts', import.meta.url), {
          type: 'module',
        });

        this.worker.onmessage = (e: MessageEvent) => {
          const data = e.data;
          if (!data) return;

          if (data.type === 'READY') {
            this.isReady = true;
          } else if (data.type === 'BATCH_INGEST_COMPLETE' || data.type === 'INDEXED') {
            this.isReady = true;
          } else if (data.type === 'SEARCH_RESULTS' || data.type === 'RESULTS') {
            const resolver = this.pendingResolvers.get(data.id);
            if (resolver) {
              const enriched = (data.results || []).map((r: any, idx: number) => {
                const meta = this.episodesMeta.get(r.episode_id) || this.episodesMeta.get(Number(r.episode_id));
                return {
                  ...r,
                  title: r.title || meta?.title || '',
                  published_at: r.published_at || meta?.published_at || '',
                  audio_url: r.audio_url || meta?.audio_url || '',
                  segmentIndex: r.segmentIndex ?? idx,
                };
              });
              resolver(enriched);
              this.pendingResolvers.delete(data.id);
            }
          }
        };

        // Boot SQLite WASM and initialize schema
        this.worker.postMessage({ type: 'INIT' });
      }
    } catch (err) {
      console.warn('Web Workers not supported or blocked, falling back to main-thread search:', err);
      this.worker = null;
    }
  }

  public index(episodes: WorkerSearchEpisode[] | any[]): void {
    if (!this.worker || !episodes) return;
    for (const ep of episodes) {
      const epId = ep.release_id ?? ep.release_tag;
      if (epId) {
        this.episodesMeta.set(epId, {
          title: ep.title,
          published_at: ep.published_at,
          audio_url: ep.audio_url,
        });
        if (ep.release_tag) {
          this.episodesMeta.set(ep.release_tag, {
            title: ep.title,
            published_at: ep.published_at,
            audio_url: ep.audio_url,
          });
        }
      }
    }
    this.worker.postMessage({ type: 'BATCH_INGEST', episodes });
  }

  public batchIngestTurns(turns: any[], episodeId?: string | number): void {
    if (!this.worker) return;
    this.worker.postMessage({ type: 'BATCH_INGEST', turns, episodeId });
  }

  public deleteEpisode(episodeId: string | number): void {
    if (!this.worker) return;
    this.worker.postMessage({ type: 'DELETE_EPISODE', episodeId });
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
        episodeId: params.episodeId ?? params.tagFilter,
        speaker: params.speakerFilter,
        limit: params.limit || 50,
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
    this.pendingResolvers.clear();
  }
}
