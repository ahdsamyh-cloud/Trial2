import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, closeApp, db, getApp, PDF, userId } from './helpers';
import { nextPeriodStart, periodOf } from '../src/units/compliance/compliance.service';
import { ComplianceService } from '../src/units/compliance/compliance.service';
import { runAsSystem } from '../src/common/context';

describe('compliance', () => {
  let app: Awaited<ReturnType<typeof getApp>>;
  let fin: string, hr: string, lawId: string, obligationId: string;
  beforeAll(async () => {
    app = await getApp();
    fin = (await db.department.findUniqueOrThrow({ where: { code: 'FIN' } })).id;
    hr = (await db.department.findUniqueOrThrow({ where: { code: 'HR' } })).id;
  });
  afterAll(closeApp);

  it('period helpers', () => {
    const d = new Date('2026-11-15T10:00:00+05:00');
    expect(periodOf('MONTHLY', d)).toBe('2026-11');
    expect(periodOf('QUARTERLY', d)).toBe('2026-Q4');
    expect(periodOf('SEMI_ANNUAL', d)).toBe('2026-H2');
    expect(periodOf('ANNUAL', d)).toBe('2026');
    expect(nextPeriodStart('QUARTERLY', d)!.toISOString()).toBe('2027-01-01T03:00:00.000Z');
  });

  it('laws register with versions and obligations; officers notified', async () => {
    const lo = await as('lo.cmp1');
    const reg = await db.regulator.findFirstOrThrow();
    const l = await lo.post('/compliance/laws', { title: 'Public Finance Regulation 2026', type: 'REGULATION', regulatorId: reg.id, summary: 'Rules on procurement records and reporting.', officerId: await userId('lo.cmp1') });
    expect(l.status).toBe(201);
    lawId = l.body.id;
    const v = await lo.post(`/compliance/laws/${lawId}/versions`, { notes: 'Amendment no. 1: new reporting deadline', status: 'AMENDED' });
    expect(v.body.versionNo).toBe(2);
    expect((await lo.get('/compliance/changes')).body.find((c: { lawId: string }) => c.lawId === lawId).status).toBe('IDENTIFIED');
    const o = await lo.post('/compliance/obligations', { lawId, description: 'Submit quarterly procurement report to the regulator', article: 's.12', frequency: 'QUARTERLY', risk: 'HIGH', evidenceRequired: 'Copy of submitted report', departmentIds: [fin] });
    expect(o.status).toBe(201);
    obligationId = o.body.id;
    expect((await (await as('lo.lit1')).post('/compliance/obligations', { lawId, description: 'x x x', frequency: 'ANNUAL', risk: 'LOW', departmentIds: [fin] })).status).toBe(403);
  });

  it('dissemination: departments acknowledge; others cannot; reminders go out', async () => {
    const lo = await as('lo.cmp1');
    const d = await lo.post('/compliance/disseminations', { subject: 'New procurement reporting rule', body: 'From Q1 2027 reports are due within 15 days.', lawId, departmentIds: [fin, hr] });
    expect(d.status).toBe(201);
    const finUser = await as('req.fin');
    const list = await finUser.get('/compliance/disseminations');
    const mine = list.body.find((x: { id: string }) => x.id === d.body.id);
    expect(mine.recipients).toHaveLength(1); // only own department visible
    const hrRecipient = await db.disseminationRecipient.findFirstOrThrow({ where: { disseminationId: d.body.id, departmentId: hr } });
    expect((await finUser.post(`/compliance/acknowledgements/${hrRecipient.id}`)).status).toBe(404);
    expect((await finUser.post(`/compliance/acknowledgements/${mine.recipients[0].id}`)).status).toBe(200);
    const tracking = (await lo.get('/compliance/disseminations')).body.find((x: { id: string }) => x.id === d.body.id);
    expect(tracking.acknowledged).toBe(1);
    expect(tracking.total).toBe(2);
    await db.dissemination.update({ where: { id: d.body.id }, data: { dueAt: new Date(Date.now() - 1000) } });
    const r = await runAsSystem(() => app.get(ComplianceService).ackReminders());
    expect(r.reminded).toBeGreaterThanOrEqual(1);
  });

  it('periodic check: issue → department answers with evidence → review → finding → remediation → closed', async () => {
    const lo = await as('lo.cmp1');
    const run = await lo.post('/compliance/cycles/run');
    expect(run.body.items).toBeGreaterThanOrEqual(1);
    const again = await lo.post('/compliance/cycles/run');
    expect(again.body.items).toBe(0); // not due again until next quarter
    const ob = await db.obligation.findUniqueOrThrow({ where: { id: obligationId } });
    expect(ob.nextCheckAt!.getTime()).toBeGreaterThan(Date.now());

    const finUser = await as('req.fin');
    const cycles = await finUser.get('/compliance/cycles');
    let cycle: { id: string } | undefined;
    let detail: { body: { items: { id: string; obligationId: string }[] } } | undefined;
    for (const c of cycles.body.filter((x: { departmentId: string; status: string }) => x.departmentId === fin && x.status === 'ISSUED')) {
      const d = await finUser.get(`/compliance/cycles/${c.id}`);
      if (d.body.items.some((i: { obligationId: string }) => i.obligationId === obligationId)) { cycle = c; detail = d; }
    }
    expect(cycle).toBeTruthy();
    expect((await (await as('req.hr')).get(`/compliance/cycles/${cycle!.id}`)).status).toBe(404);
    const item = detail!.body.items.find((i) => i.obligationId === obligationId)!;
    expect((await finUser.post(`/compliance/cycles/${cycle!.id}/submit`)).status).toBe(400); // unanswered
    expect((await finUser.post(`/compliance/items/${item.id}/response`, { response: 'Q3 report submitted late on 20 Oct.' })).status).toBe(200);
    const ev = await finUser.upload('/documents', { ownerType: 'checkItem', ownerId: item.id }, { file: [{ name: 'q3-report.pdf', data: PDF }] });
    expect(ev.status).toBe(201);
    for (const other of detail!.body.items.filter((i) => i.id !== item.id)) await finUser.post(`/compliance/items/${other.id}/response`, { response: 'Done' });
    expect((await finUser.post(`/compliance/cycles/${cycle!.id}/submit`)).status).toBe(200);
    expect((await finUser.post(`/compliance/items/${item.id}/response`, { response: 'change after submit' })).status).toBe(409);

    expect((await finUser.post(`/compliance/items/${item.id}/rating`, { rating: 'COMPLIANT' })).status).toBe(403);
    const rated = await lo.post(`/compliance/items/${item.id}/rating`, { rating: 'NON_COMPLIANT', note: 'Submitted after the deadline' });
    expect(rated.body.findingId).toBeTruthy();
    const f = await db.finding.findUniqueOrThrow({ where: { id: rated.body.findingId } });
    expect(f.severity).toBe('HIGH');
    expect(Math.round((f.dueOn.getTime() - Date.now()) / 86400_000)).toBe(30);

    const fid = rated.body.findingId;
    expect((await finUser.post(`/compliance/findings/${fid}/step`, { to: 'ACTION_PLAN_AGREED' })).status).toBe(400);
    expect((await finUser.post(`/compliance/findings/${fid}/step`, { to: 'ACTION_PLAN_AGREED', actionPlan: 'Calendar reminder 5 days before each deadline' })).status).toBe(200);
    expect((await finUser.post(`/compliance/findings/${fid}/step`, { to: 'EVIDENCE_SUBMITTED' })).status).toBe(400);
    await finUser.upload('/documents', { ownerType: 'finding', ownerId: fid }, { file: [{ name: 'reminder-setup.pdf', data: PDF }] });
    expect((await finUser.post(`/compliance/findings/${fid}/step`, { to: 'EVIDENCE_SUBMITTED' })).status).toBe(200);
    expect((await finUser.post(`/compliance/findings/${fid}/step`, { to: 'CLOSED' })).status).toBe(403);
    const closed = await lo.post(`/compliance/findings/${fid}/step`, { to: 'CLOSED', note: 'Verified' });
    expect(closed.body.status).toBe('CLOSED');
    expect(closed.body.actions.length).toBe(3);
  });

  it('overdue findings escalate once to the Unit Head and HoD', async () => {
    const f = await db.finding.create({ data: { departmentId: fin, title: 'Overdue test finding', severity: 'LOW', dueOn: new Date(Date.now() - 86400_000) } });
    const r1 = await runAsSystem(() => app.get(ComplianceService).findingsOverdue());
    expect(r1.escalated).toBeGreaterThanOrEqual(1);
    const r2 = await runAsSystem(() => app.get(ComplianceService).findingsOverdue());
    expect(r2.escalated).toBe(0);
    expect((await db.finding.findUniqueOrThrow({ where: { id: f.id } })).escalatedAt).not.toBeNull();
  });

  it('licences register creates renewal calendar entries; dashboard heat map and score', async () => {
    const lo = await as('lo.cmp1');
    const lic = await lo.post('/compliance/licences', { name: 'Generation licence — Male power station', kind: 'LICENCE', number: 'URA-GEN-001', expiresOn: new Date(Date.now() + 100 * 86400_000).toISOString() });
    expect((await db.calendarEvent.findFirstOrThrow({ where: { sourceType: 'Licence', sourceId: lic.body.id } })).kind).toBe('LICENCE_EXPIRY');
    const dash = await (await as('uh.cmp')).get('/compliance/dashboard');
    expect(dash.status).toBe(200);
    expect(dash.body.heat.find((h: { departmentId: string; lawId: string }) => h.departmentId === fin && h.lawId === lawId).score).toBe(0);
    expect((await (await as('req.fin')).get('/compliance/dashboard')).status).toBe(403);
  });
});
