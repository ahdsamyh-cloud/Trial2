'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApi } from '@/lib/hooks';
import { fmtDateTime, label } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { DataTable } from '@/components/data-table';
import { Button, Input, PageHeader, Select, StatusBadge } from '@/components/ui';

interface Row { id: string; intakeNo: string; source: string; receivedAt: string; senderName: string; subject: string; priority: string; status: string; matter: { id: string | null; reference: string } | null; suggestedUnit: string | null }

export default function IntakeInbox() {
  const router = useRouter();
  const { can } = useAuth();
  const [status, setStatus] = useState('NEW');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading } = useApi<{ rows: Row[]; total: number }>(`/intake?status=${status}&q=${encodeURIComponent(q)}&page=${page}&pageSize=25`, [status, q, page]);
  return (
    <div>
      <PageHeader title={t('Intake inbox')} subtitle={t('Requests received by email, letter, phone, walk-in or the portal. Triage each one so nothing is lost.')}
        actions={can('intake:create') ? <Link href="/intake/new"><Button>{t('New intake')}</Button></Link> : null} />
      <div className="mb-3 flex flex-wrap gap-2">
        <Select aria-label={t('Status')} className="w-44" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={[{ value: 'NEW', label: t('To triage') }, { value: 'CONVERTED', label: t('Converted') }, { value: 'LINKED', label: t('Linked') }, { value: 'NOT_LEGAL', label: t('Not legal') }, { value: 'DUPLICATE', label: t('Duplicate') }, { value: '', label: t('All') }]} />
        <Input aria-label={t('Search')} className="w-64" placeholder={t('Search subject, number, sender')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      </div>
      <DataTable id="intake" rows={data?.rows} total={data?.total} loading={loading} page={page} pageSize={25} onPage={setPage}
        onRowClick={(r) => router.push(`/intake/${r.id}`)}
        columns={[
          { key: 'intakeNo', header: t('Number'), render: (r) => <span className="font-mono text-xs">{r.intakeNo}</span> },
          { key: 'receivedAt', header: t('Received'), render: (r) => fmtDateTime(r.receivedAt), hideOnMobile: true },
          { key: 'source', header: t('Source'), render: (r) => label(r.source), hideOnMobile: true },
          { key: 'senderName', header: t('From'), hideOnMobile: true },
          { key: 'subject', header: t('Subject'), render: (r) => <span className="font-medium">{r.subject}</span> },
          { key: 'priority', header: t('Priority'), render: (r) => <StatusBadge value={r.priority} /> },
          { key: 'status', header: t('Status'), render: (r) => <StatusBadge value={r.status} /> },
          { key: 'matter', header: t('Matter'), render: (r) => r.matter?.reference ?? '—', optional: true },
        ]} />
    </div>
  );
}
