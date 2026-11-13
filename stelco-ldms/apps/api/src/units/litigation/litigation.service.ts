import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma, RiskRating } from '@prisma/client';
import { addBusinessDays, canMove, LITIGATION_OPEN, LITIGATION_TRANSITIONS, LitigationStatus } from '@ldms/shared';
import { CryptoService } from '../../common/crypto.service';
import { currentUser } from '../../common/context';
import { badRequest, conflict, forbidden, notFound } from '../../common/errors';
import { logger } from '../../common/logger';
import { PrismaService, Tx } from '../../common/prisma.service';
import { AuditService } from '../../core/audit/audit.service';
import { CalendarService } from '../../core/calendar/calendar.service';
import { SettingsService } from '../../core/config/settings.service';
import { DocumentsService } from '../../core/documents/documents.service';
import { IntakeService } from '../../core/intake/intake.service';
import { JobsService } from '../../core/jobs/jobs.service';
import { MattersService } from '../../core/matters/matters.service';
import { NotificationsService } from '../../core/notifications/notifications.service';
import { PolicyService } from '../../core/policy/policy.service';
import { SlaService } from '../../core/sla/sla.service';

export const CASE_TYPES = ['CIVIL', 'LABOUR', 'COMMERCIAL', 'CRIMINAL', 'REGULATORY', 'ARBITRATION', 'OTHER'] as const;
export const OUR_ROLES = ['PLAINTIFF', 'DEFENDANT', 'THIRD_PARTY'] as const;

export interface CaseInput {
  title: string;
  description?: string | null;
  courtCaseNo?: string | null;
  courtId?: string | null;
  jurisdiction?: string | null;
  caseType: string;
  ourRole: string;
  subject?: string | null;
  externalFirmId?: string | null;
  externalLawyerId?: string | null;
  responsibleOfficerId?: string | null;
  claimAmount?: string | null;
  currency?: string;
  filingDate?: Date | null;
  risk?: RiskRating | null;
  exposure?: string | null;
  remarks?: string | null;
  requestingDeptId?: string | null;
  restricted?: boolean;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  status?: LitigationStatus;
  parties?: { name: string; side: string; counsel?: string | null }[];
  importBatchId?: string | null;
}

@Injectable()
export class LitigationService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matters: MattersService,
    private readonly policy: PolicyService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly calendar: CalendarService,
    private readonly sla: SlaService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly jobs: JobsService,
    private readonly intake: IntakeService,
    private readonly documents: DocumentsService,
  ) {}

  onModuleInit() {
    this.jobs.register('lit.no-update', () => this.flagStale());
    this.intake.registerConverter('LIT', (tx, i, input) => this.createInTx(tx, {
      title: input.title ?? i.subject, description: i.summary, caseType: String(input.extra?.caseType ?? 'CIVIL'), ourRole: String(input.extra?.ourRole ?? 'DEFENDANT'),
      requestingDeptId: i.senderDeptId, restricted: input.restricted, priority: input.priority ?? i.priority, status: 'PRE_LITIGATION',
    }));
    this.documents.registerOwner('hearing', {
      read: async (id) => { const h = await this.hearing(id); const m = await this.policy.assertMatter(h.caseId, 'doc:read'); return { restricted: m.restricted }; },
      write: async (id) => { const h = await this.hearing(id); const m = await this.policy.assertMatter(h.caseId, 'doc:write'); await this.policy.assertWrite(m); },
    });
  }

  private async hearing(id: string) {
    const h = await this.prisma.db.hearing.findUnique({ where: { id } });
    if (!h) throw notFound('Hearing');
    return h;
  }

  // ------------------------------------------------------------------ cases
  async createInTx(tx: Tx, input: CaseInput) {
    const m = await this.matters.create(tx, {
      unit: 'LIT', title: input.title, description: input.description, priority: input.priority, requestingDeptId: input.requestingDeptId,
      restricted: input.restricted, status: input.status ?? 'PRE_LITIGATION', importBatchId: input.importBatchId,
      searchText: [input.courtCaseNo, input.subject, input.parties?.map((p) => p.name).join(' ')].filter(Boolean).join(' '),
    });
    await tx.litigationCase.create({
      data: {
        matterId: m.id, courtCaseNo: input.courtCaseNo ?? null, courtId: input.courtId ?? null, jurisdiction: input.jurisdiction ?? null,
        caseType: input.caseType, ourRole: input.ourRole, subject: input.subject ?? null, externalFirmId: input.externalFirmId ?? null,
        externalLawyerId: input.externalLawyerId ?? null, responsibleOfficerId: input.responsibleOfficerId ?? null,
        claimAmount: input.claimAmount ?? null, currency: input.currency ?? 'MVR', filingDate: input.filingDate ?? null, risk: input.risk ?? null,
        exposureEnc: input.exposure ? this.crypto.encrypt(input.exposure) : null, remarks: input.remarks ?? null,
        parties: input.parties?.length ? { create: input.parties.map((p) => ({ name: p.name, side: p.side, counsel: p.counsel ?? null })) } : undefined,
      },
    });
    if (input.responsibleOfficerId) {
      await tx.matterAssignment.create({ data: { matterId: m.id, userId: input.responsibleOfficerId, role: 'ASSIGNEE' } });
      if (m.restricted) await tx.matterAccess.createMany({ data: [{ matterId: m.id, userId: input.responsibleOfficerId }], skipDuplicates: true });
    }
    return m;
  }

  async create(input: CaseInput) {
    if (!this.policy.covers('lit:write', 'LIT')) throw forbidden();
    if (input.responsibleOfficerId) await this.matters.assertLegalStaff(input.responsibleOfficerId, 'LIT');
    if (input.courtCaseNo) await this.assertNoDuplicate(input.courtCaseNo);
    const m = await this.prisma.tx((tx) => this.createInTx(tx, input));
    await this.audit.log({ action: 'lit.case.created', entityType: 'Matter', entityId: m.id, after: { ...input, exposure: input.exposure ? '[set]' : null } });
    return { id: m.id, reference: m.reference };
  }

  async assertNoDuplicate(courtCaseNo: string, exceptId?: string) {
    const dup = await this.prisma.db.litigationCase.findFirst({ where: { courtCaseNo: { equals: courtCaseNo, mode: 'insensitive' }, ...(exceptId ? { matterId: { not: exceptId } } : {}) } });
    if (dup) throw conflict('A case with this court case number already exists');
  }

  private async loadCase(id: string, perm: 'matter:read' | 'matter:write' = 'matter:read') {
    const m = await this.policy.assertMatter(id, perm);
    if (m.unit !== 'LIT') throw notFound('Case');
    return m;
  }

  private async writable(id: string) {
    const m = await this.loadCase(id, 'matter:write');
    if (!this.policy.covers('lit:write', 'LIT')) throw forbidden();
    await this.policy.assertWrite(m);
    return m;
  }

  async get(id: string) {
    await this.loadCase(id);
    const c = await this.prisma.db.litigationCase.findUnique({
      where: { matterId: id },
      include: {
        court: true, externalFirm: true, externalLawyer: true, parties: true,
        hearings: { orderBy: { startsAt: 'desc' }, include: { court: true } },
        deadlines: { orderBy: { dueAt: 'asc' } },
        engagements: { include: { firm: true, invoices: { orderBy: { receivedOn: 'desc' } } } },
        updates: { orderBy: { receivedAt: 'desc' } },
        evaluation: true,
        outcomes: { include: { enforcement: true }, orderBy: { decidedOn: 'desc' } },
      },
    });
    if (!c) throw notFound('Case');
    const officer = c.responsibleOfficerId ? await this.prisma.base.user.findUnique({ where: { id: c.responsibleOfficerId }, select: { id: true, displayName: true } }) : null;
    return {
      ...c,
      exposure: this.crypto.decrypt(c.exposureEnc), exposureEnc: undefined,
      responsibleOfficer: officer,
      outcomes: c.outcomes.map((o) => ({ ...o, amount: this.crypto.decrypt(o.amountEnc), amountEnc: undefined })),
      engagements: c.engagements.map((e) => {
        const actual = e.invoices.filter((i) => i.status !== 'DISPUTED').reduce((n, i) => n + Number(i.amount), 0);
        return { ...e, actual, budgetUsedPct: e.budget ? Math.round((actual / Number(e.budget)) * 100) : null };
      }),
      allowedStatuses: LITIGATION_TRANSITIONS,
    };
  }

  async update(id: string, data: Partial<CaseInput>) {
    await this.writable(id);
    const before = await this.prisma.db.litigationCase.findUniqueOrThrow({ where: { matterId: id } });
    if (data.courtCaseNo && data.courtCaseNo !== before.courtCaseNo) await this.assertNoDuplicate(data.courtCaseNo, id);
    if (data.responsibleOfficerId) await this.matters.assertLegalStaff(data.responsibleOfficerId, 'LIT');
    const { exposure, title, description, parties: _p, restricted: _r, status: _s, priority, requestingDeptId, importBatchId: _i, ...rest } = data;
    await this.prisma.tx(async (tx) => {
      await tx.litigationCase.update({
        where: { matterId: id },
        data: { ...rest, ...(exposure !== undefined ? { exposureEnc: exposure ? this.crypto.encrypt(exposure) : null } : {}), lastUpdateAt: new Date() },
      });
      if (title || priority || requestingDeptId !== undefined || description !== undefined) {
        await tx.matter.update({ where: { id }, data: { ...(title ? { title } : {}), ...(priority ? { priority } : {}), ...(requestingDeptId !== undefined ? { requestingDeptId } : {}), lastActivityAt: new Date() } });
      }
      if (data.responsibleOfficerId && data.responsibleOfficerId !== before.responsibleOfficerId) {
        await tx.matterAssignment.deleteMany({ where: { matterId: id, role: 'ASSIGNEE' } });
        await tx.matterAssignment.create({ data: { matterId: id, userId: data.responsibleOfficerId, role: 'ASSIGNEE' } });
      }
    });
    if (description !== undefined) await this.matters.update(id, { description });
    await this.audit.log({ action: 'lit.case.updated', entityType: 'Matter', entityId: id, before: { ...before, exposureEnc: undefined }, after: { ...rest, exposure: exposure !== undefined ? '[changed]' : undefined } });
    return this.get(id);
  }

  async setStatus(id: string, to: LitigationStatus, comment?: string) {
    const m = await this.writable(id);
    const from = m.status as LitigationStatus;
    if (!canMove(LITIGATION_TRANSITIONS, from, to)) throw conflict(`A case cannot move from ${from.replace(/_/g, ' ').toLowerCase()} to ${to.replace(/_/g, ' ').toLowerCase()}`);
    if (to === 'CLOSED') {
      const c = await this.prisma.db.litigationCase.findUniqueOrThrow({ where: { matterId: id }, include: { evaluation: true } });
      if (c.externalFirmId && !c.evaluation) throw badRequest('Record the law firm performance evaluation before closing the case');
    }
    await this.prisma.tx(async (tx) => {
      await this.matters.recordTransition(tx, id, from, to, 'lit-status', comment);
      await tx.litigationCase.update({ where: { matterId: id }, data: { lastUpdateAt: new Date() } });
    });
    // A stale calendar entry is not worth failing a committed status change for, but it must not vanish silently.
    if (to === 'CLOSED') await this.calendar.cancel('CaseDeadline', id).catch((err) => logger.warn({ matterId: id, err: String(err).slice(0, 200) }, 'litigation: could not cancel deadline calendar events'));
    return this.get(id);
  }

  // ------------------------------------------------------------------ hearings
  async addHearing(caseId: string, h: { startsAt: Date; courtId?: string | null; judge?: string | null; purpose?: string | null }) {
    const m = await this.writable(caseId);
    const c = await this.prisma.db.litigationCase.findUniqueOrThrow({ where: { matterId: caseId } });
    const hearing = await this.prisma.tx(async (tx) => {
      const row = await tx.hearing.create({ data: { caseId, startsAt: h.startsAt, courtId: h.courtId ?? c.courtId, judge: h.judge ?? null, purpose: h.purpose ?? null } });
      await this.calendar.upsert({
        kind: 'HEARING', unit: 'LIT', title: `${m.reference} hearing${c.courtCaseNo ? ` (${c.courtCaseNo})` : ''}`, sourceType: 'Hearing', sourceId: row.id,
        startsAt: h.startsAt, ownerId: c.responsibleOfficerId, matterId: caseId, restricted: m.restricted,
      }, tx);
      if (m.status === 'FILED') await this.matters.recordTransition(tx, caseId, 'FILED', 'PENDING_HEARING', 'hearing-scheduled');
      return row;
    });
    await this.audit.log({ action: 'lit.hearing.added', entityType: 'Hearing', entityId: hearing.id, after: { caseId, startsAt: h.startsAt } });
    return hearing;
  }

  /** Mark a hearing as held: starts the 2-business-day summary clock for the responsible officer. */
  async markHeld(hearingId: string, held: 'HELD' | 'ADJOURNED' | 'CANCELLED') {
    const h = await this.hearing(hearingId);
    await this.writable(h.caseId);
    const c = await this.prisma.db.litigationCase.findUniqueOrThrow({ where: { matterId: h.caseId } });
    await this.prisma.db.hearing.update({ where: { id: hearingId }, data: { status: held } });
    if (held === 'CANCELLED') await this.calendar.cancel('Hearing', hearingId);
    if (held !== 'CANCELLED' && !h.summaryEnteredAt) {
      const existing = await this.prisma.db.slaClock.count({ where: { subjectType: 'Hearing', subjectId: hearingId } });
      if (!existing) await this.sla.start({ policyCode: 'LIT_HEARING_SUMMARY', step: 'LIT_HEARING_SUMMARY', startedAt: h.startsAt < new Date() ? h.startsAt : new Date(), matterId: h.caseId, subjectType: 'Hearing', subjectId: hearingId, ownerId: c.responsibleOfficerId });
    }
    await this.audit.log({ action: 'lit.hearing.status', entityType: 'Hearing', entityId: hearingId, after: { status: held } });
    return { ok: true };
  }

  /** Structured hearing summary. A next-hearing date creates the next hearing + calendar entry. */
  async recordSummary(hearingId: string, s: { whatHappened: string; ordersMade?: string; nextSteps?: string; companyActions?: string; outcome?: string | null; attendees?: { internal: string[]; external: string[] }; nextHearingAt?: Date | null; judge?: string | null }) {
    const h = await this.hearing(hearingId);
    await this.writable(h.caseId);
    let nextId: string | null = null;
    if (s.nextHearingAt) {
      if (s.nextHearingAt <= h.startsAt) throw badRequest('The next hearing must be after this hearing');
      nextId = (await this.addHearing(h.caseId, { startsAt: s.nextHearingAt, courtId: h.courtId, judge: s.judge ?? h.judge })).id;
    }
    await this.prisma.tx(async (tx) => {
      await tx.hearing.update({
        where: { id: hearingId },
        data: {
          status: h.status === 'SCHEDULED' ? 'HELD' : h.status, summary: { whatHappened: s.whatHappened, ordersMade: s.ordersMade ?? '', nextSteps: s.nextSteps ?? '', companyActions: s.companyActions ?? '' },
          outcome: s.outcome ?? null, attendees: s.attendees ?? undefined, judge: s.judge ?? h.judge, summaryEnteredAt: new Date(), summaryById: currentUser().id, nextHearingId: nextId,
        },
      });
      await tx.litigationCase.update({ where: { matterId: h.caseId }, data: { lastUpdateAt: new Date(), noUpdateFlaggedAt: null } });
      await tx.matter.update({ where: { id: h.caseId }, data: { lastActivityAt: new Date() } });
    });
    await this.sla.stop({ subjectType: 'Hearing', subjectId: hearingId });
    await this.audit.log({ action: 'lit.hearing.summary', entityType: 'Hearing', entityId: hearingId, meta: { nextHearingId: nextId } });
    return { ok: true, nextHearingId: nextId };
  }

  // ------------------------------------------------------------------ deadlines
  async addDeadline(caseId: string, d: { type: string; title: string; dueAt: Date; ownerId?: string | null }) {
    const m = await this.writable(caseId);
    if (d.ownerId) await this.matters.assertLegalStaff(d.ownerId, 'LIT');
    const row = await this.prisma.tx(async (tx) => {
      const r = await tx.caseDeadline.create({ data: { caseId, type: d.type, title: d.title, dueAt: d.dueAt, ownerId: d.ownerId ?? null } });
      await this.calendar.upsert({ kind: d.type === 'LIMITATION' ? 'LIMITATION' : 'DEADLINE', unit: 'LIT', title: `${m.reference}: ${d.title}`, sourceType: 'CaseDeadline', sourceId: r.id, startsAt: d.dueAt, allDay: true, ownerId: d.ownerId, matterId: caseId, restricted: m.restricted }, tx);
      return r;
    });
    await this.audit.log({ action: 'lit.deadline.added', entityType: 'CaseDeadline', entityId: row.id, after: d });
    return row;
  }

  async completeDeadline(id: string, status: 'DONE' | 'MISSED' | 'OPEN') {
    const d = await this.prisma.db.caseDeadline.findUnique({ where: { id } });
    if (!d) throw notFound('Deadline');
    await this.writable(d.caseId);
    await this.prisma.db.caseDeadline.update({ where: { id }, data: { status, completedAt: status === 'OPEN' ? null : new Date() } });
    if (status !== 'OPEN') await this.calendar.cancel('CaseDeadline', id);
    await this.audit.log({ action: 'lit.deadline.status', entityType: 'CaseDeadline', entityId: id, after: { status } });
    return { ok: true };
  }

  // ------------------------------------------------------------------ external counsel
  async addEngagement(caseId: string, e: { firmId: string; feeArrangement?: string | null; budget?: string | null; currency?: string; startedOn?: Date | null }) {
    await this.writable(caseId);
    const row = await this.prisma.db.engagement.create({ data: { caseId, firmId: e.firmId, feeArrangement: e.feeArrangement ?? null, budget: e.budget ?? null, currency: e.currency ?? 'MVR', startedOn: e.startedOn ?? null } });
    await this.prisma.db.litigationCase.update({ where: { matterId: caseId }, data: { externalFirmId: e.firmId } });
    await this.audit.log({ action: 'lit.engagement.added', entityType: 'Engagement', entityId: row.id, after: e });
    return row;
  }

  private async engagement(id: string) {
    const e = await this.prisma.db.engagement.findUnique({ where: { id } });
    if (!e) throw notFound('Engagement');
    return e;
  }

  async addInvoice(engagementId: string, i: { invoiceNo: string; amount: string; currency?: string; receivedOn: Date; notes?: string | null }) {
    const e = await this.engagement(engagementId);
    await this.writable(e.caseId);
    const row = await this.prisma.db.counselInvoice.create({ data: { engagementId, invoiceNo: i.invoiceNo, amount: i.amount, currency: i.currency ?? e.currency, receivedOn: i.receivedOn, notes: i.notes ?? null } });
    await this.audit.log({ action: 'lit.invoice.received', entityType: 'CounselInvoice', entityId: row.id, after: i });
    return row;
  }

  /** received → verified → sent for payment → paid (or disputed). Verification needs lit:invoice.verify. */
  async invoiceStatus(id: string, status: 'VERIFIED' | 'SENT_FOR_PAYMENT' | 'PAID' | 'DISPUTED' | 'RECEIVED') {
    const inv = await this.prisma.db.counselInvoice.findUnique({ where: { id }, include: { engagement: true } });
    if (!inv) throw notFound('Invoice');
    await this.writable(inv.engagement.caseId);
    const order = ['RECEIVED', 'VERIFIED', 'SENT_FOR_PAYMENT', 'PAID'];
    const allowed = status === 'DISPUTED' || status === 'RECEIVED' || order.indexOf(status) === order.indexOf(inv.status) + 1;
    if (!allowed) throw conflict(`Invoice cannot go from ${inv.status} to ${status}`);
    if (status === 'VERIFIED' && !this.policy.covers('lit:invoice.verify', 'LIT')) throw forbidden('Only legal officers can verify invoices');
    await this.prisma.db.counselInvoice.update({ where: { id }, data: { status, ...(status === 'VERIFIED' ? { verifiedById: currentUser().id } : {}) } });
    await this.audit.log({ action: 'lit.invoice.status', entityType: 'CounselInvoice', entityId: id, before: { status: inv.status }, after: { status } });
    return { ok: true };
  }

  async addUpdate(caseId: string, u: { receivedAt: Date; channel: string; summary: string }) {
    await this.writable(caseId);
    const row = await this.prisma.tx(async (tx) => {
      const r = await tx.counselUpdate.create({ data: { caseId, receivedAt: u.receivedAt, channel: u.channel, summary: u.summary, enteredById: currentUser().id } });
      await tx.litigationCase.update({ where: { matterId: caseId }, data: { lastUpdateAt: new Date(), noUpdateFlaggedAt: null } });
      await tx.matter.update({ where: { id: caseId }, data: { lastActivityAt: new Date() } });
      return r;
    });
    await this.audit.log({ action: 'lit.counsel-update', entityType: 'CounselUpdate', entityId: row.id });
    return row;
  }

  async evaluate(caseId: string, e: { quality: number; responsiveness: number; cost: number; outcome: number; comments?: string | null }) {
    await this.writable(caseId);
    const c = await this.prisma.db.litigationCase.findUniqueOrThrow({ where: { matterId: caseId } });
    if (!c.externalFirmId) throw badRequest('No external law firm on this case');
    const row = await this.prisma.db.firmEvaluation.upsert({
      where: { caseId }, create: { caseId, firmId: c.externalFirmId, ...e, evaluatedById: currentUser().id }, update: { ...e, evaluatedById: currentUser().id },
    });
    await this.audit.log({ action: 'lit.firm.evaluated', entityType: 'FirmEvaluation', entityId: caseId, after: e });
    return row;
  }

  async addOutcome(caseId: string, o: { kind: string; decidedOn: Date; amount?: string | null; currency?: string; direction: string; paymentStatus?: string; terms?: string | null }) {
    await this.writable(caseId);
    const row = await this.prisma.db.outcome.create({
      data: { caseId, kind: o.kind, decidedOn: o.decidedOn, amountEnc: o.amount ? this.crypto.encrypt(o.amount) : null, currency: o.currency ?? 'MVR', direction: o.direction, paymentStatus: o.paymentStatus ?? 'PENDING', terms: o.terms ?? null },
    });
    await this.prisma.db.litigationCase.update({ where: { matterId: caseId }, data: { lastUpdateAt: new Date() } });
    await this.audit.log({ action: 'lit.outcome.added', entityType: 'Outcome', entityId: row.id, after: { ...o, amount: o.amount ? '[encrypted]' : null } });
    return row;
  }

  async updateOutcome(id: string, data: { paymentStatus?: string; amount?: string | null }) {
    const o = await this.prisma.db.outcome.findUnique({ where: { id } });
    if (!o) throw notFound('Outcome');
    await this.writable(o.caseId);
    await this.prisma.db.outcome.update({ where: { id }, data: { ...(data.paymentStatus ? { paymentStatus: data.paymentStatus } : {}), ...(data.amount !== undefined ? { amountEnc: data.amount ? this.crypto.encrypt(data.amount) : null } : {}) } });
    await this.audit.log({ action: 'lit.outcome.updated', entityType: 'Outcome', entityId: id, after: { paymentStatus: data.paymentStatus, amount: data.amount !== undefined ? '[changed]' : undefined } });
    return { ok: true };
  }

  async addEnforcement(outcomeId: string, e: { on: Date; action: string; status?: string }) {
    const o = await this.prisma.db.outcome.findUnique({ where: { id: outcomeId } });
    if (!o) throw notFound('Outcome');
    await this.writable(o.caseId);
    const row = await this.prisma.db.enforcementAction.create({ data: { outcomeId, on: e.on, action: e.action, status: e.status ?? 'OPEN' } });
    await this.audit.log({ action: 'lit.enforcement.added', entityType: 'EnforcementAction', entityId: row.id, after: e });
    return row;
  }

  // ------------------------------------------------------------------ list + reports
  async list(f: { q?: string; status?: string; firmId?: string; caseType?: string; risk?: string; open?: boolean; page: number; pageSize: number }) {
    const where: Prisma.LitigationCaseWhereInput = {
      matter: { AND: [this.policy.matterScope(), ...(f.status ? [{ status: f.status }] : []), ...(f.open ? [{ closedAt: null }] : []),
        ...(f.q ? [{ OR: [{ title: { contains: f.q, mode: 'insensitive' as const } }, { reference: { contains: f.q, mode: 'insensitive' as const } }] }] : [])] },
      ...(f.firmId ? { externalFirmId: f.firmId } : {}),
      ...(f.caseType ? { caseType: f.caseType } : {}),
      ...(f.risk ? { risk: f.risk as RiskRating } : {}),
    };
    if (f.q) {
      const mq = (where.matter as Prisma.MatterWhereInput);
      where.matter = undefined;
      where.OR = [{ matter: mq }, { AND: [{ courtCaseNo: { contains: f.q, mode: 'insensitive' } }, { matter: this.policy.matterScope() }] }];
    }
    const [rows, total] = await Promise.all([
      this.prisma.db.litigationCase.findMany({
        where, skip: (f.page - 1) * f.pageSize, take: f.pageSize, orderBy: { matter: { createdAt: 'desc' } },
        include: {
          matter: { select: { id: true, reference: true, title: true, status: true, priority: true, restricted: true, closedAt: true } },
          court: { select: { name: true } }, externalFirm: { select: { name: true } },
          hearings: { where: { startsAt: { gte: new Date() }, status: 'SCHEDULED' }, orderBy: { startsAt: 'asc' }, take: 1, select: { startsAt: true } },
        },
      }),
      this.prisma.db.litigationCase.count({ where }),
    ]);
    return { rows: rows.map((r) => ({ id: r.matterId, ...r, exposureEnc: undefined, nextHearing: r.hearings[0]?.startsAt ?? null })), total };
  }

  /** Contingent liability / exposure report for Finance and Audit. */
  async exposureReport() {
    const cases = await this.prisma.db.litigationCase.findMany({
      where: { matter: { AND: [this.policy.matterScope(), { closedAt: null }] } },
      include: { matter: { select: { reference: true, title: true, status: true, restricted: true } }, court: true, externalFirm: true },
    });
    const rows = cases.map((c) => ({
      reference: c.matter.reference, title: c.matter.title, courtCaseNo: c.courtCaseNo, court: c.court?.name ?? '', firm: c.externalFirm?.name ?? '',
      caseType: c.caseType, ourRole: c.ourRole, status: c.matter.status, risk: c.risk ?? 'UNASSESSED', currency: c.currency,
      claimAmount: c.claimAmount ? Number(c.claimAmount) : 0, exposure: Number(this.crypto.decrypt(c.exposureEnc) ?? 0),
    }));
    const totals: Record<string, Record<string, { count: number; claim: number; exposure: number }>> = {};
    for (const r of rows) {
      totals[r.currency] ??= {};
      const t = (totals[r.currency]![r.risk] ??= { count: 0, claim: 0, exposure: 0 });
      t.count++; t.claim += r.claimAmount; t.exposure += r.exposure;
    }
    await this.audit.log({ action: 'lit.report.exposure', meta: { rows: rows.length } });
    return { rows, totals, note: 'Probable → provide; Possible → disclose as contingent liability; Remote → no disclosure (IAS 37).' };
  }

  async upcomingHearings(days = 30) {
    const to = new Date(Date.now() + days * 86400_000);
    return this.prisma.db.hearing.findMany({
      where: { startsAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)), lte: to }, status: 'SCHEDULED', case: { matter: this.policy.matterScope() } },
      include: { case: { include: { matter: { select: { id: true, reference: true, title: true } }, externalFirm: { select: { name: true } } } }, court: true },
      orderBy: { startsAt: 'asc' },
    });
  }

  async missingSummaries() {
    return this.prisma.db.hearing.findMany({
      where: { startsAt: { lt: new Date() }, summaryEnteredAt: null, status: { in: ['SCHEDULED', 'HELD', 'ADJOURNED'] }, case: { matter: this.policy.matterScope() } },
      include: { case: { include: { matter: { select: { id: true, reference: true, title: true } } } } },
      orderBy: { startsAt: 'asc' },
    });
  }

  async staleCases(days?: number) {
    const n = days ?? (await this.settings.get<number>('litigation.noUpdateDays'));
    return this.prisma.db.litigationCase.findMany({
      where: { lastUpdateAt: { lt: new Date(Date.now() - n * 86400_000) }, matter: { AND: [this.policy.matterScope(), { closedAt: null }] } },
      include: { matter: { select: { id: true, reference: true, title: true, status: true } }, externalFirm: { select: { name: true } } },
      orderBy: { lastUpdateAt: 'asc' },
    });
  }

  async breakdown() {
    const scope = { matter: this.policy.matterScope() };
    const [byStatus, byType, byFirm, byRisk] = await Promise.all([
      this.prisma.db.matter.groupBy({ by: ['status'], where: { AND: [this.policy.matterScope(), { unit: 'LIT' }] }, _count: true }),
      this.prisma.db.litigationCase.groupBy({ by: ['caseType'], where: scope, _count: true }),
      this.prisma.db.litigationCase.groupBy({ by: ['externalFirmId'], where: scope, _count: true }),
      this.prisma.db.litigationCase.groupBy({ by: ['risk'], where: { ...scope, matter: { AND: [this.policy.matterScope(), { closedAt: null }] } }, _count: true }),
    ]);
    const firms = await this.prisma.base.lawFirm.findMany({ select: { id: true, name: true } });
    const evals = await this.prisma.db.firmEvaluation.groupBy({ by: ['firmId'], _avg: { quality: true, responsiveness: true, cost: true, outcome: true }, _count: true });
    return {
      byStatus: byStatus.map((r) => ({ key: r.status, count: r._count })),
      byType: byType.map((r) => ({ key: r.caseType, count: r._count })),
      byFirm: byFirm.map((r) => ({ key: firms.find((f) => f.id === r.externalFirmId)?.name ?? 'In-house / none', count: r._count })),
      byRisk: byRisk.map((r) => ({ key: r.risk ?? 'UNASSESSED', count: r._count })),
      firmPerformance: evals.map((e) => ({ firm: firms.find((f) => f.id === e.firmId)?.name ?? '', evaluations: e._count, ...e._avg })),
    };
  }

  /** Daily job: flag open cases without an update for N days (default 30). */
  async flagStale() {
    const n = await this.settings.get<number>('litigation.noUpdateDays');
    const cutoff = new Date(Date.now() - n * 86400_000);
    const cases = await this.prisma.db.litigationCase.findMany({
      where: { lastUpdateAt: { lt: cutoff }, OR: [{ noUpdateFlaggedAt: null }, { noUpdateFlaggedAt: { lt: cutoff } }], matter: { closedAt: null, status: { in: LITIGATION_OPEN } } },
      include: { matter: true },
    });
    const heads = await this.notifications.usersWithRole('UNIT_HEAD', 'LIT');
    for (const c of cases) {
      await this.prisma.db.litigationCase.update({ where: { matterId: c.matterId }, data: { noUpdateFlaggedAt: new Date() } });
      await this.notifications.notify([c.responsibleOfficerId, ...heads], {
        type: 'lit.no-update', title: `No update for ${n}+ days: ${c.matter.reference}`, body: 'Ask external counsel for a status update and record it.',
        link: `/litigation/${c.matterId}`, matterId: c.matterId, restricted: c.matter.restricted,
      });
    }
    return { flagged: cases.length };
  }

  /** Overdue hearing summaries are covered by the SLA scan; this helper backs the dashboard. */
  async summaryDueAt(hearingDate: Date) {
    return addBusinessDays(hearingDate, 2, await this.settings.calendar());
  }
}
