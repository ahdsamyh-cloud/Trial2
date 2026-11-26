import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('compliance officer sends a circular and the department acknowledges it @mobile', async ({ page, browser }) => {
  await login(page, 'lo.cmp1');
  await page.goto('/compliance');
  await page.getByRole('tab', { name: 'Circulars' }).click();
  await page.getByRole('button', { name: 'Send circular' }).click();
  const dlg = page.getByRole('dialog');
  const subject = `E2E circular ${Date.now()}`;
  await dlg.getByLabel('Subject').fill(subject);
  await dlg.getByLabel('Message').fill('Please note the new reporting deadline.');
  await dlg.getByLabel('Human Resources').check();
  await dlg.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(subject)).toBeVisible();

  const ctx = await browser.newContext({ ...(test.info().project.use as object) });
  const req = await ctx.newPage();
  await login(req, 'req.hr');
  await req.goto('/compliance');
  const card = req.locator('li', { hasText: subject });
  await card.getByRole('button', { name: 'I have read this' }).click();
  await expect(card.getByText('Acknowledged')).toBeVisible();
  await ctx.close();
});
