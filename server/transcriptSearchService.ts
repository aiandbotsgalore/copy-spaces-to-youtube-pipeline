import fs from 'fs';
import path from 'path';
import {
  extractSpeakerPrefix,
  normalizeSpeakerName,
  isNormalizedSpeakerMatch,
  type ParsedSpeakerQuery,
} from '../utils/transcriptSearch';

export {
  extractSpeakerPrefix,
  normalizeSpeakerName,
  isNormalizedSpeakerMatch,
  type ParsedSpeakerQuery,
};

export interface RelevantSpan {
  start: number;       // 0-based character start offset in segment text
  end: number;         // 0-based character end offset in segment text
  score: number;       // Raw relevance score from cross-encoder
  text?: string;       // Substring slice from segment text
}

export interface DialogueTurn {
  speaker: string;
  text: string;
  start: number;
  end: number;
}

export interface DocumentLocation {
  filePath: string;
  pageNumber?: number;
  lineNumber?: number;
  messageIndex?: number;
  displayText: string;
}

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
  matchType?: 'lexical' | 'vector' | 'hybrid' | 'proximity' | 'rerank';
  relevantSpans?: RelevantSpan[];
  dialogueWindow?: DialogueTurn[];
  chunkId?: string;
  sourceType?: 'space_transcript' | 'direct_message' | 'court_record' | 'recorded_call' | 'public_post' | 'research_dossier';
  sourceClassification?: 'primary_record' | 'derivative_material';
  contentNature?: 'verbatim_statement' | 'official_record' | 'unverified_allegation' | 'editorial_note';
  documentLocation?: DocumentLocation;
  energyScore?: number;
  pacingWps?: number;
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
  source_type?: string;
  source_classification?: string;
}

export interface EmbeddingManifestSegment {
  index: number;
  start: number;
  end: number;
  speaker: string;
  text: string;
  chunkId?: string;
  sourceType?: 'space_transcript' | 'direct_message' | 'court_record' | 'recorded_call' | 'public_post' | 'research_dossier';
  sourceClassification?: 'primary_record' | 'derivative_material';
  contentNature?: 'verbatim_statement' | 'official_record' | 'unverified_allegation' | 'editorial_note';
  documentLocation?: DocumentLocation;
  energyScore?: number;
  pacingWps?: number;
}

export interface EmbeddingManifest {
  version: number;
  episodeTag: string;
  title?: string;
  dims: number;
  segmentCount: number;
  generatedAt: string;
  segments: EmbeddingManifestSegment[];
  sourceType?: 'space_transcript' | 'direct_message' | 'court_record' | 'recorded_call' | 'public_post' | 'research_dossier';
  sourceClassification?: 'primary_record' | 'derivative_material';
  documentLocation?: DocumentLocation;
}

export interface SearchOptions {
  speaker?: string;
  episodeTag?: string;
  maxResults?: number;
  maxDurationSec?: number;
  excludeMetaCommentary?: boolean;
  mode?: 'hybrid' | 'lexical' | 'vector' | 'rerank';
  rerankModel?: 'rerank-v5.0-fast' | 'rerank-v5.0-pro';
  apiKey?: string;
  fetchImpl?: typeof fetch;
  activeSegments?: Array<{ speaker: string; text: string; start: number; end: number }>;
  sourceType?: string;
  sourceClassification?: string;
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
  let summaries: EpisodeSummaryItem[] = [];
  try {
    const summaryPath = resolvePath('public', 'transcripts', 'transcripts_summary_index.json');
    if (fs.existsSync(summaryPath)) {
      const raw = fs.readFileSync(summaryPath, 'utf8');
      summaries = JSON.parse(raw) || [];
    }
  } catch (err) {
    console.warn('[TranscriptSearchService] Failed to load transcripts_summary_index.json:', err);
  }

  try {
    const evidenceCatalogPath = resolvePath('.cache', 'evidence', 'evidence_catalog.json');
    if (fs.existsSync(evidenceCatalogPath)) {
      const evRaw = fs.readFileSync(evidenceCatalogPath, 'utf8');
      const evData = JSON.parse(evRaw);
      const evItems = Array.isArray(evData) ? evData : evData.items || [];
      const evSummaries: EpisodeSummaryItem[] = evItems.map((e: any) => ({
        release_tag: e.tag || e.release_tag,
        title: e.title || e.tag,
        episode_date: e.date,
        speakers: e.speakers || [],
        source_type: e.source_type || 'evidence_document',
        source_classification: e.source_classification || 'primary_record',
      }));
      summaries = [...summaries, ...evSummaries];
    }
  } catch (err) {
    console.warn('[TranscriptSearchService] Failed to load evidence_catalog.json:', err);
  }

  cachedSummaries = summaries;
  return cachedSummaries;
}

export function getTagToFileMap(): Map<string, string> {
  if (tagToFileMap) return tagToFileMap;
  tagToFileMap = new Map();
  try {
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

  const episodesDir = resolvePath('public', 'transcripts', 'episodes');
  const epFilesCount = fs.existsSync(episodesDir)
    ? fs.readdirSync(episodesDir).filter(f => f.endsWith('.json')).length
    : summaries.length;

  return {
    totalEpisodes: summaries.length || 675,
    totalTranscriptsOnDisk: epFilesCount || summaries.length || 675,
    allSpeakersSample: Array.from(allSpeakers).slice(0, 15),
  };
}

let embeddingPipelinePromise: Promise<any> | null = null;

export function __setEmbeddingPipelineForTest(fn: any | null) {
  embeddingPipelinePromise = fn ? Promise.resolve(fn) : null;
}

export async function getQueryEmbedder() {
  if (!embeddingPipelinePromise) {
    const { pipeline, env } = await import('@huggingface/transformers');
    const modelsDir = resolvePath('.cache', 'models');
    env.cacheDir = modelsDir;
    env.localModelPath = modelsDir;
    const localModelPath = resolvePath(modelsDir, 'Xenova', 'all-MiniLM-L6-v2');
    if (fs.existsSync(localModelPath)) {
      env.allowRemoteModels = false;
    }
    embeddingPipelinePromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      dtype: 'q8',
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
    if (EMBEDDINGS_CACHE.size >= 180) {
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
  const colonMatch = text.match(/(?:▶\s*|@\s*|\bat\s+)?\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b/);
  if (colonMatch) {
    const hrs = colonMatch[1] ? parseInt(colonMatch[1], 10) : 0;
    const mins = parseInt(colonMatch[2], 10);
    const secs = parseInt(colonMatch[3], 10);
    return hrs * 3600 + mins * 60 + secs;
  }
  if (parseMaxDurationSec(text) !== null) {
    return null;
  }
  const secMatch = text.match(/\b([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)\s*(?:s\b|sec\b|secs\b|seconds\b)/i);
  if (secMatch) {
    const num = parseInt(secMatch[1].replace(/,/g, ''), 10);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

export function parseMaxDurationSec(text: string): number | null {
  if (!text) return null;
  const postMatch = text.match(/\b(\d{1,3})\s*(?:s|sec|secs|second|seconds)\s*(?:max|maximum|or less|or shorter|or under|limit|long)\b/i);
  if (postMatch) {
    const val = parseInt(postMatch[1], 10);
    return Number.isFinite(val) && val > 0 ? val : null;
  }
  const preMatch = text.match(/\b(?:under|max|maximum|up to|less than|shorter than|within|no more than|no longer than)\s+(\d{1,3})\s*(?:s|sec|secs|second|seconds)\b/i);
  if (preMatch) {
    const val = parseInt(preMatch[1], 10);
    return Number.isFinite(val) && val > 0 ? val : null;
  }
  return null;
}

const META_CLIP_COMMENTARY_REGEX = /\b(?:funny clip|best clip|hilarious clip|clip that|make a clip|good clip|great clip|soundboard|on the soundboard)\b/i;

function scoreEditorialCandidateTurn(text: string, durationSec: number, maxDurationSec?: number): number {
  const clean = text.trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length < 4) return -100;
  if (maxDurationSec && durationSec > maxDurationSec) return -100;
  if (durationSec > 0 && durationSec < 1.2) return -50;
  if (META_CLIP_COMMENTARY_REGEX.test(clean)) return -200;
  let score = 40;
  if (words.length >= 6 && words.length <= 45) score += 35;
  else if (words.length > 45 && words.length <= 80) score += 15;
  if (/[?!]/.test(clean)) score += 15;
  return score;
}

export async function searchTranscriptLexical(
  query: string,
  options: SearchOptions = {}
): Promise<TranscriptSearchResult[]> {
  const summaries = loadSummaries();
  const fileMap = getTagToFileMap();
  const max = options.maxResults || 15;
  const targetSpeaker = normalizeSpeakerName(options.speaker);
  const targetTag = options.episodeTag?.trim();
  const qClean = query.toLowerCase().trim();

  const results: TranscriptSearchResult[] = [];
  if (!qClean && !targetSpeaker && !targetTag && (!options.activeSegments || options.activeSegments.length === 0)) {
    return results;
  }

  const queryTokens = qClean.split(/\s+/).filter(t => t.length > 2);

  if (options.activeSegments && options.activeSegments.length > 0) {
    const epSum = targetTag ? summaries.find(s => s.release_tag === targetTag) : null;
    const epTitle = epSum?.title || targetTag || 'Active Episode';
    for (const seg of options.activeSegments) {
      if (!seg.text) continue;
      const textLower = seg.text.toLowerCase();
      const speakerName = seg.speaker || 'Unknown Speaker';

      const dur = (seg.end || 0) - (seg.start || 0);
      if (targetSpeaker && !isNormalizedSpeakerMatch(speakerName, targetSpeaker)) {
        continue;
      }
      if (options.maxDurationSec && dur > options.maxDurationSec) {
        continue;
      }
      if (options.excludeMetaCommentary && META_CLIP_COMMENTARY_REGEX.test(seg.text)) {
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
        const editorialScore = scoreEditorialCandidateTurn(seg.text, dur, options.maxDurationSec);
        if (editorialScore < 0) continue;
        score += editorialScore;
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

  const prioritizedTags: Array<{ tag: string; title: string; audioUrl?: string; date?: string; boost: number }> = [];

  for (const s of summaries) {
    if (targetTag && s.release_tag !== targetTag) continue;

    let boost = 0;
    if (targetSpeaker) {
      if (s.speakers?.length && !s.speakers.some(sp => isNormalizedSpeakerMatch(sp, targetSpeaker))) {
        continue;
      }
      boost += 50;
    }
    if (qClean && s.title?.toLowerCase().includes(qClean)) {
      boost += 30;
    }
    prioritizedTags.push({
      tag: s.release_tag,
      title: s.title,
      audioUrl: s.audio_url,
      date: s.episode_date,
      boost,
    });
  }

  prioritizedTags.sort((a, b) => b.boost - a.boost);

  const tagsToSearch = prioritizedTags.length > 0
    ? prioritizedTags
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

    const sum = summaries.find(s => s.release_tag === ep.tag);
    if (options.sourceType && sum?.source_type && sum.source_type !== options.sourceType) {
      continue;
    }
    if (options.sourceClassification && sum?.source_classification && sum.source_classification !== options.sourceClassification) {
      continue;
    }

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
      const segments: Array<{ start: number; end: number; speaker?: string; text?: string; chunkId?: string; sourceType?: any; sourceClassification?: any; contentNature?: any; documentLocation?: any }> = Array.isArray(data.segments)
        ? data.segments
        : Array.isArray(data)
        ? data
        : [];

      for (let sIdx = 0; sIdx < segments.length; sIdx++) {
        const seg = segments[sIdx];
        if (!seg.text) continue;

        const effectiveSourceType = seg.sourceType || data.sourceType || sum?.source_type || 'space_transcript';
        if (options.sourceType && effectiveSourceType !== options.sourceType) continue;

        const effectiveClassification = seg.sourceClassification || data.sourceClassification || sum?.source_classification || 'primary_record';
        if (options.sourceClassification && effectiveClassification !== options.sourceClassification) continue;

        const textLower = seg.text.toLowerCase();
        const speakerName = seg.speaker || 'Unknown Speaker';

        const dur = (seg.end || 0) - (seg.start || 0);
        if (targetSpeaker && !isNormalizedSpeakerMatch(speakerName, targetSpeaker)) {
          continue;
        }
        if (options.maxDurationSec && dur > options.maxDurationSec) {
          continue;
        }
        if (options.excludeMetaCommentary && META_CLIP_COMMENTARY_REGEX.test(seg.text)) {
          continue;
        }

        let score = ep.boost;
        if (qClean && textLower.includes(qClean)) {
          score += 100;
        } else if (queryTokens.length > 0) {
          const matchedCount = queryTokens.filter(t => textLower.includes(t)).length;
          if (matchedCount === 0) continue;
          score += matchedCount * 20;
        } else if (!qClean) {
          const editorialScore = scoreEditorialCandidateTurn(seg.text, dur, options.maxDurationSec);
          if (editorialScore < 0) continue;
          score += editorialScore;
        }

        const dialogueWindow: DialogueTurn[] = segments
          .slice(Math.max(0, sIdx - 2), Math.min(segments.length, sIdx + 3))
          .map(s => ({
            speaker: s.speaker || 'Unknown Speaker',
            text: (s.text || '').trim(),
            start: s.start,
            end: s.end,
          }));

        results.push({
          episodeTitle: ep.title,
          releaseTag: ep.tag,
          audioUrl: ep.audioUrl,
          episodeDate: ep.date,
          speaker: speakerName,
          startSec: seg.start,
          endSec: seg.end,
          text: seg.text.trim(),
          dialogueWindow,
          relevanceScore: score,
          matchType: 'lexical',
          chunkId: seg.chunkId || `${ep.tag}#seg-${sIdx}`,
          sourceType: effectiveSourceType,
          sourceClassification: effectiveClassification,
          contentNature: seg.contentNature || data.contentNature || 'verbatim_statement',
          documentLocation: seg.documentLocation || data.documentLocation,
        });

        if (results.length >= max * 3) break;
      }
    } catch {
      // ignore
    }
  }

  results.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
  return results.slice(0, max);
}

export async function searchTranscriptVector(
  query: string,
  options: SearchOptions = {}
): Promise<TranscriptSearchResult[]> {
  const targetTag = options.episodeTag?.trim();
  let availableTags = getAvailableEmbeddingTags();
  if (targetTag) {
    availableTags = availableTags.filter(t => t === targetTag);
  }
  if (availableTags.length === 0) return [];

  const queryVec = await embedQuery(query);
  if (!queryVec) return [];

  const summaries = loadSummaries();
  const max = options.maxResults || 15;
  const targetSpeaker = normalizeSpeakerName(options.speaker);

  const results: TranscriptSearchResult[] = [];

  for (const tag of availableTags) {
    const summary = summaries.find(s => s.release_tag === tag);
    if (targetSpeaker && summary?.speakers?.length && !summary.speakers.some(sp => isNormalizedSpeakerMatch(sp, targetSpeaker))) {
      continue;
    }

    const emb = getEpisodeEmbeddings(tag);
    if (!emb) continue;

    const { manifest, vectors } = emb;
    const segmentCount = manifest.segments.length;

    for (let i = 0; i < segmentCount; i++) {
      const seg = manifest.segments[i];
      if (targetSpeaker && !isNormalizedSpeakerMatch(seg.speaker, targetSpeaker)) {
        continue;
      }

      const effectiveSourceType = seg.sourceType || manifest.sourceType || summary?.source_type || 'space_transcript';
      if (options.sourceType && effectiveSourceType !== options.sourceType) continue;

      const effectiveClassification = seg.sourceClassification || manifest.sourceClassification || summary?.source_classification || 'primary_record';
      if (options.sourceClassification && effectiveClassification !== options.sourceClassification) continue;

      const sim = dotProduct(vectors, i * 384, queryVec);
      if (sim > 0.22) {
        const dialogueWindow: DialogueTurn[] = manifest.segments
          .slice(Math.max(0, i - 2), Math.min(segmentCount, i + 3))
          .map(s => ({
            speaker: s.speaker,
            text: s.text,
            start: s.start,
            end: s.end,
          }));

        results.push({
          episodeTitle: manifest.title || summary?.title || tag,
          releaseTag: tag,
          audioUrl: summary?.audio_url,
          episodeDate: summary?.episode_date,
          speaker: seg.speaker,
          startSec: seg.start,
          endSec: seg.end,
          text: seg.text,
          dialogueWindow,
          relevanceScore: Number(sim.toFixed(4)),
          matchType: 'vector',
          chunkId: seg.chunkId || `${tag}#seg-${i}`,
          sourceType: effectiveSourceType as any,
          sourceClassification: effectiveClassification as any,
          contentNature: seg.contentNature || 'verbatim_statement',
          documentLocation: seg.documentLocation || manifest.documentLocation,
        });
      }
    }
  }

  results.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
  return results.slice(0, max * 2);
}

export function computeRRF(
  lexicalResults: TranscriptSearchResult[],
  vectorResults: TranscriptSearchResult[],
  k: number = 60
): TranscriptSearchResult[] {
  const scoreMap = new Map<
    string,
    { item: TranscriptSearchResult; rrfScore: number; lexicalRank?: number; vectorRank?: number }
  >();

  lexicalResults.forEach((item, idx) => {
    const key = item.chunkId ? `${item.releaseTag}#${item.chunkId}` : `${item.releaseTag}#${item.startSec.toFixed(2)}`;
    const rank = idx + 1;
    const contribution = 1 / (k + rank);
    scoreMap.set(key, { item, rrfScore: contribution, lexicalRank: rank });
  });

  vectorResults.forEach((item, idx) => {
    const key = item.chunkId ? `${item.releaseTag}#${item.chunkId}` : `${item.releaseTag}#${item.startSec.toFixed(2)}`;
    const rank = idx + 1;
    const contribution = 1 / (k + rank);
    const existing = scoreMap.get(key);
    if (existing) {
      existing.rrfScore += contribution;
      existing.vectorRank = rank;
      if (!existing.item.audioUrl && item.audioUrl) existing.item.audioUrl = item.audioUrl;
      if (!existing.item.documentLocation && item.documentLocation) existing.item.documentLocation = item.documentLocation;
      if (!existing.item.sourceType && item.sourceType) existing.item.sourceType = item.sourceType;
      if (!existing.item.sourceClassification && item.sourceClassification) existing.item.sourceClassification = item.sourceClassification;
      if (!existing.item.contentNature && item.contentNature) existing.item.contentNature = item.contentNature;
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

export interface RerankOptions {
  apiKey?: string;
  model?: 'rerank-v5.0-fast' | 'rerank-v5.0-pro';
  topN?: number;
  threshold?: number;
  fetchImpl?: typeof fetch;
}

export async function rerankWithCohere(
  query: string,
  candidates: TranscriptSearchResult[],
  options: RerankOptions = {}
): Promise<TranscriptSearchResult[]> {
  if (!candidates || candidates.length === 0 || !query || !query.trim()) return candidates || [];

  const apiKey = (options.apiKey !== undefined ? options.apiKey : (process.env.COHERE_API_KEY || '')).trim();
  if (!apiKey) {
    console.warn('[TranscriptSearchService] No COHERE_API_KEY available. Preserving candidate ranking.');
    return candidates;
  }

  const model = options.model || 'rerank-v5.0-fast';
  const topN = Math.min(candidates.length, options.topN || candidates.length);
  const fetcher = options.fetchImpl || fetch;

  const documents = candidates.map(c => c.text);

  const payload: Record<string, unknown> = {
    model,
    query,
    top_n: topN,
    documents,
    relevant_spans: {
      mode: 'enabled',
      threshold: options.threshold ?? 0.3,
      max_spans: 3,
    },
  };

  try {
    const res = await fetcher('https://api.cohere.com/v2/rerank', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[TranscriptSearchService] Cohere Rerank error ${res.status}: ${errText.slice(0, 200)}. Falling back to candidate ranking.`);
      return candidates;
    }

    const data = await res.json().catch(() => null);
    if (!data || !Array.isArray(data.results)) {
      console.warn('[TranscriptSearchService] Malformed Cohere Rerank response. Falling back to candidate ranking.');
      return candidates;
    }

    const reranked: TranscriptSearchResult[] = [];
    for (const item of data.results) {
      if (typeof item.index !== 'number' || item.index < 0 || item.index >= candidates.length) continue;
      const orig = candidates[item.index];
      const spans: RelevantSpan[] = Array.isArray(item.relevant_spans)
        ? item.relevant_spans
            .filter((s: any) => s && Number.isFinite(s.start) && Number.isFinite(s.end) && Number(s.start) >= 0 && Number(s.end) >= Number(s.start))
            .map((s: any) => ({
              start: Number(s.start),
              end: Number(s.end),
              score: Number.isFinite(s.score) ? Number(s.score) : 0,
              text: orig.text.slice(Number(s.start), Number(s.end)),
            }))
        : [];

      reranked.push({
        ...orig,
        relevanceScore: Number(item.relevance_score),
        matchType: 'rerank',
        relevantSpans: spans.length > 0 ? spans : undefined,
      });
    }

    return reranked.length > 0 ? reranked : candidates;
  } catch (err: any) {
    console.warn('[TranscriptSearchService] Exception calling Cohere Rerank API:', err?.message || err);
    return candidates;
  }
}

let mockSearchTranscriptArchive: ((query: string, options?: SearchOptions) => Promise<TranscriptSearchResult[]>) | null = null;

export function __setMockSearchTranscriptArchive(fn: ((query: string, options?: SearchOptions) => Promise<TranscriptSearchResult[]>) | null) {
  mockSearchTranscriptArchive = fn;
}

export async function searchTranscriptArchive(
  query: string,
  options: SearchOptions = {}
): Promise<TranscriptSearchResult[]> {
  if (mockSearchTranscriptArchive) {
    return mockSearchTranscriptArchive(query, options);
  }
  const mode = options.mode || 'hybrid';
  const max = options.maxResults || 15;

  let effectiveSpeaker = options.speaker && options.speaker !== 'ALL' ? options.speaker.trim() : undefined;
  let effectiveQuery = query;

  if (!effectiveSpeaker) {
    const parsed = extractSpeakerPrefix(query);
    if (parsed.speaker) {
      effectiveSpeaker = parsed.speaker;
      effectiveQuery = parsed.query;
    }
  }

  const effectiveOptions: SearchOptions = {
    ...options,
    speaker: effectiveSpeaker,
  };

  if (!effectiveQuery.trim()) {
    return searchTranscriptLexical('', effectiveOptions);
  }

  if (mode === 'lexical') {
    return searchTranscriptLexical(effectiveQuery, effectiveOptions);
  }

  if (mode === 'vector') {
    const vecResults = await searchTranscriptVector(effectiveQuery, effectiveOptions);
    return vecResults.slice(0, max);
  }

  if (mode === 'rerank') {
    const candidateLimit = Math.min(100, Math.max(50, max * 2));
    let candidates: TranscriptSearchResult[] = [];
    try {
      candidates = await searchTranscriptArchive(effectiveQuery, {
        ...effectiveOptions,
        mode: 'hybrid',
        maxResults: candidateLimit,
      });
    } catch {
      candidates = await searchTranscriptLexical(effectiveQuery, { ...effectiveOptions, maxResults: candidateLimit });
    }

    if (candidates.length === 0) return [];

    if (!effectiveQuery.trim()) {
      return candidates.slice(0, max);
    }

    const reranked = await rerankWithCohere(effectiveQuery, candidates, {
      apiKey: options.apiKey,
      model: options.rerankModel,
      topN: max,
      fetchImpl: options.fetchImpl,
    });

    return reranked.slice(0, max);
  }

  try {
    const [lexical, vector] = await Promise.all([
      searchTranscriptLexical(effectiveQuery, { ...effectiveOptions, maxResults: max * 2 }),
      searchTranscriptVector(effectiveQuery, { ...effectiveOptions, maxResults: max * 2 }),
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
    return searchTranscriptLexical(effectiveQuery, effectiveOptions);
  }
}

function refineEditorialAndSpeakerIntent(rawText: string, existingSpeaker?: string): { query: string; speaker?: string; isEditorial: boolean } {
  let text = rawText;
  let speaker = existingSpeaker;
  if (!speaker) {
    const spkMatch = text.match(/(?:\b(?:clips?|soundbites?|moments?|quotes?|turns?)\s+(?:of|from|by|with|where)\s+)?\b([A-Za-z][A-Za-z0-9._-]{1,20})\s+(?:speaking|talking)\b/i);
    if (spkMatch && spkMatch[1]) {
      const cand = spkMatch[1].trim();
      if (!/^(?:someone|anyone|everyone|they|people|clip|clips)/i.test(cand)) {
        speaker = cand;
        text = text.replace(spkMatch[0], ' ').replace(/\s+/g, ' ').trim();
      }
    }
  }
  const isEditorial = /\b(?:funny|hilarious|funniest|best|wild|viral|punchline|joke|humor)\b/i.test(text);
  if (isEditorial || parseMaxDurationSec(text) !== null) {
    text = text
      .replace(/\b(?:that'?s|thats|which is|is)?\s*(?:under|max|maximum|up to|less than|shorter than|within|no more than|no longer than)\s+\d{1,3}\s*(?:s|sec|secs|second|seconds)\b/gi, ' ')
      .replace(/\b(?:that'?s|thats|which is|is)?\s*\d{1,3}\s*(?:s|sec|secs|second|seconds)\s*(?:max|maximum|or less|or shorter|or under|limit|long|clip|soundbite)?\b/gi, ' ')
      .replace(/\b(?:a|an|the)?\s*(?:really\s+|genuinely\s+)?(?:funny|hilarious|funniest|best|wild|viral|short|quick)?\s*(?:clips?|soundbites?|moments?|quotes?)\b/gi, ' ')
      .replace(/\b(?:that'?s|thats|which is|is)\s+(?:really\s+|genuinely\s+)?(?:funny|hilarious|funniest|best|wild|viral|max|maximum)\b/gi, ' ')
      .replace(/\b(?:funny|hilarious|funniest|viral|max|maximum)\b/gi, ' ')
      .replace(/^(?:of|from|by|with|about|for|that|thats|and|or|\s)+/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return { query: text, speaker, isEditorial };
}

export function detectSearchIntent(userMessage: string): {
  isCapabilityInquiry: boolean;
  isSearchQuery: boolean;
  isEditorialQuery?: boolean;
  query?: string;
  speaker?: string;
  episodeTag?: string;
  timestampSec?: number;
  maxDurationSec?: number;
} {
  const m = userMessage.trim();
  const lower = m.toLowerCase();

  // Negative check: never hijack system, pipeline, bug, or ingest questions
  if (/(?:why|how come|not|broken|bug|error|fail|stop|cron|pipeline|ingest|update|updating)/i.test(lower) && /(?:transcript|episode|feed|job|audio)/i.test(lower)) {
    return { isCapabilityInquiry: false, isSearchQuery: false };
  }

  if (
    /^(can you|are you able to|do you have access to|can i search|is it possible to search|do you know what was said|can you check)/i.test(lower) &&
    /transcript/i.test(lower)
  ) {
    return { isCapabilityInquiry: true, isSearchQuery: false };
  }

  const parsedTimestamp = parseTimestampSec(m);

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

  const searchTriggers = [
    /(?:search|find|look for|any mention of|where did|who said|what did|what was said about|did anyone talk about|quotes? about|soundbites? on|discuss(?:ed|ing)?)\s+(.+)/i,
    /(?:dialogue|spoken words|soundbites?)\s+(?:for|about|containing|with)\s+(.+)/i,
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

      const refined = refineEditorialAndSpeakerIntent(raw.trim(), speaker);
      const maxDurationSec = parseMaxDurationSec(m) || undefined;
      return {
        isCapabilityInquiry: false,
        isSearchQuery: true,
        isEditorialQuery: refined.isEditorial,
        query: refined.query,
        speaker: refined.speaker,
        episodeTag,
        timestampSec: parsedTimestamp || undefined,
        maxDurationSec,
      };
    }
  }

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
      audioUrl: data.audio_url || sum?.audio_url,
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

export function normalizeSpokenQuery(raw: string): string {
  if (!raw) return '';
  let str = raw;
  str = str.replace(/[—–]/g, ' ');
  str = str.replace(/\.{2,}|\u2026/g, ' ');
  str = str.replace(/["'“”‘’`[\]()<>]/g, ' ');
  str = str.replace(/\b(you know|sort of|kind of|i mean)\b/gi, ' ');
  str = str.replace(/\b([0-9]|10)\b/g, m => DIGIT_TO_WORDS[m] || m);
  str = str.replace(/\b(uh|um|er|ah)\b/gi, ' ');
  str = str.replace(/[,;:!?]+/g, ' ');
  str = str.replace(/\b(\w+)(?:\s+\1\b)+/gi, '$1');
  return str.replace(/\s+/g, ' ').trim();
}

export interface HandleSearchTranscriptsInput {
  query: string;
  scope?: 'active_episode' | 'all_transcripts';
  speaker_hint?: string;
  episodeTag?: string;
  timestamp_sec?: number;
  max_duration_sec?: number;
  exclude_meta?: boolean;
  maxResults?: number;
  mode?: 'hybrid' | 'lexical' | 'vector' | 'rerank';
  rerankModel?: 'rerank-v5.0-fast' | 'rerank-v5.0-pro';
  apiKey?: string;
  fetchImpl?: typeof fetch;
  activeSegments?: Array<{ speaker: string; text: string; start: number; end: number }>;
}

export interface TranscriptMatch {
  episode_id: string;
  episode_title: string;
  start_timestamp: number;
  end_timestamp: number;
  formatted_time: string;
  speaker: string;
  snippet: string;
  audio_url?: string;
  match_type?: string;
  relevance_score?: number;
  relevant_spans?: RelevantSpan[];
  dialogue_window?: DialogueTurn[];
  chunk_id?: string;
  source_type?: string;
  source_classification?: string;
  content_nature?: string;
  document_location?: DocumentLocation;
  energy_score?: number;
  pacing_wps?: number;
}

export interface HandleSearchTranscriptsResult {
  matches: TranscriptMatch[];
  totalMatches: number;
  queryUsed: string;
  scopeUsed: 'active_episode' | 'all_transcripts';
  speakerFilterApplied?: string;
  tier: 1 | 2;
}

export async function handleSearchTranscripts(
  input: HandleSearchTranscriptsInput
): Promise<HandleSearchTranscriptsResult> {
  const normalizedQuery = normalizeSpokenQuery(input.query);
  const max = input.maxResults || 12;
  const scope: 'active_episode' | 'all_transcripts' =
    input.scope === 'active_episode' && input.episodeTag ? 'active_episode' : 'all_transcripts';
  const targetTag = scope === 'active_episode' ? input.episodeTag : undefined;
  let speakerHint = input.speaker_hint?.trim() || undefined;

  if (input.episodeTag && input.activeSegments?.length) {
    registerEpisodeSegments(input.episodeTag, input.activeSegments);
  }

  let tier: 1 | 2 = 1;
  let rawResults: TranscriptSearchResult[] = [];
  let speakerApplied = speakerHint;

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

  const refinedInput = refineEditorialAndSpeakerIntent(input.query || "", speakerHint);
  if (!speakerHint && refinedInput.speaker) {
    speakerHint = refinedInput.speaker;
    speakerApplied = speakerHint;
  }
  const effectiveQuery = refinedInput.isEditorial ? normalizeSpokenQuery(refinedInput.query) : normalizedQuery;
  const maxDurationSec = input.max_duration_sec || parseMaxDurationSec(input.query || "") || undefined;
  const excludeMeta = input.exclude_meta ?? refinedInput.isEditorial;

  if (rawResults.length === 0 && (effectiveQuery || speakerHint || targetTag)) {
    const searchMode = effectiveQuery ? (input.mode || 'hybrid') : 'lexical';
    rawResults = await searchTranscriptArchive(effectiveQuery, {
      speaker: speakerHint,
      episodeTag: targetTag,
      activeSegments: input.activeSegments,
      maxResults: max,
      maxDurationSec,
      excludeMetaCommentary: excludeMeta,
      mode: searchMode,
      rerankModel: input.rerankModel,
      apiKey: input.apiKey,
      fetchImpl: input.fetchImpl,
    });
  }

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
      const anchorQuery = anchorWords.join(' ');
      let anchorResults = await searchTranscriptLexical(anchorQuery, {
        speaker: speakerApplied,
        episodeTag: targetTag,
        activeSegments: input.activeSegments,
        maxResults: max * 2,
      });

      let andFiltered = anchorResults.filter(r => {
        const textLower = r.text.toLowerCase();
        return anchorWords.every(word => textLower.includes(word));
      });

      if (andFiltered.length === 0 && anchorWords.length >= 2) {
        const topTwo = anchorWords.slice(0, 2);
        andFiltered = anchorResults.filter(r => {
          const textLower = r.text.toLowerCase();
          return topTwo.every(word => textLower.includes(word));
        });
      }

      rawResults = andFiltered.slice(0, max);
    }
  }

  const matches: TranscriptMatch[] = rawResults.map(r => ({
    episode_id: r.releaseTag,
    episode_title: r.episodeTitle,
    start_timestamp: r.startSec,
    end_timestamp: r.endSec,
    formatted_time: r.documentLocation?.displayText || formatTimestamp(r.startSec),
    speaker: r.speaker,
    snippet: r.text,
    audio_url: r.audioUrl,
    match_type: r.matchType,
    relevance_score: r.relevanceScore,
    relevant_spans: r.relevantSpans,
    dialogue_window: r.dialogueWindow,
    chunk_id: r.chunkId,
    source_type: r.sourceType,
    source_classification: r.sourceClassification,
    content_nature: r.contentNature,
    document_location: r.documentLocation,
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