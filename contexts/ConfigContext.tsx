import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { EnhancedConfig, ConfigProfile } from '../types';
import {
  saveConfig,
  loadConfig,
  loadStoredToken,
  saveToken,
  loadProfiles,
  saveProfiles,
  loadActiveProfileId,
  saveActiveProfileId,
} from '../utils/storage';
import { validateConfig, ValidationError } from '../utils/validation';

export const DEFAULT_CONFIG: EnhancedConfig = {
  repoName: 'copy-spaces-to-youtube-pipeline',
  ownerName: 'aiandbotsgalore',
  podcastTitle: "Logan Black's X-Space",
  podcastDescription: 'Curated audio and transcripts archive of Twitter Spaces',
  authorName: 'Logan Black',
  email: 'curator@example.com',
  imageUrl: '',
  githubToken: '',
  artworkDataUrl: '',
  platforms: ['twitter', 'youtube', 'clubhouse', 'linkedin'],
  batchUrls: [],
  enableTranscription: true,
  enableSlackWebhook: false,
  slackWebhookUrl: '',
  enableDiscordWebhook: false,
  discordWebhookUrl: '',
  enableScheduledMonitoring: false,
  scheduledCron: '0 */2 * * *',
};

function buildInitialConfig(): EnhancedConfig {
  const stored = loadConfig();
  const storedToken = loadStoredToken();
  return {
    ...DEFAULT_CONFIG,
    ...stored,
    repoName: stored.repoName || DEFAULT_CONFIG.repoName,
    ownerName: stored.ownerName || DEFAULT_CONFIG.ownerName,
    podcastTitle: stored.podcastTitle || DEFAULT_CONFIG.podcastTitle,
    podcastDescription: stored.podcastDescription || DEFAULT_CONFIG.podcastDescription,
    authorName: stored.authorName || DEFAULT_CONFIG.authorName,
    email: stored.email || DEFAULT_CONFIG.email,
    githubToken: storedToken,
    artworkDataUrl: '',
    enableTranscription: stored.enableTranscription ?? DEFAULT_CONFIG.enableTranscription,
    enableSlackWebhook: stored.enableSlackWebhook ?? DEFAULT_CONFIG.enableSlackWebhook,
    enableDiscordWebhook: stored.enableDiscordWebhook ?? DEFAULT_CONFIG.enableDiscordWebhook,
    enableScheduledMonitoring: stored.enableScheduledMonitoring ?? DEFAULT_CONFIG.enableScheduledMonitoring,
    scheduledCron: stored.scheduledCron || DEFAULT_CONFIG.scheduledCron,
    batchUrls: stored.batchUrls || DEFAULT_CONFIG.batchUrls,
    platforms: stored.platforms || DEFAULT_CONFIG.platforms,
  };
}

interface ConfigContextValue {
  config: EnhancedConfig;
  setConfig: React.Dispatch<React.SetStateAction<EnhancedConfig>>;
  updateConfig: (patch: Partial<EnhancedConfig>) => void;
  resetConfig: () => void;
  validationErrors: ValidationError[];
  profiles: ConfigProfile[];
  activeProfileId: string | null;
  saveCurrentAsProfile: (name: string) => void;
  loadProfile: (id: string) => void;
  deleteProfile: (id: string) => void;
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

export const ConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<EnhancedConfig>(buildInitialConfig);
  const [profiles, setProfiles] = useState<ConfigProfile[]>(() => loadProfiles());
  const [activeProfileId, setActiveProfileIdState] = useState<string | null>(() => loadActiveProfileId());

  // Save config to local storage on change
  useEffect(() => {
    saveConfig(config);
    if (config.githubToken) {
      saveToken(config.githubToken);
    }
  }, [config]);

  const updateConfig = useCallback((patch: Partial<EnhancedConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
  }, []);

  const resetConfig = useCallback(() => {
    setConfig(DEFAULT_CONFIG);
  }, []);

  const validationErrors = useMemo(() => validateConfig(config), [config]);

  const saveCurrentAsProfile = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const newProfile: ConfigProfile = {
      id: `profile_${Date.now()}`,
      name: trimmed,
      config: { ...config },
      updatedAt: Date.now(),
    };
    setProfiles((prev) => {
      const updated = [...prev.filter((p) => p.name !== trimmed), newProfile];
      saveProfiles(updated);
      return updated;
    });
    setActiveProfileIdState(newProfile.id);
    saveActiveProfileId(newProfile.id);
  }, [config]);

  const loadProfile = useCallback((id: string) => {
    const target = profiles.find((p) => p.id === id);
    if (target) {
      setConfig({ ...target.config });
      setActiveProfileIdState(id);
      saveActiveProfileId(id);
    }
  }, [profiles]);

  const deleteProfile = useCallback((id: string) => {
    setProfiles((prev) => {
      const updated = prev.filter((p) => p.id !== id);
      saveProfiles(updated);
      return updated;
    });
    setActiveProfileIdState((currentId) => {
      if (currentId === id) {
        saveActiveProfileId(null);
        return null;
      }
      return currentId;
    });
  }, []);

  const value = useMemo(
    () => ({
      config,
      setConfig,
      updateConfig,
      resetConfig,
      validationErrors,
      profiles,
      activeProfileId,
      saveCurrentAsProfile,
      loadProfile,
      deleteProfile,
    }),
    [
      config,
      updateConfig,
      resetConfig,
      validationErrors,
      profiles,
      activeProfileId,
      saveCurrentAsProfile,
      loadProfile,
      deleteProfile,
    ]
  );

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
};

export function useConfig(): ConfigContextValue {
  const ctx = useContext(ConfigContext);
  if (!ctx) {
    throw new Error('useConfig must be used within a ConfigProvider');
  }
  return ctx;
}
