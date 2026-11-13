'use client';
import Link from 'next/link';
import { download } from '@/lib/api';
import { useApi, useAction } from '@/lib/hooks';
import { fmtDate, fmtDateTime, fmtMoney, label } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Alert, Button, Card, Empty, PageHeader } from '@/components/ui';

interface Exposure { rows: { reference: string; title: string; risk: string; currency: string; claimAmount: number; exposure: number }[]; totals: Record<string, Record<string, { count: number; claim: number; exposure: number }>>; note: string }

export default function LitigationReports() {
  const exp = useApi<Exposure>('/litigation/reports/exposure');
  const up = useApi<{ id: string; startsAt: string; court: { name: string } | null; case: { matter: { id: string; reference: string; title: string }; externalFirm: { name: string } | null } }[]>('/litigation/reports/upcoming-hearings?days=60');
  const missing = useApi<{ id: string; startsAt: string; case: { matter: { id: string; reference: string; title: string } } }[]>('/litigation/reports/missing-summaries');
  const stale = useApi<{ matterId: string; lastUpdateAt: string; matter: { reference: string; title: string; status: string }; externalFirm: { name: string } | null }[]>('/litigation/reports/stale');
  const br = useApi<{ byStatus: { key: string; count: number }[]; byType: { key: string; count: number }[]; byFirm: { key: string; count: number }[]; firmPerformance: { firm: string; evaluations: number; quality: number; responsiveness: number; cost: number; outcome: number }[] }>('/litigation/reports/breakdown');
  const act = useAction();
  return (
    <div className="space-y-4">
      <PageHeader title={t('Litigation reports')} actions={<Link href="/litigation"><Button variant="ghost">{t('Back')}</Button></Link>} />
      {act.error ? <Alert>{act.error}</Alert> : null}
      <Card title={t('Contingent liability / exposure (open cases)')} actions={<Button size="sm" onClick={() => act.run(() => download('/litigation/reports/exposure?format=xlsx'))}>{t('Export for Finance (Excel)')}</Button>}>
        <p className="mb-2 text-xs text-slate-500">{exp.data?.note}</p>
        <table className="min-w-full text-sm">
          <thead><tr className="text-left text-xs uppercase text-slate-500"><th className="py-1">{t('Currency')}</th><th>{t('Risk')}</th><th>{t('Cases')}</th><th>{t('Total claimed')}</th><th>{t('Estimated exposure')}</th></tr></thead>
          <tbody className="divide-y">{Object.entries(exp.data?.totals ?? {}).flatMap(([cur, byRisk]) => Object.entries(byRisk).map(([risk, v]) => (
            <tr key={cur + risk}><td className="py-1">{cur}</td><td>{label(risk)}</td><td>{v.count}</td><td>{fmtMoney(v.claim, cur)}</td><td className="font-semibold">{fmtMoney(v.exposure, cur)}</td></tr>
          )))}</tbody>
        </table>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('Upcoming hearings (60 days)')}>{!up.data?.length ? <Empty>{t('None')}</Empty> : <ul className="space-y-1 text-sm">{up.data.map((h) => <li key={h.id}><Link className="underline" href={`/litigation/${h.case.matter.id}`}>{fmtDateTime(h.startsAt)}</Link> · {h.case.matter.reference} · {h.case.matter.title} {h.court ? `· ${h.court.name}` : ''}</li>)}</ul>}</Card>
        <Card title={t('Hearings without a summary')}>{!missing.data?.length ? <Empty>{t('All summaries entered')}</Empty> : <ul className="space-y-1 text-sm">{missing.data.map((h) => <li key={h.id} className="text-red-800"><Link className="underline" href={`/litigation/${h.case.matter.id}`}>{fmtDate(h.startsAt)}</Link> · {h.case.matter.reference} {h.case.matter.title}</li>)}</ul>}</Card>
        <Card title={t('Cases without an update for 30+ days')}>{!stale.data?.length ? <Empty>{t('None')}</Empty> : <ul className="space-y-1 text-sm">{stale.data.map((c) => <li key={c.matterId}><Link className="underline" href={`/litigation/${c.matterId}`}>{c.matter.reference}</Link> · {c.matter.title} · {t('last update')} {fmtDate(c.lastUpdateAt)} {c.externalFirm ? `· ${c.externalFirm.name}` : ''}</li>)}</ul>}</Card>
        <Card title={t('Cases by status, type and firm')}>
          <div className="grid gap-3 sm:grid-cols-3 text-sm">
            {(['byStatus', 'byType', 'byFirm'] as const).map((k) => <ul key={k}>{br.data?.[k].map((r) => <li key={r.key} className="flex justify-between gap-2"><span>{label(r.key)}</span><span className="font-semibold">{r.count}</span></li>)}</ul>)}
          </div>
        </Card>
        <Card title={t('Law firm performance (average of evaluations, out of 5)')}>
          {!br.data?.firmPerformance.length ? <Empty>{t('No evaluations yet')}</Empty> : <table className="min-w-full text-sm"><thead><tr className="text-left text-xs uppercase text-slate-500"><th>{t('Firm')}</th><th>{t('Quality')}</th><th>{t('Responsiveness')}</th><th>{t('Cost')}</th><th>{t('Outcome')}</th><th>n</th></tr></thead>
            <tbody>{br.data.firmPerformance.map((f) => <tr key={f.firm}><td>{f.firm}</td><td>{f.quality?.toFixed(1)}</td><td>{f.responsiveness?.toFixed(1)}</td><td>{f.cost?.toFixed(1)}</td><td>{f.outcome?.toFixed(1)}</td><td>{f.evaluations}</td></tr>)}</tbody></table>}
        </Card>
      </div>
    </div>
  );
}
