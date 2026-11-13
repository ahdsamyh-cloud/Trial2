import { Injectable } from '@nestjs/common';
import { Intake, Matter, Prisma, Priority, Unit } from '@prisma/client';
import { findTransition, intakeMachine, IntakeStatus, renderTemplate, UNIT_NAMES } from '@ldms/shared';
import { currentUser } from '../../common/context';
import { badRequest, conflict, forbidden, notFound } from '../../common/errors';
import { PrismaService, Tx } from '../../common/prisma.service';
import { config } from '../../config';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../config/settings.service';
import { DocumentsService } from '../documents/documents.service';
import { FileRejected, sniff } from '../documents/filetype';
import { MattersService } from '../matters/matters.service';
import { ReferenceService } from '../matters/reference.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PolicyService } from '../policy/policy.service';
import { SlaService } from '../sla/sla.service';
import { parseEml, parseMsg, ParsedEmail } from './email-parser';
import { NormalisedIntake } from './intake-source';

export interface ConvertInput {
  unit: Unit;
  requestTypeId?: string | null;
  title?: string;
  priority?: Priority;
  dueDate?: Date | null;
  restricted?: boolean;
  assigneeIds?: string[];
  extra?: Record<string, unknown>;
}

/** Unit modules register how an intake becomes their kind of matter. */
export type Converter = (tx: Tx, intake: Intake, input: ConvertInput) => Promise<Matter>;

@Injectable()
export class IntakeService {
  private readonly converters = new Map<Unit, Converter>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly refs: ReferenceService,
    private readonly matters: MattersService,
    private readonly documents: DocumentsService,
    private readonly sla: SlaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly policy: PolicyService,
    private readonly settings: SettingsService,
  ) {}

  registerConverter(unit: Unit, fn: Converter) {
    this.converters.set(unit, fn);
  }

  /** Parse an uploaded .msg/.eml (after signature check) to pre-fill the intake form. */
  async parseEmailFile(file: { originalname: string; buffer: Buffer }): Promise<ParsedEmail> {
    let kind;
    try {
      kind = sniff(file.originalname, file.buffer).kind;
    } catch (e) {
      if (e instanceof FileRejected) throw badRequest(e.message);
      throw e;
    }
    if (kind !== 'eml' && kind !== 'msg') throw badRequest('Upload a saved Outlook email (.msg or .eml)');
    try {
      return kind === 'eml' ? await parseEml(file.buffer) : parseMsg(file.buffer);
    } catch {
      throw badRequest('This email file could not be read');
    }
  }

  async create(n: NormalisedIntake, files: { emailFile?: { originalname: string; buffer: Buffer }; attachments: { originalname: string; buffer: Buffer }[] }) {
    if (n.email?.internetMessageId) {
      const existing = await this.prisma.db.emailMessage.findUnique({ where: { internetMessageId: n.email.internetMessageId }, include: { intake: { select: { id: true, intakeNo: true } } } });
      if (existing) throw conflict(`This email was already recorded as ${existing.intake.intakeNo}`, { intakeId: existing.intake.id });
    }
    const user = currentUser();
    const intake = await this.prisma.tx(async (tx) => {
      const intakeNo = await this.refs.next(tx, 'INT', n.receivedAt);
      const i = await tx.intake.create({
        data: {
          intakeNo, source: n.source, adapter: n.adapter, receivedAt: n.receivedAt, senderName: n.senderName, senderEmail: n.senderEmail,
          senderDeptId: n.senderDeptId, subject: n.subject, summary: n.summary, emailRef: n.emailRef, priority: n.priority, dueDate: n.dueDate,
          suggestedUnit: n.suggestedUnit, submittedById: n.submittedById, createdById: user.id,
        },
      });
      if (n.email) {
        await tx.emailMessage.create({
          data: {
            intakeId: i.id, adapter: n.adapter, internetMessageId: n.email.internetMessageId, graphMessageId: n.email.graphMessageId ?? null,
            conversationId: n.email.conversationId, fromName: n.email.fromName, fromAddr: n.email.fromAddr, to: n.email.to, cc: n.email.cc,
            sentAt: n.email.sentAt, receivedAt: n.receivedAt, subject: n.email.subject, bodyText: n.email.text, bodyHtmlSanitized: n.email.htmlSanitized,
          },
        });
      }
      return i;
    });
    await this.sla.start({ policyCode: 'REGISTER_ACK', step: 'REGISTER_ACK', startedAt: n.receivedAt, urgent: n.priority === 'URGENT', subjectType: 'Intake', subjectId: intake.id });

    // Original email + its attachments + other attachments: each scanned before use.
    if (files.emailFile) {
      const up = await this.documents.upload({ ownerType: 'intake', ownerId: intake.id, title: `Original email: ${n.subject}`.slice(0, 200), docTypeCode: 'EMAIL', file: files.emailFile, skipAccessCheck: true });
      await this.prisma.db.emailMessage.updateMany({ where: { intakeId: intake.id }, data: { originalDocId: up.documentId } });
    }
    for (const a of n.email?.attachments ?? []) {
      try { await this.documents.upload({ ownerType: 'intake', ownerId: intake.id, file: { originalname: a.filename, buffer: a.content }, docTypeCode: 'ATTACHMENT', skipAccessCheck: true }); }
      catch (e) { await this.audit.log({ action: 'intake.attachment.rejected', entityType: 'Intake', entityId: intake.id, meta: { filename: a.filename, reason: (e as Error).message } }); }
    }
    for (const f of files.attachments) await this.documents.upload({ ownerType: 'intake', ownerId: intake.id, file: f, docTypeCode: 'ATTACHMENT', skipAccessCheck: true });

    await this.audit.log({ action: 'intake.created', entityType: 'Intake', entityId: intake.id, after: { intakeNo: intake.intakeNo, source: n.source, adapter: n.adapter, subject: n.subject } });
    const triagers = [...(await this.notifications.usersWithRole('PARALEGAL')), ...(n.suggestedUnit ? await this.notifications.usersWithRole('UNIT_HEAD', n.suggestedUnit) : [])];
    await this.notifications.notify(triagers.filter((t) => t !== user.id), { type: 'intake.new', title: `New request ${intake.intakeNo}: ${n.subject}`, link: `/intake/${intake.id}` });
    return intake;
  }

  async list(f: { status?: string; q?: string; source?: string; page: number; pageSize: number }) {
    if (!currentUser().perms.has('intake:read')) throw forbidden();
    const where: Prisma.IntakeWhereInput = {
      ...(f.status ? { status: f.status } : {}),
      ...(f.source ? { source: f.source as never } : {}),
      ...(f.q ? { OR: [{ subject: { contains: f.q, mode: 'insensitive' } }, { intakeNo: { contains: f.q, mode: 'insensitive' } }, { senderName: { contains: f.q, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.intake.findMany({ where, orderBy: { receivedAt: 'desc' }, skip: (f.page - 1) * f.pageSize, take: f.pageSize, include: { matter: { select: { id: true, reference: true, restricted: true } } } }),
      this.prisma.db.intake.count({ where }),
    ]);
    // Never reveal a restricted matter's reference to people outside the wall.
    const visible = new Set((await this.prisma.db.matter.findMany({ where: { AND: [{ id: { in: rows.map((r) => r.matterId).filter((x): x is string => !!x) } }, this.policy.matterScope()] }, select: { id: true } })).map((m) => m.id));
    return { rows: rows.map((r) => ({ ...r, matter: r.matter && visible.has(r.matter.id) ? r.matter : r.matter ? { id: null, reference: 'Restricted', restricted: true } : null })), total };
  }

  async get(id: string) {
    const user = currentUser();
    const i = await this.prisma.db.intake.findUnique({ where: { id }, include: { email: true } });
    if (!i) throw notFound('Intake');
    if (!user.perms.has('intake:read') && i.submittedById !== user.id) throw notFound('Intake');
    const docs = user.perms.has('intake:read') ? await this.documents.listFor('intake', id) : [];
    await this.audit.log({ action: 'intake.view', entityType: 'Intake', entityId: id });
    return { ...i, documents: docs, ackText: await this.ackText(i) };
  }

  async ackText(i: Intake, matter?: { reference: string; unit: Unit; dueDate: Date | null } | null) {
    const code = await this.settings.get<string>('intake.ackTemplateCode');
    const tpl = await this.prisma.base.emailTemplate.findUnique({ where: { code } });
    const m = matter ?? (i.matterId ? await this.prisma.db.matter.findUnique({ where: { id: i.matterId }, select: { reference: true, unit: true, dueDate: true } }) : null);
    const body = tpl?.body ?? 'Dear {{senderName}},\n\nThank you for your request "{{subject}}". It has been registered as {{reference}}.\n\nLegal Department';
    return renderTemplate(body, {
      senderName: i.senderName, subject: i.subject, reference: m?.reference ?? i.intakeNo, intakeNo: i.intakeNo,
      unit: m ? UNIT_NAMES[m.unit] : 'Legal Department', receivedAt: i.receivedAt.toISOString().slice(0, 10),
      dueDate: (m?.dueDate ?? i.dueDate)?.toISOString().slice(0, 10) ?? 'to be confirmed',
    });
  }

  private assertAction(i: Intake, action: string) {
    const t = findTransition(intakeMachine, i.status as IntakeStatus, action);
    if (!t) throw conflict(`Cannot ${action.replace('_', ' ')} an intake that is ${i.status.toLowerCase().replace('_', ' ')}`);
    if (!currentUser().perms.has(t.perm)) throw forbidden();
    return t;
  }

  private async load(id: string) {
    const i = await this.prisma.db.intake.findUnique({ where: { id } });
    if (!i) throw notFound('Intake');
    return i;
  }

  /** Convert into a unit matter. The reference is issued here and quoted in the acknowledgement. */
  async convert(id: string, input: ConvertInput) {
    const i = await this.load(id);
    this.assertAction(i, 'convert');
    // Paralegals hold intake:triage at ALL scope; Unit Heads only for their own unit.
    if (!this.policy.covers('intake:triage', input.unit)) throw forbidden('You can only convert intakes into your own unit');
    const converter = this.converters.get(input.unit);
    const matter = await this.prisma.tx(async (tx) => {
      const m = converter
        ? await converter(tx, i, input)
        : await this.matters.create(tx, {
          unit: input.unit, title: input.title ?? i.subject, description: i.summary, requestTypeId: input.requestTypeId, priority: input.priority ?? i.priority,
          requestingDeptId: i.senderDeptId, requesterId: i.submittedById, requesterName: i.senderName, dueDate: input.dueDate ?? i.dueDate,
          restricted: input.restricted, status: 'OPEN', searchText: i.summary,
        });
      await tx.intake.update({ where: { id }, data: { status: 'CONVERTED', matterId: m.id } });
      await tx.document.updateMany({ where: { intakeId: id }, data: { intakeId: null, matterId: m.id } });
      return m;
    });
    await this.sla.stop({ subjectType: 'Intake', subjectId: id });
    await this.sla.start({ policyCode: 'ASSIGN', step: 'ASSIGN', matterId: matter.id, urgent: matter.priority === 'URGENT' });
    if (input.assigneeIds?.length && this.policy.covers('matter:assign', input.unit)) await this.matters.assign(matter.id, { assigneeIds: input.assigneeIds });
    await this.audit.log({ action: 'intake.converted', entityType: 'Intake', entityId: id, after: { matterId: matter.id, reference: matter.reference, unit: input.unit } });
    const heads = await this.notifications.usersWithRole('UNIT_HEAD', input.unit);
    await this.notifications.notify(heads, { type: 'matter.new', title: `New ${UNIT_NAMES[input.unit]} matter ${matter.reference} to assign`, link: `/matters/${matter.id}`, matterId: matter.id, restricted: matter.restricted });
    return { matterId: matter.id, reference: matter.reference, ackText: await this.ackText({ ...i, matterId: matter.id }, matter) };
  }

  async linkToMatter(id: string, matterId: string, note?: string) {
    const i = await this.load(id);
    this.assertAction(i, 'link');
    const m = await this.policy.assertMatter(matterId);
    await this.prisma.tx(async (tx) => {
      await tx.intake.update({ where: { id }, data: { status: 'LINKED', matterId } });
      await tx.document.updateMany({ where: { intakeId: id }, data: { intakeId: null, matterId } });
      await tx.matter.update({ where: { id: matterId }, data: { lastActivityAt: new Date() } });
    });
    await this.sla.stop({ subjectType: 'Intake', subjectId: id });
    if (m.unit === 'LIT') await this.prisma.db.litigationCase.updateMany({ where: { matterId }, data: { lastUpdateAt: new Date() } });
    await this.matters.comment(matterId, `Linked intake ${i.intakeNo}: ${i.subject}${note ? `\n${note}` : ''}`, true);
    await this.audit.log({ action: 'intake.linked', entityType: 'Intake', entityId: id, after: { matterId } });
    return { matterId, reference: m.reference, ackText: await this.ackText({ ...i, matterId }, m) };
  }

  async close(id: string, action: 'not_legal' | 'duplicate', reason: string, duplicateOfId?: string) {
    const i = await this.load(id);
    this.assertAction(i, action);
    if (action === 'duplicate') {
      if (!duplicateOfId) throw badRequest('Choose the original intake');
      await this.load(duplicateOfId);
    }
    await this.prisma.db.intake.update({ where: { id }, data: { status: action === 'not_legal' ? 'NOT_LEGAL' : 'DUPLICATE', triageNote: reason, duplicateOfId: duplicateOfId ?? null } });
    await this.sla.stop({ subjectType: 'Intake', subjectId: id });
    await this.audit.log({ action: `intake.${action}`, entityType: 'Intake', entityId: id, meta: { reason, duplicateOfId } });
    return { ok: true };
  }

  async reopen(id: string, reason: string) {
    const i = await this.load(id);
    this.assertAction(i, 'reopen');
    await this.prisma.db.intake.update({ where: { id }, data: { status: 'NEW', triageNote: reason, duplicateOfId: null } });
    await this.audit.log({ action: 'intake.reopened', entityType: 'Intake', entityId: id, meta: { reason } });
    return { ok: true };
  }

  async assignHandler(id: string, assigneeId: string) {
    if (!currentUser().perms.has('intake:triage')) throw forbidden();
    await this.load(id);
    await this.prisma.db.intake.update({ where: { id }, data: { assigneeId } });
    await this.audit.log({ action: 'intake.assigned', entityType: 'Intake', entityId: id, after: { assigneeId } });
    await this.notifications.notify([assigneeId], { type: 'intake.assigned', title: 'An intake was assigned to you for triage', link: `/intake/${id}` });
    return { ok: true };
  }

  /** Email the acknowledgement to a portal requester (only if the SMTP relay is enabled). */
  async sendAck(id: string) {
    const i = await this.load(id);
    if (!config().SMTP_ENABLED) throw badRequest('Email is switched off. Use "Copy reply" and send it from Outlook.');
    if (i.source !== 'PORTAL' || !i.senderEmail) throw badRequest('Direct acknowledgement is only for portal requests');
    await this.notifications.email(i.senderEmail, `Your request ${i.intakeNo}`, await this.ackText(i));
    await this.audit.log({ action: 'intake.ack-sent', entityType: 'Intake', entityId: id });
    return { ok: true };
  }
}
