import { expect, test } from '@playwright/test';
import { login } from './helpers';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

test('drafting: register, assign maker and checker, and the drafter cannot review their own work', async ({ page, browser }) => {
  await login(page, 'uh.drf');
  await page.goto('/drafting');
  await page.getByRole('button', { name: 'New request' }).click();
  const dlg = page.getByRole('dialog');
  const title = `E2E NDA ${Date.now()}`;
  await dlg.getByLabel('Title').fill(title);
  await dlg.getByLabel('Request type').selectOption({ label: 'NDA / confidentiality agreement' });
  await dlg.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page.getByRole('button', { name: 'Assign', exact: true }).first().click();
  const a = page.getByRole('dialog');
  await a.getByLabel('Lawyer (maker)').selectOption({ label: 'Mohamed Shiyam' });
  await a.getByLabel('Reviewer (checker)').selectOption({ label: 'Hawwa Nisha' });
  await a.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Mohamed Shiyam').first()).toBeVisible();
  const url = page.url();

  const ctx = await browser.newContext();
  const drafter = await ctx.newPage();
  await login(drafter, 'lo.drf1');
  await drafter.goto(url);
  await drafter.getByRole('button', { name: 'Start drafting' }).click();
  await drafter.getByRole('button', { name: 'Upload', exact: true }).click();
  const up = drafter.getByRole('dialog');
  await up.getByLabel('File').setInputFiles({ name: 'nda-draft.pdf', mimeType: 'application/pdf', buffer: PDF });
  await up.getByLabel('Stage').selectOption('DRAFT');
  await up.getByRole('button', { name: 'Upload' }).click();
  await expect(drafter.getByText('nda-draft.pdf', { exact: false }).first()).toBeVisible();
  await drafter.getByRole('button', { name: 'Submit for review' }).click();
  await expect(drafter.getByText('(Submit review)')).toBeVisible();
  // maker-checker: the drafter is offered no review action
  await expect(drafter.getByRole('button', { name: 'Mark reviewed' })).toHaveCount(0);
  const r = await drafter.request.post(`/api/drafting/requests/${url.split('/').pop()}/actions`, { data: { action: 'mark_reviewed' }, headers: { 'x-csrf-token': (await ctx.cookies()).find((c) => c.name === 'ldms_csrf')!.value, origin: 'http://localhost:3000' } });
  expect(r.status(), await r.text()).toBe(403);
  await ctx.close();
});
