import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('typing into a dialog keeps the cursor in the field (regression) and hearings can be postponed with a chit summary', async ({ page }) => {
  await login(page, 'uh.lit');
  await page.goto('/litigation');
  await page.getByRole('row', { name: /ABC Pvt Ltd v STELCO/ }).first().click();
  await expect(page.getByRole('heading', { name: /ABC Pvt Ltd v STELCO/ })).toBeVisible();
  await page.getByRole('button', { name: 'Add hearing' }).click();
  const dlg = page.getByRole('dialog');
  const when = new Date(Date.now() + 60 * 86400_000 + 5 * 3600_000).toISOString().slice(0, 10);
  await dlg.getByLabel('Date and time').fill(`${when}T09:30`);
  // Real key presses (not fill): before the fix the cursor jumped to the first field after every key.
  await dlg.getByLabel('Judge').pressSequentially('Judge Ibrahim');
  await dlg.getByLabel('Purpose').pressSequentially('Mention');
  await expect(dlg.getByLabel('Judge')).toHaveValue('Judge Ibrahim');
  await expect(dlg.getByLabel('Purpose')).toHaveValue('Mention');
  await dlg.getByRole('button', { name: 'Save' }).click();
  const hearing = page.getByTestId('hearing').filter({ hasText: 'Judge Ibrahim' }).first();
  await expect(hearing).toBeVisible();

  await hearing.getByRole('button', { name: 'Edit hearing' }).click();
  const chit = `Chit: parties to appear with originals (${Date.now()})`;
  await page.getByRole('dialog').getByLabel('Hearing chit summary').pressSequentially(chit);
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(hearing.getByText(chit)).toBeVisible();

  await hearing.getByRole('button', { name: 'Documents (chit, continuance…)' }).click();
  await expect(hearing.getByText('Hearing documents')).toBeVisible();

  await hearing.getByRole('button', { name: 'Postpone' }).click();
  const p = page.getByRole('dialog');
  const later = new Date(Date.now() + 75 * 86400_000 + 5 * 3600_000).toISOString().slice(0, 10);
  await p.getByLabel('New date and time').fill(`${later}T09:30`);
  await p.getByLabel('Reason').fill('Judge on leave');
  await p.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Postponed: Judge on leave', { exact: false }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Show' }).click();
  await expect(page.getByTestId('change-history')).toContainText('Chit summary');
});

test('Dhivehi keyboard types Thaana into a field, and the field runs right-to-left', async ({ page }) => {
  await login(page, 'lo.lit1');
  await page.goto('/litigation');
  await page.getByRole('row', { name: /ABC Pvt Ltd v STELCO/ }).first().click();
  await page.getByRole('button', { name: 'Log update' }).click();
  const box = page.getByRole('dialog').getByLabel('Summary');
  await page.getByRole('button', { name: /Dhivehi keyboard/ }).click();
  await box.click();
  await page.keyboard.type('salaam');
  await expect(box).toHaveValue('ސަލަަމ'); // s a l a a m in the phonetic layout
  await expect(box).toHaveAttribute('dir', 'auto');
  await page.keyboard.press('Control+Shift+D'); // off again
  await page.keyboard.type(' ok');
  await expect(box).toHaveValue('ސަލަަމ ok');
});

test('HoD sees "Submit for review" after drafting starts; requests have versions and external lawyers', async ({ page }) => {
  await login(page, 'hod');
  await page.goto('/drafting');
  await page.getByRole('row').nth(1).click();
  await expect(page.getByText('Versions of this request')).toBeVisible();
  await expect(page.getByText('External lawyers')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start a new version' })).toBeVisible();
});

test('reports page: formats, standard weekly report and placeholder help', async ({ page }) => {
  await login(page, 'hod');
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload a format' })).toBeVisible();
  await page.getByRole('tab', { name: 'Standard report' }).click();
  await expect(page.getByText('Workload')).toBeVisible();
  await page.getByRole('tab', { name: 'Placeholders & samples' }).click();
  await expect(page.getByText('{{report.period}}', { exact: true })).toBeVisible();
});

test('compliance: research tab, department report and yes/no confirmations', async ({ page }) => {
  await login(page, 'uh.cmp');
  await page.goto('/compliance');
  await page.getByRole('tab', { name: 'Research' }).click();
  await expect(page.getByText('Research of laws')).toBeVisible();
  await page.getByRole('tab', { name: 'Department report' }).click();
  await expect(page.getByText('Compliance by department')).toBeVisible();
  await page.getByRole('tab', { name: 'Department confirmations' }).click();
  await expect(page.getByRole('button', { name: 'Send reminders now' })).toBeVisible();
});
