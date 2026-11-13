import { addBusinessDays, addBusinessMs, addCalendarDays, businessMsBetween, WorkCalendar, DEFAULT_CALENDAR } from './calendar';

export type SlaUnit = 'BUSINESS' | 'CALENDAR';
export type SlaState = 'OK' | 'WARNING' | 'BREACHED' | 'PAUSED' | 'STOPPED';

export interface SlaPauseInterval {
  from: Date;
  to?: Date | null;
}

export interface SlaInput {
  startedAt: Date;
  targetDays: number;
  unit: SlaUnit;
  urgent?: boolean;
  urgentHalves?: boolean;
  pauses?: SlaPauseInterval[];
  stoppedAt?: Date | null;
}

export const WARNING_FRACTION = 0.75;

/** Urgent priority halves the target, rounded up, minimum 1 day. */
export function effectiveTarget(targetDays: number, urgent = false, urgentHalves = true): number {
  if (!urgent || !urgentHalves) return targetDays;
  return Math.max(1, Math.ceil(targetDays / 2));
}

function elapsed(unit: SlaUnit, a: Date, b: Date, cal: WorkCalendar): number {
  return unit === 'BUSINESS' ? businessMsBetween(a, b, cal) : Math.max(0, b.getTime() - a.getTime());
}

function addElapsed(unit: SlaUnit, d: Date, ms: number, cal: WorkCalendar): Date {
  return unit === 'BUSINESS' ? addBusinessMs(d, ms, cal) : new Date(d.getTime() + ms);
}

export interface SlaEvaluation {
  state: SlaState;
  dueAt: Date;
  warnAt: Date;
  /** Fraction of allowed time consumed (0..∞). */
  fraction: number;
  totalMs: number;
  usedMs: number;
}

/**
 * Evaluate an SLA clock at `now`. Paused intervals extend the due date by the
 * paused amount of (business or calendar) time.
 */
export function evaluateSla(input: SlaInput, now: Date, cal: WorkCalendar = DEFAULT_CALENDAR): SlaEvaluation {
  const target = effectiveTarget(input.targetDays, input.urgent, input.urgentHalves ?? true);
  const baseDue = input.unit === 'BUSINESS' ? addBusinessDays(input.startedAt, target, cal) : addCalendarDays(input.startedAt, target);
  const totalMs = elapsed(input.unit, input.startedAt, baseDue, cal);
  const end = input.stoppedAt && input.stoppedAt < now ? input.stoppedAt : now;

  let pausedMs = 0;
  let openPause = false;
  for (const p of input.pauses ?? []) {
    const to = p.to ?? end;
    if (!p.to) openPause = true;
    pausedMs += elapsed(input.unit, p.from, to < end ? to : end, cal);
  }
  const usedMs = Math.max(0, elapsed(input.unit, input.startedAt, end, cal) - pausedMs);
  const dueAt = addElapsed(input.unit, baseDue, pausedMs, cal);
  const warnAt = addElapsed(input.unit, input.startedAt, totalMs * WARNING_FRACTION + pausedMs, cal);
  const fraction = totalMs === 0 ? 1 : usedMs / totalMs;

  let state: SlaState;
  if (input.stoppedAt) state = 'STOPPED';
  else if (openPause) state = 'PAUSED';
  else if (fraction >= 1) state = 'BREACHED';
  else if (fraction >= WARNING_FRACTION) state = 'WARNING';
  else state = 'OK';
  return { state, dueAt, warnAt, fraction, totalMs, usedMs };
}

/** Default SLA policies seeded at install (all editable). */
export const DEFAULT_SLA_POLICIES: { code: string; name: string; target: number; unit: SlaUnit }[] = [
  { code: 'REGISTER_ACK', name: 'Register and acknowledge a new request', target: 1, unit: 'BUSINESS' },
  { code: 'ASSIGN', name: 'Assign to a lawyer after registration', target: 1, unit: 'BUSINESS' },
  { code: 'DRF_NDA', name: 'NDA / confidentiality agreement', target: 3, unit: 'BUSINESS' },
  { code: 'DRF_LETTER', name: 'Letter, notice or reply letter', target: 3, unit: 'BUSINESS' },
  { code: 'DRF_POA', name: 'Power of Attorney', target: 3, unit: 'BUSINESS' },
  { code: 'DRF_CONTRACT_REVIEW', name: 'Review of a contract drafted by the other party', target: 5, unit: 'BUSINESS' },
  { code: 'DRF_STANDARD_CONTRACT', name: 'Standard contract from an approved template', target: 5, unit: 'BUSINESS' },
  { code: 'DRF_MOU', name: 'MoU', target: 7, unit: 'BUSINESS' },
  { code: 'DRF_OPINION', name: 'Legal opinion', target: 7, unit: 'BUSINESS' },
  { code: 'DRF_CONTRACT', name: 'New or complex contract / agreement', target: 10, unit: 'BUSINESS' },
  { code: 'DRF_POLICY', name: 'Policy or procedure drafting / review', target: 10, unit: 'BUSINESS' },
  { code: 'DRF_OTHER', name: 'Other', target: 5, unit: 'BUSINESS' },
  { code: 'REVIEW', name: 'Internal review (checker) step', target: 2, unit: 'BUSINESS' },
  { code: 'APPROVAL', name: 'Approval step (Unit Head / HoD)', target: 2, unit: 'BUSINESS' },
  { code: 'LIT_HEARING_SUMMARY', name: 'Hearing summary entered after a hearing', target: 2, unit: 'BUSINESS' },
  { code: 'LIT_NO_UPDATE', name: 'Case with no update (flag after)', target: 30, unit: 'CALENDAR' },
  { code: 'CMP_CIRCULAR_ACK', name: 'Circular acknowledgement by department', target: 5, unit: 'BUSINESS' },
  { code: 'CMP_CHECKLIST', name: 'Department checklist response', target: 10, unit: 'BUSINESS' },
  { code: 'CMP_REMEDIATION_HIGH', name: 'Remediation of findings — High', target: 30, unit: 'CALENDAR' },
  { code: 'CMP_REMEDIATION_MEDIUM', name: 'Remediation of findings — Medium', target: 60, unit: 'CALENDAR' },
  { code: 'CMP_REMEDIATION_LOW', name: 'Remediation of findings — Low', target: 90, unit: 'CALENDAR' },
  { code: 'AWR_MATERIALS', name: 'Materials uploaded before a session (business days before)', target: 5, unit: 'BUSINESS' },
];
