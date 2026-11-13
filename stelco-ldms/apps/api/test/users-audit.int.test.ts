import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, closeApp, db, getApp } from './helpers';

describe('user administration, separation of duties, audit trail', () => {
  beforeAll(async () => { await getApp(); });
  afterAll(closeApp);

  it('Super Admin manages users but cannot see legal content', async () => {
    const admin = await as('adm.it');
    expect((await admin.get('/users')).status).toBe(200);
    expect((await admin.get('/matters')).status).toBe(403);
    expect((await admin.get('/intake')).status).toBe(403);
    expect((await admin.get('/calendar?from=2026-01-01&to=2026-12-31')).status).toBe(403);
  });

  it('rejects admin accounts holding legal roles (SoD)', async () => {
    const admin = await as('adm.it', { reauth: true });
    const r = await admin.post('/users', { username: 'adm.bad', displayName: 'Bad', email: 'adm.bad@demo.stelco.invalid', isAdminAccount: true, roles: [{ role: 'SUPER_ADMIN' }, { role: 'HOD' }] });
    expect(r.status).toBe(400);
    const r2 = await admin.post('/users', { username: 'aud.noexp', displayName: 'Aud', email: 'aud.noexp@demo.stelco.invalid', roles: [{ role: 'AUDITOR' }] });
    expect(r2.status).toBe(400);
  });

  it('non-admins cannot manage users', async () => {
    const hod = await as('hod', { reauth: true });
    expect((await hod.post('/users', { username: 'z', displayName: 'z', email: 'z@demo.stelco.invalid', roles: [] })).status).toBe(403);
  });

  it('disabling a user ends their sessions immediately', async () => {
    const admin = await as('adm.it', { reauth: true });
    const created = await admin.post('/users', { username: 'tmp.leaver', displayName: 'Leaver', email: 'tmp.leaver@demo.stelco.invalid', roles: [{ role: 'LEGAL_OFFICER', unit: 'AWR' }] });
    const id = created.body.user.id;
    await db.user.update({ where: { id }, data: { mustChangePassword: false } });
    const leaver = await as('tmp.leaver');
    expect((await leaver.get('/auth/me')).status).toBe(200);
    const d = await admin.post(`/users/${id}/disable`, { reason: 'Left the company' });
    expect(d.status).toBe(200);
    expect((await leaver.get('/auth/me')).status).toBe(401);
  });

  it('role changes alert and revoke the user\'s sessions', async () => {
    const admin = await as('adm.it', { reauth: true });
    const target = await db.user.findUniqueOrThrow({ where: { username: 'lo.lit2' } });
    const s = await as('lo.lit2');
    const r = await admin.put(`/users/${target.id}/roles`, { roles: [{ role: 'LEGAL_OFFICER', unit: 'LIT' }] });
    expect(r.status).toBe(200);
    expect((await s.get('/auth/me')).status).toBe(401);
    const hodAlerts = await db.notification.count({ where: { user: { username: 'adm.it' }, type: 'security.alert' } });
    expect(hodAlerts).toBeGreaterThan(0);
  });

  it('produces an access review report (json + xlsx)', async () => {
    const admin = await as('adm.it');
    const r = await admin.get('/users/access-review');
    expect(r.status).toBe(200);
    expect(r.body.find((u: { username: string }) => u.username === 'hod').roles).toBe('HOD');
    const x = await admin.get('/users/access-review?format=xlsx');
    expect(x.headers['content-type']).toContain('spreadsheetml');
  });

  it('audit log is hash-chained, append-only and verifiable', async () => {
    const hod = await as('hod', { reauth: true });
    const v = await hod.get('/audit/verify');
    expect(v.body.ok).toBe(true);
    expect(v.body.checked).toBeGreaterThan(5);
    await expect(db.$executeRawUnsafe('UPDATE "AuditLog" SET action = \'x\' WHERE seq = 1')).rejects.toThrow(/append-only/);
    await expect(db.$executeRawUnsafe('DELETE FROM "AuditLog" WHERE seq = 1')).rejects.toThrow(/append-only/);
    const list = await hod.get('/audit?action=auth.');
    expect(list.status).toBe(200);
    expect(list.body.rows.length).toBeGreaterThan(0);
  });

  it('audit viewer requires re-authentication and hides legal events from Super Admin', async () => {
    expect((await (await as('hod')).get('/audit')).status).toBe(401);
    const admin = await as('adm.it', { reauth: true });
    const r = await admin.get('/audit?pageSize=200');
    expect(r.status).toBe(200);
    expect(r.body.rows.every((x: { action: string }) => /^(auth|user|session|config|role|admin)\./.test(x.action))).toBe(true);
  });

  it('config changes are audited; requesters can read departments only', async () => {
    const admin = await as('adm.it');
    const h = await admin.post('/config/holidays', { date: '2027-12-30', name: 'Test holiday' });
    expect(h.status).toBe(201);
    const req = await as('req.fin');
    expect((await req.get('/config/departments')).status).toBe(200);
    expect((await req.get('/config/holidays')).status).toBe(403);
    expect(await db.auditLog.count({ where: { action: 'config.create', entityId: h.body.id } })).toBe(1);
  });
});
