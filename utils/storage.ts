import { EnhancedConfig } from '../types';

const CONFIG_KEY = 'spacepipe_config_v2';
const TOKEN_KEY = 'spacepipe_token_v1';
const DEPLOYED_KEY = 'spacepipe_deployed_v1';

type StorableConfig = Omit<EnhancedConfig, 'githubToken' | 'artworkDataUrl'>;

export function saveConfig(config: EnhancedConfig): void {
  try {
    const {
      githubToken: _t,
      artworkDataUrl: _a,
      enableTranscription: _et,
      enableSlackWebhook: _es,
      enableDiscordWebhook: _ed,
      enableScheduledMonitoring: _em,
      ...rest
    } = config;
    localStorage.setItem(CONFIG_KEY, JSON.stringify(rest));
  } catch {
    // Storage may be unavailable (private browsing, quota, etc.)
  }
}

export function saveToken(token: string): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {}
}

export function loadStoredToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function hasStoredToken(): boolean {
  try {
    return !!localStorage.getItem(TOKEN_KEY);
  } catch {
    return false;
  }
}

export function clearStoredToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export function loadConfig(): Partial<StorableConfig> {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return {};
    const {
      enableTranscription: _et,
      enableSlackWebhook: _es,
      enableDiscordWebhook: _ed,
      enableScheduledMonitoring: _em,
      ...rest
    } = JSON.parse(raw) as Partial<StorableConfig> & {
      enableTranscription?: boolean;
      enableSlackWebhook?: boolean;
      enableDiscordWebhook?: boolean;
      enableScheduledMonitoring?: boolean;
    };
    if (rest.repoName === 'my-spaces-archive' || !rest.repoName) {
      rest.repoName = 'copy-spaces-to-youtube-pipeline';
    }
    if (!rest.ownerName) {
      rest.ownerName = 'aiandbotsgalore';
    }
    return rest;
  } catch {
    return {};
  }
}

export function markDeployed(owner: string, repo: string): void {
  try {
    localStorage.setItem(DEPLOYED_KEY, JSON.stringify({ owner, repo, at: Date.now() }));
  } catch {}
}

export function loadDeployedInfo(): { owner: string; repo: string; at: number } | null {
  try {
    const raw = localStorage.getItem(DEPLOYED_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearAll(): void {
  try {
    localStorage.removeItem(CONFIG_KEY);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(DEPLOYED_KEY);
  } catch {}
}
