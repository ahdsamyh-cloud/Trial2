import { defineConfig, devices } from '@playwright/test';

/** E2E against a running web (3000) + API (4000) seeded with demo data (SEED_DEMO=true). */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000', trace: 'off', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath: process.env.PW_CHROMIUM ?? undefined } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions: { executablePath: process.env.PW_CHROMIUM ?? undefined } }, grep: /@mobile/ },
  ],
});
