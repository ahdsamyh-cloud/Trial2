'use client';
import { use, useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useAction } from '@/lib/hooks';
import { fmtDate, label } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { DocumentsPanel, UserSelect } from '@/components/parts';
import { Alert, Badge, Button, Card, DL, Empty, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge, Textarea } from '@/components/ui';

interface Law { id: string; title: string; type: string; status: string; issuedOn: string | null; effectiveOn: string | null; sourceUrl: string | null; summary: string | null; officerId: string | null; regulator: { name: string } | null; versions: { id: string; versionNo: number; notes: string | null; createdAt: string }[]; obligations: { id: string; description: string; article: string | null; frequency: string; risk: string; departmentIds: string[] }[] }

export default function LawPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const { data: l, reload, error } = useApi<Law>(`/compliance/laws/${id}`);
  const depts = useApi<{ id: string; name: string }[]>('/config/departments');
  const [ob, setOb] = useState<{ description: string; article: string; frequency: string; risk: string; evidenceRequired: string; penalty: string; departmentIds: string[] } | null>(null);
  const [ver, setVer] = useState<{ notes: string; status: string } | null>(null);
  const [officer, setOfficer] = useState('');
  const act = useAction();
  if (error) return <Alert>{error.message}</Alert>;
  if (!l) return <Spinner />;
  const staff = can('cmp:write', 'CMP');
  const name = (d: string) => depts.data?.find((x) => x.id === d)?.name ?? d;
  return (
    <div className="space-y-4">
      <PageHeader title={l.title} subtitle={<><Badge>{label(l.type)}</Badge> {l.regulator?.name ?? ''} <StatusBadge value={l.status} /></>}
        actions={staff ? <><Button variant="secondary" onClick={() => setVer({ notes: '', status: 'AMENDED' })}>{t('Record amendment')}</Button><Button onClick={() => setOb({ description: '', article: '', frequency: 'ANNUAL', risk: 'MEDIUM', evidenceRequired: '', penalty: '', departmentIds: [] })}>{t('Add obligation')}</Button></> : null} />
      {act.error ? <Alert>{act.error}</Alert> : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={t('Details')}>
            <DL items={[[t('Issued'), fmtDate(l.issuedOn)], [t('Effective'), fmtDate(l.effectiveOn)], [t('Source'), l.sourceUrl ? <a key="s" className="underline" href={l.sourceUrl} target="_blank" rel="noopener noreferrer">{l.sourceUrl}</a> : '—']]} />
            {l.summary ? <p className="mt-3 whitespace-pre-wrap text-sm">{l.summary}</p> : null}
            {staff ? <div className="mt-3 flex items-end gap-2"><div className="flex-1"><UserSelect unit="CMP" labelText={t('Responsible compliance officer')} value={officer || l.officerId || ''} onChange={setOfficer} /></div><Button size="sm" variant="secondary" disabled={!officer} onClick={() => act.run(async () => { await api.patch(`/compliance/laws/${id}`, { title: l.title, type: l.type, officerId: officer }); await reload(); })}>{t('Assign')}</Button></div> : null}
          </Card>
          <Card title={t('Obligations')}>
            {!l.obligations.length ? <Empty>{t('Break this law into specific obligations.')}</Empty> : <ul className="divide-y text-sm">{l.obligations.map((o) => (
              <li key={o.id} className="py-2"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{o.description}</span><span className="flex gap-1"><StatusBadge value={o.risk} /><Badge>{label(o.frequency)}</Badge></span></div>
                <div className="text-xs text-slate-500">{o.article ?? ''} · {o.departmentIds.map(name).join(', ')}</div></li>
            ))}</ul>}
          </Card>
        </div>
        <div className="space-y-4">
          <DocumentsPanel ownerType="law" ownerId={id} canWrite={staff} title={t('Text of the law')} />
          <Card title={t('Version history')}><ul className="space-y-1 text-sm">{l.versions.map((v) => <li key={v.id}><strong>v{v.versionNo}</strong> · {fmtDate(v.createdAt)} · {v.notes}</li>)}</ul></Card>
        </div>
      </div>
      <Modal open={!!ob} wide title={t('Add obligation')} onClose={() => setOb(null)} footer={<Button busy={act.busy} disabled={!ob?.departmentIds.length} onClick={() => act.run(async () => { await api.post('/compliance/obligations', { lawId: id, description: ob!.description, article: ob!.article || null, frequency: ob!.frequency, risk: ob!.risk, evidenceRequired: ob!.evidenceRequired || null, penalty: ob!.penalty || null, departmentIds: ob!.departmentIds }); setOb(null); await reload(); })}>{t('Save')}</Button>}>
        {ob ? <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label={t('Obligation')}>{(fid) => <Textarea id={fid} value={ob.description} onChange={(e) => setOb({ ...ob, description: e.target.value })} />}</Field></div>
          <Field label={t('Article / section')}>{(fid) => <Input id={fid} value={ob.article} onChange={(e) => setOb({ ...ob, article: e.target.value })} />}</Field>
          <Field label={t('Check frequency')}>{(fid) => <Select id={fid} value={ob.frequency} onChange={(e) => setOb({ ...ob, frequency: e.target.value })} options={['ONE_OFF', 'MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL'].map((x) => ({ value: x, label: label(x) }))} />}</Field>
          <Field label={t('Risk rating')}>{(fid) => <Select id={fid} value={ob.risk} onChange={(e) => setOb({ ...ob, risk: e.target.value })} options={['HIGH', 'MEDIUM', 'LOW'].map((x) => ({ value: x, label: label(x) }))} />}</Field>
          <Field label={t('Evidence required')}>{(fid) => <Input id={fid} value={ob.evidenceRequired} onChange={(e) => setOb({ ...ob, evidenceRequired: e.target.value })} />}</Field>
          <div className="sm:col-span-2"><Field label={t('Penalty for non-compliance')}>{(fid) => <Input id={fid} value={ob.penalty} onChange={(e) => setOb({ ...ob, penalty: e.target.value })} />}</Field></div>
          <fieldset className="sm:col-span-2"><legend className="mb-1 text-sm font-medium">{t('Responsible departments')}</legend>
            <div className="grid max-h-48 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">{depts.data?.map((d) => <label key={d.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ob.departmentIds.includes(d.id)} onChange={(e) => setOb({ ...ob, departmentIds: e.target.checked ? [...ob.departmentIds, d.id] : ob.departmentIds.filter((x) => x !== d.id) })} />{d.name}</label>)}</div>
          </fieldset>
        </div> : null}
      </Modal>
      <Modal open={!!ver} title={t('Record amendment or repeal')} onClose={() => setVer(null)} footer={<Button busy={act.busy} onClick={() => act.run(async () => { await api.post(`/compliance/laws/${id}/versions`, ver); setVer(null); await reload(); })}>{t('Save')}</Button>}>
        {ver ? <>
          <Field label={t('What changed')}>{(fid) => <Textarea id={fid} value={ver.notes} onChange={(e) => setVer({ ...ver, notes: e.target.value })} />}</Field>
          <Field label={t('New status')}>{(fid) => <Select id={fid} value={ver.status} onChange={(e) => setVer({ ...ver, status: e.target.value })} options={['AMENDED', 'REPEALED', 'IN_FORCE'].map((x) => ({ value: x, label: label(x) }))} />}</Field>
          <p className="text-xs text-slate-500">{t('An entry is added to the regulatory change log for impact assessment.')}</p>
        </> : null}
      </Modal>
    </div>
  );
}
