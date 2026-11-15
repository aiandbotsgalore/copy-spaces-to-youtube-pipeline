import { describe, it, expect, beforeEach } from 'vitest';
import {
  extractEpisodeTag,
  setCachedSummaryIndex,
  resolveEpisodeAudioSync,
  sanitizeMontageClip,
} from '../audioResolver';
import { isPlaceholderAudioUrl, getEdgeSlicerBaseUrl, toSliceableUrl, toFetchableUrl } from '../audioUrl';
import type { EpisodeSummary } from '../transcriptData';

const mockSummaries: EpisodeSummary[] = [
  {
    release_id: 287477604,
    release_tag: '20260217_1vAxRvZrEPaxl',
    title: 'Haunted Hump Day🎸👽 🛸⚡️',
    published_at: '2026-02-18T00:51:31Z',
    episode_date: '2023-10-24',
    audio_url: 'https://github.com/aiandbotsgalore/copy-spaces-to-youtube-pipeline/releases/download/20260217_1vAxRvZrEPaxl/20260217_1vAxRvZrEPaxl_Haunted_Hump_Day.mp3',
    segment_count: 4396,
    duration_sec: 64182,
    speakers: ['Angela', 'Logan'],
  },
  {
    release_id: 442723970,
    release_tag: '20261111_local_1i69faszbw',
    title: 'angelaDeacon2',
    published_at: '2026-11-12T09:23:27Z',
    episode_date: '2026-11-11',
    audio_url: 'https://github.com/aiandbotsgalore/copy-spaces-to-youtube-pipeline/releases/download/20261111_local_1i69faszbw/20261111_local_1i69faszbw_angelaDeacon2.mp3',
    segment_count: 32,
    duration_sec: 599,
    speakers: ['Deacon/Chase'],
  },
];

describe('audioResolver & audioUrl hardening', () => {
  beforeEach(() => {
    setCachedSummaryIndex(mockSummaries);
  });

  describe('extractEpisodeTag', () => {
    it('extracts standard release tag from Copilot markdown text', () => {
      const msg = `The clip (creating now):
- Episode: 20260217_1vAxRvZrEPaxl - Haunted Hump Day
- Timestamps: [ ▶ 12:51:36 - ▶ 12:51:49 ]
- Speaker: Angela`;
      expect(extractEpisodeTag(msg)).toBe('20260217_1vAxRvZrEPaxl');
    });

    it('extracts local upload tags', () => {
      expect(extractEpisodeTag('Episode 20261111_local_1i69faszbw preview')).toBe('20261111_local_1i69faszbw');
      expect(extractEpisodeTag('Source: local_1i69faszbw')).toBe('local_1i69faszbw');
    });

    it('returns null when no tag is present', () => {
      expect(extractEpisodeTag('Just some random text')).toBeNull();
      expect(extractEpisodeTag(null)).toBeNull();
    });
  });

  describe('isPlaceholderAudioUrl', () => {
    it('identifies placeholder and invalid URLs', () => {
      expect(isPlaceholderAudioUrl('https://example.com/audio/20260217_1vAxRvZrEPaxl_12_51_36.wav')).toBe(true);
      expect(isPlaceholderAudioUrl('http://example.com/sound.mp3')).toBe(true);
      expect(isPlaceholderAudioUrl('undefined')).toBe(true);
      expect(isPlaceholderAudioUrl('')).toBe(true);
      expect(isPlaceholderAudioUrl(null)).toBe(true);
      expect(isPlaceholderAudioUrl('dummy_url')).toBe(true);
    });

    it('approves legitimate audio URLs', () => {
      expect(isPlaceholderAudioUrl('https://github.com/aiandbotsgalore/repo/releases/download/tag/audio.mp3')).toBe(false);
      expect(isPlaceholderAudioUrl('https://pub-b492226ab4ed45d692e9f14794366106.r2.dev/clip.wav')).toBe(false);
    });
  });

  describe('resolveEpisodeAudioSync', () => {
    it('resolves real GitHub Release URL by episode tag', () => {
      const res = resolveEpisodeAudioSync({ tag: '20260217_1vAxRvZrEPaxl' });
      expect(res).not.toBeNull();
      expect(res?.audioUrl).toBe(mockSummaries[0].audio_url);
      expect(res?.title).toBe('Haunted Hump Day🎸👽 🛸⚡️');
      expect(res?.releaseId).toBe(287477604);
      expect(res?.durationSec).toBe(64182);
    });

    it('resolves real GitHub Release URL from message textContext when tag is missing', () => {
      const textContext = 'Discussion in 20260217_1vAxRvZrEPaxl around 12:51:36';
      const res = resolveEpisodeAudioSync({ textContext });
      expect(res).not.toBeNull();
      expect(res?.audioUrl).toBe(mockSummaries[0].audio_url);
    });

    it('leaves valid non-placeholder URLs unchanged', () => {
      const validUrl = 'https://custom-host.com/recording.mp3';
      const res = resolveEpisodeAudioSync({ providedUrl: validUrl, tag: '20260217_1vAxRvZrEPaxl' });
      expect(res?.audioUrl).toBe(validUrl);
    });

    it('overwrites placeholder example.com URL with real catalog URL', () => {
      const placeholderUrl = 'https://example.com/audio/20260217_1vAxRvZrEPaxl_12_51_36.wav';
      const res = resolveEpisodeAudioSync({ providedUrl: placeholderUrl, tag: '20260217_1vAxRvZrEPaxl' });
      expect(res?.audioUrl).toBe(mockSummaries[0].audio_url);
    });
  });

  describe('sanitizeMontageClip', () => {
    it('upgrades and heals clips matching pre-cut master quotes to verbatim WAV clips', () => {
      const userScreenshotClip = {
        id: 'clip_user',
        title: 'Extracted Soundbite',
        quote: "Oh, I got it. I always do that before I talk to someone. Yeah. But I don't ever expose it unless I need to. I just have it so I can get to my attorney if I needed to... Oh, yeah. I do that for fun. I know that's probably bad, but, like, that's what I do on TikTok.",
        speaker: 'Angela',
        sourceTitle: 'Haunted Hump Day',
        sourceTag: '20260217_1vAxRvZrEPaxl',
        audioUrl: mockSummaries[0].audio_url,
        startSec: 46296,
        endSec: 46309,
      };

      const healed = sanitizeMontageClip(userScreenshotClip);
      expect(healed.audioUrl).toBe('/clips/angela/03_05_Always_Do_That_For_Fun.wav');
      expect(healed.startSec).toBe(0);
      expect(healed.endSec).toBe(13.18);
      expect(healed.windowVerified).toBe(true);
    });

    it('heals single quote clips to their master cut WAV', () => {
      const singleQuoteClip = {
        id: 'clip_05',
        title: 'Do That For Fun',
        quote: "Oh, yeah. I do that for fun. I know that's probably bad, but, like, that's what I do on TikTok.",
        speaker: 'Angela',
        sourceTitle: 'Haunted Hump Day',
        sourceTag: '20260217_1vAxRvZrEPaxl',
        audioUrl: 'https://example.com/audio/dummy.wav',
        startSec: 46309,
        endSec: 46314,
      };

      const healed = sanitizeMontageClip(singleQuoteClip);
      expect(healed.audioUrl).toBe('/clips/angela/05_Do_That_For_Fun.wav');
      expect(healed.startSec).toBe(0);
      expect(healed.endSec).toBe(4.52);
      expect(healed.windowVerified).toBe(true);
    });

    it('heals clips with hallucinated example.com URLs when no pre-cut matches', () => {
      const genericPoisonedClip = {
        id: 'clip_generic',
        title: 'Generic Segment',
        quote: 'Some completely custom discussion about rocket propulsion',
        speaker: 'Logan',
        sourceTitle: 'Haunted Hump Day',
        sourceTag: '20260217_1vAxRvZrEPaxl',
        audioUrl: 'https://example.com/audio/20260217_1vAxRvZrEPaxl_10_00_00.wav',
        startSec: 36000,
        endSec: 36030,
      };

      const healed = sanitizeMontageClip(genericPoisonedClip);
      expect(healed.audioUrl).toBe(mockSummaries[0].audio_url);
      expect(healed.sourceTitle).toBe('Haunted Hump Day');
      expect(healed.sourceDurationSec).toBe(64182);
    });

    it('preserves clips that already have valid audio URLs and no pre-cut conflict', () => {
      const goodClip = {
        id: 'clip_456',
        title: 'Valid generic clip',
        quote: 'Some unindexed conversation between speakers',
        speaker: 'Angela',
        sourceTitle: 'Haunted Hump Day',
        sourceTag: '20260217_1vAxRvZrEPaxl',
        audioUrl: mockSummaries[0].audio_url,
        startSec: 10,
        endSec: 20,
      };

      const result = sanitizeMontageClip(goodClip);
      expect(result.audioUrl).toBe(mockSummaries[0].audio_url);
      expect(result.startSec).toBe(10);
      expect(result.endSec).toBe(20);
    });
  });

  describe('audioUrl safety and fallback routing', () => {
    it('blocks the broken spacepipe-edge-slicer workers domain', () => {
      expect(getEdgeSlicerBaseUrl()).toBe('');
    });

    it('routes GitHub release URLs through local /api/montage/audio proxy', () => {
      const ghUrl = mockSummaries[0].audio_url;
      const sliced = toSliceableUrl(ghUrl, 46296, 46309, 64182);
      expect(sliced).toContain('/api/montage/audio?url=');
      expect(sliced).toContain('start=46296');
      expect(sliced).toContain('end=46309');
      expect(sliced).not.toContain('workers.dev');
    });

    it('handles placeholder URLs gracefully without routing through proxy or worker', () => {
      const placeholder = 'https://example.com/audio/20260217_1vAxRvZrEPaxl_12_51_36.wav';
      expect(toSliceableUrl(placeholder, 10, 20)).not.toContain('workers.dev');
      expect(toSliceableUrl(placeholder, 10, 20)).not.toContain('/api/montage/audio');
      expect(toFetchableUrl(placeholder)).not.toContain('workers.dev');
      expect(toFetchableUrl(placeholder)).not.toContain('/api/montage/audio');
    });
  });
});
