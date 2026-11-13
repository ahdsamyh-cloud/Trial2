import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { SESSION_STATUSES } from '@ldms/shared';
import { Authenticated, Can, Public } from '../../common/decorators';
import { badRequest } from '../../common/errors';
import { parse, qrec, qs } from '../../common/zod';
import { AwarenessService } from './awareness.service';

const id = z.string().max(40);
const ids = z.array(id).max(100).default([]);
const sessionSchema = z.object({
  planItemId: id.nullish(), title: z.string().trim().min(3).max(300), topic: z.string().trim().min(2).max(300), format: z.enum(['IN_PERSON', 'ONLINE', 'ELEARNING', 'CIRCULAR']),
  startsAt: z.coerce.date(), endsAt: z.coerce.date(), venue: z.string().max(300).nullish(), meetingUrl: z.string().url().max(500).nullish(),
  audienceDeptIds: ids, presenterIds: ids, preparerIds: ids,
}).strict();
const xlsx = () => FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

@Controller('awareness')
export class AwarenessController {
  constructor(private readonly awr: AwarenessService) {}

  // plan
  @Get('plans/:year')
  @Can('matter:read', 'awr:write')
  plan(@Param('year') year: string) {
    return this.awr.plan(z.coerce.number().int().min(2000).max(2100).parse(year));
  }

  @Post('plans/:year/approve')
  @Can('awr:write')
  @HttpCode(200)
  approvePlan(@Param('year') year: string) {
    return this.awr.approvePlan(z.coerce.number().int().min(2000).max(2100).parse(year));
  }

  @Post('plan-items')
  @Can('awr:write')
  addItem(@Body() body: unknown) {
    return this.awr.savePlanItem(null, parse(z.object({ year: z.number().int().min(2000).max(2100), topic: z.string().trim().min(2).max(300), targetDeptIds: ids, quarter: z.number().int().min(1).max(4) }).strict(), body));
  }

  @Patch('plan-items/:id')
  @Can('awr:write')
  updateItem(@Param('id') iid: string, @Body() body: unknown) {
    return this.awr.savePlanItem(iid, parse(z.object({ topic: z.string().trim().min(2).max(300), targetDeptIds: ids, quarter: z.number().int().min(1).max(4), status: z.enum(['PLANNED', 'DONE', 'DROPPED']).optional() }).strict(), body));
  }

  // sessions
  @Get('sessions')
  @Authenticated()
  sessions(@Query() query: unknown) {
    const q = qrec(query);
    return this.awr.sessions({ from: q.from ? new Date(q.from) : undefined, to: q.to ? new Date(q.to) : undefined, status: q.status });
  }

  @Get('sessions/:id')
  @Authenticated()
  get(@Param('id') sid: string) {
    return this.awr.get(sid);
  }

  @Post('sessions')
  @Can('awr:write')
  create(@Body() body: unknown) {
    return this.awr.save(null, parse(sessionSchema, body));
  }

  @Patch('sessions/:id')
  @Can('awr:write')
  update(@Param('id') sid: string, @Body() body: unknown) {
    return this.awr.save(sid, parse(sessionSchema, body));
  }

  @Post('sessions/:id/status')
  @Can('awr:write')
  @HttpCode(200)
  status(@Param('id') sid: string, @Body() body: unknown) {
    return this.awr.setStatus(sid, parse(z.object({ status: z.enum(SESSION_STATUSES) }).strict(), body).status);
  }

  @Post('sessions/:id/attendance')
  @Can('awr:write')
  @HttpCode(200)
  attend(@Param('id') sid: string, @Body() body: unknown) {
    return this.awr.addAttendance(sid, parse(z.object({ employeeIds: z.array(id).min(1).max(500) }).strict(), body).employeeIds);
  }

  @Delete('sessions/:id/attendance/:employeeId')
  @Can('awr:write')
  unattend(@Param('id') sid: string, @Param('employeeId') eid: string) {
    return this.awr.removeAttendance(sid, eid);
  }

  @Post('sessions/:id/attendance/import')
  @Can('awr:write')
  @UseInterceptors(xlsx())
  importAttendance(@Param('id') sid: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw badRequest('Choose the attendance sheet');
    return this.awr.importAttendance(sid, file);
  }

  @Post('sessions/:id/checkin-link')
  @Can('awr:write')
  @HttpCode(200)
  checkinLink(@Param('id') sid: string) {
    return this.awr.checkinLink(sid);
  }

  @Post('sessions/:id/checkin-close')
  @Can('awr:write')
  @HttpCode(200)
  closeCheckin(@Param('id') sid: string) {
    return this.awr.closeCheckin(sid);
  }

  @Post('sessions/:id/quiz')
  @Can('awr:write')
  @HttpCode(200)
  quiz(@Param('id') sid: string, @Body() body: unknown) {
    return this.awr.saveQuiz(sid, parse(z.object({ questions: z.array(z.object({ question: z.string().trim().min(3).max(500), options: z.array(z.string().trim().min(1).max(200)).min(2).max(6), answer: z.number().int().min(0) }).strict()).max(20) }).strict(), body).questions);
  }

  // public check-in (QR) and feedback — signed, expiring token; rate-limited
  @Get('public/checkin/:token')
  @Public()
  checkinInfo(@Param('token') token: string) {
    return this.awr.checkinInfo(token.slice(0, 500));
  }

  @Post('public/checkin/:token')
  @Public()
  @HttpCode(200)
  checkin(@Param('token') token: string, @Body() body: unknown) {
    return this.awr.checkin(token.slice(0, 500), parse(z.object({ staffNo: z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9/-]+$/) }).strict(), body).staffNo);
  }

  @Post('public/feedback/:token')
  @Public()
  @HttpCode(200)
  feedback(@Param('token') token: string, @Body() body: unknown) {
    return this.awr.feedback(token.slice(0, 500), parse(z.object({ rating: z.number().int().min(1).max(5), comments: z.string().max(2000).optional(), answers: z.record(id, z.number().int().min(0).max(10)).optional() }).strict(), body));
  }

  // employees & records
  @Get('employees')
  @Can('matter:read', 'awr:write')
  employees(@Query('q') q?: unknown, @Query('departmentId') departmentId?: unknown) {
    return this.awr.employees(qs(q, 100), qs(departmentId, 40));
  }

  @Get('employees/:id/history')
  @Can('matter:read', 'awr:write')
  history(@Param('id') eid: string) {
    return this.awr.history(eid);
  }

  @Post('employees/import')
  @Can('awr:write')
  @UseInterceptors(xlsx())
  importEmployees(@UploadedFile() file: Express.Multer.File | undefined, @Query('commit') commit?: unknown) {
    if (!file) throw badRequest('Choose the staff list');
    return this.awr.importEmployees(file, qs(commit, 5) === 'true');
  }

  // bulletins & FAQ (knowledge base: everyone signed in can read)
  @Get('bulletins')
  @Authenticated()
  bulletins() {
    return this.awr.bulletins();
  }

  @Post('bulletins')
  @Can('awr:write')
  createBulletin(@Body() body: unknown) {
    return this.awr.saveBulletin(null, parse(this.bulletinSchema, body));
  }

  @Patch('bulletins/:id')
  @Can('awr:write')
  updateBulletin(@Param('id') bid: string, @Body() body: unknown) {
    return this.awr.saveBulletin(bid, parse(this.bulletinSchema, body));
  }

  @Post('bulletins/:id/publish')
  @Can('awr:write')
  @HttpCode(200)
  publish(@Param('id') bid: string) {
    return this.awr.publishBulletin(bid);
  }

  private readonly bulletinSchema = z.object({ title: z.string().trim().min(3).max(300), body: z.string().trim().min(3).max(50000), kind: z.enum(['BULLETIN', 'NEWSLETTER', 'CIRCULAR']).default('BULLETIN'), audienceDeptIds: ids }).strict();
  private readonly faqSchema = z.object({ question: z.string().trim().min(3).max(500), answer: z.string().trim().min(3).max(20000), tags: z.array(z.string().max(40)).max(20).default([]), published: z.boolean().default(true) }).strict();

  @Get('faq')
  @Authenticated()
  faq(@Query('q') q?: unknown) {
    return this.awr.faq(qs(q, 100));
  }

  @Post('faq')
  @Can('awr:write')
  createFaq(@Body() body: unknown) {
    return this.awr.saveFaq(null, parse(this.faqSchema, body));
  }

  @Patch('faq/:id')
  @Can('awr:write')
  updateFaq(@Param('id') fid: string, @Body() body: unknown) {
    return this.awr.saveFaq(fid, parse(this.faqSchema, body));
  }

  @Get('reports/:year')
  @Can('matter:read', 'awr:write', 'report:read', 'dashboard:mgmt')
  report(@Param('year') year: string) {
    return this.awr.report(z.coerce.number().int().min(2000).max(2100).parse(year));
  }
}
