/**
 * Business-day calendar for STELCO (Indian/Maldives, UTC+5, no DST).
 * Working week Sun–Thu by default; Fri/Sat weekend; configurable holidays.
 *
 * All functions are pure. "Business time" = wall-clock time that falls on a
 * business day (00:00–24:00 local). Deadlines fall at the configured cut-off
 * time (default 16:00 local) of the target business day.
 */

const DAY_MS = 86_400_000;

export interface WorkCalendar {
  /** Offset of local time from UTC in minutes (Maldives = +300). */
  offsetMinutes: number;
  /** Working days, 0 = Sunday … 6 = Saturday. */
  workdays: number[];
  /** Public holidays as local `YYYY-MM-DD` strings. */
  holidays: ReadonlySet<string>;
  /** Deadline cut-off within the business day, minutes after local midnight. */
  cutoffMinutes: number;
}

export const DEFAULT_CALENDAR: WorkCalendar = {
  offsetMinutes: 300,
  workdays: [0, 1, 2, 3, 4],
  holidays: new Set<string>(),
  cutoffMinutes: 16 * 60,
};

export function makeCalendar(partial: Partial<Omit<WorkCalendar, 'holidays'>> & { holidays?: Iterable<string> } = {}): WorkCalendar {
  return {
    ...DEFAULT_CALENDAR,
    ...partial,
    holidays: new Set(partial.holidays ?? []),
  };
}

/** Local day number (days since 1970-01-01 in local time). */
export function localDayNumber(d: Date, cal: WorkCalendar = DEFAULT_CALENDAR): number {
  return Math.floor((d.getTime() + cal.offsetMinutes * 60_000) / DAY_MS);
}

/** UTC instant of local midnight for a local day number. */
export function startOfLocalDay(day: number, cal: WorkCalendar = DEFAULT_CALENDAR): Date {
  return new Date(day * DAY_MS - cal.offsetMinutes * 60_000);
}

export function dayNumberToIso(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function isoToDayNumber(iso: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`Invalid date: ${iso}`);
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
}

/** Local calendar date (YYYY-MM-DD) for an instant. */
export function toLocalIsoDate(d: Date, cal: WorkCalendar = DEFAULT_CALENDAR): string {
  return dayNumberToIso(localDayNumber(d, cal));
}

/** 1970-01-01 was a Thursday (4). */
export function weekdayOfDay(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

export function isBusinessDayNumber(day: number, cal: WorkCalendar = DEFAULT_CALENDAR): boolean {
  return cal.workdays.includes(weekdayOfDay(day)) && !cal.holidays.has(dayNumberToIso(day));
}

export function isBusinessDay(d: Date | string, cal: WorkCalendar = DEFAULT_CALENDAR): boolean {
  const day = typeof d === 'string' ? isoToDayNumber(d) : localDayNumber(d, cal);
  return isBusinessDayNumber(day, cal);
}

/**
 * Deadline `n` business days after `start`: the cut-off time on the n-th business
 * day following the start's local date. n = 0 → cut-off today if a business day,
 * else the next business day.
 */
export function addBusinessDays(start: Date, n: number, cal: WorkCalendar = DEFAULT_CALENDAR): Date {
  if (!Number.isInteger(n) || n < 0) throw new Error('n must be a non-negative integer');
  let day = localDayNumber(start, cal);
  if (n === 0) {
    while (!isBusinessDayNumber(day, cal)) day++;
  } else {
    let counted = 0;
    while (counted < n) {
      day++;
      if (isBusinessDayNumber(day, cal)) counted++;
    }
  }
  return new Date(startOfLocalDay(day, cal).getTime() + cal.cutoffMinutes * 60_000);
}

export function addCalendarDays(start: Date, n: number): Date {
  return new Date(start.getTime() + n * DAY_MS);
}

/** Milliseconds of business time in [a, b). */
export function businessMsBetween(a: Date, b: Date, cal: WorkCalendar = DEFAULT_CALENDAR): number {
  const from = a.getTime();
  const to = b.getTime();
  if (to <= from) return 0;
  let total = 0;
  const lastDay = localDayNumber(new Date(to - 1), cal);
  for (let day = localDayNumber(a, cal); day <= lastDay; day++) {
    if (!isBusinessDayNumber(day, cal)) continue;
    const ds = startOfLocalDay(day, cal).getTime();
    const s = Math.max(from, ds);
    const e = Math.min(to, ds + DAY_MS);
    if (e > s) total += e - s;
  }
  return total;
}

/** Move forward by `ms` of business time. */
export function addBusinessMs(d: Date, ms: number, cal: WorkCalendar = DEFAULT_CALENDAR): Date {
  let remaining = Math.max(0, ms);
  let day = localDayNumber(d, cal);
  let cursor = d.getTime();
  // Guard against pathological calendars (no workdays).
  for (let i = 0; i < 366 * 20; i++) {
    if (isBusinessDayNumber(day, cal)) {
      const dayEnd = startOfLocalDay(day + 1, cal).getTime();
      const avail = dayEnd - cursor;
      if (remaining <= avail) return new Date(cursor + remaining);
      remaining -= avail;
    }
    day++;
    cursor = startOfLocalDay(day, cal).getTime();
  }
  throw new Error('Calendar has no business days');
}

/** Whole business days between two local dates (exclusive of start, inclusive of end). */
export function businessDaysBetween(a: Date, b: Date, cal: WorkCalendar = DEFAULT_CALENDAR): number {
  const da = localDayNumber(a, cal);
  const db = localDayNumber(b, cal);
  const sign = db >= da ? 1 : -1;
  let count = 0;
  for (let day = Math.min(da, db) + 1; day <= Math.max(da, db); day++) if (isBusinessDayNumber(day, cal)) count++;
  return sign * count;
}

/** Working-day count of the n-th business day before a date (e.g. "5 business days before a session"). */
export function subtractBusinessDays(end: Date, n: number, cal: WorkCalendar = DEFAULT_CALENDAR): Date {
  let day = localDayNumber(end, cal);
  let counted = 0;
  while (counted < n) {
    day--;
    if (isBusinessDayNumber(day, cal)) counted++;
  }
  return new Date(startOfLocalDay(day, cal).getTime() + cal.cutoffMinutes * 60_000);
}
