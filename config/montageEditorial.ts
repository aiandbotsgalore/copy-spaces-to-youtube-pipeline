/**
 * Project-specific editorial configuration for Montage Studio and the Prompt Director.
 *
 * This is project data (it belongs to the current show's editorial charter), kept here instead of
 * inside the montage logic so it can be changed without touching that code.
 */
export interface MontageEditorialConfig {
  /** A clip whose quote contains this phrase (case-insensitive) is never placed in an auto-montage. */
  hardExcludePhrase: string;
}

export const MONTAGE_EDITORIAL_CONFIG: MontageEditorialConfig = {
  hardExcludePhrase: 'defended him relentlessly',
};

/** True when `text` contains the configured hard-exclude phrase (case-insensitive). */
export function containsHardExcludePhrase(text: string | null | undefined, config: MontageEditorialConfig = MONTAGE_EDITORIAL_CONFIG): boolean {
  const phrase = config.hardExcludePhrase.trim().toLowerCase();
  if (!phrase || !text) return false;
  return text.toLowerCase().includes(phrase);
}
