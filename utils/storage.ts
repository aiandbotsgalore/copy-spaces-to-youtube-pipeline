import { EnhancedConfig } from '../types';

const CONFIG_KEY = 'spacepipe_config_v2';
const TOKEN_KEY = 'spacepipe_token_v1';
const DEPLOYED_KEY = 'spacepipe_deployed_v1';
const DIRECTOR_KEY = 'spacepipe_director_key_v1';
const DIRECTOR_MODEL_KEY = 'spacepipe_director_model_v1';
const DIRECTOR_PREFS_KEY = 'spacepipe_director_prefs_v1';

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
    if (rest.repoName === 'my-spaces-archive' || rest.repoName === 'spaces-pipeline') {
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
    localStorage.removeItem(DIRECTOR_KEY);
    localStorage.removeItem(DIRECTOR_MODEL_KEY);
    localStorage.removeItem(DIRECTOR_PREFS_KEY);
  } catch {}
}

// --- AI Prompt Director: in-app BACKUP key (used only when the server has no key in .env.local) ---

export function saveDirectorKey(key: string): void {
  try {
    if (key) localStorage.setItem(DIRECTOR_KEY, key.trim());
    else localStorage.removeItem(DIRECTOR_KEY);
  } catch {}
}

export function loadDirectorKey(): string {
  try {
    return localStorage.getItem(DIRECTOR_KEY) || '';
  } catch {
    return '';
  }
}

export function clearDirectorKey(): void {
  try {
    localStorage.removeItem(DIRECTOR_KEY);
  } catch {}
}

export function saveDirectorModel(model: string): void {
  try {
    if (model) localStorage.setItem(DIRECTOR_MODEL_KEY, model);
    else localStorage.removeItem(DIRECTOR_MODEL_KEY);
  } catch {}
}

export function loadDirectorModel(): string {
  try {
    return localStorage.getItem(DIRECTOR_MODEL_KEY) || '';
  } catch {
    return '';
  }
}

export interface DirectorPrefs {
  candidateCap: number;
  limitToFilters: boolean;
}

export function loadDirectorPrefs(): DirectorPrefs {
  const defaults: DirectorPrefs = { candidateCap: 80, limitToFilters: false };
  try {
    const raw = localStorage.getItem(DIRECTOR_PREFS_KEY);
    if (!raw) return defaults;
    const p = JSON.parse(raw);
    const cap = Number(p?.candidateCap);
    return {
      candidateCap: Number.isFinite(cap) ? Math.min(200, Math.max(20, Math.round(cap))) : defaults.candidateCap,
      limitToFilters: !!p?.limitToFilters,
    };
  } catch {
    return defaults;
  }
}

export function saveDirectorPrefs(prefs: DirectorPrefs): void {
  try {
    localStorage.setItem(DIRECTOR_PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

const PROFILES_KEY = 'spacepipe_profiles_v1';
const ACTIVE_PROFILE_ID_KEY = 'spacepipe_active_profile_id_v1';

export function loadProfiles(): import('../types').ConfigProfile[] {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveProfiles(profiles: import('../types').ConfigProfile[]): void {
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  } catch {}
}

export function loadActiveProfileId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PROFILE_ID_KEY);
  } catch {
    return null;
  }
}

export function saveActiveProfileId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_PROFILE_ID_KEY, id);
    else localStorage.removeItem(ACTIVE_PROFILE_ID_KEY);
  } catch {}
}

const DLQ_STORAGE_KEY = 'spacepipe_dlq_v1';
const HEALED_RUNS_KEY = 'spacepipe_healed_runs_v1';

export function loadDeadLetterQueue(): import('../types').DeadLetterJob[] {
  try {
    const raw = localStorage.getItem(DLQ_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveDeadLetterQueue(jobs: import('../types').DeadLetterJob[]): void {
  try {
    localStorage.setItem(DLQ_STORAGE_KEY, JSON.stringify(jobs));
  } catch {}
}

export function addToDeadLetterQueue(job: import('../types').DeadLetterJob): void {
  const current = loadDeadLetterQueue();
  const next = [job, ...current.filter(j => j.id !== job.id)].slice(0, 50);
  saveDeadLetterQueue(next);
}

export function removeFromDeadLetterQueue(id: string): void {
  const current = loadDeadLetterQueue();
  saveDeadLetterQueue(current.filter(j => j.id !== id));
}

export function loadHealedRunIds(): number[] {
  try {
    const raw = localStorage.getItem(HEALED_RUNS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function markRunHealed(runId: number): void {
  const ids = loadHealedRunIds();
  if (!ids.includes(runId)) {
    const next = [...ids, runId].slice(-100);
    try {
      localStorage.setItem(HEALED_RUNS_KEY, JSON.stringify(next));
    } catch {}
  }
}

