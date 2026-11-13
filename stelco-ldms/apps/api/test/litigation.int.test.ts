import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { as, closeApp, db, getApp, userId } from './helpers';
import { LitigationService } from '../src/units/litigation/litigation.service';
import { runAsSystem } from '../src/common/context';
import { parseAmount, parseDate, mapStatus } from '../src/units/litigation/import.service';

async function xlsx(rows: (string | number | Date)[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Register');
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('litigation', () => {
  let app: Awaited<ReturnType<typeof getApp>>;
  let caseId: string;
  beforeAll(async () => { app = await getApp(); });
  afterAll(closeApp);

  it('creates a case with parties, encrypts exposure, blocks duplicate case numbers', async () => {
    const uh = await as('uh.lit');
    const court = await db.court.findFirstOrThrow({ where: { name: 'Civil Court' } });
    const firm = await db.lawFirm.findFirstOrThrow();
    const r = await uh.post('/litigation/cases', {
      title: 'Cable supply dispute', courtCaseNo: 'CV-2026-7001', courtId: court.id, caseType: 'COMMERCIAL', ourRole: 'DEFENDANT', externalFirmId: firm.id,
      responsibleOfficerId: await userId('lo.lit1'), claimAmount: '1250000', risk: 'POSSIBLE', exposure: '400000',
      parties: [{ name: 'ABC Pvt Ltd', side: 'PLAINTIFF' }, { name: 'STELCO', side: 'DEFENDANT' }],
    });
    expect(r.status).toBe(201);
    expect(r.body.reference).toMatch(/^LGL-LIT-2026-\d{4}$/);
    caseId = r.body.id;
    const raw = await db.$transaction([db.$executeRaw`SELECT set_config('app.ctx','system',true)`, db.litigationCase.findUniqueOrThrow({ where: { matterId: caseId } })]);
    expect(raw[1].exposureEnc).toMatch(/^v1\./);
    const g = await uh.get(`/litigation/cases/${caseId}`);
    expect(g.body.exposure).toBe('400000');
    expect(g.body.parties).toHaveLength(2);
    expect((await uh.post('/litigation/cases', { title: 'Dup', courtCaseNo: 'cv-2026-7001', caseType: 'CIVIL', ourRole: 'DEFENDANT' })).status).toBe(409);
  });

  it('IDOR: other units cannot see or change litigation cases', async () => {
    expect((await (await as('lo.drf1')).get(`/litigation/cases/${caseId}`)).status).toBe(404);
    expect((await (await as('lo.drf1')).post(`/litigation/cases/${caseId}/updates`, { receivedAt: new Date().toISOString(), channel: 'EMAIL', summary: 'x x x' })).status).toBe(404);
    expect((await (await as('lo.lit2')).post(`/litigation/cases/${caseId}/updates`, { receivedAt: new Date().toISOString(), channel: 'EMAIL', summary: 'not assigned' })).status).toBe(403);
    expect((await (await as('req.fin')).get(`/litigation/cases/${caseId}`)).status).toBe(403);
  });

  it('enforces the status lifecycle', async () => {
    const uh = await as('uh.lit');
    expect((await uh.post(`/litigation/cases/${caseId}/status`, { status: 'ENFORCEMENT' })).status).toBe(409);
    expect((await uh.post(`/litigation/cases/${caseId}/status`, { status: 'FILED' })).status).toBe(200);
  });

  it('hearing → calendar, held → 2-day summary SLA, summary → next hearing auto-created', async () => {
    const lo = await as('lo.lit1');
    const when = new Date(Date.now() + 2 * 86400_000);
    const h = await lo.post(`/litigation/cases/${caseId}/hearings`, { startsAt: when.toISOString(), judge: 'Judge A' });
    expect(h.status).toBe(201);
    expect(await db.calendarEvent.count({ where: { sourceType: 'Hearing', sourceId: h.body.id } })).toBe(1);
    expect((await lo.get(`/litigation/cases/${caseId}`)).body.matter?.status ?? (await db.matter.findUniqueOrThrow({ where: { id: caseId } })).status).toBeTruthy();
    await lo.post(`/litigation/hearings/${h.body.id}/status`, { status: 'HELD' });
    const clock = await db.slaClock.findFirst({ where: { subjectType: 'Hearing', subjectId: h.body.id } });
    expect(clock?.step).toBe('LIT_HEARING_SUMMARY');
    const next = new Date(Date.now() + 40 * 86400_000);
    const s = await lo.post(`/litigation/hearings/${h.body.id}/summary`, { whatHappened: 'Pleadings closed', ordersMade: 'File witness list', nextSteps: 'Prepare witnesses', companyActions: 'Finance to provide ledger', nextHearingAt: next.toISOString() });
    expect(s.status).toBe(200);
    expect(s.body.nextHearingId).toBeTruthy();
    expect((await db.slaClock.findUniqueOrThrow({ where: { id: clock!.id } })).stoppedAt).not.toBeNull();
    expect(await db.calendarEvent.count({ where: { sourceType: 'Hearing', sourceId: s.body.nextHearingId } })).toBe(1);
    const missing = await (await as('uh.lit')).get('/litigation/reports/missing-summaries');
    expect(missing.body.find((x: { id: string }) => x.id === h.body.id)).toBeUndefined();
  });

  it('deadlines (limitation) create calendar entries with reminders', async () => {
    const lo = await as('lo.lit1');
    const d = await lo.post(`/litigation/cases/${caseId}/deadlines`, { type: 'LIMITATION', title: 'Limitation for counterclaim', dueAt: new Date(Date.now() + 60 * 86400_000).toISOString(), ownerId: await userId('lo.lit1') });
    expect(d.status).toBe(201);
    const ev = await db.calendarEvent.findFirstOrThrow({ where: { sourceType: 'CaseDeadline', sourceId: d.body.id } });
    expect(ev.kind).toBe('LIMITATION');
    expect(await db.reminder.count({ where: { eventId: ev.id } })).toBe(5);
  });

  it('external counsel: engagement, invoice workflow, budget vs actual', async () => {
    const lo = await as('lo.lit1');
    const firm = await db.lawFirm.findFirstOrThrow();
    const e = await lo.post(`/litigation/cases/${caseId}/engagements`, { firmId: firm.id, feeArrangement: 'Fixed fee per stage', budget: '100000' });
    const inv = await lo.post(`/litigation/engagements/${e.body.id}/invoices`, { invoiceNo: 'INV-1', amount: '25000', receivedOn: new Date().toISOString() });
    expect((await lo.post(`/litigation/invoices/${inv.body.id}/status`, { status: 'PAID' })).status).toBe(409);
    expect((await lo.post(`/litigation/invoices/${inv.body.id}/status`, { status: 'VERIFIED' })).status).toBe(200);
    expect((await lo.post(`/litigation/invoices/${inv.body.id}/status`, { status: 'SENT_FOR_PAYMENT' })).status).toBe(200);
    const c = await lo.get(`/litigation/cases/${caseId}`);
    const eng = c.body.engagements.find((x: { id: string }) => x.id === e.body.id);
    expect(eng.actual).toBe(25000);
    expect(eng.budgetUsedPct).toBe(25);
  });

  it('closing requires a firm evaluation; settlements are encrypted', async () => {
    const uh = await as('uh.lit');
    await uh.post(`/litigation/cases/${caseId}/status`, { status: 'PENDING_HEARING' }).catch(() => undefined);
    expect((await uh.post(`/litigation/cases/${caseId}/status`, { status: 'SETTLED' })).status).toBe(200);
    const o = await uh.post(`/litigation/cases/${caseId}/outcomes`, { kind: 'SETTLEMENT', decidedOn: new Date().toISOString(), amount: '300000', direction: 'PAYABLE' });
    expect(o.status).toBe(201);
    expect((await uh.post(`/litigation/cases/${caseId}/status`, { status: 'CLOSED' })).status).toBe(400);
    expect((await uh.post(`/litigation/cases/${caseId}/evaluation`, { quality: 4, responsiveness: 5, cost: 3, outcome: 4 })).status).toBe(200);
    expect((await uh.post(`/litigation/cases/${caseId}/status`, { status: 'CLOSED' })).status).toBe(200);
    const g = await uh.get(`/litigation/cases/${caseId}`);
    expect(g.body.outcomes[0].amount).toBe('300000');
  });

  it('exposure report totals by risk, Excel export, and stale-case job', async () => {
    const uh = await as('uh.lit');
    const c2 = await uh.post('/litigation/cases', { title: 'Labour claim', caseType: 'LABOUR', ourRole: 'DEFENDANT', claimAmount: '85000', risk: 'PROBABLE', exposure: '85000', responsibleOfficerId: await userId('lo.lit2') });
    const r = await uh.get('/litigation/reports/exposure');
    expect(r.body.totals.MVR.PROBABLE.exposure).toBeGreaterThanOrEqual(85000);
    const x = await uh.get('/litigation/reports/exposure?format=xlsx');
    expect(x.headers['content-type']).toContain('spreadsheetml');
    await db.$transaction([db.$executeRaw`SELECT set_config('app.ctx','system',true)`, db.litigationCase.update({ where: { matterId: c2.body.id }, data: { lastUpdateAt: new Date(Date.now() - 40 * 86400_000) } })]);
    const lit = app.get(LitigationService);
    const res = await runAsSystem(() => lit.flagStale());
    expect(res.flagged).toBeGreaterThanOrEqual(1);
    expect(await db.notification.count({ where: { user: { username: 'lo.lit2' }, type: 'lit.no-update' } })).toBeGreaterThan(0);
  });

  it('parsers handle typical register formats', () => {
    expect((parseDate('14/03/2024') as Date).toISOString().slice(0, 10)).toBe('2024-03-14');
    expect((parseDate('2025-06-02') as Date).toISOString().slice(0, 10)).toBe('2025-06-02');
    expect((parseDate('5 Jan 2025') as Date).toISOString().slice(0, 10)).toBe('2025-01-05');
    expect(parseDate('31/02/2024')).toBe('invalid');
    expect(parseDate('TBC')).toBeNull();
    expect(parseAmount('MVR 1,250,000')).toEqual({ amount: '1250000.00', currency: 'MVR' });
    expect(parseAmount('$ 5,000.50')).toEqual({ amount: '5000.50', currency: 'USD' });
    expect(parseAmount('approx lots')).toBe('invalid');
    expect(mapStatus('Hearing scheduled')).toBe('PENDING_HEARING');
    expect(mapStatus('Judgment delivered')).toBe('JUDGMENT_DELIVERED');
  });

  it('imports the Excel register: mapping, dry run, commit, error report, rollback', async () => {
    const pl = await as('pl.lit');
    const buf = await xlsx([
      ['Case No.', 'Court', 'Parties', 'Subject', 'External Lawyer', 'Filing Date', 'Next Hearing', 'Status', 'Claim Amount', 'Remarks'],
      ['IMP-001', 'Civil Court', 'XYZ Pvt Ltd v STELCO', 'Supply contract', 'Shah & Partners LLP', '14/03/2024', '20/12/2027', 'Pending hearing', 'MVR 500,000', ''],
      ['IMP-002', 'Brand New Tribunal', 'STELCO v Contractor', 'Delay penalties', 'New Firm LLP - J. Doe', '2025-01-10', '', 'Filed', '1,000', 'created firm'],
      ['IMP-001', 'Civil Court', 'duplicate in file', '', '', '', '', '', '', ''],
      ['', 'Civil Court', 'missing number', '', '', '31/02/2024', '', '', 'abc', ''],
      ['CV-2026-7001', 'Civil Court', 'already exists', '', '', '', '', '', '', ''],
    ]);
    const up = await pl.upload('/litigation/import', {}, { file: [{ name: 'register.xlsx', data: buf }] });
    expect(up.status).toBe(201);
    expect(up.body.suggested.courtCaseNo).toBe('Case No.');
    expect(up.body.suggested.nextHearing).toBe('Next Hearing');
    const map = up.body.suggested;
    const strict = await pl.post(`/litigation/import/${up.body.batchId}/preview`, { columnMap: map, createMissing: false });
    expect(strict.body.unknown.courts).toContain('Brand New Tribunal');
    expect(strict.body.stats.error).toBeGreaterThanOrEqual(2);
    const prev = await pl.post(`/litigation/import/${up.body.batchId}/preview`, { columnMap: map, createMissing: true });
    expect(prev.body.stats).toEqual({ total: 5, create: 2, duplicate: 2, error: 1 });
    const errRow = prev.body.rows.find((r: { rowNo: number }) => r.rowNo === 5);
    expect(errRow.errors.join(' ')).toMatch(/Case number is missing/);
    expect(errRow.errors.join(' ')).toMatch(/not a valid date/);
    expect(await db.importRow.count({ where: { batchId: up.body.batchId } })).toBe(5);
    const before = await db.$transaction([db.$executeRaw`SELECT set_config('app.ctx','system',true)`, db.matter.count({ where: { unit: 'LIT' } })]);
    const c = await pl.post(`/litigation/import/${up.body.batchId}/commit`);
    expect(c.status).toBe(200);
    expect(c.body.created).toBe(2);
    expect(c.body.createdReference.courts).toBe(1);
    const after = await db.$transaction([db.$executeRaw`SELECT set_config('app.ctx','system',true)`, db.matter.count({ where: { unit: 'LIT' } })]);
    expect(after[1] - before[1]).toBe(2);
    const imported = await db.$transaction([db.$executeRaw`SELECT set_config('app.ctx','system',true)`, db.litigationCase.findFirstOrThrow({ where: { courtCaseNo: 'IMP-001' }, include: { hearings: true, parties: true } })]);
    expect(imported[1].hearings).toHaveLength(1);
    expect(imported[1].parties.map((p) => p.name)).toEqual(['XYZ Pvt Ltd', 'STELCO']);
    const errs = await pl.get(`/litigation/import/${up.body.batchId}/errors`);
    expect(errs.headers['content-type']).toContain('spreadsheetml');
    // paralegals cannot roll back; unit head can
    expect((await pl.post(`/litigation/import/${up.body.batchId}/rollback`, { reason: 'wrong file' })).status).toBe(403);
    const rb = await (await as('uh.lit')).post(`/litigation/import/${up.body.batchId}/rollback`, { reason: 'wrong file' });
    expect(rb.body.removed).toBe(2);
    const gone = await db.$transaction([db.$executeRaw`SELECT set_config('app.ctx','system',true)`, db.matter.count({ where: { unit: 'LIT' } })]);
    expect(gone[1]).toBe(before[1]);
  });

  it('rejects non-Excel uploads to the importer', async () => {
    const pl = await as('pl.lit');
    expect((await pl.upload('/litigation/import', {}, { file: [{ name: 'register.xlsx', data: Buffer.from('not a zip') }] })).status).toBe(400);
  });
});
