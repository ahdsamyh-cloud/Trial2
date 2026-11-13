'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { UNITS, UNIT_NAMES } from '@ldms/shared';
import { download } from '@/lib/api';
import { useApi, useAction } from '@/lib/hooks';
import { label } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { Alert, Badge, Button, Card, Empty, PageHeader, Select } from '@/components/ui';

interface Ev { id: string; kind: string; unit: string; title: string; startsAt: string; endsAt: string | null; allDay: boolean; matterId: string | null; restricted: boolean; location: string | null; ownerId: string | null }
const KINDS = ['HEARING', 'DEADLINE', 'LIMITATION', 'COMPLIANCE_CHECK', 'FILING', 'CONTRACT_EXPIRY', 'CONTRACT_NOTICE', 'SESSION', 'POA_EXPIRY', 'LICENCE_EXPIRY', 'FOLLOW_UP'];
const TONE: Record<string, 'red' | 'amber' | 'blue' | 'green' | 'purple' | 'gray'> = { HEARING: 'purple', DEADLINE: 'amber', LIMITATION: 'red', COMPLIANCE_CHECK: 'blue', FILING: 'blue', CONTRACT_EXPIRY: 'amber', CONTRACT_NOTICE: 'red', SESSION: 'green', POA_EXPIRY: 'amber', LICENCE_EXPIRY: 'amber', FOLLOW_UP: 'gray' };
const TZ = 5 * 3600_000;
const localDay = (d: Date) => new Date(d.getTime() + TZ).toISOString().slice(0, 10);

export default function CalendarPage() {
  const { me } = useAuth();
  const [month, setMonth] = useState(() => { const n = new Date(Date.now() + TZ); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)); });
  const [f, setF] = useState({ unit: '', kind: '', mine: '' });
  const [view, setView] = useState<'month' | 'list'>('month');
  const from = new Date(month.getTime() - TZ);
  const to = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1) - TZ);
  const qs = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), ...(f.unit ? { unit: f.unit } : {}), ...(f.kind ? { kind: f.kind } : {}), ...(f.mine && me ? { ownerId: me.id } : {}) }).toString();
  const { data } = useApi<Ev[]>(`/calendar?${qs}`, [qs]);
  const act = useAction();
  const days = useMemo(() => {
    const first = month.getUTCDay();
    const n = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
    return [...Array(first).fill(null), ...Array.from({ length: n }, (_, i) => new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), i + 1)).toISOString().slice(0, 10))];
  }, [month]);
  const byDay = (d: string) => (data ?? []).filter((e) => localDay(new Date(e.startsAt)) === d);
  const title = month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const link = (e: Ev) => (e.matterId ? `/matters/${e.matterId}` : e.kind === 'SESSION' ? '/awareness' : e.kind.startsWith('CONTRACT') || e.kind === 'POA_EXPIRY' ? '/drafting' : '/compliance');
  return (
    <div className="space-y-4">
      <PageHeader title={t('Calendar')} subtitle={t('Hearings, deadlines, limitation dates, compliance checks, filings, contract and PoA expiries and awareness sessions.')}
        actions={<Button variant="secondary" onClick={() => act.run(() => download(`/calendar/ics?from=${from.toISOString()}&to=${to.toISOString()}`, 'ldms.ics'))}>{t('Add month to my calendar (.ics)')}</Button>} />
      {act.error ? <Alert>{act.error}</Alert> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" aria-label={t('Previous month')} onClick={() => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1)))}>‹</Button>
        <span className="w-40 text-center font-semibold">{title}</span>
        <Button variant="secondary" size="sm" aria-label={t('Next month')} onClick={() => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1)))}>›</Button>
        <Select aria-label={t('Unit')} className="w-36" placeholder={t('All units')} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} options={UNITS.map((u) => ({ value: u, label: UNIT_NAMES[u] }))} />
        <Select aria-label={t('Type')} className="w-44" placeholder={t('All types')} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={KINDS.map((k) => ({ value: k, label: label(k) }))} />
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={!!f.mine} onChange={(e) => setF({ ...f, mine: e.target.checked ? '1' : '' })} />{t('Only mine')}</label>
        <div className="ml-auto flex gap-1"><Button size="sm" variant={view === 'month' ? 'primary' : 'secondary'} onClick={() => setView('month')}>{t('Month')}</Button><Button size="sm" variant={view === 'list' ? 'primary' : 'secondary'} onClick={() => setView('list')}>{t('List')}</Button></div>
      </div>
      {view === 'month' ? (
        <div className="hidden overflow-hidden rounded-lg border bg-white md:block">
          <div className="grid grid-cols-7 border-b bg-slate-50 text-center text-xs font-semibold text-slate-600">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className={`py-1.5 ${d === 'Fri' || d === 'Sat' ? 'text-slate-400' : ''}`}>{t(d)}</div>)}</div>
          <div className="grid grid-cols-7">{days.map((d, i) => (
            <div key={i} className={`min-h-[96px] border-b border-r p-1 ${d && localDay(new Date()) === d ? 'bg-brand-50' : ''} ${i % 7 >= 5 ? 'bg-slate-50' : ''}`}>
              {d ? <><div className="text-right text-xs text-slate-500">{Number(d.slice(8))}</div>
                <ul className="space-y-0.5">{byDay(d).slice(0, 4).map((e) => <li key={e.id}><Link href={link(e)} className="block truncate rounded px-1 text-[11px] hover:underline" title={e.title}><Badge tone={TONE[e.kind] ?? 'gray'}>{label(e.kind).slice(0, 10)}</Badge> {e.title}</Link></li>)}
                  {byDay(d).length > 4 ? <li className="text-[11px] text-slate-500">+{byDay(d).length - 4} {t('more')}</li> : null}</ul></> : null}
            </div>
          ))}</div>
        </div>
      ) : null}
      <Card title={view === 'month' ? t('This month') : t('Events')} className={view === 'month' ? 'md:hidden' : ''}>
        {!data?.length ? <Empty>{t('No events this month')}</Empty> : <ul className="divide-y text-sm">{data.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div><Badge tone={TONE[e.kind] ?? 'gray'}>{label(e.kind)}</Badge> <Link href={link(e)} className="font-medium hover:underline">{e.title}</Link><div className="text-xs text-slate-500">{new Date(e.startsAt).toLocaleString('en-GB', { timeZone: 'Indian/Maldives', dateStyle: 'medium', ...(e.allDay ? {} : { timeStyle: 'short' }) })} · {UNIT_NAMES[e.unit as 'LIT']}{e.location ? ` · ${e.location}` : ''}</div></div>
            <Button size="sm" variant="ghost" onClick={() => act.run(() => download(`/calendar/ics?ids=${e.id}`, 'event.ics'))}>{t('Add to my calendar')}</Button>
          </li>
        ))}</ul>}
      </Card>
    </div>
  );
}
