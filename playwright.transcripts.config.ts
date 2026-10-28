import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.pw.ts',
  timeout: 45_000,
  retries: 0,
  use: { baseURL: 'http://127.0.0.1:5105', trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5105 --strictPort',
    url: 'http://127.0.0.1:5105',
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
