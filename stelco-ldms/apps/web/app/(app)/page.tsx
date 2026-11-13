'use client';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/hooks';
import { fmtDate } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Card, Empty, PageHeader, Spinner, StatusBadge, Badge } from '@/components/ui';

interface WorkRow { id: string; reference: string; title: string; status: string; priority: string; dueDate: string | null; unit: string; restricted: boolean }

export default function MyWork() {
  const { me, can } = useAuth();
  const { data, loading } = useApi<{ matters: WorkRow[] }>(can('matter:read') ? '/my/work' : null);
  const notes = useApi<{ rows: { id: string; title: string; link: string | null; createdAt: string; readAt: string | null }[] }>('/notifications?unread=true');
  if (!can('matter:read') && can('portal:use')) {
    if (typeof window !== 'undefined') location.replace('/portal');
    return <Spinner />;
  }
  const overdue = data?.matters.filter((m) => m.dueDate && new Date(m.dueDate) < new Date()).length ?? 0;
  return (
    <div className="space-y-4">
      <PageHeader title={t('Good day, {name}', { name: me?.displayName ?? '' })} subtitle={t('Your open work, nearest deadline first.')} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title={t('My open matters ({n})', { n: data?.matters.length ?? 0 })} actions={overdue ? <Badge tone="red">{t('{n} overdue', { n: overdue })}</Badge> : null}>
            {loading ? <Spinner /> : !data?.matters.length ? <Empty>{t('Nothing assigned to you right now.')}</Empty> : (
              <ul className="divide-y divide-slate-100">
                {data.matters.map((m) => (
                  <li key={m.id}>
                    <Link href={`/matters/${m.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2 hover:bg-slate-50">
                      <div className="min-w-0">
                        <div className="text-xs text-slate-500">{m.reference}{m.restricted ? ` · ${t('Restricted')}` : ''}</div>
                        <div className="truncate text-sm font-medium">{m.title}</div>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        {m.priority === 'URGENT' || m.priority === 'HIGH' ? <StatusBadge value={m.priority} /> : null}
                        <StatusBadge value={m.status} />
                        <span className={m.dueDate && new Date(m.dueDate) < new Date() ? 'font-semibold text-red-700' : 'text-slate-600'}>{fmtDate(m.dueDate)}</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card title={t('Unread notifications')} actions={<Link className="text-sm text-brand-700 underline" href="/notifications">{t('All')}</Link>}>
          {!notes.data?.rows.length ? <Empty>{t('You are up to date.')}</Empty> : (
            <ul className="space-y-2 text-sm">{notes.data.rows.slice(0, 10).map((n) => <li key={n.id}><Link href={n.link ?? '/notifications'} className="hover:underline">{n.title}</Link><div className="text-xs text-slate-500">{fmtDate(n.createdAt)}</div></li>)}</ul>
          )}
        </Card>
      </div>
    </div>
  );
}
