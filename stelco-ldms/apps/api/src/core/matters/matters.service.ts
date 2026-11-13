import { Injectable } from '@nestjs/common';
import { AssignmentRole, Prisma, Priority, Unit } from '@prisma/client';
import { CryptoService } from '../../common/crypto.service';
import { currentUser } from '../../common/context';
import { badRequest, forbidden, notFound } from '../../common/errors';
import { PrismaService, Tx } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PolicyService } from '../policy/policy.service';
import { SlaService } from '../sla/sla.service';
import { ReferenceService } from './reference.service';

export interface CreateMatterInput {
  unit: Unit;
  title: string;
  description?: string | null;
  requestTypeId?: string | null;
  priority?: Priority;
  requestingDeptId?: string | null;
  requesterId?: string | null;
  requesterName?: string | null;
  dueDate?: Date | null;
  restricted?: boolean;
  status: string;
  tags?: string[];
  importBatchId?: string | null;
  searchText?: string | null;
}

export const GENERIC_STATUSES = ['OPEN', 'IN_PROGRESS', 'AWAITING_INFO', 'CLOSED'] as const;

export interface MatterListFilter {
  unit?: Unit;
  status?: string;
  assigneeId?: string;
  priority?: Priority;
  departmentId?: string;
  q?: string;
  open?: boolean;
  mine?: boolean;
  from?: Date;
  to?: Date;
  tag?: string;
}

@Injectable()
export class MattersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refs: ReferenceService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly policy: PolicyService,
    private readonly sla: SlaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Create inside a transaction; reference issued from the per-unit/year counter. */
  async create(tx: Tx, input: CreateMatterInput) {
    const reference = await this.refs.next(tx, input.unit);
    const restricted = !!input.restricted;
    const m = await tx.matter.create({
      data: {
        reference, unit: input.unit, title: input.title, requestTypeId: input.requestTypeId ?? null, status: input.status,
        priority: input.priority ?? 'NORMAL', requestingDeptId: input.requestingDeptId ?? null, requesterId: input.requesterId ?? null,
        // Inserted unrestricted, then restricted once the creator is named (RLS: RETURNING row must be visible).
        requesterName: input.requesterName ?? null, dueDate: input.dueDate ?? null, restricted: false, tags: input.tags ?? [],
        description: restricted ? null : input.description ?? null, descriptionEnc: restricted ? this.crypto.encrypt(input.description) : null,
        importBatchId: input.importBatchId ?? null, createdById: currentUser().id, searchText: restricted ? null : input.searchText ?? null,
      },
    });
    let created = m;
    if (restricted) {
      await tx.matterAccess.create({ data: { matterId: m.id, userId: currentUser().id, grantedById: currentUser().id } });
      created = await tx.matter.update({ where: { id: m.id }, data: { restricted: true } });
    }
    await tx.statusTransition.create({ data: { matterId: m.id, toStatus: input.status, action: 'create', actorId: currentUser().id } });
    return created;
  }

  scopeWhere(f: MatterListFilter, perm: 'matter:read' = 'matter:read'): Prisma.MatterWhereInput {
    const user = currentUser();
    const and: Prisma.MatterWhereInput[] = [this.policy.matterScope(perm)];
    if (f.unit) and.push({ unit: f.unit });
    if (f.status) and.push({ status: f.status });
    if (f.priority) and.push({ priority: f.priority });
    if (f.departmentId) and.push({ requestingDeptId: f.departmentId });
    if (f.open) and.push({ closedAt: null });
    if (f.tag) and.push({ tags: { has: f.tag } });
    if (f.from || f.to) and.push({ createdAt: { gte: f.from, lte: f.to } });
    if (f.assigneeId) and.push({ assignments: { some: { userId: f.assigneeId } } });
    if (f.mine) and.push({ assignments: { some: { userId: user.id } } });
    if (f.q) and.push({ OR: [{ reference: { contains: f.q, mode: 'insensitive' } }, { title: { contains: f.q, mode: 'insensitive' } }, { requesterName: { contains: f.q, mode: 'insensitive' } }] });
    return { AND: and };
  }

  async list(f: MatterListFilter, page = 1, pageSize = 25, sort = 'createdAt', dir: 'asc' | 'desc' = 'desc') {
    const where = this.scopeWhere(f);
    const sortable = ['createdAt', 'dueDate', 'reference', 'priority', 'status', 'updatedAt', 'title'];
    const orderBy = { [sortable.includes(sort) ? sort : 'createdAt']: dir };
    const [rows, total] = await Promise.all([
      this.prisma.db.matter.findMany({
        where, orderBy, skip: (page - 1) * pageSize, take: pageSize,
        select: {
          id: true, reference: true, unit: true, title: true, status: true, priority: true, dueDate: true, restricted: true, createdAt: true,
          requestingDeptId: true, requesterName: true, tags: true, closedAt: true, legalHold: true,
          requestType: { select: { name: true } },
          assignments: { select: { role: true, user: { select: { id: true, displayName: true } } } },
        },
      }),
      this.prisma.db.matter.count({ where }),
    ]);
    return { rows, total, page, pageSize };
  }

  async detail(id: string) {
    const m = await this.policy.assertMatter(id);
    const user = currentUser();
    const portal = !user.perms.has('matter:read');
    const full = await this.prisma.db.matter.findUniqueOrThrow({
      where: { id },
      include: {
        requestType: true,
        assignments: { include: { user: { select: { id: true, displayName: true, username: true } } } },
        access: portal ? false : { include: { user: { select: { id: true, displayName: true } } } },
        transitions: { orderBy: { at: 'asc' } },
        comments: portal ? { where: { internal: false }, orderBy: { createdAt: 'asc' } } : { orderBy: { createdAt: 'asc' } },
        linksFrom: { include: { to: { select: { id: true, reference: true, title: true, restricted: true } } } },
        linksTo: { include: { from: { select: { id: true, reference: true, title: true, restricted: true } } } },
        intakes: { select: { id: true, intakeNo: true, subject: true, receivedAt: true } },
      },
    });
    const actorIds = [...new Set([...full.transitions.map((t) => t.actorId), ...full.comments.map((c) => c.authorId)])];
    const actors = await this.prisma.base.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true } });
    const name = (id: string) => actors.find((a) => a.id === id)?.displayName ?? 'Unknown';
    const links = [...full.linksFrom.map((l) => l.to), ...full.linksTo.map((l) => l.from)];
    const visibleLinks = (await this.prisma.db.matter.findMany({ where: { AND: [{ id: { in: links.map((l) => l.id) } }, this.policy.matterScope()] }, select: { id: true } })).map((x) => x.id);
    await this.audit.log({ action: portal ? 'matter.view.portal' : 'matter.view', entityType: 'Matter', entityId: id });
    return {
      ...full,
      description: m.restricted ? this.crypto.decrypt(full.descriptionEnc) : full.description,
      descriptionEnc: undefined,
      transitions: full.transitions.map((t) => ({ ...t, actorName: name(t.actorId) })),
      comments: full.comments.map((c) => ({ ...c, body: c.bodyEnc ? this.crypto.decrypt(c.bodyEnc) : c.body, bodyEnc: undefined, authorName: name(c.authorId) })),
      links: links.filter((l) => visibleLinks.includes(l.id)),
      linksFrom: undefined, linksTo: undefined,
      sla: portal ? [] : await this.sla.forMatter(id),
      portalView: portal,
    };
  }

  async update(id: string, data: { title?: string; description?: string | null; priority?: Priority; dueDate?: Date | null; tags?: string[]; requestingDeptId?: string | null; requesterName?: string | null }) {
    const m = await this.policy.assertMatter(id, 'matter:write');
    await this.policy.assertWrite(m);
    const patch: Prisma.MatterUpdateInput = { ...data, lastActivityAt: new Date() };
    if ('description' in data) {
      if (m.restricted) { patch.descriptionEnc = this.crypto.encrypt(data.description); patch.description = null; }
    }
    const after = await this.prisma.db.matter.update({ where: { id }, data: patch });
    await this.audit.log({ action: 'matter.updated', entityType: 'Matter', entityId: id, before: m, after });
    return after;
  }

  /** Record a status change (unit services validate the transition first). */
  async recordTransition(tx: Tx, matterId: string, from: string | null, to: string, action: string, comment?: string | null) {
    await tx.statusTransition.create({ data: { matterId, fromStatus: from, toStatus: to, action, actorId: currentUser().id, comment: comment ?? null } });
    const terminal = ['CLOSED', 'CANCELLED', 'REJECTED', 'ATTENDED'].includes(to);
    await tx.matter.update({ where: { id: matterId }, data: { status: to, lastActivityAt: new Date(), ...(terminal ? { closedAt: new Date() } : {}) } });
    if (terminal) await this.sla.stop({ matterId }, tx);
    await this.audit.log({ action: 'matter.status', entityType: 'Matter', entityId: matterId, before: { status: from }, after: { status: to }, meta: { action, comment } });
  }

  /** Generic status change for CMP / AWR matters. */
  async setGenericStatus(id: string, status: string, comment?: string) {
    if (!(GENERIC_STATUSES as readonly string[]).includes(status)) throw badRequest('Unknown status');
    const m = await this.policy.assertMatter(id, 'matter:write');
    if (m.unit === 'DRF' || m.unit === 'LIT') throw badRequest('Use the unit workflow for this matter');
    await this.policy.assertWrite(m);
    await this.prisma.tx(async (tx) => {
      if (status === 'AWAITING_INFO') await this.sla.pause(id, comment ?? 'awaiting information', tx);
      if (m.status === 'AWAITING_INFO' && status !== 'AWAITING_INFO') await this.sla.resume(id, tx);
      await this.recordTransition(tx, id, m.status, status, 'set-status', comment);
    });
    return this.detail(id);
  }

  /** Check that a person works in the matter's unit (or is HoD). */
  async assertLegalStaff(userId: string, unit: Unit) {
    const roles = await this.prisma.base.userRole.findMany({ where: { userId, user: { status: 'ACTIVE' } } });
    if (!roles.some((r) => r.role === 'HOD' || (r.unit === unit && ['UNIT_HEAD', 'LEGAL_OFFICER', 'PARALEGAL'].includes(r.role)))) {
      throw badRequest('That person is not a member of this unit');
    }
  }

  async assign(id: string, input: { assigneeIds: string[]; reviewerId?: string | null; approverId?: string | null }, tx?: Tx) {
    const m = await this.policy.assertMatter(id, 'matter:read', tx);
    if (!this.policy.covers('matter:assign', m.unit)) throw forbidden('Only the Unit Head or HoD can assign');
    const all = [...input.assigneeIds, input.reviewerId, input.approverId].filter((x): x is string => !!x);
    for (const u of all) await this.assertLegalStaff(u, m.unit);
    if (input.reviewerId && input.assigneeIds.includes(input.reviewerId)) throw badRequest('The reviewer cannot also be the drafter (maker-checker)');
    const run = async (t: Tx) => {
      const before = await t.matterAssignment.findMany({ where: { matterId: id } });
      await t.matterAssignment.deleteMany({ where: { matterId: id, role: { in: ['ASSIGNEE', ...(input.reviewerId !== undefined ? ['REVIEWER' as const] : []), ...(input.approverId !== undefined ? ['APPROVER' as const] : [])] } } });
      const rows: { matterId: string; userId: string; role: AssignmentRole }[] = [
        ...input.assigneeIds.map((userId) => ({ matterId: id, userId, role: 'ASSIGNEE' as const })),
        ...(input.reviewerId ? [{ matterId: id, userId: input.reviewerId, role: 'REVIEWER' as const }] : []),
        ...(input.approverId ? [{ matterId: id, userId: input.approverId, role: 'APPROVER' as const }] : []),
      ];
      await t.matterAssignment.createMany({ data: rows, skipDuplicates: true });
      if (m.restricted) await t.matterAccess.createMany({ data: all.map((userId) => ({ matterId: id, userId, grantedById: currentUser().id })), skipDuplicates: true });
      await t.slaClock.updateMany({ where: { matterId: id, step: 'ASSIGN', stoppedAt: null }, data: { stoppedAt: new Date() } });
      await t.slaClock.updateMany({ where: { matterId: id, stoppedAt: null, step: { notIn: ['ASSIGN', 'REVIEW', 'APPROVAL'] } }, data: { ownerId: input.assigneeIds[0] ?? null } });
      await t.matter.update({ where: { id }, data: { lastActivityAt: new Date() } });
      await this.audit.log({ action: 'matter.assigned', entityType: 'Matter', entityId: id, before: before.map((b) => ({ userId: b.userId, role: b.role })), after: rows.map((r) => ({ userId: r.userId, role: r.role })) });
    };
    if (tx) await run(tx); else await this.prisma.tx(run);
    await this.notifications.notify(all.filter((u) => u !== currentUser().id), { type: 'matter.assigned', title: `Assigned to you: ${m.reference} ${m.restricted ? '' : m.title}`, link: `/matters/${id}`, matterId: id, restricted: m.restricted });
    return { ok: true };
  }

  async comment(id: string, body: string, internal: boolean) {
    const m = await this.policy.assertMatter(id);
    const user = currentUser();
    const portal = !user.perms.has('matter:read');
    if (portal && internal) throw forbidden('Requesters can only post visible comments');
    const usernames = [...new Set([...body.matchAll(/@([a-zA-Z0-9._-]{3,40})/g)].map((x) => x[1]!.toLowerCase()))];
    const mentioned = usernames.length ? await this.prisma.base.user.findMany({ where: { username: { in: usernames }, status: 'ACTIVE' }, include: { roles: true } }) : [];
    // Only notify people who can see the matter (unit staff / HoD / named on restricted).
    const allowed = [];
    for (const u of mentioned) {
      const inUnit = u.roles.some((r) => r.role === 'HOD' || (r.unit === m.unit));
      const named = m.restricted ? (await this.prisma.base.matterAccess.count({ where: { matterId: id, userId: u.id } })) > 0 : true;
      if (inUnit && (named || u.roles.some((r) => r.role === 'HOD'))) allowed.push(u.id);
    }
    const c = await this.prisma.db.comment.create({
      data: { matterId: id, authorId: user.id, internal: portal ? false : internal, mentions: allowed, body: m.restricted ? null : body, bodyEnc: m.restricted ? this.crypto.encrypt(body) : null },
    });
    await this.prisma.db.matter.update({ where: { id }, data: { lastActivityAt: new Date() } });
    await this.audit.log({ action: 'matter.comment', entityType: 'Matter', entityId: id, meta: { commentId: c.id, internal: c.internal, mentions: allowed.length } });
    await this.notifications.notify(allowed.filter((x) => x !== user.id), { type: 'matter.mention', title: `${user.displayName} mentioned you on ${m.reference}`, body: m.restricted ? undefined : body.slice(0, 300), link: `/matters/${id}`, matterId: id, restricted: m.restricted });
    if (portal) {
      const staff = (await this.prisma.db.matterAssignment.findMany({ where: { matterId: id } })).map((a) => a.userId);
      await this.notifications.notify(staff, { type: 'matter.requester-comment', title: `Requester replied on ${m.reference}`, link: `/matters/${id}`, matterId: id, restricted: m.restricted });
    }
    return c;
  }

  /** Ethical wall: restrict / unrestrict and manage named users. */
  async setRestriction(id: string, restricted: boolean, userIds: string[]) {
    const m = await this.policy.assertMatter(id);
    if (!this.policy.covers('matter:restrict', m.unit)) throw forbidden();
    const user = currentUser();
    if (!restricted && m.restricted && !user.isHod) throw forbidden('Only the HoD can remove a restriction');
    await this.prisma.tx(async (tx) => {
      if (restricted) {
        const assigned = (await tx.matterAssignment.findMany({ where: { matterId: id } })).map((a) => a.userId);
        const named = [...new Set([...userIds, ...assigned, user.id])];
        await tx.matterAccess.deleteMany({ where: { matterId: id, userId: { notIn: named } } });
        await tx.matterAccess.createMany({ data: named.map((u) => ({ matterId: id, userId: u, grantedById: user.id })), skipDuplicates: true });
        if (!m.restricted) {
          await tx.matter.update({ where: { id }, data: { restricted: true, descriptionEnc: this.crypto.encrypt(m.description), description: null, searchText: null } });
          const comments = await tx.comment.findMany({ where: { matterId: id, bodyEnc: null } });
          for (const c of comments) await tx.comment.update({ where: { id: c.id }, data: { bodyEnc: this.crypto.encrypt(c.body), body: null } });
          await tx.calendarEvent.updateMany({ where: { matterId: id }, data: { restricted: true } });
        }
      } else {
        await tx.matter.update({ where: { id }, data: { restricted: false, description: this.crypto.decrypt(m.descriptionEnc), descriptionEnc: null } });
        const comments = await tx.comment.findMany({ where: { matterId: id, bodyEnc: { not: null } } });
        for (const c of comments) await tx.comment.update({ where: { id: c.id }, data: { body: this.crypto.decrypt(c.bodyEnc), bodyEnc: null } });
        await tx.calendarEvent.updateMany({ where: { matterId: id }, data: { restricted: false } });
        await tx.matterAccess.deleteMany({ where: { matterId: id } });
      }
    });
    await this.audit.log({ action: restricted ? 'matter.restricted' : 'matter.unrestricted', entityType: 'Matter', entityId: id, meta: { named: userIds.length } });
    if (restricted && !user.isHod) {
      await this.notifications.notify(await this.notifications.usersWithRole('HOD'), { type: 'matter.restricted', title: `${m.reference} was marked restricted by ${user.displayName}`, link: `/matters/${id}`, matterId: id, restricted: true });
    }
    return { ok: true };
  }

  async link(id: string, toId: string, kind = 'RELATED') {
    if (id === toId) throw badRequest('A matter cannot be linked to itself');
    const a = await this.policy.assertMatter(id, 'matter:write');
    await this.policy.assertWrite(a);
    await this.policy.assertMatter(toId);
    await this.prisma.db.matterLink.upsert({ where: { fromId_toId: { fromId: id, toId } }, create: { fromId: id, toId, kind }, update: { kind } });
    await this.audit.log({ action: 'matter.linked', entityType: 'Matter', entityId: id, meta: { toId, kind } });
    return { ok: true };
  }

  /** Open items per lawyer in a unit, with the least-loaded suggested first. */
  async workload(unit: Unit) {
    if (!this.policy.covers('matter:read', unit)) throw notFound('Unit');
    const staff = await this.prisma.base.user.findMany({
      where: { status: 'ACTIVE', roles: { some: { unit, role: { in: ['LEGAL_OFFICER', 'UNIT_HEAD', 'PARALEGAL'] } } } },
      select: { id: true, displayName: true, roles: { where: { unit }, select: { role: true } } },
    });
    const counts = await this.prisma.base.matterAssignment.groupBy({
      by: ['userId', 'role'], where: { userId: { in: staff.map((s) => s.id) }, matter: { closedAt: null } }, _count: true,
    });
    const overdue = await this.prisma.base.matterAssignment.groupBy({
      by: ['userId'], where: { userId: { in: staff.map((s) => s.id) }, role: 'ASSIGNEE', matter: { closedAt: null, dueDate: { lt: new Date() } } }, _count: true,
    });
    const rows = staff.map((s) => {
      const mine = counts.filter((c) => c.userId === s.id);
      const get = (r: string) => mine.find((c) => c.role === r)?._count ?? 0;
      return { userId: s.id, displayName: s.displayName, roles: s.roles.map((r) => r.role), assignee: get('ASSIGNEE'), reviewer: get('REVIEWER'), approver: get('APPROVER'), overdue: overdue.find((o) => o.userId === s.id)?._count ?? 0 };
    });
    rows.sort((a, b) => a.assignee + a.reviewer - (b.assignee + b.reviewer));
    const lawyers = rows.filter((r) => r.roles.includes('LEGAL_OFFICER'));
    return { unit, rows, suggestion: lawyers[0]?.userId ?? rows[0]?.userId ?? null };
  }
}
