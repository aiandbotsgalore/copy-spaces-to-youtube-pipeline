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

export type {
  SearchQueryAST,
} from './transcriptSearch';

export {
  parseGoogleQuery,
  escapeRegex,
  evaluateTurnMatch,
  hasActiveQuery,
  highlightTranscriptMatches,
  renderTranscriptMatch,
} from './transcriptSearch';

const WORKER_SCRIPT = `
let episodes = [];
let currentSearchId = 0;

function escapeRegex(str) {
  return str.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
}

function parseGoogleQuery(query) {
  var trimmed = (query || '').trim();
  var ast = {
    exactPhrases: [],
    mustTerms: [],
    excludedTerms: [],
    excludedPhrases: [],
    orGroups: []
  };

  if (!trimmed) return ast;

  var excludedPhraseRegex = /-"([^"]+)"/g;
  var match;
  while ((match = excludedPhraseRegex.exec(trimmed)) !== null) {
    if (match[1].trim()) ast.excludedPhrases.push(match[1].trim().toLowerCase());
  }

  var exactPhraseRegex = /(?<!-)"([^"]+)"/g;
  while ((match = exactPhraseRegex.exec(trimmed)) !== null) {
    if (match[1].trim()) ast.exactPhrases.push(match[1].trim().toLowerCase());
  }

  var unquoted = trimmed
    .replace(/-"[^"]+"/g, ' ')
    .replace(/"[^"]+"/g, ' ')
    .trim();

  var orSplit = unquoted.split(/\\s+OR\\s+|\\s*\\|\\s*/i);
  if (orSplit.length > 1) {
    ast.orGroups.push(
      orSplit
        .map(function(part) { return part.trim().toLowerCase(); })
        .filter(function(part) { return part.length > 0; })
    );
    return ast;
  }

  var tokens = unquoted.split(/\\s+/).filter(Boolean);
  for (var i = 0; i < tokens.length; i++) {
    var token = tokens[i];
    if (token.indexOf('-') === 0 && token.length > 1) {
      ast.excludedTerms.push(token.slice(1).toLowerCase());
    } else {
      ast.mustTerms.push(token.toLowerCase());
    }
  }

  return ast;
}

function hasActiveQuery(ast) {
  return (
    ast.exactPhrases.length > 0 ||
    ast.mustTerms.length > 0 ||
    ast.excludedTerms.length > 0 ||
    ast.excludedPhrases.length > 0 ||
    ast.orGroups.length > 0
  );
}

function evaluateTurnMatch(text, ast) {
  var normalizedText = text.toLowerCase();

  for (var i = 0; i < ast.excludedPhrases.length; i++) {
    var rx = new RegExp('\\\\b' + escapeRegex(ast.excludedPhrases[i]).replace(/\\s+/g, '[\\\\s,.:;!?\"\\\'\\\\-–—]+') + '\\\\b', 'i');
    if (rx.test(normalizedText)) return false;
  }

  for (var j = 0; j < ast.excludedTerms.length; j++) {
    var term = ast.excludedTerms[j];
    var leadingBoundary = /^\\w/.test(term) ? '\\\\b' : '';
    var trailingBoundary = /\\w$/.test(term) ? '\\\\b' : '';
    var rxTerm = new RegExp(leadingBoundary + escapeRegex(term) + trailingBoundary, 'i');
    if (rxTerm.test(normalizedText)) return false;
  }

  for (var k = 0; k < ast.exactPhrases.length; k++) {
    var rxPhrase = new RegExp('\\\\b' + escapeRegex(ast.exactPhrases[k]).replace(/\\s+/g, '[\\\\s,.:;!?\"\\\'\\\\-–—]+') + '\\\\b', 'i');
    if (!rxPhrase.test(normalizedText)) return false;
  }

  for (var m = 0; m < ast.orGroups.length; m++) {
    var group = ast.orGroups[m];
    var matchedAny = group.some(function(term) {
      var leading = /^\\w/.test(term) ? '\\\\b' : '';
      var trailing = /\\w$/.test(term) ? '\\\\b' : '';
      var rxOr = new RegExp(leading + escapeRegex(term).replace(/\\s+/g, '[\\\\s,.:;!?\"\\\'\\\\-–—]+') + trailing, 'i');
      return rxOr.test(normalizedText);
    });
    if (!matchedAny) return false;
  }

  for (var n = 0; n < ast.mustTerms.length; n++) {
    var mTerm = ast.mustTerms[n];
    var mLeading = /^\\w/.test(mTerm) ? '\\\\b' : '';
    var mTrailing = /\\w$/.test(mTerm) ? '\\\\b' : '';
    var rxMust = new RegExp(mLeading + escapeRegex(mTerm) + mTrailing, 'i');
    if (!rxMust.test(normalizedText)) return false;
  }

  return true;
}

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

    const ast = parseGoogleQuery(data.query || '');
    const queryActive = hasActiveQuery(ast);
    const speakerFilter = data.speakerFilter;
    const tagFilter = data.tagFilter;
    const catKeywords = data.categoryKeywords || [];
    const mentionKeywords = data.mentionKeywords || [];
    const mentionId = data.mentionId;

    // Fast exit if no filters active
    if (!queryActive && !speakerFilter && !tagFilter && !catKeywords.length && !mentionKeywords.length) {
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

        // Full-Text Google Search Query matching
        if (queryActive) {
          const searchTarget = seg._search || ((seg.speaker ? seg.speaker + ': ' : '') + (seg.text || ''));
          if (!evaluateTurnMatch(searchTarget, ast)) {
            continue;
          }
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

        if (results.length >= 300) {
          break;
        }
      }
      if (results.length >= 300) {
        break;
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
  private workerBlobUrl: string | null = null;
  private nextSearchId = 1;
  private pendingResolvers = new Map<number, (results: WorkerSearchResult[]) => void>();
  private isReady = false;

  constructor() {
    try {
      const blob = new Blob([WORKER_SCRIPT], { type: 'application/javascript' });
      this.workerBlobUrl = URL.createObjectURL(blob);
      this.worker = new Worker(this.workerBlobUrl);

      // Safe to revoke immediately after construction in modern browsers
      URL.revokeObjectURL(this.workerBlobUrl);
      this.workerBlobUrl = null;

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
      if (this.workerBlobUrl) {
        URL.revokeObjectURL(this.workerBlobUrl);
        this.workerBlobUrl = null;
      }
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
    if (this.workerBlobUrl) {
      URL.revokeObjectURL(this.workerBlobUrl);
      this.workerBlobUrl = null;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingResolvers.clear();
  }
}
