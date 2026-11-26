import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('presenter opens QR check-in; staff without an account check in and give feedback @mobile', async ({ page, browser }) => {
  await login(page, 'lo.awr1');
  await page.goto('/awareness');
  await page.getByText('Contract management basics (demo)').first().click();
  await page.getByRole('button', { name: 'Open QR check-in' }).click();
  const url = (await page.getByRole('dialog').locator('p.break-all').textContent())!.trim();
  expect(url).toContain('/checkin/');

  const ctx = await browser.newContext({ ...(test.info().project.use as object) });
  const phone = await ctx.newPage();
  await phone.goto(url.replace(/^https?:\/\/[^/]+/, ''));
  await expect(phone.getByText('Contract management basics (demo)')).toBeVisible();
  await phone.getByLabel('Your staff number').fill('E0001');
  await phone.getByRole('button', { name: 'Check in' }).click();
  await expect(phone.getByText(/you are checked in/)).toBeVisible();
  await phone.locator('label', { hasText: '5' }).first().click();
  await phone.getByRole('button', { name: 'Send feedback' }).click();
  await expect(phone.getByText('Feedback received')).toBeVisible();
  await ctx.close();

  await page.reload();
  await expect(page.getByText('Aminath Shifa (').first()).toBeVisible();
});
