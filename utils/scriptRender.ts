/**
 * Renders a compiled script to one WAV in the browser with the existing Montage chain (utils/wavEncoder.ts):
 * Web Audio decode, slice, 18 ms raised-cosine fades, each part levelled, stitched with the script's pauses
 * as gaps. A master pass (utils/loudness.ts) then measures BS.1770 integrated loudness and brings the whole
 * episode to -16 LUFS with no sample above -1 dBFS; the measured values go into the manifest.
 *
 * Unlike the Montage export, nothing is skipped: a source that cannot be fetched or decoded stops the
 * render and names the block and clip.
 */
import { audioBufferToWav, sliceAudioBuffer, stitchAudioBuffers } from './wavEncoder';
import { RENDER_SETTINGS, type CompiledItem } from './scriptCompile';
import { masterToLoudness } from './loudness';

export class RenderError extends Error {
  constructor(public blockId: string, message: string) { super(message); }
}

export interface RenderDeps {
  audioCtx: AudioContext;
  /** Fetches the bytes of an audio URL (through the cache or proxy as the app does). */
  fetchAudio: (url: string) => Promise<ArrayBuffer>;
  onProgress?: (message: string) => void;
}

export interface RenderOutput { wav: Blob; renderedSec: number[]; totalSec: number; measured: { integratedLufs: number; samplePeakDb: number } }

export async function renderCompiled(items: CompiledItem[], deps: RenderDeps): Promise<RenderOutput> {
  if (!items.length) throw new RenderError('', 'Nothing to render.');
  const { audioCtx } = deps;
  const decoded = new Map<string, AudioBuffer>();
  const parts: AudioBuffer[] = [];
  const gaps: number[] = [];
  const renderedSec: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const ci = items[i];
    const src = { url: ci.item.audioUrl || '', startSec: ci.item.startSec, endSec: ci.item.endSec };
    const url = src.url;
    const label = ci.kind === 'clip' ? `clip "${ci.item.title}" (block ${ci.blockId})` : `narration take for block ${ci.blockId}`;
    deps.onProgress?.(`Decoding ${i + 1} of ${items.length}: ${label}`);
    let buf = decoded.get(url);
    if (!buf) {
      let bytes: ArrayBuffer;
      try { bytes = await deps.fetchAudio(url); } catch (e: any) { throw new RenderError(ci.blockId, `Could not fetch the ${label}: ${e?.message || e}`); }
      try { buf = await audioCtx.decodeAudioData(bytes); } catch (e: any) { throw new RenderError(ci.blockId, `Could not decode the ${label}: ${e?.message || e}`); }
      decoded.set(url, buf);
      if (decoded.size > 4) decoded.delete(decoded.keys().next().value as string);
    }
    const start = src.startSec;
    const end = Math.min(src.endSec, buf.duration);
    if (!(end - start > 0.05)) throw new RenderError(ci.blockId, `The ${label} window ${start.toFixed(2)}s to ${src.endSec.toFixed(2)}s lies outside its ${buf.duration.toFixed(2)}s audio file.`);
    const part = sliceAudioBuffer(audioCtx, buf, start, end);
    parts.push(part);
    renderedSec.push(part.length / part.sampleRate);
    gaps.push(ci.item.gapAfterSec || 0);
  }
  deps.onProgress?.('Mastering: 18 ms fades, about -16 LUFS, -1 dB peak');
  const master = stitchAudioBuffers(audioCtx, parts, {
    gapSec: 0, gapsSec: gaps.slice(0, -1), normalizePeak: true, targetLufs: RENDER_SETTINGS.targetLufs,
    targetPeakDb: RENDER_SETTINGS.peakDb, antiClickFades: true, fadeMs: RENDER_SETTINGS.fadeMs,
  });
  deps.onProgress?.('Measuring loudness (BS.1770) and bringing the episode to -16 LUFS');
  const channels = Array.from({ length: master.numberOfChannels }, (_, c) => master.getChannelData(c));
  const m = masterToLoudness(channels, master.sampleRate, RENDER_SETTINGS.targetLufs, RENDER_SETTINGS.peakDb);
  deps.onProgress?.('Encoding 16-bit WAV');
  return { wav: audioBufferToWav(master), renderedSec, totalSec: master.length / master.sampleRate, measured: { integratedLufs: m.integratedLufs, samplePeakDb: m.samplePeakDb } };
}
