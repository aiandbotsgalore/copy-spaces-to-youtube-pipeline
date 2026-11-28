import React, { createContext, useContext, useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { attachAudioSource } from '../utils/hlsPlayer';
import { toFetchableUrl } from '../utils/audioUrl';
import { createMachine } from '../utils/stateMachine';

export interface NowPlayingEpisode {
  id: number | string;
  title: string;
  audioUrl: string;
  durationLabel?: string;
}

export type AudioPlaybackState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'buffering'
  | 'paused'
  | 'ended'
  | 'error';

export interface PlayerControlsValue {
  current: NowPlayingEpisode | null;
  isPlaying: boolean;
  playbackState: AudioPlaybackState;
  playerError: string | null;
  playbackRate: number;
  volume: number;
  isMuted: boolean;
  getTime: () => { currentTime: number; duration: number };
  play: (episode: NowPlayingEpisode, startTime?: number) => void;
  togglePlay: () => void;
  seek: (time: number) => void;
  skip: (seconds: number) => void;
  setPlaybackRate: (rate: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  close: () => void;
}

export interface PlayerTimeValue {
  currentTime: number;
  duration: number;
}

export interface PlayerContextValue extends PlayerControlsValue, PlayerTimeValue {}

const PlayerControlsContext = createContext<PlayerControlsValue | null>(null);
const PlayerTimeContext = createContext<PlayerTimeValue | null>(null);

type AudioPlayerEvent =
  | 'ATTACH_SOURCE'
  | 'METADATA_LOADED'
  | 'CAN_PLAY'
  | 'PLAYING'
  | 'WAITING'
  | 'PAUSE'
  | 'ENDED'
  | 'ERROR'
  | 'CLOSE';

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [current, setCurrent] = useState<NowPlayingEpisode | null>(null);
  const [playbackState, setPlaybackState] = useState<AudioPlaybackState>('idle');
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [volume, setVolumeState] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const prevVolumeRef = useRef(1);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const hlsCleanupRef = useRef<(() => void) | null>(null);

  // Initialize Audio Player State Machine for Agent Introspection (AX)
  const playerMachineRef = useRef(
    createMachine<AudioPlaybackState, AudioPlayerEvent>(
      {
        id: 'audio-player',
        initial: 'idle',
        states: {
          idle: { ATTACH_SOURCE: 'loading' },
          loading: {
            METADATA_LOADED: 'ready',
            CAN_PLAY: 'ready',
            PLAYING: 'playing',
            ERROR: 'error',
            CLOSE: 'idle',
          },
          ready: {
            PLAYING: 'playing',
            ATTACH_SOURCE: 'loading',
            CLOSE: 'idle',
          },
          playing: {
            PAUSE: 'paused',
            WAITING: 'buffering',
            ENDED: 'ended',
            ERROR: 'error',
            ATTACH_SOURCE: 'loading',
            CLOSE: 'idle',
          },
          buffering: {
            PLAYING: 'playing',
            PAUSE: 'paused',
            ERROR: 'error',
            CLOSE: 'idle',
          },
          paused: {
            PLAYING: 'playing',
            ATTACH_SOURCE: 'loading',
            CLOSE: 'idle',
          },
          ended: {
            PLAYING: 'playing',
            ATTACH_SOURCE: 'loading',
            CLOSE: 'idle',
          },
          error: {
            ATTACH_SOURCE: 'loading',
            CLOSE: 'idle',
          },
        },
        onTransition: (_from, to) => {
          setPlaybackState(to);
        },
      },
      { current: null }
    )
  );

  const dispatchEvent = useCallback((event: AudioPlayerEvent, errorMsg?: string) => {
    if (errorMsg !== undefined) {
      setPlayerError(errorMsg);
    } else if (event !== 'ERROR') {
      setPlayerError(null);
    }
    playerMachineRef.current.send(event);
  }, []);

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;
    audio.playbackRate = playbackRate;
    audio.volume = volume;
    audio.muted = isMuted;

    const applyPendingSeek = () => {
      if (pendingSeekRef.current !== null && audio.duration) {
        const target = Math.min(pendingSeekRef.current, audio.duration);
        audio.currentTime = target;
        setCurrentTime(target);
        pendingSeekRef.current = null;
      }
    };

    const onTime = () => setCurrentTime(audio.currentTime);
    const onLoaded = () => {
      setDuration(audio.duration || 0);
      applyPendingSeek();
      dispatchEvent('METADATA_LOADED');
    };
    const onCanPlay = () => {
      applyPendingSeek();
      dispatchEvent('CAN_PLAY');
    };
    const onPlaying = () => dispatchEvent('PLAYING');
    const onWaiting = () => dispatchEvent('WAITING');
    const onPause = () => {
      if (audio.currentTime < audio.duration) {
        dispatchEvent('PAUSE');
      }
    };
    const onEnded = () => dispatchEvent('ENDED');
    const onError = () => {
      const msg = audio.error?.message || 'Error occurred during audio playback';
      dispatchEvent('ERROR', msg);
    };

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audio.pause();
      hlsCleanupRef.current?.();
      hlsCleanupRef.current = null;
    };
  }, [dispatchEvent]);

  const setPlaybackRate = useCallback((rate: number) => {
    setPlaybackRateState(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  }, []);

  const setVolume = useCallback((vol: number) => {
    const clamped = Math.max(0, Math.min(1, vol));
    setVolumeState(clamped);
    if (audioRef.current) {
      audioRef.current.volume = clamped;
      if (clamped > 0 && isMuted) {
        audioRef.current.muted = false;
        setIsMuted(false);
      }
    }
  }, [isMuted]);

  const toggleMute = useCallback(() => {
    if (!audioRef.current) return;
    if (isMuted) {
      audioRef.current.muted = false;
      setIsMuted(false);
      if (volume === 0) {
        setVolume(prevVolumeRef.current || 0.8);
      }
    } else {
      prevVolumeRef.current = volume;
      audioRef.current.muted = true;
      setIsMuted(true);
    }
  }, [isMuted, volume, setVolume]);

  const skip = useCallback((deltaSeconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const maxDuration = audio.duration || duration || Infinity;
    const target = Math.max(0, Math.min(audio.currentTime + deltaSeconds, maxDuration));
    audio.currentTime = target;
    setCurrentTime(target);
  }, [duration]);

  const play = useCallback((episode: NowPlayingEpisode, startTime?: number) => {
    const audio = audioRef.current;
    if (!audio) return;

    if (startTime !== undefined && startTime !== null) {
      pendingSeekRef.current = startTime;
    }

    if (current?.id !== episode.id || current?.audioUrl !== episode.audioUrl) {
      hlsCleanupRef.current?.();
      const streamUrl = toFetchableUrl(episode.audioUrl);
      dispatchEvent('ATTACH_SOURCE');
      const { destroy } = attachAudioSource(audio, streamUrl);
      hlsCleanupRef.current = destroy;
      audio.playbackRate = playbackRate;
      audio.volume = volume;
      audio.muted = isMuted;
      setCurrent(episode);
      setCurrentTime(startTime || 0);
      if (startTime !== undefined && startTime !== null && audio.readyState >= 1) {
        audio.currentTime = startTime;
      }
    } else if (startTime !== undefined && startTime !== null) {
      if (audio.readyState >= 1) {
        audio.currentTime = startTime;
        setCurrentTime(startTime);
        pendingSeekRef.current = null;
      } else {
        pendingSeekRef.current = startTime;
      }
    }

    audio.play().catch((err: Error) => {
      dispatchEvent('ERROR', err.message || 'Playback failed');
    });
  }, [current, playbackRate, volume, isMuted, dispatchEvent]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (playbackState === 'playing' || playbackState === 'buffering') {
      audio.pause();
    } else {
      audio.play().catch((err: Error) => {
        dispatchEvent('ERROR', err.message || 'Playback failed');
      });
    }
  }, [current, playbackState, dispatchEvent]);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.readyState >= 1) {
      audio.currentTime = time;
      setCurrentTime(time);
      pendingSeekRef.current = null;
    } else {
      pendingSeekRef.current = time;
      setCurrentTime(time);
    }
  }, []);

  const close = useCallback(() => {
    const audio = audioRef.current;
    if (audio) audio.pause();
    dispatchEvent('CLOSE');
    setCurrent(null);
    setCurrentTime(0);
    setDuration(0);
    pendingSeekRef.current = null;
  }, [dispatchEvent]);

  // Backward compatible isPlaying boolean
  const isPlaying = playbackState === 'playing' || playbackState === 'buffering';

  // Global Keyboard Shortcuts for audio controls (Space, ←/→ = 1s, Shift+←/→ = 15s, M)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when user is typing in form fields
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }

      // Yield Space / ArrowLeft / ArrowRight when Montage Studio is mounted (it owns transport hotkeys)
      if (
        (e.code === 'Space' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') &&
        document.querySelector('[data-component="montage-studio"]')
      ) {
        return;
      }

      if (e.code === 'Space' && current) {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowLeft' && current) {
        e.preventDefault();
        skip(e.shiftKey ? -15 : -1);
      } else if (e.code === 'ArrowRight' && current) {
        e.preventDefault();
        skip(e.shiftKey ? 15 : 1);
      } else if ((e.key === 'm' || e.key === 'M') && current) {
        e.preventDefault();
        toggleMute();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [current, togglePlay, skip, toggleMute]);

  const timeRef = useRef({ currentTime: 0, duration: 0 });
  timeRef.current = { currentTime, duration };
  const getTime = useCallback(() => timeRef.current, []);

  const controlsValue = useMemo<PlayerControlsValue>(
    () => ({
      current,
      isPlaying,
      playbackState,
      playerError,
      playbackRate,
      volume,
      isMuted,
      getTime,
      play,
      togglePlay,
      seek,
      skip,
      setPlaybackRate,
      setVolume,
      toggleMute,
      close,
    }),
    [
      current,
      isPlaying,
      playbackState,
      playerError,
      playbackRate,
      volume,
      isMuted,
      getTime,
      play,
      togglePlay,
      seek,
      skip,
      setPlaybackRate,
      setVolume,
      toggleMute,
      close,
    ]
  );

  const timeValue = useMemo<PlayerTimeValue>(
    () => ({ currentTime, duration }),
    [currentTime, duration]
  );

  return (
    <PlayerControlsContext.Provider value={controlsValue}>
      <PlayerTimeContext.Provider value={timeValue}>
        {children}
      </PlayerTimeContext.Provider>
    </PlayerControlsContext.Provider>
  );
};

export function usePlayerControls(): PlayerControlsValue {
  const ctx = useContext(PlayerControlsContext);
  if (!ctx) throw new Error('usePlayerControls must be used within a PlayerProvider');
  return ctx;
}

export function usePlayerTime(): PlayerTimeValue {
  const ctx = useContext(PlayerTimeContext);
  if (!ctx) throw new Error('usePlayerTime must be used within a PlayerProvider');
  return ctx;
}

export function usePlayer(): PlayerContextValue {
  const controls = usePlayerControls();
  const time = usePlayerTime();
  return useMemo(() => ({ ...controls, ...time }), [controls, time]);
}
