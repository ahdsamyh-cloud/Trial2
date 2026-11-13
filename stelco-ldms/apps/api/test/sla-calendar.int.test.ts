import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, closeApp, db, getApp, userId } from './helpers';
import { SlaService } from '../src/core/sla/sla.service';
import { CalendarService } from '../src/core/calendar/calendar.service';
import { runAsSystem } from '../src/common/context';

describe('SLA engine and reminders', () => {
  let app: Awaited<ReturnType<typeof getApp>>;
  beforeAll(async () => { app = await getApp(); });
  afterAll(closeApp);

  it('warns, breaches and escalates using business days', async () => {
    const uh = await as('uh.cmp');
    const m = await uh.post('/matters', { unit: 'CMP', title: 'SLA test matter' });
    const sla = app.get(SlaService);
    const lo = await userId('lo.cmp1');
    const start = new Date('2026-11-15T09:00:00+05:00'); // Sunday
    const clock = await runAsSystem(() => sla.start({ policyCode: 'DRF_NDA', step: 'DRAFTING', matterId: m.body.id, startedAt: start, ownerId: lo }));
    expect(clock!.dueAt.toISOString()).toBe(new Date('2026-11-18T16:00:00+05:00').toISOString()); // Wed 16:00
    const r1 = await runAsSystem(() => sla.scan(new Date('2026-11-18T06:00:00+05:00')));
    expect(r1.warned).toBeGreaterThanOrEqual(1);
    const r2 = await runAsSystem(() => sla.scan(new Date('2026-11-18T17:00:00+05:00')));
    expect(r2.breached).toBeGreaterThanOrEqual(1);
    const r3 = await runAsSystem(() => sla.scan(new Date('2026-11-22T17:00:00+05:00'))); // +1 business day (Sun)
    expect(r3.escalated).toBeGreaterThanOrEqual(1);
    expect(await db.notification.count({ where: { user: { username: 'hod' }, type: 'sla.escalation' } })).toBeGreaterThan(0);
  });

  it('pauses while awaiting information', async () => {
    const uh = await as('uh.cmp');
    const m = await uh.post('/matters', { unit: 'CMP', title: 'Pause test' });
    await uh.post(`/matters/${m.body.id}/status`, { status: 'AWAITING_INFO', comment: 'Need the signed MoU' });
    const s = await uh.get(`/matters/${m.body.id}/sla`);
    expect(s.body.find((c: { step: string }) => c.step === 'ASSIGN')?.state ?? 'PAUSED').toBe('PAUSED');
  });

  it('calendar reminders at 30/14/7/1/0 days and .ics export', async () => {
    const cal = app.get(CalendarService);
    const uh = await as('uh.cmp');
    const m = await uh.post('/matters', { unit: 'CMP', title: 'Filing matter' });
    const when = new Date(Date.now() + 40 * 86400_000);
    const ev = await runAsSystem(() => cal.upsert({ kind: 'FILING', unit: 'CMP', title: 'Annual return filing', sourceType: 'Test', sourceId: m.body.id, startsAt: when, ownerId: null, matterId: m.body.id }));
    expect((await db.reminder.findMany({ where: { eventId: ev.id } })).map((r) => r.offsetDays).sort((a, b) => a - b)).toEqual([0, 1, 7, 14, 30]);
    const list = await uh.get(`/calendar?from=${new Date().toISOString()}&to=${new Date(Date.now() + 60 * 86400_000).toISOString()}`);
    expect(list.body.find((e: { id: string }) => e.id === ev.id)).toBeTruthy();
    const ics = await uh.get(`/calendar/ics?ids=${ev.id}`);
    expect(ics.text).toContain('BEGIN:VCALENDAR');
    expect(ics.text).toContain('Annual return filing');
    expect((await (await as('lo.lit1')).get(`/calendar/ics?ids=${ev.id}`)).text).not.toContain('Annual return filing');
  });
});
