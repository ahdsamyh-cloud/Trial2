import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { Can, ReAuth } from '../../common/decorators';
import { currentUser } from '../../common/context';
import { PrismaService } from '../../common/prisma.service';
import { parse } from '../../common/zod';
import { AuditService } from './audit.service';

const SYSTEM_ACTION_PREFIXES = ['auth.', 'user.', 'session.', 'config.', 'role.', 'admin.'];

const q = z.object({
  actor: z.string().max(100).optional(),
  action: z.string().max(100).optional(),
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(60).optional(),
  outcome: z.enum(['SUCCESS', 'DENIED', 'FAILURE']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

@Controller('audit')
export class AuditController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** HoD / Auditor see everything; Super Admin only system events (no legal content). Viewing requires re-auth. */
  @Get()
  @Can('audit:read', 'audit:read.system')
  @ReAuth()
  async list(@Query() query: unknown) {
    const f = parse(q, query);
    const user = currentUser();
    const where: Prisma.AuditLogWhereInput = {
      ...(f.actor ? { actorName: { contains: f.actor, mode: 'insensitive' } } : {}),
      ...(f.action ? { action: { startsWith: f.action } } : {}),
      ...(f.entityType ? { entityType: f.entityType } : {}),
      ...(f.entityId ? { entityId: f.entityId } : {}),
      ...(f.outcome ? { outcome: f.outcome } : {}),
      ...(f.from || f.to ? { ts: { gte: f.from, lte: f.to } } : {}),
    };
    if (!user.perms.has('audit:read')) where.OR = SYSTEM_ACTION_PREFIXES.map((p) => ({ action: { startsWith: p } }));
    const [rows, total] = await Promise.all([
      this.prisma.base.auditLog.findMany({ where, orderBy: { seq: 'desc' }, skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
      this.prisma.base.auditLog.count({ where }),
    ]);
    await this.audit.log({ action: 'audit.view', meta: { filters: f } });
    return { total, rows: rows.map((r) => ({ ...r, seq: r.seq.toString() })) };
  }

  @Get('verify')
  @Can('audit:read', 'audit:read.system')
  async verify() {
    return this.audit.verify();
  }
}
