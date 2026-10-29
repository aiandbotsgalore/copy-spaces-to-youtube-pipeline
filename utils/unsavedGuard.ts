/**
 * One app wide guard for unsaved work. A panel with unsaved edits registers a function that returns a
 * message (or null when nothing is unsaved); panel navigation calls confirmLeave before switching.
 */
type Guard = () => string | null;

let current: Guard | null = null;

/** Registers the guard and returns a function that clears it (only if it is still the current one). */
export function setUnsavedGuard(guard: Guard): () => void {
  current = guard;
  return () => { if (current === guard) current = null; };
}

/** True when navigation may go ahead: nothing unsaved, or the person agreed to discard it. */
export function confirmLeave(ask: (message: string) => boolean = m => window.confirm(m)): boolean {
  const message = current?.();
  if (!message) return true;
  return ask(`${message} Leave and discard them?`);
}
