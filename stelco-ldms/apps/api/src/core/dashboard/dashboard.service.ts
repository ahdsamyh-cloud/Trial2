import { Injectable } from '@nestjs/common';
import { Prisma, Unit } from '@prisma/client';
import { businessDaysBetween, UNITS } from '@ldms/shared';
import { CryptoService } from '../../common/crypto.service';
import { currentUser, runAsSystem } from '../../common/context';
import { forbidden } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../config/settings.service';
import { PolicyService } from '../policy/policy.service';

export interface DashFilter { unit?: Unit; departmentId?: string; assigneeId?: string; from?: Date; to?: Date }

/**
 * HoD / unit / management dashboards. Detail-level figures use the caller's scope (RLS + PolicyService).
 * The management view is aggregate-only: restricted matters are counted in a single "Confidential"
 * bucket and never broken down.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly crypto: CryptoService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  private where(f: DashFilter, base: Prisma.MatterWhereInput): Prisma.MatterWhereInput {
    return {
      AND: [base,
        ...(f.unit ? [{ unit: f.unit }] : []), ...(f.departmentId ? [{ requestingDeptId: f.departmentId }] : []),
        ...(f.assigneeId ? [{ assignments: { some: { userId: f.assigneeId } } }] : []),
        ...(f.from || f.to ? [{ createdAt: { gte: f.from, lte: f.to } }] : [])],
    };
  }

  async overview(f: DashFilter) {
    const user = currentUser();
    const full = user.perms.has('dashboard:hod') || user.perms.has('dashboard:unit');
    if (!full) throw forbidden();
    if (user.perms.get('dashboard:unit')?.scope === 'UNIT' && !user.perms.has('dashboard:hod')) {
      const units = user.perms.get('dashboard:unit')!.units as Unit[];
      if (f.unit && !units.includes(f.unit)) throw forbidden();
      if (!f.unit) f.unit = units[0];
    }
    const where = this.where(f, this.policy.matterScope());
    const openWhere = { AND: [where, { closedAt: null }] };
    const cal = await this.settings.calendar();
    const [byUnitStatus, breaches, closed, workloadRaw, hearings, deadlines, cases] = await Promise.all([
      this.prisma.db.matter.groupBy({ by: ['unit', 'status'], where: openWhere, _count: true }),
      this.prisma.db.slaClock.findMany({ where: { breachedAt: { not: null }, stoppedAt: null, matter: where }, include: { matter: { select: { id: true, reference: true, title: true, unit: true } }, policy: { select: { name: true } } }, take: 50, orderBy: { breachedAt: 'asc' } }),
      this.prisma.db.matter.findMany({ where: { AND: [where, { closedAt: { not: null } }] }, select: { unit: true, createdAt: true, closedAt: true }, take: 5000 }),
      this.prisma.db.matterAssignment.groupBy({ by: ['userId'], where: { role: 'ASSIGNEE', matter: openWhere }, _count: true }),
      this.prisma.db.calendarEvent.findMany({ where: { AND: [{ kind: 'HEARING', cancelled: false, startsAt: { gte: new Date(), lte: new Date(Date.now() + 30 * 86400_000) } }, ...(f.unit && f.unit !== 'LIT' ? [{ id: '__none__' }] : []), { OR: [{ matterId: null }, { matter: this.policy.matterScope() }] }] }, orderBy: { startsAt: 'asc' }, take: 20 }),
      this.prisma.db.calendarEvent.findMany({ where: { AND: [{ kind: { in: ['DEADLINE', 'LIMITATION', 'FILING', 'CONTRACT_NOTICE', 'LICENCE_EXPIRY', 'POA_EXPIRY'] }, cancelled: false, startsAt: { gte: new Date(), lte: new Date(Date.now() + 30 * 86400_000) } }, ...(f.unit ? [{ unit: f.unit }] : []), { OR: [{ matterId: null }, { matter: this.policy.matterScope() }] }] }, orderBy: { startsAt: 'asc' }, take: 20 }),
      !f.unit || f.unit === 'LIT' ? this.prisma.db.litigationCase.findMany({ where: { matter: openWhere }, select: { risk: true, currency: true, claimAmount: true, exposureEnc: true } }) : Promise.resolve([]),
    ]);
    const names = await this.prisma.base.user.findMany({ where: { id: { in: workloadRaw.map((w) => w.userId) } }, select: { id: true, displayName: true } });
    const turnaround = UNITS.map((u) => {
      const rows = closed.filter((c) => c.unit === u);
      const days = rows.map((r) => businessDaysBetween(r.createdAt, r.closedAt!, cal));
      return { unit: u, closed: rows.length, avgBusinessDays: days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : null };
    });
    const exposure: Record<string, Record<string, { count: number; exposure: number; claim: number }>> = {};
    for (const c of cases) {
      const r = c.risk ?? 'UNASSESSED';
      exposure[c.currency] ??= {};
      const e = (exposure[c.currency]![r] ??= { count: 0, exposure: 0, claim: 0 });
      e.count++; e.claim += c.claimAmount ? Number(c.claimAmount) : 0; e.exposure += Number(this.crypto.decrypt(c.exposureEnc) ?? 0);
    }
    const [cmpHeat, awareness] = await Promise.all([this.complianceHeat(), this.awarenessCoverage()]);
    await this.audit.log({ action: 'dashboard.view', meta: { filter: f } });
    return {
      openByUnitStatus: byUnitStatus.map((r) => ({ unit: r.unit, status: r.status, count: r._count })),
      slaBreaches: breaches.map((b) => ({ id: b.id, policy: b.policy.name, breachedAt: b.breachedAt, escalationLevel: b.escalationLevel, matter: b.matter })),
      turnaround,
      workload: workloadRaw.map((w) => ({ userId: w.userId, name: names.find((n) => n.id === w.userId)?.displayName ?? '', open: w._count })).sort((a, b) => b.open - a.open),
      upcoming: [...hearings, ...deadlines].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()).slice(0, 25).map((e) => ({ id: e.id, kind: e.kind, title: e.title, startsAt: e.startsAt, matterId: e.matterId, unit: e.unit })),
      exposure,
      complianceHeat: user.perms.has('dashboard:hod') || f.unit === 'CMP' ? cmpHeat : [],
      awarenessCoverage: user.perms.has('dashboard:hod') || f.unit === 'AWR' ? awareness : null,
    };
  }

  /**
   * Workload per lawyer (HoD: everyone; Unit Head: their unit's staff). Counts only matters the caller can see.
   * open = assigned open matters (as assignee), reviewing = open matters waiting on them as reviewer/approver,
   * hearings7d = their hearings in the next 7 days, overdue = open deadlines past due, breaches = SLA clocks breached,
   * research = open law-research tasks, closed30d = matters they closed in the last 30 days.
   */
  async workload(unit?: Unit) {
    const user = currentUser();
    if (!user.perms.has('dashboard:hod') && !user.perms.has('dashboard:unit')) throw forbidden();
    let units: Unit[] | 'ALL' = 'ALL';
    if (!user.perms.has('dashboard:hod')) units = user.perms.get('dashboard:unit')!.units as Unit[];
    if (unit) { if (units !== 'ALL' && !units.includes(unit)) throw forbidden(); units = [unit]; }
    const staffRoles = await this.prisma.base.userRole.findMany({
      where: { role: { in: ['UNIT_HEAD', 'LEGAL_OFFICER', 'PARALEGAL', ...(units === 'ALL' ? (['HOD'] as const) : [])] }, user: { status: 'ACTIVE' }, ...(units === 'ALL' ? {} : { OR: [{ unit: { in: units } }, { unit: null, role: 'HOD' }] }) },
      select: { userId: true, role: true, unit: true, user: { select: { displayName: true, username: true } } },
    });
    const people = new Map<string, { userId: string; name: string; username: string; roles: string[] }>();
    for (const r of staffRoles) {
      const p = people.get(r.userId) ?? { userId: r.userId, name: r.user.displayName, username: r.user.username, roles: [] };
      p.roles.push(r.role === 'HOD' ? 'HoD' : `${r.role === 'UNIT_HEAD' ? 'Unit Head' : r.role === 'LEGAL_OFFICER' ? 'Legal Officer' : 'Paralegal'}${r.unit ? ` (${r.unit})` : ''}`);
      people.set(r.userId, p);
    }
    const ids = [...people.keys()];
    const scope = this.policy.matterScope();
    const unitWhere: Prisma.MatterWhereInput = units === 'ALL' ? {} : { unit: { in: units } };
    const open: Prisma.MatterWhereInput = { AND: [scope, unitWhere, { closedAt: null }] };
    const now = new Date();
    const week = new Date(now.getTime() + 7 * 86400_000);
    const [assigned, reviewing, hearings, overdue, breaches, research, closed] = await Promise.all([
      this.prisma.db.matterAssignment.groupBy({ by: ['userId'], where: { userId: { in: ids }, role: 'ASSIGNEE', matter: open }, _count: true }),
      this.prisma.db.matterAssignment.groupBy({ by: ['userId'], where: { userId: { in: ids }, role: { in: ['REVIEWER', 'APPROVER'] }, matter: open }, _count: true }),
      this.prisma.db.hearing.findMany({ where: { status: 'SCHEDULED', startsAt: { gte: now, lt: week }, case: { matter: open } }, select: { case: { select: { responsibleOfficerId: true, matter: { select: { assignments: { where: { role: 'ASSIGNEE' }, select: { userId: true } } } } } } } }),
      this.prisma.db.caseDeadline.groupBy({ by: ['ownerId'], where: { ownerId: { in: ids }, status: 'OPEN', dueAt: { lt: now }, case: { matter: open } }, _count: true }),
      this.prisma.db.slaClock.findMany({ where: { breachedAt: { not: null }, stoppedAt: null, matter: open }, select: { matter: { select: { assignments: { where: { role: 'ASSIGNEE' }, select: { userId: true } } } } } }),
      units === 'ALL' || units.includes('CMP') ? this.prisma.db.law.groupBy({ by: ['researchAssigneeId'], where: { researchAssigneeId: { in: ids }, researchStatus: { in: ['ASSIGNED', 'IN_PROGRESS'] } }, _count: true }) : Promise.resolve([]),
      this.prisma.db.matterAssignment.groupBy({ by: ['userId'], where: { userId: { in: ids }, role: 'ASSIGNEE', matter: { AND: [scope, unitWhere, { closedAt: { gte: new Date(now.getTime() - 30 * 86400_000) } }] } }, _count: true }),
    ]);
    const count = (rows: { _count: number }[], key: (r: never) => string | null, id: string) => (rows as never[]).filter((r) => key(r) === id).reduce((n, r) => n + (r as { _count: number })._count, 0);
    const rows = ids.map((id) => {
      const p = people.get(id)!;
      const h = hearings.filter((x) => x.case.responsibleOfficerId === id || x.case.matter.assignments.some((a) => a.userId === id)).length;
      const b = breaches.filter((x) => x.matter?.assignments.some((a) => a.userId === id)).length;
      const r = {
        ...p,
        open: count(assigned, (x: { userId: string }) => x.userId, id), reviewing: count(reviewing, (x: { userId: string }) => x.userId, id),
        hearings7d: h, overdue: count(overdue, (x: { ownerId: string | null }) => x.ownerId, id), breaches: b,
        research: count(research as { _count: number }[], (x: { researchAssigneeId: string | null }) => x.researchAssigneeId, id),
        closed30d: count(closed, (x: { userId: string }) => x.userId, id),
      };
      return { ...r, load: r.open + r.reviewing + r.hearings7d + r.research + 2 * (r.overdue + r.breaches) };
    }).sort((a, b) => b.load - a.load);
    await this.audit.log({ action: 'dashboard.workload', meta: { unit: unit ?? null } });
    return { units, people: rows };
  }

  private async complianceHeat() {
    const items = await this.prisma.db.checkItem.findMany({ where: { rating: { not: null } }, select: { rating: true, cycle: { select: { departmentId: true } }, obligation: { select: { law: { select: { id: true, title: true } } } } } });
    const depts = await this.prisma.base.department.findMany({ select: { id: true, name: true } });
    const map = new Map<string, { departmentId: string; department: string; lawId: string; law: string; ratings: string[] }>();
    for (const i of items) {
      const k = `${i.cycle.departmentId}|${i.obligation.law.id}`;
      const cur = map.get(k) ?? { departmentId: i.cycle.departmentId, department: depts.find((d) => d.id === i.cycle.departmentId)?.name ?? '', lawId: i.obligation.law.id, law: i.obligation.law.title, ratings: [] };
      cur.ratings.push(i.rating!);
      map.set(k, cur);
    }
    return [...map.values()].map(({ ratings, ...r }) => {
      const rated = ratings.filter((x) => x !== 'NA');
      return { ...r, score: rated.length ? Math.round((rated.reduce((n, x) => n + (x === 'COMPLIANT' ? 1 : x === 'PARTIAL' ? 0.5 : 0), 0) / rated.length) * 100) : null };
    });
  }

  private async awarenessCoverage() {
    const year = new Date().getUTCFullYear();
    const [employees, attended, held] = await Promise.all([
      this.prisma.db.employee.count({ where: { active: true } }),
      this.prisma.db.attendance.findMany({ where: { session: { startsAt: { gte: new Date(Date.UTC(year, 0, 1)) } } }, select: { employeeId: true }, distinct: ['employeeId'] }),
      this.prisma.db.awarenessSession.count({ where: { startsAt: { gte: new Date(Date.UTC(year, 0, 1)) }, status: { in: ['HELD', 'FEEDBACK_COLLECTED', 'CLOSED'] } } }),
    ]);
    return { year, employees, reached: attended.length, percent: employees ? Math.round((attended.length / employees) * 100) : null, sessionsHeld: held };
  }

  /** Management viewer: aggregates only; restricted matters collapse into "Confidential". */
  async management(f: { from?: Date; to?: Date }) {
    const user = currentUser();
    if (!user.perms.has('dashboard:mgmt')) throw forbidden();
    const result = await runAsSystem(async () => {
      const range = f.from || f.to ? { createdAt: { gte: f.from, lte: f.to } } : {};
      const [open, confidential, closed, breaches, exposureCases] = await Promise.all([
        this.prisma.db.matter.groupBy({ by: ['unit'], where: { closedAt: null, restricted: false, ...range }, _count: true }),
        this.prisma.db.matter.count({ where: { closedAt: null, restricted: true, ...range } }),
        this.prisma.db.matter.groupBy({ by: ['unit'], where: { closedAt: { not: null }, restricted: false, ...range }, _count: true }),
        this.prisma.db.slaClock.count({ where: { breachedAt: { not: null }, stoppedAt: null } }),
        this.prisma.db.litigationCase.findMany({ where: { matter: { closedAt: null } }, select: { risk: true, currency: true, exposureEnc: true } }),
      ]);
      const exposure: Record<string, Record<string, number>> = {};
      for (const c of exposureCases) {
        exposure[c.currency] ??= {};
        const r = c.risk ?? 'UNASSESSED';
        exposure[c.currency]![r] = (exposure[c.currency]![r] ?? 0) + Number(this.crypto.decrypt(c.exposureEnc) ?? 0);
      }
      return {
        openByUnit: open.map((r) => ({ unit: r.unit, count: r._count })), confidentialOpen: confidential,
        closedByUnit: closed.map((r) => ({ unit: r.unit, count: r._count })), slaBreachesOpen: breaches, litigationExposure: exposure,
        compliance: await this.complianceHeat().then((h) => ({ cells: h.length, average: h.length ? Math.round(h.reduce((n, c) => n + (c.score ?? 0), 0) / h.length) : null })),
        awareness: await this.awarenessCoverage(),
      };
    });
    await this.audit.log({ action: 'dashboard.management.view', meta: { filter: f } });
    return result;
  }
}
