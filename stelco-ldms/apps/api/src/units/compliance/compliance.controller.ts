import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Can } from '../../common/decorators';
import { parse } from '../../common/zod';
import { ComplianceService, FREQUENCIES } from './compliance.service';

const id = z.string().max(40);
const sev = z.enum(['HIGH', 'MEDIUM', 'LOW']);
const lawSchema = z.object({
  title: z.string().trim().min(3).max(300), type: z.enum(['ACT', 'REGULATION', 'CIRCULAR', 'GUIDELINE', 'DIRECTIVE']), regulatorId: id.nullish(),
  issuedOn: z.coerce.date().nullish(), effectiveOn: z.coerce.date().nullish(), status: z.enum(['IN_FORCE', 'AMENDED', 'REPEALED']).optional(),
  sourceUrl: z.string().url().max(500).nullish(), summary: z.string().max(20000).nullish(), officerId: id.nullish(),
}).strict();
const obligationSchema = z.object({
  lawId: id, description: z.string().trim().min(3).max(5000), article: z.string().max(100).nullish(), frequency: z.enum(FREQUENCIES),
  evidenceRequired: z.string().max(5000).nullish(), risk: sev, penalty: z.string().max(5000).nullish(), ownerId: id.nullish(),
  departmentIds: z.array(id).min(1).max(40), active: z.boolean().optional(),
}).strict();
const licenceSchema = z.object({
  name: z.string().trim().min(2).max(300), kind: z.enum(['LICENCE', 'PERMIT', 'FILING']), regulatorId: id.nullish(), number: z.string().max(100).nullish(),
  issuedOn: z.coerce.date().nullish(), expiresOn: z.coerce.date().nullish(), ownerDeptId: id.nullish(), status: z.enum(['ACTIVE', 'EXPIRED', 'SURRENDERED']).optional(), notes: z.string().max(5000).nullish(),
}).strict();
const changeSchema = z.object({
  lawId: id, kind: z.enum(['NEW', 'AMENDED', 'REPEALED']), impact: z.string().max(20000).nullish(), affectedDeptIds: z.array(id).max(40).optional(),
  officerId: id.nullish(), status: z.enum(['IDENTIFIED', 'IMPACT_ASSESSMENT', 'COMMUNICATED', 'IMPLEMENTING', 'IMPLEMENTED']).optional(),
}).strict();

@Controller('compliance')
export class ComplianceController {
  constructor(private readonly cmp: ComplianceService) {}

  @Get('dashboard')
  @Can('matter:read', 'cmp:write', 'dashboard:hod')
  dashboard() {
    return this.cmp.dashboard();
  }

  // laws
  @Get('laws')
  @Can('matter:read', 'cmp:write', 'portal:use')
  laws(@Query() q: Record<string, string>) {
    return this.cmp.laws({ q: q.q?.slice(0, 100), type: q.type, status: q.status, regulatorId: q.regulatorId });
  }

  @Get('laws/:id')
  @Can('matter:read', 'cmp:write', 'portal:use')
  law(@Param('id') lid: string) {
    return this.cmp.getLaw(lid);
  }

  @Post('laws')
  @Can('cmp:write')
  createLaw(@Body() body: unknown) {
    return this.cmp.saveLaw(null, parse(lawSchema, body));
  }

  @Patch('laws/:id')
  @Can('cmp:write')
  updateLaw(@Param('id') lid: string, @Body() body: unknown) {
    return this.cmp.saveLaw(lid, parse(lawSchema, body));
  }

  @Post('laws/:id/versions')
  @Can('cmp:write')
  version(@Param('id') lid: string, @Body() body: unknown) {
    return this.cmp.addVersion(lid, parse(z.object({ notes: z.string().trim().min(3).max(5000), effectiveOn: z.coerce.date().nullish(), status: z.enum(['AMENDED', 'REPEALED', 'IN_FORCE']).optional() }).strict(), body));
  }

  // obligations
  @Get('obligations')
  @Can('matter:read', 'cmp:write', 'portal:use')
  obligations(@Query() q: Record<string, string>) {
    return this.cmp.obligations({ lawId: q.lawId, departmentId: q.departmentId, q: q.q?.slice(0, 100) });
  }

  @Post('obligations')
  @Can('cmp:write')
  createObligation(@Body() body: unknown) {
    return this.cmp.saveObligation(null, parse(obligationSchema, body));
  }

  @Patch('obligations/:id')
  @Can('cmp:write')
  updateObligation(@Param('id') oid: string, @Body() body: unknown) {
    return this.cmp.saveObligation(oid, parse(obligationSchema, body));
  }

  // change log
  @Get('changes')
  @Can('matter:read', 'cmp:write')
  changes(@Query('status') status?: string) {
    return this.cmp.changes(status);
  }

  @Post('changes')
  @Can('cmp:write')
  createChange(@Body() body: unknown) {
    return this.cmp.saveChange(null, parse(changeSchema, body));
  }

  @Patch('changes/:id')
  @Can('cmp:write')
  updateChange(@Param('id') cid: string, @Body() body: unknown) {
    return this.cmp.saveChange(cid, parse(changeSchema.partial().extend({ lawId: id }).strict(), body));
  }

  // dissemination
  @Get('disseminations')
  @Can('matter:read', 'cmp:write', 'portal:use')
  disseminations() {
    return this.cmp.disseminations();
  }

  @Post('disseminations')
  @Can('cmp:disseminate')
  disseminate(@Body() body: unknown) {
    return this.cmp.disseminate(parse(z.object({ subject: z.string().trim().min(3).max(300), body: z.string().trim().min(3).max(20000), lawId: id.nullish(), obligationId: id.nullish(), departmentIds: z.array(id).min(1).max(40) }).strict(), body));
  }

  @Post('acknowledgements/:id')
  @Can('portal:respond')
  @HttpCode(200)
  acknowledge(@Param('id') rid: string) {
    return this.cmp.acknowledge(rid);
  }

  // checks
  @Post('cycles/run')
  @Can('cmp:write')
  @HttpCode(200)
  run() {
    return this.cmp.generateCycles();
  }

  @Get('cycles')
  @Can('matter:read', 'cmp:write', 'portal:use')
  cycles(@Query() q: Record<string, string>) {
    return this.cmp.cycles({ status: q.status, departmentId: q.departmentId });
  }

  @Get('cycles/:id')
  @Can('matter:read', 'cmp:write', 'portal:use')
  cycle(@Param('id') cid: string) {
    return this.cmp.cycle(cid);
  }

  @Post('items/:id/response')
  @Can('portal:respond', 'cmp:write')
  @HttpCode(200)
  respond(@Param('id') iid: string, @Body() body: unknown) {
    return this.cmp.respond(iid, parse(z.object({ response: z.string().trim().min(1).max(20000) }).strict(), body).response);
  }

  @Post('cycles/:id/submit')
  @Can('portal:respond')
  @HttpCode(200)
  submit(@Param('id') cid: string) {
    return this.cmp.submitCycle(cid);
  }

  @Post('items/:id/rating')
  @Can('cmp:review')
  @HttpCode(200)
  rate(@Param('id') iid: string, @Body() body: unknown) {
    const b = parse(z.object({ rating: z.enum(['COMPLIANT', 'PARTIAL', 'NON_COMPLIANT', 'NA']), note: z.string().max(5000).optional(), severity: sev.optional() }).strict(), body);
    return this.cmp.rate(iid, b.rating, b.note, b.severity);
  }

  @Post('cycles/:id/return')
  @Can('cmp:review')
  @HttpCode(200)
  returnCycle(@Param('id') cid: string, @Body() body: unknown) {
    return this.cmp.returnCycle(cid, parse(z.object({ note: z.string().trim().min(3).max(5000) }).strict(), body).note);
  }

  // findings
  @Get('findings')
  @Can('matter:read', 'cmp:write', 'portal:use')
  findings(@Query() q: Record<string, string>) {
    return this.cmp.findings({ status: q.status, departmentId: q.departmentId, severity: q.severity, overdue: q.overdue === 'true' });
  }

  @Get('findings/:id')
  @Can('matter:read', 'cmp:write', 'portal:use')
  finding(@Param('id') fid: string) {
    return this.cmp.finding(fid);
  }

  @Post('findings/:id/step')
  @Can('cmp:write', 'portal:respond')
  @HttpCode(200)
  step(@Param('id') fid: string, @Body() body: unknown) {
    const b = parse(z.object({ to: z.enum(['ACTION_PLAN_AGREED', 'EVIDENCE_SUBMITTED', 'CLOSED']), actionPlan: z.string().max(20000).optional(), ownerId: id.nullish(), note: z.string().max(5000).optional() }).strict(), body);
    return this.cmp.findingStep(fid, b.to, b);
  }

  // licences
  @Get('licences')
  @Can('matter:read', 'cmp:write')
  licences(@Query('expiringDays') days?: string) {
    return this.cmp.licences({ expiringDays: days ? Number(days) : undefined });
  }

  @Post('licences')
  @Can('cmp:write')
  createLicence(@Body() body: unknown) {
    return this.cmp.saveLicence(null, parse(licenceSchema, body));
  }

  @Patch('licences/:id')
  @Can('cmp:write')
  updateLicence(@Param('id') lid: string, @Body() body: unknown) {
    return this.cmp.saveLicence(lid, parse(licenceSchema, body));
  }
}
