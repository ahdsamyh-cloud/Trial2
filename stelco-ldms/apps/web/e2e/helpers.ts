import { expect, Page } from '@playwright/test';
import { authenticator } from 'otplib';

// SECURITY: no fallback credentials in code. The e2e run must be given the same values the
// database was seeded with (CI generates random ones per run).
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set for the e2e tests (the value used when seeding the demo users).`);
  return v;
}
export const PASSWORD = required('DEMO_PASSWORD');
export const SECRET = required('DEMO_TOTP_SECRET');

/**
 * Sign in with password + TOTP. The server refuses a TOTP step that was already used
 * (replay protection), so when a code is rejected we wait for the next 30 s window.
 */
export async function login(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByLabel('Code').fill(authenticator.generate(SECRET));
    await page.getByRole('button', { name: 'Verify' }).click();
    const ok = await page.locator('main#main').waitFor({ timeout: 4000 }).then(() => true).catch(() => false);
    if (ok) return;
    await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500);
  }
  await expect(page.locator('main#main')).toBeVisible();
}
