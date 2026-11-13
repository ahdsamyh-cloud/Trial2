'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, download } from '@/lib/api';
import { useApi, useAction } from '@/lib/hooks';
import { fmtDate, fmtMoney, label } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { MattersList } from '@/components/matters-list';
import { DocumentsPanel } from '@/components/parts';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, Select, StatusBadge, Tabs, Textarea } from '@/components/ui';

type Tab = 'requests' | 'contracts' | 'poa' | 'opinions' | 'library';

export default function DraftingHome() {
  const [tab, setTab] = useState<Tab>('requests');
  return (
    <div>
      <Tabs active={tab} onChange={(x) => setTab(x as Tab)} tabs={[
        { id: 'requests', label: t('Requests') }, { id: 'contracts', label: t('Contracts') }, { id: 'poa', label: t('Powers of attorney') },
        { id: 'opinions', label: t('Legal opinions') }, { id: 'library', label: t('Templates & clauses') },
      ]} />
      {tab === 'requests' ? <Requests /> : tab === 'contracts' ? <Contracts /> : tab === 'poa' ? <Poas /> : tab === 'opinions' ? <Opinions /> : <Library />}
    </div>
  );
}

function Requests() {
  const router = useRouter();
  const { can } = useAuth();
  const types = useApi<{ id: string; unit: string; name: string; active: boolean }[]>('/config/request-types');
  const depts = useApi<{ id: string; name: string }[]>('/config/departments');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: '', requestTypeId: '', requestingDeptId: '', requesterName: '', priority: 'NORMAL', dueDate: '', counterparty: '', contractValue: '', description: '', restricted: false });
  const act = useAction();
  return (
    <>
      <MattersList fixedUnit="DRF" title={t('Drafting requests')} subtitle={t('Contracts, letters, policies and opinions with maker-checker review.')}
        actions={can('draft:draft', 'DRF') || can('intake:triage', 'DRF') ? <Button onClick={() => setOpen(true)}>{t('New request')}</Button> : null} />
      <Modal open={open} wide title={t('New drafting request')} onClose={() => setOpen(false)} footer={<><Button variant="secondary" onClick={() => setOpen(false)}>{t('Cancel')}</Button><Button busy={act.busy} onClick={() => act.run(async () => {
        const r = await api.post<{ id: string }>('/drafting/requests', { ...f, requestingDeptId: f.requestingDeptId || null, dueDate: f.dueDate ? new Date(`${f.dueDate}T16:00:00+05:00`).toISOString() : null, contractValue: f.contractValue || null, counterparty: f.counterparty || null, description: f.description || null });
        router.push(`/drafting/${r.id}`);
      })}>{t('Register')}</Button></>}>
        {act.error ? <Alert>{act.error}</Alert> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label={t('Title')} required>{(id) => <Input id={id} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field></div>
          <Field label={t('Request type')} required>{(id) => <Select id={id} placeholder={t('— Select —')} value={f.requestTypeId} onChange={(e) => setF({ ...f, requestTypeId: e.target.value })} options={(types.data ?? []).filter((x) => x.unit === 'DRF' && x.active).map((x) => ({ value: x.id, label: x.name }))} />}</Field>
          <Field label={t('Requesting department')}>{(id) => <Select id={id} placeholder={t('— Select —')} value={f.requestingDeptId} onChange={(e) => setF({ ...f, requestingDeptId: e.target.value })} options={(depts.data ?? []).map((d) => ({ value: d.id, label: d.name }))} />}</Field>
          <Field label={t('Requester name')}>{(id) => <Input id={id} value={f.requesterName} onChange={(e) => setF({ ...f, requesterName: e.target.value })} />}</Field>
          <Field label={t('Priority')}>{(id) => <Select id={id} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} options={['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => ({ value: p, label: label(p) }))} />}</Field>
          <Field label={t('Counterparty')}>{(id) => <Input id={id} value={f.counterparty} onChange={(e) => setF({ ...f, counterparty: e.target.value })} />}</Field>
          <Field label={t('Contract value (MVR)')}>{(id) => <Input id={id} inputMode="decimal" value={f.contractValue} onChange={(e) => setF({ ...f, contractValue: e.target.value })} />}</Field>
          <Field label={t('Requested by date')}>{(id) => <Input id={id} type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />}</Field>
          <div className="sm:col-span-2"><Field label={t('Details')}>{(id) => <Textarea id={id} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.restricted} onChange={(e) => setF({ ...f, restricted: e.target.checked })} />{t('Restricted (confidential)')}</label>
        </div>
      </Modal>
    </>
  );
}

interface Contract { id: string; title: string; parties: string[]; value: string | null; currency: string; startDate: string | null; endDate: string | null; autoRenew: boolean; noticePeriodDays: number | null; noticeDeadline: string | null; status: string; keyObligations: string | null; ownerDeptId: string | null }

function Contracts() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [exp, setExp] = useState('');
  const { data, reload } = useApi<Contract[]>(`/drafting/contracts?q=${encodeURIComponent(q)}${exp ? `&expiringDays=${exp}` : ''}`, [q, exp]);
  const depts = useApi<{ id: string; name: string }[]>('/config/departments');
  const [edit, setEdit] = useState<Partial<Contract> | null>(null);
  const [docs, setDocs] = useState<Contract | null>(null);
  const act = useAction();
  const write = can('draft:draft', 'DRF') || can('matter:write', 'DRF');
  const save = () => act.run(async () => {
    const body = { title: edit!.title, parties: (edit!.parties ?? []).filter(Boolean), value: edit!.value || null, currency: edit!.currency ?? 'MVR', startDate: edit!.startDate ? new Date(`${edit!.startDate.slice(0, 10)}T09:00:00+05:00`).toISOString() : null, endDate: edit!.endDate ? new Date(`${edit!.endDate.slice(0, 10)}T16:00:00+05:00`).toISOString() : null, autoRenew: !!edit!.autoRenew, noticePeriodDays: edit!.noticePeriodDays ? Number(edit!.noticePeriodDays) : null, ownerDeptId: edit!.ownerDeptId || null, keyObligations: edit!.keyObligations || null, status: edit!.status ?? 'ACTIVE' };
    if (edit!.id) await api.patch(`/drafting/contracts/${edit!.id}`, body); else await api.post('/drafting/contracts', body);
    setEdit(null); await reload();
  });
  return (
    <Card title={t('Contract repository')} actions={<>
      <Input aria-label={t('Search')} className="w-48" placeholder={t('Search')} value={q} onChange={(e) => setQ(e.target.value)} />
      <Select aria-label={t('Expiring')} className="w-44" value={exp} onChange={(e) => setExp(e.target.value)} placeholder={t('All dates')} options={[{ value: '30', label: t('Expiring in 30 days') }, { value: '90', label: t('Expiring in 90 days') }]} />
      <Button variant="secondary" size="sm" onClick={() => act.run(() => download('/drafting/contracts?format=xlsx'))}>{t('Export')}</Button>
      {write ? <Button size="sm" onClick={() => setEdit({ parties: ['STELCO', ''], currency: 'MVR', status: 'ACTIVE' })}>{t('Add contract')}</Button> : null}
    </>}>
      {act.error ? <Alert>{act.error}</Alert> : null}
      {!data?.length ? <Empty>{t('No contracts')}</Empty> : (
        <ul className="divide-y">{data.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <div className="min-w-0"><div className="font-medium">{c.title}</div><div className="text-xs text-slate-500">{c.parties.join(' · ')} · {fmtMoney(c.value, c.currency)}</div></div>
            <div className="flex flex-wrap items-center gap-2">
              <span>{fmtDate(c.startDate)} → <span className={c.endDate && new Date(c.endDate).getTime() - Date.now() < 30 * 86400_000 ? 'font-semibold text-red-700' : ''}>{fmtDate(c.endDate)}</span></span>
              {c.autoRenew ? <Badge tone="amber">{t('Auto-renews')}</Badge> : null}
              {c.noticeDeadline ? <Badge>{t('Notice by')} {fmtDate(c.noticeDeadline)}</Badge> : null}
              <StatusBadge value={c.status} />
              <Button size="sm" variant="ghost" onClick={() => setDocs(c)}>{t('Documents')}</Button>
              {write ? <Button size="sm" variant="ghost" onClick={() => setEdit(c)}>{t('Edit')}</Button> : null}
            </div>
          </li>
        ))}</ul>
      )}
      <Modal open={!!edit} wide title={edit?.id ? t('Edit contract') : t('Add contract')} onClose={() => setEdit(null)} footer={<Button busy={act.busy} onClick={save}>{t('Save')}</Button>}>
        {act.error ? <Alert>{act.error}</Alert> : null}
        {edit ? <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label={t('Title')}>{(id) => <Input id={id} value={edit.title ?? ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />}</Field></div>
          <div className="sm:col-span-2"><Field label={t('Parties (one per line)')}>{(id) => <Textarea id={id} value={(edit.parties ?? []).join('\n')} onChange={(e) => setEdit({ ...edit, parties: e.target.value.split('\n') })} />}</Field></div>
          <Field label={t('Value')}>{(id) => <Input id={id} inputMode="decimal" value={edit.value ?? ''} onChange={(e) => setEdit({ ...edit, value: e.target.value })} />}</Field>
          <Field label={t('Owning department')}>{(id) => <Select id={id} placeholder={t('— Select —')} value={edit.ownerDeptId ?? ''} onChange={(e) => setEdit({ ...edit, ownerDeptId: e.target.value })} options={(depts.data ?? []).map((d) => ({ value: d.id, label: d.name }))} />}</Field>
          <Field label={t('Start date')}>{(id) => <Input id={id} type="date" value={edit.startDate?.slice(0, 10) ?? ''} onChange={(e) => setEdit({ ...edit, startDate: e.target.value })} />}</Field>
          <Field label={t('End date')}>{(id) => <Input id={id} type="date" value={edit.endDate?.slice(0, 10) ?? ''} onChange={(e) => setEdit({ ...edit, endDate: e.target.value })} />}</Field>
          <Field label={t('Notice period (days)')}>{(id) => <Input id={id} type="number" value={edit.noticePeriodDays ?? ''} onChange={(e) => setEdit({ ...edit, noticePeriodDays: e.target.value as unknown as number })} />}</Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!edit.autoRenew} onChange={(e) => setEdit({ ...edit, autoRenew: e.target.checked })} />{t('Renews automatically')}</label>
          <div className="sm:col-span-2"><Field label={t('Key obligations')}>{(id) => <Textarea id={id} value={edit.keyObligations ?? ''} onChange={(e) => setEdit({ ...edit, keyObligations: e.target.value })} />}</Field></div>
          {edit.id ? <Field label={t('Status')}>{(id) => <Select id={id} value={edit.status ?? 'ACTIVE'} onChange={(e) => setEdit({ ...edit, status: e.target.value })} options={['ACTIVE', 'EXPIRED', 'TERMINATED', 'RENEWED'].map((s) => ({ value: s, label: label(s) }))} />}</Field> : null}
        </div> : null}
      </Modal>
      <Modal open={!!docs} wide title={docs?.title ?? ''} onClose={() => setDocs(null)}>{docs ? <DocumentsPanel ownerType="contract" ownerId={docs.id} canWrite={write} title={t('Signed copy and documents')} /> : null}</Modal>
    </Card>
  );
}

function Poas() {
  const { can } = useAuth();
  const { data, reload } = useApi<{ id: string; holderName: string; scope: string; issuedOn: string; expiresOn: string | null; status: string; revokedOn: string | null }[]>('/drafting/poa');
  const [edit, setEdit] = useState<{ holderName: string; scope: string; issuedOn: string; expiresOn: string } | null>(null);
  const [docs, setDocs] = useState<string | null>(null);
  const act = useAction();
  const write = can('draft:draft', 'DRF') || can('matter:write', 'DRF');
  return (
    <Card title={t('Power of Attorney register')} actions={write ? <Button size="sm" onClick={() => setEdit({ holderName: '', scope: '', issuedOn: '', expiresOn: '' })}>{t('Add')}</Button> : null}>
      {act.error ? <Alert>{act.error}</Alert> : null}
      {!data?.length ? <Empty>{t('No powers of attorney')}</Empty> : (
        <ul className="divide-y text-sm">{data.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div><div className="font-medium">{p.holderName}</div><div className="text-xs text-slate-600">{p.scope}</div></div>
            <div className="flex items-center gap-2">{fmtDate(p.issuedOn)} → {fmtDate(p.expiresOn)} <StatusBadge value={p.status} />
              <Button size="sm" variant="ghost" onClick={() => setDocs(p.id)}>{t('Documents')}</Button>
              {write && p.status === 'ACTIVE' ? <Button size="sm" variant="ghost" onClick={() => act.run(async () => { const reason = prompt(t('Reason for revocation')); if (reason) { await api.post(`/drafting/poa/${p.id}/revoke`, { reason }); await reload(); } })}>{t('Revoke')}</Button> : null}
            </div>
          </li>
        ))}</ul>
      )}
      <Modal open={!!edit} title={t('Add power of attorney')} onClose={() => setEdit(null)} footer={<Button busy={act.busy} onClick={() => act.run(async () => { await api.post('/drafting/poa', { holderName: edit!.holderName, scope: edit!.scope, issuedOn: new Date(`${edit!.issuedOn}T09:00:00+05:00`).toISOString(), expiresOn: edit!.expiresOn ? new Date(`${edit!.expiresOn}T16:00:00+05:00`).toISOString() : null }); setEdit(null); await reload(); })}>{t('Save')}</Button>}>
        {edit ? <>
          <Field label={t('Holder')}>{(id) => <Input id={id} value={edit.holderName} onChange={(e) => setEdit({ ...edit, holderName: e.target.value })} />}</Field>
          <Field label={t('Scope')}>{(id) => <Textarea id={id} value={edit.scope} onChange={(e) => setEdit({ ...edit, scope: e.target.value })} />}</Field>
          <Field label={t('Issued on')}>{(id) => <Input id={id} type="date" value={edit.issuedOn} onChange={(e) => setEdit({ ...edit, issuedOn: e.target.value })} />}</Field>
          <Field label={t('Expires on')}>{(id) => <Input id={id} type="date" value={edit.expiresOn} onChange={(e) => setEdit({ ...edit, expiresOn: e.target.value })} />}</Field>
        </> : null}
      </Modal>
      <Modal open={!!docs} wide title={t('Documents')} onClose={() => setDocs(null)}>{docs ? <DocumentsPanel ownerType="poa" ownerId={docs} canWrite={write} /> : null}</Modal>
    </Card>
  );
}

function Opinions() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const { data, reload } = useApi<{ id: string; title: string; question: string; summary: string; tags: string[]; issuedOn: string; matter: { id: string; reference: string } | null }[]>(`/drafting/opinions?q=${encodeURIComponent(q)}`, [q]);
  const [edit, setEdit] = useState<{ title: string; question: string; summary: string; tags: string; issuedOn: string } | null>(null);
  const act = useAction();
  return (
    <Card title={t('Legal opinions archive')} actions={<>
      <Input aria-label={t('Search opinions')} className="w-64" placeholder={t('Search the text of past opinions')} value={q} onChange={(e) => setQ(e.target.value)} />
      {can('draft:draft', 'DRF') ? <Button size="sm" onClick={() => setEdit({ title: '', question: '', summary: '', tags: '', issuedOn: new Date().toISOString().slice(0, 10) })}>{t('Add opinion')}</Button> : null}
    </>}>
      {act.error ? <Alert>{act.error}</Alert> : null}
      {!data?.length ? <Empty>{t('No opinions found')}</Empty> : <ul className="space-y-3">{data.map((o) => (
        <li key={o.id} className="rounded border p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{o.title}</span><span className="text-xs text-slate-500">{fmtDate(o.issuedOn)} {o.matter ? <Link className="underline" href={`/drafting/${o.matter.id}`}>{o.matter.reference}</Link> : null}</span></div>
          <p className="mt-1 text-slate-600"><strong>{t('Question')}:</strong> {o.question}</p>
          <p className="mt-1 whitespace-pre-wrap">{o.summary}</p>
          <div className="mt-1 flex gap-1">{o.tags.map((x) => <Badge key={x}>{x}</Badge>)}</div>
        </li>
      ))}</ul>}
      <Modal open={!!edit} wide title={t('Add legal opinion')} onClose={() => setEdit(null)} footer={<Button busy={act.busy} onClick={() => act.run(async () => { await api.post('/drafting/opinions', { title: edit!.title, question: edit!.question, summary: edit!.summary, tags: edit!.tags.split(',').map((s) => s.trim()).filter(Boolean), issuedOn: new Date(`${edit!.issuedOn}T09:00:00+05:00`).toISOString() }); setEdit(null); await reload(); })}>{t('Save')}</Button>}>
        {edit ? <>
          <Field label={t('Title')}>{(id) => <Input id={id} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />}</Field>
          <Field label={t('Question asked')}>{(id) => <Textarea id={id} value={edit.question} onChange={(e) => setEdit({ ...edit, question: e.target.value })} />}</Field>
          <Field label={t('Opinion summary')}>{(id) => <Textarea id={id} rows={6} value={edit.summary} onChange={(e) => setEdit({ ...edit, summary: e.target.value })} />}</Field>
          <Field label={t('Tags (comma-separated)')}>{(id) => <Input id={id} value={edit.tags} onChange={(e) => setEdit({ ...edit, tags: e.target.value })} />}</Field>
          <Field label={t('Issued on')}>{(id) => <Input id={id} type="date" value={edit.issuedOn} onChange={(e) => setEdit({ ...edit, issuedOn: e.target.value })} />}</Field>
        </> : null}
      </Modal>
    </Card>
  );
}

function Library() {
  const { can, me } = useAuth();
  const templates = useApi<{ id: string; name: string; category: string; status: string; body: string | null }[]>('/drafting/templates');
  const clauses = useApi<{ id: string; title: string; body: string; tags: string[]; status: string }[]>('/drafting/clauses');
  const [tpl, setTpl] = useState<{ id?: string; name: string; category: string; body: string; status: string } | null>(null);
  const [cl, setCl] = useState<{ id?: string; title: string; body: string; tags: string; status: string } | null>(null);
  const [copied, setCopied] = useState('');
  const act = useAction();
  const lib = can('draft:library', 'DRF');
  const approver = !!me?.roles.some((r) => r.role === 'HOD' || (r.role === 'UNIT_HEAD' && r.unit === 'DRF'));
  const statusOptions = (approver ? ['DRAFT', 'APPROVED', 'RETIRED'] : ['DRAFT']).map((s) => ({ value: s, label: label(s) }));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={t('Templates')} actions={lib ? <Button size="sm" onClick={() => setTpl({ name: '', category: '', body: '', status: 'DRAFT' })}>{t('Add')}</Button> : null}>
        {act.error ? <Alert>{act.error}</Alert> : null}
        <ul className="divide-y text-sm">{templates.data?.map((x) => <li key={x.id} className="flex items-center justify-between gap-2 py-2"><span>{x.name} <span className="text-xs text-slate-500">· {x.category}</span></span><span className="flex items-center gap-1"><StatusBadge value={x.status} />{lib ? <Button size="sm" variant="ghost" onClick={() => setTpl({ id: x.id, name: x.name, category: x.category, body: x.body ?? '', status: x.status })}>{t('Edit')}</Button> : null}</span></li>)}</ul>
        <div className="mt-3"><DocumentsPanel ownerType="library" ownerId="TEMPLATE" canWrite={lib} title={t('Template files (Word)')} /></div>
      </Card>
      <Card title={t('Standard clauses')} actions={lib ? <Button size="sm" onClick={() => setCl({ title: '', body: '', tags: '', status: 'DRAFT' })}>{t('Add')}</Button> : null}>
        <ul className="space-y-2 text-sm">{clauses.data?.map((c) => (
          <li key={c.id} className="rounded border p-2">
            <div className="flex items-center justify-between gap-2"><span className="font-medium">{c.title}</span><span className="flex items-center gap-1"><StatusBadge value={c.status} />
              <Button size="sm" variant="ghost" onClick={async () => { await navigator.clipboard.writeText(c.body); setCopied(c.id); setTimeout(() => setCopied(''), 1500); }}>{copied === c.id ? t('Copied') : t('Copy')}</Button>
              {lib ? <Button size="sm" variant="ghost" onClick={() => setCl({ id: c.id, title: c.title, body: c.body, tags: c.tags.join(', '), status: c.status })}>{t('Edit')}</Button> : null}</span></div>
            <p className="mt-1 whitespace-pre-wrap text-slate-700">{c.body}</p>
          </li>
        ))}</ul>
      </Card>
      <Modal open={!!tpl} wide title={t('Template')} onClose={() => setTpl(null)} footer={<Button busy={act.busy} onClick={() => act.run(async () => { const b = { name: tpl!.name, category: tpl!.category, body: tpl!.body || null, status: tpl!.status }; if (tpl!.id) await api.patch(`/drafting/templates/${tpl!.id}`, b); else await api.post('/drafting/templates', b); setTpl(null); await templates.reload(); })}>{t('Save')}</Button>}>
        {tpl ? <>
          <Field label={t('Name')}>{(id) => <Input id={id} value={tpl.name} onChange={(e) => setTpl({ ...tpl, name: e.target.value })} />}</Field>
          <Field label={t('Category')}>{(id) => <Input id={id} value={tpl.category} onChange={(e) => setTpl({ ...tpl, category: e.target.value })} />}</Field>
          <Field label={t('Text')}>{(id) => <Textarea id={id} rows={10} value={tpl.body} onChange={(e) => setTpl({ ...tpl, body: e.target.value })} />}</Field>
          <Field label={t('Status')}>{(id) => <Select id={id} value={tpl.status} onChange={(e) => setTpl({ ...tpl, status: e.target.value })} options={statusOptions} />}</Field>
        </> : null}
      </Modal>
      <Modal open={!!cl} wide title={t('Clause')} onClose={() => setCl(null)} footer={<Button busy={act.busy} onClick={() => act.run(async () => { const b = { title: cl!.title, body: cl!.body, tags: cl!.tags.split(',').map((s) => s.trim()).filter(Boolean), status: cl!.status }; if (cl!.id) await api.patch(`/drafting/clauses/${cl!.id}`, b); else await api.post('/drafting/clauses', b); setCl(null); await clauses.reload(); })}>{t('Save')}</Button>}>
        {cl ? <>
          <Field label={t('Title')}>{(id) => <Input id={id} value={cl.title} onChange={(e) => setCl({ ...cl, title: e.target.value })} />}</Field>
          <Field label={t('Clause text')}>{(id) => <Textarea id={id} rows={8} value={cl.body} onChange={(e) => setCl({ ...cl, body: e.target.value })} />}</Field>
          <Field label={t('Tags')}>{(id) => <Input id={id} value={cl.tags} onChange={(e) => setCl({ ...cl, tags: e.target.value })} />}</Field>
          <Field label={t('Status')}>{(id) => <Select id={id} value={cl.status} onChange={(e) => setCl({ ...cl, status: e.target.value })} options={statusOptions} />}</Field>
        </> : null}
      </Modal>
    </div>
  );
}
