import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma, Severity } from '@prisma/client';
import { addBusinessDays, canMove, CHECK_CYCLE_TRANSITIONS, CheckCycleStatus, FINDING_TRANSITIONS, FindingStatus, REG_CHANGE_STATUSES } from '@ldms/shared';
import { currentUser } from '../../common/context';
import { badRequest, conflict, forbidden, notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../core/audit/audit.service';
import { CalendarService } from '../../core/calendar/calendar.service';
import { SettingsService } from '../../core/config/settings.service';
import { DocumentsService } from '../../core/documents/documents.service';
import { JobsService } from '../../core/jobs/jobs.service';
import { NotificationsService } from '../../core/notifications/notifications.service';
import { PolicyService } from '../../core/policy/policy.service';
import { SlaService } from '../../core/sla/sla.service';

const DAY = 86400_000;
export const FREQUENCIES = ['ONE_OFF', 'MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL'] as const;
export type Frequency = (typeof FREQUENCIES)[number];
const REMEDIATION_DAYS: Record<Severity, number> = { HIGH: 30, MEDIUM: 60, LOW: 90 };

/** Period label for a date (local time) and frequency. */
export function periodOf(freq: Frequency, d: Date, obligationId = ''): string {
  const local = new Date(d.getTime() + 5 * 3600_000);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  switch (freq) {
    case 'MONTHLY': return `${y}-${String(m + 1).padStart(2, '0')}`;
    case 'QUARTERLY': return `${y}-Q${Math.floor(m / 3) + 1}`;
    case 'SEMI_ANNUAL': return `${y}-H${m < 6 ? 1 : 2}`;
    case 'ANNUAL': return `${y}`;
    default: return `ONE-OFF-${obligationId.slice(-6)}`;
  }
}

/** Start of the next period after `d`. */
export function nextPeriodStart(freq: Frequency, d: Date): Date | null {
  const local = new Date(d.getTime() + 5 * 3600_000);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const at = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 1, 3, 0)); // 08:00 MVT on the 1st
  switch (freq) {
    case 'MONTHLY': return at(y, m + 1);
    case 'QUARTERLY': return at(y, (Math.floor(m / 3) + 1) * 3);
    case 'SEMI_ANNUAL': return at(y, m < 6 ? 6 : 12);
    case 'ANNUAL': return at(y + 1, 0);
    default: return null;
  }
}

@Injectable()
export class ComplianceService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly sla: SlaService,
    private readonly settings: SettingsService,
    private readonly calendar: CalendarService,
    private readonly jobs: JobsService,
    private readonly documents: DocumentsService,
  ) {}

  onModuleInit() {
    this.jobs.register('cmp.cycles', () => this.generateCycles());
    this.jobs.register('cmp.ack-reminders', () => this.ackReminders());
    this.jobs.register('cmp.findings-overdue', () => this.findingsOverdue());
    this.documents.registerOwner('law', {
      read: async (id) => { await this.law(id); if (!this.isLegal() && !currentUser().perms.has('portal:use')) throw notFound('Law'); return {}; },
      write: async (id) => { await this.law(id); this.assertStaff(); },
    });
    this.documents.registerOwner('checkItem', {
      read: async (id) => { await this.assertItemAccess(id, false); return {}; },
      write: async (id) => { await this.assertItemAccess(id, true); },
    });
    this.documents.registerOwner('finding', {
      read: async (id) => { await this.assertFindingAccess(id); return {}; },
      write: async (id) => { await this.assertFindingAccess(id); },
    });
  }

  // ------------------------------------------------------------------ access helpers
  private isLegal() {
    const u = currentUser();
    return this.policy.covers('matter:read', 'CMP', u) || this.policy.covers('cmp:write', 'CMP', u) || u.isHod || u.perms.get('matter:read')?.scope === 'ALL';
  }
  private assertStaff() { if (!this.policy.covers('cmp:write', 'CMP')) throw forbidden(); }
  private assertReader() { if (!this.isLegal() && !currentUser().perms.has('portal:use')) throw forbidden(); }
  private isDeptUser(departmentId: string) {
    const u = currentUser();
    return u.perms.has('portal:respond') && u.departmentId === departmentId;
  }

  private async law(id: string) {
    const l = await this.prisma.db.law.findUnique({ where: { id } });
    if (!l) throw notFound('Law');
    return l;
  }

  private async assertItemAccess(itemId: string, write: boolean) {
    const item = await this.prisma.db.checkItem.findUnique({ where: { id: itemId }, include: { cycle: true } });
    if (!item) throw notFound('Checklist item');
    if (this.isDeptUser(item.cycle.departmentId)) {
      if (write && !['ISSUED', 'IN_PROGRESS'].includes(item.cycle.status)) throw conflict('This checklist has been submitted');
      return item;
    }
    if (write) this.assertStaff(); else if (!this.isLegal()) throw notFound('Checklist item');
    return item;
  }

  private async assertFindingAccess(id: string) {
    const f = await this.prisma.db.finding.findUnique({ where: { id } });
    if (!f) throw notFound('Finding');
    if (this.isDeptUser(f.departmentId) || this.isLegal()) return f;
    throw notFound('Finding');
  }

  private async focalPoints(departmentId: string) {
    return (await this.prisma.base.user.findMany({ where: { departmentId, status: 'ACTIVE', roles: { some: { role: 'REQUESTER' } } }, select: { id: true } })).map((u) => u.id);
  }

  // ------------------------------------------------------------------ laws register
  async laws(f: { q?: string; type?: string; status?: string; regulatorId?: string }) {
    this.assertReader();
    const where: Prisma.LawWhereInput = {
      ...(f.type ? { type: f.type } : {}), ...(f.status ? { status: f.status } : {}), ...(f.regulatorId ? { regulatorId: f.regulatorId } : {}),
      ...(f.q ? { OR: [{ title: { contains: f.q, mode: 'insensitive' } }, { summary: { contains: f.q, mode: 'insensitive' } }] } : {}),
    };
    return this.prisma.db.law.findMany({ where, include: { regulator: { select: { name: true } }, _count: { select: { obligations: true } } }, orderBy: { title: 'asc' } });
  }

  async getLaw(id: string) {
    this.assertReader();
    const l = await this.prisma.db.law.findUnique({
      where: { id },
      include: { regulator: true, versions: { orderBy: { versionNo: 'desc' } }, obligations: { orderBy: { createdAt: 'asc' } }, changes: { orderBy: { createdAt: 'desc' } }, disseminations: { orderBy: { sentAt: 'desc' }, include: { recipients: true } } },
    });
    if (!l) throw notFound('Law');
    return l;
  }

  async saveLaw(id: string | null, data: { title: string; type: string; regulatorId?: string | null; issuedOn?: Date | null; effectiveOn?: Date | null; status?: string; sourceUrl?: string | null; summary?: string | null; officerId?: string | null }) {
    this.assertStaff();
    const before = id ? await this.law(id) : null;
    const row = await this.prisma.tx(async (tx) => {
      const r = id ? await tx.law.update({ where: { id }, data }) : await tx.law.create({ data });
      if (!id) await tx.lawVersion.create({ data: { lawId: r.id, versionNo: 1, effectiveOn: r.effectiveOn, notes: 'Initial version' } });
      return r;
    });
    if (data.officerId && data.officerId !== before?.officerId) await this.notifications.notify([data.officerId], { type: 'cmp.law.assigned', title: `You are the compliance officer for "${row.title}"`, link: `/compliance/laws/${row.id}` });
    await this.audit.log({ action: id ? 'cmp.law.updated' : 'cmp.law.created', entityType: 'Law', entityId: row.id, before, after: row });
    return row;
  }

  async addVersion(lawId: string, v: { notes: string; effectiveOn?: Date | null; status?: 'AMENDED' | 'REPEALED' | 'IN_FORCE' }) {
    this.assertStaff();
    const law = await this.law(lawId);
    const n = (await this.prisma.db.lawVersion.count({ where: { lawId } })) + 1;
    const row = await this.prisma.tx(async (tx) => {
      const r = await tx.lawVersion.create({ data: { lawId, versionNo: n, notes: v.notes, effectiveOn: v.effectiveOn ?? null } });
      await tx.law.update({ where: { id: lawId }, data: { status: v.status ?? 'AMENDED', ...(v.effectiveOn ? { effectiveOn: v.effectiveOn } : {}) } });
      await tx.regulatoryChange.create({ data: { lawId, kind: v.status === 'REPEALED' ? 'REPEALED' : 'AMENDED', impact: null, officerId: law.officerId, status: 'IDENTIFIED' } });
      return r;
    });
    await this.audit.log({ action: 'cmp.law.version', entityType: 'Law', entityId: lawId, after: { versionNo: n, status: v.status } });
    return row;
  }

  // ------------------------------------------------------------------ obligations
  async saveObligation(id: string | null, data: { lawId: string; description: string; article?: string | null; frequency: Frequency; evidenceRequired?: string | null; risk: Severity; penalty?: string | null; ownerId?: string | null; departmentIds: string[]; active?: boolean }) {
    this.assertStaff();
    await this.law(data.lawId);
    const depts = await this.prisma.base.department.count({ where: { id: { in: data.departmentIds } } });
    if (depts !== data.departmentIds.length) throw badRequest('Unknown department');
    const before = id ? await this.prisma.db.obligation.findUnique({ where: { id } }) : null;
    const row = id ? await this.prisma.db.obligation.update({ where: { id }, data }) : await this.prisma.db.obligation.create({ data: { ...data, nextCheckAt: new Date() } });
    await this.audit.log({ action: id ? 'cmp.obligation.updated' : 'cmp.obligation.created', entityType: 'Obligation', entityId: row.id, before, after: row });
    return row;
  }

  obligations(f: { lawId?: string; departmentId?: string; q?: string }) {
    this.assertReader();
    const u = currentUser();
    const deptOnly = !this.isLegal();
    return this.prisma.db.obligation.findMany({
      where: {
        ...(f.lawId ? { lawId: f.lawId } : {}),
        ...(deptOnly ? { departmentIds: { has: u.departmentId ?? '__none__' } } : f.departmentId ? { departmentIds: { has: f.departmentId } } : {}),
        ...(f.q ? { description: { contains: f.q, mode: 'insensitive' } } : {}),
      },
      include: { law: { select: { id: true, title: true } } },
      orderBy: [{ risk: 'asc' }, { createdAt: 'asc' }],
    });
  }

  // ------------------------------------------------------------------ regulatory change log
  changes(status?: string) {
    if (!this.isLegal()) throw forbidden();
    return this.prisma.db.regulatoryChange.findMany({ where: status ? { status } : {}, include: { law: { select: { id: true, title: true } } }, orderBy: { createdAt: 'desc' } });
  }

  async saveChange(id: string | null, data: { lawId: string; kind?: string; impact?: string | null; affectedDeptIds?: string[]; officerId?: string | null; status?: string }) {
    this.assertStaff();
    if (data.status && !(REG_CHANGE_STATUSES as readonly string[]).includes(data.status)) throw badRequest('Unknown status');
    if (id && data.status) {
      const cur = await this.prisma.db.regulatoryChange.findUnique({ where: { id } });
      if (!cur) throw notFound('Change');
      const order = REG_CHANGE_STATUSES as readonly string[];
      if (order.indexOf(data.status) < order.indexOf(cur.status)) throw conflict('A change cannot move backwards');
      if (data.status !== 'IDENTIFIED' && data.status !== 'IMPACT_ASSESSMENT' && !(data.impact ?? cur.impact)) throw badRequest('Record the impact assessment first');
    }
    if (!id && !data.kind) throw badRequest('Choose the kind of change');
    const row = id ? await this.prisma.db.regulatoryChange.update({ where: { id }, data }) : await this.prisma.db.regulatoryChange.create({ data: { ...data, kind: data.kind!, status: data.status ?? 'IDENTIFIED' } });
    await this.audit.log({ action: id ? 'cmp.change.updated' : 'cmp.change.created', entityType: 'RegulatoryChange', entityId: row.id, after: row });
    return row;
  }

  // ------------------------------------------------------------------ dissemination + acknowledgement
  async disseminate(input: { subject: string; body: string; lawId?: string | null; obligationId?: string | null; departmentIds: string[] }) {
    if (!this.policy.covers('cmp:disseminate', 'CMP')) throw forbidden();
    if (!input.departmentIds.length) throw badRequest('Choose at least one department');
    const cal = await this.settings.calendar();
    const policy = await this.prisma.base.slaPolicy.findUnique({ where: { code: 'CMP_CIRCULAR_ACK' } });
    const dueAt = addBusinessDays(new Date(), policy?.target ?? 5, cal);
    const d = await this.prisma.tx(async (tx) => {
      const row = await tx.dissemination.create({ data: { subject: input.subject, body: input.body, lawId: input.lawId ?? null, obligationId: input.obligationId ?? null, sentById: currentUser().id, dueAt } });
      await tx.disseminationRecipient.createMany({ data: input.departmentIds.map((departmentId) => ({ disseminationId: row.id, departmentId })) });
      return row;
    });
    const recipients = await this.prisma.db.disseminationRecipient.findMany({ where: { disseminationId: d.id } });
    for (const r of recipients) {
      await this.sla.start({ policyCode: 'CMP_CIRCULAR_ACK', step: 'CMP_CIRCULAR_ACK', subjectType: 'DisseminationRecipient', subjectId: r.id });
      await this.notifications.notify(await this.focalPoints(r.departmentId), { type: 'cmp.circular', title: `Legal circular: ${input.subject}`, body: `${input.body.slice(0, 1500)}\n\nPlease acknowledge by ${dueAt.toISOString().slice(0, 10)}.`, link: '/compliance', emailAlways: false });
    }
    await this.audit.log({ action: 'cmp.disseminated', entityType: 'Dissemination', entityId: d.id, meta: { departments: input.departmentIds.length } });
    return d;
  }

  async disseminations() {
    this.assertReader();
    const u = currentUser();
    const deptOnly = !this.isLegal();
    const rows = await this.prisma.db.dissemination.findMany({
      where: deptOnly ? { recipients: { some: { departmentId: u.departmentId ?? '__none__' } } } : {},
      include: { recipients: deptOnly ? { where: { departmentId: u.departmentId ?? '__none__' } } : true, law: { select: { id: true, title: true } } },
      orderBy: { sentAt: 'desc' }, take: 200,
    });
    return rows.map((d) => ({ ...d, acknowledged: d.recipients.filter((r) => r.acknowledgedAt).length, total: d.recipients.length }));
  }

  async acknowledge(recipientId: string) {
    const r = await this.prisma.db.disseminationRecipient.findUnique({ where: { id: recipientId } });
    if (!r) throw notFound('Circular');
    if (!this.isDeptUser(r.departmentId)) throw notFound('Circular');
    if (r.acknowledgedAt) return r;
    const row = await this.prisma.db.disseminationRecipient.update({ where: { id: recipientId }, data: { acknowledgedAt: new Date(), acknowledgedById: currentUser().id } });
    await this.sla.stop({ subjectType: 'DisseminationRecipient', subjectId: recipientId });
    await this.audit.log({ action: 'cmp.acknowledged', entityType: 'DisseminationRecipient', entityId: recipientId });
    return row;
  }

  /** Daily: remind departments that have not acknowledged (once a day, up to 5 times). */
  async ackReminders() {
    const due = await this.prisma.db.disseminationRecipient.findMany({
      where: { acknowledgedAt: null, remindersSent: { lt: 5 }, OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: new Date(Date.now() - 20 * 3600_000) } }], dissemination: { dueAt: { lt: new Date(Date.now() + 2 * DAY) } } },
      include: { dissemination: true },
    });
    for (const r of due) {
      await this.prisma.db.disseminationRecipient.update({ where: { id: r.id }, data: { remindersSent: { increment: 1 }, lastReminderAt: new Date() } });
      await this.notifications.notify(await this.focalPoints(r.departmentId), { type: 'cmp.circular.reminder', title: `Reminder: please acknowledge "${r.dissemination.subject}"`, link: '/compliance' });
    }
    return { reminded: due.length };
  }

  // ------------------------------------------------------------------ periodic checks
  /** Daily: issue checklists for obligations whose next check is due, one cycle per department and period. */
  async generateCycles(now = new Date()) {
    const cal = await this.settings.calendar();
    const policy = await this.prisma.base.slaPolicy.findUnique({ where: { code: 'CMP_CHECKLIST' } });
    const obligations = await this.prisma.db.obligation.findMany({ where: { active: true, OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: now } }] } });
    let items = 0;
    const touched = new Set<string>();
    for (const o of obligations) {
      const freq = o.frequency as Frequency;
      const period = periodOf(freq, now, o.id);
      for (const departmentId of o.departmentIds) {
        let cycle = await this.prisma.db.checkCycle.findUnique({ where: { departmentId_period: { departmentId, period } } });
        if (!cycle) {
          cycle = await this.prisma.db.checkCycle.create({ data: { departmentId, period, dueAt: addBusinessDays(now, policy?.target ?? 10, cal) } });
          await this.sla.start({ policyCode: 'CMP_CHECKLIST', step: 'CMP_CHECKLIST', subjectType: 'CheckCycle', subjectId: cycle.id, startedAt: now });
          await this.calendar.upsert({ kind: 'COMPLIANCE_CHECK', unit: 'CMP', title: `Compliance checklist due (${period})`, sourceType: 'CheckCycle', sourceId: cycle.id, startsAt: cycle.dueAt, allDay: true });
        }
        if (cycle.status === 'COMPLETED') continue;
        const created = await this.prisma.db.checkItem.createMany({ data: [{ cycleId: cycle.id, obligationId: o.id }], skipDuplicates: true });
        items += created.count;
        if (created.count) touched.add(cycle.id);
      }
      await this.prisma.db.obligation.update({ where: { id: o.id }, data: { nextCheckAt: freq === 'ONE_OFF' ? null : nextPeriodStart(freq, now), ...(freq === 'ONE_OFF' ? { active: false } : {}) } });
    }
    for (const cycleId of touched) {
      const c = await this.prisma.db.checkCycle.findUniqueOrThrow({ where: { id: cycleId } });
      await this.notifications.notify(await this.focalPoints(c.departmentId), { type: 'cmp.checklist', title: `Compliance checklist for ${c.period} is ready`, body: `Please answer and upload evidence by ${c.dueAt.toISOString().slice(0, 10)}.`, link: `/compliance/checks/${c.id}` });
    }
    return { obligations: obligations.length, items, cycles: touched.size };
  }

  async cycles(f: { status?: string; departmentId?: string }) {
    this.assertReader();
    const u = currentUser();
    const deptOnly = !this.isLegal();
    return this.prisma.db.checkCycle.findMany({
      where: { ...(deptOnly ? { departmentId: u.departmentId ?? '__none__' } : f.departmentId ? { departmentId: f.departmentId } : {}), ...(f.status ? { status: f.status } : {}) },
      include: { _count: { select: { items: true } } }, orderBy: { dueAt: 'desc' }, take: 300,
    });
  }

  async cycle(id: string) {
    const c = await this.prisma.db.checkCycle.findUnique({ where: { id }, include: { items: { include: { obligation: { include: { law: { select: { id: true, title: true } } } }, documents: { where: { deletedAt: null }, include: { versions: { orderBy: { versionNo: 'desc' }, take: 1, select: { id: true, filename: true, scanStatus: true } } } }, findings: true } } } });
    if (!c) throw notFound('Checklist');
    if (!this.isDeptUser(c.departmentId) && !this.isLegal()) throw notFound('Checklist');
    await this.audit.log({ action: 'cmp.cycle.view', entityType: 'CheckCycle', entityId: id });
    return c;
  }

  async respond(itemId: string, response: string) {
    const item = await this.assertItemAccess(itemId, true);
    await this.prisma.tx(async (tx) => {
      await tx.checkItem.update({ where: { id: itemId }, data: { response, respondedById: currentUser().id } });
      if (item.cycle.status === 'ISSUED') await tx.checkCycle.update({ where: { id: item.cycleId }, data: { status: 'IN_PROGRESS' } });
    });
    await this.audit.log({ action: 'cmp.item.responded', entityType: 'CheckItem', entityId: itemId });
    return { ok: true };
  }

  private async moveCycle(id: string, to: CheckCycleStatus) {
    const c = await this.prisma.db.checkCycle.findUnique({ where: { id }, include: { items: true } });
    if (!c) throw notFound('Checklist');
    if (!canMove(CHECK_CYCLE_TRANSITIONS, c.status as CheckCycleStatus, to)) throw conflict(`Checklist cannot move from ${c.status} to ${to}`);
    return c;
  }

  async submitCycle(id: string) {
    const c = await this.moveCycle(id, 'SUBMITTED');
    if (!this.isDeptUser(c.departmentId)) throw notFound('Checklist');
    if (c.items.some((i) => !i.response?.trim())) throw badRequest('Answer every item before submitting');
    await this.prisma.db.checkCycle.update({ where: { id }, data: { status: 'SUBMITTED', submittedAt: new Date() } });
    await this.sla.stop({ subjectType: 'CheckCycle', subjectId: id });
    await this.calendar.cancel('CheckCycle', id);
    await this.audit.log({ action: 'cmp.cycle.submitted', entityType: 'CheckCycle', entityId: id });
    await this.notifications.notify(await this.notifications.usersWithRole('UNIT_HEAD', 'CMP'), { type: 'cmp.cycle.submitted', title: `Compliance checklist ${c.period} submitted for review`, link: `/compliance/checks/${id}` });
    return { ok: true };
  }

  /** Officer rates an item. Partial / non-compliant creates a finding with a remediation deadline. */
  async rate(itemId: string, rating: 'COMPLIANT' | 'PARTIAL' | 'NON_COMPLIANT' | 'NA', note?: string, severity?: Severity) {
    if (!this.policy.covers('cmp:review', 'CMP')) throw forbidden();
    const item = await this.prisma.db.checkItem.findUnique({ where: { id: itemId }, include: { cycle: true, obligation: true, findings: true } });
    if (!item) throw notFound('Checklist item');
    if (!['SUBMITTED', 'UNDER_REVIEW'].includes(item.cycle.status)) throw conflict('The department has not submitted this checklist yet');
    let findingId: string | null = null;
    await this.prisma.tx(async (tx) => {
      await tx.checkItem.update({ where: { id: itemId }, data: { rating, reviewNote: note ?? null, reviewerId: currentUser().id } });
      if (item.cycle.status === 'SUBMITTED') await tx.checkCycle.update({ where: { id: item.cycleId }, data: { status: 'UNDER_REVIEW' } });
      if ((rating === 'NON_COMPLIANT' || rating === 'PARTIAL') && !item.findings.some((f) => f.status !== 'CLOSED')) {
        const sev = severity ?? item.obligation.risk;
        const f = await tx.finding.create({
          data: { checkItemId: itemId, departmentId: item.cycle.departmentId, title: `${rating === 'PARTIAL' ? 'Partial' : 'Non-'}compliance: ${item.obligation.description.slice(0, 200)}`, severity: sev, dueOn: new Date(Date.now() + REMEDIATION_DAYS[sev] * DAY) },
        });
        findingId = f.id;
      }
      const remaining = await tx.checkItem.count({ where: { cycleId: item.cycleId, rating: null } });
      if (remaining === 0) await tx.checkCycle.update({ where: { id: item.cycleId }, data: { status: 'COMPLETED', completedAt: new Date() } });
    });
    if (findingId) {
      const f = await this.prisma.db.finding.findUniqueOrThrow({ where: { id: findingId } });
      await this.calendar.upsert({ kind: 'COMPLIANCE_CHECK', unit: 'CMP', title: `Remediation due: ${f.title}`, sourceType: 'Finding', sourceId: f.id, startsAt: f.dueOn, allDay: true });
      await this.notifications.notify(await this.focalPoints(item.cycle.departmentId), { type: 'cmp.finding', title: `Compliance finding (${f.severity.toLowerCase()}): action plan needed`, link: `/compliance/findings/${f.id}` });
    }
    await this.audit.log({ action: 'cmp.item.rated', entityType: 'CheckItem', entityId: itemId, after: { rating, findingId } });
    return { ok: true, findingId };
  }

  async returnCycle(id: string, note: string) {
    if (!this.policy.covers('cmp:review', 'CMP')) throw forbidden();
    const c = await this.moveCycle(id, 'IN_PROGRESS');
    await this.prisma.db.checkCycle.update({ where: { id }, data: { status: 'IN_PROGRESS' } });
    await this.notifications.notify(await this.focalPoints(c.departmentId), { type: 'cmp.cycle.returned', title: `Compliance checklist ${c.period} returned: more evidence needed`, body: note, link: `/compliance/checks/${id}` });
    await this.audit.log({ action: 'cmp.cycle.returned', entityType: 'CheckCycle', entityId: id, meta: { note } });
    return { ok: true };
  }

  // ------------------------------------------------------------------ findings
  async findings(f: { status?: string; departmentId?: string; severity?: string; overdue?: boolean }) {
    this.assertReader();
    const u = currentUser();
    const deptOnly = !this.isLegal();
    return this.prisma.db.finding.findMany({
      where: {
        ...(deptOnly ? { departmentId: u.departmentId ?? '__none__' } : f.departmentId ? { departmentId: f.departmentId } : {}),
        ...(f.status ? { status: f.status } : {}), ...(f.severity ? { severity: f.severity as Severity } : {}),
        ...(f.overdue ? { status: { not: 'CLOSED' }, dueOn: { lt: new Date() } } : {}),
      },
      orderBy: [{ status: 'asc' }, { dueOn: 'asc' }], take: 500,
    });
  }

  async finding(id: string) {
    await this.assertFindingAccess(id);
    return this.prisma.db.finding.findUniqueOrThrow({ where: { id }, include: { actions: { orderBy: { at: 'asc' } }, checkItem: { include: { obligation: { include: { law: { select: { id: true, title: true } } } } } } } });
  }

  async findingStep(id: string, to: FindingStatus, data: { actionPlan?: string; ownerId?: string | null; note?: string }) {
    const f = await this.assertFindingAccess(id);
    if (!canMove(FINDING_TRANSITIONS, f.status as FindingStatus, to)) throw conflict(`Finding cannot move from ${f.status} to ${to}`);
    const staff = this.policy.covers('cmp:review', 'CMP');
    if ((to === 'CLOSED' || (f.status === 'EVIDENCE_SUBMITTED' && to === 'ACTION_PLAN_AGREED')) && !staff) throw forbidden('Only a compliance officer can verify and close a finding');
    if (to === 'ACTION_PLAN_AGREED' && f.status === 'OPEN' && !(data.actionPlan ?? f.actionPlan)) throw badRequest('Write the action plan');
    if (to === 'EVIDENCE_SUBMITTED' && !(await this.prisma.db.document.count({ where: { findingId: id, deletedAt: null } }))) throw badRequest('Upload evidence of closure first');
    await this.prisma.tx(async (tx) => {
      await tx.finding.update({ where: { id }, data: { status: to, ...(data.actionPlan ? { actionPlan: data.actionPlan } : {}), ...(data.ownerId !== undefined ? { ownerId: data.ownerId } : {}), ...(to === 'CLOSED' ? { closedAt: new Date() } : {}) } });
      await tx.findingAction.create({ data: { findingId: id, note: data.note ?? `${f.status} → ${to}`, byId: currentUser().id } });
    });
    if (to === 'CLOSED') await this.calendar.cancel('Finding', id);
    await this.audit.log({ action: 'cmp.finding.status', entityType: 'Finding', entityId: id, before: { status: f.status }, after: { status: to } });
    return this.finding(id);
  }

  /** Daily: overdue findings escalate once to the Compliance Unit Head and HoD. */
  async findingsOverdue() {
    const overdue = await this.prisma.db.finding.findMany({ where: { status: { not: 'CLOSED' }, dueOn: { lt: new Date() }, escalatedAt: null } });
    const to = [...(await this.notifications.usersWithRole('UNIT_HEAD', 'CMP')), ...(await this.notifications.usersWithRole('HOD'))];
    for (const f of overdue) {
      await this.prisma.db.finding.update({ where: { id: f.id }, data: { escalatedAt: new Date() } });
      await this.notifications.notify(to, { type: 'cmp.finding.overdue', title: `Overdue ${f.severity.toLowerCase()} finding: ${f.title}`, link: `/compliance/findings/${f.id}` });
    }
    return { escalated: overdue.length };
  }

  // ------------------------------------------------------------------ licences
  licences(f: { expiringDays?: number }) {
    if (!this.isLegal()) throw forbidden();
    return this.prisma.db.licence.findMany({ where: f.expiringDays ? { expiresOn: { lte: new Date(Date.now() + f.expiringDays * DAY) } } : {}, include: { regulator: { select: { name: true } } }, orderBy: { expiresOn: 'asc' } });
  }

  async saveLicence(id: string | null, data: { name: string; kind: string; regulatorId?: string | null; number?: string | null; issuedOn?: Date | null; expiresOn?: Date | null; ownerDeptId?: string | null; status?: string; notes?: string | null }) {
    this.assertStaff();
    const row = id ? await this.prisma.db.licence.update({ where: { id }, data }) : await this.prisma.db.licence.create({ data });
    if (row.expiresOn) await this.calendar.upsert({ kind: row.kind === 'FILING' ? 'FILING' : 'LICENCE_EXPIRY', unit: 'CMP', title: `${row.kind === 'FILING' ? 'Filing due' : 'Renewal due'}: ${row.name}`, sourceType: 'Licence', sourceId: row.id, startsAt: row.expiresOn, allDay: true, cancelled: row.status !== 'ACTIVE' });
    await this.audit.log({ action: id ? 'cmp.licence.updated' : 'cmp.licence.created', entityType: 'Licence', entityId: row.id, after: row });
    return row;
  }

  // ------------------------------------------------------------------ dashboard
  async dashboard() {
    if (!this.isLegal()) throw forbidden();
    const [items, findings, overdueCycles, depts, laws] = await Promise.all([
      this.prisma.db.checkItem.findMany({ where: { rating: { not: null } }, select: { rating: true, obligation: { select: { lawId: true } }, cycle: { select: { departmentId: true, completedAt: true, submittedAt: true, createdAt: true } } } }),
      this.prisma.db.finding.groupBy({ by: ['severity', 'status'], _count: true }),
      this.prisma.db.checkCycle.count({ where: { status: { in: ['ISSUED', 'IN_PROGRESS'] }, dueAt: { lt: new Date() } } }),
      this.prisma.base.department.findMany({ select: { id: true, name: true, code: true } }),
      this.prisma.db.law.findMany({ select: { id: true, title: true } }),
    ]);
    const score = (rs: (string | null)[]) => {
      const rated = rs.filter((r) => r && r !== 'NA');
      if (!rated.length) return null;
      return Math.round((rated.reduce((n, r) => n + (r === 'COMPLIANT' ? 1 : r === 'PARTIAL' ? 0.5 : 0), 0) / rated.length) * 100);
    };
    const heat: { departmentId: string; department: string; lawId: string; law: string; score: number | null; items: number }[] = [];
    const key = (d: string, l: string) => `${d}|${l}`;
    const groups = new Map<string, (string | null)[]>();
    for (const i of items) {
      const k = key(i.cycle.departmentId, i.obligation.lawId);
      groups.set(k, [...(groups.get(k) ?? []), i.rating]);
    }
    for (const [k, rs] of groups) {
      const [d, l] = k.split('|');
      heat.push({ departmentId: d!, department: depts.find((x) => x.id === d)?.name ?? '', lawId: l!, law: laws.find((x) => x.id === l)?.title ?? '', score: score(rs), items: rs.length });
    }
    const byMonth = new Map<string, (string | null)[]>();
    for (const i of items) {
      const m = (i.cycle.completedAt ?? i.cycle.submittedAt ?? i.cycle.createdAt).toISOString().slice(0, 7);
      byMonth.set(m, [...(byMonth.get(m) ?? []), i.rating]);
    }
    return {
      heat,
      trend: [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, rs]) => ({ month, score: score(rs) })),
      overallScore: score(items.map((i) => i.rating)),
      overdueChecks: overdueCycles,
      openFindings: findings.filter((f) => f.status !== 'CLOSED').map((f) => ({ severity: f.severity, status: f.status, count: f._count })),
      overdueFindings: await this.prisma.db.finding.count({ where: { status: { not: 'CLOSED' }, dueOn: { lt: new Date() } } }),
      pendingAcks: await this.prisma.db.disseminationRecipient.count({ where: { acknowledgedAt: null } }),
    };
  }
}
