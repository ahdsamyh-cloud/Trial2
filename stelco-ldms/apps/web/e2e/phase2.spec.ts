import { expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import { login } from './helpers';

test('litigation officer enters a hearing summary and the next hearing is scheduled @mobile', async ({ page }) => {
  await login(page, 'lo.lit1');
  await page.goto('/litigation');
  await page.getByRole('row', { name: /ABC Pvt Ltd v STELCO/ }).first().click();
  await expect(page.getByRole('heading', { name: /ABC Pvt Ltd v STELCO/ })).toBeVisible();
  await page.getByRole('button', { name: 'Enter summary' }).first().click();
  const dlg = page.getByRole('dialog');
  const note = `Court heard preliminary objections (${Date.now()}); ruling reserved.`;
  await dlg.getByLabel('What happened').fill(note);
  await dlg.getByLabel('Orders made').fill('Parties to file written submissions.');
  const next = new Date(Date.now() + 45 * 86400_000 + 5 * 3600_000).toISOString().slice(0, 10);
  await dlg.getByLabel('Next hearing date').fill(`${next}T10:00`);
  await dlg.getByRole('button', { name: 'Save summary' }).click();
  await expect(page.getByText(note)).toBeVisible();
});

test('paralegal imports the litigation register with a dry run', async ({ page }) => {
  await login(page, 'pl.lit');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Register');
  ws.addRow(['Case No.', 'Court', 'Parties', 'Subject', 'External Lawyer', 'Filing Date', 'Next Hearing', 'Status', 'Claim Amount', 'Remarks']);
  ws.addRow([`E2E-${Date.now()}`, 'Civil Court', 'Test Co v STELCO', 'Meter tampering dispute', 'Island Legal Associates', '01/02/2025', '', 'Pending', '12,000', '']);
  ws.addRow(['', 'Civil Court', 'missing case number', '', '', 'not a date', '', '', '', '']);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  await page.goto('/litigation/import');
  await page.getByLabel('Excel register (.xlsx)').setInputFiles({ name: 'register.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: buf });
  await page.getByRole('button', { name: 'Upload and read columns' }).click();
  await expect(page.getByText('2 rows found')).toBeVisible();
  await page.getByRole('button', { name: 'Run dry-run preview' }).click();
  await expect(page.getByText('Dry-run preview (nothing saved yet)')).toBeVisible();
  await expect(page.getByText('Case number is missing', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Import 1 case(s)' }).click();
  await expect(page.getByText('1 case(s) imported')).toBeVisible();
});

test('drafting officer cannot open litigation cases', async ({ page }) => {
  await login(page, 'lo.drf1');
  const r = await page.request.get('/api/litigation/cases?pageSize=5');
  expect(r.status()).toBe(200);
  expect((await r.json()).rows).toHaveLength(0);
});
