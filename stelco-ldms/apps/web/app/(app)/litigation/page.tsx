'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, download } from '@/lib/api';
import { useApi, useAction } from '@/lib/hooks';
import { fmtDate, fmtDateTime, fmtMoney, label } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { DataTable } from '@/components/data-table';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Stat, StatusBadge, Textarea } from '@/components/ui';
import { UserSelect } from '@/components/parts';

interface CaseRow { id: string; courtCaseNo: string | null; caseType: string; ourRole: string; risk: string | null; claimAmount: string | null; currency: string; nextHearing: string | null; lastUpdateAt: string;
  matter: { reference: string; title: string; status: string; restricted: boolean }; court: { name: string } | null; externalFirm: { name: string } | null }

const CASE_TYPES = ['CIVIL', 'LABOUR', 'COMMERCIAL', 'CRIMINAL', 'REGULATORY', 'ARBITRATION', 'OTHER'];

export default function LitigationHome() {
  const router = useRouter();
  const { can } = useAuth();
  const [f, setF] = useState({ q: '', status: '', caseType: '', risk: '', open: 'true' });
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams(Object.entries({ ...f, page: String(page), pageSize: '25' }).filter(([, v]) => v)).toString();
  const { data, loading } = useApi<{ rows: CaseRow[]; total: number }>(`/litigation/cases?${qs}`, [qs]);
  const upcoming = useApi<{ id: string; startsAt: string; case: { matter: { id: string; reference: string; title: string } } }[]>('/litigation/reports/upcoming-hearings?days=14');
  const missing = useApi<unknown[]>('/litigation/reports/missing-summaries');
  const stale = useApi<unknown[]>('/litigation/reports/stale');
  const courts = useApi<{ id: string; name: string }[]>('/config/courts');
  const firms = useApi<{ id: string; name: string }[]>('/config/law-firms');
  const [open, setOpen] = useState(false);
  const [n, setN] = useState({ title: '', courtCaseNo: '', courtId: '', caseType: 'CIVIL', ourRole: 'DEFENDANT', externalFirmId: '', responsibleOfficerId: '', claimAmount: '', currency: 'MVR', filingDate: '', risk: '', exposure: '', description: '', parties: '', restricted: false });
  const act = useAction();
  const create = () => act.run(async () => {
    const parties = n.parties.split(/\s+v\.?\s+|\s+vs\.?\s+/i).map((s) => s.trim()).filter(Boolean);
    const r = await api.post<{ id: string }>('/litigation/cases', {
      title: n.title, courtCaseNo: n.courtCaseNo || null, courtId: n.courtId || null, caseType: n.caseType, ourRole: n.ourRole, externalFirmId: n.externalFirmId || null,
      responsibleOfficerId: n.responsibleOfficerId || null, claimAmount: n.claimAmount || null, currency: n.currency, filingDate: n.filingDate ? new Date(`${n.filingDate}T09:00:00+05:00`).toISOString() : null,
      risk: n.risk || null, exposure: n.exposure || null, description: n.description || null, restricted: n.restricted,
      parties: parties.length === 2 ? [{ name: parties[0], side: 'PLAINTIFF' }, { name: parties[1], side: 'DEFENDANT' }] : [],
    });
    router.push(`/litigation/${r.id}`);
  });
  return (
    <div className="space-y-4">
      <PageHeader title={t('Litigation')} subtitle={t('Court cases handled by external law firms, monitored by Legal.')}
        actions={<>
          {can('lit:write', 'LIT') ? <Button onClick={() => setOpen(true)}>{t('New case')}</Button> : null}
          {can('lit:import', 'LIT') ? <Link href="/litigation/import"><Button variant="secondary">{t('Import register')}</Button></Link> : null}
          <Link href="/litigation/reports"><Button variant="secondary">{t('Reports')}</Button></Link>
          <Button variant="ghost" onClick={() => act.run(() => download(`/litigation/cases?${qs}&format=xlsx`))}>{t('Export')}</Button>
        </>} />
      {act.error ? <Alert>{act.error}</Alert> : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t('Open cases')} value={f.open ? data?.total ?? '…' : '—'} />
        <Stat label={t('Hearings next 14 days')} value={upcoming.data?.length ?? '…'} href="/litigation/reports" />
        <Stat label={t('Missing hearing summaries')} value={missing.data?.length ?? '…'} tone={missing.data?.length ? 'red' : undefined} href="/litigation/reports" />
        <Stat label={t('No update 30+ days')} value={stale.data?.length ?? '…'} tone={stale.data?.length ? 'amber' : undefined} href="/litigation/reports" />
      </div>
      {upcoming.data?.length ? (
        <Card title={t('Upcoming hearings')}>
          <ul className="grid gap-2 sm:grid-cols-2">{upcoming.data.slice(0, 6).map((h) => <li key={h.id} className="text-sm"><Link className="font-medium hover:underline" href={`/litigation/${h.case.matter.id}`}>{fmtDateTime(h.startsAt)}</Link> · {h.case.matter.reference} {h.case.matter.title}</li>)}</ul>
        </Card>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Input aria-label={t('Search')} className="w-60" placeholder={t('Reference, case no., title')} value={f.q} onChange={(e) => { setF({ ...f, q: e.target.value }); setPage(1); }} />
        <Select aria-label={t('Case type')} className="w-40" placeholder={t('Any type')} value={f.caseType} onChange={(e) => setF({ ...f, caseType: e.target.value })} options={CASE_TYPES.map((c) => ({ value: c, label: label(c) }))} />
        <Select aria-label={t('Risk')} className="w-40" placeholder={t('Any risk')} value={f.risk} onChange={(e) => setF({ ...f, risk: e.target.value })} options={['PROBABLE', 'POSSIBLE', 'REMOTE'].map((c) => ({ value: c, label: label(c) }))} />
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={!!f.open} onChange={(e) => setF({ ...f, open: e.target.checked ? 'true' : '' })} />{t('Open only')}</label>
      </div>
      <DataTable id="lit-cases" rows={data?.rows} total={data?.total} loading={loading} page={page} pageSize={25} onPage={setPage} onRowClick={(r) => router.push(`/litigation/${r.id}`)}
        columns={[
          { key: 'ref', header: t('Reference'), render: (r) => <span className="whitespace-nowrap font-mono text-xs">{r.matter.reference}{r.matter.restricted ? <> <Badge tone="purple">R</Badge></> : null}</span> },
          { key: 'courtCaseNo', header: t('Case no.'), render: (r) => r.courtCaseNo ?? '—' },
          { key: 'title', header: t('Title'), render: (r) => <span className="font-medium">{r.matter.title}</span> },
          { key: 'court', header: t('Court'), render: (r) => r.court?.name ?? '—', hideOnMobile: true },
          { key: 'firm', header: t('External firm'), render: (r) => r.externalFirm?.name ?? '—', hideOnMobile: true },
          { key: 'status', header: t('Status'), render: (r) => <StatusBadge value={r.matter.status} /> },
          { key: 'risk', header: t('Risk'), render: (r) => (r.risk ? <StatusBadge value={r.risk} /> : '—'), hideOnMobile: true },
          { key: 'claim', header: t('Claim'), render: (r) => fmtMoney(r.claimAmount, r.currency), hideOnMobile: true, optional: true },
          { key: 'next', header: t('Next hearing'), render: (r) => fmtDate(r.nextHearing) },
          { key: 'type', header: t('Type'), render: (r) => label(r.caseType), optional: true },
        ]} />
      <Modal open={open} wide title={t('New case')} onClose={() => setOpen(false)} footer={<><Button variant="secondary" onClick={() => setOpen(false)}>{t('Cancel')}</Button><Button busy={act.busy} onClick={create}>{t('Create case')}</Button></>}>
        {act.error ? <Alert>{act.error}</Alert> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label={t('Title')} required>{(id) => <Input id={id} value={n.title} onChange={(e) => setN({ ...n, title: e.target.value })} />}</Field></div>
          <Field label={t('Court case number')}>{(id) => <Input id={id} value={n.courtCaseNo} onChange={(e) => setN({ ...n, courtCaseNo: e.target.value })} />}</Field>
          <Field label={t('Court / forum')}>{(id) => <Select id={id} placeholder={t('— Select —')} value={n.courtId} onChange={(e) => setN({ ...n, courtId: e.target.value })} options={(courts.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />}</Field>
          <Field label={t('Case type')}>{(id) => <Select id={id} value={n.caseType} onChange={(e) => setN({ ...n, caseType: e.target.value })} options={CASE_TYPES.map((c) => ({ value: c, label: label(c) }))} />}</Field>
          <Field label={t('Our role')}>{(id) => <Select id={id} value={n.ourRole} onChange={(e) => setN({ ...n, ourRole: e.target.value })} options={['PLAINTIFF', 'DEFENDANT', 'THIRD_PARTY'].map((c) => ({ value: c, label: label(c) }))} />}</Field>
          <div className="sm:col-span-2"><Field label={t('Parties')} hint={t('e.g. "ABC Pvt Ltd v STELCO"')}>{(id) => <Input id={id} value={n.parties} onChange={(e) => setN({ ...n, parties: e.target.value })} />}</Field></div>
          <Field label={t('External law firm')}>{(id) => <Select id={id} placeholder={t('— None —')} value={n.externalFirmId} onChange={(e) => setN({ ...n, externalFirmId: e.target.value })} options={(firms.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />}</Field>
          <UserSelect unit="LIT" labelText={t('Responsible officer')} value={n.responsibleOfficerId} onChange={(v) => setN({ ...n, responsibleOfficerId: v })} />
          <Field label={t('Claim amount')}>{(id) => <Input id={id} inputMode="decimal" value={n.claimAmount} onChange={(e) => setN({ ...n, claimAmount: e.target.value })} />}</Field>
          <Field label={t('Currency')}>{(id) => <Select id={id} value={n.currency} onChange={(e) => setN({ ...n, currency: e.target.value })} options={['MVR', 'USD', 'EUR'].map((c) => ({ value: c, label: c }))} />}</Field>
          <Field label={t('Filing date')}>{(id) => <Input id={id} type="date" value={n.filingDate} onChange={(e) => setN({ ...n, filingDate: e.target.value })} />}</Field>
          <Field label={t('Risk assessment')}>{(id) => <Select id={id} placeholder={t('Not assessed')} value={n.risk} onChange={(e) => setN({ ...n, risk: e.target.value })} options={['PROBABLE', 'POSSIBLE', 'REMOTE'].map((c) => ({ value: c, label: label(c) }))} />}</Field>
          <Field label={t('Estimated exposure')} hint={t('Stored encrypted.')}>{(id) => <Input id={id} inputMode="decimal" value={n.exposure} onChange={(e) => setN({ ...n, exposure: e.target.value })} />}</Field>
          <div className="sm:col-span-2"><Field label={t('Background')}>{(id) => <Textarea id={id} value={n.description} onChange={(e) => setN({ ...n, description: e.target.value })} />}</Field></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={n.restricted} onChange={(e) => setN({ ...n, restricted: e.target.checked })} />{t('Restricted (confidential)')}</label>
        </div>
      </Modal>
    </div>
  );
}
