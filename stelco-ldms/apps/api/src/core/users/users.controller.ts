import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ROLES, UNITS } from '@ldms/shared';
import { AdminNetwork, Authenticated, Can, ReAuth } from '../../common/decorators';
import { currentUser } from '../../common/context';
import { forbidden, notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { parse, qrec, qs } from '../../common/zod';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { ExportService } from '../export/export.service';
import { PolicyService } from '../policy/policy.service';
import { UsersService } from './users.service';

const role = z.object({ role: z.enum(ROLES), unit: z.enum(UNITS).nullish() }).strict();
const createSchema = z.object({
  username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/),
  displayName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  departmentId: z.string().max(40).nullish(),
  title: z.string().max(120).nullish(),
  isAdminAccount: z.boolean().default(false),
  accessExpiresAt: z.coerce.date().nullish(),
  roles: z.array(role).max(10).default([]),
}).strict();
const updateSchema = createSchema.pick({ displayName: true, email: true, departmentId: true, title: true, accessExpiresAt: true }).partial().strict();
const disableSchema = z.object({ reason: z.string().trim().min(3).max(500), emergency: z.boolean().default(false) }).strict();
const resetSchema = z.object({ password: z.boolean().default(false), mfa: z.boolean().default(false) }).strict().refine((v) => v.password || v.mfa, 'Choose what to reset');
const reassignSchema = z.object({ toUserId: z.string().min(1).max(40), matterIds: z.array(z.string().max(40)).max(500).optional() }).strict();

@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly exporter: ExportService,
    private readonly policy: PolicyService,
  ) {}

  @Get()
  @Can('users:read', 'users:manage')
  list(@Query() query: unknown) {
    const q = qrec(query);
    return this.users.list({ q: q.q?.slice(0, 100), status: q.status, role: q.role, unit: q.unit });
  }

  /** Name directory for assignment pickers (legal staff). */
  @Get('directory')
  @Authenticated()
  directory(@Query('unit') unitQ?: unknown) {
    const unit = qs(unitQ, 5);
    const u = currentUser();
    if (u.isAdminAccount && !u.perms.has('matter:read')) throw forbidden();
    return this.users.directory(UNITS.includes(unit as never) ? (unit as never) : undefined);
  }

  @Get('access-review')
  @Can('accessreview:read')
  async accessReview(@Query('format') formatQ: unknown, @Res({ passthrough: true }) res: Response) {
    const format = qs(formatQ, 10);
    const rows = await this.users.accessReview();
    await this.audit.log({ action: 'user.access-review', meta: { rows: rows.length } });
    if (format === 'xlsx') {
      return this.exporter.send(res, 'access-review', [
        { key: 'username', header: 'Username' }, { key: 'displayName', header: 'Name', width: 28 }, { key: 'department', header: 'Department', width: 24 },
        { key: 'status', header: 'Status' }, { key: 'adminAccount', header: 'Admin account' }, { key: 'roles', header: 'Roles', width: 40 },
        { key: 'lastLoginAt', header: 'Last sign-in', width: 22 }, { key: 'accessExpiresAt', header: 'Access expires', width: 22 }, { key: 'flags', header: 'Flags', width: 30 },
      ], rows);
    }
    return rows;
  }

  @Get(':id')
  @Can('users:read', 'users:manage')
  get(@Param('id') id: string) {
    return this.users.get(id);
  }

  @Post()
  @Can('users:manage')
  @AdminNetwork()
  @ReAuth()
  create(@Body() body: unknown) {
    return this.users.create(parse(createSchema, body));
  }

  @Patch(':id')
  @Can('users:manage')
  @AdminNetwork()
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.users.update(id, parse(updateSchema, body));
  }

  @Put(':id/roles')
  @Can('users:manage')
  @AdminNetwork()
  @ReAuth()
  setRoles(@Param('id') id: string, @Body() body: unknown) {
    return this.users.setRoles(id, parse(z.object({ roles: z.array(role).max(10) }).strict(), body).roles);
  }

  @Get(':id/open-work')
  @Can('users:manage', 'leaver:reassign')
  openWork(@Param('id') id: string) {
    return this.users.openWork(id);
  }

  @Post(':id/disable')
  @Can('users:manage')
  @AdminNetwork()
  @ReAuth()
  @HttpCode(200)
  disable(@Param('id') id: string, @Body() body: unknown) {
    const b = parse(disableSchema, body);
    return this.users.disable(id, b.reason, b.emergency);
  }

  @Post(':id/enable')
  @Can('users:manage')
  @AdminNetwork()
  @ReAuth()
  @HttpCode(200)
  enable(@Param('id') id: string) {
    return this.users.enable(id);
  }

  @Post(':id/unlock')
  @Can('users:manage')
  @AdminNetwork()
  @HttpCode(200)
  unlock(@Param('id') id: string) {
    return this.users.unlock(id);
  }

  @Post(':id/reset')
  @Can('users:manage')
  @AdminNetwork()
  @ReAuth()
  @HttpCode(200)
  reset(@Param('id') id: string, @Body() body: unknown) {
    return this.users.reset(id, parse(resetSchema, body));
  }

  @Get(':id/sessions')
  @Can('sessions:manage')
  sessionsOf(@Param('id') id: string) {
    return this.prisma.base.session.findMany({
      where: { userId: id, revokedAt: null, absoluteExpiry: { gt: new Date() } },
      select: { id: true, createdAt: true, lastSeenAt: true, ip: true, userAgent: true, mobile: true, stage: true },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  @Delete(':id/sessions/:sid')
  @Can('sessions:manage')
  @AdminNetwork()
  async revokeSession(@Param('id') id: string, @Param('sid') sid: string) {
    const s = await this.prisma.base.session.findFirst({ where: { id: sid, userId: id } });
    if (!s) throw notFound('Session');
    await this.sessions.revoke(sid, 'admin-revoked');
    await this.audit.log({ action: 'session.admin-revoked', entityType: 'Session', entityId: sid, meta: { userId: id } });
    return { ok: true };
  }

  /**
   * Leaver checklist: HoD / Unit Head moves a leaver's open assignments to another person.
   * Unit Heads can only move matters in their own unit(s).
   */
  @Post(':id/reassign')
  @Can('leaver:reassign')
  @HttpCode(200)
  async reassign(@Param('id') id: string, @Body() body: unknown) {
    const b = parse(reassignSchema, body);
    const target = await this.prisma.base.user.findUnique({ where: { id: b.toUserId } });
    if (!target || target.status !== 'ACTIVE') throw notFound('Target user');
    const scope = this.policy.matterScope('matter:assign');
    const assignments = await this.prisma.db.matterAssignment.findMany({
      where: { userId: id, matter: { AND: [{ closedAt: null }, scope, ...(b.matterIds ? [{ id: { in: b.matterIds } }] : [])] } },
    });
    let moved = 0;
    for (const a of assignments) {
      await this.prisma.tx(async (tx) => {
        await tx.matterAssignment.delete({ where: { id: a.id } });
        await tx.matterAssignment.upsert({
          where: { matterId_userId_role: { matterId: a.matterId, userId: b.toUserId, role: a.role } },
          create: { matterId: a.matterId, userId: b.toUserId, role: a.role }, update: {},
        });
        await tx.slaClock.updateMany({ where: { matterId: a.matterId, ownerId: id, stoppedAt: null }, data: { ownerId: b.toUserId } });
      });
      moved++;
      await this.audit.log({ action: 'matter.reassigned', entityType: 'Matter', entityId: a.matterId, before: { userId: id, role: a.role }, after: { userId: b.toUserId, role: a.role } });
    }
    return { moved, remaining: (await this.users.openWork(id)).total };
  }
}
