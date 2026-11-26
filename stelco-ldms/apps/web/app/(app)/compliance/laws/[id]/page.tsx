'use client';
import { use, useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useAction } from '@/lib/hooks';
import { fmtDate, label } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { DocumentsPanel, UserSelect, useDirectory } from '@/components/parts';
import { Alert, Badge, Button, Card, DL, Empty, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge, Textarea } from '@/components/ui';

interface Law { id: string; title: string; type: string; status: string; issuedOn: string | null; effectiveOn: string | null; sourceUrl: string | null; summary: string | null; officerId: string | null; regulatorId: string | null; regulator: { name: string } | null;
  researchStatus: string | null; researchAssigneeId: string | null; researchAssignedById: string | null; researchAssignedAt: string | null; researchDueAt: string | null; researchNote: string | null; researchFindings: string | null; researchCompletedAt: string | null; versions: { id: string; versionNo: number; notes: string | null; createdAt: string }[]; obligations: { id: string; description: string; article: string | null; frequency: string; risk: string; departmentIds: string[]; evidenceRequired: string | null; penalty: string | null; active: boolean }[] }

export default function LawPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can, me } = useAuth();
  const { data: l, reload, error } = useApi<Law>(`/compliance/laws/${id}`);
  const regs = useApi<{ id: string; name: string }[]>('/config/regulators');
  const dir = useDirectory('CMP');
  const depts = useApi<{ id: string; name: string }[]>('/config/departments');
  const [ob, setOb] = useState<{ id?: string; description: string; article: string; frequency: string; risk: string; evidenceRequired: string; penalty: string; departmentIds: string[] } | null>(null);
  const [lawEdit, setLawEdit] = useState<Record<string, string> | null>(null);
  const [research, setResearch] = useState<Record<string, string> | null>(null);
  const [findings, setFindings] = useState<string | null>(null);
  const [ver, setVer] = useState<{ notes: string; status: string } | null>(null);
  const [officer, setOfficer] = useState('');
  const act = useAction();
  if (error) return <Alert>{error.message}</Alert>;
  if (!l) return <Spinner />;
  const staff = can('cmp:write', 'CMP');
  const name = (d: string) => depts.data?.find((x) => x.id === d)?.name ?? d;
  const person = (uid: string | null) => dir.data?.find((u) => u.id === uid)?.displayName ?? '—';
  const manager = !!me?.roles.some((r) => r.role === 'HOD' || (r.role === 'UNIT_HEAD' && r.unit === 'CMP'));
  const researcher = !!me && (me.id === l.researchAssigneeId || manager);
  const day = (d: string | null) => (d ? new Date(new Date(d).getTime() + 5 * 3600_000).toISOString().slice(0, 10) : '');
  const iso = (s?: string) => (s ? new Date(`${s}T00:00:00+05:00`).toISOString() : null);
  return (
    <div className="space-y-4">
      <PageHeader title={l.title} subtitle={<><Badge>{label(l.type)}</Badge> {l.regulator?.name ?? ''} <StatusBadge value={l.status} /></>}
        actions={staff ? <><Button variant="ghost" onClick={() => setLawEdit({ title: l.title, type: l.type, regulatorId: l.regulatorId ?? '', issuedOn: day(l.issuedOn), effectiveOn: day(l.effectiveOn), sourceUrl: l.sourceUrl ?? '', summary: l.summary ?? '', status: l.status })}>{t('Edit')}</Button><Button variant="secondary" onClick={() => setVer({ notes: '', status: 'AMENDED' })}>{t('Record amendment')}</Button><Button onClick={() => setOb({ description: '', article: '', frequency: 'ANNUAL', risk: 'MEDIUM', evidenceRequired: '', penalty: '', departmentIds: [] })}>{t('Add obligation')}</Button></> : null} />
      {act.error ? <Alert>{act.error}</Alert> : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={t('Details')}>
            <DL items={[[t('Issued'), fmtDate(l.issuedOn)], [t('Effective'), fmtDate(l.effectiveOn)], [t('Source'), l.sourceUrl ? <a key="s" className="underline" href={l.sourceUrl} target="_blank" rel="noopener noreferrer">{l.sourceUrl}</a> : '—']]} />
            {l.summary ? <p className="mt-3 whitespace-pre-wrap text-sm">{l.summary}</p> : null}
            {staff ? <div className="mt-3 flex items-end gap-2"><div className="flex-1"><UserSelect unit="CMP" labelText={t('Responsible compliance officer')} value={officer || l.officerId || ''} onChange={setOfficer} /></div><Button size="sm" variant="secondary" disabled={!officer} onClick={() => act.run(async () => { await api.patch(`/compliance/laws/${id}`, { title: l.title, type: l.type, officerId: officer }); await reload(); })}>{t('Assign')}</Button></div> : null}
          </Card>
          <Card title={t('Research')} actions={manager ? <Button size="sm" variant="secondary" onClick={() => setResearch({ assigneeId: l.researchAssigneeId ?? '', dueAt: day(l.researchDueAt), note: l.researchNote ?? '' })}>{l.researchStatus ? t('Reassign') : t('Assign research')}</Button> : null}>
            {!l.researchStatus ? <p className="text-sm text-slate-600">{t('No research assigned. The HoD or Unit Head assigns a lawyer to study this law, identify the obligations and the departments they apply to.')}</p> : (
              <div className="space-y-2 text-sm" data-testid="law-research">
                <div className="flex flex-wrap items-center gap-2"><StatusBadge value={l.researchStatus} />{l.researchStatus !== 'COMPLETED' && l.researchDueAt && new Date(l.researchDueAt) < new Date() ? <Badge tone="red">{t('Overdue')}</Badge> : null}</div>
                <DL items={[[t('Lawyer'), person(l.researchAssigneeId)], [t('Assigned by'), person(l.researchAssignedById)], [t('Assigned on'), fmtDate(l.researchAssignedAt)], [t('Due'), fmtDate(l.researchDueAt)], [t('Completed'), fmtDate(l.researchCompletedAt)]]} />
                {l.researchNote ? <p className="whitespace-pre-wrap"><strong>{t('Instructions')}:</strong> {l.researchNote}</p> : null}
                {l.researchFindings ? <div><div className="text-xs font-semibold text-slate-500">{t('Findings')}</div><p className="whitespace-pre-wrap">{l.researchFindings}</p></div> : null}
                {researcher && l.researchStatus !== 'COMPLETED' ? <div className="flex flex-wrap gap-2">
                  {l.researchStatus === 'ASSIGNED' ? <Button size="sm" variant="secondary" busy={act.busy} onClick={() => act.run(async () => { await api.post(`/compliance/laws/${id}/research/progress`, { status: 'IN_PROGRESS' }); await reload(); })}>{t('Start research')}</Button> : null}
                  <Button size="sm" onClick={() => setFindings(l.researchFindings ?? '')}>{t('Write findings / complete')}</Button>
                </div> : null}
                {researcher && l.researchStatus !== 'COMPLETED' ? <p className="text-xs text-slate-500">{t('Add each obligation below with the departments it applies to, then send them a circular from the Circulars tab.')}</p> : null}
              </div>
            )}
          </Card>
          <Card title={t('Obligations')}>
            {!l.obligations.length ? <Empty>{t('Break this law into specific obligations.')}</Empty> : <ul className="divide-y text-sm">{l.obligations.map((o) => (
              <li key={o.id} className="py-2"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{o.description}</span><span className="flex gap-1"><StatusBadge value={o.risk} /><Badge>{label(o.frequency)}</Badge>{!o.active ? <Badge>{t('Inactive')}</Badge> : null}{staff ? <Button size="sm" variant="ghost" onClick={() => setOb({ id: o.id, description: o.description, article: o.article ?? '', frequency: o.frequency, risk: o.risk, evidenceRequired: o.evidenceRequired ?? '', penalty: o.penalty ?? '', departmentIds: o.departmentIds })}>{t('Edit')}</Button> : null}</span></div>
                <div className="text-xs text-slate-500">{o.article ?? ''} · {o.departmentIds.map(name).join(', ')}</div></li>
            ))}</ul>}
          </Card>
        </div>
        <div className="space-y-4">
          <DocumentsPanel ownerType="law" ownerId={id} canWrite={staff} title={t('Text of the law')} />
          <Card title={t('Version history')}><ul className="space-y-1 text-sm">{l.versions.map((v) => <li key={v.id}><strong>v{v.versionNo}</strong> · {fmtDate(v.createdAt)} · {v.notes}</li>)}</ul></Card>
        </div>
      </div>
      <Modal open={!!ob} wide title={ob?.id ? t('Edit obligation') : t('Add obligation')} onClose={() => setOb(null)} footer={<Button busy={act.busy} disabled={!ob?.departmentIds.length} onClick={() => act.run(async () => {
        const body = { lawId: id, description: ob!.description, article: ob!.article || null, frequency: ob!.frequency, risk: ob!.risk, evidenceRequired: ob!.evidenceRequired || null, penalty: ob!.penalty || null, departmentIds: ob!.departmentIds };
        if (ob!.id) await api.patch(`/compliance/obligations/${ob!.id}`, body); else await api.post('/compliance/obligations', body);
        setOb(null); await reload();
      })}>{t('Save')}</Button>}>
        {act.error ? <Alert>{act.error}</Alert> : null}
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
      <Modal open={!!lawEdit} wide title={t('Edit law or regulation')} onClose={() => setLawEdit(null)} footer={<Button busy={act.busy} onClick={() => act.run(async () => {
        await api.patch(`/compliance/laws/${id}`, { title: lawEdit!.title, type: lawEdit!.type, regulatorId: lawEdit!.regulatorId || null, issuedOn: iso(lawEdit!.issuedOn), effectiveOn: iso(lawEdit!.effectiveOn), sourceUrl: lawEdit!.sourceUrl || null, summary: lawEdit!.summary || null, status: lawEdit!.status, officerId: l.officerId });
        setLawEdit(null); await reload();
      })}>{t('Save')}</Button>}>
        {act.error ? <Alert>{act.error}</Alert> : null}
        {lawEdit ? <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label={t('Title')}>{(fid) => <Input id={fid} value={lawEdit.title} onChange={(e) => setLawEdit({ ...lawEdit, title: e.target.value })} />}</Field></div>
          <Field label={t('Type')}>{(fid) => <Select id={fid} value={lawEdit.type} onChange={(e) => setLawEdit({ ...lawEdit, type: e.target.value })} options={['ACT', 'REGULATION', 'CIRCULAR', 'GUIDELINE', 'DIRECTIVE'].map((x) => ({ value: x, label: label(x) }))} />}</Field>
          <Field label={t('Regulator')}>{(fid) => <Select id={fid} placeholder={t('— Select —')} value={lawEdit.regulatorId} onChange={(e) => setLawEdit({ ...lawEdit, regulatorId: e.target.value })} options={(regs.data ?? []).map((r) => ({ value: r.id, label: r.name }))} />}</Field>
          <Field label={t('Issued')}>{(fid) => <Input id={fid} type="date" value={lawEdit.issuedOn} onChange={(e) => setLawEdit({ ...lawEdit, issuedOn: e.target.value })} />}</Field>
          <Field label={t('Effective date')}>{(fid) => <Input id={fid} type="date" value={lawEdit.effectiveOn} onChange={(e) => setLawEdit({ ...lawEdit, effectiveOn: e.target.value })} />}</Field>
          <Field label={t('Status')}>{(fid) => <Select id={fid} value={lawEdit.status} onChange={(e) => setLawEdit({ ...lawEdit, status: e.target.value })} options={['IN_FORCE', 'AMENDED', 'REPEALED'].map((x) => ({ value: x, label: label(x) }))} />}</Field>
          <Field label={t('Source link')}>{(fid) => <Input id={fid} type="url" value={lawEdit.sourceUrl} onChange={(e) => setLawEdit({ ...lawEdit, sourceUrl: e.target.value })} />}</Field>
          <div className="sm:col-span-2"><Field label={t('Summary')}>{(fid) => <Textarea id={fid} rows={6} value={lawEdit.summary} onChange={(e) => setLawEdit({ ...lawEdit, summary: e.target.value })} />}</Field></div>
        </div> : null}
      </Modal>
      <Modal open={!!research} title={t('Assign research')} onClose={() => setResearch(null)} footer={<Button busy={act.busy} disabled={!research?.assigneeId} onClick={() => act.run(async () => { await api.post(`/compliance/laws/${id}/research`, { assigneeId: research!.assigneeId, dueAt: iso(research!.dueAt), note: research!.note || null }); setResearch(null); await reload(); })}>{t('Assign')}</Button>}>
        {act.error ? <Alert>{act.error}</Alert> : null}
        {research ? <>
          <UserSelect unit="CMP" labelText={t('Lawyer')} value={research.assigneeId} onChange={(v) => setResearch({ ...research, assigneeId: v })} />
          <Field label={t('Due date')}>{(fid) => <Input id={fid} type="date" value={research.dueAt} onChange={(e) => setResearch({ ...research, dueAt: e.target.value })} />}</Field>
          <Field label={t('Instructions')}>{(fid) => <Textarea id={fid} value={research.note} onChange={(e) => setResearch({ ...research, note: e.target.value })} />}</Field>
        </> : null}
      </Modal>
      <Modal open={findings !== null} wide title={t('Research findings')} onClose={() => setFindings(null)} footer={<>
        <Button variant="secondary" busy={act.busy} onClick={() => act.run(async () => { await api.post(`/compliance/laws/${id}/research/progress`, { status: 'IN_PROGRESS', findings: findings || null }); setFindings(null); await reload(); })}>{t('Save draft')}</Button>
        <Button busy={act.busy} onClick={() => act.run(async () => { await api.post(`/compliance/laws/${id}/research/progress`, { status: 'COMPLETED', findings: findings || null }); setFindings(null); await reload(); })}>{t('Complete research')}</Button>
      </>}>
        {act.error ? <Alert>{act.error}</Alert> : null}
        <Field label={t('Findings')} hint={t('What the law requires, who it affects, and anything the departments must do. To complete, add the obligations on this page (or write "no obligations").')}>{(fid) => <Textarea id={fid} rows={10} value={findings ?? ''} onChange={(e) => setFindings(e.target.value)} />}</Field>
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
