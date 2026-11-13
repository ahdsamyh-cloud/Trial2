import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { DRAFTING_STATUSES } from '@ldms/shared';
import { Can } from '../../common/decorators';
import { money, parse, qrec, qs } from '../../common/zod';
import { ExportService } from '../../core/export/export.service';
import { DraftingService } from './drafting.service';
import { RegistersService } from './registers.service';

const id = z.string().max(40);
const actions = ['register', 'assign', 'start', 'request_info', 'info_received', 'submit_review', 'return_correction', 'mark_reviewed', 'send_for_approval', 'approve', 'escalate_hod', 'hod_approve', 'return_from_approval', 'send', 'require_follow_up', 'close', 'cancel', 'reject'] as const;
const tags = z.array(z.string().trim().min(1).max(40)).max(20).default([]);

@Controller('drafting')
export class DraftingController {
  constructor(private readonly drafting: DraftingService, private readonly reg: RegistersService, private readonly exporter: ExportService) {}

  @Get('statuses')
  @Can('matter:read')
  statuses() {
    return DRAFTING_STATUSES;
  }

  @Post('requests')
  @Can('draft:draft', 'intake:triage')
  create(@Body() body: unknown) {
    return this.drafting.create(parse(z.object({
      title: z.string().trim().min(3).max(300), description: z.string().max(20000).nullish(), requestTypeId: id, priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
      requestingDeptId: id.nullish(), requesterName: z.string().max(200).nullish(), dueDate: z.coerce.date().nullish(), restricted: z.boolean().default(false),
      counterparty: z.string().max(300).nullish(), contractValue: money.nullish(), currency: z.string().length(3).default('MVR'),
    }).strict(), body));
  }

  @Get('requests/:id')
  @Can('matter:read')
  get(@Param('id') rid: string) {
    return this.drafting.get(rid);
  }

  @Patch('requests/:id')
  @Can('draft:draft')
  update(@Param('id') rid: string, @Body() body: unknown) {
    return this.drafting.update(rid, parse(z.object({ counterparty: z.string().max(300).nullish(), contractValue: money.nullish(), currency: z.string().length(3).optional() }).strict(), body));
  }

  @Post('requests/:id/actions')
  @Can('draft:draft', 'draft:review', 'draft:approve', 'matter:assign', 'intake:triage')
  @HttpCode(200)
  act(@Param('id') rid: string, @Body() body: unknown) {
    return this.drafting.act(rid, parse(z.object({ action: z.enum(actions), comment: z.string().max(5000).optional(), assigneeId: id.optional(), reviewerId: id.optional(), followUpDate: z.coerce.date().optional() }).strict(), body));
  }

  // ------------------------------------------------------------------ library
  @Get('templates')
  @Can('matter:read')
  templates(@Query('q') q?: unknown) {
    return this.reg.templates(qs(q, 100));
  }

  @Post('templates')
  @Can('draft:library')
  createTemplate(@Body() body: unknown) {
    return this.reg.saveTemplate(null, parse(this.templateSchema, body));
  }

  @Patch('templates/:id')
  @Can('draft:library')
  updateTemplate(@Param('id') tid: string, @Body() body: unknown) {
    return this.reg.saveTemplate(tid, parse(this.templateSchema, body));
  }

  private readonly templateSchema = z.object({ name: z.string().trim().min(2).max(200), category: z.string().trim().min(2).max(100), body: z.string().max(100000).nullish(), documentId: id.nullish(), status: z.enum(['DRAFT', 'APPROVED', 'RETIRED']).optional() }).strict();
  private readonly clauseSchema = z.object({ title: z.string().trim().min(2).max(200), body: z.string().trim().min(2).max(50000), tags, status: z.enum(['DRAFT', 'APPROVED', 'RETIRED']).optional() }).strict();

  @Get('clauses')
  @Can('matter:read')
  clauses(@Query('q') q?: unknown, @Query('tag') tag?: unknown) {
    return this.reg.clauses(qs(q, 100), qs(tag, 40));
  }

  @Post('clauses')
  @Can('draft:library')
  createClause(@Body() body: unknown) {
    return this.reg.saveClause(null, parse(this.clauseSchema, body));
  }

  @Patch('clauses/:id')
  @Can('draft:library')
  updateClause(@Param('id') cid: string, @Body() body: unknown) {
    return this.reg.saveClause(cid, parse(this.clauseSchema, body));
  }

  // ------------------------------------------------------------------ contracts
  private readonly contractSchema = z.object({
    matterId: id.nullish(), title: z.string().trim().min(2).max(300), parties: z.array(z.string().trim().min(1).max(300)).max(20), value: money.nullish(),
    currency: z.string().length(3).default('MVR'), startDate: z.coerce.date().nullish(), endDate: z.coerce.date().nullish(), autoRenew: z.boolean().default(false),
    noticePeriodDays: z.number().int().min(0).max(3650).nullish(), ownerDeptId: id.nullish(), keyObligations: z.string().max(20000).nullish(),
    status: z.enum(['ACTIVE', 'EXPIRED', 'TERMINATED', 'RENEWED']).default('ACTIVE'),
  }).strict();

  @Get('contracts')
  @Can('matter:read')
  async contracts(@Query() query: unknown, @Res({ passthrough: true }) res: Response) {
    const q = qrec(query);
    const rows = await this.reg.contracts({ q: q.q?.slice(0, 100), status: q.status || undefined, expiringDays: q.expiringDays ? Number(q.expiringDays) : undefined, ownerDeptId: q.ownerDeptId });
    if (q.format === 'xlsx') {
      return this.exporter.send(res, 'contracts', [
        { key: 'title', header: 'Title', width: 40 }, { key: 'parties', header: 'Parties', width: 40, value: (r) => r.parties.join('; ') }, { key: 'value', header: 'Value', value: (r) => (r.value ? Number(r.value) : '') },
        { key: 'currency', header: 'Ccy' }, { key: 'startDate', header: 'Start', width: 14 }, { key: 'endDate', header: 'End', width: 14 }, { key: 'autoRenew', header: 'Auto-renew' },
        { key: 'noticePeriodDays', header: 'Notice (days)' }, { key: 'status', header: 'Status' },
      ], rows);
    }
    return rows.map((c) => ({ ...c, noticeDeadline: this.reg.noticeDeadline(c) }));
  }

  @Get('contracts/:id')
  @Can('matter:read')
  contract(@Param('id') cid: string) {
    return this.reg.getContract(cid);
  }

  @Post('contracts')
  @Can('draft:draft', 'matter:write')
  createContract(@Body() body: unknown) {
    return this.reg.saveContract(null, parse(this.contractSchema, body));
  }

  @Patch('contracts/:id')
  @Can('draft:draft', 'matter:write')
  updateContract(@Param('id') cid: string, @Body() body: unknown) {
    return this.reg.saveContract(cid, parse(this.contractSchema, body));
  }

  // ------------------------------------------------------------------ powers of attorney
  private readonly poaSchema = z.object({ holderName: z.string().trim().min(2).max(200), holderUserId: id.nullish(), scope: z.string().trim().min(3).max(5000), issuedOn: z.coerce.date(), expiresOn: z.coerce.date().nullish(), matterId: id.nullish() }).strict();

  @Get('poa')
  @Can('matter:read')
  poas(@Query('status') status?: unknown) {
    return this.reg.poas(qs(status, 20));
  }

  @Post('poa')
  @Can('draft:draft', 'matter:write')
  createPoa(@Body() body: unknown) {
    return this.reg.savePoa(null, parse(this.poaSchema, body));
  }

  @Patch('poa/:id')
  @Can('draft:draft', 'matter:write')
  updatePoa(@Param('id') pid: string, @Body() body: unknown) {
    return this.reg.savePoa(pid, parse(this.poaSchema, body));
  }

  @Post('poa/:id/revoke')
  @Can('draft:draft', 'matter:write')
  @HttpCode(200)
  revoke(@Param('id') pid: string, @Body() body: unknown) {
    return this.reg.revokePoa(pid, parse(z.object({ reason: z.string().trim().min(3).max(1000) }).strict(), body).reason);
  }

  // ------------------------------------------------------------------ opinions
  @Get('opinions')
  @Can('matter:read')
  opinions(@Query('q') q?: unknown, @Query('tag') tag?: unknown) {
    return this.reg.opinions(qs(q, 200), qs(tag, 40));
  }

  @Post('opinions')
  @Can('draft:draft', 'matter:write')
  createOpinion(@Body() body: unknown) {
    return this.reg.saveOpinion(null, parse(z.object({ matterId: id.nullish(), title: z.string().trim().min(3).max(300), question: z.string().trim().min(3).max(20000), summary: z.string().trim().min(3).max(50000), tags, issuedOn: z.coerce.date() }).strict(), body));
  }
}
