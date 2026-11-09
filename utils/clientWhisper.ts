/**
 * utils/clientWhisper.ts
 *
 * In-browser speech-to-text engine powered by @huggingface/transformers (Whisper Tiny).
 * Transcribes audio snippets and microphone inputs directly in the browser via WebGPU / WASM
 * with zero server round-trips or API keys.
 */

import { pipeline, env } from '@huggingface/transformers';

// Configure transformers.js for optimized in-browser execution
if (typeof window !== 'undefined') {
  env.allowLocalModels = false;
  env.useBrowserCache = true;
}

export interface WhisperSegment {
  start: number;
  end: number;
  text: string;
}

export interface ClientTranscriptionResult {
  text: string;
  segments?: WhisperSegment[];
  durationSec?: number;
}

let transcriberPromise: Promise<any> | null = null;
let isModelLoaded = false;

/**
 * Pre-warms or retrieves the singleton Whisper pipeline with WebGPU acceleration.
 */
export async function getClientWhisperPipeline(onProgress?: (progress: number) => void) {
  if (!transcriberPromise) {
    const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
    const device = hasWebGPU ? 'webgpu' : 'wasm';

    transcriberPromise = pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny.en', {
      device,
      dtype: hasWebGPU ? 'fp32' : 'q8',
      progress_callback: (info: any) => {
        if (info.status === 'progress' && typeof info.progress === 'number') {
          onProgress?.(Math.round(info.progress));
        }
      },
    }).then(instance => {
      isModelLoaded = true;
      return instance;
    }).catch(async (err) => {
      // Graceful fallback to wasm if webgpu encounters driver/shader issues
      if (device === 'webgpu') {
        console.warn('WebGPU Whisper pipeline initialization failed, falling back to WASM:', err);
        return pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny.en', {
          device: 'wasm',
          dtype: 'q8',
          progress_callback: (info: any) => {
            if (info.status === 'progress' && typeof info.progress === 'number') {
              onProgress?.(Math.round(info.progress));
            }
          },
        }).then(instance => {
          isModelLoaded = true;
          return instance;
        });
      }
      transcriberPromise = null;
      isModelLoaded = false;
      throw err;
    });
  }
  return transcriberPromise;
}

export function isWhisperModelLoaded(): boolean {
  return isModelLoaded;
}

/**
 * Transcribes audio data (Float32Array at 16kHz or AudioBuffer) directly in the browser.
 */
export async function transcribeAudio(
  audioInput: Float32Array | AudioBuffer | string,
  onProgress?: (pct: number) => void
): Promise<ClientTranscriptionResult> {
  const transcriber = await getClientWhisperPipeline(onProgress);

  let pcmData: Float32Array;

  if (typeof audioInput === 'string') {
    // If URL passed, fetch and decode to 16kHz
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) throw new Error('Web Audio not supported in this environment');
    const res = await fetch(audioInput, { mode: 'cors' });
    const arrayBuffer = await res.arrayBuffer();
    const ctx = new AudioContextClass({ sampleRate: 16000 });
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    pcmData = decoded.getChannelData(0);
    ctx.close().catch(() => {});
  } else if (audioInput instanceof AudioBuffer) {
    pcmData = audioInput.getChannelData(0);
  } else {
    pcmData = audioInput;
  }

  const output = await transcriber(pcmData, {
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: true,
  });

  const rawChunks: any[] = output.chunks || [];
  const segments: WhisperSegment[] = rawChunks.map(c => ({
    start: c.timestamp?.[0] || 0,
    end: c.timestamp?.[1] || 0,
    text: (c.text || '').trim(),
  }));

  return {
    text: (output.text || '').trim(),
    segments,
    durationSec: pcmData.length / 16000,
  };
}
