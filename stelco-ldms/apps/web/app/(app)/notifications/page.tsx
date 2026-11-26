'use client';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { fmtDateTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Button, Card, Empty, PageHeader } from '@/components/ui';

export default function Notifications() {
  const { data, reload } = useApi<{ rows: { id: string; title: string; body: string | null; link: string | null; createdAt: string; readAt: string | null; type: string }[] }>('/notifications');
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t('Notifications')} actions={<Button variant="secondary" onClick={async () => { await api.post('/notifications/read-all'); await reload(); }}>{t('Mark all read')}</Button>} />
      <Card>
        {!data?.rows.length ? <Empty>{t('No notifications')}</Empty> : (
          <ul className="divide-y divide-slate-100">
            {data.rows.map((n) => (
              <li key={n.id} className={`py-3 ${n.readAt ? 'opacity-70' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={n.link ?? '#'} onClick={() => api.post(`/notifications/${n.id}/read`)} className={`text-sm ${n.readAt ? '' : 'font-semibold'} hover:underline`}>{n.title}</Link>
                    {n.body ? <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-600">{n.body}</p> : null}
                    <div className="text-xs text-slate-500">{fmtDateTime(n.createdAt)}</div>
                  </div>
                  {!n.readAt ? <Button size="sm" variant="ghost" onClick={async () => { await api.post(`/notifications/${n.id}/read`); await reload(); }}>{t('Mark read')}</Button> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
