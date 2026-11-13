import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { as, closeApp, db, getApp, userId } from './helpers';
import { AppModule } from '../src/app.module';
import { CoreModule } from '../src/core/core.module';
import { UNIT_MODULES } from '../src/units';
import { PERMISSION_KEY, PUBLIC_KEY } from '../src/common/decorators';

/** IDOR + ethical-wall matrix: every persona against every matter type. */
describe('record-level access, restricted matters, RLS', () => {
  let open: string, restricted: string, drf: string;
  beforeAll(async () => {
    await getApp();
    const uh = await as('uh.cmp');
    open = (await uh.post('/matters', { unit: 'CMP', title: 'Open compliance matter', requestingDeptId: (await db.department.findUniqueOrThrow({ where: { code: 'FIN' } })).id })).body.id;
    restricted = (await uh.post('/matters', { unit: 'CMP', title: 'Board investigation (restricted)', description: 'Very sensitive detail', restricted: true })).body.id;
    const hod = await as('hod');
    void hod;
    drf = (await (await as('uh.drf')).post('/matters', { unit: 'CMP', title: 'x' })).body?.id;
  });
  afterAll(closeApp);

  it('unit staff see their unit; other units get 404', async () => {
    expect((await (await as('lo.cmp1')).get(`/matters/${open}`)).status).toBe(200);
    expect((await (await as('lo.lit1')).get(`/matters/${open}`)).status).toBe(404);
    expect((await (await as('pl.lit')).get(`/matters/${open}`)).status).toBe(404);
    expect(drf).toBeUndefined(); // uh.drf cannot create in CMP
  });

  it('restricted matters are invisible to non-named users (incl. same unit) and visible to HoD', async () => {
    const lo = await as('lo.cmp1');
    expect((await lo.get(`/matters/${restricted}`)).status).toBe(404);
    const list = await lo.get('/matters?unit=CMP&pageSize=200');
    expect(list.body.rows.find((r: { id: string }) => r.id === restricted)).toBeUndefined();
    expect((await (await as('hod')).get(`/matters/${restricted}`)).body.description).toBe('Very sensitive detail');
    expect((await (await as('uh.cmp')).get(`/matters/${restricted}`)).status).toBe(200); // creator is named
  });

  it('naming a user lifts the wall for them only', async () => {
    const uh = await as('uh.cmp');
    await uh.post(`/matters/${restricted}/restrict`, { restricted: true, userIds: [await userId('lo.cmp1')] });
    expect((await (await as('lo.cmp1')).get(`/matters/${restricted}`)).status).toBe(200);
    expect((await (await as('uh.awr')).get(`/matters/${restricted}`)).status).toBe(404);
  });

  it('restricted descriptions are encrypted at rest', async () => {
    const [, raw] = await db.$transaction([
      db.$executeRaw`SELECT set_config('app.ctx', 'system', true)`,
      db.$queryRaw<{ description: string | null; descriptionEnc: string | null }[]>`SELECT description, "descriptionEnc" FROM "Matter" WHERE id = ${restricted}`,
    ]);
    expect(raw[0]!.description).toBeNull();
    expect(raw[0]!.descriptionEnc).toMatch(/^v1\.k1\./);
  });

  it('database RLS hides restricted matters even if app code forgot to filter', async () => {
    const app = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    const outsider = await userId('lo.lit1');
    const [, , rows] = await app.$transaction([
      app.$executeRaw`SELECT set_config('app.ctx', 'user', true)`,
      app.$executeRaw`SELECT set_config('app.user_id', ${outsider}, true)`,
      app.matter.findMany({ where: { id: restricted } }),
    ]);
    expect(rows).toHaveLength(0);
    const noCtx = await app.matter.findMany({ where: { id: restricted } });
    expect(noCtx).toHaveLength(0); // fail closed
    const [, , docs] = await app.$transaction([
      app.$executeRaw`SELECT set_config('app.ctx', 'user', true)`,
      app.$executeRaw`SELECT set_config('app.user_id', ${outsider}, true)`,
      app.matter.findMany({ where: { id: open } }),
    ]);
    expect(docs).toHaveLength(1);
    await app.$disconnect();
  });

  it('requesters see their department\'s matters in portal view only', async () => {
    const fin = await as('req.fin');
    const r = await fin.get(`/matters/${open}`);
    expect(r.status).toBe(200);
    expect(r.body.portalView).toBe(true);
    expect(r.body.sla).toEqual([]);
    expect((await (await as('req.hr')).get(`/matters/${open}`)).status).toBe(404);
    expect((await fin.get(`/matters/${restricted}`)).status).toBe(404);
    expect((await fin.post(`/matters/${open}/comments`, { body: 'internal?', internal: true })).status).toBe(403);
  });

  it('auditor is read-only and expires', async () => {
    const aud = await as('auditor');
    expect((await aud.get(`/matters/${open}`)).status).toBe(200);
    expect((await aud.patch(`/matters/${open}`, { title: 'changed by auditor' })).status).toBe(403);
    const u = await db.user.findUniqueOrThrow({ where: { username: 'auditor' } });
    await db.user.update({ where: { id: u.id }, data: { accessExpiresAt: new Date(Date.now() - 1000) } });
    expect((await aud.get(`/matters/${open}`)).status).toBe(401);
    await db.user.update({ where: { id: u.id }, data: { accessExpiresAt: new Date(Date.now() + 30 * 86400_000) } });
  });

  it('management viewer gets no matter details', async () => {
    expect((await (await as('mgmt')).get(`/matters/${open}`)).status).toBe(403);
  });

  it('officers edit only matters assigned to them; maker-checker on assignment', async () => {
    const lo = await as('lo.cmp1');
    expect((await lo.patch(`/matters/${open}`, { title: 'Edited by unassigned officer' })).status).toBe(403);
    const uh = await as('uh.cmp');
    const bad = await uh.post(`/matters/${open}/assign`, { assigneeIds: [await userId('lo.cmp1')], reviewerId: await userId('lo.cmp1') });
    expect(bad.status).toBe(400);
    expect((await uh.post(`/matters/${open}/assign`, { assigneeIds: [await userId('lo.cmp1')] })).status).toBe(200);
    expect((await lo.patch(`/matters/${open}`, { title: 'Edited by assigned officer' })).status).toBe(200);
    expect((await (await as('lo.lit1')).post(`/matters/${open}/assign`, { assigneeIds: [await userId('lo.lit1')] })).status).toBe(403);
    expect((await (await as('uh.lit')).post(`/matters/${open}/assign`, { assigneeIds: [await userId('lo.lit1')] })).status).toBe(404);
  });

  it('every route declares a permission or is explicitly public (deny by default)', () => {
    const controllers: Function[] = [
      ...(Reflect.getMetadata('controllers', CoreModule) ?? []),
      ...UNIT_MODULES.flatMap((m) => Reflect.getMetadata('controllers', m) ?? []),
    ];
    expect(AppModule).toBeTruthy();
    const missing: string[] = [];
    for (const c of controllers) {
      for (const key of Object.getOwnPropertyNames(c.prototype)) {
        const fn = c.prototype[key];
        if (key === 'constructor' || typeof fn !== 'function' || Reflect.getMetadata('method', fn) === undefined) continue;
        const has = Reflect.getMetadata(PERMISSION_KEY, fn) !== undefined || Reflect.getMetadata(PUBLIC_KEY, fn) || Reflect.getMetadata(PERMISSION_KEY, c);
        if (!has) missing.push(`${c.name}.${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
