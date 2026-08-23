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
  play: (episode: NowPlayingEpisode) => void;
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

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;
    const onTime = () => setCurrentTime(audio.currentTime);
    const onLoaded = () => setDuration(audio.duration || 0);
    const onEnded = () => setIsPlaying(false);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('ended', onEnded);
      audio.pause();
    };
  }, []);

  const play = useCallback((episode: NowPlayingEpisode) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (current?.id !== episode.id) {
      audio.src = episode.audioUrl;
      setCurrent(episode);
      setCurrentTime(0);
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
    audio.currentTime = time;
    setCurrentTime(time);
  }, []);

  const close = useCallback(() => {
    const audio = audioRef.current;
    if (audio) audio.pause();
    setIsPlaying(false);
    setCurrent(null);
    setCurrentTime(0);
    setDuration(0);
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
