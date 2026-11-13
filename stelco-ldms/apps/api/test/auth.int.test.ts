import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, Client, closeApp, db, getApp, totp } from './helpers';
import { authenticator } from 'otplib';

describe('authentication (local accounts + mandatory TOTP)', () => {
  let app: Awaited<ReturnType<typeof getApp>>;
  beforeAll(async () => { app = await getApp(); });
  afterAll(closeApp);

  it('gives the same generic error for unknown users and wrong passwords', async () => {
    const c = new Client(app);
    const a = await c.post('/auth/login', { username: 'nobody', password: 'whatever-password' });
    const b = await c.post('/auth/login', { username: 'lo.lit2', password: 'wrong-password-123' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.message).toBe(b.body.message);
    expect(a.body.stack).toBeUndefined();
  });

  it('requires a second factor before any protected route', async () => {
    const c = new Client(app);
    const r = await c.post('/auth/login', { username: 'uh.awr', password: 'Demo-Passphrase-2026' });
    expect(r.status).toBe(200);
    expect(r.body.next).toBe('MFA');
    expect((await c.get('/matters')).status).toBe(401);
    const bad = await c.post('/auth/mfa', { code: '000000' });
    expect(bad.status).toBe(401);
    const ok = await c.post('/auth/mfa', { code: totp() });
    expect(ok.status).toBe(200);
    expect((await c.get('/auth/me')).body.stage).toBe('FULL');
    expect((await c.get('/matters')).status).toBe(200);
    // the same TOTP code cannot be used again
    const c2 = new Client(app);
    await c2.post('/auth/login', { username: 'uh.awr', password: 'Demo-Passphrase-2026' });
    expect((await c2.post('/auth/mfa', { code: totp() })).status).toBe(401);
  });

  it('locks the account after 5 failures for 15 minutes', async () => {
    const c = new Client(app);
    for (let i = 0; i < 5; i++) await c.post('/auth/login', { username: 'lo.awr1', password: 'not-the-password' });
    const u = await db.user.findUniqueOrThrow({ where: { username: 'lo.awr1' } });
    expect(u.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    const r = await c.post('/auth/login', { username: 'lo.awr1', password: 'Demo-Passphrase-2026' });
    expect(r.status).toBe(401);
    await db.user.update({ where: { id: u.id }, data: { lockedUntil: null } });
  });

  it('enrols TOTP at first sign-in and issues 10 backup codes that work once', async () => {
    const admin = await as('adm.it', { reauth: true });
    const created = await admin.post('/users', { username: 'new.officer', displayName: 'New Officer', email: 'new.officer@demo.stelco.invalid', roles: [{ role: 'LEGAL_OFFICER', unit: 'CMP' }] });
    expect(created.status).toBe(201);
    const temp = created.body.temporaryPassword as string;
    expect(temp).toBeTruthy();

    const c = new Client(app);
    const l = await c.post('/auth/login', { username: 'new.officer', password: temp });
    expect(l.body.next).toBe('ENROL_MFA');
    const e = await c.post('/auth/mfa/enrol');
    expect(e.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    const done = await c.post('/auth/mfa/enrol/verify', { code: authenticator.generate(e.body.secret) });
    expect(done.status).toBe(200);
    expect(done.body.backupCodes).toHaveLength(10);
    expect(done.body.mustChangePassword).toBe(true);
    // must change password before doing anything else
    expect((await c.get('/matters')).status).toBe(403);
    const weak = await c.post('/auth/password', { currentPassword: temp, newPassword: 'password1234' });
    expect(weak.status).toBe(400);
    const ch = await c.post('/auth/password', { currentPassword: temp, newPassword: 'a long and unusual passphrase' });
    expect(ch.status).toBe(200);
    expect((await c.get('/matters')).status).toBe(200);

    // backup code works exactly once
    const code = done.body.backupCodes[0];
    const b1 = new Client(app);
    await b1.post('/auth/login', { username: 'new.officer', password: 'a long and unusual passphrase' });
    expect((await b1.post('/auth/mfa', { code })).status).toBe(200);
    const b2 = new Client(app);
    await b2.post('/auth/login', { username: 'new.officer', password: 'a long and unusual passphrase' });
    expect((await b2.post('/auth/mfa', { code })).status).toBe(401);
  });

  it('enforces CSRF and same-origin on state-changing requests', async () => {
    const c = await as('lo.cmp1');
    const csrf = c.cookies.get('ldms_csrf')!;
    c.cookies.delete('ldms_csrf');
    expect((await c.post('/notifications/read-all')).status).toBe(403);
    c.cookies.set('ldms_csrf', csrf);
    expect((await c.post('/notifications/read-all')).status).toBe(200);
    const request = (await import('supertest')).default;
    const cross = await request(app.getHttpServer()).post('/api/auth/login').set('Origin', 'https://evil.example').send({ username: 'x', password: 'y' });
    expect(cross.status).toBe(403);
  });

  it('expires idle sessions', async () => {
    const c = await as('lo.cmp1');
    await db.session.updateMany({ where: { user: { username: 'lo.cmp1' }, revokedAt: null }, data: { lastSeenAt: new Date(Date.now() - 16 * 60_000) } });
    expect((await c.get('/auth/me')).status).toBe(401);
  });

  it('requires re-authentication for sensitive actions', async () => {
    const admin = await as('adm.it');
    const r = await admin.post('/users', { username: 'x.reauth', displayName: 'X', email: 'x.reauth@demo.stelco.invalid', roles: [] });
    expect(r.status).toBe(401);
    expect(r.body.details?.reauthRequired).toBe(true);
  });

  it('lets users see and sign out their other sessions', async () => {
    const a = await as('pl.drf');
    const b = await as('pl.drf');
    const list = await a.get('/auth/sessions');
    expect(list.body.length).toBeGreaterThanOrEqual(2);
    expect((await a.post('/auth/sessions/revoke-others')).status).toBe(200);
    expect((await b.get('/auth/me')).status).toBe(401);
    expect((await a.get('/auth/me')).status).toBe(200);
  });
});
