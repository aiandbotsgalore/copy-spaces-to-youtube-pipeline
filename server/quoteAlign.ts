/**
 * Audio boundary alignment and review for Script Studio (Phase 3).
 *
 * For each quote:
 * 1. Cut the quote's utterance window +/- 1.0 s from the episode via ffmpeg (reads only that window).
 * 2. Run faster-whisper with word timestamps on that WAV via scripts/align_quote.py.
 * 3. Match the verified quote words in order against the recognised words.
 * 4. Confident (>= 85% matched, length consistent with word count): 'aligned', boundaries padded 0.15s
 *    and snapped with snapToSilence.
 * 5. Anything else: 'needs_review' with suggested start/end. Never used in a final render until approved.
 * 6. Results are cached in .spacepipe-studio/align-cache/ by tag, utterance range and text hash.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AudioBoundary, StudioClip } from '../utils/scriptTypes';
import { snapToSilence } from '../utils/trimResolver';

const execFileAsync = promisify(execFile);

export interface RecognizedWord {
  word: string;
  start: number;
  end: number;
  prob?: number;
}

export interface MatchResult {
  matchedPct: number;
  matchedWords: RecognizedWord[];
  rawStartSec: number;
  rawEndSec: number;
  rawDurationSec: number;
  totalQuoteWords: number;
}

const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, '');

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = cur;
    }
  }
  return row[b.length];
}

function wordsMatch(qw: string, rw: string): boolean {
  const q = norm(qw);
  const r = norm(rw);
  if (!q || !r) return false;
  if (q === r) return true;
  if (q.length >= 4 && r.length >= 4 && levenshtein(q, r) <= 1) return true;
  return false;
}

/**
 * Matches verified quote words in order against recognized whisper words using DP (LCS).
 */
export function matchQuoteWords(verbatim: string, recognized: RecognizedWord[]): MatchResult {
  const quoteTokens = verbatim
    .split(/\s+/)
    .map(w => w.trim())
    .filter(Boolean);

  if (!quoteTokens.length || !recognized.length) {
    return {
      matchedPct: 0,
      matchedWords: [],
      rawStartSec: 0,
      rawEndSec: 0,
      rawDurationSec: 0,
      totalQuoteWords: quoteTokens.length,
    };
  }

  const N = quoteTokens.length;
  const M = recognized.length;

  // DP table: dp[i][j] stores length of LCS
  const dp: number[][] = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(0));

  for (let i = 1; i <= N; i++) {
    for (let j = 1; j <= M; j++) {
      if (wordsMatch(quoteTokens[i - 1], recognized[j - 1].word)) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find matched words in recognized
  const matchedWords: RecognizedWord[] = [];
  let i = N;
  let j = M;

  while (i > 0 && j > 0) {
    if (wordsMatch(quoteTokens[i - 1], recognized[j - 1].word) && dp[i][j] === dp[i - 1][j - 1] + 1) {
      matchedWords.unshift(recognized[j - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  const matchedCount = matchedWords.length;
  const matchedPct = Math.round((matchedCount / N) * 1000) / 1000;

  const rawStartSec = matchedWords[0]?.start ?? (recognized[0]?.start || 0);
  const rawEndSec = matchedWords[matchedWords.length - 1]?.end ?? (recognized[recognized.length - 1]?.end || 0);
  const rawDurationSec = Math.max(0, Math.round((rawEndSec - rawStartSec) * 1000) / 1000);

  return {
    matchedPct,
    matchedWords,
    rawStartSec,
    rawEndSec,
    rawDurationSec,
    totalQuoteWords: N,
  };
}

/**
 * Decodes 16-bit PCM WAV data from a Buffer into a Float32Array (normalized -1.0 to 1.0).
 */
export function decodeWavPcm16(buf: Buffer): { data: Float32Array; sampleRate: number } | null {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }
  let off = 12;
  let channels = 1;
  let sampleRate = 16000;
  let bitsPerSample = 16;
  let dataOffset = 0;
  let dataSize = 0;

  while (off + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', off, off + 4);
    const chunkSize = buf.readUInt32LE(off + 4);
    if (chunkId === 'fmt ' && off + 24 <= buf.length) {
      channels = buf.readUInt16LE(off + 10);
      sampleRate = buf.readUInt32LE(off + 12);
      bitsPerSample = buf.readUInt16LE(off + 22);
    } else if (chunkId === 'data') {
      dataOffset = off + 8;
      dataSize = Math.min(chunkSize, buf.length - dataOffset);
      break;
    }
    off += 8 + chunkSize + (chunkSize % 2);
  }

  if (!dataOffset || dataSize <= 0 || bitsPerSample !== 16) return null;

  const bytesPerSample = 2;
  const totalSamples = Math.floor(dataSize / (channels * bytesPerSample));
  const data = new Float32Array(totalSamples);

  if (channels === 1) {
    for (let k = 0; k < totalSamples; k++) {
      data[k] = buf.readInt16LE(dataOffset + k * 2) / 32768.0;
    }
  } else {
    for (let k = 0; k < totalSamples; k++) {
      let sum = 0;
      for (let c = 0; c < channels; c++) {
        sum += buf.readInt16LE(dataOffset + (k * channels + c) * 2) / 32768.0;
      }
      data[k] = sum / channels;
    }
  }

  return { data, sampleRate };
}

export interface AlignDeps {
  root?: string;
  cutWindow?: (audioUrl: string, off: number, durationSec: number, label: string) => Promise<string>;
  runWhisper?: (wavPath: string) => Promise<{ words: RecognizedWord[]; duration: number }>;
  getAudioData?: (wavPath: string) => Promise<{ data: Float32Array; sampleRate: number } | null>;
  baseCacheDir?: string;
}

const defaultCutWindow = async (root: string, audioUrl: string, off: number, durationSec: number, label: string): Promise<string> => {
  const dir = path.join(root, '.spacepipe-studio', 'clip-cache');
  fs.mkdirSync(dir, { recursive: true });
  const key = createHash('sha256').update(`${audioUrl}|${off}|${durationSec}`).digest('hex').slice(0, 16);
  const out = path.join(dir, `${key}.wav`);
  if (fs.existsSync(out)) return out;

  const tmp = path.join(dir, `${key}.${randomUUID().slice(0, 8)}.tmp.wav`);
  await execFileAsync('ffmpeg', [
    '-nostdin',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    String(off),
    '-i',
    audioUrl,
    '-t',
    String(durationSec),
    '-vn',
    '-acodec',
    'pcm_s16le',
    '-f',
    'wav',
    tmp,
  ]);
  fs.renameSync(tmp, out);
  return out;
};

const defaultRunWhisper = async (root: string, wavPath: string): Promise<{ words: RecognizedWord[]; duration: number }> => {
  const scriptPath = path.join(root, 'scripts', 'align_quote.py');
  const { stdout } = await execFileAsync('python', [scriptPath, '--wav', wavPath]);
  const parsed = JSON.parse(stdout);
  return {
    words: Array.isArray(parsed?.words) ? parsed.words : [],
    duration: typeof parsed?.duration === 'number' ? parsed.duration : 0,
  };
};

const defaultGetAudioData = async (wavPath: string): Promise<{ data: Float32Array; sampleRate: number } | null> => {
  if (!fs.existsSync(wavPath)) return null;
  const buf = fs.readFileSync(wavPath);
  return decodeWavPcm16(buf);
};

export function getAlignCachePath(baseDir: string, releaseTag: string, segStart: number, segEnd: number, verbatim: string): string {
  const textHash = createHash('sha256').update(verbatim).digest('hex').slice(0, 12);
  const safeStart = Math.round(segStart * 1000);
  const safeEnd = Math.round(segEnd * 1000);
  return path.join(baseDir, `${releaseTag}_${safeStart}_${safeEnd}_${textHash}.json`);
}

/**
 * Aligns audio for a quote:
 * - Reads cache if present
 * - Cuts window +/- 1.0 s
 * - Transcribes with faster-whisper
 * - Matches words
 * - Evaluates >= 85% confident gate
 * - Applies 0.15s padding and snapToSilence
 * - Returns AudioBoundary and persists to align cache
 */
export async function alignQuoteAudio(
  quote: {
    releaseTag: string;
    verbatim: string;
    segStart: number;
    segEnd: number;
    audioUrl: string;
  },
  deps: AlignDeps = {}
): Promise<AudioBoundary> {
  const root = deps.root || process.cwd();
  const cacheDir = deps.baseCacheDir || path.join(root, '.spacepipe-studio', 'align-cache');
  fs.mkdirSync(cacheDir, { recursive: true });

  const cacheFile = getAlignCachePath(cacheDir, quote.releaseTag, quote.segStart, quote.segEnd, quote.verbatim);
  if (fs.existsSync(cacheFile)) {
    try {
      const cached: AudioBoundary = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (cached && typeof cached.status === 'string') return cached;
    } catch {
      // cache invalid, recompute
    }
  }

  const cutStart = Math.max(0, quote.segStart - 1.0);
  const cutDuration = Math.round((quote.segEnd + 1.0 - cutStart) * 1000) / 1000;

  const cutFn = deps.cutWindow ?? ((url, off, dur, label) => defaultCutWindow(root, url, off, dur, label));
  const whisperFn = deps.runWhisper ?? (wav => defaultRunWhisper(root, wav));
  const audioDataFn = deps.getAudioData ?? (wav => defaultGetAudioData(wav));

  let wavPath: string;
  try {
    wavPath = await cutFn(quote.audioUrl, cutStart, cutDuration, `${quote.releaseTag} [${cutStart}..${cutStart + cutDuration}]`);
  } catch (e: any) {
    const boundary: AudioBoundary = {
      status: 'needs_review',
      suggestedStartSec: quote.segStart,
      suggestedEndSec: quote.segEnd,
      matchedPct: 0,
      reason: `Failed to cut audio window: ${e?.message || e}`,
    };
    fs.writeFileSync(cacheFile, JSON.stringify(boundary, null, 2), 'utf8');
    return boundary;
  }

  let whisperRes: { words: RecognizedWord[]; duration: number };
  try {
    whisperRes = await whisperFn(wavPath);
  } catch (e: any) {
    const boundary: AudioBoundary = {
      status: 'needs_review',
      suggestedStartSec: quote.segStart,
      suggestedEndSec: quote.segEnd,
      matchedPct: 0,
      reason: `Whisper alignment failed: ${e?.message || e}`,
    };
    fs.writeFileSync(cacheFile, JSON.stringify(boundary, null, 2), 'utf8');
    return boundary;
  }

  const match = matchQuoteWords(quote.verbatim, whisperRes.words);

  // Consistency check: minimum 0.10s per word, max 1.5s per word
  const minExpected = match.totalQuoteWords * 0.1;
  const maxExpected = Math.max(3.0, match.totalQuoteWords * 1.5);
  const durationConsistent = match.rawDurationSec >= minExpected && match.rawDurationSec <= maxExpected;
  const isConfident = match.matchedPct >= 0.85 && durationConsistent;

  if (!isConfident) {
    const reason = match.matchedPct < 0.85
      ? `Only ${Math.round(match.matchedPct * 100)}% of words matched recognized audio.`
      : `Recognized audio duration (${match.rawDurationSec.toFixed(1)}s) inconsistent with word count (${match.totalQuoteWords} words).`;

    const boundary: AudioBoundary = {
      status: 'needs_review',
      suggestedStartSec: Math.round((cutStart + match.rawStartSec) * 1000) / 1000,
      suggestedEndSec: Math.round((cutStart + match.rawEndSec) * 1000) / 1000,
      matchedPct: match.matchedPct,
      reason,
      words: match.matchedWords.map(w => ({
        w: w.word,
        s: Math.round((cutStart + w.start) * 1000) / 1000,
        e: Math.round((cutStart + w.end) * 1000) / 1000,
      })),
    };
    fs.writeFileSync(cacheFile, JSON.stringify(boundary, null, 2), 'utf8');
    return boundary;
  }

  // Confident result: apply 0.15s padding and snap to silence
  let targetRelStart = Math.max(0, match.rawStartSec - 0.15);
  let targetRelEnd = Math.min(cutDuration, match.rawEndSec + 0.15);

  try {
    const audioData = await audioDataFn(wavPath);
    if (audioData) {
      const snappedStart = snapToSilence(audioData.data, audioData.sampleRate, targetRelStart, 0.35);
      if (snappedStart !== null) targetRelStart = snappedStart;

      const snappedEnd = snapToSilence(audioData.data, audioData.sampleRate, targetRelEnd, 0.35);
      if (snappedEnd !== null) targetRelEnd = snappedEnd;
    }
  } catch {
    // If audioData decoding fails, use targetRelStart/targetRelEnd directly
  }

  const finalStartSec = Math.round((cutStart + targetRelStart) * 1000) / 1000;
  const finalEndSec = Math.round((cutStart + targetRelEnd) * 1000) / 1000;

  const boundary: AudioBoundary = {
    status: 'aligned',
    source: 'alignment',
    startSec: finalStartSec,
    endSec: finalEndSec,
    matchedPct: match.matchedPct,
    words: match.matchedWords.map(w => ({
      w: w.word,
      s: Math.round((cutStart + w.start) * 1000) / 1000,
      e: Math.round((cutStart + w.end) * 1000) / 1000,
    })),
  };

  fs.writeFileSync(cacheFile, JSON.stringify(boundary, null, 2), 'utf8');
  return boundary;
}

/**
 * Handles manual review actions (nudge, set_range, approve) for a quote audio boundary.
 */
export function reviewQuoteAudio(
  current: AudioBoundary,
  action: {
    action: 'approve' | 'nudge' | 'set_range';
    startSec?: number;
    endSec?: number;
    deltaStartSec?: number;
    deltaEndSec?: number;
  }
): AudioBoundary {
  const round3 = (n: number) => Math.round(n * 1000) / 1000;

  if (action.action === 'approve') {
    const s = action.startSec ?? current.startSec ?? current.suggestedStartSec;
    const e = action.endSec ?? current.endSec ?? current.suggestedEndSec;
    if (s == null || e == null || e <= s) {
      throw new Error(`Invalid audio boundaries for approval: ${s}s to ${e}s.`);
    }
    return {
      ...current,
      status: 'verified',
      source: 'manual',
      startSec: round3(s),
      endSec: round3(e),
      reviewedAt: Date.now(),
    };
  }

  if (action.action === 'nudge') {
    const deltaS = action.deltaStartSec || 0;
    const deltaE = action.deltaEndSec || 0;

    if (current.startSec !== undefined && current.endSec !== undefined) {
      const nextS = Math.max(0, current.startSec + deltaS);
      const nextE = Math.max(nextS + 0.1, current.endSec + deltaE);
      return {
        ...current,
        startSec: round3(nextS),
        endSec: round3(nextE),
      };
    }
    const curS = current.suggestedStartSec || 0;
    const curE = current.suggestedEndSec || curS + 1.0;
    const nextS = Math.max(0, curS + deltaS);
    const nextE = Math.max(nextS + 0.1, curE + deltaE);
    return {
      ...current,
      suggestedStartSec: round3(nextS),
      suggestedEndSec: round3(nextE),
    };
  }

  if (action.action === 'set_range') {
    if (action.startSec == null || action.endSec == null || action.endSec <= action.startSec) {
      throw new Error(`Invalid audio range: ${action.startSec} to ${action.endSec}`);
    }
    return {
      ...current,
      suggestedStartSec: round3(action.startSec),
      suggestedEndSec: round3(action.endSec),
    };
  }

  return current;
}

/**
 * Exposes a starred quote with usable audio as an ordinary StudioClip (clipId: bq_<ref>).
 * Quotes with status 'needs_review' or 'none' return null.
 */
export function quoteToStudioClip(
  quote: {
    id: string;
    verbatim: string;
    speakerName?: string;
    speakerLabel?: string;
    audio: AudioBoundary;
    releaseTag: string;
    wavUrl?: string;
  },
  episodeAudioUrl: string
): StudioClip | null {
  if (quote.audio.status !== 'aligned' && quote.audio.status !== 'verified') {
    return null;
  }

  const speaker = quote.speakerName || 'an unidentified speaker';
  const speakerDisplay = quote.speakerName || 'Unidentified Speaker';
  const title = `${speakerDisplay}: "${quote.verbatim.slice(0, 40)}..."`;
  const cleanId = quote.id.replace(/[^a-zA-Z0-9_-]/g, '_');
  const clipId = `bq_${cleanId}`;

  if (quote.wavUrl) {
    const dur = (quote.audio.endSec ?? 0) - (quote.audio.startSec ?? 0);
    return {
      clipId,
      title,
      text: quote.verbatim,
      speaker,
      releaseTag: quote.releaseTag,
      audioUrl: quote.wavUrl,
      audioOffsetSec: 0,
      durationSec: dur > 0 ? dur : 0,
      fn: 'evidence',
    };
  }

  if (quote.audio.startSec == null || quote.audio.endSec == null || quote.audio.endSec <= quote.audio.startSec) {
    return null;
  }

  const durationSec = Math.round((quote.audio.endSec - quote.audio.startSec) * 1000) / 1000;
  return {
    clipId,
    title,
    text: quote.verbatim,
    speaker,
    releaseTag: quote.releaseTag,
    audioUrl: episodeAudioUrl,
    audioOffsetSec: quote.audio.startSec,
    durationSec,
    fn: 'evidence',
  };
}
