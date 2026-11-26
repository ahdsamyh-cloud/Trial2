import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma, Unit } from '@prisma/client';
import { addBusinessDays, evaluateSla } from '@ldms/shared';
import { PrismaService, Tx } from '../../common/prisma.service';
import { notFound } from '../../common/errors';
import { SettingsService } from '../config/settings.service';
import { JobsService } from '../jobs/jobs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';

type ClockWithPauses = Prisma.SlaClockGetPayload<{ include: { pauses: true; policy: true; matter: true } }>;

const STEP_UNIT: Record<string, Unit> = { LIT: 'LIT', CMP: 'CMP', DRF: 'DRF', AWR: 'AWR' };

@Injectable()
export class SlaService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.jobs.register('sla.scan', () => this.scan());
  }

  /** Start a clock. Business-day maths uses the configured Sun–Thu calendar and holidays. */
  async start(input: {
    policyCode: string; step: string; startedAt?: Date; urgent?: boolean; ownerId?: string | null;
    matterId?: string; subjectType?: string; subjectId?: string;
  }, tx?: Tx) {
    const db = tx ?? this.prisma.db;
    const policy = await db.slaPolicy.findUnique({ where: { code: input.policyCode } });
    if (!policy || !policy.active) return null;
    const startedAt = input.startedAt ?? new Date();
    const cal = await this.settings.calendar();
    const ev = evaluateSla({ startedAt, targetDays: policy.target, unit: policy.unit, urgent: input.urgent, urgentHalves: policy.urgentHalves }, startedAt, cal);
    return db.slaClock.create({
      data: {
        matterId: input.matterId, subjectType: input.subjectType, subjectId: input.subjectId, policyId: policy.id, step: input.step,
        urgent: !!input.urgent, startedAt, dueAt: ev.dueAt, ownerId: input.ownerId ?? null,
      },
    });
  }

  async stop(where: Prisma.SlaClockWhereInput, tx?: Tx) {
    const db = tx ?? this.prisma.db;
    await db.slaClock.updateMany({ where: { ...where, stoppedAt: null }, data: { stoppedAt: new Date() } });
  }

  /** Pause all running clocks of a matter (Awaiting Information from requester). */
  async pause(matterId: string, reason: string, tx?: Tx) {
    const db = tx ?? this.prisma.db;
    const clocks = await db.slaClock.findMany({ where: { matterId, stoppedAt: null, pauses: { none: { to: null } } } });
    for (const c of clocks) await db.slaPause.create({ data: { clockId: c.id, from: new Date(), reason } });
  }

  async resume(matterId: string, tx?: Tx) {
    const db = tx ?? this.prisma.db;
    const open = await db.slaPause.findMany({ where: { to: null, clock: { matterId } }, include: { clock: { include: { pauses: true, policy: true } } } });
    const cal = await this.settings.calendar();
    for (const p of open) {
      await db.slaPause.update({ where: { id: p.id }, data: { to: new Date() } });
      const pauses = p.clock.pauses.map((x) => (x.id === p.id ? { ...x, to: new Date() } : x));
      const ev = evaluateSla(this.input(p.clock, pauses), new Date(), cal);
      await db.slaClock.update({ where: { id: p.clockId }, data: { dueAt: ev.dueAt } });
    }
  }

  private input(c: { startedAt: Date; urgent: boolean; stoppedAt: Date | null; policy: { target: number; unit: 'BUSINESS' | 'CALENDAR'; urgentHalves: boolean } }, pauses: { from: Date; to: Date | null }[]) {
    return { startedAt: c.startedAt, targetDays: c.policy.target, unit: c.policy.unit, urgent: c.urgent, urgentHalves: c.policy.urgentHalves, pauses, stoppedAt: c.stoppedAt };
  }

  async forMatter(matterId: string) {
    const clocks = await this.prisma.db.slaClock.findMany({ where: { matterId }, include: { pauses: true, policy: true }, orderBy: { startedAt: 'asc' } });
    const cal = await this.settings.calendar();
    const now = new Date();
    return clocks.map((c) => {
      const ev = evaluateSla(this.input(c, c.pauses), now, cal);
      return { id: c.id, step: c.step, policy: c.policy.name, startedAt: c.startedAt, dueAt: ev.dueAt, state: ev.state, percent: Math.round(ev.fraction * 100), stoppedAt: c.stoppedAt, breachedAt: c.breachedAt };
    });
  }

  /** Periodic job: 75 % warning → owner; 100 % breach → owner + Unit Head; +1 business day → HoD. */
  async scan(now = new Date()) {
    const cal = await this.settings.calendar();
    const clocks: ClockWithPauses[] = await this.prisma.db.slaClock.findMany({ where: { stoppedAt: null }, include: { pauses: true, policy: true, matter: true } });
    let warned = 0, breached = 0, escalated = 0;
    for (const c of clocks) {
      if (c.matter?.closedAt) { await this.stop({ id: c.id }); continue; }
      const ev = evaluateSla(this.input(c, c.pauses), now, cal);
      const unit = c.matter?.unit ?? STEP_UNIT[c.step.split('_')[0] ?? ''] ?? null;
      const label = c.matter ? `${c.matter.reference} — ${c.policy.name}` : c.policy.name;
      const link = c.matter ? `/matters/${c.matter.id}` : '/my-work';
      const restricted = !!c.matter?.restricted;
      if (ev.state === 'WARNING' && !c.warnedAt) {
        await this.prisma.db.slaClock.update({ where: { id: c.id }, data: { warnedAt: now } });
        await this.notifications.notify([c.ownerId], { type: 'sla.warning', title: `SLA warning (75%): ${label}`, body: `Due ${ev.dueAt.toISOString()}`, link, matterId: c.matterId ?? undefined, restricted });
        warned++;
      }
      if (ev.state === 'BREACHED' && !c.breachedAt) {
        await this.prisma.db.slaClock.update({ where: { id: c.id }, data: { breachedAt: now, warnedAt: c.warnedAt ?? now, escalationLevel: 1 } });
        const heads = unit ? await this.notifications.usersWithRole('UNIT_HEAD', unit) : [];
        await this.notifications.notify([c.ownerId, ...heads], { type: 'sla.breach', title: `SLA breached: ${label}`, link, matterId: c.matterId ?? undefined, restricted });
        await this.audit.log({ action: 'sla.breached', entityType: 'SlaClock', entityId: c.id, meta: { matterId: c.matterId, step: c.step } });
        breached++;
      } else if (c.breachedAt && c.escalationLevel < 2 && addBusinessDays(c.breachedAt, 1, cal) <= now) {
        await this.prisma.db.slaClock.update({ where: { id: c.id }, data: { escalationLevel: 2 } });
        const hods = await this.notifications.usersWithRole('HOD');
        await this.notifications.notify(hods, { type: 'sla.escalation', title: `SLA escalation to HoD: ${label}`, link, matterId: c.matterId ?? undefined, restricted });
        escalated++;
      }
    }
    return { scanned: clocks.length, warned, breached, escalated };
  }

  async get(id: string) {
    const c = await this.prisma.db.slaClock.findUnique({ where: { id } });
    if (!c) throw notFound();
    return c;
  }
}
