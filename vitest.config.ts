import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default defineConfig(async (env) => {
  const baseConfig = typeof viteConfig === 'function' ? await viteConfig(env) : viteConfig;
  return mergeConfig(baseConfig, {
    test: {
      projects: [
        {
          name: 'fast',
          test: {
            name: 'fast',
            include: ['utils/__tests__/**/*.test.ts', 'components/**/__tests__/**/*.test.ts'],
            exclude: ['utils/__tests__/**/*.integration.test.ts', 'scripts/acceptance/**'],
          },
        },
        {
          name: 'integration',
          test: {
            name: 'integration',
            include: ['utils/__tests__/**/*.integration.test.ts'],
            testTimeout: 60000,
            hookTimeout: 60000,
          },
        },
      ],
    },
  });
});
