import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { as, closeApp, db, getApp, PDF, userId } from './helpers';
import { StorageService } from '../src/core/documents/storage.service';
import { RetentionService } from '../src/core/retention/retention.service';
import { CryptoService } from '../src/common/crypto.service';
import { resetConfigForTests } from '../src/config';
import { runAsSystem } from '../src/common/context';

const sys = <T>(q: Promise<T>) => db.$transaction([db.$executeRaw`SELECT set_config('app.ctx','system',true)`, q as never]).then((r) => r[1] as T);

describe('hardening: retention/disposal, key rotation, headers', () => {
  let app: Awaited<ReturnType<typeof getApp>>;
  beforeAll(async () => { app = await getApp(); });
  afterAll(closeApp);

  it('proposes disposal after the retention period; HoD approves with re-auth; legal hold wins', async () => {
    const uh = await as('uh.drf');
    const rt = await db.requestType.findUniqueOrThrow({ where: { code: 'LETTER' } });
    const a = (await uh.post('/drafting/requests', { title: 'Old letter A', requestTypeId: rt.id })).body.id;
    const b = (await uh.post('/drafting/requests', { title: 'Old letter B', requestTypeId: rt.id })).body.id;
    const old = new Date(Date.now() - 9 * 365 * 86400_000);
    await sys(db.matter.updateMany({ where: { id: { in: [a, b] } }, data: { status: 'CLOSED', closedAt: old } }));
    await sys(db.matter.update({ where: { id: b }, data: { legalHold: true } }));
    const r = await runAsSystem(() => app.get(RetentionService).scan());
    expect(r.proposed).toBeGreaterThanOrEqual(1);
    const pending = await db.disposalRequest.findMany({ where: { recordId: { in: [a, b] } } });
    expect(pending.map((p) => p.recordId)).toEqual([a]); // b is under legal hold
    expect((await (await as('uh.drf', { reauth: true })).post(`/retention/disposals/${pending[0]!.id}`, { approve: true })).status).toBe(403);
    expect((await (await as('hod')).post(`/retention/disposals/${pending[0]!.id}`, { approve: true })).status).toBe(401); // re-auth needed
    const ok = await (await as('hod', { reauth: true })).post(`/retention/disposals/${pending[0]!.id}`, { approve: true });
    expect(ok.status).toBe(200);
    expect(await sys(db.matter.count({ where: { id: a } }))).toBe(0);
    expect(await db.auditLog.count({ where: { action: 'retention.disposed', entityId: a } })).toBe(1);
  });

  it('keeps the record (and reports failure) when files cannot be destroyed', async () => {
    const uh = await as('uh.drf');
    const rt = await db.requestType.findUniqueOrThrow({ where: { code: 'LETTER' } });
    const c = (await uh.post('/drafting/requests', { title: 'Old letter C', requestTypeId: rt.id })).body.id;
    expect((await uh.upload('/documents', { ownerType: 'matter', ownerId: c, title: 'Letter' }, { file: [{ name: 'c.pdf', data: PDF }] })).status).toBe(201);
    await sys(db.matter.update({ where: { id: c }, data: { status: 'CLOSED', closedAt: new Date(Date.now() - 9 * 365 * 86400_000) } }));
    await runAsSystem(() => app.get(RetentionService).scan());
    const req = await db.disposalRequest.findFirstOrThrow({ where: { recordId: c } });
    const spy = vi.spyOn(app.get(StorageService), 'remove').mockRejectedValue(new Error('storage offline'));
    try {
      const r = await (await as('hod', { reauth: true })).post(`/retention/disposals/${req.id}`, { approve: true });
      expect(r.status).toBe(503);
      expect(JSON.stringify(r.body)).not.toContain('storage offline'); // internals never reach the client
    } finally { spy.mockRestore(); }
    expect(await sys(db.matter.count({ where: { id: c } }))).toBe(1);
    expect((await db.disposalRequest.findUniqueOrThrow({ where: { id: req.id } })).status).not.toBe('DISPOSED');
    expect(await db.auditLog.count({ where: { action: 'retention.dispose.failed', entityId: c } })).toBe(1);
    // Storage back: approving again completes the disposal.
    expect((await (await as('hod', { reauth: true })).post(`/retention/disposals/${req.id}`, { approve: true })).status).toBe(200);
    expect(await sys(db.matter.count({ where: { id: c } }))).toBe(0);
  });

  it('rotates field-level encryption keys', async () => {
    const lo = await as('lo.lit1');
    const c = await (await as('uh.lit')).post('/litigation/cases', { title: 'Rotation test case', caseType: 'CIVIL', ourRole: 'DEFENDANT', exposure: '12345', responsibleOfficerId: await userId('lo.lit1') });
    // re-encrypt the value under the older key k0 to simulate data written before a rotation
    const prev = process.env.FIELD_KEY_ACTIVE;
    process.env.FIELD_KEY_ACTIVE = 'k0';
    resetConfigForTests();
    const old = new CryptoService().encrypt('12345')!;
    process.env.FIELD_KEY_ACTIVE = prev;
    resetConfigForTests();
    await sys(db.litigationCase.update({ where: { matterId: c.body.id }, data: { exposureEnc: old } }));
    expect(old.startsWith('v1.k0.')).toBe(true);
    const r = await runAsSystem(() => app.get(RetentionService).rotateKeys());
    expect(r.rotated).toBeGreaterThanOrEqual(1);
    const row = await sys(db.litigationCase.findUniqueOrThrow({ where: { matterId: c.body.id } }));
    expect(row.exposureEnc!.startsWith('v1.k1.')).toBe(true);
    expect((await lo.get(`/litigation/cases/${c.body.id}`)).body.exposure).toBe('12345');
  });

  it('API responses carry security headers and no stack traces', async () => {
    const c = await as('lo.lit1');
    const r = await c.get('/matters/does-not-exist');
    expect(r.status).toBe(404);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(JSON.stringify(r.body)).not.toMatch(/at \w+ \(|node_modules|prisma/i);
    const bad = await c.post('/matters', { unit: 'CMP', title: 'x', extraField: 'mass-assignment' });
    expect(bad.status).toBe(400);
    // repeated query keys arrive as arrays: refused instead of reaching string code paths
    expect((await c.get('/search?q=a&q=b')).status).toBe(400);
    expect((await c.get('/drafting/opinions?q=x&q=y')).status).toBe(400);
    expect((await c.get('/search?q=contract')).status).toBe(200);
    const big = await c.post('/matters', { unit: 'CMP', title: 'x'.repeat(2_000_000) });
    expect([400, 413]).toContain(big.status);
  });
});

describe('rate limiting', () => {
  it('limits per session rather than per office IP', async () => {
    const prev = process.env.RATE_LIMIT_PER_MIN;
    process.env.RATE_LIMIT_PER_MIN = '5';
    try {
      const a = await as('lo.cmp1');
      const b = await as('lo.cmp1');
      const codes: number[] = [];
      for (let i = 0; i < 7; i++) codes.push((await a.get('/notifications')).status);
      expect(codes.slice(0, 5).every((c) => c === 200)).toBe(true);
      expect(codes.at(-1)).toBe(429);
      expect((await b.get('/notifications')).status).toBe(200); // same IP, different session: not throttled
    } finally {
      process.env.RATE_LIMIT_PER_MIN = prev;
    }
  });
});
