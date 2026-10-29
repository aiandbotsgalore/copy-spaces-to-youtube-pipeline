import type { ClipItem } from './contracts/clipCatalog';

export const AVATAR_TIMELINE_SCHEMA = 'spacepipe.avatar.timeline.v1';

export type AvatarManifestSpeaker = {
  id: string;
  name: string;
  avatar: { url: string };
};

export type AvatarManifestInterval = {
  id: string;
  speaker_id: string;
  speaker: string;
  start_seconds: number;
  end_seconds: number;
  confidence?: number | null;
  verified?: boolean;
};

export type AvatarRenderManifest = {
  schema: typeof AVATAR_TIMELINE_SCHEMA;
  duration_seconds: number;
  fps: number;
  source_audio: { url: string };
  speakers: AvatarManifestSpeaker[];
  intervals: AvatarManifestInterval[];
  layout: 'stage_grid' | 'split_screen' | 'solo';
  output: { aspect_ratio: '9:16' | '1:1' | '16:9' };
  render: {
    model: { id: 'wav2lip'; version: string };
    settings: {
      merge_gap_seconds: number;
      pre_roll_seconds: number;
      post_roll_seconds: number;
      idle_mode: 'still';
      transition_frames: number;
    };
  };
};

const speakerKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
const stableSpeakerId = (value: string, index: number) => speakerKey(value) || `speaker-${index + 1}`;

export function buildAvatarRenderManifest(args: {
  clip: ClipItem;
  audioUrl: string;
  speakers: string[];
  avatarMap: Record<string, string>;
  turns: Array<{ id?: string; speaker: string; start: number; end: number; confidence?: number | null; verified?: boolean }>;
  layout: 'stage_grid' | 'split_screen' | 'solo';
  aspectRatio: '9:16' | '1:1' | '16:9';
  fps?: number;
}): AvatarRenderManifest {
  const fps = args.fps ?? 25;
  const duration = Number(args.clip.duration || (args.clip.end_seconds - args.clip.start_seconds));
  if (!args.audioUrl || !Number.isFinite(duration) || duration <= 0) throw new Error('Avatar render requires a reachable audio reference and positive clip duration.');
  const speakers = args.speakers.filter(Boolean).map((name, index) => ({
    id: stableSpeakerId(name, index),
    name,
    avatar: { url: args.avatarMap[name] || '' },
  }));
  if (!speakers.length || speakers.some((speaker) => !speaker.avatar.url)) throw new Error('Every avatar speaker needs an image reference.');
  const byKey = new Map(speakers.map((speaker) => [speakerKey(speaker.name), speaker]));
  const intervals = args.turns.map((turn, index) => {
    const speaker = byKey.get(speakerKey(turn.speaker));
    if (!speaker) return null;
    const start = Math.max(0, Number(turn.start));
    const end = Math.min(duration, Number(turn.end));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    return {
      id: turn.id || `turn-${index + 1}`,
      speaker_id: speaker.id,
      speaker: speaker.name,
      start_seconds: start,
      end_seconds: end,
      confidence: turn.confidence ?? null,
      verified: Boolean(turn.verified),
    } satisfies AvatarManifestInterval;
  }).filter((turn): turn is AvatarManifestInterval => Boolean(turn));
  if (!intervals.length) throw new Error('Experimental avatar rendering requires reliable speaker timing; no speaking intervals were found.');
  return {
    schema: AVATAR_TIMELINE_SCHEMA,
    duration_seconds: duration,
    fps,
    source_audio: { url: args.audioUrl },
    speakers,
    intervals,
    layout: args.layout,
    output: { aspect_ratio: args.aspectRatio },
    render: {
      model: { id: 'wav2lip', version: 'warm-session-v1' },
      settings: { merge_gap_seconds: 0.45, pre_roll_seconds: 0.12, post_roll_seconds: 0.16, idle_mode: 'still', transition_frames: 3 },
    },
  };
}

