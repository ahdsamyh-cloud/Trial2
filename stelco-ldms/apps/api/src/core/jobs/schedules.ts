/** Recurring jobs (cron, Indian/Maldives time). Used by the worker and by the local scheduler. */
export const SCHEDULES: Record<string, string> = {
  'sla.scan': '*/10 * * * *',
  'reminders.send': '*/15 * * * *',
  'mail.flush': '*/5 * * * *',
  'digest.daily': '0 7 * * 0-4',
  'digest.weekly': '0 7 * * 0',
  'audit.verify': '30 2 * * *',
  'lit.no-update': '0 6 * * *',
  'lit.hearing-digest': '30 7 * * *',
  'lit.hearing-reminders': '0 15 * * *',
  'reports.auto': '0 8 * * *',
  'cmp.cycles': '15 6 * * *',
  'cmp.ack-reminders': '0 9 * * 0-4',
  'cmp.findings-overdue': '30 6 * * *',
  'cmp.answer-reminders': '0 9 * * 0-4',
  'drf.expiry-scan': '45 6 * * *',
  'retention.scan': '0 3 * * 6',
  'crypto.rotate': '0 4 * * 5',
};

/** Maldives time has no daylight saving: a fixed UTC+5 offset. */
const MALDIVES_OFFSET_MS = 5 * 3600_000;

function fieldMatches(field: string, value: number): boolean {
  return field.split(',').some((part) => {
    const [range, stepStr] = part.split('/');
    const step = stepStr ? Number(stepStr) : 1;
    if (!Number.isInteger(step) || step < 1) return false;
    let lo: number; let hi: number;
    if (range === '*') { lo = 0; hi = 1e9; }
    else if (range!.includes('-')) { [lo, hi] = range!.split('-').map(Number) as [number, number]; }
    else { lo = hi = Number(range); }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || value < lo || value > hi) return false;
    return (value - lo) % step === 0;
  });
}

/** Minimal 5-field cron matcher (numbers, *, ranges, lists, steps), evaluated in Maldives time. */
export function cronMatches(pattern: string, at: Date): boolean {
  const f = pattern.trim().split(/\s+/);
  if (f.length !== 5) return false;
  const t = new Date(at.getTime() + MALDIVES_OFFSET_MS);
  const vals = [t.getUTCMinutes(), t.getUTCHours(), t.getUTCDate(), t.getUTCMonth() + 1, t.getUTCDay()];
  return f.every((field, i) => fieldMatches(field, vals[i]!));
}
