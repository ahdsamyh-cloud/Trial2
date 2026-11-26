'use client';
import { api } from '@/lib/api';
import { useApi, useAction } from '@/lib/hooks';
import { fmtDate } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Alert, Button, Card, Empty, PageHeader } from '@/components/ui';

export default function Retention() {
  const { data, reload } = useApi<{ id: string; reason: string; createdAt: string; matter: { id: string; reference: string; title: string; closedAt: string | null } | null }[]>('/retention/disposals');
  const act = useAction();
  return (
    <div className="space-y-4">
      <PageHeader title={t('Retention and disposal')} subtitle={t('Records past their retention period. Nothing is destroyed without your approval; records under legal hold are never proposed.')}
        actions={<Button variant="secondary" onClick={() => act.run(async () => { await api.post('/retention/scan'); await reload(); })}>{t('Check now')}</Button>} />
      {act.error ? <Alert>{act.error}</Alert> : null}
      <Card title={t('Waiting for your decision')}>
        {!data?.length ? <Empty>{t('Nothing to review')}</Empty> : <ul className="divide-y text-sm">{data.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div><div className="font-medium">{d.matter ? `${d.matter.reference} — ${d.matter.title}` : t('(record no longer visible)')}</div><div className="text-xs text-slate-500">{d.reason} · {t('closed')} {fmtDate(d.matter?.closedAt)}</div></div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" busy={act.busy} onClick={() => act.run(async () => { await api.post(`/retention/disposals/${d.id}`, { approve: false }); await reload(); })}>{t('Keep')}</Button>
              <Button size="sm" variant="danger" busy={act.busy} onClick={() => act.run(async () => { if (confirm(t('Permanently destroy this record and its files? This cannot be undone.'))) { await api.post(`/retention/disposals/${d.id}`, { approve: true }); await reload(); } })}>{t('Dispose')}</Button>
            </div>
          </li>
        ))}</ul>}
      </Card>
    </div>
  );
}
