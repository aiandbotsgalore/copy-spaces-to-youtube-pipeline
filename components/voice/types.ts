import { VoiceProfile, VoiceProfilesCatalog } from '../../types';

export interface AudioPreCheckResult {
  duration: number;
  peakDb: number;
  isClipping: boolean;
  isTooQuiet: boolean;
  isOptimalDuration: boolean;
  silenceRatio: number;
  sampleRate: number;
  channels: number;
  qualityLevel: 'excellent' | 'good' | 'warning' | 'error';
  qualityNotes: string[];
}

export interface ColorOption {
  id: string;
  label: string;
  badge: string;
  dot: string;
}

export interface ConfusionPair {
  speakerA: string;
  speakerB: string;
  similarity: number;
  risk: 'high' | 'moderate' | 'low';
}
