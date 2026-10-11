/**
 * Lossless 16-bit PCM WAV Encoder & Stitcher (Pure TypeScript / Browser Native)
 * Allows in-browser audio slicing and multi-clip montage stitching with zero server dependencies.
 */

export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  // Interleave channels
  const length = buffer.length * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + length);
  const view = new DataView(arrayBuffer);

  // RIFF identifier
  writeString(view, 0, 'RIFF');
  // RIFF chunk length
  view.setUint32(4, 36 + length, true);
  // RIFF type
  writeString(view, 8, 'WAVE');
  // format chunk identifier
  writeString(view, 12, 'fmt ');
  // format chunk length
  view.setUint32(16, 16, true);
  // sample format (raw)
  view.setUint16(20, format, true);
  // channel count
  view.setUint16(22, numChannels, true);
  // sample rate
  view.setUint32(24, sampleRate, true);
  // byte rate (sample rate * block align)
  view.setUint32(28, sampleRate * blockAlign, true);
  // block align (channel count * bytes per sample)
  view.setUint16(32, blockAlign, true);
  // bits per sample
  view.setUint16(34, bitDepth, true);
  // data chunk identifier
  writeString(view, 36, 'data');
  // data chunk length
  view.setUint32(40, length, true);

  // Write interleaved PCM audio data
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numChannels; c++) {
      // Clamp between -1 and 1
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      // Convert to 16-bit signed integer (-32768 to 32767)
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([view], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Extracts a sub-slice of an AudioBuffer from startSec to endSec.
 */
export function sliceAudioBuffer(
  audioCtx: AudioContext,
  buffer: AudioBuffer,
  startSec: number,
  endSec: number
): AudioBuffer {
  const sampleRate = buffer.sampleRate;
  const startOffset = Math.max(0, Math.floor(startSec * sampleRate));
  const endOffset = Math.min(buffer.length, Math.floor(endSec * sampleRate));
  const frameCount = Math.max(1, endOffset - startOffset);

  const slicedBuffer = audioCtx.createBuffer(
    buffer.numberOfChannels,
    frameCount,
    sampleRate
  );

  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const channelData = buffer.getChannelData(c);
    const slicedData = slicedBuffer.getChannelData(c);
    slicedData.set(channelData.subarray(startOffset, endOffset));
  }

  return slicedBuffer;
}

/**
 * Applies a raised-cosine micro-fade (fade-in and fade-out) to eliminate
 * digital clicks and pops at slice boundaries.
 */
export function applyAntiClickFades(
  audioCtx: AudioContext,
  buffer: AudioBuffer,
  fadeMs: number = 12
): AudioBuffer {
  const sampleRate = buffer.sampleRate;
  const fadeSamples = Math.max(1, Math.floor((fadeMs / 1000) * sampleRate));
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;

  const fadedBuffer = audioCtx.createBuffer(numChannels, length, sampleRate);

  for (let c = 0; c < numChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = fadedBuffer.getChannelData(c);
    dst.set(src);

    const actualFade = Math.min(fadeSamples, Math.floor(length / 2));

    // Raised-cosine fade-in
    for (let i = 0; i < actualFade; i++) {
      const factor = 0.5 * (1 - Math.cos((Math.PI * i) / actualFade));
      dst[i] *= factor;
    }

    // Raised-cosine fade-out
    for (let i = 0; i < actualFade; i++) {
      const idx = length - 1 - i;
      const factor = 0.5 * (1 - Math.cos((Math.PI * i) / actualFade));
      dst[idx] *= factor;
    }
  }

  return fadedBuffer;
}

/**
 * Normalizes an AudioBuffer to target peak dBFS (e.g. -1.0 dBFS).
 * Caps the maximum gain boost to avoid amplifying background room noise.
 */
export function normalizeAudioBuffer(
  audioCtx: AudioContext,
  buffer: AudioBuffer,
  targetPeakDb: number = -1.0,
  maxBoostDb: number = 9.5
): AudioBuffer {
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;
  const sampleRate = buffer.sampleRate;

  // Find peak amplitude across all channels
  let peak = 0;
  for (let c = 0; c < numChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
  }

  if (peak <= 0.0001) return buffer; // Silence

  const targetAmp = Math.pow(10, targetPeakDb / 20);
  const maxGain = Math.pow(10, maxBoostDb / 20);
  const rawGain = targetAmp / peak;
  const gain = Math.min(rawGain, maxGain);

  const normalizedBuffer = audioCtx.createBuffer(numChannels, length, sampleRate);

  for (let c = 0; c < numChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = normalizedBuffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      dst[i] = Math.max(-1, Math.min(1, src[i] * gain));
    }
  }

  return normalizedBuffer;
}

export interface StitchOptions {
  gapSec?: number;
  normalizePeak?: boolean;
  targetPeakDb?: number; // default -1.0 dBFS
  antiClickFades?: boolean;
  fadeMs?: number; // default 12ms
}

/**
 * Stitches multiple AudioBuffers sequentially into one master AudioBuffer
 * with a configurable gap (in seconds), optional loudness normalization,
 * and anti-click micro-fades between each clip.
 */
export function stitchAudioBuffers(
  audioCtx: AudioContext,
  buffers: AudioBuffer[],
  optionsOrGap: number | StitchOptions = 0.5
): AudioBuffer {
  if (buffers.length === 0) {
    return audioCtx.createBuffer(2, audioCtx.sampleRate, audioCtx.sampleRate);
  }

  const options: StitchOptions = typeof optionsOrGap === 'number'
    ? { gapSec: optionsOrGap }
    : optionsOrGap;

  const gapSec = options.gapSec ?? 0.5;
  const shouldNormalize = options.normalizePeak ?? true;
  const targetPeakDb = options.targetPeakDb ?? -1.0;
  const shouldFade = options.antiClickFades ?? true;
  const fadeMs = options.fadeMs ?? 12;

  // Process each clip with anti-click fades and loudness normalization
  const processedBuffers: AudioBuffer[] = buffers.map(buf => {
    let current = buf;
    if (shouldFade) {
      current = applyAntiClickFades(audioCtx, current, fadeMs);
    }
    if (shouldNormalize) {
      current = normalizeAudioBuffer(audioCtx, current, targetPeakDb);
    }
    return current;
  });

  if (processedBuffers.length === 1) {
    return processedBuffers[0];
  }

  const sampleRate = processedBuffers[0].sampleRate;
  const numChannels = Math.max(...processedBuffers.map(b => b.numberOfChannels));
  const gapSamples = Math.floor(gapSec * sampleRate);

  // Compute total sample length
  let totalLength = 0;
  for (let i = 0; i < processedBuffers.length; i++) {
    totalLength += processedBuffers[i].length;
    if (i < processedBuffers.length - 1) {
      totalLength += gapSamples;
    }
  }

  const masterBuffer = audioCtx.createBuffer(numChannels, totalLength, sampleRate);

  for (let c = 0; c < numChannels; c++) {
    const masterData = masterBuffer.getChannelData(c);
    let currentOffset = 0;

    for (let i = 0; i < processedBuffers.length; i++) {
      const clip = processedBuffers[i];
      const clipChannelData = c < clip.numberOfChannels
        ? clip.getChannelData(c)
        : clip.getChannelData(0); // fallback to mono if fewer channels

      masterData.set(clipChannelData, currentOffset);
      currentOffset += clip.length;

      if (i < processedBuffers.length - 1) {
        // Gap is already zero-filled in new Float32Array
        currentOffset += gapSamples;
      }
    }
  }

  return masterBuffer;
}

