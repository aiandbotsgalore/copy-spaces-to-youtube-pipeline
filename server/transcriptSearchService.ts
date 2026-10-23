import fs from 'fs';
import path from 'path';

export interface TranscriptSearchResult {
  episodeTitle: string;
  releaseTag: string;
  audioUrl?: string;
  episodeDate?: string;
  speaker: string;
  startSec: number;
  endSec: number;
  text: string;
  relevanceScore?: number;
  matchType?: 'lexical' | 'vector' | 'hybrid' | 'proximity';
}

export interface EpisodeSummaryItem {
  release_id?: number;
  release_tag: string;
  title: string;
  published_at?: string;
  episode_date?: string;
  audio_url?: string;
  segment_count?: number;
  speakers?: string[];
  body?: string;
}

export interface EmbeddingManifestSegment {
  index: number;
  start: number;
  end: number;
  speaker: string;
  text: string;
}

export interface EmbeddingManifest {
  version: number;
  episodeTag: string;
  title?: string;
  dims: number;
  segmentCount: number;
  generatedAt: string;
  segments: EmbeddingManifestSegment[];
}

export interface SearchOptions {
  speaker?: string;
  episodeTag?: string;
  maxResults?: number;
  mode?: 'hybrid' | 'lexical' | 'vector';
  activeSegments?: Array<{ speaker: string; text: string; start: number; end: number }>;
}

let cachedSummaries: EpisodeSummaryItem[] | null = null;
let tagToFileMap: Map<string, string> | null = null;
const IN_MEMORY_EPISODES = new Map<string, Array<{ speaker: string; text: string; start: number; end: number }>>();

function resolvePath(...segments: string[]): string {
  return path.resolve(process.cwd(), ...segments);
}

export function registerEpisodeSegments(
  tag: string,
  segments: Array<{ speaker: string; text: string; start: number; end: number }>
) {
  if (!tag || !segments || segments.length === 0) return;
  IN_MEMORY_EPISODES.set(tag, segments);
  try {
    const cacheDir = resolvePath('.cache', 'transcripts');
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    const targetPath = path.join(cacheDir, `${tag}.json`);
    if (!fs.existsSync(targetPath)) {
      fs.writeFileSync(targetPath, JSON.stringify({ releaseTag: tag, segments }, null, 2), 'utf8');
      if (tagToFileMap) {
        tagToFileMap.set(tag, targetPath);
      }
    }
  } catch (err) {
    console.warn('[TranscriptSearchService] Failed to persist episode segments to cache:', err);
  }
}

export function loadSummaries(): EpisodeSummaryItem[] {
  if (cachedSummaries) return cachedSummaries;
  try {
    const summaryPath = resolvePath('public', 'transcripts', 'transcripts_summary_index.json');
    if (fs.existsSync(summaryPath)) {
      const raw = fs.readFileSync(summaryPath, 'utf8');
      cachedSummaries = JSON.parse(raw);
      return cachedSummaries || [];
    }
  } catch (err) {
    console.warn('[TranscriptSearchService] Failed to load transcripts_summary_index.json:', err);
  }
  return [];
}

export function getTagToFileMap(): Map<string, string> {
  if (tagToFileMap) return tagToFileMap;
  tagToFileMap = new Map();
  try {
    // 1. Scan .cache/transcripts
    const cacheDir = resolvePath('.cache', 'transcripts');
    if (fs.existsSync(cacheDir)) {
      const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json') && !f.endsWith('.embeddings.json'));
      for (const f of files) {
        const fullPath = path.join(cacheDir, f);
        const nameWithoutExt = f.replace('.json', '');
        const parts = nameWithoutExt.split('_');
        if (parts.length >= 2) {
          const tag = parts.slice(0, -1).join('_');
          tagToFileMap.set(tag, fullPath);
        }
        tagToFileMap.set(nameWithoutExt, fullPath);
      }
    }

    // 2. Scan public/transcripts/episodes
    const episodesDir = resolvePath('public', 'transcripts', 'episodes');
    if (fs.existsSync(episodesDir)) {
      const epFiles = fs.readdirSync(episodesDir).filter(f => f.endsWith('.json'));
      for (const f of epFiles) {
        const fullPath = path.join(episodesDir, f);
        const nameWithoutExt = f.replace('.json', '');
        if (!tagToFileMap.has(nameWithoutExt)) {
          tagToFileMap.set(nameWithoutExt, fullPath);
        }
        const parts = nameWithoutExt.split('_');
        if (parts.length >= 2) {
          const tag = parts.slice(0, 2).join('_');
          if (!tagToFileMap.has(tag)) {
            tagToFileMap.set(tag, fullPath);
          }
        }
      }
    }

    // 3. Map summary items by title and ID
    const summaries = loadSummaries();
    for (const s of summaries) {
      const existing = tagToFileMap.get(s.release_tag);
      if (existing) {
        if (s.release_id) tagToFileMap.set(String(s.release_id), existing);
        if (s.title) {
          tagToFileMap.set(s.title.toLowerCase().trim(), existing);
          tagToFileMap.set(s.title.toLowerCase().replace(/[^a-z0-9]/g, '_'), existing);
        }
      }
    }
  } catch (err) {
    console.warn('[TranscriptSearchService] Failed to read transcripts map:', err);
  }
  return tagToFileMap;
}

export function getArchiveStats(): {
  totalEpisodes: number;
  totalTranscriptsOnDisk: number;
  allSpeakersSample: string[];
} {
  const summaries = loadSummaries();
  const fileMap = getTagToFileMap();

  const allSpeakers = new Set<string>();
  for (const s of summaries) {
    if (Array.isArray(s.speakers)) {
      for (const sp of s.speakers) {
        if (sp && sp.trim() && !sp.startsWith('Speaker ')) {
          allSpeakers.add(sp.trim());
        }
      }
    }
  }

  return {
    totalEpisodes: summaries.length || 656,
    totalTranscriptsOnDisk: fileMap.size || 523,
    allSpeakersSample: Array.from(allSpeakers).slice(0, 15),
  };
}

/* ---------------------------------------------------------------------------------------------- */
/* Vector Embedding & Cosine Similarity Engine                                                    */
/* ---------------------------------------------------------------------------------------------- */

let embeddingPipelinePromise: Promise<any> | null = null;

export async function getQueryEmbedder() {
  if (!embeddingPipelinePromise) {
    const { pipeline, env } = await import('@xenova/transformers');
    const modelsDir = resolvePath('.cache', 'models');
    env.cacheDir = modelsDir;
    env.localModelPath = modelsDir;
    const localModelPath = resolvePath(modelsDir, 'Xenova', 'all-MiniLM-L6-v2');
    if (fs.existsSync(localModelPath)) {
      env.allowRemoteModels = false;
    }
    embeddingPipelinePromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true,
    });
  }
  return embeddingPipelinePromise;
}

export async function embedQuery(text: string): Promise<Float32Array | null> {
  const clean = text.trim();
  if (!clean) return null;
  try {
    const embedder = await getQueryEmbedder();
    const output = await embedder(clean, { pooling: 'mean', normalize: true });
    return new Float32Array(output.data);
  } catch (err) {
    console.warn('[TranscriptSearchService] Query embedding failed:', err);
    return null;
  }
}

/** Dot product between a subvector at offset in a Float32Array and a query vector (both 384 dims, normalized) */
export function dotProduct(a: Float32Array, aOffset: number, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < 384; i++) {
    sum += a[aOffset + i] * b[i];
  }
  return sum;
}

const EMBEDDINGS_CACHE = new Map<string, { manifest: EmbeddingManifest; vectors: Float32Array }>();

export function getEpisodeEmbeddings(tag: string): { manifest: EmbeddingManifest; vectors: Float32Array } | null {
  if (EMBEDDINGS_CACHE.has(tag)) {
    return EMBEDDINGS_CACHE.get(tag)!;
  }

  const cacheDir = resolvePath('.cache', 'transcripts');
  const binPath = path.join(cacheDir, `${tag}.embeddings.bin`);
  const manifestPath = path.join(cacheDir, `${tag}.embeddings.json`);

  if (!fs.existsSync(binPath) || !fs.existsSync(manifestPath)) {
    return null;
  }

  try {
    const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
    const manifest: EmbeddingManifest = JSON.parse(manifestRaw);

    const buf = fs.readFileSync(binPath);
    const vectors = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);

    const entry = { manifest, vectors };
    // Keep cache bounded to 50 active episode embeddings in memory
    if (EMBEDDINGS_CACHE.size >= 50) {
      const firstKey = EMBEDDINGS_CACHE.keys().next().value;
      if (firstKey) EMBEDDINGS_CACHE.delete(firstKey);
    }
    EMBEDDINGS_CACHE.set(tag, entry);
    return entry;
  } catch (err) {
    console.warn(`[TranscriptSearchService] Error loading embeddings for ${tag}:`, err);
    return null;
  }
}

export function getAvailableEmbeddingTags(): string[] {
  try {
    const cacheDir = resolvePath('.cache', 'transcripts');
    if (!fs.existsSync(cacheDir)) return [];
    return fs
      .readdirSync(cacheDir)
      .filter(f => f.endsWith('.embeddings.json'))
      .map(f => f.replace('.embeddings.json', ''));
  } catch {
    return [];
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* Lexical / Token Match Search                                                                   */
/* ---------------------------------------------------------------------------------------------- */

export function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const totalSec = Math.floor(seconds);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function parseTimestampSec(text: string): number | null {
  if (!text) return null;
  // Match HH:MM:SS or MM:SS (e.g. "47:42", "▶ 47:42", "@ 47:42", "1:47:42")
  const colonMatch = text.match(/(?:▶\s*|@\s*|\bat\s+)?\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b/);
  if (colonMatch) {
    const hrs = colonMatch[1] ? parseInt(colonMatch[1], 10) : 0;
    const mins = parseInt(colonMatch[2], 10);
    const secs = parseInt(colonMatch[3], 10);
    return hrs * 3600 + mins * 60 + secs;
  }
  // Match "2862s", "2862 sec", "2862 seconds", "2,862s"
  const secMatch = text.match(/\b([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)\s*(?:s\b|sec\b|secs\b|seconds\b)/i);
  if (secMatch) {
    const num = parseInt(secMatch[1].replace(/,/g, ''), 10);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

export async function searchTranscriptLexical(
  query: string,
  options: SearchOptions = {}
): Promise<TranscriptSearchResult[]> {
  const summaries = loadSummaries();
  const fileMap = getTagToFileMap();
  const max = options.maxResults || 15;
  const targetSpeaker = options.speaker?.toLowerCase().trim();
  const targetTag = options.episodeTag?.trim();
  const qClean = query.toLowerCase().trim();

  const results: TranscriptSearchResult[] = [];
  if (!qClean && !targetSpeaker && !targetTag && (!options.activeSegments || options.activeSegments.length === 0)) {
    return results;
  }

  const queryTokens = qClean.split(/\s+/).filter(t => t.length > 2);

  // Search activeSegments if supplied from currently active episode context
  if (options.activeSegments && options.activeSegments.length > 0) {
    const epSum = targetTag ? summaries.find(s => s.release_tag === targetTag) : null;
    const epTitle = epSum?.title || targetTag || 'Active Episode';
    for (const seg of options.activeSegments) {
      if (!seg.text) continue;
      const textLower = seg.text.toLowerCase();
      const speakerName = seg.speaker || 'Unknown Speaker';

      if (targetSpeaker && !speakerName.toLowerCase().includes(targetSpeaker)) {
        continue;
      }

      let score = 50;
      if (qClean && textLower.includes(qClean)) {
        score += 100;
      } else if (queryTokens.length > 0) {
        const matchedCount = queryTokens.filter(t => textLower.includes(t)).length;
        if (matchedCount === 0) continue;
        score += matchedCount * 25;
      } else if (!qClean) {
        score += 10;
      }

      results.push({
        episodeTitle: epTitle,
        releaseTag: targetTag || 'active_episode',
        audioUrl: epSum?.audio_url,
        episodeDate: epSum?.episode_date,
        speaker: speakerName,
        startSec: seg.start,
        endSec: seg.end,
        text: seg.text.trim(),
        relevanceScore: score,
        matchType: 'lexical',
      });
    }
  }

  // Prioritize episodes
  const prioritizedTags: Array<{ tag: string; title: string; audioUrl?: string; date?: string; boost: number }> = [];

  for (const s of summaries) {
    if (targetTag && s.release_tag !== targetTag) continue;

    let boost = 0;
    if (targetSpeaker && s.speakers?.some(sp => sp.toLowerCase().includes(targetSpeaker))) {
      boost += 50;
    }
    if (qClean && s.title?.toLowerCase().includes(qClean)) {
      boost += 30;
    }
    if (boost > 0 || !targetSpeaker) {
      prioritizedTags.push({
        tag: s.release_tag,
        title: s.title,
        audioUrl: s.audio_url,
        date: s.episode_date,
        boost,
      });
    }
  }

  prioritizedTags.sort((a, b) => b.boost - a.boost);

  const tagsToSearch = prioritizedTags.length > 0
    ? prioritizedTags
    : targetSpeaker
    ? []
    : Array.from(fileMap.keys()).slice(0, 50).map(tag => {
        const sum = summaries.find(s => s.release_tag === tag);
        return {
          tag,
          title: sum?.title || tag,
          audioUrl: sum?.audio_url,
          date: sum?.episode_date,
          boost: 0,
        };
      });

  for (const ep of tagsToSearch) {
    if (results.length >= max * 3) break;

    const filePath = fileMap.get(ep.tag);
    if (!filePath || !fs.existsSync(filePath)) continue;

    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      if (qClean && !raw.toLowerCase().includes(qClean)) {
        if (queryTokens.length > 1) {
          const matchCount = queryTokens.filter(t => raw.toLowerCase().includes(t)).length;
          if (matchCount < Math.min(2, queryTokens.length)) continue;
        } else {
          continue;
        }
      }

      const data = JSON.parse(raw);
      const segments: Array<{ start: number; end: number; speaker?: string; text?: string }> = Array.isArray(data.segments)
        ? data.segments
        : Array.isArray(data)
        ? data
        : [];

      for (const seg of segments) {
        if (!seg.text) continue;
        const textLower = seg.text.toLowerCase();
        const speakerName = seg.speaker || 'Unknown Speaker';

        if (targetSpeaker && !speakerName.toLowerCase().includes(targetSpeaker)) {
          continue;
        }

        let score = ep.boost;
        if (qClean && textLower.includes(qClean)) {
          score += 100;
        } else if (queryTokens.length > 0) {
          const matchedCount = queryTokens.filter(t => textLower.includes(t)).length;
          if (matchedCount === 0) continue;
          score += matchedCount * 20;
        }

        results.push({
          episodeTitle: ep.title,
          releaseTag: ep.tag,
          audioUrl: ep.audioUrl,
          episodeDate: ep.date,
          speaker: speakerName,
          startSec: seg.start,
          endSec: seg.end,
          text: seg.text.trim(),
          relevanceScore: score,
          matchType: 'lexical',
        });

        if (results.length >= max * 3) break;
      }
    } catch {
      // ignore read/parse error
    }
  }

  results.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
  return results.slice(0, max);
}

/* ---------------------------------------------------------------------------------------------- */
/* Semantic Vector Search                                                                         */
/* ---------------------------------------------------------------------------------------------- */

export async function searchTranscriptVector(
  query: string,
  options: SearchOptions = {}
): Promise<TranscriptSearchResult[]> {
  const queryVec = await embedQuery(query);
  if (!queryVec) return [];

  const summaries = loadSummaries();
  const max = options.maxResults || 15;
  const targetSpeaker = options.speaker?.toLowerCase().trim();
  const targetTag = options.episodeTag?.trim();

  let availableTags = getAvailableEmbeddingTags();
  if (targetTag) {
    availableTags = availableTags.filter(t => t === targetTag);
  }

  const results: TranscriptSearchResult[] = [];

  for (const tag of availableTags) {
    const summary = summaries.find(s => s.release_tag === tag);
    if (targetSpeaker && summary?.speakers && !summary.speakers.some(sp => sp.toLowerCase().includes(targetSpeaker))) {
      continue;
    }

    const emb = getEpisodeEmbeddings(tag);
    if (!emb) continue;

    const { manifest, vectors } = emb;
    const segmentCount = manifest.segments.length;

    for (let i = 0; i < segmentCount; i++) {
      const seg = manifest.segments[i];
      if (targetSpeaker && !seg.speaker.toLowerCase().includes(targetSpeaker)) {
        continue;
      }

      const sim = dotProduct(vectors, i * 384, queryVec);
      // Threshold to avoid irrelevant noise
      if (sim > 0.22) {
        results.push({
          episodeTitle: manifest.title || summary?.title || tag,
          releaseTag: tag,
          audioUrl: summary?.audio_url,
          episodeDate: summary?.episode_date,
          speaker: seg.speaker,
          startSec: seg.start,
          endSec: seg.end,
          text: seg.text,
          relevanceScore: Number(sim.toFixed(4)),
          matchType: 'vector',
        });
      }
    }
  }

  results.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
  return results.slice(0, max * 2);
}

/* ---------------------------------------------------------------------------------------------- */
/* Reciprocal Rank Fusion (RRF) & Hybrid Dispatcher                                               */
/* ---------------------------------------------------------------------------------------------- */

export function computeRRF(
  lexicalResults: TranscriptSearchResult[],
  vectorResults: TranscriptSearchResult[],
  k: number = 60
): TranscriptSearchResult[] {
  const scoreMap = new Map<
    string,
    { item: TranscriptSearchResult; rrfScore: number; lexicalRank?: number; vectorRank?: number }
  >();

  // Process lexical ranks (1-indexed)
  lexicalResults.forEach((item, idx) => {
    const key = `${item.releaseTag}#${item.startSec.toFixed(2)}`;
    const rank = idx + 1;
    const contribution = 1 / (k + rank);
    scoreMap.set(key, { item, rrfScore: contribution, lexicalRank: rank });
  });

  // Process vector ranks (1-indexed)
  vectorResults.forEach((item, idx) => {
    const key = `${item.releaseTag}#${item.startSec.toFixed(2)}`;
    const rank = idx + 1;
    const contribution = 1 / (k + rank);
    const existing = scoreMap.get(key);
    if (existing) {
      existing.rrfScore += contribution;
      existing.vectorRank = rank;
      if (!existing.item.audioUrl && item.audioUrl) existing.item.audioUrl = item.audioUrl;
      existing.item.matchType = 'hybrid';
    } else {
      scoreMap.set(key, { item, rrfScore: contribution, vectorRank: rank });
    }
  });

  const combined = Array.from(scoreMap.values());
  combined.sort((a, b) => b.rrfScore - a.rrfScore);

  return combined.map(entry => ({
    ...entry.item,
    relevanceScore: Number(entry.rrfScore.toFixed(6)),
    matchType: entry.item.matchType || (entry.vectorRank ? 'vector' : 'lexical'),
  }));
}

export async function searchTranscriptArchive(
  query: string,
  options: SearchOptions = {}
): Promise<TranscriptSearchResult[]> {
  const mode = options.mode || 'hybrid';
  const max = options.maxResults || 15;

  if (mode === 'lexical') {
    return searchTranscriptLexical(query, options);
  }

  if (mode === 'vector') {
    const vecResults = await searchTranscriptVector(query, options);
    return vecResults.slice(0, max);
  }

  // Hybrid Mode: parallel execution of lexical and vector search
  try {
    const [lexical, vector] = await Promise.all([
      searchTranscriptLexical(query, { ...options, maxResults: max * 2 }),
      searchTranscriptVector(query, { ...options, maxResults: max * 2 }),
    ]);

    if (vector.length > 0 && lexical.length > 0) {
      const fused = computeRRF(lexical, vector, 60);
      return fused.slice(0, max);
    }

    if (vector.length > 0) {
      return vector.slice(0, max);
    }

    return lexical.slice(0, max);
  } catch (err) {
    console.warn('[TranscriptSearchService] Hybrid search failed, falling back to lexical:', err);
    return searchTranscriptLexical(query, options);
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* Intent Detection & Episode Detail Retrieval                                                   */
/* ---------------------------------------------------------------------------------------------- */

export function detectSearchIntent(userMessage: string): {
  isCapabilityInquiry: boolean;
  isSearchQuery: boolean;
  query?: string;
  speaker?: string;
  episodeTag?: string;
  timestampSec?: number;
} {
  const m = userMessage.trim();
  const lower = m.toLowerCase();

  // 1. General capability inquiries like "are you able to search the transcripts ?"
  if (
    /^(can you|are you able to|do you have access to|can i search|is it possible to search|do you know what was said|can you check)/i.test(lower) &&
    /transcript/i.test(lower)
  ) {
    return { isCapabilityInquiry: true, isSearchQuery: false };
  }

  const parsedTimestamp = parseTimestampSec(m);

  // Check for episode tag or title match
  let episodeTag: string | undefined;
  const tagMatch = m.match(/\b(2026\d{4}_[A-Za-z0-9]+)\b/);
  if (tagMatch) {
    episodeTag = tagMatch[1];
  } else {
    const summaries = loadSummaries();
    for (const s of summaries) {
      if (s.title && s.title.length > 5) {
        const titleUnderscore = s.title.toLowerCase();
        const titleSpaces = titleUnderscore.replace(/_/g, ' ');
        if (lower.includes(titleUnderscore) || lower.includes(titleSpaces)) {
          episodeTag = s.release_tag;
          break;
        }
      }
    }
  }

  // If a timestamp is explicitly present, treat as a search query targeting that time
  if (parsedTimestamp !== null) {
    let speaker: string | undefined;
    const speakerMatch = m.match(
      /(?:where|what did|when did|who said)?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:say|said|talk|talked|mention|mentioned)\s+(?:about\s+)?(.+)/i
    );
    if (speakerMatch) {
      speaker = speakerMatch[1];
    }

    let cleanQuery = m
      .replace(/(?:▶\s*|@\s*|\bat\s+)?\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b/g, ' ')
      .replace(/\b([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)\s*(?:s\b|sec\b|secs\b|seconds\b)/gi, ' ')
      .replace(/\b(2026\d{4}_[A-Za-z0-9]+)\b/g, ' ');
    if (episodeTag) {
      const s = loadSummaries().find(sum => sum.release_tag === episodeTag);
      if (s?.title) {
        cleanQuery = cleanQuery.replace(new RegExp(s.title.replace(/_/g, '[_ ]'), 'gi'), ' ');
      }
    }
    cleanQuery = cleanQuery
      .replace(/^(?:at|around|near|in|from|check|what was said|what did|who said|find|search)\s+/gi, '')
      .replace(/^(?:someone|they|she|he|we)\s+said\s+/gi, '')
      .replace(/[?.,!]+$/, '')
      .trim();

    return {
      isCapabilityInquiry: false,
      isSearchQuery: true,
      query: cleanQuery,
      speaker,
      episodeTag,
      timestampSec: parsedTimestamp,
    };
  }

  // 2. Questions asking to find or search for specific dialogue, speakers, or topics
  const searchTriggers = [
    /(?:search|find|look for|any mention of|where did|who said|what did|what was said about|did anyone talk about|quotes? about|soundbites? on|discuss(?:ed|ing)?)\s+(.+)/i,
    /(?:transcripts?|quotes?)\s+(?:for|about|containing|with)\s+(.+)/i,
    /(?:someone|they|she|he|we)\s+said\s+["']?([^"']+)["']?/i,
  ];

  for (const pat of searchTriggers) {
    const match = m.match(pat);
    if (match && match[1]) {
      let raw = match[1].replace(/[?.,!]+$/, '').trim();

      let speaker: string | undefined;
      const sm = raw.match(
        /(?:where|what did|when did|who said)?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:say|said|talk|talked|mention|mentioned)\s+(?:about\s+)?(.+)/i
      );
      if (sm) {
        speaker = sm[1];
        raw = sm[2];
      }

      if (!episodeTag) {
        const tm = raw.match(/\b(2026\d{4}_[A-Za-z0-9]+)\b/);
        if (tm) {
          episodeTag = tm[1];
          raw = raw.replace(tm[0], '').trim();
        }
      }

      raw = raw.replace(/^(?:search|find|look for|any mention of|quotes? (?:about|on)?|soundbites? (?:about|on)?|transcripts? (?:for|about)?)\s+/i, '');
      raw = raw.replace(/\s+(?:in|across)\s+(?:all\s+)?(?:the\s+)?transcripts?$/i, '');
      raw = raw.replace(/^(?:for|about)\s+/i, '');

      return {
        isCapabilityInquiry: false,
        isSearchQuery: true,
        query: raw.trim(),
        speaker,
        episodeTag,
        timestampSec: parsedTimestamp || undefined,
      };
    }
  }

  // 3. If the message mentions a release tag or quotes directly
  const tagDirect = m.match(/\b(2026\d{4}_[A-Za-z0-9]+)\b/);
  if (tagDirect && (lower.includes('transcript') || lower.includes('quote') || lower.includes('said'))) {
    return {
      isCapabilityInquiry: false,
      isSearchQuery: true,
      query: '',
      episodeTag: tagDirect[1],
    };
  }

  return { isCapabilityInquiry: false, isSearchQuery: false };
}

export function getEpisodeTranscript(releaseTag: string): {
  title: string;
  releaseTag: string;
  audioUrl?: string;
  speakers: string[];
  segments: Array<{ start: number; end: number; speaker: string; text: string }>;
} | null {
  const summaries = loadSummaries();
  const fileMap = getTagToFileMap();

  let targetTag = releaseTag;
  let sum = summaries.find(s => s.release_tag === targetTag);
  if (!sum) {
    const foundByTitle = summaries.find(s =>
      s.title?.toLowerCase() === targetTag.toLowerCase() ||
      s.title?.toLowerCase().replace(/[^a-z0-9]/g, '_') === targetTag.toLowerCase().replace(/[^a-z0-9]/g, '_')
    );
    if (foundByTitle) {
      sum = foundByTitle;
      targetTag = foundByTitle.release_tag;
    }
  }

  // Check in-memory registered segments first
  if (IN_MEMORY_EPISODES.has(targetTag)) {
    const memSegs = IN_MEMORY_EPISODES.get(targetTag)!;
    return {
      title: sum?.title || targetTag,
      releaseTag: targetTag,
      audioUrl: sum?.audio_url,
      speakers: sum?.speakers || [],
      segments: memSegs.map(s => ({
        start: s.start || 0,
        end: s.end || 0,
        speaker: s.speaker || 'Unknown',
        text: s.text || '',
      })),
    };
  }

  const filePath = fileMap.get(targetTag) || fileMap.get(releaseTag);
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    const segs: Array<{ start: number; end: number; speaker?: string; text?: string }> = Array.isArray(data.segments)
      ? data.segments
      : Array.isArray(data)
      ? data
      : [];

    return {
      title: data.title || sum?.title || releaseTag,
      releaseTag: targetTag,
      audioUrl: sum?.audio_url,
      speakers: data.speakers_detected || sum?.speakers || [],
      segments: segs.map(s => ({
        start: s.start || 0,
        end: s.end || 0,
        speaker: s.speaker || 'Unknown',
        text: s.text || '',
      })),
    };
  } catch (err) {
    console.warn('[TranscriptSearchService] Error loading episode transcript:', err);
    return null;
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* Spoken Audio Normalizer & Resilient Multi-Tier Search Runner                                   */
/* ---------------------------------------------------------------------------------------------- */

const DIGIT_TO_WORDS: Record<string, string> = {
  '0': 'zero',
  '1': 'one',
  '2': 'two',
  '3': 'three',
  '4': 'four',
  '5': 'five',
  '6': 'six',
  '7': 'seven',
  '8': 'eight',
  '9': 'nine',
  '10': 'ten',
};

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'what',
  'about', 'just', 'like', 'they', 'were', 'been', 'some', 'there',
  'their', 'when', 'then', 'here', 'into', 'only', 'your', 'will',
  'would', 'could', 'should', 'can', 'are', 'was', 'is', 'did', 'does',
  'you', 'me', 'him', 'her', 'our', 'had', 'has', 'say', 'said', 'tell',
  'spoke', 'speak', 'talking', 'talked', 'find', 'search', 'quotes', 'quote',
  'soundbite', 'soundbites', 'transcript'
]);

/**
 * Normalizes spoken dialogue queries by stripping punctuation, em dashes, ellipses,
 * filler words, duplicate stutter repetitions, and converting digits to words.
 */
export function normalizeSpokenQuery(raw: string): string {
  if (!raw) return '';
  let str = raw;

  // 1. Strip em dashes (—), en dashes (–), ellipses (... or …), quotes, brackets, parens
  str = str.replace(/[—–]/g, ' ');
  str = str.replace(/\.{2,}|\u2026/g, ' ');
  str = str.replace(/["'“”‘’`[\]()<>]/g, ' ');

  // 2. Strip conversational filler phrases: "you know", "sort of", "kind of", "i mean"
  str = str.replace(/\b(you know|sort of|kind of|i mean)\b/gi, ' ');

  // 3. Normalize numerals ('2' -> 'two', '2 days ago' -> 'two days ago')
  str = str.replace(/\b([0-9]|10)\b/g, m => DIGIT_TO_WORDS[m] || m);

  // 4. Strip single conversational filler sounds: "uh", "um", "er", "ah"
  str = str.replace(/\b(uh|um|er|ah)\b/gi, ' ');

  // 5. Strip duplicate stutter/filler repetitions: e.g. "in, in", "the the", "uh, uh", "I, I"
  str = str.replace(/[,;:!?]+/g, ' ');
  str = str.replace(/\b(\w+)(?:\s+\1\b)+/gi, '$1');

  // 6. Collapse whitespace
  return str.replace(/\s+/g, ' ').trim();
}

export interface HandleSearchTranscriptsInput {
  query: string;
  scope?: 'active_episode' | 'all_transcripts';
  speaker_hint?: string;
  episodeTag?: string;
  timestamp_sec?: number;
  maxResults?: number;
  activeSegments?: Array<{ speaker: string; text: string; start: number; end: number }>;
}

export interface TranscriptMatch {
  episode_id: string;
  episode_title: string;
  start_timestamp: number;
  end_timestamp: number;
  formatted_time: string; // e.g. "47:42"
  speaker: string;
  snippet: string;
  audio_url?: string;
  match_type?: string;
  relevance_score?: number;
}

export interface HandleSearchTranscriptsResult {
  matches: TranscriptMatch[];
  totalMatches: number;
  queryUsed: string;
  scopeUsed: 'active_episode' | 'all_transcripts';
  speakerFilterApplied?: string;
  tier: 1 | 2;
}

/**
 * Multi-tier resilient search runner for Copilot tool-calling.
 * - Handles explicit timestamp proximity queries (e.g. 47:42 / 2862s).
 * - Tier 1: Hybrid BM25 + Semantic Vector search with normalized query.
 * - Broadens speaker filter if 0 matches to account for diarization tags (Speaker 3, Guest).
 * - Tier 2 (Fallback): AND search across key anchor words if Tier 1 yields 0 matches.
 */
export async function handleSearchTranscripts(
  input: HandleSearchTranscriptsInput
): Promise<HandleSearchTranscriptsResult> {
  const normalizedQuery = normalizeSpokenQuery(input.query);
  const max = input.maxResults || 12;
  const scope: 'active_episode' | 'all_transcripts' =
    input.scope === 'active_episode' && input.episodeTag ? 'active_episode' : 'all_transcripts';
  const targetTag = scope === 'active_episode' ? input.episodeTag : undefined;
  let speakerHint = input.speaker_hint?.trim() || undefined;

  // If activeSegments provided, register them in memory/cache
  if (input.episodeTag && input.activeSegments?.length) {
    registerEpisodeSegments(input.episodeTag, input.activeSegments);
  }

  let tier: 1 | 2 = 1;
  let rawResults: TranscriptSearchResult[] = [];
  let speakerApplied = speakerHint;

  // ── Timestamp-Aware Proximity Retrieval ──
  if (input.timestamp_sec !== undefined && input.timestamp_sec !== null) {
    const T = input.timestamp_sec;
    let epSegments: Array<{ start: number; end: number; speaker?: string; text?: string }> = [];
    let epTitle = targetTag || 'Active Episode';
    let epAudioUrl: string | undefined;

    if (input.activeSegments?.length) {
      epSegments = input.activeSegments;
    } else if (input.episodeTag) {
      const epData = getEpisodeTranscript(input.episodeTag);
      if (epData) {
        epSegments = epData.segments;
        epTitle = epData.title;
        epAudioUrl = epData.audioUrl;
      }
    }

    if (epSegments.length > 0) {
      const windowSec = 60;
      const proximityTurns = epSegments.filter(s =>
        (s.start >= T - windowSec && s.start <= T + windowSec) ||
        (s.end >= T - windowSec && s.end <= T + windowSec)
      );

      if (proximityTurns.length > 0) {
        const queryTokens = normalizedQuery.toLowerCase().split(/\s+/).filter(t => t.length > 2);
        const scoredTurns = proximityTurns.map(seg => {
          let score = 50 - Math.min(40, Math.abs(seg.start - T) / 2);
          const textLower = (seg.text || '').toLowerCase();
          if (queryTokens.length > 0) {
            const matches = queryTokens.filter(t => textLower.includes(t)).length;
            score += matches * 25;
          }
          return {
            episodeTitle: epTitle,
            releaseTag: input.episodeTag || 'active_episode',
            audioUrl: epAudioUrl,
            speaker: seg.speaker || 'Unknown Speaker',
            startSec: seg.start,
            endSec: seg.end,
            text: (seg.text || '').trim(),
            relevanceScore: Number(score.toFixed(2)),
            matchType: 'proximity' as const,
          };
        });

        scoredTurns.sort((a, b) => b.relevanceScore - a.relevanceScore);
        rawResults = scoredTurns.slice(0, max);
      }
    }
  }

  // ── Tier 1: Hybrid Semantic + BM25 Lexical Search ──
  if (rawResults.length === 0 && normalizedQuery) {
    rawResults = await searchTranscriptArchive(normalizedQuery, {
      speaker: speakerHint,
      episodeTag: targetTag,
      activeSegments: input.activeSegments,
      maxResults: max,
      mode: 'hybrid',
    });

    // Broaden Speaker Scope: If speaker_hint yielded 0 matches, retry without it
    if (rawResults.length === 0 && speakerHint) {
      const relaxedResults = await searchTranscriptArchive(normalizedQuery, {
        speaker: undefined,
        episodeTag: targetTag,
        activeSegments: input.activeSegments,
        maxResults: max,
        mode: 'hybrid',
      });
      if (relaxedResults.length > 0) {
        rawResults = relaxedResults;
        speakerApplied = undefined; // relaxed
      }
    }
  }

  // ── Tier 2 (Fallback): Anchor Words AND Search ──
  if (rawResults.length === 0 && normalizedQuery) {
    tier = 2;
    const words = normalizedQuery
      .toLowerCase()
      .split(/\s+/)
      .map(w => w.replace(/[^a-z0-9]/g, ''))
      .filter(w => w.length >= 3 && !STOP_WORDS.has(w));

    const anchorWords = words.length > 0
      ? words
      : normalizedQuery.toLowerCase().split(/\s+/).filter(w => w.length >= 2);

    if (anchorWords.length > 0) {
      // Find segments matching anchor words via lexical search
      const anchorQuery = anchorWords.join(' ');
      let anchorResults = await searchTranscriptLexical(anchorQuery, {
        speaker: speakerApplied,
        episodeTag: targetTag,
        activeSegments: input.activeSegments,
        maxResults: max * 2,
      });

      // Filter for turns containing all anchor words (AND logic)
      let andFiltered = anchorResults.filter(r => {
        const textLower = r.text.toLowerCase();
        return anchorWords.every(word => textLower.includes(word));
      });

      // If no exact AND match and more than 2 words, check for top 2 words
      if (andFiltered.length === 0 && anchorWords.length >= 2) {
        const topTwo = anchorWords.slice(0, 2);
        andFiltered = anchorResults.filter(r => {
          const textLower = r.text.toLowerCase();
          return topTwo.every(word => textLower.includes(word));
        });
      }

      // If still 0 and speaker filter was set, try anchor search without speaker filter
      if (andFiltered.length === 0 && speakerApplied) {
        const relaxedAnchor = await searchTranscriptLexical(anchorQuery, {
          speaker: undefined,
          episodeTag: targetTag,
          activeSegments: input.activeSegments,
          maxResults: max * 2,
        });
        andFiltered = relaxedAnchor.filter(r => {
          const textLower = r.text.toLowerCase();
          return anchorWords.slice(0, 2).every(word => textLower.includes(word));
        });
        if (andFiltered.length > 0) {
          speakerApplied = undefined;
        }
      }

      rawResults = andFiltered.slice(0, max);
    }
  }

  const matches: TranscriptMatch[] = rawResults.map(r => ({
    episode_id: r.releaseTag,
    episode_title: r.episodeTitle,
    start_timestamp: r.startSec,
    end_timestamp: r.endSec,
    formatted_time: formatTimestamp(r.startSec),
    speaker: r.speaker,
    snippet: r.text,
    audio_url: r.audioUrl,
    match_type: r.matchType,
    relevance_score: r.relevanceScore,
  }));

  return {
    matches,
    totalMatches: matches.length,
    queryUsed: normalizedQuery,
    scopeUsed: scope,
    speakerFilterApplied: speakerApplied,
    tier,
  };
}
