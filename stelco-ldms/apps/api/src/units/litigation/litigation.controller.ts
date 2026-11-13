import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { LITIGATION_STATUSES } from '@ldms/shared';
import { Can } from '../../common/decorators';
import { badRequest } from '../../common/errors';
import { money, pageQuery, parse } from '../../common/zod';
import { ExportService } from '../../core/export/export.service';
import { CASE_TYPES, LitigationService, OUR_ROLES } from './litigation.service';
import { LIT_FIELDS, LitigationImportService } from './import.service';

const id = z.string().max(40);
const caseSchema = z.object({
  title: z.string().trim().min(3).max(300), description: z.string().max(20000).nullish(), courtCaseNo: z.string().trim().max(100).nullish(),
  courtId: id.nullish(), jurisdiction: z.string().max(200).nullish(), caseType: z.enum(CASE_TYPES), ourRole: z.enum(OUR_ROLES),
  subject: z.string().max(2000).nullish(), externalFirmId: id.nullish(), externalLawyerId: id.nullish(), responsibleOfficerId: id.nullish(),
  claimAmount: money.nullish(), currency: z.string().length(3).toUpperCase().default('MVR'), filingDate: z.coerce.date().nullish(),
  risk: z.enum(['PROBABLE', 'POSSIBLE', 'REMOTE']).nullish(), exposure: money.nullish(), remarks: z.string().max(5000).nullish(),
  requestingDeptId: id.nullish(), restricted: z.boolean().default(false), priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  status: z.enum(LITIGATION_STATUSES).default('PRE_LITIGATION'),
  parties: z.array(z.object({ name: z.string().trim().min(1).max(300), side: z.enum(['PLAINTIFF', 'DEFENDANT', 'THIRD_PARTY', 'OURS', 'OPPOSING', 'OTHER']), counsel: z.string().max(300).nullish() }).strict()).max(30).default([]),
}).strict();
const fieldMap = z.partialRecord(z.enum(Object.keys(LIT_FIELDS) as [string, ...string[]]), z.string().max(200)).transform((v) => Object.fromEntries(Object.entries(v).filter(([, c]) => c)));

@Controller('litigation')
export class LitigationController {
  constructor(private readonly lit: LitigationService, private readonly importer: LitigationImportService, private readonly exporter: ExportService) {}

  @Get('cases')
  @Can('matter:read')
  async list(@Query() query: unknown, @Res({ passthrough: true }) res: Response) {
    const q = parse(pageQuery.extend({ status: z.string().max(40).optional(), firmId: id.optional(), caseType: z.string().max(20).optional(), risk: z.string().max(20).optional(), open: z.enum(['true', 'false']).optional() }), query);
    const filter = { ...q, open: q.open === 'true' };
    if (q.format === 'xlsx') {
      const all = await this.lit.list({ ...filter, page: 1, pageSize: 5000 });
      return this.exporter.send(res, 'active-cases', [
        { key: 'ref', header: 'Reference', value: (r) => r.matter.reference }, { key: 'courtCaseNo', header: 'Court case no.' }, { key: 'title', header: 'Title', width: 40, value: (r) => r.matter.title },
        { key: 'court', header: 'Court', value: (r) => r.court?.name }, { key: 'caseType', header: 'Type' }, { key: 'ourRole', header: 'Our role' },
        { key: 'firm', header: 'External firm', width: 28, value: (r) => r.externalFirm?.name }, { key: 'status', header: 'Status', value: (r) => r.matter.status },
        { key: 'risk', header: 'Risk' }, { key: 'claimAmount', header: 'Claim', value: (r) => (r.claimAmount ? Number(r.claimAmount) : '') }, { key: 'currency', header: 'Ccy' },
        { key: 'nextHearing', header: 'Next hearing', width: 20 }, { key: 'lastUpdateAt', header: 'Last update', width: 20 },
      ], all.rows);
    }
    return this.lit.list(filter);
  }

  @Post('cases')
  @Can('lit:write')
  create(@Body() body: unknown) {
    return this.lit.create(parse(caseSchema, body));
  }

  @Get('cases/:id')
  @Can('matter:read')
  get(@Param('id') caseId: string) {
    return this.lit.get(caseId);
  }

  @Patch('cases/:id')
  @Can('lit:write')
  update(@Param('id') caseId: string, @Body() body: unknown) {
    return this.lit.update(caseId, parse(caseSchema.partial().omit({ status: true, restricted: true, parties: true }).strict(), body));
  }

  @Post('cases/:id/status')
  @Can('lit:write')
  @HttpCode(200)
  status(@Param('id') caseId: string, @Body() body: unknown) {
    const b = parse(z.object({ status: z.enum(LITIGATION_STATUSES), comment: z.string().max(2000).optional() }).strict(), body);
    return this.lit.setStatus(caseId, b.status, b.comment);
  }

  @Post('cases/:id/hearings')
  @Can('lit:write')
  hearing(@Param('id') caseId: string, @Body() body: unknown) {
    return this.lit.addHearing(caseId, parse(z.object({ startsAt: z.coerce.date(), courtId: id.nullish(), judge: z.string().max(200).nullish(), purpose: z.string().max(500).nullish() }).strict(), body));
  }

  @Post('hearings/:id/status')
  @Can('lit:write')
  @HttpCode(200)
  hearingStatus(@Param('id') hid: string, @Body() body: unknown) {
    return this.lit.markHeld(hid, parse(z.object({ status: z.enum(['HELD', 'ADJOURNED', 'CANCELLED']) }).strict(), body).status);
  }

  @Post('hearings/:id/summary')
  @Can('lit:write')
  @HttpCode(200)
  summary(@Param('id') hid: string, @Body() body: unknown) {
    return this.lit.recordSummary(hid, parse(z.object({
      whatHappened: z.string().trim().min(3).max(20000), ordersMade: z.string().max(20000).optional(), nextSteps: z.string().max(20000).optional(),
      companyActions: z.string().max(20000).optional(), outcome: z.string().max(500).nullish(), judge: z.string().max(200).nullish(),
      attendees: z.object({ internal: z.array(z.string().max(200)).max(30), external: z.array(z.string().max(200)).max(30) }).optional(),
      nextHearingAt: z.coerce.date().nullish(),
    }).strict(), body));
  }

  @Post('cases/:id/deadlines')
  @Can('lit:write')
  deadline(@Param('id') caseId: string, @Body() body: unknown) {
    return this.lit.addDeadline(caseId, parse(z.object({ type: z.enum(['FILING', 'SUBMISSION', 'APPEAL', 'LIMITATION', 'OTHER']), title: z.string().trim().min(3).max(300), dueAt: z.coerce.date(), ownerId: id.nullish() }).strict(), body));
  }

  @Post('deadlines/:id/status')
  @Can('lit:write')
  @HttpCode(200)
  deadlineStatus(@Param('id') did: string, @Body() body: unknown) {
    return this.lit.completeDeadline(did, parse(z.object({ status: z.enum(['DONE', 'MISSED', 'OPEN']) }).strict(), body).status);
  }

  @Post('cases/:id/engagements')
  @Can('lit:write')
  engagement(@Param('id') caseId: string, @Body() body: unknown) {
    return this.lit.addEngagement(caseId, parse(z.object({ firmId: id, feeArrangement: z.string().max(2000).nullish(), budget: money.nullish(), currency: z.string().length(3).optional(), startedOn: z.coerce.date().nullish() }).strict(), body));
  }

  @Post('engagements/:id/invoices')
  @Can('lit:write')
  invoice(@Param('id') eid: string, @Body() body: unknown) {
    return this.lit.addInvoice(eid, parse(z.object({ invoiceNo: z.string().trim().min(1).max(100), amount: money, currency: z.string().length(3).optional(), receivedOn: z.coerce.date(), notes: z.string().max(2000).nullish() }).strict(), body));
  }

  @Post('invoices/:id/status')
  @Can('lit:write')
  @HttpCode(200)
  invoiceStatus(@Param('id') iid: string, @Body() body: unknown) {
    return this.lit.invoiceStatus(iid, parse(z.object({ status: z.enum(['RECEIVED', 'VERIFIED', 'SENT_FOR_PAYMENT', 'PAID', 'DISPUTED']) }).strict(), body).status);
  }

  @Post('cases/:id/updates')
  @Can('lit:write')
  update_(@Param('id') caseId: string, @Body() body: unknown) {
    return this.lit.addUpdate(caseId, parse(z.object({ receivedAt: z.coerce.date(), channel: z.enum(['EMAIL', 'PHONE', 'MEETING', 'LETTER']), summary: z.string().trim().min(3).max(20000) }).strict(), body));
  }

  @Post('cases/:id/evaluation')
  @Can('lit:write')
  @HttpCode(200)
  evaluate(@Param('id') caseId: string, @Body() body: unknown) {
    const score = z.number().int().min(1).max(5);
    return this.lit.evaluate(caseId, parse(z.object({ quality: score, responsiveness: score, cost: score, outcome: score, comments: z.string().max(5000).nullish() }).strict(), body));
  }

  @Post('cases/:id/outcomes')
  @Can('lit:write')
  outcome(@Param('id') caseId: string, @Body() body: unknown) {
    return this.lit.addOutcome(caseId, parse(z.object({ kind: z.enum(['SETTLEMENT', 'JUDGMENT']), decidedOn: z.coerce.date(), amount: money.nullish(), currency: z.string().length(3).optional(), direction: z.enum(['PAYABLE', 'RECEIVABLE', 'NONE']), paymentStatus: z.enum(['PENDING', 'PARTIAL', 'PAID', 'NA']).optional(), terms: z.string().max(10000).nullish() }).strict(), body));
  }

  @Patch('outcomes/:id')
  @Can('lit:write')
  outcomeUpdate(@Param('id') oid: string, @Body() body: unknown) {
    return this.lit.updateOutcome(oid, parse(z.object({ paymentStatus: z.enum(['PENDING', 'PARTIAL', 'PAID', 'NA']).optional(), amount: money.nullish() }).strict(), body));
  }

  @Post('outcomes/:id/enforcement')
  @Can('lit:write')
  enforcement(@Param('id') oid: string, @Body() body: unknown) {
    return this.lit.addEnforcement(oid, parse(z.object({ on: z.coerce.date(), action: z.string().trim().min(3).max(2000), status: z.enum(['OPEN', 'DONE', 'FAILED']).optional() }).strict(), body));
  }

  // ------------------------------------------------------------------ reports
  @Get('reports/exposure')
  @Can('report:read')
  async exposure(@Query('format') format: string | undefined, @Res({ passthrough: true }) res: Response) {
    const r = await this.lit.exposureReport();
    if (format === 'xlsx') {
      return this.exporter.send(res, 'contingent-liability', [
        { key: 'reference', header: 'Reference' }, { key: 'courtCaseNo', header: 'Court case no.' }, { key: 'title', header: 'Title', width: 40 }, { key: 'court', header: 'Court' },
        { key: 'firm', header: 'External firm', width: 26 }, { key: 'caseType', header: 'Type' }, { key: 'ourRole', header: 'Our role' }, { key: 'status', header: 'Status' },
        { key: 'risk', header: 'Risk assessment' }, { key: 'currency', header: 'Ccy' }, { key: 'claimAmount', header: 'Claim amount' }, { key: 'exposure', header: 'Estimated exposure' },
      ], r.rows);
    }
    return r;
  }

  @Get('reports/upcoming-hearings')
  @Can('matter:read')
  upcoming(@Query('days') days?: string) {
    return this.lit.upcomingHearings(Math.min(365, Number(days) || 30));
  }

  @Get('reports/missing-summaries')
  @Can('matter:read')
  missing() {
    return this.lit.missingSummaries();
  }

  @Get('reports/stale')
  @Can('matter:read')
  stale(@Query('days') days?: string) {
    return this.lit.staleCases(days ? Math.max(1, Number(days)) : undefined);
  }

  @Get('reports/breakdown')
  @Can('matter:read')
  breakdown() {
    return this.lit.breakdown();
  }

  // ------------------------------------------------------------------ register import
  @Get('import')
  @Can('lit:import')
  imports() {
    return this.importer.list();
  }

  @Get('import/template')
  @Can('lit:import')
  async template(@Res() res: Response) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="litigation-register-template.xlsx"');
    res.end(await this.importer.template());
  }

  @Post('import')
  @Can('lit:import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024, files: 1 } }))
  upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw badRequest('Choose the Excel register to upload');
    return this.importer.upload(file);
  }

  @Post('import/mappings')
  @Can('lit:import')
  mapping(@Body() body: unknown) {
    const b = parse(z.object({ name: z.string().trim().min(1).max(80), columnMap: fieldMap }).strict(), body);
    return this.importer.saveMapping(b.name, b.columnMap);
  }

  @Post('import/:id/preview')
  @Can('lit:import')
  @HttpCode(200)
  preview(@Param('id') bid: string, @Body() body: unknown) {
    const b = parse(z.object({ columnMap: fieldMap, createMissing: z.boolean().default(true), defaultCurrency: z.string().length(3).default('MVR') }).strict(), body);
    return this.importer.preview(bid, b.columnMap, { createMissing: b.createMissing, defaultCurrency: b.defaultCurrency });
  }

  @Post('import/:id/commit')
  @Can('lit:import')
  @HttpCode(200)
  commit(@Param('id') bid: string) {
    return this.importer.commit(bid);
  }

  @Post('import/:id/rollback')
  @Can('lit:import.rollback')
  @HttpCode(200)
  rollback(@Param('id') bid: string, @Body() body: unknown) {
    return this.importer.rollback(bid, parse(z.object({ reason: z.string().trim().min(3).max(1000) }).strict(), body).reason);
  }

  @Get('import/:id/errors')
  @Can('lit:import')
  async errors(@Param('id') bid: string, @Res() res: Response) {
    const buf = await this.importer.errorReport(bid);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="import-errors.xlsx"');
    res.setHeader('Cache-Control', 'no-store');
    res.end(buf);
  }
}
