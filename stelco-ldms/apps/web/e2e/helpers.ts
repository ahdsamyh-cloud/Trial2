import { expect, Page } from '@playwright/test';
import { authenticator } from 'otplib';

export const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo-Passphrase-2026';
export const SECRET = process.env.DEMO_TOTP_SECRET ?? 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

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
