'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, download } from '@/lib/api';
import { useApi, useAction } from '@/lib/hooks';
import { fmtDate, label } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { HeatMap } from '@/components/heatmap';
import { UserSelect } from '@/components/parts';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Stat, StatusBadge, Tabs, Textarea } from '@/components/ui';

type Dept = { id: string; name: string };

export default function Compliance() {
  const { can } = useAuth();
  const staff = can('matter:read', 'CMP') || can('cmp:write', 'CMP') || can('dashboard:hod');
  const [tab, setTab] = useState(staff ? 'dashboard' : 'mine');
  const tabs = staff
    ? [{ id: 'dashboard', label: t('Dashboard') }, { id: 'research', label: t('Research') }, { id: 'laws', label: t('Laws & regulations') }, { id: 'obligations', label: t('Obligations') }, { id: 'circulars', label: t('Circulars') }, { id: 'checks', label: t('Department confirmations') }, { id: 'report', label: t('Department report') }, { id: 'licences', label: t('Licences & filings') }, { id: 'changes', label: t('Change log') }]
    : [{ id: 'mine', label: t('My department') }, { id: 'laws', label: t('Laws & regulations') }];
  return (
    <div>
      <PageHeader title={t('Compliance')} subtitle={staff ? t('Research of laws, obligations by department, circulars and yearly department confirmations.') : t('Circulars to acknowledge and obligations to confirm (yes / no).')} />
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === 'dashboard' ? <Dashboard /> : tab === 'research' ? <Research /> : tab === 'laws' ? <Laws /> : tab === 'obligations' ? <Obligations /> : tab === 'circulars' ? <Circulars /> : tab === 'checks' ? <Checks /> : tab === 'report' ? <DeptReport /> : tab === 'findings' ? <Findings /> : tab === 'licences' ? <Licences /> : tab === 'changes' ? <Changes /> : <MyDepartment />}
    </div>
  );
}

function Dashboard() {
  const { data } = useApi<{ heat: { departmentId: string; department: string; lawId: string; law: string; score: number | null }[]; trend: { month: string; score: number | null }[]; overallScore: number | null; overdueChecks: number; pendingAcks: number; notComplied: number; unanswered: number; researchOpen: number }>('/compliance/dashboard');
  if (!data) return null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label={t('Obligations confirmed')} value={data.overallScore === null ? '—' : `${data.overallScore}%`} tone={data.overallScore !== null && data.overallScore < 60 ? 'red' : 'green'} />
        <Stat label={t('Answered "No"')} value={data.notComplied} tone={data.notComplied ? 'red' : undefined} />
        <Stat label={t('Not answered yet')} value={data.unanswered} tone={data.unanswered ? 'amber' : undefined} />
        <Stat label={t('Circulars not acknowledged')} value={data.pendingAcks} tone={data.pendingAcks ? 'amber' : undefined} />
        <Stat label={t('Research in progress')} value={data.researchOpen} />
      </div>
      <Card title={t('Heat map: department × law (share of obligations confirmed)')}><HeatMap cells={data.heat} /></Card>
      <Card title={t('Compliance score trend')}>
        {!data.trend.length ? <Empty>{t('No data yet')}</Empty> : <ul className="flex flex-wrap gap-3 text-sm">{data.trend.map((p) => <li key={p.month} className="rounded border px-2 py-1"><span className="text-slate-500">{p.month}</span> <strong>{p.score ?? '—'}%</strong></li>)}</ul>}
      </Card>
    </div>
  );
}

function Laws() {
  const { can } = useAuth();
  const manager = useCmpManager();
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const { data, reload } = useApi<{ id: string; title: string; type: string; status: string; effectiveOn: string | null; regulator: { name: string } | null; _count: { obligations: number } }[]>(`/compliance/laws?q=${encodeURIComponent(q)}`, [q]);
  const regs = useApi<{ id: string; name: string }[]>('/config/regulators');
  const [edit, setEdit] = useState<Record<string, string> | null>(null);
  const act = useAction();
  return (
    <Card title={t('Laws and regulations register')} actions={<>
      <Input aria-label={t('Search')} className="w-56" placeholder={t('Search')} value={q} onChange={(e) => setQ(e.target.value)} />
      {can('cmp:write', 'CMP') ? <Button size="sm" onClick={() => setEdit({ title: '', type: 'ACT', regulatorId: '', effectiveOn: '', sourceUrl: '', summary: '' })}>{t('Add law')}</Button> : null}
    </>}>
      {act.error ? <Alert>{act.error}</Alert> : null}
      {!data?.length ? <Empty>{t('No laws registered')}</Empty> : <ul className="divide-y">{data.map((l) => (
        <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
          <Link href={`/compliance/laws/${l.id}`} className="font-medium hover:underline">{l.title}</Link>
          <span className="flex items-center gap-2 text-xs"><Badge>{label(l.type)}</Badge>{l.regulator?.name ?? ''} · {t('effective')} {fmtDate(l.effectiveOn)} · {t('{n} obligations', { n: l._count.obligations })}<StatusBadge value={l.status} />
            {manager ? <Button size="sm" variant="ghost" onClick={() => setAssignFor(l.id)}>{t('Assign research')}</Button> : null}</span>
        </li>
      ))}</ul>}
      <AssignResearch open={!!assignFor} lawId={assignFor ?? undefined} onClose={() => setAssignFor(null)} onDone={() => void reload()} />
      <Modal open={!!edit} wide title={t('Add law or regulation')} onClose={() => setEdit(null)} footer={<Button busy={act.busy} onClick={() => act.run(async () => {
        const law = await api.post<{ id: string }>('/compliance/laws', { title: edit!.title, type: edit!.type, regulatorId: edit!.regulatorId || null, effectiveOn: edit!.effectiveOn ? new Date(`${edit!.effectiveOn}T00:00:00+05:00`).toISOString() : null, sourceUrl: edit!.sourceUrl || null, summary: edit!.summary || null });
        if (edit!.researcherId) await api.post(`/compliance/laws/${law.id}/research`, { assigneeId: edit!.researcherId, dueAt: edit!.researchDue ? new Date(`${edit!.researchDue}T16:00:00+05:00`).toISOString() : null });
        setEdit(null); await reload();
      })}>{t('Save')}</Button>}>
        {edit ? <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label={t('Title')}>{(id) => <Input id={id} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />}</Field></div>
          <Field label={t('Type')}>{(id) => <Select id={id} value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })} options={['ACT', 'REGULATION', 'CIRCULAR', 'GUIDELINE', 'DIRECTIVE'].map((x) => ({ value: x, label: label(x) }))} />}</Field>
          <Field label={t('Regulator')}>{(id) => <Select id={id} placeholder={t('— Select —')} value={edit.regulatorId} onChange={(e) => setEdit({ ...edit, regulatorId: e.target.value })} options={(regs.data ?? []).map((r) => ({ value: r.id, label: r.name }))} />}</Field>
          <Field label={t('Effective date')}>{(id) => <Input id={id} type="date" value={edit.effectiveOn} onChange={(e) => setEdit({ ...edit, effectiveOn: e.target.value })} />}</Field>
          <Field label={t('Source link')}>{(id) => <Input id={id} type="url" value={edit.sourceUrl} onChange={(e) => setEdit({ ...edit, sourceUrl: e.target.value })} />}</Field>
          <div className="sm:col-span-2"><Field label={t('Summary')}>{(id) => <Textarea id={id} value={edit.summary} onChange={(e) => setEdit({ ...edit, summary: e.target.value })} />}</Field></div>
          {manager ? <>
            <UserSelect unit="CMP" labelText={t('Assign research to (optional)')} value={edit.researcherId ?? ''} onChange={(v) => setEdit({ ...edit, researcherId: v })} />
            <Field label={t('Research due date')}>{(id) => <Input id={id} type="date" value={edit.researchDue ?? ''} onChange={(e) => setEdit({ ...edit, researchDue: e.target.value })} />}</Field>
          </> : null}
        </div> : null}
      </Modal>
    </Card>
  );
}

function Obligations() {
  const { data } = useApi<{ id: string; description: string; article: string | null; frequency: string; risk: string; departmentIds: string[]; nextCheckAt: string | null; law: { id: string; title: string } }[]>('/compliance/obligations');
  const depts = useApi<Dept[]>('/config/departments');
  const name = (id: string) => depts.data?.find((d) => d.id === id)?.name ?? id;
  return (
    <Card title={t('Obligation library')}>
      {!data?.length ? <Empty>{t('No obligations yet — add them from a law’s page.')}</Empty> : <ul className="divide-y text-sm">{data.map((o) => (
        <li key={o.id} className="py-2">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{o.description}</span><span className="flex gap-1"><StatusBadge value={o.risk} /><Badge>{label(o.frequency)}</Badge></span></div>
          <div className="text-xs text-slate-500"><Link className="underline" href={`/compliance/laws/${o.law.id}`}>{o.law.title}</Link>{o.article ? ` · ${o.article}` : ''} · {o.departmentIds.map(name).join(', ')} · {t('next check')} {fmtDate(o.nextCheckAt)}</div>
        </li>
      ))}</ul>}
    </Card>
  );
}

function Circulars() {
  const { can } = useAuth();
  const { data, reload } = useApi<{ id: string; subject: string; sentAt: string; dueAt: string; acknowledged: number; total: number; recipients: { id: string; departmentId: string; acknowledgedAt: string | null }[] }[]>('/compliance/disseminations');
  const depts = useApi<Dept[]>('/config/departments');
  const [f, setF] = useState<{ subject: string; body: string; departmentIds: string[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const act = useAction();
  const name = (id: string) => depts.data?.find((d) => d.id === id)?.name ?? id;
  return (
    <Card title={t('Circulars and acknowledgements')} actions={can('cmp:disseminate', 'CMP') ? <Button size="sm" onClick={() => setF({ subject: '', body: '', departmentIds: [] })}>{t('Send circular')}</Button> : null}>
      {act.error ? <Alert>{act.error}</Alert> : null}
      {!data?.length ? <Empty>{t('No circulars sent')}</Empty> : <ul className="divide-y text-sm">{data.map((d) => (
        <li key={d.id} className="py-2">
          <button className="flex w-full flex-wrap items-center justify-between gap-2 text-start" onClick={() => setOpen(open === d.id ? null : d.id)} aria-expanded={open === d.id}>
            <span className="font-medium">{d.subject}</span>
            <span className="text-xs">{fmtDate(d.sentAt)} · {t('due')} {fmtDate(d.dueAt)} <Badge tone={d.acknowledged === d.total ? 'green' : 'amber'}>{d.acknowledged}/{d.total} {t('acknowledged')}</Badge></span>
          </button>
          {open === d.id ? <ul className="mt-2 grid gap-1 sm:grid-cols-2">{d.recipients.map((r) => <li key={r.id} className="text-xs">{name(r.departmentId)}: {r.acknowledgedAt ? <Badge tone="green">{fmtDate(r.acknowledgedAt)}</Badge> : <Badge tone="red">{t('not yet')}</Badge>}</li>)}</ul> : null}
        </li>
      ))}</ul>}
      <Modal open={!!f} wide title={t('Send a circular')} onClose={() => setF(null)} footer={<Button busy={act.busy} disabled={!f?.departmentIds.length} onClick={() => act.run(async () => { await api.post('/compliance/disseminations', f); setF(null); await reload(); })}>{t('Send')}</Button>}>
        {f ? <>
          <Field label={t('Subject')}>{(id) => <Input id={id} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />}</Field>
          <Field label={t('Message')}>{(id) => <Textarea id={id} rows={6} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />}</Field>
          <fieldset><legend className="mb-1 text-sm font-medium">{t('Departments')}</legend>
            <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">{depts.data?.map((d) => <label key={d.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.departmentIds.includes(d.id)} onChange={(e) => setF({ ...f, departmentIds: e.target.checked ? [...f.departmentIds, d.id] : f.departmentIds.filter((x) => x !== d.id) })} />{d.name}</label>)}</div>
          </fieldset>
        </> : null}
      </Modal>
    </Card>
  );
}

function Checks() {
  const { can } = useAuth();
  const { data, reload } = useApi<{ id: string; departmentId: string; period: string; dueAt: string; status: string; _count: { items: number } }[]>('/compliance/cycles');
  const depts = useApi<Dept[]>('/config/departments');
  const act = useAction();
  const name = (id: string) => depts.data?.find((d) => d.id === id)?.name ?? id;
  return (
    <Card title={t('Department confirmations (asked every year)')} actions={can('cmp:write', 'CMP') ? <>
      <Button size="sm" variant="secondary" busy={act.busy} onClick={() => act.run(async () => { await api.post('/compliance/cycles/run'); await reload(); })}>{t('Issue due checklists now')}</Button>
      <Button size="sm" variant="ghost" busy={act.busy} onClick={() => act.run(async () => { await api.post('/compliance/reminders/run'); })}>{t('Send reminders now')}</Button>
    </> : null}>
      {act.error ? <Alert>{act.error}</Alert> : null}
      {!data?.length ? <Empty>{t('No checklists issued yet')}</Empty> : <ul className="divide-y text-sm">{data.map((c) => (
        <li key={c.id}><Link href={`/compliance/checks/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2 hover:bg-slate-50">
          <span><span className="font-medium">{name(c.departmentId)}</span> · {c.period} · {t('{n} items', { n: c._count.items })}</span>
          <span className="flex items-center gap-2 text-xs"><span className={['ISSUED', 'IN_PROGRESS'].includes(c.status) && new Date(c.dueAt) < new Date() ? 'font-semibold text-red-700' : ''}>{t('due')} {fmtDate(c.dueAt)}</span><StatusBadge value={c.status} /></span>
        </Link></li>
      ))}</ul>}
    </Card>
  );
}

/** HoD / Compliance Unit Head. */
function useCmpManager() {
  const { me } = useAuth();
  return !!me?.roles.some((r) => r.role === 'HOD' || (r.role === 'UNIT_HEAD' && r.unit === 'CMP'));
}

/**
 * Assign (or reassign) research of a law to a Compliance lawyer. With no law chosen, a new law is
 * registered first (title + type), so a newly issued law can be handed out in one step.
 */
function AssignResearch({ open, lawId, onClose, onDone }: { open: boolean; lawId?: string; onClose: () => void; onDone: () => void }) {
  const laws = useApi<{ id: string; title: string }[]>(open && !lawId ? '/compliance/laws' : null, [open]);
  const [f, setF] = useState({ lawId: '', title: '', type: 'ACT', assigneeId: '', dueAt: '', note: '' });
  const act = useAction();
  const newLaw = !lawId && !f.lawId;
  const save = () => act.run(async () => {
    let id = lawId || f.lawId;
    if (!id) id = (await api.post<{ id: string }>('/compliance/laws', { title: f.title, type: f.type })).id;
    await api.post(`/compliance/laws/${id}/research`, { assigneeId: f.assigneeId, dueAt: f.dueAt ? new Date(`${f.dueAt}T16:00:00+05:00`).toISOString() : null, note: f.note || null });
    setF({ lawId: '', title: '', type: 'ACT', assigneeId: '', dueAt: '', note: '' });
    onDone(); onClose();
  });
  return (
    <Modal open={open} title={lawId ? t('Assign / reassign research') : t('Assign research of a law')} onClose={onClose}
      footer={<Button busy={act.busy} disabled={!f.assigneeId || (newLaw && f.title.trim().length < 3)} onClick={save}>{t('Assign')}</Button>}>
      {act.error ? <Alert>{act.error}</Alert> : null}
      {!lawId ? <>
        <Field label={t('Law')}>{(id) => <Select id={id} value={f.lawId} onChange={(e) => setF({ ...f, lawId: e.target.value })} placeholder={t('— New law (not registered yet) —')} options={(laws.data ?? []).map((l) => ({ value: l.id, label: l.title }))} />}</Field>
        {newLaw ? <div className="grid gap-2 sm:grid-cols-3">
          <div className="sm:col-span-2"><Field label={t('Title of the new law')} required>{(id) => <Input id={id} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field></div>
          <Field label={t('Type')}>{(id) => <Select id={id} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={['ACT', 'REGULATION', 'CIRCULAR', 'GUIDELINE', 'DIRECTIVE'].map((x) => ({ value: x, label: label(x) }))} />}</Field>
        </div> : null}
      </> : null}
      <UserSelect unit="CMP" labelText={t('Lawyer')} value={f.assigneeId} onChange={(v) => setF({ ...f, assigneeId: v })} allowEmpty={false} />
      <Field label={t('Due date')}>{(id) => <Input id={id} type="date" value={f.dueAt} onChange={(e) => setF({ ...f, dueAt: e.target.value })} />}</Field>
      <Field label={t('Instructions')}>{(id) => <Textarea id={id} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />}</Field>
      <p className="text-xs text-slate-500">{t('The lawyer is notified. Reassigning moves the task to the new lawyer.')}</p>
    </Modal>
  );
}

function Research() {
  const manager = useCmpManager();
  const [assign, setAssign] = useState<{ lawId?: string } | null>(null);
  const [mine, setMine] = useState(false);
  const { data, reload } = useApi<{ id: string; title: string; type: string; researchStatus: string; assigneeName: string | null; researchDueAt: string | null; researchCompletedAt: string | null; overdue: boolean; _count: { obligations: number } }[]>(`/compliance/research?mine=${mine}`, [mine]);
  return (
    <Card title={t('Research of laws')} actions={<>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />{t('Only mine')}</label>
      {manager ? <Button size="sm" onClick={() => setAssign({})}>{t('Assign research')}</Button> : null}
    </>}>
      <p className="mb-2 text-xs text-slate-500">{t('The HoD or Unit Head assigns research of a new law to a lawyer (and can reassign it at any time). The lawyer adds the obligations and their departments, then completes the research.')}</p>
      {!data?.length ? <Empty>{t('No research assigned')}</Empty> : <ul className="divide-y text-sm" data-testid="research-list">{data.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <Link href={`/compliance/laws/${r.id}`} className="hover:underline"><span className="font-medium">{r.title}</span> <span className="text-xs text-slate-500">· {r.assigneeName ?? '—'} · {t('{n} obligations', { n: r._count.obligations })}</span></Link>
          <span className="flex items-center gap-2 text-xs"><span className={r.overdue ? 'font-semibold text-red-700' : ''}>{t('due')} {fmtDate(r.researchDueAt)}</span><StatusBadge value={r.researchStatus} />
            {manager ? <Button size="sm" variant="ghost" onClick={() => setAssign({ lawId: r.id })}>{t('Reassign')}</Button> : null}</span>
        </li>
      ))}</ul>}
      <AssignResearch open={!!assign} lawId={assign?.lawId} onClose={() => setAssign(null)} onDone={() => void reload()} />
    </Card>
  );
}

function DeptReport() {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const { data } = useApi<{ year: number; summary: { id: string; department: string; obligations: number; yes: number; no: number; unanswered: number; confirmedPct: number | null; circulars: number; acknowledged: number; remindersSent: number }[] }>(`/compliance/reports/departments?year=${year}`, [year]);
  const act = useAction();
  return (
    <Card title={t('Compliance by department')} actions={<>
      <Input aria-label={t('Year')} className="w-24" inputMode="numeric" maxLength={4} value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, ''))} />
      <Button size="sm" variant="secondary" busy={act.busy} onClick={() => act.run(() => download(`/compliance/reports/departments?year=${year}&format=xlsx`, `compliance-by-department-${year}.xlsx`))}>{t('Export to Excel')}</Button>
    </>}>
      {act.error ? <Alert>{act.error}</Alert> : null}
      {!data?.summary.length ? <Empty>{t('No obligations issued to departments for this year')}</Empty> : (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b text-start text-xs text-slate-500"><th className="py-2 pe-2">{t('Department')}</th><th className="pe-2">{t('Obligations')}</th><th className="pe-2">{t('Yes')}</th><th className="pe-2">{t('No')}</th><th className="pe-2">{t('Not answered')}</th><th className="pe-2">{t('Confirmed')}</th><th className="pe-2">{t('Circulars ack.')}</th><th>{t('Reminders')}</th></tr></thead>
          <tbody>{data.summary.map((r) => (
            <tr key={r.id} className="border-b last:border-0">
              <td className="py-2 pe-2 font-medium">{r.department}</td><td className="pe-2">{r.obligations}</td><td className="pe-2 text-green-700">{r.yes}</td><td className="pe-2 text-red-700">{r.no}</td>
              <td className="pe-2 text-amber-700">{r.unanswered}</td><td className="pe-2">{r.confirmedPct === null ? '—' : `${r.confirmedPct}%`}</td><td className="pe-2">{r.acknowledged}/{r.circulars}</td><td>{r.remindersSent}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );
}

function Findings() {
  const [f, setF] = useState({ status: '', severity: '' });
  const { data } = useApi<{ id: string; title: string; severity: string; status: string; dueOn: string; departmentId: string }[]>(`/compliance/findings?status=${f.status}&severity=${f.severity}`, [f.status, f.severity]);
  const depts = useApi<Dept[]>('/config/departments');
  const name = (id: string) => depts.data?.find((d) => d.id === id)?.name ?? id;
  return (
    <Card title={t('Findings and remediation')} actions={<>
      <Select aria-label={t('Status')} className="w-44" placeholder={t('Any status')} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} options={['OPEN', 'ACTION_PLAN_AGREED', 'EVIDENCE_SUBMITTED', 'CLOSED'].map((x) => ({ value: x, label: label(x) }))} />
      <Select aria-label={t('Severity')} className="w-36" placeholder={t('Any severity')} value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })} options={['HIGH', 'MEDIUM', 'LOW'].map((x) => ({ value: x, label: label(x) }))} />
    </>}>
      <FindingList rows={data} name={name} />
    </Card>
  );
}

function FindingList({ rows, name }: { rows?: { id: string; title: string; severity: string; status: string; dueOn: string; departmentId: string }[]; name: (id: string) => string }) {
  if (!rows?.length) return <Empty>{t('No findings')}</Empty>;
  return <ul className="divide-y text-sm">{rows.map((x) => (
    <li key={x.id}><Link href={`/compliance/findings/${x.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2 hover:bg-slate-50">
      <span><StatusBadge value={x.severity} /> <span className="font-medium">{x.title}</span> <span className="text-xs text-slate-500">· {name(x.departmentId)}</span></span>
      <span className="flex items-center gap-2 text-xs"><span className={x.status !== 'CLOSED' && new Date(x.dueOn) < new Date() ? 'font-semibold text-red-700' : ''}>{t('due')} {fmtDate(x.dueOn)}</span><StatusBadge value={x.status} /></span>
    </Link></li>
  ))}</ul>;
}

function Licences() {
  const { can } = useAuth();
  const { data, reload } = useApi<{ id: string; name: string; kind: string; number: string | null; expiresOn: string | null; status: string; regulator: { name: string } | null }[]>('/compliance/licences');
  const [f, setF] = useState<Record<string, string> | null>(null);
  const act = useAction();
  return (
    <Card title={t('Licences, permits and statutory filings')} actions={can('cmp:write', 'CMP') ? <Button size="sm" onClick={() => setF({ name: '', kind: 'LICENCE', number: '', expiresOn: '' })}>{t('Add')}</Button> : null}>
      {act.error ? <Alert>{act.error}</Alert> : null}
      {!data?.length ? <Empty>{t('None registered')}</Empty> : <ul className="divide-y text-sm">{data.map((l) => (
        <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span><Badge>{label(l.kind)}</Badge> <span className="font-medium">{l.name}</span> {l.number ? <span className="text-xs text-slate-500">({l.number})</span> : null}</span>
          <span className="flex items-center gap-2 text-xs"><span className={l.expiresOn && new Date(l.expiresOn).getTime() - Date.now() < 60 * 86400_000 ? 'font-semibold text-red-700' : ''}>{l.kind === 'FILING' ? t('due') : t('expires')} {fmtDate(l.expiresOn)}</span><StatusBadge value={l.status} /></span></li>
      ))}</ul>}
      <Modal open={!!f} title={t('Add licence or filing')} onClose={() => setF(null)} footer={<Button busy={act.busy} onClick={() => act.run(async () => { await api.post('/compliance/licences', { name: f!.name, kind: f!.kind, number: f!.number || null, expiresOn: f!.expiresOn ? new Date(`${f!.expiresOn}T16:00:00+05:00`).toISOString() : null }); setF(null); await reload(); })}>{t('Save')}</Button>}>
        {f ? <>
          <Field label={t('Name')}>{(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Field label={t('Kind')}>{(id) => <Select id={id} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={['LICENCE', 'PERMIT', 'FILING'].map((x) => ({ value: x, label: label(x) }))} />}</Field>
          <Field label={t('Number')}>{(id) => <Input id={id} value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} />}</Field>
          <Field label={t('Expiry / due date')}>{(id) => <Input id={id} type="date" value={f.expiresOn} onChange={(e) => setF({ ...f, expiresOn: e.target.value })} />}</Field>
        </> : null}
      </Modal>
    </Card>
  );
}

function Changes() {
  const { can } = useAuth();
  const { data, reload } = useApi<{ id: string; kind: string; status: string; impact: string | null; createdAt: string; law: { id: string; title: string } }[]>('/compliance/changes');
  const [edit, setEdit] = useState<{ id: string; lawId: string; impact: string; status: string } | null>(null);
  const act = useAction();
  const order = ['IDENTIFIED', 'IMPACT_ASSESSMENT', 'COMMUNICATED', 'IMPLEMENTING', 'IMPLEMENTED'];
  return (
    <Card title={t('Regulatory change log')}>
      {act.error ? <Alert>{act.error}</Alert> : null}
      {!data?.length ? <Empty>{t('No changes recorded')}</Empty> : <ul className="divide-y text-sm">{data.map((c) => (
        <li key={c.id} className="py-2">
          <div className="flex flex-wrap items-center justify-between gap-2"><span><Badge>{label(c.kind)}</Badge> <Link className="font-medium underline" href={`/compliance/laws/${c.law.id}`}>{c.law.title}</Link></span>
            <span className="flex items-center gap-2"><StatusBadge value={c.status} />{can('cmp:write', 'CMP') && c.status !== 'IMPLEMENTED' ? <Button size="sm" variant="ghost" onClick={() => setEdit({ id: c.id, lawId: c.law.id, impact: c.impact ?? '', status: order[Math.min(order.length - 1, order.indexOf(c.status) + 1)]! })}>{t('Update')}</Button> : null}</span></div>
          {c.impact ? <p className="mt-1 whitespace-pre-wrap text-slate-700">{c.impact}</p> : null}
        </li>
      ))}</ul>}
      <Modal open={!!edit} title={t('Update change')} onClose={() => setEdit(null)} footer={<Button busy={act.busy} onClick={() => act.run(async () => { await api.patch(`/compliance/changes/${edit!.id}`, { lawId: edit!.lawId, impact: edit!.impact || null, status: edit!.status }); setEdit(null); await reload(); })}>{t('Save')}</Button>}>
        {edit ? <>
          <Field label={t('Impact assessment (who is affected, what changes)')}>{(id) => <Textarea id={id} rows={6} value={edit.impact} onChange={(e) => setEdit({ ...edit, impact: e.target.value })} />}</Field>
          <Field label={t('Status')}>{(id) => <Select id={id} value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })} options={order.map((x) => ({ value: x, label: label(x) }))} />}</Field>
        </> : null}
      </Modal>
    </Card>
  );
}

function MyDepartment() {
  const circ = useApi<{ id: string; subject: string; body: string; dueAt: string; recipients: { id: string; acknowledgedAt: string | null }[] }[]>('/compliance/disseminations');
  const cycles = useApi<{ id: string; period: string; dueAt: string; status: string; _count: { items: number } }[]>('/compliance/cycles');
  const act = useAction();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={t('Circulars')}>
        {act.error ? <Alert>{act.error}</Alert> : null}
        {!circ.data?.length ? <Empty>{t('No circulars')}</Empty> : <ul className="space-y-3">{circ.data.map((c) => {
          const r = c.recipients[0];
          return (
            <li key={c.id} className="rounded border p-3 text-sm">
              <div className="flex items-center justify-between gap-2"><span className="font-medium">{c.subject}</span>{r?.acknowledgedAt ? <Badge tone="green">{t('Acknowledged')}</Badge> : <Badge tone="amber">{t('Due')} {fmtDate(c.dueAt)}</Badge>}</div>
              <p className="mt-1 whitespace-pre-wrap text-slate-700">{c.body}</p>
              {r && !r.acknowledgedAt ? <Button className="mt-2" size="sm" busy={act.busy} onClick={() => act.run(async () => { await api.post(`/compliance/acknowledgements/${r.id}`); await circ.reload(); })}>{t('I have read this')}</Button> : null}
            </li>
          );
        })}</ul>}
      </Card>
      <div className="space-y-4">
        <Card title={t('Obligations to confirm (yes / no)')}>
          {!cycles.data?.length ? <Empty>{t('None')}</Empty> : <ul className="divide-y text-sm">{cycles.data.map((c) => <li key={c.id}><Link className="flex items-center justify-between py-2 hover:bg-slate-50" href={`/compliance/checks/${c.id}`}><span>{c.period} · {t('{n} items', { n: c._count.items })}</span><span className="flex items-center gap-2 text-xs">{t('due')} {fmtDate(c.dueAt)} <StatusBadge value={c.status} /></span></Link></li>)}</ul>}
        </Card>
      </div>
    </div>
  );
}
