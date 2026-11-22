import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173/automation-school-/' },
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173/automation-school-/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
