import React from 'react';
import {
  LayoutDashboard, PlusCircle, Library, FileSearch, Scale, Flame,
  Film, FileText, AudioWaveform, Mic2, Video, Bot,
  History, Eye, Settings, Zap, Rocket, Github
} from 'lucide-react';
import { EnhancedConfig } from '../../types';

export type StudioTier = 'studio' | 'pipeline';

export interface StudioPlugin {
  id: string;
  label: string;
  tier: StudioTier;
  icon: React.ReactNode;
  badge?: string;
  badgeColor?: string;
  description?: string;
}

export const STUDIO_REGISTRY: StudioPlugin[] = [
  // Tier 1: Daily Studio & Operations
  {
    id: 'dashboard',
    label: 'Command Center',
    tier: 'studio',
    icon: <LayoutDashboard size={15} />,
    description: 'Pipeline operational metrics and live status',
  },
  {
    id: 'submit-space',
    label: 'Ingest',
    tier: 'studio',
    icon: <PlusCircle size={15} />,
    description: 'Submit Twitter Spaces or local audio files for ingest',
  },
  {
    id: 'library',
    label: 'Episode Library',
    tier: 'studio',
    icon: <Library size={15} />,
    description: 'Archived episodes, release assets, and audio downloads',
  },
  {
    id: 'transcripts',
    label: 'Transcripts',
    tier: 'studio',
    icon: <FileSearch size={15} />,
    description: 'Speaker diarized interactive transcripts & quote extraction',
  },
  {
    id: 'investigative-radar',
    label: 'Investigative Radar',
    tier: 'studio',
    icon: <Scale size={16} />,
    badge: 'GraphRAG',
    badgeColor: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
    description: 'Cross-episode entity linking, timelines, and contradiction analysis',
  },
  {
    id: 'clips',
    label: 'Best Clips',
    tier: 'studio',
    icon: <Flame size={15} />,
    description: 'Curated viral highlights, audio moments, and talking avatar shorts',
  },
  {
    id: 'montage',
    label: 'Montage Studio',
    tier: 'studio',
    icon: <Film size={15} />,
    description: 'Multi-clip audio montage sequencing, tension arcs, and reel exports',
  },
  {
    id: 'script-studio',
    label: 'Script Studio',
    tier: 'studio',
    icon: <FileText size={15} />,
    description: 'Documentary outline, multi-LLM debate, and script generation',
  },
  {
    id: 'voice-profiles',
    label: 'Voice Profiles',
    tier: 'studio',
    icon: <AudioWaveform size={15} />,
    description: 'Speaker voice embedding library, enrollment, and diarization mapping',
  },
  {
    id: 'vox-studio',
    label: 'Vox Studio',
    tier: 'studio',
    icon: <Mic2 size={15} />,
    badge: 'VoxCPM-2',
    badgeColor: 'bg-violet-500/20 text-violet-300 border border-violet-500/30',
    description: 'Neural voice synthesis, voice cloning, and pickup line recording',
  },
  {
    id: 'avatar-studio',
    label: 'Avatar Studio',
    tier: 'studio',
    icon: <Video size={15} />,
    badge: 'LivePortrait',
    badgeColor: 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30',
    description: 'Talking head video animation and neural lip sync rendering',
  },
  {
    id: 'ai-copilot',
    label: 'AI Copilot',
    tier: 'studio',
    icon: <Bot size={15} />,
    description: 'Intelligent assistant with tool-calling capabilities across the platform',
  },

  // Tier 2: Settings & Pipeline
  {
    id: 'run-history',
    label: 'Run History',
    tier: 'pipeline',
    icon: <History size={15} />,
    description: 'GitHub Actions workflow runs, statuses, and dispatch logs',
  },
  {
    id: 'rss-preview',
    label: 'RSS Feed Preview',
    tier: 'pipeline',
    icon: <Eye size={15} />,
    description: 'Preview YouTube Podcasts compliant RSS feeds and XML structure',
  },
  {
    id: 'config',
    label: 'Configuration',
    tier: 'pipeline',
    icon: <Settings size={15} />,
    description: 'Repository settings, author info, and environment variables',
  },
  {
    id: 'features',
    label: 'Feature Toggles',
    tier: 'pipeline',
    icon: <Zap size={15} />,
    description: 'Enable or disable automated transcription, webhooks, and monitoring',
  },
  {
    id: 'deploy',
    label: 'Deploy to GitHub',
    tier: 'pipeline',
    icon: <Rocket size={15} />,
    description: 'Push generated pipeline files to repository or fork template',
  },
  {
    id: 'github',
    label: 'GitHub Connection',
    tier: 'pipeline',
    icon: <Github size={15} />,
    description: 'Personal access token validation and scopes check',
  },
];

/**
 * Returns a valid StudioPlugin by ID or undefined.
 */
export function getStudioPlugin(id: string): StudioPlugin | undefined {
  return STUDIO_REGISTRY.find(s => s.id === id);
}

/**
 * Reads the active panel ID from window.location.hash.
 * Defaults to 'dashboard' if hash is empty or unknown.
 */
export function getActivePanelFromHash(): string {
  if (typeof window === 'undefined') return 'dashboard';
  const hash = window.location.hash.replace(/^#\/?/, '').trim();
  if (!hash) return 'dashboard';
  if (hash.startsWith('file:')) return hash;
  const match = STUDIO_REGISTRY.find(s => s.id === hash);
  return match ? match.id : 'dashboard';
}

/**
 * Sets the active panel ID in window.location.hash without triggering a hard reload.
 */
export function syncHashWithPanel(panelId: string) {
  if (typeof window === 'undefined') return;
  const current = window.location.hash.replace(/^#\/?/, '').trim();
  if (current !== panelId) {
    window.location.hash = panelId;
  }
}
