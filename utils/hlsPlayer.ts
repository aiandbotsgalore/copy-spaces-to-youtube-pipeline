/**
 * utils/hlsPlayer.ts
 *
 * Adaptive HLS audio streaming controller.
 * Enables instantaneous seeking and low-latency playback across marathon (5-12 hour)
 * Twitter Space recordings by utilizing chunked HTTP Live Streaming (.m3u8)
 * with automatic fallback to native browser media playback.
 */

import Hls from 'hls.js';

export interface HlsAttachResult {
  isHls: boolean;
  destroy: () => void;
}

export function isHlsUrl(url?: string | null): boolean {
  if (!url) return false;
  return /\.m3u8(\?.*)?$/i.test(url);
}

/**
 * Attaches an audio source URL to an HTMLAudioElement with adaptive HLS handling.
 * Returns a cleanup/destroy callback.
 */
export function attachAudioSource(
  audioEl: HTMLAudioElement,
  url: string,
  onReady?: () => void,
  onError?: (err: any) => void
): HlsAttachResult {
  if (!audioEl || !url) {
    return { isHls: false, destroy: () => {} };
  }

  // 1. If not an HLS playlist, standard progressive playback
  if (!isHlsUrl(url)) {
    audioEl.src = url;
    onReady?.();
    return {
      isHls: false,
      destroy: () => {
        audioEl.src = '';
      },
    };
  }

  // 2. Native Safari / iOS HLS support
  if (audioEl.canPlayType('application/vnd.apple.mpegurl')) {
    audioEl.src = url;
    onReady?.();
    return {
      isHls: true,
      destroy: () => {
        audioEl.src = '';
      },
    };
  }

  // 3. MediaSource Extensions via hls.js (Chrome, Firefox, Edge)
  if (Hls.isSupported()) {
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      maxBufferLength: 30, // keep 30 seconds buffered for smooth seeking
      maxMaxBufferLength: 60,
    });

    hls.loadSource(url);
    hls.attachMedia(audioEl);

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      onReady?.();
    });

    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            console.warn('[HLS] Network error encountered, attempting recovery...');
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            console.warn('[HLS] Media error encountered, recovering...');
            hls.recoverMediaError();
            break;
          default:
            console.error('[HLS] Fatal error, destroying stream:', data);
            hls.destroy();
            onError?.(data);
            break;
        }
      }
    });

    return {
      isHls: true,
      destroy: () => {
        try {
          hls.destroy();
        } catch {}
      },
    };
  }

  // Fallback if MSE is not supported
  audioEl.src = url;
  return {
    isHls: false,
    destroy: () => {
      audioEl.src = '';
    },
  };
}
