import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login } from './helpers';

const EML = [
  'From: "Procurement Focal" <proc@stelco.com.mv>', 'To: legal@stelco.com.mv', 'Subject: NDA for solar EPC bidder',
  `Message-ID: <e2e-${Date.now()}@stelco.com.mv>`, 'Date: Mon, 16 Nov 2026 10:00:00 +0500', 'Content-Type: text/html; charset=utf-8', '',
  '<p>Please prepare an NDA.</p><script>alert(1)</script><img src="https://tracker.example/x.gif">', '',
].join('\r\n');

test('security headers and accessible sign-in page', async ({ page }) => {
  const res = await page.goto('/login');
  const csp = res!.headers()['content-security-policy']!;
  expect(csp).toContain("script-src 'self' 'nonce-");
  expect(csp).not.toContain('unsafe-inline');
  expect(res!.headers()['x-frame-options']).toBe('DENY');
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});

test('wrong password shows a generic error', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Username').fill('lo.lit1');
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Incorrect username or password')).toBeVisible();
});

test('paralegal records an email intake, converts it, and copies the acknowledgement', async ({ page }) => {
  await login(page, 'pl.drf');
  await page.goto('/intake/new');
  await page.locator('input[type=file][accept=".msg,.eml"]').setInputFiles({ name: 'nda.eml', mimeType: 'message/rfc822', buffer: Buffer.from(EML) });
  await expect(page.getByLabel('Subject')).toHaveValue('NDA for solar EPC bidder');
  await expect(page.getByLabel('Sender email')).toHaveValue('proc@stelco.com.mv');
  const frame = page.frameLocator('iframe[title="Original email"]');
  await expect(frame.locator('p')).toHaveText('Please prepare an NDA.');
  await expect(page.locator('iframe[title="Original email"]')).toHaveAttribute('sandbox', '');
  await page.getByLabel('Likely unit').selectOption('DRF');
  await page.getByRole('button', { name: 'Save intake' }).click();
  await expect(page.getByText(/LGL-INT-\d{4}-\d{4} · received/)).toBeVisible();
  await page.getByRole('button', { name: 'Convert to matter' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Convert' }).click();
  await expect(page.locator('pre').filter({ hasText: /under reference LGL-DRF-\d{4}-\d{4}/ }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy reply' }).first()).toBeVisible();
});

test('admin can manage users but has no access to legal content', async ({ page }) => {
  await login(page, 'adm.it');
  await page.goto('/admin/users');
  await expect(page.getByText('Aishath Hassan (HoD)')).toBeVisible();
  await expect(page.getByRole('link', { name: 'All matters' })).toHaveCount(0);
  const r = await page.request.get('/api/matters');
  expect(r.status()).toBe(403);
});

test('unit head sees matters list and can export to Excel @mobile', async ({ page }) => {
  await login(page, 'uh.cmp');
  await page.goto('/matters');
  await expect(page.getByRole('heading', { name: 'All matters' })).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export to Excel' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/\.xlsx$/);
});
