import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { as, Client, closeApp, db, getApp, PDF, userId } from './helpers';

async function sheet(rows: (string | number)[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('S');
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('awareness', () => {
  let app: Awaited<ReturnType<typeof getApp>>;
  let sessionId: string;
  let fin: string, hr: string;
  beforeAll(async () => {
    app = await getApp();
    fin = (await db.department.findUniqueOrThrow({ where: { code: 'FIN' } })).id;
    hr = (await db.department.findUniqueOrThrow({ where: { code: 'HR' } })).id;
  });
  afterAll(closeApp);

  it('imports the HR staff list with a dry run', async () => {
    const lo = await as('lo.awr1');
    const buf = await sheet([['Staff No', 'Name', 'Department'], ['S1001', 'Aminath Rasheeda', 'Finance'], ['S1002', 'Ibrahim Shareef', 'FIN'], ['S1003', 'Moosa Ali', 'Human Resources'], ['', 'No number', 'Finance'], ['S1004', 'Wrong Dept', 'Nowhere']]);
    const dry = await lo.upload('/awareness/employees/import', {}, { file: [{ name: 'staff.xlsx', data: buf }] });
    expect(dry.body).toMatchObject({ total: 5, valid: 3, committed: false });
    expect(await db.employee.count({ where: { staffNo: 'S1001' } })).toBe(0);
    const ok = await lo.upload('/awareness/employees/import?commit=true', {}, { file: [{ name: 'staff.xlsx', data: buf }] });
    expect(ok.body.committed).toBe(true);
    expect(await db.employee.count({ where: { staffNo: { in: ['S1001', 'S1002', 'S1003'] } } })).toBe(3);
  });

  it('plans and schedules a session with presenters; calendar + materials deadline', async () => {
    const lo = await as('lo.awr1');
    const item = await lo.post('/awareness/plan-items', { year: 2026, topic: 'Procurement law basics', targetDeptIds: [fin], quarter: 4 });
    expect(item.status).toBe(201);
    const start = new Date(Date.now() + 10 * 86400_000);
    const s = await lo.post('/awareness/sessions', { planItemId: item.body.id, title: 'Procurement law for Finance', topic: 'Procurement', format: 'IN_PERSON', startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 2 * 3600_000).toISOString(), venue: 'Board room', audienceDeptIds: [fin], presenterIds: [await userId('lo.awr1')], preparerIds: [] });
    expect(s.body.status).toBe('SCHEDULED');
    sessionId = s.body.id;
    expect(await db.calendarEvent.count({ where: { sourceId: sessionId } })).toBe(2);
    const detail = await lo.get(`/awareness/sessions/${sessionId}`);
    expect(new Date(detail.body.materialsDueAt).getTime()).toBeLessThan(start.getTime());
    expect((await lo.post(`/awareness/sessions/${sessionId}/status`, { status: 'MATERIALS_READY' })).status).toBe(400);
    await lo.upload('/documents', { ownerType: 'session', ownerId: sessionId, title: 'Slides' }, { file: [{ name: 'slides.pdf', data: PDF }] });
    expect((await lo.post(`/awareness/sessions/${sessionId}/status`, { status: 'MATERIALS_READY' })).status).toBe(200);
    expect((await lo.post(`/awareness/sessions/${sessionId}/status`, { status: 'PLANNED' })).status).toBe(409);
  });

  it('visibility: targeted departments only; non-staff cannot create sessions', async () => {
    expect((await (await as('req.fin')).get(`/awareness/sessions/${sessionId}`)).status).toBe(200);
    expect((await (await as('req.hr')).get(`/awareness/sessions/${sessionId}`)).status).toBe(404);
    expect((await (await as('req.hr')).get('/awareness/sessions')).body.find((x: { id: string }) => x.id === sessionId)).toBeUndefined();
    expect((await (await as('lo.lit1')).post('/awareness/sessions', { title: 'x x x', topic: 'x x', format: 'ONLINE', startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 3600_000).toISOString() })).status).toBe(403);
  });

  it('QR self check-in by staff number (no account), feedback with quiz, closing the link', async () => {
    const lo = await as('lo.awr1');
    await db.awarenessSession.update({ where: { id: sessionId }, data: { startsAt: new Date(Date.now() - 600_000), endsAt: new Date(Date.now() + 3600_000) } });
    await lo.post(`/awareness/sessions/${sessionId}/quiz`, { questions: [{ question: 'Who approves contracts above the threshold?', options: ['Finance', 'Tender board', 'Anyone'], answer: 1 }] });
    const link = await lo.post(`/awareness/sessions/${sessionId}/checkin-link`);
    expect(link.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    const token = link.body.url.split('/checkin/')[1];
    const anon = new Client(app);
    const info = await anon.get(`/awareness/public/checkin/${token}`);
    expect(info.body.title).toBe('Procurement law for Finance');
    expect(info.body.quiz[0].answer).toBeUndefined(); // answers never sent to the browser
    expect((await anon.post(`/awareness/public/checkin/${token}`, { staffNo: 'NOPE-1' })).status).toBe(400);
    const ok = await anon.post(`/awareness/public/checkin/${token}`, { staffNo: 'S1001' });
    expect(ok.body).toEqual({ ok: true, name: 'Aminath' });
    await anon.post(`/awareness/public/checkin/${token}`, { staffNo: 'S1001' }); // idempotent
    expect(await db.attendance.count({ where: { sessionId } })).toBe(1);
    const fb = await anon.post(`/awareness/public/feedback/${token}`, { rating: 5, comments: 'Very useful', answers: { [info.body.quiz[0].id]: 1 } });
    expect(fb.body.quizScore).toBe(100);
    expect((await anon.get(`/awareness/public/checkin/${token}.tampered`)).status).toBe(404);
    await lo.post(`/awareness/sessions/${sessionId}/checkin-close`);
    expect((await anon.post(`/awareness/public/checkin/${token}`, { staffNo: 'S1002' })).status).toBe(404);
  });

  it('attendance from Excel and manual; training history; annual report', async () => {
    const lo = await as('lo.awr1');
    const imp = await lo.upload(`/awareness/sessions/${sessionId}/attendance/import`, {}, { file: [{ name: 'att.xlsx', data: await sheet([['Staff number', 'Name'], ['S1002', 'x'], ['S9999', 'unknown']]) }] });
    expect(imp.body).toEqual({ added: 1, unknown: ['S9999'] });
    const e3 = await db.employee.findUniqueOrThrow({ where: { staffNo: 'S1003' } });
    expect((await lo.post(`/awareness/sessions/${sessionId}/attendance`, { employeeIds: [e3.id] })).body.added).toBe(1);
    await lo.post(`/awareness/sessions/${sessionId}/status`, { status: 'HELD' });
    const h = await lo.get(`/awareness/employees/${e3.id}/history`);
    expect(h.body.attendance[0].session.id).toBe(sessionId);
    const r = await lo.get(`/awareness/reports/${new Date().getFullYear()}`);
    expect(r.body.held).toBeGreaterThanOrEqual(1);
    expect(r.body.averageFeedback).toBe(5);
    expect(r.body.coverage.find((c: { department: string }) => c.department === 'Finance').reached).toBe(2);
    expect(r.body.presenters[0].sessions).toBeGreaterThanOrEqual(1);
    void hr;
  });

  it('bulletins reach the targeted departments; FAQ is readable by everyone', async () => {
    const lo = await as('lo.awr1');
    const b = await lo.post('/awareness/bulletins', { title: 'New Contracts Act in force', body: 'Key changes…', kind: 'NEWSLETTER', audienceDeptIds: [fin] });
    expect((await (await as('req.fin')).get('/awareness/bulletins')).body.find((x: { id: string }) => x.id === b.body.id)).toBeUndefined(); // not published yet
    await lo.post(`/awareness/bulletins/${b.body.id}/publish`);
    expect((await (await as('req.fin')).get('/awareness/bulletins')).body.find((x: { id: string }) => x.id === b.body.id)).toBeTruthy();
    expect((await (await as('req.hr')).get('/awareness/bulletins')).body.find((x: { id: string }) => x.id === b.body.id)).toBeUndefined();
    await lo.post('/awareness/faq', { question: 'Who signs NDAs?', answer: 'The MD or a holder of a valid PoA.', tags: ['nda'] });
    expect((await (await as('req.hr')).get('/awareness/faq?q=NDA')).body.length).toBeGreaterThanOrEqual(1);
  });
});
