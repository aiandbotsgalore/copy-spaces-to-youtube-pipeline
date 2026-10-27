import { useEffect, useRef, useState, type RefObject } from 'react';
import { isSameOriginUrl, meterLevel } from '../utils/vuMeter';

export interface AudioLevels {
  left: number;
  right: number;
  /** False when the meter cannot read samples (no Web Audio, or a cross-origin source). */
  available: boolean;
}

/**
 * Drives a stereo level meter from the real audio of an <audio> element through a Web Audio
 * AnalyserNode per channel. The element is routed through the graph once (createMediaElementSource
 * can only be called once per element) and always on to the destination, so playback is unchanged.
 *
 * Cross-origin sources are not attached: without CORS headers Web Audio would output silence for
 * them, so for those the meter reports `available: false` instead of showing invented levels.
 */
export function useAudioLevelMeter(audioRef: RefObject<HTMLAudioElement | null>, isPlaying: boolean, src: string | undefined): AudioLevels {
  const [levels, setLevels] = useState<AudioLevels>({ left: 0, right: 0, available: true });
  const graphRef = useRef<{ ctx: AudioContext; left: AnalyserNode; right: AnalyserNode } | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !isPlaying) {
      setLevels(prev => ({ left: 0, right: 0, available: prev.available }));
      return;
    }
    const AudioCtx: typeof AudioContext | undefined =
      typeof window !== 'undefined' ? (window.AudioContext || (window as any).webkitAudioContext) : undefined;
    const currentSrc = audio.currentSrc || src || '';
    if (!AudioCtx || (!graphRef.current && !isSameOriginUrl(currentSrc, window.location.origin))) {
      setLevels({ left: 0, right: 0, available: false });
      return;
    }

    if (!graphRef.current) {
      try {
        const ctx = new AudioCtx();
        const source = ctx.createMediaElementSource(audio);
        const splitter = ctx.createChannelSplitter(2);
        const left = ctx.createAnalyser();
        const right = ctx.createAnalyser();
        left.fftSize = 1024;
        right.fftSize = 1024;
        source.connect(ctx.destination);
        source.connect(splitter);
        splitter.connect(left, 0);
        splitter.connect(right, 1);
        graphRef.current = { ctx, left, right };
      } catch {
        setLevels({ left: 0, right: 0, available: false });
        return;
      }
    }

    const { ctx, left, right } = graphRef.current;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const bufL = new Float32Array(left.fftSize);
    const bufR = new Float32Array(right.fftSize);
    let raf = 0;
    const tick = () => {
      left.getFloatTimeDomainData(bufL);
      right.getFloatTimeDomainData(bufR);
      // A mono source arrives only on channel 0; mirror it so both bars show the real signal.
      const l = meterLevel(bufL);
      const rRaw = meterLevel(bufR);
      const r = rRaw === 0 && l > 0 ? l : rRaw;
      setLevels({ left: l, right: r, available: true });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [audioRef, isPlaying, src]);

  useEffect(() => () => {
    graphRef.current?.ctx.close().catch(() => {});
    graphRef.current = null;
  }, []);

  return levels;
}
