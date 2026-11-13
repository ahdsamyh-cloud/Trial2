import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Local runs: pick up DEMO_PASSWORD / DEMO_TOTP_SECRET from the git-ignored apps/api/.env created by
// `pnpm setup:env` (variables already set in the environment, e.g. in CI, take precedence).
const apiEnv = join(__dirname, '..', 'api', '.env');
if (existsSync(apiEnv)) process.loadEnvFile(apiEnv);

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
