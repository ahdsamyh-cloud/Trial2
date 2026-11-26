/**
 * Role → permission matrix (docs/PLAN.md §4). The server is authoritative;
 * the web app only uses this to hide controls.
 *
 * A Grant's scope says how far a permission reaches:
 *  - ALL   everything (still subject to restricted-matter rule, except HoD)
 *  - UNIT  only records of the unit(s) the role is held for
 *  - DEPT  only the user's department's records (requester portal)
 *  - AGG   aggregate figures only
 */

export const UNITS = ['LIT', 'CMP', 'DRF', 'AWR'] as const;
export type Unit = (typeof UNITS)[number];
export const UNIT_NAMES: Record<Unit, string> = { LIT: 'Litigation', CMP: 'Compliance', DRF: 'Drafting', AWR: 'Awareness' };

export const ROLES = ['SUPER_ADMIN', 'HOD', 'UNIT_HEAD', 'LEGAL_OFFICER', 'PARALEGAL', 'REQUESTER', 'AUDITOR', 'MGMT_VIEWER'] as const;
export type RoleCode = (typeof ROLES)[number];
export const UNIT_SCOPED_ROLES: RoleCode[] = ['UNIT_HEAD', 'LEGAL_OFFICER', 'PARALEGAL'];
/** Roles that see legal content; never combinable with SUPER_ADMIN (separation of duties). */
export const LEGAL_ROLES: RoleCode[] = ['HOD', 'UNIT_HEAD', 'LEGAL_OFFICER', 'PARALEGAL', 'AUDITOR', 'MGMT_VIEWER', 'REQUESTER'];
/** Grants of these roles alert the HoD and are flagged in the access review. */
export const SENSITIVE_ROLES: RoleCode[] = ['HOD', 'UNIT_HEAD', 'AUDITOR'];

export const PERMISSIONS = [
  'users:manage', 'users:read', 'sessions:manage',
  'config:manage', 'config:read',
  'audit:read', 'audit:read.system', 'accessreview:read',
  'intake:create', 'intake:read', 'intake:triage', 'intake:assign',
  'matter:read', 'matter:write', 'matter:assign', 'matter:restrict',
  'doc:read', 'doc:write', 'hold:place', 'hold:release', 'disposal:approve',
  'export:list', 'export:bulk',
  'dashboard:hod', 'dashboard:unit', 'dashboard:mine', 'dashboard:mgmt', 'dashboard:system',
  'lit:write', 'lit:import', 'lit:import.rollback', 'lit:invoice.verify',
  'draft:draft', 'draft:review', 'draft:approve', 'draft:library',
  'cmp:write', 'cmp:disseminate', 'cmp:review',
  'awr:write',
  'portal:use', 'portal:respond',
  'search:use', 'calendar:read', 'report:read',
  'leaver:start', 'leaver:reassign',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export type Scope = 'ALL' | 'UNIT' | 'DEPT' | 'AGG';

const all = (...p: Permission[]) => p.map((perm) => [perm, 'ALL'] as const);
const unit = (...p: Permission[]) => p.map((perm) => [perm, 'UNIT'] as const);

export const ROLE_GRANTS: Record<RoleCode, ReadonlyArray<readonly [Permission, Scope]>> = {
  SUPER_ADMIN: [
    ...all('users:manage', 'users:read', 'sessions:manage', 'config:manage', 'config:read', 'audit:read.system', 'accessreview:read', 'dashboard:system', 'leaver:start'),
  ],
  HOD: [
    ...all(
      'users:read', 'config:manage', 'config:read', 'audit:read', 'audit:read.system', 'accessreview:read',
      'intake:create', 'intake:read', 'intake:triage', 'intake:assign',
      'matter:read', 'matter:write', 'matter:assign', 'matter:restrict',
      'doc:read', 'doc:write', 'hold:place', 'hold:release', 'disposal:approve',
      'export:list', 'export:bulk',
      'dashboard:hod', 'dashboard:unit', 'dashboard:mine', 'dashboard:mgmt',
      'lit:write', 'lit:import', 'lit:import.rollback', 'lit:invoice.verify',
      'draft:draft', 'draft:review', 'draft:approve', 'draft:library',
      'cmp:write', 'cmp:disseminate', 'cmp:review', 'awr:write',
      'search:use', 'calendar:read', 'report:read', 'leaver:reassign',
    ),
  ],
  UNIT_HEAD: [
    ...all('config:read', 'intake:create', 'intake:read', 'dashboard:mine', 'search:use', 'calendar:read'),
    ...unit(
      'intake:triage', 'intake:assign', 'matter:read', 'matter:write', 'matter:assign', 'matter:restrict',
      'doc:read', 'doc:write', 'hold:place', 'export:list', 'export:bulk', 'dashboard:unit', 'report:read',
      'lit:write', 'lit:import', 'lit:import.rollback', 'lit:invoice.verify',
      'draft:draft', 'draft:review', 'draft:approve', 'draft:library',
      'cmp:write', 'cmp:disseminate', 'cmp:review', 'awr:write', 'leaver:reassign',
    ),
  ],
  LEGAL_OFFICER: [
    ...all('config:read', 'intake:create', 'dashboard:mine', 'search:use', 'calendar:read'),
    ...unit('matter:read', 'matter:write', 'doc:read', 'doc:write', 'export:list', 'report:read',
      'lit:write', 'lit:invoice.verify', 'draft:draft', 'draft:review', 'draft:library',
      'cmp:write', 'cmp:disseminate', 'cmp:review', 'awr:write'),
  ],
  PARALEGAL: [
    ...all('config:read', 'intake:create', 'intake:read', 'intake:triage', 'dashboard:mine', 'search:use', 'calendar:read'),
    ...unit('matter:read', 'matter:write', 'doc:read', 'doc:write', 'export:list', 'lit:write', 'lit:import', 'cmp:write', 'awr:write'),
  ],
  REQUESTER: [
    ['portal:use', 'DEPT'], ['portal:respond', 'DEPT'], ['intake:create', 'DEPT'],
  ],
  AUDITOR: [
    ...all('users:read', 'config:read', 'audit:read', 'audit:read.system', 'accessreview:read', 'intake:read', 'matter:read', 'doc:read',
      'export:list', 'export:bulk', 'dashboard:hod', 'search:use', 'calendar:read', 'report:read'),
  ],
  MGMT_VIEWER: [['dashboard:mgmt', 'AGG'], ['report:read', 'AGG']],
};

/** Permissions that only read (Auditor safety net: an auditor never gets a write). */
export const WRITE_PERMISSIONS: Permission[] = PERMISSIONS.filter((p) => !/:(read|use)(\.|$)|^dashboard:|^calendar:|^report:|^export:|accessreview/.test(p));

export interface RoleAssignment {
  role: RoleCode;
  unit?: Unit | null;
}

export interface EffectiveGrant {
  scope: Scope;
  units: Unit[];
}

/** Collapse a user's role assignments into an effective grant per permission. */
export function effectivePermissions(roles: RoleAssignment[]): Map<Permission, EffectiveGrant> {
  const out = new Map<Permission, EffectiveGrant>();
  const rank: Record<Scope, number> = { AGG: 0, DEPT: 1, UNIT: 2, ALL: 3 };
  for (const r of roles) {
    for (const [perm, scope] of ROLE_GRANTS[r.role] ?? []) {
      const cur = out.get(perm) ?? { scope, units: [] };
      if (rank[scope] > rank[cur.scope]) cur.scope = scope;
      if (scope === 'UNIT' && r.unit && !cur.units.includes(r.unit)) cur.units.push(r.unit);
      out.set(perm, cur);
    }
  }
  return out;
}

/** Validate a proposed set of roles. Returns error messages (empty if valid). */
export function validateRoleSet(roles: RoleAssignment[], isAdminAccount: boolean): string[] {
  const errors: string[] = [];
  const codes = roles.map((r) => r.role);
  if (codes.includes('SUPER_ADMIN') && !isAdminAccount) errors.push('SUPER_ADMIN can only be held by an admin account');
  if (isAdminAccount && codes.some((c) => LEGAL_ROLES.includes(c))) errors.push('Admin accounts cannot hold legal roles (separation of duties)');
  for (const r of roles) {
    if (UNIT_SCOPED_ROLES.includes(r.role) && !r.unit) errors.push(`${r.role} requires a unit`);
    if (!UNIT_SCOPED_ROLES.includes(r.role) && r.unit) errors.push(`${r.role} is not unit-scoped`);
  }
  return errors;
}
