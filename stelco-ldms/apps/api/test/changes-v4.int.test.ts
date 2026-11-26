import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, closeApp, db, getApp, userId } from './helpers';

const sys = <T>(q: Promise<T>) => db.$transaction([db.$executeRaw`SELECT set_config('app.ctx','system',true)`, q as never]).then((r) => r[1] as T);
const rtId = async (code: string) => (await db.requestType.findUniqueOrThrow({ where: { code } })).id;

describe('change request v4: assign/reassign at any stage, no-review path, complete task, research assignment', () => {
  beforeAll(async () => { await getApp(); });
  afterAll(closeApp);

  it('drafting: Unit Head can start an unassigned request, reassign later without changing the stage, skip review and complete', async () => {
    const uh = await as('uh.drf');
    const lo1 = await as('lo.drf1');
    const r = (await uh.post('/drafting/requests', { title: 'Advice on lease renewal', requestTypeId: await rtId('CONTRACT') })).body.id as string;
    // A lawyer cannot start a request nobody assigned; the Unit Head can (and becomes the drafter).
    expect((await lo1.post(`/drafting/requests/${r}/actions`, { action: 'start' })).status).toBe(403);
    expect((await uh.post(`/drafting/requests/${r}/actions`, { action: 'start' })).status).toBe(200);
    let g = await uh.get(`/drafting/requests/${r}`);
    expect(g.body.drafterName).toBeTruthy();
    expect(g.body.actions.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['assign', 'skip_review', 'complete']));
    // Reassign while in drafting: the stage stays "in drafting".
    const lo1Id = await userId('lo.drf1');
    expect((await uh.post(`/drafting/requests/${r}/actions`, { action: 'assign', assigneeId: lo1Id })).status).toBe(200);
    expect((await sys(db.matter.findUniqueOrThrow({ where: { id: r } }))).status).toBe('IN_DRAFTING');
    expect((await sys(db.draftingRequest.findUniqueOrThrow({ where: { matterId: r } }))).drafterId).toBe(lo1Id);
    // Only the Unit Head / HoD reassign.
    expect((await lo1.post(`/drafting/requests/${r}/actions`, { action: 'assign', assigneeId: await userId('lo.drf2') })).status).toBe(403);
    // No reviewer: the lawyer sends it straight for approval (reason required).
    expect((await lo1.post(`/drafting/requests/${r}/actions`, { action: 'skip_review' })).status).toBe(400);
    expect((await lo1.post(`/drafting/requests/${r}/actions`, { action: 'skip_review', comment: 'Short letter, no review needed' })).status).toBe(200);
    expect((await sys(db.matter.findUniqueOrThrow({ where: { id: r } }))).status).toBe('PENDING_APPROVAL');
    // Lawyers cannot complete; the Unit Head completes at this stage.
    expect((await lo1.post(`/drafting/requests/${r}/actions`, { action: 'complete', comment: 'x' })).status).toBe(403);
    expect((await uh.post(`/drafting/requests/${r}/actions`, { action: 'complete', comment: 'Advice given at the meeting' })).status).toBe(200);
    const m = await sys(db.matter.findUniqueOrThrow({ where: { id: r } }));
    expect(m.status).toBe('CLOSED');
    expect(m.closedAt).toBeTruthy();
    expect(await sys(db.slaClock.count({ where: { matterId: r, stoppedAt: null } }))).toBe(0);
    // Another unit cannot act on it.
    expect((await (await as('uh.lit')).post(`/drafting/requests/${r}/actions`, { action: 'complete', comment: 'x' })).status).toBe(404);
  });

  it('drafting: HoD can reassign a request that is under review; the review moves to the new reviewer', async () => {
    const hod = await as('hod');
    const r = (await hod.post('/drafting/requests', { title: 'NDA review reassignment', requestTypeId: await rtId('CONTRACT') })).body.id as string;
    await hod.post(`/drafting/requests/${r}/actions`, { action: 'assign', assigneeId: await userId('lo.drf1'), reviewerId: await userId('lo.drf2') });
    await sys(db.matter.update({ where: { id: r }, data: { status: 'SUBMITTED_FOR_REVIEW' } }));
    await sys(db.reviewRound.create({ data: { matterId: r, round: 1, reviewerId: await userId('lo.drf2') } }));
    const uhId = await userId('uh.drf');
    expect((await hod.post(`/drafting/requests/${r}/actions`, { action: 'assign', assigneeId: await userId('lo.drf1'), reviewerId: uhId })).status).toBe(200);
    expect((await sys(db.matter.findUniqueOrThrow({ where: { id: r } }))).status).toBe('SUBMITTED_FOR_REVIEW');
    expect((await sys(db.reviewRound.findFirstOrThrow({ where: { matterId: r } }))).reviewerId).toBe(uhId);
  });

  it('litigation: reassigning a case makes the new lawyer the responsible officer', async () => {
    const uh = await as('uh.lit');
    const c = (await uh.post('/litigation/cases', { title: 'Reassign test', caseType: 'CIVIL', ourRole: 'DEFENDANT', responsibleOfficerId: await userId('lo.lit1') })).body.id as string;
    await sys(db.matter.update({ where: { id: c }, data: { status: 'PENDING_HEARING' } }));
    const lo2 = await userId('lo.lit2');
    expect((await uh.post(`/matters/${c}/assign`, { assigneeIds: [lo2] })).status).toBeLessThan(300);
    expect((await sys(db.litigationCase.findUniqueOrThrow({ where: { matterId: c } }))).responsibleOfficerId).toBe(lo2);
    expect((await (await as('lo.lit1')).post(`/matters/${c}/assign`, { assigneeIds: [await userId('lo.lit1')] })).status).toBe(403);
  });

  it('compliance: Unit Head assigns research of a new law and reassigns it; lawyers cannot', async () => {
    const uh = await as('uh.cmp');
    const law = (await uh.post('/compliance/laws', { title: 'Electricity (Amendment) Regulation 2026', type: 'REGULATION' })).body.id as string;
    expect((await (await as('lo.cmp1')).post(`/compliance/laws/${law}/research`, { assigneeId: await userId('lo.cmp1') })).status).toBe(403);
    expect((await uh.post(`/compliance/laws/${law}/research`, { assigneeId: await userId('lo.cmp1') })).status).toBe(200);
    const uhId = await userId('uh.cmp');
    expect((await uh.post(`/compliance/laws/${law}/research`, { assigneeId: uhId })).status).toBe(200);
    expect((await sys(db.law.findUniqueOrThrow({ where: { id: law } }))).researchAssigneeId).toBe(uhId);
    expect((await uh.post(`/compliance/laws/${law}/research`, { assigneeId: await userId('lo.drf1') })).status).toBe(400);
  });
});
