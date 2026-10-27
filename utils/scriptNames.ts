/**
 * Speaker renames. Flat keys ("Speaker 1") apply to every recording of a project; "<tag>::<raw label>"
 * keys apply to one recording only. Multi-recording projects use the scoped form, because generic labels
 * like "Speaker 1" are different people in different Spaces.
 */
export function namesForTag(names: Record<string, string> | undefined, tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(names || {})) if (!k.includes('::')) out[k] = v;
  const prefix = `${tag}::`;
  for (const [k, v] of Object.entries(names || {})) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
  return out;
}

/** When a project goes from one recording to several, its flat renames belong to the first recording. */
export function scopeNamesToTag(names: Record<string, string> | undefined, tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(names || {})) out[k.includes('::') ? k : `${tag}::${k}`] = v;
  return out;
}

/** The key a rename is saved under for one recording of a project. */
export const renameKey = (sourceCount: number, tag: string, raw: string) => (sourceCount > 1 ? `${tag}::${raw}` : raw);
