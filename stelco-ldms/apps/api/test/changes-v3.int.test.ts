import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import PizZip from 'pizzip';
import { as, closeApp, db, getApp, PDF, userId } from './helpers';
import { runAsSystem } from '../src/common/context';
import { LitigationService } from '../src/units/litigation/litigation.service';
import { ReportTemplatesService } from '../src/core/reports/report-templates.service';

const sys = <T>(q: Promise<T>) => db.$transaction([db.$executeRaw`SELECT set_config('app.ctx','system',true)`, q as never]).then((r) => r[1] as T);
/** Maldives local time (UTC+5) -> Date. */
const mvt = (iso: string) => new Date(Date.parse(`${iso}+05:00`));
const notes = (user: string, type: string, after: Date) => userId(user).then((uid) => sys(db.notification.findMany({ where: { userId: uid, type, createdAt: { gte: after } } })));

function docx(paragraphs: string[]) {
  const zip = new PizZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
  return zip.generate({ type: 'nodebuffer' });
}

describe('change request v3: hearing reminders, appeal deadlines, auto reports, workload, library, Dhivehi wording', () => {
  let app: Awaited<ReturnType<typeof getApp>>;
  beforeAll(async () => { app = await getApp(); });
  afterAll(closeApp);

  it('hearing reminders: on the working day before (Thursday covers Sunday), once; morning digest per person; restricted cases only to named people', async () => {
    const uh = await as('uh.lit');
    const lo1 = await userId('lo.lit1');
    const c = (await uh.post('/litigation/cases', { title: 'Reminder test case', caseType: 'CIVIL', ourRole: 'DEFENDANT', responsibleOfficerId: lo1 })).body.id as string;
    // Wed 10 Feb 2027 15:00 -> Thursday's hearing. Thu 11 Feb 15:00 -> Sunday 14 Feb's hearing (Fri/Sat are not working days).
    const thu = (await uh.post(`/litigation/cases/${c}/hearings`, { startsAt: mvt('2027-02-11T09:00:00').toISOString(), purpose: 'Mention' })).body.id as string;
    const sun = (await uh.post(`/litigation/cases/${c}/hearings`, { startsAt: mvt('2027-02-14T10:00:00').toISOString(), purpose: 'Evidence' })).body.id as string;
    const svc = app.get(LitigationService);
    const t0 = new Date();
    await runAsSystem(() => svc.hearingReminders(mvt('2027-02-10T15:00:00')));
    let got = await notes('lo.lit1', 'lit.hearing-reminder', t0);
    expect(got.filter((n) => n.matterId === c)).toHaveLength(1);
    expect(got.find((n) => n.matterId === c)!.body).toContain('Purpose: Mention');
    expect((await notes('uh.lit', 'lit.hearing-reminder', t0)).filter((n) => n.matterId === c)).toHaveLength(1);
    await runAsSystem(() => svc.hearingReminders(mvt('2027-02-10T15:00:00'))); // again: nothing new
    expect((await notes('lo.lit1', 'lit.hearing-reminder', t0)).filter((n) => n.matterId === c)).toHaveLength(1);
    await runAsSystem(() => svc.hearingReminders(mvt('2027-02-11T15:00:00')));
    got = await notes('lo.lit1', 'lit.hearing-reminder', t0);
    expect(got.filter((n) => n.matterId === c)).toHaveLength(2);
    expect((await sys(db.hearing.findMany({ where: { id: { in: [thu, sun] } } }))).every((h) => h.reminderSentAt)).toBe(true);
    // Friday (not a working day): nothing is sent.
    expect(await runAsSystem(() => svc.hearingReminders(mvt('2027-02-12T15:00:00')))).toEqual({ sent: 0 });

    // Morning digest on Thursday: one message per person listing today's hearings; HoD included by default.
    const t1 = new Date();
    await runAsSystem(() => svc.hearingDigest(mvt('2027-02-11T07:30:00')));
    const dig = await notes('lo.lit1', 'lit.hearing-digest', t1);
    expect(dig).toHaveLength(1);
    expect(dig[0]!.body).toContain('Reminder test case');
    expect(await notes('hod', 'lit.hearing-digest', t1)).toHaveLength(1);
    expect(await notes('lo.drf1', 'lit.hearing-digest', t1)).toHaveLength(0);

    // Restricted case: the unit head is not named -> gets nothing; the named officer does, without the title in the line.
    const hod = await as('hod');
    const r = (await hod.post('/litigation/cases', { title: 'Secret reminder case', caseType: 'CIVIL', ourRole: 'DEFENDANT', responsibleOfficerId: lo1 })).body.id as string;
    expect((await hod.post(`/matters/${r}/restrict`, { restricted: true, userIds: [lo1] })).status).toBeLessThan(300);
    await hod.post(`/litigation/cases/${r}/hearings`, { startsAt: mvt('2027-02-18T09:00:00').toISOString() });
    const t2 = new Date();
    await runAsSystem(() => svc.hearingReminders(mvt('2027-02-17T15:00:00')));
    expect((await notes('uh.lit', 'lit.hearing-reminder', t2)).filter((n) => n.matterId === r)).toHaveLength(0);
    const named = (await notes('lo.lit1', 'lit.hearing-reminder', t2)).filter((n) => n.matterId === r);
    expect(named).toHaveLength(1);
    expect(named[0]!.body).not.toContain('Secret reminder case');
  });

  it('judgment: appeal deadline from the court default (calendar or business days), closes when decided; comply-by deadline', async () => {
    const uh = await as('uh.lit');
    const court = await sys(db.court.create({ data: { name: `Appeal Test Court ${Date.now()}`, appealDays: 10, appealDayKind: 'CALENDAR' } }));
    const c = (await uh.post('/litigation/cases', { title: 'Appeal test case', caseType: 'CIVIL', ourRole: 'DEFENDANT', courtId: court.id, responsibleOfficerId: await userId('lo.lit1') })).body.id as string; // owner -> exercises the staff check inside the transaction
    const o = await uh.post(`/litigation/cases/${c}/outcomes`, { kind: 'JUDGMENT', decidedOn: '2027-03-01T00:00:00.000Z', direction: 'PAYABLE', amount: '5000', complyBy: '2027-04-01T00:00:00.000Z' });
    expect(o.status).toBe(201);
    let dl = await sys(db.caseDeadline.findMany({ where: { caseId: c } }));
    const appeal = dl.find((d) => d.type === 'APPEAL')!;
    expect(appeal.dueAt.toISOString().slice(0, 10)).toBe('2027-03-11');
    expect(appeal.status).toBe('OPEN');
    expect(dl.find((d) => d.title.startsWith('Comply with judgment'))!.dueAt.toISOString().slice(0, 10)).toBe('2027-04-01');
    expect(await sys(db.calendarEvent.count({ where: { sourceType: 'CaseDeadline', sourceId: appeal.id, cancelled: false } }))).toBe(1);
    // Period counted in business days from the date the judgment was received.
    expect((await uh.patch(`/litigation/outcomes/${o.body.id}`, { appealDays: 5, appealDayKind: 'BUSINESS', appealFrom: '2027-03-04T05:00:00.000Z' })).status).toBe(200); // Thu
    dl = await sys(db.caseDeadline.findMany({ where: { caseId: c, type: 'APPEAL' } }));
    expect(dl).toHaveLength(1);
    expect(dl[0]!.dueAt > new Date('2027-03-10T00:00:00Z')).toBe(true); // Thu + 5 working days (Sun–Thu) = following Thursday
    // Decision: no appeal -> the deadline is closed; paid -> comply-by closed.
    await uh.patch(`/litigation/outcomes/${o.body.id}`, { appealDecision: 'NO_APPEAL', paymentStatus: 'PAID' });
    dl = await sys(db.caseDeadline.findMany({ where: { caseId: c } }));
    expect(dl.every((d) => d.status === 'DONE')).toBe(true);
    // Other units cannot touch it.
    expect((await (await as('lo.drf1')).patch(`/litigation/outcomes/${o.body.id}`, { appealDays: 3 })).status).toBe(404);
    expect((await uh.patch(`/litigation/outcomes/${o.body.id}`, { appealDays: 0 })).status).toBe(400);
  });

  it('reports: weekly format sent automatically on Sunday (link, once); recipients must be legal staff/management', async () => {
    const hod = await as('hod');
    const hodId = await userId('hod');
    const bad = await hod.upload('/reports/templates', { name: 'Auto weekly (bad)', period: 'WEEKLY', autoSend: 'true', recipientIds: await userId('req.fin') }, { file: [{ name: 'w.docx', data: docx(['{{report.period}}']) }] });
    expect(bad.status).toBe(400);
    const any = await hod.upload('/reports/templates', { name: 'Auto any (bad)', period: 'ANY', autoSend: 'true', recipientIds: hodId }, { file: [{ name: 'w.docx', data: docx(['{{report.period}}']) }] });
    expect(any.status).toBe(400);
    const t = await hod.upload('/reports/templates', { name: 'Auto weekly', period: 'WEEKLY', autoSend: 'true', recipientIds: hodId }, { file: [{ name: 'w.docx', data: docx(['{{report.period}}']) }] });
    expect(t.status).toBe(201);
    const svc = app.get(ReportTemplatesService);
    const t0 = new Date();
    expect((await runAsSystem(() => svc.autoSend(mvt('2027-02-16T08:00:00')))).sent).toBe(0); // Tuesday: nothing
    await runAsSystem(() => svc.autoSend(mvt('2027-02-14T08:00:00'))); // Sunday
    const n = (await notes('hod', 'report.auto', t0)).filter((x) => x.link?.includes(t.body.id));
    expect(n).toHaveLength(1);
    expect(n[0]!.link).toContain('period=WEEKLY&ref=2027-02-13');
    await runAsSystem(() => svc.autoSend(mvt('2027-02-14T08:00:00')));
    expect((await notes('hod', 'report.auto', t0)).filter((x) => x.link?.includes(t.body.id))).toHaveLength(1);
    // The link generates the report under the user's own access.
    const g = await hod.get(`/reports/templates/${t.body.id}/generate?period=WEEKLY&ref=2027-02-13`);
    expect(g.status).toBe(200);
    await hod.upload(`/reports/templates/${t.body.id}`, { active: 'false' }, {});
  });

  it('workload: HoD sees all legal staff, a unit head only their unit, officers not at all', async () => {
    const all = await (await as('hod')).get('/dashboard/workload');
    expect(all.status).toBe(200);
    const names = all.body.people.map((p: { username: string }) => p.username);
    expect(names).toEqual(expect.arrayContaining(['lo.lit1', 'lo.drf1', 'lo.cmp1']));
    const lit = await (await as('uh.lit')).get('/dashboard/workload');
    expect(lit.status).toBe(200);
    const litNames = lit.body.people.map((p: { username: string }) => p.username);
    expect(litNames).toContain('lo.lit1');
    expect(litNames).not.toContain('lo.drf1');
    const me = lit.body.people.find((p: { username: string }) => p.username === 'lo.lit1');
    expect(me).toMatchObject({ open: expect.any(Number), hearings7d: expect.any(Number), overdue: expect.any(Number) });
    expect((await (await as('uh.drf')).get('/dashboard/workload?unit=LIT')).status).toBe(403);
    expect((await (await as('lo.lit1')).get('/dashboard/workload')).status).toBe(403);
    expect((await (await as('req.fin')).get('/dashboard/workload')).status).toBe(403);
  });

  it('library: approval by Drafting UH/HoD only; an officer edit of an approved template returns it to draft with the old version kept; use in a request', async () => {
    const lo = await as('lo.drf1');
    const uh = await as('uh.drf');
    const name = `NDA template ${Date.now()}`;
    expect((await lo.post('/drafting/templates', { name, kind: 'CONTRACT', category: 'Confidentiality', body: 'Clause 1 v1', status: 'APPROVED' })).status).toBe(403);
    const tpl = await lo.post('/drafting/templates', { name, kind: 'CONTRACT', category: 'Confidentiality', body: 'Clause 1 v1', guidance: 'Use for vendors' });
    expect(tpl.status).toBe(201);
    expect(tpl.body).toMatchObject({ status: 'DRAFT', version: 1 });
    const ok = await uh.patch(`/drafting/templates/${tpl.body.id}`, { name, kind: 'CONTRACT', category: 'Confidentiality', body: 'Clause 1 v1', guidance: 'Use for vendors', status: 'APPROVED' });
    expect(ok.body).toMatchObject({ status: 'APPROVED', version: 1 });
    expect(ok.body.approvedById).toBe(await userId('uh.drf'));
    // File of the template.
    expect((await lo.upload('/documents', { ownerType: 'template', ownerId: tpl.body.id, title: 'NDA (Word)' }, { file: [{ name: 'nda.pdf', data: PDF }] })).status).toBe(201);
    // Officer edits the wording: back to DRAFT, version 2, v1 kept.
    const ed = await lo.patch(`/drafting/templates/${tpl.body.id}`, { name, kind: 'CONTRACT', category: 'Confidentiality', body: 'Clause 1 v2', note: 'Updated liability cap' });
    expect(ed.body).toMatchObject({ status: 'DRAFT', version: 2, approvedById: null });
    const vers = await lo.get(`/drafting/templates/${tpl.body.id}/versions`);
    expect(vers.body).toHaveLength(1);
    expect(vers.body[0]).toMatchObject({ version: 1, note: 'Updated liability cap', snapshot: { body: 'Clause 1 v1', status: 'APPROVED' } });
    // Draft templates cannot be used; approved can, the file is copied into the request.
    const reqId = (await uh.post('/drafting/requests', { title: 'NDA for vendor', requestTypeId: (await db.requestType.findUniqueOrThrow({ where: { code: 'CONTRACT' } })).id })).body.id as string;
    expect(reqId).toBeTruthy();
    expect((await lo.post(`/drafting/requests/${reqId}/from-template`, { templateId: tpl.body.id })).status).toBe(400);
    await uh.patch(`/drafting/templates/${tpl.body.id}`, { name, kind: 'CONTRACT', category: 'Confidentiality', body: 'Clause 1 v2', status: 'APPROVED' });
    const use = await uh.post(`/drafting/requests/${reqId}/from-template`, { templateId: tpl.body.id });
    expect(use.status).toBe(201);
    expect(use.body.copied).toBe(1);
    const docs = (await uh.get(`/documents?ownerType=matter&ownerId=${reqId}`)).body as { title: string }[];
    expect(docs.some((d) => d.title.includes(`${name} (template v2)`))).toBe(true);
    // Other units: no access to the library.
    expect((await (await as('lo.lit1')).get(`/drafting/templates/${tpl.body.id}/versions`)).status).toBe(403);
    // Clauses: versions kept too.
    const cl = await lo.post('/drafting/clauses', { title: 'Governing law', category: 'Boilerplate', body: 'Laws of the Maldives.', tags: ['boilerplate'] });
    await lo.patch(`/drafting/clauses/${cl.body.id}`, { title: 'Governing law', category: 'Boilerplate', body: 'The laws of the Republic of Maldives.', tags: ['boilerplate'] });
    expect((await lo.get(`/drafting/clauses/${cl.body.id}/versions`)).body[0].snapshot.body).toBe('Laws of the Maldives.');
  });

  it('Dhivehi wording: everyone reads it; only HoD / IT admin change it', async () => {
    expect((await (await as('lo.lit1')).put('/config/i18n/dv', { translations: { Save: 'x' } })).status).toBe(403);
    const hod = await as('hod');
    expect((await hod.put('/config/i18n/dv', { translations: { Save: 'ސޭވް', Cancel: '  ' } })).body).toEqual({ saved: 1 });
    expect((await (await as('req.fin')).get('/config/i18n/dv')).body).toEqual({ Save: 'ސޭވް' });
    await hod.put('/config/i18n/dv', { translations: {} });
  });
});
