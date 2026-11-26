'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { UNITS, UNIT_NAMES } from '@ldms/shared';
import { api, download } from '@/lib/api';
import { useApi, useAction } from '@/lib/hooks';
import { fmtDate } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { DataTable, SavedViews } from './data-table';
import { Alert, Badge, Button, Input, Modal, PageHeader, Select, StatusBadge } from './ui';
import { UserSelect } from './parts';

export interface MatterRow {
  id: string; reference: string; unit: string; title: string; status: string; priority: string; dueDate: string | null; restricted: boolean; createdAt: string;
  requesterName: string | null; tags: string[]; legalHold: boolean; requestType: { name: string } | null; assignments: { role: string; user: { id: string; displayName: string } }[];
}

export function MattersList({ fixedUnit, title, subtitle, actions }: { fixedUnit?: string; title: string; subtitle?: string; actions?: React.ReactNode }) {
  const router = useRouter();
  const { can } = useAuth();
  const [f, setF] = useState<Record<string, string>>({ unit: fixedUnit ?? '', status: '', priority: '', q: '', open: 'true', mine: '' });
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<string[]>([]);
  const [bulk, setBulk] = useState(false);
  const [assignee, setAssignee] = useState('');
  const qs = new URLSearchParams(Object.entries({ ...f, page: String(page), pageSize: '25' }).filter(([, v]) => v)).toString();
  const { data, loading, reload } = useApi<{ rows: MatterRow[]; total: number }>(`/matters?${qs}`, [qs]);
  const act = useAction();
  const unit = f.unit || fixedUnit;
  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} actions={<>
        {actions}
        <Button variant="secondary" onClick={() => act.run(() => download(`/matters?${qs}&format=xlsx`, 'matters.xlsx'))}>{t('Export to Excel')}</Button>
      </>} />
      {act.error ? <Alert>{act.error}</Alert> : null}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {!fixedUnit ? <Select aria-label={t('Unit')} className="w-40" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder={t('All units')} options={UNITS.filter((u) => can('matter:read', u)).map((u) => ({ value: u, label: UNIT_NAMES[u] }))} /> : null}
        <Input aria-label={t('Status')} className="w-40" placeholder={t('Status')} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value.toUpperCase().replace(/\s+/g, '_') })} />
        <Select aria-label={t('Priority')} className="w-36" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} placeholder={t('Any priority')} options={['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => ({ value: p, label: p.charAt(0) + p.slice(1).toLowerCase() }))} />
        <Input aria-label={t('Search')} className="w-60" placeholder={t('Reference, title, requester')} value={f.q} onChange={(e) => { setF({ ...f, q: e.target.value }); setPage(1); }} />
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={f.open === 'true'} onChange={(e) => setF({ ...f, open: e.target.checked ? 'true' : '' })} />{t('Open only')}</label>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={f.mine === 'true'} onChange={(e) => setF({ ...f, mine: e.target.checked ? 'true' : '' })} />{t('Mine')}</label>
        <SavedViews id={`matters-${fixedUnit ?? 'all'}`} current={f} onApply={(v) => { setF(v); setPage(1); }} />
      </div>
      {sel.length && unit && can('matter:assign', unit) ? <div className="mb-2"><Button size="sm" onClick={() => setBulk(true)}>{t('Assign {n} selected', { n: sel.length })}</Button></div> : null}
      <DataTable id={`matters-${fixedUnit ?? 'all'}`} rows={data?.rows} total={data?.total} loading={loading} page={page} pageSize={25} onPage={setPage}
        selectable={!!unit && can('matter:assign', unit)} selected={sel} onSelect={setSel}
        onRowClick={(r) => router.push(r.unit === 'LIT' ? `/litigation/${r.id}` : r.unit === 'DRF' ? `/drafting/${r.id}` : `/matters/${r.id}`)}
        columns={[
          { key: 'reference', header: t('Reference'), render: (r) => <span className="whitespace-nowrap font-mono text-xs">{r.reference}{r.restricted ? <> <Badge tone="purple">{t('Restricted')}</Badge></> : null}</span> },
          { key: 'title', header: t('Title'), render: (r) => <span className="font-medium">{r.title}</span> },
          { key: 'unit', header: t('Unit'), render: (r) => UNIT_NAMES[r.unit as 'LIT'], hideOnMobile: true },
          { key: 'type', header: t('Type'), render: (r) => r.requestType?.name ?? '—', hideOnMobile: true, optional: true },
          { key: 'status', header: t('Status'), render: (r) => <StatusBadge value={r.status} /> },
          { key: 'priority', header: t('Priority'), render: (r) => <StatusBadge value={r.priority} />, hideOnMobile: true },
          { key: 'assignee', header: t('Assigned'), render: (r) => r.assignments.filter((a) => a.role === 'ASSIGNEE').map((a) => a.user.displayName).join(', ') || '—', hideOnMobile: true },
          { key: 'dueDate', header: t('Due'), render: (r) => <span className={r.dueDate && new Date(r.dueDate) < new Date() ? 'font-semibold text-red-700' : ''}>{fmtDate(r.dueDate)}</span> },
          { key: 'requester', header: t('Requester'), render: (r) => r.requesterName ?? '—', optional: true },
          { key: 'createdAt', header: t('Created'), render: (r) => fmtDate(r.createdAt), optional: true },
        ]} />
      <Modal open={bulk} title={t('Assign selected matters')} onClose={() => setBulk(false)}
        footer={<><Button variant="secondary" onClick={() => setBulk(false)}>{t('Cancel')}</Button><Button busy={act.busy} disabled={!assignee} onClick={() => act.run(async () => { await api.post('/matters/bulk/assign', { matterIds: sel, assigneeId: assignee }); setBulk(false); setSel([]); await reload(); })}>{t('Assign')}</Button></>}>
        <UserSelect unit={unit} labelText={t('Assign to')} value={assignee} onChange={setAssignee} />
      </Modal>
    </div>
  );
}

