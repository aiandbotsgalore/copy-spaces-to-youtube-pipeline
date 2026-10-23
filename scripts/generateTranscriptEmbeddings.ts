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

export interface EmbeddingManifest {
  version: number;
  episodeTag: string;
  title?: string;
  dims: number;
  segmentCount: number;
  generatedAt: string;
  segments: Array<{
    index: number;
    start: number;
    end: number;
    speaker: string;
    text: string;
  }>;
}

async function main() {
  const args = process.argv.slice(2);
  let limit = Infinity;
  let force = false;
  let batchSize = 32;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--force') {
      force = true;
    } else if (args[i] === '--batch-size' && args[i + 1]) {
      batchSize = parseInt(args[i + 1], 10);
      i++;
    }
  }

  console.log('=== SpacePipe Offline Transcript Embeddings Generator ===');
  console.log(`Model: Xenova/all-MiniLM-L6-v2 (quantized ONNX, 384 dims)`);
  console.log(`Cache: ${modelsDir}`);
  console.log(`Batch size: ${batchSize}, Limit: ${limit === Infinity ? 'ALL' : limit}, Force: ${force}\n`);

  console.log('Loading feature-extraction pipeline...');
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
    quantized: true,
  });
  console.log('Pipeline loaded successfully.\n');

  const transcriptsDir = path.resolve(process.cwd(), '.cache', 'transcripts');
  if (!fs.existsSync(transcriptsDir)) {
    console.error(`Transcripts directory not found: ${transcriptsDir}`);
    process.exit(1);
  }

  const allFiles = fs.readdirSync(transcriptsDir).filter(f => f.endsWith('.json') && !f.endsWith('.embeddings.json'));
  console.log(`Found ${allFiles.length} transcript JSON files in .cache/transcripts.\n`);

  let processed = 0;
  let skipped = 0;
  const startedAll = Date.now();

  for (let fileIdx = 0; fileIdx < allFiles.length; fileIdx++) {
    if (processed >= limit) break;

    const file = allFiles[fileIdx];
    const filePath = path.join(transcriptsDir, file);
    const tag = file.replace('.json', '').split('_').slice(0, -1).join('_') || file.replace('.json', '');

    const binPath = path.join(transcriptsDir, `${tag}.embeddings.bin`);
    const manifestPath = path.join(transcriptsDir, `${tag}.embeddings.json`);

    const jsonStat = fs.statSync(filePath);
    if (!force && fs.existsSync(binPath) && fs.existsSync(manifestPath)) {
      const binStat = fs.statSync(binPath);
      if (binStat.mtimeMs >= jsonStat.mtimeMs) {
        skipped++;
        continue;
      }
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      const segments: Array<{ start?: number; end?: number; speaker?: string; text?: string }> =
        Array.isArray(data.segments) ? data.segments : Array.isArray(data) ? data : [];

      if (segments.length === 0) {
        skipped++;
        continue;
      }

      const t0 = Date.now();
      const validSegments = segments.filter(s => s.text && s.text.trim().length > 0);
      const manifestSegments: EmbeddingManifest['segments'] = [];
      const inputTexts: string[] = [];

      for (let sIdx = 0; sIdx < validSegments.length; sIdx++) {
        const s = validSegments[sIdx];
        const speaker = s.speaker?.trim() || 'Unknown';
        const text = s.text!.trim();
        const start = Number(s.start) || 0;
        const end = Number(s.end) || start;

        manifestSegments.push({
          index: sIdx,
          start,
          end,
          speaker,
          text,
        });

        // Form speaker-aware dialogue string
        inputTexts.push(`[Speaker: ${speaker}] ${text}`);
      }

      const allVectors = new Float32Array(manifestSegments.length * 384);

      // Process in batches
      for (let b = 0; b < inputTexts.length; b += batchSize) {
        const chunk = inputTexts.slice(b, b + batchSize);
        const output = await extractor(chunk, { pooling: 'mean', normalize: true });
        // output.data is Float32Array of length (chunk.length * 384)
        allVectors.set(output.data as any, b * 384);
      }

      // Write .bin file
      const buffer = Buffer.from(allVectors.buffer, allVectors.byteOffset, allVectors.byteLength);
      fs.writeFileSync(binPath, buffer);

      // Write .json manifest
      const manifest: EmbeddingManifest = {
        version: 1,
        episodeTag: tag,
        title: data.title || tag,
        dims: 384,
        segmentCount: manifestSegments.length,
        generatedAt: new Date().toISOString(),
        segments: manifestSegments,
      };
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      processed++;
      console.log(
        `[${processed}/${limit === Infinity ? allFiles.length : limit}] Embedded ${tag}: ${manifestSegments.length} turns in ${elapsed}s (${(manifestSegments.length / Number(elapsed)).toFixed(0)} turns/s)`
      );
    } catch (err: any) {
      console.error(`Failed to generate embeddings for ${file}:`, err.message);
    }
  }

  const totalTime = ((Date.now() - startedAll) / 1000).toFixed(1);
  console.log(`\n=== Embedding Generation Complete ===`);
  console.log(`Processed: ${processed} episodes, Skipped: ${skipped} episodes in ${totalTime}s.`);
}

main().catch(err => {
  console.error('Fatal error in generateTranscriptEmbeddings:', err);
  process.exit(1);
});
