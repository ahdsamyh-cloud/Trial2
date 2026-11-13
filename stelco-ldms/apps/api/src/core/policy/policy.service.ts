import { Injectable } from '@nestjs/common';
import { Prisma, Unit } from '@prisma/client';
import type { Permission } from '@ldms/shared';
import { AuthUser, currentUser } from '../../common/context';
import { forbidden, notFound } from '../../common/errors';
import { PrismaService, Tx } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';

const NONE: Prisma.MatterWhereInput = { id: '__none__' };

/**
 * Record-level access (PLAN §4.2). Every read path builds its WHERE from here, so
 * lists, search, calendar, exports and counts all share one rule. RLS repeats the
 * restricted-matter rule in the database.
 */
@Injectable()
export class PolicyService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** Units the user may act on with `perm`, 'ALL', or null if none. */
  units(perm: Permission, user: AuthUser = currentUser()): Unit[] | 'ALL' | null {
    const g = user.perms.get(perm);
    if (!g) return null;
    if (g.scope === 'ALL') return 'ALL';
    if (g.scope === 'UNIT') return g.units as Unit[];
    return [];
  }

  covers(perm: Permission, unit: Unit, user: AuthUser = currentUser()): boolean {
    const u = this.units(perm, user);
    return u === 'ALL' || (Array.isArray(u) && u.includes(unit));
  }

  hasRoleInUnit(role: string, unit: Unit, user: AuthUser = currentUser()) {
    return user.roles.some((r) => r.role === role && r.unit === unit);
  }

  /** Ethical wall filter (app layer). HoD sees all; others only unrestricted or named. */
  wall(user: AuthUser = currentUser()): Prisma.MatterWhereInput {
    if (user.isHod) return {};
    return { OR: [{ restricted: false }, { access: { some: { userId: user.id } } }] };
  }

  matterScope(perm: Permission = 'matter:read', user: AuthUser = currentUser()): Prisma.MatterWhereInput {
    const g = user.perms.get(perm);
    if (!g) {
      // Requesters: portal view of their department's matters.
      if (perm === 'matter:read' && user.perms.has('portal:use') && user.departmentId) {
        return { AND: [{ requestingDeptId: user.departmentId }, this.wall(user)] };
      }
      return NONE;
    }
    let base: Prisma.MatterWhereInput;
    if (g.scope === 'ALL') base = {};
    else if (g.scope === 'UNIT') base = g.units.length ? { unit: { in: g.units as Unit[] } } : NONE;
    else if (g.scope === 'DEPT') base = user.departmentId ? { requestingDeptId: user.departmentId } : NONE;
    else return NONE;
    return { AND: [base, this.wall(user)] };
  }

  /** Load a matter the user may see, or 404 (never 403, so existence is not revealed). */
  async assertMatter(id: string, perm: Permission = 'matter:read', tx?: Tx) {
    const db = tx ?? this.prisma.db;
    const m = await db.matter.findFirst({ where: { AND: [{ id }, this.matterScope(perm)] } });
    if (!m) {
      await this.audit.log({ action: 'access.denied', outcome: 'DENIED', entityType: 'Matter', entityId: id, meta: { perm } });
      throw notFound('Matter');
    }
    if (m.restricted) await this.audit.log({ action: 'matter.view.restricted', entityType: 'Matter', entityId: id });
    return m;
  }

  async isAssigned(matterId: string, userId: string, roles: string[] = ['ASSIGNEE', 'REVIEWER', 'APPROVER'], tx?: Tx) {
    const db = tx ?? this.prisma.db;
    return (await db.matterAssignment.count({ where: { matterId, userId, role: { in: roles as never[] } } })) > 0;
  }

  /** Edit rule: HoD/Unit Head/Paralegal of the unit, or an officer assigned to the matter. */
  async assertWrite(matter: { id: string; unit: Unit }, tx?: Tx) {
    const user = currentUser();
    if (!this.covers('matter:write', matter.unit, user)) throw forbidden();
    if (user.isHod || this.covers('matter:assign', matter.unit, user) || this.hasRoleInUnit('PARALEGAL', matter.unit, user)) return;
    if (await this.isAssigned(matter.id, user.id, ['ASSIGNEE', 'REVIEWER', 'APPROVER'], tx)) return;
    throw forbidden('Only people assigned to this matter can change it');
  }

  /** Scope for unit-owned non-matter records (laws, sessions, licences…): unit check only. */
  assertUnit(perm: Permission, unit: Unit) {
    if (!this.covers(perm, unit)) throw forbidden();
  }
}
