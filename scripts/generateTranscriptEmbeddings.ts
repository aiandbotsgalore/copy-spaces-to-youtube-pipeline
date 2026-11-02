import fs from 'fs';
import path from 'path';
import { pipeline, env } from '@xenova/transformers';

// Setup local cache path
const modelsDir = path.resolve(process.cwd(), '.cache', 'models');
env.cacheDir = modelsDir;
env.localModelPath = modelsDir;

const localModelPath = path.resolve(modelsDir, 'Xenova', 'all-MiniLM-L6-v2');
if (fs.existsSync(localModelPath)) {
  env.allowRemoteModels = false;
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

export interface CanonicalEpisodePlan {
  tag: string;
  resolvedPath: string;
  sourceType: 'cache' | 'public';
  segmentCount: number;
  alternativeSources: string[];
}

export interface DiscoveryResult {
  plans: CanonicalEpisodePlan[];
  unmappedCacheFiles: string[];
  emptyOrInvalidFiles: string[];
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  segmentCount?: number;
  dims?: number;
}

/**
 * Discovers and plans canonical episodes across both .cache/transcripts and public/transcripts/episodes.
 * Resolves multi-asset files by selecting the source file with the maximum valid dialogue turns.
 */
export function discoverCanonicalEpisodes(options?: {
  cacheDir?: string;
  episodesDir?: string;
  summaryPath?: string;
}): DiscoveryResult {
  const cacheDir = options?.cacheDir || path.resolve(process.cwd(), '.cache', 'transcripts');
  const episodesDir = options?.episodesDir || path.resolve(process.cwd(), 'public', 'transcripts', 'episodes');
  const summaryPath = options?.summaryPath || path.resolve(process.cwd(), 'public', 'transcripts', 'transcripts_summary_index.json');

  const canonicalTags = new Set<string>();

  // 1. Collect canonical tags from public/transcripts/episodes
  if (fs.existsSync(episodesDir)) {
    const epFiles = fs.readdirSync(episodesDir).filter(f => f.endsWith('.json'));
    for (const f of epFiles) {
      canonicalTags.add(f.replace('.json', ''));
    }
  }

  // 2. Also incorporate tags from transcripts_summary_index.json if present
  if (fs.existsSync(summaryPath)) {
    try {
      const summaries = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
      if (Array.isArray(summaries)) {
        for (const s of summaries) {
          if (s.release_tag) canonicalTags.add(s.release_tag);
        }
      }
    } catch {
      // Ignore summary parse errors
    }
  }

  // 3. Scan .cache/transcripts and map candidate files to canonical tags
  const cacheCandidateMap = new Map<string, string[]>();
  const unmappedCacheFiles: string[] = [];
  const emptyOrInvalidFiles: string[] = [];

  if (fs.existsSync(cacheDir)) {
    const cacheFiles = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json') && !f.endsWith('.embeddings.json'));
    for (const f of cacheFiles) {
      const fullPath = path.join(cacheDir, f);
      const base = f.replace('.json', '');
      let mappedTag: string | null = null;

      if (canonicalTags.has(base)) {
        mappedTag = base;
      } else {
        const parts = base.split('_');
        const cand = parts.slice(0, -1).join('_');
        if (canonicalTags.has(cand)) {
          mappedTag = cand;
        } else if (parts.length >= 2 && canonicalTags.has(parts.slice(0, 2).join('_'))) {
          mappedTag = parts.slice(0, 2).join('_');
        }
      }

      if (mappedTag) {
        if (!cacheCandidateMap.has(mappedTag)) {
          cacheCandidateMap.set(mappedTag, []);
        }
        cacheCandidateMap.get(mappedTag)!.push(fullPath);
      } else {
        unmappedCacheFiles.push(f);
      }
    }
  }

  // 4. For each canonical tag, inspect all candidates and pick the one with highest valid turn count
  const plans: CanonicalEpisodePlan[] = [];

  for (const tag of canonicalTags) {
    const candidates: string[] = [];
    const publicPath = path.join(episodesDir, `${tag}.json`);
    if (fs.existsSync(publicPath)) {
      candidates.push(publicPath);
    }
    const cacheCandidates = cacheCandidateMap.get(tag) || [];
    for (const cp of cacheCandidates) {
      if (!candidates.includes(cp)) {
        candidates.push(cp);
      }
    }

    if (candidates.length === 0) {
      emptyOrInvalidFiles.push(`Missing sources for tag: ${tag}`);
      continue;
    }

    let bestPath = candidates[0];
    let bestCount = -1;

    for (const candidatePath of candidates) {
      try {
        const raw = fs.readFileSync(candidatePath, 'utf8');
        const data = JSON.parse(raw);
        const { manifestSegments } = extractSegmentsAndInputs(data);
        if (manifestSegments.length > bestCount) {
          bestCount = manifestSegments.length;
          bestPath = candidatePath;
        }
      } catch {
        emptyOrInvalidFiles.push(`Corrupt transcript: ${candidatePath}`);
      }
    }

    if (bestCount <= 0) {
      emptyOrInvalidFiles.push(`Zero valid turns for tag: ${tag} (${bestPath})`);
    }

    const isCache = bestPath.startsWith(cacheDir);
    plans.push({
      tag,
      resolvedPath: bestPath,
      sourceType: isCache ? 'cache' : 'public',
      segmentCount: Math.max(0, bestCount),
      alternativeSources: candidates.filter(c => c !== bestPath),
    });
  }

  // Deterministic order by episode tag
  plans.sort((a, b) => a.tag.localeCompare(b.tag));

  return { plans, unmappedCacheFiles, emptyOrInvalidFiles };
}

/**
 * Validates whether existing embeddings for an episode are complete, valid, and match expected byte size.
 */
export function validateExistingEmbeddings(tag: string, cacheDir: string): ValidationResult {
  const binPath = path.join(cacheDir, `${tag}.embeddings.bin`);
  const manifestPath = path.join(cacheDir, `${tag}.embeddings.json`);

  if (!fs.existsSync(binPath) || !fs.existsSync(manifestPath)) {
    return { valid: false, reason: 'missing_files' };
  }

  let manifest: EmbeddingManifest;
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    manifest = JSON.parse(raw);
  } catch (err: any) {
    return { valid: false, reason: `manifest_json_corrupted: ${err.message}` };
  }

  if (manifest.dims !== 384) {
    return { valid: false, reason: `invalid_dimensions: ${manifest.dims} (expected 384)` };
  }

  if (typeof manifest.segmentCount !== 'number' || manifest.segmentCount < 0) {
    return { valid: false, reason: `invalid_segment_count: ${manifest.segmentCount}` };
  }

  if (!Array.isArray(manifest.segments) || manifest.segments.length !== manifest.segmentCount) {
    return {
      valid: false,
      reason: `segment_mismatch: manifest claims ${manifest.segmentCount} segments but array has ${manifest.segments?.length}`,
    };
  }

  let binStat: fs.Stats;
  try {
    binStat = fs.statSync(binPath);
  } catch (err: any) {
    return { valid: false, reason: `cannot_stat_binary: ${err.message}` };
  }

  const expectedBytes = manifest.segmentCount * manifest.dims * 4;
  if (binStat.size !== expectedBytes) {
    return {
      valid: false,
      reason: `binary_size_mismatch: got ${binStat.size} bytes, expected ${expectedBytes} bytes`,
    };
  }

  return { valid: true, segmentCount: manifest.segmentCount, dims: manifest.dims };
}

/**
 * Atomically writes the .bin and .json manifest files to prevent corrupted embeddings upon interruption.
 */
export function atomicWriteEmbeddings(
  tag: string,
  cacheDir: string,
  manifest: EmbeddingManifest,
  buffer: Buffer
): void {
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  const nonce = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const tempBinPath = path.join(cacheDir, `${tag}.embeddings.bin.tmp.${nonce}`);
  const tempManifestPath = path.join(cacheDir, `${tag}.embeddings.json.tmp.${nonce}`);

  const targetBinPath = path.join(cacheDir, `${tag}.embeddings.bin`);
  const targetManifestPath = path.join(cacheDir, `${tag}.embeddings.json`);

  try {
    // 1. Write temp binary
    fs.writeFileSync(tempBinPath, buffer);

    // 2. Write temp manifest
    fs.writeFileSync(tempManifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    // 3. Verify temp binary size
    const binStat = fs.statSync(tempBinPath);
    const expectedBytes = manifest.segmentCount * manifest.dims * 4;
    if (binStat.size !== expectedBytes) {
      throw new Error(`Temp binary verification failed: got ${binStat.size} bytes, expected ${expectedBytes}`);
    }

    // 4. Verify temp manifest parses cleanly
    const parsedManifest = JSON.parse(fs.readFileSync(tempManifestPath, 'utf8'));
    if (parsedManifest.segmentCount !== manifest.segmentCount || parsedManifest.dims !== manifest.dims) {
      throw new Error('Temp manifest verification failed');
    }

    // 5. Atomic renames
    fs.renameSync(tempBinPath, targetBinPath);
    fs.renameSync(tempManifestPath, targetManifestPath);
  } catch (err) {
    // Cleanup temporary files on failure
    if (fs.existsSync(tempBinPath)) {
      try { fs.unlinkSync(tempBinPath); } catch {}
    }
    if (fs.existsSync(tempManifestPath)) {
      try { fs.unlinkSync(tempManifestPath); } catch {}
    }
    throw err;
  }
}

/**
 * Extracts valid turns from transcript JSON and formats speaker dialogue strings.
 */
export function extractSegmentsAndInputs(rawJsonData: any): {
  manifestSegments: EmbeddingManifestSegment[];
  inputTexts: string[];
} {
  const segments: Array<{ start?: number; end?: number; speaker?: string; text?: string }> =
    Array.isArray(rawJsonData.segments)
      ? rawJsonData.segments
      : Array.isArray(rawJsonData)
      ? rawJsonData
      : [];

  const manifestSegments: EmbeddingManifestSegment[] = [];
  const inputTexts: string[] = [];

  let validIndex = 0;
  for (const s of segments) {
    const text = s?.text ? s.text.trim() : '';
    if (text.length === 0) continue;

    const speaker = s.speaker?.trim() || 'Unknown';
    const start = Number(s.start) || 0;
    const end = Number(s.end) || start;

    manifestSegments.push({
      index: validIndex,
      start,
      end,
      speaker,
      text,
    });

    // Speaker-aware dialogue format identical to runtime search service
    inputTexts.push(`[Speaker: ${speaker}] ${text}`);
    validIndex++;
  }

  return { manifestSegments, inputTexts };
}

/**
 * Format duration in seconds into human-readable MM:SS or HH:MM:SS
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}h ${mins.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`;
  }
  return `${mins.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`;
}

async function main() {
  const args = process.argv.slice(2);
  let limit = Infinity;
  let force = false;
  let batchSize = 32;
  let dryRun = false;
  let targetTag: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--force') {
      force = true;
    } else if (args[i] === '--batch-size' && args[i + 1]) {
      batchSize = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--tag' && args[i + 1]) {
      targetTag = args[i + 1].trim();
      i++;
    }
  }

  console.log('================================================================');
  console.log('   SpacePipe Studio — Hardened Archive Embedding Generator');
  console.log('================================================================');
  console.log(`Model: Xenova/all-MiniLM-L6-v2 (quantized ONNX, 384 dims, CPU SIMD)`);
  console.log(`Batch Size: ${batchSize} | Limit: ${limit === Infinity ? 'ALL' : limit} | Force: ${force} | DryRun: ${dryRun}`);
  if (targetTag) console.log(`Target Tag Filter: ${targetTag}`);
  console.log('----------------------------------------------------------------\n');

  const cacheDir = path.resolve(process.cwd(), '.cache', 'transcripts');
  const episodesDir = path.resolve(process.cwd(), 'public', 'transcripts', 'episodes');

  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  // Graceful shutdown handling
  let isInterrupted = false;
  process.on('SIGINT', () => {
    console.log('\n\n[SIGINT] Interruption signal received. Completing in-flight operations safely...');
    isInterrupted = true;
  });
  process.on('SIGTERM', () => {
    console.log('\n\n[SIGTERM] Termination signal received. Completing in-flight operations safely...');
    isInterrupted = true;
  });

  console.log('1. Discovering canonical episodes across transcript directories...');
  const discovery = discoverCanonicalEpisodes({ cacheDir, episodesDir });
  let plans = discovery.plans;

  if (targetTag) {
    plans = plans.filter(p => p.tag === targetTag);
    if (plans.length === 0) {
      console.error(`Error: Target tag "${targetTag}" not found in canonical archive.`);
      process.exit(1);
    }
  }

  const totalEpisodesInArchive = plans.length;
  const totalTurnsInArchive = plans.reduce((acc, p) => acc + p.segmentCount, 0);

  console.log(`✓ Discovered ${totalEpisodesInArchive} canonical episodes (${totalTurnsInArchive.toLocaleString()} total dialogue turns).`);
  console.log(`  - Sources resolved: ${plans.filter(p => p.sourceType === 'cache').length} from .cache, ${plans.filter(p => p.sourceType === 'public').length} from public/episodes.`);
  if (discovery.unmappedCacheFiles.length > 0) {
    console.log(`  - Unmapped cache files (test fixtures/empty): ${discovery.unmappedCacheFiles.length}`);
  }

  // Audit existing embeddings
  let alreadyValidEpisodes = 0;
  let alreadyValidTurns = 0;
  let corruptedEpisodes = 0;

  for (const plan of plans) {
    const val = validateExistingEmbeddings(plan.tag, cacheDir);
    if (val.valid) {
      alreadyValidEpisodes++;
      alreadyValidTurns += val.segmentCount || 0;
    } else if (val.reason !== 'missing_files') {
      corruptedEpisodes++;
      console.warn(`  [Warning] Corrupted embedding detected for ${plan.tag}: ${val.reason}`);
    }
  }

  console.log(`✓ Existing embeddings audit: ${alreadyValidEpisodes}/${totalEpisodesInArchive} episodes verified valid (${alreadyValidTurns.toLocaleString()} turns).`);
  if (corruptedEpisodes > 0) {
    console.log(`  - Corrupted/incomplete files requiring regeneration: ${corruptedEpisodes}`);
  }

  if (dryRun) {
    console.log('\n[Dry Run] Discovery and validation complete. Exiting without modifying files.');
    return;
  }

  console.log('\n2. Initializing Xenova/all-MiniLM-L6-v2 pipeline...');
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
    quantized: true,
  });
  console.log('✓ Pipeline loaded successfully.\n');

  console.log('3. Starting embedding generation...\n');

  let processedCount = 0;
  let skippedCount = 0;
  let turnsProcessed = 0;
  const startTime = Date.now();

  for (let idx = 0; idx < plans.length; idx++) {
    if (isInterrupted) {
      console.log('\n[Interrupted] Halting generation gracefully.');
      break;
    }

    if (processedCount >= limit) {
      console.log(`\n[Limit Reached] Reached configured limit of ${limit} episodes.`);
      break;
    }

    const plan = plans[idx];
    const val = validateExistingEmbeddings(plan.tag, cacheDir);

    // Skip if already valid and not forcing regeneration
    if (!force && val.valid) {
      skippedCount++;
      continue;
    }

    if (plan.segmentCount === 0) {
      skippedCount++;
      continue;
    }

    const episodeStartTime = Date.now();
    try {
      const raw = fs.readFileSync(plan.resolvedPath, 'utf8');
      const data = JSON.parse(raw);
      const { manifestSegments, inputTexts } = extractSegmentsAndInputs(data);

      if (manifestSegments.length === 0) {
        skippedCount++;
        continue;
      }

      const allVectors = new Float32Array(manifestSegments.length * 384);

      // Process batches
      for (let b = 0; b < inputTexts.length; b += batchSize) {
        if (isInterrupted) break;
        const chunk = inputTexts.slice(b, b + batchSize);
        const output = await extractor(chunk, { pooling: 'mean', normalize: true });
        allVectors.set(output.data as any, b * 384);
      }

      if (isInterrupted) {
        console.log(`[Interrupted] Discarding partial work for ${plan.tag}.`);
        break;
      }

      // Write atomically
      const buffer = Buffer.from(allVectors.buffer, allVectors.byteOffset, allVectors.byteLength);
      const manifest: EmbeddingManifest = {
        version: 1,
        episodeTag: plan.tag,
        title: data.title || plan.tag,
        dims: 384,
        segmentCount: manifestSegments.length,
        generatedAt: new Date().toISOString(),
        segments: manifestSegments,
      };

      atomicWriteEmbeddings(plan.tag, cacheDir, manifest, buffer);

      processedCount++;
      turnsProcessed += manifestSegments.length;

      const episodeElapsedSec = (Date.now() - episodeStartTime) / 1000;
      const totalElapsedSec = (Date.now() - startTime) / 1000;
      const rate = turnsProcessed / Math.max(0.001, totalElapsedSec);

      // Estimate remaining turns
      const remainingEpisodes = plans.length - (skippedCount + processedCount);
      const avgTurnsPerEp = totalTurnsInArchive / totalEpisodesInArchive;
      const estRemainingTurns = remainingEpisodes * avgTurnsPerEp;
      const etaSec = rate > 0 ? estRemainingTurns / rate : 0;

      const epRate = (manifestSegments.length / Math.max(0.001, episodeElapsedSec)).toFixed(0);
      const progressPercent = (((skippedCount + processedCount) / totalEpisodesInArchive) * 100).toFixed(1);

      console.log(
        `[${skippedCount + processedCount}/${totalEpisodesInArchive} | ${progressPercent}%] ` +
        `Embedded ${plan.tag}: ${manifestSegments.length} turns in ${episodeElapsedSec.toFixed(1)}s (${epRate} t/s) | ` +
        `Overall Rate: ${rate.toFixed(0)} t/s | ETA: ${formatDuration(etaSec)}`
      );
    } catch (err: any) {
      console.error(`[Error] Failed to process ${plan.tag}:`, err.message);
    }
  }

  const totalRuntimeSec = (Date.now() - startTime) / 1000;
  console.log('\n================================================================');
  console.log('   Embedding Generation Session Summary');
  console.log('================================================================');
  console.log(`Status: ${isInterrupted ? 'INTERRUPTED (Safely halted)' : 'COMPLETED'}`);
  console.log(`Episodes Embedded This Run: ${processedCount}`);
  console.log(`Episodes Skipped (Already Valid): ${skippedCount}`);
  console.log(`Total Turns Embedded This Run: ${turnsProcessed.toLocaleString()}`);
  console.log(`Total Session Time: ${formatDuration(totalRuntimeSec)}`);
  if (processedCount > 0) {
    console.log(`Average Processing Speed: ${(turnsProcessed / Math.max(0.001, totalRuntimeSec)).toFixed(1)} turns/second`);
  }
  console.log('================================================================\n');
}

// Execute main only when run directly from CLI
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('generateTranscriptEmbeddings.ts')) {
  main().catch(err => {
    console.error('Fatal error in generateTranscriptEmbeddings:', err);
    process.exit(1);
  });
}
