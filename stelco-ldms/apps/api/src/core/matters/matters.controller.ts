import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { UNITS } from '@ldms/shared';
import { Authenticated, Can, ReAuth } from '../../common/decorators';
import { forbidden } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { pageQuery, parse } from '../../common/zod';
import { ExportService } from '../export/export.service';
import { PolicyService } from '../policy/policy.service';
import { SlaService } from '../sla/sla.service';
import { GENERIC_STATUSES, MattersService } from './matters.service';

const priority = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
const listQuery = pageQuery.extend({
  unit: z.enum(UNITS).optional(), status: z.string().max(40).optional(), assigneeId: z.string().max(40).optional(),
  priority: priority.optional(), departmentId: z.string().max(40).optional(), open: z.enum(['true', 'false']).optional(),
  mine: z.enum(['true', 'false']).optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional(), tag: z.string().max(40).optional(),
});
const createSchema = z.object({
  unit: z.enum(['CMP', 'AWR']), title: z.string().trim().min(3).max(300), description: z.string().max(20000).nullish(),
  requestTypeId: z.string().max(40).nullish(), priority: priority.default('NORMAL'), requestingDeptId: z.string().max(40).nullish(),
  requesterName: z.string().max(200).nullish(), dueDate: z.coerce.date().nullish(), restricted: z.boolean().default(false), tags: z.array(z.string().max(40)).max(20).default([]),
}).strict();
const updateSchema = z.object({
  title: z.string().trim().min(3).max(300), description: z.string().max(20000).nullable(), priority, dueDate: z.coerce.date().nullable(),
  tags: z.array(z.string().max(40)).max(20), requestingDeptId: z.string().max(40).nullable(), requesterName: z.string().max(200).nullable(),
}).partial().strict();
const assignSchema = z.object({ assigneeIds: z.array(z.string().max(40)).min(1).max(5), reviewerId: z.string().max(40).nullish(), approverId: z.string().max(40).nullish() }).strict();

@Controller('matters')
export class MattersController {
  constructor(
    private readonly matters: MattersService,
    private readonly prisma: PrismaService,
    private readonly exporter: ExportService,
    private readonly sla: SlaService,
    private readonly policy: PolicyService,
  ) {}

  @Get()
  @Can('matter:read', 'portal:use')
  async list(@Query() query: unknown, @Res({ passthrough: true }) res: Response) {
    const q = parse(listQuery, query);
    const filter = { ...q, open: q.open === 'true' ? true : undefined, mine: q.mine === 'true' };
    if (q.format === 'xlsx') {
      const all = await this.matters.list(filter, 1, 5000, q.sort, q.dir);
      return this.exporter.send(res, 'matters', [
        { key: 'reference', header: 'Reference', width: 20 }, { key: 'unit', header: 'Unit' }, { key: 'title', header: 'Title', width: 40 },
        { key: 'status', header: 'Status', width: 18 }, { key: 'priority', header: 'Priority' }, { key: 'dueDate', header: 'Due', width: 20 },
        { key: 'assignees', header: 'Assignees', width: 30, value: (r) => r.assignments.filter((a) => a.role === 'ASSIGNEE').map((a) => a.user.displayName).join(', ') },
        { key: 'requesterName', header: 'Requester', width: 24 }, { key: 'createdAt', header: 'Created', width: 20 },
      ], all.rows, { filter });
    }
    return this.matters.list(filter, q.page, q.pageSize, q.sort, q.dir);
  }

  @Post()
  @Can('matter:write')
  async create(@Body() body: unknown) {
    const b = parse(createSchema, body);
    this.policy.assertUnit('matter:write', b.unit);
    const m = await this.prisma.tx((tx) => this.matters.create(tx, { ...b, status: 'OPEN' }));
    return { id: m.id, reference: m.reference };
  }

  @Get('workload')
  @Can('matter:read')
  workload(@Query('unit') unit: string) {
    return this.matters.workload(z.enum(UNITS).parse(unit));
  }

  @Post('bulk/assign')
  @Can('matter:assign')
  @HttpCode(200)
  async bulkAssign(@Body() body: unknown) {
    const b = parse(z.object({ matterIds: z.array(z.string().max(40)).min(1).max(200), assigneeId: z.string().max(40) }).strict(), body);
    const results = [];
    for (const id of b.matterIds) {
      try { await this.matters.assign(id, { assigneeIds: [b.assigneeId] }); results.push({ id, ok: true }); }
      catch (e) { results.push({ id, ok: false, error: (e as Error).message }); }
    }
    return { results };
  }

  /** Bulk: remind the people assigned to the selected matters. */
  @Post('bulk/remind')
  @Can('matter:assign')
  @HttpCode(200)
  async bulkRemind(@Body() body: unknown) {
    const b = parse(z.object({ matterIds: z.array(z.string().max(40)).min(1).max(200), message: z.string().trim().max(500).optional() }).strict(), body);
    return this.matters.remind(b.matterIds, b.message);
  }

  @Get(':id')
  @Can('matter:read', 'portal:use')
  detail(@Param('id') id: string) {
    return this.matters.detail(id);
  }

  @Patch(':id')
  @Can('matter:write')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.matters.update(id, parse(updateSchema, body));
  }

  @Post(':id/status')
  @Can('matter:write')
  @HttpCode(200)
  status(@Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ status: z.enum(GENERIC_STATUSES), comment: z.string().max(2000).optional() }).strict(), body);
    return this.matters.setGenericStatus(id, b.status, b.comment);
  }

  @Post(':id/assign')
  @Can('matter:assign')
  @HttpCode(200)
  assign(@Param('id') id: string, @Body() body: unknown) {
    return this.matters.assign(id, parse(assignSchema, body));
  }

  @Post(':id/comments')
  @Can('matter:read', 'portal:use')
  comment(@Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ body: z.string().trim().min(1).max(10000), internal: z.boolean().default(true) }).strict(), body);
    return this.matters.comment(id, b.body, b.internal);
  }

  @Post(':id/restrict')
  @Can('matter:restrict')
  @HttpCode(200)
  restrict(@Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ restricted: z.boolean(), userIds: z.array(z.string().max(40)).max(50).default([]) }).strict(), body);
    return this.matters.setRestriction(id, b.restricted, b.userIds);
  }

  @Post(':id/links')
  @Can('matter:write')
  @HttpCode(200)
  link(@Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ toId: z.string().max(40), kind: z.enum(['RELATED', 'APPEAL_OF', 'SUPERSEDES', 'DUPLICATE']).default('RELATED') }).strict(), body);
    return this.matters.link(id, b.toId, b.kind);
  }

  @Get(':id/sla')
  @Can('matter:read')
  async slaOf(@Param('id') id: string) {
    await this.policy.assertMatter(id);
    return this.sla.forMatter(id);
  }

  /** Bulk export of a full matter file (re-authentication required). */
  @Get(':id/export')
  @Can('export:bulk')
  @ReAuth()
  async exportOne(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const d = await this.matters.detail(id);
    if (!this.policy.covers('export:bulk', d.unit)) throw forbidden();
    return this.exporter.send(res, `matter-${d.reference}`, [
      { key: 'at', header: 'When', width: 22 }, { key: 'kind', header: 'Type' }, { key: 'who', header: 'By', width: 24 }, { key: 'text', header: 'Detail', width: 80 },
    ], [
      ...d.transitions.map((t) => ({ at: t.at, kind: 'Status', who: t.actorName, text: `${t.fromStatus ?? ''} → ${t.toStatus} ${t.comment ?? ''}` })),
      ...d.comments.map((c) => ({ at: c.createdAt, kind: c.internal ? 'Internal note' : 'Comment', who: c.authorName, text: c.body ?? '' })),
    ], { matterId: id });
  }
}

@Controller('my')
export class MyWorkController {
  constructor(private readonly matters: MattersService, private readonly prisma: PrismaService) {}

  @Get('work')
  @Authenticated()
  async work() {
    const mine = await this.matters.list({ mine: true, open: true }, 1, 100, 'dueDate', 'asc');
    return { matters: mine.rows };
  }
}
