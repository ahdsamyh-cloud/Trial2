import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { as, closeApp, db, getApp, sampleEml, userId } from './helpers';

async function textPdf(text: string) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 200]);
  page.drawText(text, { x: 20, y: 100, size: 12, font: await doc.embedFont(StandardFonts.Helvetica) });
  return Buffer.from(await doc.save());
}
async function sheet(rows: (string | number)[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('S');
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('cross-cutting: dashboards, search, reports, importers', () => {
  let restrictedId: string;
  let openId: string;
  beforeAll(async () => {
    await getApp();
    const uh = await as('uh.cmp');
    openId = (await uh.post('/matters', { unit: 'CMP', title: 'Quokkaline sanctions screening review', description: 'zebrafinch keyword in description' })).body.id;
    restrictedId = (await uh.post('/matters', { unit: 'CMP', title: 'Hushhush investigation zanzibarite', restricted: true })).body.id;
  });
  afterAll(closeApp);

  it('HoD dashboard covers all units incl. restricted; unit heads see their unit; officers cannot', async () => {
    const hod = await (await as('hod')).get('/dashboard');
    expect(hod.status).toBe(200);
    expect(hod.body.openByUnitStatus.some((r: { unit: string }) => r.unit === 'LIT')).toBe(true);
    expect(hod.body.turnaround).toHaveLength(4);
    const uhLit = await (await as('uh.lit')).get('/dashboard');
    expect(uhLit.body.openByUnitStatus.every((r: { unit: string }) => r.unit === 'LIT')).toBe(true);
    expect((await (await as('uh.lit')).get('/dashboard?unit=CMP')).status).toBe(403);
    expect((await (await as('lo.cmp1')).get('/dashboard')).status).toBe(403);
  });

  it('management viewer gets aggregates only, restricted matters in a "confidential" bucket', async () => {
    const m = await (await as('mgmt')).get('/dashboard/management');
    expect(m.status).toBe(200);
    expect(m.body.confidentialOpen).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(m.body)).not.toContain('zanzibarite');
    expect(m.body.slaBreaches).toBeUndefined();
    expect((await (await as('mgmt')).get('/dashboard')).status).toBe(403);
  });

  it('global search respects scope and the ethical wall', async () => {
    const officer = await as('lo.cmp1');
    const r1 = await officer.get('/search?q=quokkaline');
    expect(r1.body.hits.find((h: { id: string }) => h.id === openId)).toBeTruthy();
    expect((await officer.get('/search?q=zebrafinch')).body.hits.find((h: { id: string }) => h.id === openId)).toBeTruthy();
    expect((await officer.get('/search?q=zanzibarite')).body.hits).toEqual([]);
    expect((await (await as('lo.lit1')).get('/search?q=quokkaline')).body.hits.find((h: { id: string }) => h.id === openId)).toBeUndefined();
    const hod = await (await as('hod')).get('/search?q=zanzibarite');
    expect(hod.body.hits.find((h: { id: string }) => h.id === restrictedId)).toBeTruthy();
    expect((await (await as('adm.it')).get('/search?q=quokkaline')).status).toBe(403);
  });

  it('searches text extracted from documents and emails', async () => {
    const uh = await as('uh.cmp');
    const pdf = await textPdf('The marsupialoid clause requires annual disclosure.');
    expect((await uh.upload('/documents', { ownerType: 'matter', ownerId: openId, title: 'Policy text' }, { file: [{ name: 'policy.pdf', data: pdf }] })).status).toBe(201);
    const found = await uh.get('/search?q=marsupialoid');
    const hit = found.body.hits.find((h: { type: string }) => h.type === 'document');
    expect(hit).toBeTruthy();
    expect(hit.snippet).toContain('«marsupialoid»');
    expect((await (await as('lo.drf1')).get('/search?q=marsupialoid')).body.hits.filter((h: { type: string }) => h.type === 'document')).toEqual([]);
    const pl = await as('pl.drf');
    await pl.upload('/intake', { source: 'EMAIL', receivedAt: new Date().toISOString(), senderName: 'X', subject: 'Search test', priority: 'NORMAL' }, { email: [{ name: 'm.eml', data: sampleEml('<search-test@stelco.com.mv>') }] });
    expect((await pl.get('/search?q=fuel%20supply&types=email')).body.hits.length).toBeGreaterThanOrEqual(1);
  });

  it('management report: JSON, PDF and Excel; unit heads only see their unit', async () => {
    const hod = await as('hod');
    const period = new Date().toISOString().slice(0, 7);
    const j = await hod.get(`/reports/management?kind=monthly&period=${period}`);
    expect(j.body.sections.map((s: { title: string }) => s.title)).toEqual(['Workload', 'Service levels', 'Litigation', 'Drafting', 'Compliance', 'Awareness']);
    const pdf = await hod.get(`/reports/management?kind=annual&period=${period.slice(0, 4)}&format=pdf`);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body.toString('latin1').slice(0, 5)).toBe('%PDF-');
    const x = await hod.get(`/reports/management?kind=monthly&period=${period}&format=xlsx`);
    expect(x.headers['content-type']).toContain('spreadsheetml');
    const uh = await (await as('uh.lit')).get(`/reports/management?kind=monthly&period=${period}`);
    expect(uh.body.sections.map((s: { title: string }) => s.title)).toEqual(['Workload', 'Service levels', 'Litigation']);
    expect((await (await as('mgmt')).get(`/reports/management?kind=monthly&period=${period}`)).status).toBe(200);
    expect((await hod.get('/reports/management?kind=monthly&period=bad')).status).toBe(400);
  });

  it('contracts and laws importers with dry run', async () => {
    const lo = await as('lo.drf1');
    const buf = await sheet([['Title', 'Parties', 'Value', 'Start date', 'End date', 'Auto-renew', 'Notice period (days)', 'Owning department'], ['Imported cleaning contract', 'STELCO; CleanCo', 'MVR 120,000', '01/01/2026', '31/12/2026', 'yes', '30', 'Facilities'], ['', 'x', 'abc', 'notadate', '', '', 'ten', 'Nowhere']]);
    const dry = await lo.upload('/imports/contracts', {}, { file: [{ name: 'c.xlsx', data: buf }] });
    expect(dry.body).toMatchObject({ total: 2, valid: 1, committed: false });
    expect(dry.body.errors[0].errors.length).toBeGreaterThanOrEqual(3);
    const ok = await lo.upload('/imports/contracts?commit=true', {}, { file: [{ name: 'c.xlsx', data: buf }] });
    expect(ok.body.committed).toBe(true);
    expect(await db.contract.count({ where: { title: 'Imported cleaning contract' } })).toBe(1);
    const cmp = await as('lo.cmp1');
    const lb = await sheet([['Title', 'Type', 'Regulator', 'Effective on', 'Status'], ['Imported Energy Act', 'Act', 'Utility Regulatory Authority', '2025-01-01', 'In force']]);
    expect((await cmp.upload('/imports/laws?commit=true', {}, { file: [{ name: 'l.xlsx', data: lb }] })).body.valid).toBe(1);
    expect((await lo.upload('/imports/laws', {}, { file: [{ name: 'l.xlsx', data: lb }] })).status).toBe(403);
  });

  it('bulk reminder notifies assignees only for matters in scope', async () => {
    const uh = await as('uh.cmp');
    await uh.post(`/matters/${openId}/assign`, { assigneeIds: [await userId('lo.cmp1')] });
    const litCase = await db.$transaction([db.$executeRaw`SELECT set_config('app.ctx','system',true)`, db.matter.findFirstOrThrow({ where: { unit: 'LIT' } })]);
    const r = await uh.post('/matters/bulk/remind', { matterIds: [openId, litCase[1].id], message: 'Please update' });
    expect(r.body).toEqual({ reminded: 1, skipped: 1 });
    expect(await db.notification.count({ where: { user: { username: 'lo.cmp1' }, type: 'matter.reminder' } })).toBe(1);
  });
});
