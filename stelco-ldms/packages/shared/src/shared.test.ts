import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { safeRedirectPath } from './redirect';
import {
  addBusinessDays, addBusinessMs, businessMsBetween, isBusinessDay, makeCalendar, toLocalIsoDate, weekdayOfDay, localDayNumber,
  subtractBusinessDays, businessDaysBetween,
} from './calendar';
import { effectiveTarget, evaluateSla } from './sla';
import { effectivePermissions, validateRoleSet, ROLE_GRANTS, WRITE_PERMISSIONS } from './permissions';
import { draftingMachine, findTransition, availableActions, DRAFTING_STATUSES, intakeMachine } from './workflows';
import { formatReference, parseReference, renderTemplate } from './reference';
import { passwordPolicyErrors } from './password';

// Local Maldives time helper: mv('2026-11-15T10:00') → instant
const mv = (s: string) => new Date(`${s}:00+05:00`);
const cal = makeCalendar({ holidays: ['2026-11-11'] }); // a Wednesday holiday

describe('calendar', () => {
  it('knows the Sun–Thu working week', () => {
    expect(weekdayOfDay(localDayNumber(mv('2026-11-15T09:00')))).toBe(0); // Sunday
    expect(isBusinessDay('2026-11-15', cal)).toBe(true); // Sun
    expect(isBusinessDay('2026-11-19', cal)).toBe(true); // Thu
    expect(isBusinessDay('2026-11-20', cal)).toBe(false); // Fri
    expect(isBusinessDay('2026-11-21', cal)).toBe(false); // Sat
    expect(isBusinessDay('2026-11-11', cal)).toBe(false); // holiday
  });

  it('uses local (UTC+5) dates', () => {
    // 2026-11-19 20:00 UTC = 2026-11-20 01:00 MV (Friday)
    expect(toLocalIsoDate(new Date('2026-11-19T20:00:00Z'))).toBe('2026-11-20');
  });

  it('adds business days skipping weekend and holidays, due at 16:00', () => {
    // Thursday 10:00 + 1 business day → Sunday 16:00
    expect(addBusinessDays(mv('2026-11-19T10:00'), 1, cal).toISOString()).toBe(mv('2026-11-22T16:00').toISOString());
    // Tuesday + 1 skips Wednesday holiday → Thursday
    expect(addBusinessDays(mv('2026-11-10T09:00'), 1, cal).toISOString()).toBe(mv('2026-11-12T16:00').toISOString());
    // Friday + 0 → Sunday cut-off
    expect(addBusinessDays(mv('2026-11-20T09:00'), 0, cal).toISOString()).toBe(mv('2026-11-22T16:00').toISOString());
    // across the year end (Dec 31 2026 is Thursday)
    expect(addBusinessDays(mv('2026-12-31T09:00'), 1, cal).toISOString()).toBe(mv('2027-01-03T16:00').toISOString());
  });

  it('counts business time only on business days', () => {
    // Thu 12:00 → Sun 12:00 = 12h (Thu) + 12h (Sun)
    expect(businessMsBetween(mv('2026-11-19T12:00'), mv('2026-11-22T12:00'), cal)).toBe(24 * 3600_000);
    expect(businessMsBetween(mv('2026-11-20T00:00'), mv('2026-11-22T00:00'), cal)).toBe(0);
  });

  it('counts and subtracts business days', () => {
    expect(businessDaysBetween(mv('2026-11-19T10:00'), mv('2026-11-23T10:00'), cal)).toBe(2); // Sun, Mon
    expect(subtractBusinessDays(mv('2026-11-22T10:00'), 1, cal).toISOString()).toBe(mv('2026-11-19T16:00').toISOString());
  });

  it('property: addBusinessMs inverts businessMsBetween', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 400 * 86400 }), fc.integer({ min: 0, max: 30 * 86400 }), (startSec, durSec) => {
        const start = new Date(Date.UTC(2026, 0, 1) + startSec * 1000);
        const end = addBusinessMs(start, durSec * 1000, cal);
        return businessMsBetween(start, end, cal) === durSec * 1000;
      }),
    );
  });

  it('property: business-day deadlines always land on a business day at cut-off', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 800 * 86400 }), fc.integer({ min: 0, max: 15 }), (startSec, n) => {
        const due = addBusinessDays(new Date(Date.UTC(2026, 0, 1) + startSec * 1000), n, cal);
        return isBusinessDay(due, cal) && due.getUTCHours() === 11 && due.getUTCMinutes() === 0;
      }),
    );
  });
});

describe('sla', () => {
  it('halves urgent targets, rounding up, min 1', () => {
    expect(effectiveTarget(5, true)).toBe(3);
    expect(effectiveTarget(1, true)).toBe(1);
    expect(effectiveTarget(10, true)).toBe(5);
    expect(effectiveTarget(10, false)).toBe(10);
  });

  it('warns at 75% and breaches at 100%', () => {
    const start = mv('2026-11-15T16:00'); // Sun cut-off; +2 bd → Tue 16:00 (48h business time)
    const input = { startedAt: start, targetDays: 2, unit: 'BUSINESS' as const };
    expect(evaluateSla(input, mv('2026-11-16T16:00'), cal).state).toBe('OK'); // 50%
    expect(evaluateSla(input, mv('2026-11-17T04:00'), cal).state).toBe('WARNING'); // 75%
    const breach = evaluateSla(input, mv('2026-11-17T16:00'), cal);
    expect(breach.state).toBe('BREACHED');
    expect(breach.dueAt.toISOString()).toBe(mv('2026-11-17T16:00').toISOString());
  });

  it('pauses the clock while awaiting information and extends the due date', () => {
    const start = mv('2026-11-15T16:00');
    const input = {
      startedAt: start, targetDays: 2, unit: 'BUSINESS' as const,
      pauses: [{ from: mv('2026-11-16T16:00'), to: mv('2026-11-17T16:00') }],
    };
    const ev = evaluateSla(input, mv('2026-11-17T16:00'), cal);
    expect(ev.state).toBe('OK');
    expect(ev.dueAt.toISOString()).toBe(mv('2026-11-18T16:00').toISOString());
    const open = evaluateSla({ ...input, pauses: [{ from: mv('2026-11-16T16:00') }] }, mv('2026-11-30T16:00'), cal);
    expect(open.state).toBe('PAUSED');
  });

  it('supports calendar-day policies', () => {
    const ev = evaluateSla({ startedAt: mv('2026-11-01T10:00'), targetDays: 30, unit: 'CALENDAR' }, mv('2026-12-01T10:00'), cal);
    expect(ev.state).toBe('BREACHED');
  });
});

describe('permissions', () => {
  it('scopes unit roles to their unit', () => {
    const eff = effectivePermissions([{ role: 'LEGAL_OFFICER', unit: 'DRF' }]);
    expect(eff.get('matter:read')).toEqual({ scope: 'UNIT', units: ['DRF'] });
    expect(eff.has('draft:approve')).toBe(false);
  });
  it('merges multiple roles taking the widest scope', () => {
    const eff = effectivePermissions([{ role: 'UNIT_HEAD', unit: 'LIT' }, { role: 'LEGAL_OFFICER', unit: 'DRF' }]);
    expect(eff.get('matter:read')?.units.sort()).toEqual(['DRF', 'LIT']);
    expect(eff.get('matter:assign')).toEqual({ scope: 'UNIT', units: ['LIT'] });
  });
  it('gives Super Admin no legal content', () => {
    const eff = effectivePermissions([{ role: 'SUPER_ADMIN' }]);
    for (const p of ['matter:read', 'doc:read', 'intake:read', 'audit:read', 'search:use'] as const) expect(eff.has(p)).toBe(false);
  });
  it('gives the Auditor no write permission', () => {
    const auditorPerms = ROLE_GRANTS.AUDITOR.map(([p]) => p);
    expect(auditorPerms.filter((p) => WRITE_PERMISSIONS.includes(p))).toEqual([]);
  });
  it('enforces separation of duties', () => {
    expect(validateRoleSet([{ role: 'SUPER_ADMIN' }, { role: 'HOD' }], true)).not.toEqual([]);
    expect(validateRoleSet([{ role: 'SUPER_ADMIN' }], false)).not.toEqual([]);
    expect(validateRoleSet([{ role: 'UNIT_HEAD' }], false)).toContain('UNIT_HEAD requires a unit');
    expect(validateRoleSet([{ role: 'UNIT_HEAD', unit: 'LIT' }], false)).toEqual([]);
  });
});

describe('workflows', () => {
  it('drafting: every non-terminal state has an exit and every state is reachable', () => {
    const reachable = new Set<string>([draftingMachine.initial]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const t of draftingMachine.transitions) if (t.from.some((f) => reachable.has(f)) && !reachable.has(t.to)) { reachable.add(t.to); grew = true; }
    }
    expect([...reachable].sort()).toEqual([...DRAFTING_STATUSES].sort());
    for (const s of DRAFTING_STATUSES) if (!draftingMachine.terminal.includes(s)) expect(availableActions(draftingMachine, s).length).toBeGreaterThan(0);
  });
  it('drafting: illegal transitions are rejected', () => {
    expect(findTransition(draftingMachine, 'IN_DRAFTING', 'approve')).toBeUndefined();
    expect(findTransition(draftingMachine, 'CLOSED', 'cancel')).toBeUndefined();
    expect(findTransition(draftingMachine, 'PENDING_APPROVAL', 'approve')?.to).toBe('APPROVED');
    expect(findTransition(draftingMachine, 'PENDING_APPROVAL', 'escalate_hod')?.requiresComment).toBe(true);
  });
  it('intake: cannot convert twice', () => {
    expect(findTransition(intakeMachine, 'CONVERTED', 'convert')).toBeUndefined();
  });
});

describe('reference + templates + passwords', () => {
  it('formats and parses references', () => {
    expect(formatReference('DRF', 2026, 42)).toBe('LGL-DRF-2026-0042');
    expect(parseReference('RE: [LGL-LIT-2026-0007] hearing')?.reference).toBe('LGL-LIT-2026-0007');
    expect(parseReference('nothing here')).toBeNull();
  });
  it('renders templates without evaluating code', () => {
    expect(renderTemplate('Ref {{ reference }} for {{name}}{{missing}}', { reference: 'X', name: 'A' })).toBe('Ref X for A');
  });
  it('applies password policy', () => {
    expect(passwordPolicyErrors('short')).not.toEqual([]);
    expect(passwordPolicyErrors('correct horse battery')).toEqual([]);
    expect(passwordPolicyErrors('aaaaaaaaaaaaaa')).not.toEqual([]);
    expect(passwordPolicyErrors('jdoe-long-password', { username: 'jdoe' })).not.toEqual([]);
  });
});

describe('safeRedirectPath (open-redirect guard)', () => {
  it('keeps same-origin paths', () => {
    expect(safeRedirectPath('/matters/abc?tab=docs#x')).toBe('/matters/abc?tab=docs#x');
    expect(safeRedirectPath('/')).toBe('/');
  });
  it('rejects anything that can leave the site', () => {
    for (const bad of ['//evil.com', '/\\evil.com', '\\\\evil.com', 'https://evil.com', 'javascript:alert(1)', '/\t/evil.com', '/\n/evil.com', ' /x', '', null, undefined]) {
      expect(safeRedirectPath(bad as string)).toBe('/');
    }
  });
});
