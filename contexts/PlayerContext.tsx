import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';

export interface NowPlayingEpisode {
  id: number;
  title: string;
  audioUrl: string;
  durationLabel?: string;
}

interface PlayerContextValue {
  current: NowPlayingEpisode | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  volume: number;
  isMuted: boolean;
  play: (episode: NowPlayingEpisode, startTime?: number) => void;
  togglePlay: () => void;
  seek: (time: number) => void;
  skip: (seconds: number) => void;
  setPlaybackRate: (rate: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  close: () => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [current, setCurrent] = useState<NowPlayingEpisode | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [volume, setVolumeState] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const prevVolumeRef = useRef(1);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingSeekRef = useRef<number | null>(null);

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
    };
    const onCanPlay = () => {
      applyPendingSeek();
    };
    const onEnded = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('ended', onEnded);
      audio.pause();
    };
  }, []);

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

    if (current?.id !== episode.id) {
      audio.src = episode.audioUrl;
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

    audio.play().catch(() => setIsPlaying(false));
    setIsPlaying(true);
  }, [current, playbackRate, volume, isMuted]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().catch(() => setIsPlaying(false));
      setIsPlaying(true);
    }
  }, [current, isPlaying]);

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
    setIsPlaying(false);
    setCurrent(null);
    setCurrentTime(0);
    setDuration(0);
    pendingSeekRef.current = null;
  }, []);

  // Global Keyboard Shortcuts for audio controls (Space, ArrowLeft, ArrowRight, M)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when user is typing in form fields
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }

      if (e.code === 'Space' && current) {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowLeft' && current) {
        e.preventDefault();
        skip(-15);
      } else if (e.code === 'ArrowRight' && current) {
        e.preventDefault();
        skip(15);
      } else if ((e.key === 'm' || e.key === 'M') && current) {
        e.preventDefault();
        toggleMute();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [current, togglePlay, skip, toggleMute]);

  return (
    <PlayerContext.Provider
      value={{
        current,
        isPlaying,
        currentTime,
        duration,
        playbackRate,
        volume,
        isMuted,
        play,
        togglePlay,
        seek,
        skip,
        setPlaybackRate,
        setVolume,
        toggleMute,
        close
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
};

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used within a PlayerProvider');
  return ctx;
}
