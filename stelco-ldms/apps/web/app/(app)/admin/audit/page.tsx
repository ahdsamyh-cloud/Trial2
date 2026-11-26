'use client';
import { useState } from 'react';
import { useApi } from '@/lib/hooks';
import { fmtDateTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Alert, Badge, Button, Card, Input, PageHeader, Select } from '@/components/ui';
import { DataTable } from '@/components/data-table';

interface A { seq: string; ts: string; actorName: string | null; ip: string | null; action: string; entityType: string | null; entityId: string | null; outcome: string; before: unknown; after: unknown; meta: unknown; hash: string; id: string }

export default function AuditViewer() {
  const [f, setF] = useState({ actor: '', action: '', entityId: '', outcome: '' });
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams(Object.entries({ ...f, page: String(page), pageSize: '50' }).filter(([, v]) => v)).toString();
  const { data, error, reload } = useApi<{ rows: A[]; total: number }>(`/audit?${qs}`, [qs]);
  const verify = useApi<{ ok: boolean; checked: number; brokenAt?: string; head?: string }>('/audit/verify');
  const [sel, setSel] = useState<A | null>(null);
  return (
    <div className="space-y-4">
      <PageHeader title={t('Audit log')} subtitle={t('Append-only and hash-chained. Every view of this page is itself logged.')} />
      {verify.data ? <Alert tone={verify.data.ok ? 'green' : 'red'}>{verify.data.ok ? t('Chain verified: {n} entries intact.', { n: verify.data.checked }) : t('Chain broken at entry {seq}! Contact IT security.', { seq: verify.data.brokenAt })}</Alert> : null}
      {error ? <Alert>{error.message} <Button size="sm" variant="ghost" onClick={() => reload()}>{t('Retry')}</Button></Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Input aria-label={t('User')} placeholder={t('User')} className="w-40" value={f.actor} onChange={(e) => setF({ ...f, actor: e.target.value })} />
        <Input aria-label={t('Action starts with')} placeholder={t('Action (e.g. auth., matter.)')} className="w-56" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} />
        <Input aria-label={t('Record id')} placeholder={t('Record id')} className="w-56" value={f.entityId} onChange={(e) => setF({ ...f, entityId: e.target.value })} />
        <Select aria-label={t('Outcome')} className="w-40" placeholder={t('Any outcome')} value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })} options={['SUCCESS', 'DENIED', 'FAILURE'].map((o) => ({ value: o, label: o }))} />
      </div>
      <DataTable id="audit" rows={data?.rows.map((r) => ({ ...r, id: r.seq }))} total={data?.total} page={page} pageSize={50} onPage={setPage} onRowClick={setSel}
        columns={[
          { key: 'seq', header: '#' },
          { key: 'ts', header: t('When'), render: (r) => fmtDateTime(r.ts) },
          { key: 'actorName', header: t('Who'), render: (r) => r.actorName ?? '—' },
          { key: 'action', header: t('Action'), render: (r) => <code className="text-xs">{r.action}</code> },
          { key: 'entity', header: t('Record'), render: (r) => r.entityType ? `${r.entityType} ${r.entityId?.slice(0, 10) ?? ''}` : '—', hideOnMobile: true },
          { key: 'outcome', header: t('Outcome'), render: (r) => <Badge tone={r.outcome === 'SUCCESS' ? 'green' : 'red'}>{r.outcome}</Badge> },
          { key: 'ip', header: 'IP', hideOnMobile: true, optional: true },
        ]} />
      {sel ? <Card title={`#${sel.seq} ${sel.action}`} actions={<Button size="sm" variant="ghost" onClick={() => setSel(null)}>{t('Close')}</Button>}><pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({ before: sel.before, after: sel.after, meta: sel.meta, ip: sel.ip, hash: sel.hash }, null, 2)}</pre></Card> : null}
    </div>
  );
}
