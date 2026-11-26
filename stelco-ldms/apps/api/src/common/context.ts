import { AsyncLocalStorage } from 'node:async_hooks';
import type { Permission, RoleAssignment, EffectiveGrant, Unit } from '@ldms/shared';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  email: string;
  departmentId: string | null;
  isAdminAccount: boolean;
  mustChangePassword: boolean;
  roles: RoleAssignment[];
  perms: Map<Permission, EffectiveGrant>;
  isHod: boolean;
}

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
  user?: AuthUser;
  sessionId?: string;
  system?: boolean;
}

export const als = new AsyncLocalStorage<RequestContext>();

export function ctx(): RequestContext {
  return als.getStore() ?? { requestId: 'none' };
}

export function currentUser(): AuthUser {
  const u = ctx().user;
  if (!u) throw new Error('No authenticated user in context');
  return u;
}

export function runAsSystem<T>(fn: () => Promise<T>): Promise<T> {
  return als.run({ requestId: `system-${Date.now()}`, system: true }, fn);
}

export function unitsFor(user: AuthUser, perm: Permission): Unit[] | 'ALL' | null {
  const g = user.perms.get(perm);
  if (!g) return null;
  if (g.scope === 'ALL') return 'ALL';
  if (g.scope === 'UNIT') return g.units;
  return [];
}
