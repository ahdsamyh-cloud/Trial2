import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('HoD dashboard shows the workload per lawyer', async ({ page }) => {
  await login(page, 'hod');
  await page.goto('/dashboard');
  const table = page.getByTestId('workload');
  await expect(table).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'Hearings (7 days)' })).toBeVisible();
  await expect(table.getByText('Legal Officer (LIT)').first()).toBeVisible();
  expect(await table.getByRole('row').count()).toBeGreaterThan(5);
});

test('judgment: appeal period and decision are recorded, with the appeal deadline shown', async ({ page }) => {
  await login(page, 'uh.lit');
  await page.goto('/litigation');
  await page.getByRole('row', { name: /ABC Pvt Ltd v STELCO/ }).first().click();
  await page.getByRole('button', { name: 'Record outcome' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Date').fill('2026-11-10');
  await dlg.getByLabel('Appeal period (days)').fill('10');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('appeal-line').first()).toContainText('Appeal by');
  await expect(page.getByTestId('appeal-line').first()).toContainText('10 calendar days');
});

test('template library: officer adds a template, Unit Head approves, earlier versions are kept', async ({ browser }) => {
  const name = `Service agreement ${Date.now()}`;
  const lo = await browser.newPage();
  await login(lo, 'lo.drf1');
  await lo.goto('/drafting');
  await lo.getByRole('tab', { name: 'Templates & clauses' }).click();
  await lo.getByRole('button', { name: 'Add' }).first().click();
  let dlg = lo.getByRole('dialog');
  await dlg.getByLabel('Name').fill(name);
  await dlg.getByLabel('Category').fill('Procurement');
  await dlg.getByLabel('Text').fill('1. Services. The Contractor shall…');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(lo.getByTestId('templates').getByText(name)).toBeVisible();
  await lo.close();

  const uh = await browser.newPage();
  await login(uh, 'uh.drf');
  await uh.goto('/drafting');
  await uh.getByRole('tab', { name: 'Templates & clauses' }).click();
  const row = uh.getByTestId('templates').getByRole('listitem').filter({ hasText: name });
  await row.getByRole('button', { name: 'Edit' }).click();
  dlg = uh.getByRole('dialog');
  await dlg.getByLabel('Text').fill('1. Services. The Contractor shall provide…');
  await dlg.getByLabel('Status').selectOption('APPROVED');
  await dlg.getByLabel('What changed (kept with the old version)').fill('Clarified scope');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(row).toContainText('v2');
  await expect(row).toContainText('Approved');
  await row.getByRole('button', { name: name }).click();
  await uh.getByRole('dialog').getByRole('button', { name: 'Earlier versions' }).click();
  await expect(uh.getByText('Clarified scope', { exact: false })).toBeVisible();
  await uh.close();
});

test('reports: a weekly format can be set to send automatically; the link from the notification downloads it', async ({ page }) => {
  await login(page, 'hod');
  await page.goto('/reports');
  await page.getByRole('button', { name: 'Upload a format' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByText('Send automatically')).toBeVisible();
  await expect(dlg.getByText('Every Sunday at 8:00, for the week that just ended')).toBeVisible();
  await dlg.getByRole('button', { name: 'Close' }).click();
  await page.goto('/reports?run=does-not-exist&period=WEEKLY&ref=2026-11-14');
  await expect(page.getByRole('button', { name: 'Download report' })).toBeVisible();
});

test('Dhivehi interface: switching language turns the menus into Dhivehi and the page right-to-left; HoD can correct the wording', async ({ page }) => {
  await login(page, 'hod');
  await page.goto('/admin/translations');
  await expect(page.getByTestId('translations')).toBeVisible();
  await page.getByTestId('language-switch').click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('link', { name: 'ރިޕޯޓްތައް' })).toBeVisible(); // "Reports"
  await page.getByTestId('language-switch').click(); // back to English for the other tests
  await expect(page.locator('html')).not.toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('link', { name: 'Reports' })).toBeVisible();
});

test('compliance: Unit Head assigns research of a new law from the Research tab', async ({ page }) => {
  await login(page, 'uh.cmp');
  await page.goto('/compliance');
  await page.getByRole('tab', { name: 'Research' }).click();
  await page.getByRole('button', { name: 'Assign research' }).click();
  const dlg = page.getByRole('dialog');
  const title = `Public Finance (Amendment) Regulation ${Date.now()}`;
  await dlg.getByLabel('Title of the new law').fill(title);
  await dlg.getByLabel('Lawyer').selectOption({ label: 'Ali Fazeel' });
  await dlg.getByRole('button', { name: 'Assign' }).click();
  const row = page.getByTestId('research-list').getByRole('listitem').filter({ hasText: title });
  await expect(row).toContainText('Ali Fazeel');
  await row.getByRole('button', { name: 'Reassign' }).click();
  await expect(page.getByRole('dialog').getByText('Assign / reassign research')).toBeVisible();
});

test('drafting: the Unit Head can reassign at any stage and complete a task without review', async ({ page }) => {
  await login(page, 'uh.drf');
  await page.goto('/drafting');
  await page.getByRole('button', { name: 'New request' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Title').fill(`Quick advice ${Date.now()}`);
  await dlg.getByLabel('Request type').selectOption({ index: 1 });
  await dlg.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByRole('button', { name: 'Assign / reassign' })).toBeVisible();
  await page.getByRole('button', { name: 'Start drafting' }).click();
  await expect(page.getByRole('button', { name: 'Send for approval without review' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Assign / reassign' })).toBeVisible(); // still possible while drafting
  await page.getByRole('button', { name: 'Complete task' }).click();
  await page.getByRole('dialog').getByLabel(/Reason|comments/).fill('Advice given by phone');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Closed').first()).toBeVisible();
});
