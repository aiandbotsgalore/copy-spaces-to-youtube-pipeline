// Acceptance scripts for the Script Studio redesign phases. They read real local data (transcripts,
// the AQ corpus, a temporary copy of .spacepipe-studio), so they run separately: npm run acceptance
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/acceptance/**/*.acceptance.ts'],
    reporters: ['verbose'],
    silent: false,
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
