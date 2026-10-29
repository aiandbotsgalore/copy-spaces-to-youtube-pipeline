/**
 * Phase 0: leaving Script Studio for another panel unmounts it, so unsaved edits were lost silently.
 * A panel with unsaved work registers a guard; navigation asks before leaving.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { confirmLeave, setUnsavedGuard } from '../unsavedGuard';

let clear: (() => void) | null = null;
afterEach(() => { clear?.(); clear = null; });

describe('unsaved changes guard', () => {
  it('lets navigation through when nothing is unsaved, without asking', () => {
    let asked = 0;
    expect(confirmLeave(() => { asked++; return false; })).toBe(true);
    expect(asked).toBe(0);
  });

  it('asks with the guard message when edits are unsaved, and follows the answer', () => {
    clear = setUnsavedGuard(() => 'Script Studio has unsaved edits.');
    const seen: string[] = [];
    expect(confirmLeave(m => { seen.push(m); return false; })).toBe(false);
    expect(confirmLeave(m => { seen.push(m); return true; })).toBe(true);
    expect(seen).toEqual(['Script Studio has unsaved edits. Leave and discard them?', 'Script Studio has unsaved edits. Leave and discard them?']);
  });

  it('does not ask when the guard reports nothing unsaved', () => {
    clear = setUnsavedGuard(() => null);
    expect(confirmLeave(() => false)).toBe(true);
  });

  it('clearing an old guard does not remove a newer one', () => {
    const clearOld = setUnsavedGuard(() => 'old');
    clear = setUnsavedGuard(() => 'new');
    clearOld();
    const seen: string[] = [];
    confirmLeave(m => { seen.push(m); return true; });
    expect(seen).toEqual(['new Leave and discard them?']);
  });
});
