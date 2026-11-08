import { describe, it, expect } from 'vitest';
import { isHlsUrl, attachAudioSource } from '../hlsPlayer';

describe('hlsPlayer utility', () => {
  it('correctly detects HLS playlist URLs', () => {
    expect(isHlsUrl('https://cdn.example.com/stream/space.m3u8')).toBe(true);
    expect(isHlsUrl('https://cdn.example.com/stream/space.m3u8?token=xyz')).toBe(true);
    expect(isHlsUrl('https://pub-r2.dev/clip.mp3')).toBe(false);
    expect(isHlsUrl('')).toBe(false);
    expect(isHlsUrl(null)).toBe(false);
  });

  it('handles standard MP3 URLs by directly assigning audio element src', () => {
    const mockAudio = {
      src: '',
      canPlayType: () => '',
    } as unknown as HTMLAudioElement;

    const res = attachAudioSource(mockAudio, 'https://pub-r2.dev/audio.mp3');
    expect(res.isHls).toBe(false);
    expect(mockAudio.src).toBe('https://pub-r2.dev/audio.mp3');
  });
});
