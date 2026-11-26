import { Body, Controller, Get, HttpCode, Param, Post, Query, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { UNITS } from '@ldms/shared';
import { Can } from '../../common/decorators';
import { currentUser } from '../../common/context';
import { badRequest } from '../../common/errors';
import { pageQuery, parse } from '../../common/zod';
import { IntakeService } from './intake.service';
import { ManualIntakeSource, PortalIntakeSource } from './intake-source';

const priority = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
const manualSchema = z.object({
  source: z.enum(['EMAIL', 'LETTER', 'PHONE', 'WALKIN']),
  receivedAt: z.coerce.date(),
  senderName: z.string().trim().min(1).max(200),
  senderEmail: z.string().trim().email().max(200).optional().or(z.literal('')),
  senderDeptId: z.string().max(40).optional().or(z.literal('')),
  subject: z.string().trim().min(1).max(300),
  summary: z.string().max(20000).optional(),
  emailRef: z.string().max(300).optional(),
  priority: priority.default('NORMAL'),
  dueDate: z.coerce.date().optional().or(z.literal('')),
  suggestedUnit: z.enum(UNITS).optional().or(z.literal('')),
}).strict();
const portalSchema = z.object({
  subject: z.string().trim().min(3).max(300), summary: z.string().trim().min(10).max(20000), priority: priority.default('NORMAL'),
  dueDate: z.coerce.date().optional().or(z.literal('')), suggestedUnit: z.enum(UNITS).optional().or(z.literal('')),
}).strict();
const convertSchema = z.object({
  unit: z.enum(UNITS), requestTypeId: z.string().max(40).nullish(), title: z.string().trim().min(3).max(300).optional(), priority: priority.optional(),
  dueDate: z.coerce.date().nullish(), restricted: z.boolean().default(false), assigneeIds: z.array(z.string().max(40)).max(5).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
}).strict();

const files = () => FileFieldsInterceptor([{ name: 'email', maxCount: 1 }, { name: 'attachments', maxCount: 10 }], { limits: { fileSize: Number(process.env.MAX_UPLOAD_MB ?? 50) * 1024 * 1024 } });
type Files = { email?: Express.Multer.File[]; attachments?: Express.Multer.File[] };
const blank = <T>(v: T | '' | undefined) => (v === '' || v === undefined ? null : v);

@Controller('intake')
export class IntakeController {
  constructor(private readonly intake: IntakeService) {}

  /** Read a saved Outlook email and return pre-fill data. Nothing is stored. */
  @Post('parse-email')
  @Can('intake:create')
  @HttpCode(200)
  @UseInterceptors(files())
  async parseEmail(@UploadedFiles() f: Files) {
    const file = f?.email?.[0];
    if (!file) throw badRequest('Choose an .msg or .eml file');
    const p = await this.intake.parseEmailFile(file);
    return {
      senderName: p.fromName ?? p.fromAddr ?? '', senderEmail: p.fromAddr ?? '', receivedAt: p.sentAt, subject: p.subject ?? '',
      summary: p.text.slice(0, 5000), emailRef: p.internetMessageId, to: p.to, cc: p.cc, htmlSanitized: p.htmlSanitized,
      attachments: p.attachments.map((a) => ({ filename: a.filename, size: a.content.length })),
    };
  }

  @Post()
  @Can('intake:create')
  @UseInterceptors(files())
  async create(@Body() body: unknown, @UploadedFiles() f: Files) {
    const b = parse(manualSchema, body);
    const emailFile = f?.email?.[0];
    const email = emailFile ? await this.intake.parseEmailFile(emailFile) : null;
    const n = new ManualIntakeSource().toIntake({
      ...b, senderEmail: blank(b.senderEmail), senderDeptId: blank(b.senderDeptId), dueDate: blank(b.dueDate) as Date | null,
      suggestedUnit: blank(b.suggestedUnit) as never, email,
    });
    const i = await this.intake.create(n, { emailFile, attachments: f?.attachments ?? [] });
    return { id: i.id, intakeNo: i.intakeNo };
  }

  @Get()
  @Can('intake:read')
  list(@Query() query: unknown) {
    const q = parse(pageQuery.extend({ status: z.string().max(20).optional(), source: z.string().max(20).optional() }), query);
    return this.intake.list(q);
  }

  @Get(':id')
  @Can('intake:read', 'portal:use')
  get(@Param('id') id: string) {
    return this.intake.get(id);
  }

  @Post(':id/convert')
  @Can('intake:triage')
  @HttpCode(200)
  convert(@Param('id') id: string, @Body() body: unknown) {
    return this.intake.convert(id, parse(convertSchema, body));
  }

  @Post(':id/link')
  @Can('intake:triage')
  @HttpCode(200)
  link(@Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ matterId: z.string().max(40), note: z.string().max(2000).optional() }).strict(), body);
    return this.intake.linkToMatter(id, b.matterId, b.note);
  }

  @Post(':id/not-legal')
  @Can('intake:triage')
  @HttpCode(200)
  notLegal(@Param('id') id: string, @Body() body: unknown) {
    return this.intake.close(id, 'not_legal', parse(z.object({ reason: z.string().trim().min(3).max(2000) }).strict(), body).reason);
  }

  @Post(':id/duplicate')
  @Can('intake:triage')
  @HttpCode(200)
  duplicate(@Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ duplicateOfId: z.string().max(40), reason: z.string().max(2000).default('Duplicate') }).strict(), body);
    return this.intake.close(id, 'duplicate', b.reason, b.duplicateOfId);
  }

  @Post(':id/reopen')
  @Can('intake:assign')
  @HttpCode(200)
  reopen(@Param('id') id: string, @Body() body: unknown) {
    return this.intake.reopen(id, parse(z.object({ reason: z.string().trim().min(3).max(2000) }).strict(), body).reason);
  }

  @Post(':id/assign')
  @Can('intake:triage')
  @HttpCode(200)
  assign(@Param('id') id: string, @Body() body: unknown) {
    return this.intake.assignHandler(id, parse(z.object({ assigneeId: z.string().max(40) }).strict(), body).assigneeId);
  }

  @Post(':id/send-ack')
  @Can('intake:triage')
  @HttpCode(200)
  sendAck(@Param('id') id: string) {
    return this.intake.sendAck(id);
  }
}

/** Requester portal: departments submit requests and follow their status. */
@Controller('portal')
export class PortalController {
  constructor(private readonly intake: IntakeService) {}

  @Post('requests')
  @Can('portal:use')
  @UseInterceptors(files())
  async submit(@Body() body: unknown, @UploadedFiles() f: Files) {
    const b = parse(portalSchema, body);
    const u = currentUser();
    const n = new PortalIntakeSource().toIntake({ user: u, subject: b.subject, summary: b.summary, priority: b.priority, dueDate: blank(b.dueDate) as Date | null, suggestedUnit: blank(b.suggestedUnit) as never });
    const i = await this.intake.create(n, { attachments: f?.attachments ?? [] });
    return { id: i.id, intakeNo: i.intakeNo };
  }
}
