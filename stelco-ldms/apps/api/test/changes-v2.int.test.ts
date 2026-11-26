import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import PizZip from 'pizzip';
import { as, closeApp, db, getApp, PDF, userId } from './helpers';
import { ComplianceService } from '../src/units/compliance/compliance.service';
import { runAsSystem } from '../src/common/context';

const sys = <T>(q: Promise<T>) => db.$transaction([db.$executeRaw`SELECT set_config('app.ctx','system',true)`, q as never]).then((r) => r[1] as T);
const rtId = async (code: string) => (await db.requestType.findUniqueOrThrow({ where: { code } })).id;

/** A minimal .docx (Word) file whose body is the given paragraphs. */
function docx(paragraphs: string[]) {
  const zip = new PizZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
  return zip.generate({ type: 'nodebuffer' });
}
const docxText = (buf: Buffer) => new PizZip(buf).file('word/document.xml')!.asText().replace(/<[^>]+>/g, ' ');
const binary = (res: { on: (e: string, cb: (c?: Buffer) => void) => void; setEncoding: (e: string) => void }, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c) => chunks.push(c!));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('change request v2: litigation hearings, edits + history, drafting, compliance, reports', () => {
  let app: Awaited<ReturnType<typeof getApp>>;
  let caseId: string;
  beforeAll(async () => { app = await getApp(); });
  afterAll(closeApp);

  it('litigation: case edit keeps defaulted fields (currency) and replaces parties; history shows old -> new', async () => {
    const uh = await as('uh.lit');
    const c = await uh.post('/litigation/cases', { title: 'Hearing chit test case', caseType: 'CIVIL', ourRole: 'DEFENDANT', currency: 'USD', claimAmount: '1000', parties: [{ name: 'X Pvt Ltd', side: 'OPPOSING' }] });
    expect(c.status).toBe(201);
    caseId = c.body.id;
    // Regression: zod applied .default() inside .partial(), resetting currency to MVR on every edit.
    expect((await uh.patch(`/litigation/cases/${caseId}`, { remarks: 'ރިމާކްސް (Dhivehi remarks)' })).status).toBe(200);
    let g = await uh.get(`/litigation/cases/${caseId}`);
    expect(g.body.currency).toBe('USD');
    expect(g.body.parties).toHaveLength(1);
    expect(g.body.remarks).toBe('ރިމާކްސް (Dhivehi remarks)');
    expect((await uh.patch(`/litigation/cases/${caseId}`, { parties: [{ name: 'Y Pvt Ltd', side: 'OPPOSING' }, { name: 'STELCO', side: 'OURS' }] })).status).toBe(200);
    g = await uh.get(`/litigation/cases/${caseId}`);
    expect(g.body.parties.map((p: { name: string }) => p.name).sort()).toEqual(['STELCO', 'Y Pvt Ltd']);
    // An officer who is not assigned can edit (default rule) and the change is in the history.
    expect((await (await as('lo.lit2')).patch(`/litigation/cases/${caseId}`, { subject: 'Edited by another officer' })).status).toBe(200);
    const h = await uh.get(`/matters/${caseId}/history`);
    expect(h.status).toBe(200);
    const edit = h.body.find((r: { who: string; changes: { field: string }[] }) => r.changes.some((x) => x.field === 'subject'));
    expect(edit.who).toBeTruthy();
    expect(edit.changes.find((x: { field: string }) => x.field === 'subject')).toMatchObject({ before: null, after: 'Edited by another officer' });
    expect(h.body.some((r: { changes: { field: string; before: unknown; after: unknown }[] }) => r.changes.some((x) => x.field === 'remarks' && x.after === 'ރިމާކްސް (Dhivehi remarks)'))).toBe(true);
    // Other units and requesters cannot read it.
    expect((await (await as('lo.drf1')).get(`/matters/${caseId}/history`)).status).toBe(404);
  });

  it('litigation: hearing chit summary, documents on the hearing, edit, postpone, continuance', async () => {
    const lo = await as('lo.lit1');
    const uh = await as('uh.lit');
    const start = new Date(Date.now() + 7 * 86400_000);
    const h1 = (await uh.post(`/litigation/cases/${caseId}/hearings`, { startsAt: start.toISOString(), judge: 'Judge A' })).body.id as string;
    expect((await lo.patch(`/litigation/hearings/${h1}`, { chitSummary: 'Parties to appear; bring originals.', purpose: 'Preliminary' })).status).toBe(200);
    // Hearing documents: chit and continuance request.
    const doc = await lo.upload('/documents', { ownerType: 'hearing', ownerId: h1, docTypeCode: 'HEARING_CHIT', title: 'Hearing chit' }, { file: [{ name: 'chit.pdf', data: PDF }] });
    expect(doc.status).toBe(201);
    expect((await lo.get(`/documents?ownerType=hearing&ownerId=${h1}`)).body.map((d: { docTypeCode: string }) => d.docTypeCode)).toContain('HEARING_CHIT');
    expect((await (await as('lo.drf1')).get(`/documents?ownerType=hearing&ownerId=${h1}`)).status).toBe(404);
    // Continuance: request, then granted -> new hearing on the court's new date.
    expect((await lo.post(`/litigation/hearings/${h1}/continuance`, { action: 'GRANTED', startsAt: new Date(Date.now() + 20 * 86400_000).toISOString() })).status).toBe(409); // nothing requested yet
    expect((await lo.post(`/litigation/hearings/${h1}/continuance`, { action: 'REQUEST', note: 'Witness abroad' })).status).toBe(200);
    const granted = await lo.post(`/litigation/hearings/${h1}/continuance`, { action: 'GRANTED', startsAt: new Date(Date.now() + 21 * 86400_000).toISOString(), note: 'Granted by the court' });
    expect(granted.status).toBe(200);
    let c = (await uh.get(`/litigation/cases/${caseId}`)).body;
    const old = c.hearings.find((x: { id: string }) => x.id === h1);
    expect(old).toMatchObject({ status: 'POSTPONED', continuanceStatus: 'GRANTED', chitSummary: 'Parties to appear; bring originals.', nextHearingId: granted.body.nextHearingId });
    // Postpone the new hearing directly; a reason is required.
    const h2 = granted.body.nextHearingId as string;
    expect((await lo.post(`/litigation/hearings/${h2}/postpone`, { startsAt: new Date(Date.now() + 30 * 86400_000).toISOString(), reason: '' })).status).toBe(400);
    const p = await lo.post(`/litigation/hearings/${h2}/postpone`, { startsAt: new Date(Date.now() + 30 * 86400_000).toISOString(), reason: 'Judge on leave' });
    expect(p.status).toBe(200);
    c = (await uh.get(`/litigation/cases/${caseId}`)).body;
    expect(c.hearings.find((x: { id: string }) => x.id === h2)).toMatchObject({ status: 'POSTPONED', postponeReason: 'Judge on leave' });
    expect(c.hearings.filter((x: { status: string }) => x.status === 'SCHEDULED')).toHaveLength(1);
    expect((await lo.post(`/litigation/hearings/${h2}/postpone`, { startsAt: new Date(Date.now() + 40 * 86400_000).toISOString(), reason: 'again' })).status).toBe(409);
    // Denied continuance keeps the hearing.
    const h3 = p.body.nextHearingId as string;
    await lo.post(`/litigation/hearings/${h3}/continuance`, { action: 'REQUEST' });
    expect((await lo.post(`/litigation/hearings/${h3}/continuance`, { action: 'DENIED', note: 'Refused' })).status).toBe(200);
    c = (await uh.get(`/litigation/cases/${caseId}`)).body;
    expect(c.hearings.find((x: { id: string }) => x.id === h3)).toMatchObject({ status: 'SCHEDULED', continuanceStatus: 'DENIED' });
    // Summary can be edited after it was entered.
    await lo.post(`/litigation/hearings/${h3}/summary`, { whatHappened: 'Arguments heard.' });
    expect((await uh.patch(`/litigation/hearings/${h3}`, { summary: { whatHappened: 'Arguments heard; judgment reserved.', ordersMade: 'None' } })).status).toBe(200);
    c = (await uh.get(`/litigation/cases/${caseId}`)).body;
    expect(c.hearings.find((x: { id: string }) => x.id === h3).summary.whatHappened).toBe('Arguments heard; judgment reserved.');
    const hist = (await uh.get(`/matters/${caseId}/history`)).body as { action: string }[];
    expect(hist.map((r) => r.action)).toEqual(expect.arrayContaining(['lit.hearing.updated', 'lit.hearing.postponed', 'lit.hearing.continuance.granted', 'lit.hearing.continuance.denied']));
  });

  it('litigation: deadlines, counsel updates and outcomes are editable and audited', async () => {
    const lo = await as('lo.lit1');
    const d = await lo.post(`/litigation/cases/${caseId}/deadlines`, { type: 'FILING', title: 'File defence', dueAt: new Date(Date.now() + 5 * 86400_000).toISOString() });
    expect((await lo.patch(`/litigation/deadlines/${d.body.id}`, { title: 'File statement of defence', type: 'SUBMISSION' })).status).toBe(200);
    const u = await lo.post(`/litigation/cases/${caseId}/updates`, { receivedAt: new Date().toISOString(), channel: 'EMAIL', summary: 'Counsel filed the reply.' });
    expect((await lo.patch(`/litigation/updates/${u.body.id}`, { summary: 'Counsel filed the reply and the annexes.' })).status).toBe(200);
    const o = await lo.post(`/litigation/cases/${caseId}/outcomes`, { kind: 'SETTLEMENT', decidedOn: new Date().toISOString(), amount: '5000', direction: 'PAYABLE' });
    expect((await lo.patch(`/litigation/outcomes/${o.body.id}`, { terms: 'Paid in two instalments', amount: '6000' })).status).toBe(200);
    const c = (await lo.get(`/litigation/cases/${caseId}`)).body;
    expect(c.deadlines.find((x: { id: string }) => x.id === d.body.id)).toMatchObject({ title: 'File statement of defence', type: 'SUBMISSION' });
    expect(c.outcomes.find((x: { id: string }) => x.id === o.body.id)).toMatchObject({ amount: '6000', terms: 'Paid in two instalments' });
    const hist = (await lo.get(`/matters/${caseId}/history`)).body as { action: string; changes: { field: string; before: unknown; after: unknown }[] }[];
    const amount = hist.find((r) => r.action === 'lit.outcome.updated')!.changes.find((x) => x.field === 'amount')!;
    expect(amount).toEqual({ field: 'amount', before: '[changed]', after: '[changed]' }); // encrypted value never in the history
  });

  it('configuration edits no longer reset defaulted fields (e.g. reactivating a deactivated court)', async () => {
    const adm = await as('adm.it');
    const r = await adm.post('/config/courts', { name: `Test Tribunal ${Date.now()}`, kind: 'TRIBUNAL' });
    expect(r.status).toBe(201);
    expect((await adm.patch(`/config/courts/${r.body.id}`, { jurisdiction: 'Malé' })).status).toBe(200);
    expect((await db.court.findUniqueOrThrow({ where: { id: r.body.id } })).kind).toBe('TRIBUNAL');
  });

  it('drafting: HoD and Unit Head can take the drafter’s steps (recorded on behalf); maker-checker still holds for approval', async () => {
    const uh = await as('uh.drf');
    const hod = await as('hod');
    const c = await uh.post('/drafting/requests', { title: 'Procurement policy', requestTypeId: await rtId('POLICY') });
    const id = c.body.id as string;
    await uh.post(`/drafting/requests/${id}/actions`, { action: 'assign', assigneeId: await userId('lo.drf1'), reviewerId: await userId('lo.drf2') });
    expect((await hod.post(`/drafting/requests/${id}/actions`, { action: 'start' })).status).toBe(200);
    const actions = (await hod.get(`/drafting/requests/${id}`)).body.actions.map((a: { action: string }) => a.action);
    expect(actions).toContain('submit_review'); // the button the HoD could not see before
    const up = await hod.upload('/documents', { ownerType: 'matter', ownerId: id, stageLabel: 'DRAFT', docTypeCode: 'POLICY' }, { file: [{ name: 'policy-v1.pdf', data: PDF }] });
    expect(up.status).toBe(201);
    expect((await hod.post(`/drafting/requests/${id}/actions`, { action: 'submit_review' })).status).toBe(200);
    const tr = await sys(db.statusTransition.findFirstOrThrow({ where: { matterId: id, action: 'submit_review' } }));
    expect(tr.comment).toMatch(/on behalf of the drafter by the HoD/);
    // Comments on a specific version of the policy (policy review / commenting).
    const versionId = up.body.versionId as string;
    expect((await (await as('lo.drf2')).post(`/matters/${id}/comments`, { body: 'Clause 4 conflicts with the Finance Act.', versionId })).status).toBe(201);
    const other = await sys(db.documentVersion.findFirstOrThrow({ where: { document: { OR: [{ matterId: null }, { matterId: { not: id } }] } } }));
    expect((await uh.post(`/matters/${id}/comments`, { body: 'x', versionId: other.id })).status).toBe(400);
    const m = await uh.get(`/matters/${id}`);
    expect(m.body.comments.find((x: { versionId: string | null }) => x.versionId === versionId)).toBeTruthy();
    expect(m.body.canWrite).toBe(true);
  });

  it('drafting: new version of a completed request keeps the lineage; restricted stays restricted', async () => {
    const uh = await as('uh.drf');
    const v1 = (await uh.post('/drafting/requests', { title: 'Fuel supply agreement', requestTypeId: await rtId('CONTRACT'), counterparty: 'FuelCo', contractValue: '900000' })).body.id as string;
    await sys(db.matter.update({ where: { id: v1 }, data: { status: 'CLOSED', closedAt: new Date() } }));
    const v2 = await uh.post(`/drafting/requests/${v1}/new-version`, { note: 'Renewal for 2027' });
    expect(v2.status).toBe(201);
    const v3 = await uh.post(`/drafting/requests/${v2.body.id}/new-version`, {});
    const versions = (await uh.get(`/drafting/requests/${v3.body.id}/versions`)).body as { version: number; id: string; current: boolean }[];
    expect(versions.map((v) => v.id)).toEqual([v1, v2.body.id, v3.body.id]);
    expect(versions.find((v) => v.current)!.version).toBe(3);
    expect((await uh.get(`/drafting/requests/${v3.body.id}`)).body.counterparty).toBe('FuelCo');
    // Restricted: the new version keeps the ethical wall and the named people.
    const r = (await uh.post('/drafting/requests', { title: 'Confidential settlement deed', requestTypeId: await rtId('CONTRACT'), restricted: true })).body.id as string;
    const rv = await uh.post(`/drafting/requests/${r}/new-version`, {});
    expect((await sys(db.matter.findUniqueOrThrow({ where: { id: rv.body.id } }))).restricted).toBe(true);
    expect((await (await as('lo.drf1')).get(`/matters/${rv.body.id}`)).status).toBe(404);
    expect((await uh.get(`/matters/${rv.body.id}`)).status).toBe(200);
  });

  it('drafting: work given to external lawyers is tracked (sent, due, received, overdue)', async () => {
    const lo = await as('lo.drf1');
    const uh = await as('uh.drf');
    const id = (await uh.post('/drafting/requests', { title: 'Shareholder agreement', requestTypeId: await rtId('CONTRACT') })).body.id as string;
    const firm = await db.lawFirm.findFirstOrThrow();
    const x = await lo.post(`/drafting/requests/${id}/externals`, { firmId: firm.id, scope: 'Draft the shareholder agreement', sentAt: new Date(Date.now() - 10 * 86400_000).toISOString(), dueAt: new Date(Date.now() - 86400_000).toISOString(), fee: '15000' });
    expect(x.status).toBe(201);
    let list = (await lo.get(`/drafting/requests/${id}/externals`)).body;
    expect(list[0]).toMatchObject({ status: 'SENT', overdue: true });
    expect((await lo.patch(`/drafting/externals/${x.body.id}`, { status: 'RECEIVED' })).status).toBe(200);
    list = (await lo.get(`/drafting/requests/${id}/externals`)).body;
    expect(list[0].status).toBe('RECEIVED');
    expect(list[0].receivedAt).toBeTruthy();
    expect((await (await as('lo.lit1')).get(`/drafting/requests/${id}/externals`)).status).toBe(404);
  });

  it('compliance: HoD assigns research, the lawyer completes it with obligations; departments answer yes/no', async () => {
    const uh = await as('uh.cmp');
    const lo = await as('lo.cmp1');
    const fin = await db.department.findUniqueOrThrow({ where: { code: 'FIN' } });
    const hr = await db.department.findUniqueOrThrow({ where: { code: 'HR' } });
    const law = (await lo.post('/compliance/laws', { title: `Data Protection Act ${Date.now()}`, type: 'ACT' })).body.id as string;
    expect((await lo.post(`/compliance/laws/${law}/research`, { assigneeId: await userId('lo.cmp1') })).status).toBe(403); // only HoD/UH assign
    expect((await uh.post(`/compliance/laws/${law}/research`, { assigneeId: await userId('lo.lit1') })).status).toBe(400); // not a compliance lawyer
    expect((await uh.post(`/compliance/laws/${law}/research`, { assigneeId: await userId('lo.cmp1'), dueAt: new Date(Date.now() + 10 * 86400_000).toISOString(), note: 'Identify obligations for each department' })).status).toBe(200);
    expect((await lo.get('/compliance/research?mine=true')).body.some((r: { id: string; researchStatus: string }) => r.id === law && r.researchStatus === 'ASSIGNED')).toBe(true);
    expect((await lo.post(`/compliance/laws/${law}/research/progress`, { status: 'COMPLETED', findings: 'Applies to Finance and HR.' })).status).toBe(400); // no obligations yet
    const ob = await lo.post('/compliance/obligations', { lawId: law, description: 'Keep a register of personal data processing', risk: 'MEDIUM', departmentIds: [fin.id, hr.id] });
    expect(ob.body.frequency).toBe('ANNUAL'); // asked again every year by default
    expect((await lo.post(`/compliance/laws/${law}/research/progress`, { status: 'COMPLETED', findings: 'Applies to Finance and HR.' })).status).toBe(200);
    expect((await db.law.findUniqueOrThrow({ where: { id: law } })).researchStatus).toBe('COMPLETED');

    await runAsSystem(() => app.get(ComplianceService).generateCycles());
    const finItem = await db.checkItem.findFirstOrThrow({ where: { obligationId: ob.body.id, cycle: { departmentId: fin.id } }, include: { cycle: true } });
    const hrItem = await db.checkItem.findFirstOrThrow({ where: { obligationId: ob.body.id, cycle: { departmentId: hr.id } } });
    const finUser = await as('req.fin');
    expect((await finUser.post(`/compliance/items/${hrItem.id}/answer`, { answer: 'YES' })).status).toBe(404); // other department
    expect((await finUser.post(`/compliance/items/${finItem.id}/answer`, { answer: 'NO', comment: 'Register not set up yet' })).status).toBe(200);

    // "No" -> reminders until "Yes" (and not again within the reminder interval).
    const svc = app.get(ComplianceService);
    const first = await runAsSystem(() => svc.answerReminders());
    expect(first.reminded).toBeGreaterThanOrEqual(1);
    expect((await db.checkItem.findUniqueOrThrow({ where: { id: finItem.id } })).reminderCount).toBe(1);
    await runAsSystem(() => svc.answerReminders());
    expect((await db.checkItem.findUniqueOrThrow({ where: { id: finItem.id } })).reminderCount).toBe(1);
    await runAsSystem(() => svc.answerReminders(new Date(Date.now() + 8 * 86400_000)));
    expect((await db.checkItem.findUniqueOrThrow({ where: { id: finItem.id } })).reminderCount).toBe(2);

    // "Yes" closes the item; when every item of the department's checklist is Yes, it is completed.
    const others = await db.checkItem.findMany({ where: { cycleId: finItem.cycleId, id: { not: finItem.id } } });
    for (const o of others) await finUser.post(`/compliance/items/${o.id}/answer`, { answer: 'YES' });
    const yes = await finUser.post(`/compliance/items/${finItem.id}/answer`, { answer: 'YES' });
    expect(yes.body.cycleStatus).toBe('COMPLETED');
    expect((await db.checkItem.findUniqueOrThrow({ where: { id: finItem.id } })).closedAt).toBeTruthy();
    const after = await runAsSystem(() => svc.answerReminders(new Date(Date.now() + 30 * 86400_000)));
    expect((await db.checkItem.findUniqueOrThrow({ where: { id: finItem.id } })).reminderCount).toBe(2);
    expect(after).toBeTruthy();

    // Department-wise report (JSON + Excel).
    const rep = (await uh.get('/compliance/reports/departments')).body;
    const finRow = rep.summary.find((r: { id: string }) => r.id === fin.id);
    expect(finRow.yes).toBeGreaterThanOrEqual(1);
    expect(rep.detail.some((d: { obligation: string; answer: string }) => d.obligation.includes('personal data') && d.answer === 'YES')).toBe(true);
    const x = await uh.get('/compliance/reports/departments?format=xlsx');
    expect(x.headers['content-type']).toContain('spreadsheetml');
    expect((await finUser.get('/compliance/reports/departments')).status).toBe(403);
  });

  it('reports: weekly/monthly built-in report per unit; uploaded Excel and Word formats are filled', async () => {
    const hod = await as('hod');
    const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
    const weekly = await hod.get(`/reports/management?kind=weekly&period=${today}&unit=LIT`);
    expect(weekly.status).toBe(200);
    expect(weekly.body.title).toMatch(/Litigation weekly/);
    expect((await (await as('uh.drf')).get(`/reports/management?kind=weekly&period=${today}&unit=LIT`)).status).toBe(403);

    // Excel format with a scalar and a repeated row.
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('R');
    ws.addRow(['{{report.title}}', '{{report.period}}']);
    ws.addRow(['Hearings', '{{lit.counts.hearings}}']);
    ws.addRow(['#', 'Date', 'Case', 'Chit']);
    ws.addRow(['{{#}}', '{{lit.hearings.date}}', '{{lit.hearings.reference}}', '{{lit.hearings.chitSummary}}']);
    ws.addRow(['End of report']);
    const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
    expect((await (await as('lo.lit1')).upload('/reports/templates', { name: 'Not allowed', period: 'WEEKLY' }, { file: [{ name: 'f.xlsx', data: xlsx }] })).status).toBe(403);
    const t = await hod.upload('/reports/templates', { name: 'Weekly litigation', unit: 'LIT', period: 'WEEKLY' }, { file: [{ name: 'weekly.xlsx', data: xlsx }] });
    expect(t.status).toBe(201);
    // Generate for the week of the postponed/continued hearings created above (in about 3 weeks).
    const week = new Date(Date.now() + 5 * 3600_000 + 21 * 86400_000).toISOString().slice(0, 10);
    expect((await hod.get(`/reports/templates/${t.body.id}/generate?period=MONTHLY&ref=2026-11`)).status).toBe(400); // weekly-only format
    const g = await (await import('supertest')).default(app.getHttpServer()).get(`/api/reports/templates/${t.body.id}/generate?period=WEEKLY&ref=${week}`)
      .set('Cookie', [...hod.cookies].map(([k, v]) => `${k}=${v}`).join('; ')).set('Origin', 'http://localhost:3000').buffer(true).parse(binary as never);
    expect(g.status).toBe(200);
    const out = new ExcelJS.Workbook();
    await out.xlsx.load(g.body as ArrayBuffer);
    const rows = out.worksheets[0]!.getSheetValues().filter(Boolean).map((r) => (r as unknown[]).slice(1));
    expect(String(rows[0]![0])).toMatch(/Litigation weekly report/);
    expect(rows.some((r) => String(r[3] ?? '').includes('Parties to appear') || String(r[2] ?? '').startsWith('LGL-LIT'))).toBe(true);
    expect(String(rows[rows.length - 1]![0])).toBe('End of report');

    // Word format with a loop.
    const w = await hod.upload('/reports/templates', { name: 'Monthly drafting', unit: 'DRF', period: 'ANY' }, { file: [{ name: 'monthly.docx', data: docx(['{{report.title}} – {{report.period}}', 'Received: {{drf.counts.received}}', '{{#drf.received}}{{reference}} {{title}};{{/drf.received}}']) }] });
    expect(w.status).toBe(201);
    const month = today.slice(0, 7);
    const gw = await (await import('supertest')).default(app.getHttpServer()).get(`/api/reports/templates/${w.body.id}/generate?period=MONTHLY&ref=${month}`)
      .set('Cookie', [...hod.cookies].map(([k, v]) => `${k}=${v}`).join('; ')).set('Origin', 'http://localhost:3000').buffer(true).parse(binary as never);
    expect(gw.status).toBe(200);
    const text = docxText(gw.body as Buffer);
    expect(text).toMatch(/Drafting monthly report/);
    expect(text).toMatch(/Shareholder agreement/);
    expect(text).not.toMatch(/\{\{/);

    // Management (aggregate-only) gets totals but never lists of matters.
    const mg = await as('mgmt');
    const data = (await mg.get(`/reports/data?period=MONTHLY&ref=${month}`)).body;
    expect(data.totals.opened).toBeGreaterThan(0);
    expect(data.drf.received).toEqual([]);
    expect((await hod.get('/reports/fields')).body.length).toBeGreaterThan(20);
    expect((await hod.get('/reports/sample-template?unit=CMP')).headers['content-type']).toContain('spreadsheetml');
  });
});
