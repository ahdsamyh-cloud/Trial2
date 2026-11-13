import { Injectable } from '@nestjs/common';
import { Prisma, RoleCode, Unit } from '@prisma/client';
import { RoleAssignment, SENSITIVE_ROLES, validateRoleSet } from '@ldms/shared';
import { PrismaService } from '../../common/prisma.service';
import { CryptoService } from '../../common/crypto.service';
import { currentUser } from '../../common/context';
import { badRequest, conflict, notFound } from '../../common/errors';
import { config } from '../../config';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { SessionService } from '../auth/session.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SecurityAlerts } from '../notifications/security-alerts.service';

export interface CreateUserInput {
  username: string;
  displayName: string;
  email: string;
  departmentId?: string | null;
  title?: string | null;
  isAdminAccount: boolean;
  accessExpiresAt?: Date | null;
  roles: RoleAssignment[];
}

const PUBLIC_USER = {
  id: true, username: true, displayName: true, email: true, departmentId: true, status: true, isAdminAccount: true,
  accessExpiresAt: true, mustChangePassword: true, lastLoginAt: true, lockedUntil: true, title: true, createdAt: true,
  roles: { select: { role: true, unit: true, expiresAt: true } }, department: { select: { name: true, code: true } },
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly alerts: SecurityAlerts,
  ) {}

  list(filter: { q?: string; status?: string; role?: string; unit?: string }) {
    return this.prisma.base.user.findMany({
      where: {
        ...(filter.q ? { OR: [{ username: { contains: filter.q, mode: 'insensitive' } }, { displayName: { contains: filter.q, mode: 'insensitive' } }, { email: { contains: filter.q, mode: 'insensitive' } }] } : {}),
        ...(filter.status ? { status: filter.status as never } : {}),
        ...(filter.role ? { roles: { some: { role: filter.role as RoleCode, ...(filter.unit ? { unit: filter.unit as Unit } : {}) } } } : {}),
      },
      select: PUBLIC_USER,
      orderBy: { displayName: 'asc' },
    });
  }

  async get(id: string) {
    const u = await this.prisma.base.user.findUnique({ where: { id }, select: PUBLIC_USER });
    if (!u) throw notFound('User');
    return u;
  }

  /** Lightweight directory for pickers (legal staff only see names, not admin details). */
  directory(unit?: Unit) {
    return this.prisma.base.user.findMany({
      where: { status: 'ACTIVE', isAdminAccount: false, ...(unit ? { roles: { some: { unit } } } : {}) },
      select: { id: true, displayName: true, username: true, departmentId: true, roles: { select: { role: true, unit: true } } },
      orderBy: { displayName: 'asc' },
    });
  }

  async create(input: CreateUserInput) {
    const errors = validateRoleSet(input.roles, input.isAdminAccount);
    if (errors.length) throw badRequest(errors[0]!, { errors });
    if (input.roles.some((r) => r.role === 'AUDITOR') && !input.accessExpiresAt) throw badRequest('Auditor accounts need an access expiry date');
    const username = input.username.toLowerCase();
    const actor = currentUser();
    const user = await this.prisma.base.user.create({
      data: {
        username, displayName: input.displayName, email: input.email.toLowerCase(), departmentId: input.departmentId ?? null,
        title: input.title ?? null, isAdminAccount: input.isAdminAccount, accessExpiresAt: input.accessExpiresAt ?? null,
        status: 'PENDING_SETUP', mustChangePassword: true, createdById: actor.id,
        identities: { create: { provider: 'LOCAL', subject: username } },
        roles: { create: input.roles.map((r) => ({ role: r.role as RoleCode, unit: (r.unit ?? null) as Unit | null, grantedById: actor.id })) },
      },
    });
    let temporaryPassword: string | undefined;
    let setupLinkSent = false;
    if (config().SMTP_ENABLED) {
      const token = await this.auth.issueToken(user.id, 'SETUP');
      await this.notifications.email(user.email, 'Your STELCO Legal (LDMS) account',
        `An account has been created for you.\n\nSet your password within 24 hours:\n${config().APP_ORIGIN}/setup/${token}\n\nYou will then set up an authenticator app (Microsoft or Google Authenticator).`);
      setupLinkSent = true;
    } else {
      temporaryPassword = this.tempPassword();
      await this.auth.setPassword(user.id, temporaryPassword, { username, displayName: user.displayName }, true);
      await this.prisma.base.user.update({ where: { id: user.id }, data: { status: 'ACTIVE', mustChangePassword: true } });
    }
    await this.audit.log({ action: 'user.created', entityType: 'User', entityId: user.id, after: { username, roles: input.roles, isAdminAccount: input.isAdminAccount } });
    if (input.roles.length) await this.alerts.roleChanged(username, this.rolesText(input.roles), input.roles.some((r) => SENSITIVE_ROLES.includes(r.role)));
    return { user: await this.get(user.id), temporaryPassword, setupLinkSent };
  }

  private tempPassword() {
    const words = this.crypto.randomToken(18).replace(/[-_]/g, 'x');
    return `${words.slice(0, 6)}-${words.slice(6, 12)}-${words.slice(12, 18)}`;
  }

  private rolesText(roles: RoleAssignment[]) {
    return roles.map((r) => (r.unit ? `${r.role}(${r.unit})` : r.role)).join(', ');
  }

  async update(id: string, data: { displayName?: string; email?: string; departmentId?: string | null; title?: string | null; accessExpiresAt?: Date | null }) {
    const before = await this.get(id);
    await this.prisma.base.user.update({ where: { id }, data: { ...data, email: data.email?.toLowerCase() } });
    const after = await this.get(id);
    await this.audit.log({ action: 'user.updated', entityType: 'User', entityId: id, before, after });
    return after;
  }

  async setRoles(id: string, roles: RoleAssignment[]) {
    const u = await this.prisma.base.user.findUnique({ where: { id }, include: { roles: true } });
    if (!u) throw notFound('User');
    if (id === currentUser().id) throw badRequest('You cannot change your own roles');
    const errors = validateRoleSet(roles, u.isAdminAccount);
    if (errors.length) throw badRequest(errors[0]!, { errors });
    if (roles.some((r) => r.role === 'AUDITOR') && !u.accessExpiresAt) throw badRequest('Set an access expiry date before granting the Auditor role');
    const before = u.roles.map((r) => ({ role: r.role, unit: r.unit }));
    await this.prisma.base.$transaction([
      this.prisma.base.userRole.deleteMany({ where: { userId: id } }),
      this.prisma.base.userRole.createMany({ data: roles.map((r) => ({ userId: id, role: r.role as RoleCode, unit: (r.unit ?? null) as Unit | null, grantedById: currentUser().id })) }),
    ]);
    // Privilege change → existing sessions are re-evaluated on next request (roles loaded per request); force re-login for safety.
    await this.sessions.revokeAllForUser(id, 'roles-changed');
    await this.audit.log({ action: 'role.changed', entityType: 'User', entityId: id, before, after: roles });
    const sensitive = [...roles, ...before].some((r) => SENSITIVE_ROLES.includes(r.role as never));
    await this.alerts.roleChanged(u.username, this.rolesText(roles), sensitive);
    await this.notifications.notify([id], { type: 'security.roles', title: 'Your access in LDMS was changed', emailAlways: true });
    return this.get(id);
  }

  /** Open work that must be reassigned before a user can leave (counts only — admins see no content). */
  async openWork(userId: string) {
    const rows = await this.prisma.base.matterAssignment.groupBy({
      by: ['role'], where: { userId, matter: { closedAt: null } }, _count: true,
    });
    const owned = await this.prisma.base.slaClock.count({ where: { ownerId: userId, stoppedAt: null } });
    return { assignments: rows.map((r) => ({ role: r.role, count: r._count })), total: rows.reduce((n, r) => n + r._count, 0), openClocks: owned };
  }

  async disable(id: string, reason: string, emergency: boolean) {
    const u = await this.prisma.base.user.findUnique({ where: { id } });
    if (!u) throw notFound('User');
    if (id === currentUser().id) throw badRequest('You cannot disable your own account');
    if (!emergency) {
      const work = await this.openWork(id);
      if (work.total > 0) throw conflict('Reassign this user\'s open work first (leaver checklist), or use emergency disable', work);
    }
    await this.prisma.base.user.update({ where: { id }, data: { status: 'DISABLED' } });
    const revoked = await this.sessions.revokeAllForUser(id, 'user-disabled');
    await this.audit.log({ action: emergency ? 'user.disabled.emergency' : 'user.disabled', entityType: 'User', entityId: id, meta: { reason, sessionsRevoked: revoked } });
    return this.get(id);
  }

  async enable(id: string) {
    await this.prisma.base.user.update({ where: { id }, data: { status: 'ACTIVE', failedCount: 0, lockedUntil: null } });
    await this.audit.log({ action: 'user.enabled', entityType: 'User', entityId: id });
    return this.get(id);
  }

  async unlock(id: string) {
    await this.prisma.base.user.update({ where: { id }, data: { failedCount: 0, lockedUntil: null } });
    await this.audit.log({ action: 'user.unlocked', entityType: 'User', entityId: id });
    return this.get(id);
  }

  /** Admin reset of password and/or two-factor. Forces a change at next sign-in; notifies the user. */
  async reset(id: string, what: { password: boolean; mfa: boolean }) {
    const u = await this.prisma.base.user.findUnique({ where: { id } });
    if (!u) throw notFound('User');
    let temporaryPassword: string | undefined;
    let linkSent = false;
    if (what.mfa) {
      await this.prisma.base.mfaFactor.deleteMany({ where: { userId: id } });
      await this.prisma.base.backupCode.deleteMany({ where: { userId: id } });
    }
    if (what.password) {
      if (config().SMTP_ENABLED) {
        const token = await this.auth.issueToken(id, 'RESET');
        await this.notifications.email(u.email, 'Reset your LDMS password', `An administrator reset your password. Choose a new one within 30 minutes:\n${config().APP_ORIGIN}/reset/${token}`);
        linkSent = true;
      } else {
        temporaryPassword = this.tempPassword();
        await this.auth.setPassword(id, temporaryPassword, { username: u.username, displayName: u.displayName }, true);
      }
    }
    await this.sessions.revokeAllForUser(id, 'admin-reset');
    await this.audit.log({ action: 'user.reset', entityType: 'User', entityId: id, meta: what });
    await this.notifications.notify([id], { type: 'security.reset', title: `An administrator reset your ${[what.password && 'password', what.mfa && 'two-factor authentication'].filter(Boolean).join(' and ')}`, emailAlways: true });
    return { temporaryPassword, linkSent };
  }

  /** Quarterly access review: who has what, last sign-in, flags. */
  async accessReview() {
    const users = await this.prisma.base.user.findMany({ select: PUBLIC_USER, orderBy: { username: 'asc' } });
    const now = Date.now();
    return users.map((u) => ({
      username: u.username, displayName: u.displayName, department: u.department?.name ?? '', status: u.status,
      adminAccount: u.isAdminAccount, roles: u.roles.map((r) => (r.unit ? `${r.role}(${r.unit})` : r.role)).join(', '),
      lastLoginAt: u.lastLoginAt, accessExpiresAt: u.accessExpiresAt,
      flags: [
        !u.lastLoginAt || now - u.lastLoginAt.getTime() > 90 * 86400_000 ? 'NO_LOGIN_90D' : null,
        u.roles.some((r) => SENSITIVE_ROLES.includes(r.role)) ? 'SENSITIVE_ROLE' : null,
        u.accessExpiresAt && u.accessExpiresAt.getTime() < now ? 'EXPIRED' : null,
      ].filter(Boolean).join(' '),
    }));
  }
}
