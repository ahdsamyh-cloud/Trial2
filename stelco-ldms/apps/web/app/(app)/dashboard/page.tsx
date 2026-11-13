'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { UNITS, UNIT_NAMES } from '@ldms/shared';
import { download } from '@/lib/api';
import { useApi, useAction } from '@/lib/hooks';
import { fmtDate, fmtDateTime, label } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { HeatMap } from '@/components/heatmap';
import { Alert, Button, Card, Empty, Input, PageHeader, Select, Stat } from '@/components/ui';

interface Dash {
  openByUnitStatus: { unit: string; status: string; count: number }[];
  slaBreaches: { id: string; policy: string; breachedAt: string; escalationLevel: number; matter: { id: string; reference: string; title: string; unit: string } }[];
  turnaround: { unit: string; closed: number; avgBusinessDays: number | null }[];
  workload: { userId: string; name: string; open: number }[];
  upcoming: { id: string; kind: string; title: string; startsAt: string; matterId: string | null }[];
  exposure: Record<string, Record<string, { count: number; exposure: number; claim: number }>>;
  complianceHeat: { departmentId: string; department: string; lawId: string; law: string; score: number | null }[];
  awarenessCoverage: { year: number; employees: number; reached: number; percent: number | null; sessionsHeld: number } | null;
}
interface Mgmt { openByUnit: { unit: string; count: number }[]; confidentialOpen: number; closedByUnit: { unit: string; count: number }[]; slaBreachesOpen: number; litigationExposure: Record<string, Record<string, number>>; compliance: { average: number | null }; awareness: { percent: number | null; sessionsHeld: number } }

export default function DashboardPage() {
  const { can } = useAuth();
  const full = can('dashboard:hod') || can('dashboard:unit');
  return full ? <FullDashboard /> : can('dashboard:mgmt') ? <ManagementDashboard /> : <Alert>{t('You do not have access to dashboards.')}</Alert>;
}

function ReportButtons() {
  const { can } = useAuth();
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const act = useAction();
  if (!can('report:read')) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {act.error ? <Alert>{act.error}</Alert> : null}
      <Input aria-label={t('Report month')} type="month" className="w-40" value={period} onChange={(e) => setPeriod(e.target.value)} />
      <Button size="sm" variant="secondary" onClick={() => act.run(() => download(`/reports/management?kind=monthly&period=${period}&format=pdf`))}>{t('Monthly report (PDF)')}</Button>
      <Button size="sm" variant="secondary" onClick={() => act.run(() => download(`/reports/management?kind=monthly&period=${period}&format=xlsx`))}>{t('Excel')}</Button>
      <Button size="sm" variant="secondary" onClick={() => act.run(() => download(`/reports/management?kind=annual&period=${period.slice(0, 4)}&format=pdf`))}>{t('Annual report (PDF)')}</Button>
    </div>
  );
}

function FullDashboard() {
  const { can } = useAuth();
  const hod = can('dashboard:hod');
  const [f, setF] = useState({ unit: '', departmentId: '', from: '', to: '' });
  const depts = useApi<{ id: string; name: string }[]>('/config/departments');
  const qs = new URLSearchParams(Object.entries({ ...f, from: f.from ? new Date(`${f.from}T00:00:00+05:00`).toISOString() : '', to: f.to ? new Date(`${f.to}T23:59:59+05:00`).toISOString() : '' }).filter(([, v]) => v)).toString();
  const { data, error } = useApi<Dash>(`/dashboard?${qs}`, [qs]);
  const units = UNITS.filter((u) => hod || can('dashboard:unit', u));
  const chart = units.map((u) => ({ unit: UNIT_NAMES[u], open: data?.openByUnitStatus.filter((r) => r.unit === u).reduce((n, r) => n + r.count, 0) ?? 0 }));
  const total = chart.reduce((n, c) => n + c.open, 0);
  return (
    <div className="space-y-4">
      <PageHeader title={hod ? t('HoD dashboard') : t('Unit dashboard')} actions={<ReportButtons />} />
      {error ? <Alert>{error.message}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Select aria-label={t('Unit')} className="w-36" placeholder={hod ? t('All units') : undefined} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} options={units.map((u) => ({ value: u, label: UNIT_NAMES[u] }))} />
        <Select aria-label={t('Department')} className="w-48" placeholder={t('All departments')} value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value })} options={(depts.data ?? []).map((d) => ({ value: d.id, label: d.name }))} />
        <Input aria-label={t('From')} type="date" className="w-40" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        <Input aria-label={t('To')} type="date" className="w-40" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
      </div>
      {data ? <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={t('Open matters')} value={total} />
          <Stat label={t('SLA breaches')} value={data.slaBreaches.length} tone={data.slaBreaches.length ? 'red' : 'green'} />
          <Stat label={t('Upcoming (30 days)')} value={data.upcoming.length} />
          <Stat label={t('Awareness coverage')} value={data.awarenessCoverage?.percent !== null && data.awarenessCoverage ? `${data.awarenessCoverage.percent}%` : '—'} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={t('Open matters by unit')}>
            <div className="h-56" role="img" aria-label={chart.map((c) => `${c.unit}: ${c.open}`).join(', ')}>
              <ResponsiveContainer><BarChart data={chart}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="unit" fontSize={11} /><YAxis allowDecimals={false} fontSize={11} /><Tooltip /><Legend /><Bar dataKey="open" name={t('Open')} fill="#1f6fd1" /></BarChart></ResponsiveContainer>
            </div>
            <table className="mt-2 w-full text-xs"><tbody>{data.openByUnitStatus.map((r) => <tr key={r.unit + r.status}><td>{UNIT_NAMES[r.unit as 'LIT']}</td><td>{label(r.status)}</td><td className="text-right font-semibold">{r.count}</td></tr>)}</tbody></table>
          </Card>
          <Card title={t('SLA breaches')}>
            {!data.slaBreaches.length ? <Empty>{t('No open breaches')}</Empty> : <ul className="divide-y text-sm">{data.slaBreaches.map((b) => <li key={b.id} className="py-1.5"><Link className="font-medium hover:underline" href={`/matters/${b.matter.id}`}>{b.matter.reference}</Link> {b.matter.title}<div className="text-xs text-red-700">{b.policy} · {t('breached')} {fmtDateTime(b.breachedAt)}{b.escalationLevel > 1 ? ` · ${t('escalated to HoD')}` : ''}</div></li>)}</ul>}
          </Card>
          <Card title={t('Average turnaround (business days)')}>
            <table className="w-full text-sm"><thead><tr className="text-left text-xs text-slate-500"><th>{t('Unit')}</th><th>{t('Closed')}</th><th>{t('Average')}</th></tr></thead><tbody>{data.turnaround.filter((x) => units.includes(x.unit as 'LIT')).map((x) => <tr key={x.unit}><td>{UNIT_NAMES[x.unit as 'LIT']}</td><td>{x.closed}</td><td>{x.avgBusinessDays ?? '—'}</td></tr>)}</tbody></table>
          </Card>
          <Card title={t('Workload per lawyer (open assignments)')}>
            {!data.workload.length ? <Empty>{t('No open assignments')}</Empty> : <ul className="space-y-1 text-sm">{data.workload.map((w) => <li key={w.userId} className="flex items-center gap-2"><span className="w-40 truncate">{w.name}</span><span className="h-2 rounded bg-brand-500" aria-hidden><span className={`block h-2 ${['w-2', 'w-4', 'w-8', 'w-12', 'w-16', 'w-24', 'w-32', 'w-40'][Math.min(7, w.open)]}`} /></span><span className="font-semibold">{w.open}</span></li>)}</ul>}
          </Card>
          <Card title={t('Upcoming hearings and deadlines')}>
            {!data.upcoming.length ? <Empty>{t('Nothing in the next 30 days')}</Empty> : <ul className="divide-y text-sm">{data.upcoming.map((e) => <li key={e.id} className="py-1.5"><span className="text-xs text-slate-500">{fmtDate(e.startsAt)} · {label(e.kind)}</span><div>{e.matterId ? <Link className="hover:underline" href={`/matters/${e.matterId}`}>{e.title}</Link> : e.title}</div></li>)}</ul>}
          </Card>
          <Card title={t('Litigation exposure (open cases)')}>
            {!Object.keys(data.exposure).length ? <Empty>{t('No open cases')}</Empty> : <table className="w-full text-sm"><thead><tr className="text-left text-xs text-slate-500"><th>{t('Currency')}</th><th>{t('Risk')}</th><th>{t('Cases')}</th><th className="text-right">{t('Exposure')}</th></tr></thead><tbody>{Object.entries(data.exposure).flatMap(([c, r]) => Object.entries(r).map(([risk, v]) => <tr key={c + risk}><td>{c}</td><td>{label(risk)}</td><td>{v.count}</td><td className="text-right font-semibold">{v.exposure.toLocaleString('en-US')}</td></tr>))}</tbody></table>}
          </Card>
        </div>
        {data.complianceHeat.length ? <Card title={t('Compliance heat map')}><HeatMap cells={data.complianceHeat} /></Card> : null}
      </> : null}
    </div>
  );
}

function ManagementDashboard() {
  const { data } = useApi<Mgmt>('/dashboard/management');
  if (!data) return null;
  return (
    <div className="space-y-4">
      <PageHeader title={t('Management overview')} subtitle={t('Aggregated figures only. Confidential matters are counted but not described.')} actions={<ReportButtons />} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {data.openByUnit.map((u) => <Stat key={u.unit} label={t('Open — {u}', { u: UNIT_NAMES[u.unit as 'LIT'] })} value={u.count} />)}
        <Stat label={t('Open — confidential')} value={data.confidentialOpen} />
        <Stat label={t('Open SLA breaches')} value={data.slaBreachesOpen} tone={data.slaBreachesOpen ? 'red' : 'green'} />
        <Stat label={t('Compliance score')} value={data.compliance.average === null ? '—' : `${data.compliance.average}%`} />
        <Stat label={t('Awareness coverage')} value={data.awareness.percent === null ? '—' : `${data.awareness.percent}%`} />
      </div>
      <Card title={t('Litigation exposure by risk')}>
        <table className="w-full text-sm"><tbody>{Object.entries(data.litigationExposure).flatMap(([c, r]) => Object.entries(r).map(([risk, v]) => <tr key={c + risk}><td>{c}</td><td>{label(risk)}</td><td className="text-right font-semibold">{v.toLocaleString('en-US')}</td></tr>))}</tbody></table>
      </Card>
    </div>
  );
}
