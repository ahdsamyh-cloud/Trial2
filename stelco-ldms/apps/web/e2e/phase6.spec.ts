import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('HoD dashboard, calendar and search work without CSP violations', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => { if (/Content Security Policy|Refused to/.test(m.text())) violations.push(m.text()); });
  await login(page, 'hod');
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'HoD dashboard' })).toBeVisible();
  await expect(page.getByText('Open matters by unit')).toBeVisible();
  await expect(page.locator('.recharts-surface').first()).toBeVisible();
  await page.goto('/calendar');
  await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
  await page.goto('/search?q=STELCO');
  await expect(page.getByText(/^Matters \(\d+\)$/)).toBeVisible();
  for (const path of ['/litigation', '/drafting', '/compliance', '/awareness', '/knowledge', '/intake', '/matters']) {
    await page.goto(path);
    await expect(page.locator('main#main h1').first()).toBeVisible();
  }
  expect(violations).toEqual([]);
});

test('management viewer sees only the aggregated overview', async ({ page }) => {
  await login(page, 'mgmt');
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Management overview' })).toBeVisible();
  await expect(page.getByText('Open — confidential')).toBeVisible();
  expect((await page.request.get('/api/matters')).status()).toBe(403);
});
