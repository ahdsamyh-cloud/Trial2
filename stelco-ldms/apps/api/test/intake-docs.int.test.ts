import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, closeApp, db, EICAR, getApp, PDF, sampleEml } from './helpers';

describe('manual intake, triage and documents', () => {
  beforeAll(async () => { await getApp(); });
  afterAll(closeApp);

  it('parses a saved .eml, sanitises HTML and pre-fills fields', async () => {
    const pl = await as('pl.drf');
    const r = await pl.upload('/intake/parse-email', {}, { email: [{ name: 'request.eml', data: sampleEml() }] });
    expect(r.status).toBe(200);
    expect(r.body.subject).toBe('Review of fuel supply agreement');
    expect(r.body.senderEmail).toBe('finance@stelco.com.mv');
    expect(r.body.htmlSanitized).not.toMatch(/script|onclick|javascript:|tracker\.example/);
    expect(r.body.attachments[0].filename).toBe('notes.txt');
  });

  it('records an intake with the original email, scans attachments, blocks duplicates', async () => {
    const pl = await as('pl.drf');
    const eml = sampleEml('<dup-test-1@stelco.com.mv>');
    const fields = { source: 'EMAIL', receivedAt: '2026-11-15T09:30:00+05:00', senderName: 'Finance Focal', senderEmail: 'finance@stelco.com.mv', subject: 'Review of fuel supply agreement', priority: 'NORMAL', suggestedUnit: 'DRF' };
    const r = await pl.upload('/intake', fields, { email: [{ name: 'request.eml', data: eml }] });
    expect(r.status).toBe(201);
    expect(r.body.intakeNo).toMatch(/^LGL-INT-2026-\d{4}$/);
    const docs = await db.document.findMany({ where: { intakeId: r.body.id }, include: { versions: true } });
    expect(docs.length).toBe(2); // original email + notes.txt
    expect(docs.every((d) => d.versions[0]!.scanStatus === 'CLEAN')).toBe(true);
    const em = await db.emailMessage.findUniqueOrThrow({ where: { intakeId: r.body.id } });
    expect(em.internetMessageId).toBe('<dup-test-1@stelco.com.mv>');
    expect(em.originalDocId).toBeTruthy();
    const again = await pl.upload('/intake', fields, { email: [{ name: 'request.eml', data: eml }] });
    expect(again.status).toBe(409);
    expect(await db.slaClock.count({ where: { subjectType: 'Intake', subjectId: r.body.id, stoppedAt: null } })).toBe(1);
  });

  it('triage: converts to a matter with a unit reference and acknowledgement text', async () => {
    const pl = await as('pl.drf');
    const r = await pl.upload('/intake', { source: 'PHONE', receivedAt: new Date().toISOString(), senderName: 'HR Focal', subject: 'Policy on overtime', priority: 'HIGH' }, {});
    const conv = await pl.post(`/intake/${r.body.id}/convert`, { unit: 'CMP' });
    expect(conv.status).toBe(200);
    expect(conv.body.reference).toMatch(/^LGL-CMP-2026-\d{4}$/);
    expect(conv.body.ackText).toContain(conv.body.reference);
    expect((await pl.post(`/intake/${r.body.id}/convert`, { unit: 'CMP' })).status).toBe(409);
    const clocks = await db.slaClock.findMany({ where: { matterId: conv.body.matterId } });
    expect(clocks.map((c) => c.step)).toContain('ASSIGN');
  });

  it('triage: not-legal requires a reason; Unit Heads convert only into their unit', async () => {
    const pl = await as('pl.drf');
    const r = await pl.upload('/intake', { source: 'WALKIN', receivedAt: new Date().toISOString(), senderName: 'Walk in', subject: 'Parking complaint', priority: 'LOW' }, {});
    expect((await pl.post(`/intake/${r.body.id}/not-legal`, {})).status).toBe(400);
    const r2 = await pl.upload('/intake', { source: 'WALKIN', receivedAt: new Date().toISOString(), senderName: 'Walk in', subject: 'Another', priority: 'LOW' }, {});
    const uh = await as('uh.awr');
    expect((await uh.post(`/intake/${r2.body.id}/convert`, { unit: 'LIT' })).status).toBe(403);
    expect((await pl.post(`/intake/${r.body.id}/not-legal`, { reason: 'Facilities issue' })).status).toBe(200);
  });

  it('requesters submit via the portal and cannot read the intake inbox', async () => {
    const req = await as('req.hr');
    const r = await req.upload('/portal/requests', { subject: 'Need an NDA for a consultant', summary: 'Consultant engagement starting next month, NDA needed.', priority: 'NORMAL' }, {});
    expect(r.status).toBe(201);
    expect((await req.get('/intake')).status).toBe(403);
    const i = await db.intake.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(i.adapter).toBe('PORTAL');
  });

  it('upload pipeline: magic bytes, AV quarantine, signed short-lived download', async () => {
    const uh = await as('uh.cmp');
    const m = await uh.post('/matters', { unit: 'CMP', title: 'Document pipeline test' });
    expect(m.status).toBe(201);
    const fake = await uh.upload('/documents', { ownerType: 'matter', ownerId: m.body.id }, { file: [{ name: 'evil.pdf', data: Buffer.from('MZ not a pdf') }] });
    expect(fake.status).toBe(400);
    const exe = await uh.upload('/documents', { ownerType: 'matter', ownerId: m.body.id }, { file: [{ name: 'tool.exe', data: Buffer.from('MZ') }] });
    expect(exe.status).toBe(400);
    const virus = await uh.upload('/documents', { ownerType: 'matter', ownerId: m.body.id }, { file: [{ name: 'eicar.txt', data: EICAR }] });
    expect(virus.status).toBe(201);
    const vv = await db.documentVersion.findUniqueOrThrow({ where: { id: virus.body.versionId } });
    expect(vv.scanStatus).toBe('INFECTED');
    expect((await uh.post(`/documents/versions/${vv.id}/link`)).status).toBe(409);

    const ok = await uh.upload('/documents', { ownerType: 'matter', ownerId: m.body.id, title: 'Board note' }, { file: [{ name: 'note.pdf', data: PDF }] });
    const link = await uh.post(`/documents/versions/${ok.body.versionId}/link`);
    expect(link.status).toBe(200);
    const file = await uh.get(link.body.url.replace('/api', ''));
    expect(file.status).toBe(200);
    expect(file.headers['cache-control']).toBe('no-store');
    expect(file.headers['content-disposition']).toContain('attachment');
    // link is bound to the user + session
    const other = await as('lo.cmp1');
    expect((await other.get(link.body.url.replace('/api', ''))).status).toBe(404);
    const hist = await uh.get(`/documents/${ok.body.documentId}`);
    expect(hist.body.history.map((h: { action: string }) => h.action)).toEqual(expect.arrayContaining(['UPLOAD', 'DOWNLOAD']));
  });

  it('versioning, check-out/check-in, legal hold blocks deletion', async () => {
    const uh = await as('uh.cmp');
    const m = await uh.post('/matters', { unit: 'CMP', title: 'Hold test' });
    const up = await uh.upload('/documents', { ownerType: 'matter', ownerId: m.body.id }, { file: [{ name: 'a.txt', data: Buffer.from('v1') }] });
    expect((await uh.post(`/documents/${up.body.documentId}/checkout`)).status).toBe(200);
    const lo = await as('lo.cmp1');
    await uh.post(`/matters/${m.body.id}/assign`, { assigneeIds: [(await db.user.findUniqueOrThrow({ where: { username: 'lo.cmp1' } })).id] });
    const blocked = await lo.upload('/documents', { ownerType: 'matter', ownerId: m.body.id, documentId: up.body.documentId }, { file: [{ name: 'a.txt', data: Buffer.from('v2') }] });
    expect(blocked.status).toBe(409);
    const v2 = await uh.upload('/documents', { ownerType: 'matter', ownerId: m.body.id, documentId: up.body.documentId }, { file: [{ name: 'a.txt', data: Buffer.from('v2') }] });
    expect(v2.body.versionNo).toBe(2);
    await uh.post(`/documents/${up.body.documentId}/checkin`);
    expect((await uh.post('/holds', { scopeType: 'MATTER', scopeId: m.body.id, on: true, reason: 'Pending dispute' })).status).toBe(200);
    expect((await uh.del(`/documents/${up.body.documentId}?reason=cleanup`)).status).toBe(409);
    expect((await uh.post('/holds', { scopeType: 'MATTER', scopeId: m.body.id, on: false, reason: 'x release' })).status).toBe(403);
    await expect(db.$executeRawUnsafe(`DELETE FROM "Document" WHERE id = '${up.body.documentId}'`)).rejects.toThrow(/legal hold/);
  });
});
