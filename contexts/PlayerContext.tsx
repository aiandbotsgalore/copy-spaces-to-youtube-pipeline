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
  play: (episode: NowPlayingEpisode, startTime?: number) => void;
  togglePlay: () => void;
  seek: (time: number) => void;
  close: () => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [current, setCurrent] = useState<NowPlayingEpisode | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingSeekRef = useRef<number | null>(null);

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;

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

  const play = useCallback((episode: NowPlayingEpisode, startTime?: number) => {
    const audio = audioRef.current;
    if (!audio) return;

    if (startTime !== undefined && startTime !== null) {
      pendingSeekRef.current = startTime;
    }

    if (current?.id !== episode.id) {
      audio.src = episode.audioUrl;
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
  }, [current]);

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

  return (
    <PlayerContext.Provider value={{ current, isPlaying, currentTime, duration, play, togglePlay, seek, close }}>
      {children}
    </PlayerContext.Provider>
  );
};

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used within a PlayerProvider');
  return ctx;
}
