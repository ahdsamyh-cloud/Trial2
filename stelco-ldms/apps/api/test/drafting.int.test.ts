import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, Client, closeApp, db, getApp, PDF, userId } from './helpers';

async function rtId(code: string) {
  return (await db.requestType.findUniqueOrThrow({ where: { code } })).id;
}
async function upload(c: Client, matterId: string, stage: string, documentId?: string) {
  const r = await c.upload('/documents', { ownerType: 'matter', ownerId: matterId, stageLabel: stage, ...(documentId ? { documentId } : {}) }, { file: [{ name: `${stage.toLowerCase()}.pdf`, data: PDF }] });
  expect(r.status).toBe(201);
  return r.body.documentId as string;
}
const act = (c: Client, id: string, action: string, extra: object = {}) => c.post(`/drafting/requests/${id}/actions`, { action, ...extra });

describe('drafting workflow (maker-checker)', () => {
  beforeAll(async () => { await getApp(); });
  afterAll(closeApp);

  it('runs the full happy path with review round-trip and Unit Head approval', async () => {
    const uh = await as('uh.drf');
    const drafter = await as('lo.drf1');
    const reviewer = await as('lo.drf2');
    const req = await as('req.proc');
    const proc = await db.department.findUniqueOrThrow({ where: { code: 'PROC' } });
    const c = await uh.post('/drafting/requests', { title: 'Service agreement for meter reading', requestTypeId: await rtId('CONTRACT'), requestingDeptId: proc.id, counterparty: 'MeterCo', contractValue: '200000' });
    expect(c.status).toBe(201);
    const id = c.body.id;
    await db.$transaction([db.$executeRaw`SELECT set_config('app.ctx','system',true)`, db.matter.update({ where: { id }, data: { requesterId: await userId('req.proc') } })]);

    expect((await act(drafter, id, 'assign', { assigneeId: await userId('lo.drf1') })).status).toBe(403);
    expect((await act(uh, id, 'assign', { assigneeId: await userId('lo.drf1'), reviewerId: await userId('lo.drf1') })).status).toBe(400);
    expect((await act(uh, id, 'assign', { assigneeId: await userId('lo.drf1'), reviewerId: await userId('lo.drf2') })).body.drafterId).toBe(await userId('lo.drf1'));
    expect(await db.slaClock.count({ where: { matterId: id, step: 'DRAFTING' } })).toBe(1);

    expect((await act(reviewer, id, 'start')).status).toBe(403);
    expect((await act(drafter, id, 'start')).status).toBe(200);
    expect((await act(drafter, id, 'submit_review')).status).toBe(400); // no draft uploaded
    const docId = await upload(drafter, id, 'DRAFT');
    expect((await act(drafter, id, 'submit_review')).status).toBe(200);
    expect((await act(drafter, id, 'mark_reviewed')).status).toBe(403); // maker cannot check
    expect((await act(reviewer, id, 'return_correction')).status).toBe(400); // comment required
    expect((await act(reviewer, id, 'return_correction', { comment: 'Clause 7 indemnity too broad' })).status).toBe(200);
    expect((await act(drafter, id, 'start')).status).toBe(200);
    await upload(drafter, id, 'DRAFT', docId);
    await act(drafter, id, 'submit_review');
    expect((await act(reviewer, id, 'mark_reviewed', { comment: 'OK' })).status).toBe(200);
    const sent = await act(reviewer, id, 'send_for_approval');
    expect(sent.body.approvalLevel).toBe('UNIT_HEAD');
    expect((await db.matter.findFirst({ where: { id } }))?.status).toBe('PENDING_APPROVAL');
    expect((await act(reviewer, id, 'approve')).status).toBe(403); // checker cannot approve
    expect((await act(uh, id, 'approve')).status).toBe(400); // no FINAL version
    await upload(drafter, id, 'FINAL', docId);
    const ap = await act(uh, id, 'approve');
    expect(ap.status).toBe(200);
    expect(ap.body.approvals.at(-1).decision).toBe('APPROVED');
    expect(ap.body.reviews.map((r: { decision: string }) => r.decision)).toEqual(['RETURNED', 'REVIEWED']);
    expect((await act(drafter, id, 'send')).status).toBe(200);
    // requester sees status and the final (shared) document only
    const portal = await req.get(`/matters/${id}`);
    expect(portal.body.status).toBe('SENT_TO_REQUESTER');
    const docs = await req.get(`/documents?ownerType=matter&ownerId=${id}`);
    expect(docs.body).toHaveLength(1);
    expect((await act(drafter, id, 'close')).status).toBe(200);
    const hist = await db.statusTransition.findMany({ where: { matterId: id }, orderBy: { at: 'asc' } });
    expect(hist.map((h) => h.toStatus)).toContain('RETURNED_FOR_CORRECTION');
    expect(await db.slaClock.count({ where: { matterId: id, stoppedAt: null } })).toBe(0);
  });

  it('routes to the HoD automatically when the Unit Head is the maker', async () => {
    const uh = await as('uh.drf');
    const hod = await as('hod');
    const id = (await uh.post('/drafting/requests', { title: 'NDA with bidder', requestTypeId: await rtId('NDA') })).body.id;
    await act(uh, id, 'assign', { assigneeId: await userId('uh.drf'), reviewerId: await userId('lo.drf2') });
    await act(uh, id, 'start');
    await upload(uh, id, 'FINAL');
    await act(uh, id, 'submit_review');
    const rv = await as('lo.drf2');
    await act(rv, id, 'mark_reviewed');
    const s = await act(rv, id, 'send_for_approval');
    expect(s.body.approvalLevel).toBe('HOD');
    expect((await db.matter.findFirst({ where: { id } }))?.status).toBe('PENDING_HOD_APPROVAL');
    expect((await act(uh, id, 'approve')).status).toBe(409); // not the right state for UH approval action
    expect((await act(uh, id, 'hod_approve')).status).toBe(403);
    expect((await act(hod, id, 'hod_approve')).status).toBe(200);
  });

  it('Unit Head escalates to the HoD with a reason; HoD can return it', async () => {
    const uh = await as('uh.drf');
    const id = (await uh.post('/drafting/requests', { title: 'Legal opinion on tariff change', requestTypeId: await rtId('OPINION') })).body.id;
    await act(uh, id, 'assign', { assigneeId: await userId('lo.drf1'), reviewerId: await userId('lo.drf2') });
    const d = await as('lo.drf1');
    await act(d, id, 'start');
    await upload(d, id, 'DRAFT');
    await act(d, id, 'submit_review');
    const r = await as('lo.drf2');
    await act(r, id, 'mark_reviewed');
    await act(r, id, 'send_for_approval');
    expect((await act(uh, id, 'escalate_hod')).status).toBe(400);
    expect((await act(uh, id, 'escalate_hod', { comment: 'Policy-level question' })).status).toBe(200);
    const back = await act(await as('hod'), id, 'return_from_approval', { comment: 'Add regulator view' });
    expect(back.status).toBe(200);
    expect((await db.matter.findFirst({ where: { id } }))?.status).toBe('RETURNED_FOR_CORRECTION');
  });

  it('optional rule sends high-value contracts straight to the HoD', async () => {
    const admin = await as('hod');
    await admin.put('/config/settings/drafting.hodRules', { value: { enabled: true, minContractValue: 1000000, restricted: false, requestTypeCodes: [] } });
    const uh = await as('uh.drf');
    const id = (await uh.post('/drafting/requests', { title: 'Fuel supply agreement', requestTypeId: await rtId('CONTRACT'), contractValue: '5000000' })).body.id;
    await act(uh, id, 'assign', { assigneeId: await userId('lo.drf1'), reviewerId: await userId('lo.drf2') });
    const d = await as('lo.drf1');
    await act(d, id, 'start');
    await upload(d, id, 'DRAFT');
    await act(d, id, 'submit_review');
    const r = await as('lo.drf2');
    await act(r, id, 'mark_reviewed');
    const s = await act(r, id, 'send_for_approval');
    expect(s.body.escalationReason).toMatch(/Contract value/);
    await admin.put('/config/settings/drafting.hodRules', { value: { enabled: false, minContractValue: null, restricted: false, requestTypeCodes: [] } });
  });

  it('awaiting information pauses the SLA; cancel needs a reason; illegal steps are refused', async () => {
    const uh = await as('uh.drf');
    const id = (await uh.post('/drafting/requests', { title: 'Reply letter to contractor', requestTypeId: await rtId('LETTER') })).body.id;
    await act(uh, id, 'assign', { assigneeId: await userId('lo.drf1'), reviewerId: await userId('lo.drf2') });
    const d = await as('lo.drf1');
    expect((await act(d, id, 'approve')).status).toBe(409);
    await act(d, id, 'start');
    expect((await act(d, id, 'request_info', { comment: 'Need the original contract' })).status).toBe(200);
    const sla = await uh.get(`/matters/${id}/sla`);
    expect(sla.body.find((c: { step: string }) => c.step === 'DRAFTING').state).toBe('PAUSED');
    await act(d, id, 'info_received');
    expect((await uh.get(`/matters/${id}/sla`)).body.find((c: { step: string }) => c.step === 'DRAFTING').state).not.toBe('PAUSED');
    expect((await act(uh, id, 'cancel')).status).toBe(400);
    expect((await act(uh, id, 'cancel', { comment: 'Withdrawn by requester' })).status).toBe(200);
    expect((await act(uh, id, 'start')).status).toBe(409);
  });

  it('IDOR: litigation staff and other departments cannot see drafting requests', async () => {
    const uh = await as('uh.drf');
    const id = (await uh.post('/drafting/requests', { title: 'Confidential MoU', requestTypeId: await rtId('MOU'), restricted: true })).body.id;
    expect((await (await as('lo.lit1')).get(`/drafting/requests/${id}`)).status).toBe(404);
    expect((await (await as('lo.drf1')).get(`/drafting/requests/${id}`)).status).toBe(404); // restricted, not named
    expect((await (await as('hod')).get(`/drafting/requests/${id}`)).status).toBe(200);
  });

  it('intake converts into a registered drafting request', async () => {
    const pl = await as('pl.drf');
    const i = await pl.upload('/intake', { source: 'LETTER', receivedAt: new Date().toISOString(), senderName: 'Fleet', subject: 'Vehicle lease agreement', priority: 'NORMAL' }, {});
    const conv = await pl.post(`/intake/${i.body.id}/convert`, { unit: 'DRF', requestTypeId: await rtId('CONTRACT_REVIEW') });
    expect(conv.body.reference).toMatch(/^LGL-DRF-/);
    const d = await (await as('uh.drf')).get(`/drafting/requests/${conv.body.matterId}`);
    expect(d.status).toBe(200);
    expect(d.body.actions.map((a: { action: string }) => a.action)).toContain('assign');
  });

  it('contract repository, PoA register and opinions archive', async () => {
    const lo = await as('lo.drf1');
    const end = new Date(Date.now() + 90 * 86400_000);
    const c = await lo.post('/drafting/contracts', { title: 'Cable maintenance contract', parties: ['STELCO', 'CableCo'], value: '750000', startDate: new Date().toISOString(), endDate: end.toISOString(), autoRenew: true, noticePeriodDays: 60 });
    expect(c.status).toBe(201);
    const kinds = (await db.calendarEvent.findMany({ where: { sourceType: 'Contract', sourceId: c.body.id } })).map((e) => e.kind).sort();
    expect(kinds).toEqual(['CONTRACT_EXPIRY', 'CONTRACT_NOTICE']);
    const list = await lo.get('/drafting/contracts?expiringDays=120');
    expect(list.body.find((x: { id: string }) => x.id === c.body.id).noticeDeadline).toBeTruthy();
    const p = await lo.post('/drafting/poa', { holderName: 'Ahmed Nashid', scope: 'Sign customer connection agreements', issuedOn: new Date().toISOString(), expiresOn: end.toISOString() });
    expect((await lo.post(`/drafting/poa/${p.body.id}/revoke`, { reason: 'Role change' })).body.status).toBe('REVOKED');
    await lo.post('/drafting/opinions', { title: 'Applicability of the Utility Regulation to solar IPPs', question: 'Do IPPs need a separate licence?', summary: 'Yes, a generation licence is required under the regulation.', tags: ['licensing'], issuedOn: new Date().toISOString() });
    const ops = await lo.get('/drafting/opinions?q=generation licence');
    expect(ops.body.length).toBeGreaterThanOrEqual(1);
    expect((await (await as('lo.lit1')).get('/drafting/contracts')).status).toBe(403);
  });

  it('templates: officers propose, only Unit Head/HoD approve', async () => {
    const lo = await as('lo.drf1');
    expect((await lo.post('/drafting/templates', { name: 'Standard NDA (mutual)', category: 'NDA', status: 'APPROVED' })).status).toBe(403);
    const t = await lo.post('/drafting/templates', { name: 'Standard NDA (mutual)', category: 'NDA', body: 'This Agreement is made…' });
    expect(t.body.status).toBe('DRAFT');
    const ok = await (await as('uh.drf')).patch(`/drafting/templates/${t.body.id}`, { name: 'Standard NDA (mutual)', category: 'NDA', status: 'APPROVED' });
    expect(ok.body.status).toBe('APPROVED');
    const cl = await lo.post('/drafting/clauses', { title: 'Governing law', body: 'This Agreement is governed by the laws of the Maldives.', tags: ['boilerplate'] });
    expect(cl.status).toBe(201);
  });
});
