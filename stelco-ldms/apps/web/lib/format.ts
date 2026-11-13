const TZ = 'Indian/Maldives';
export function fmtDate(d?: string | Date | null) {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d));
}
export function fmtDateTime(d?: string | Date | null) {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(d));
}
export function fmtMoney(v?: string | number | null, cur = 'MVR') {
  if (v === null || v === undefined || v === '') return '—';
  return `${cur} ${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}
export function label(s?: string | null) {
  if (!s) return '—';
  return s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}
export function toLocalInput(d?: string | Date | null) {
  if (!d) return '';
  const x = new Date(new Date(d).getTime() + 5 * 3600_000);
  return x.toISOString().slice(0, 16);
}
export function fromLocalInput(s: string) {
  return s ? new Date(`${s}:00+05:00`).toISOString() : '';
}
