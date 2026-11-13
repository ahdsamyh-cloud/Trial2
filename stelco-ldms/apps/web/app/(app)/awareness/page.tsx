'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useAction } from '@/lib/hooks';
import { fmtDate, fmtDateTime, fromLocalInput, label } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { DocumentsPanel, useDirectory } from '@/components/parts';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Stat, StatusBadge, Tabs } from '@/components/ui';

type Dept = { id: string; name: string };
interface SessionRow { id: string; title: string; topic: string; format: string; startsAt: string; status: string; venue: string | null; _count: { attendance: number; feedback: number } }

export default function Awareness() {
  const { can } = useAuth();
  const staff = can('awr:write', 'AWR') || can('matter:read', 'AWR');
  const [tab, setTab] = useState('sessions');
  const tabs = staff ? [{ id: 'sessions', label: t('Sessions') }, { id: 'plan', label: t('Annual plan') }, { id: 'library', label: t('Materials library') }, { id: 'staff', label: t('Staff records') }, { id: 'reports', label: t('Reports') }] : [{ id: 'sessions', label: t('Sessions') }];
  return (
    <div>
      <PageHeader title={t('Awareness')} subtitle={t('Legal awareness sessions, materials, attendance and feedback.')} />
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === 'sessions' ? <Sessions /> : tab === 'plan' ? <Plan /> : tab === 'library' ? <DocumentsPanel ownerType="library" ownerId="MATERIAL" canWrite={can('awr:write', 'AWR')} title={t('Reusable materials')} /> : tab === 'staff' ? <Staff /> : <Reports />}
    </div>
  );
}

function SessionForm({ initial, onSaved, onClose }: { initial?: Partial<{ id: string; title: string; topic: string; format: string; startsAt: string; endsAt: string; venue: string; meetingUrl: string; audienceDeptIds: string[]; presenterIds: string[]; preparerIds: string[]; planItemId: string }>; onSaved: () => void; onClose: () => void }) {
  const depts = useApi<Dept[]>('/config/departments');
  const dir = useDirectory('AWR');
  const all = useDirectory();
  const [f, setF] = useState({ title: '', topic: '', format: 'IN_PERSON', startsAt: '', endsAt: '', venue: '', meetingUrl: '', audienceDeptIds: [] as string[], presenterIds: [] as string[], preparerIds: [] as string[], planItemId: '', ...initial });
  const act = useAction();
  const people = [...new Map([...(dir.data ?? []), ...(all.data ?? [])].map((u) => [u.id, u])).values()];
  return (
    <Modal open wide title={initial?.id ? t('Edit session') : t('New session')} onClose={onClose} footer={<Button busy={act.busy} onClick={() => act.run(async () => {
      const body = { ...f, startsAt: fromLocalInput(f.startsAt), endsAt: fromLocalInput(f.endsAt), venue: f.venue || null, meetingUrl: f.meetingUrl || null, planItemId: f.planItemId || null };
      delete (body as { id?: string }).id;
      if (initial?.id) await api.patch(`/awareness/sessions/${initial.id}`, body); else await api.post('/awareness/sessions', body);
      onSaved();
    })}>{t('Save')}</Button>}>
      {act.error ? <Alert>{act.error}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label={t('Title')}>{(id) => <Input id={id} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field></div>
        <Field label={t('Topic')}>{(id) => <Input id={id} value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })} />}</Field>
        <Field label={t('Format')}>{(id) => <Select id={id} value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })} options={['IN_PERSON', 'ONLINE', 'ELEARNING', 'CIRCULAR'].map((x) => ({ value: x, label: label(x) }))} />}</Field>
        <Field label={t('Starts')}>{(id) => <Input id={id} type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} />}</Field>
        <Field label={t('Ends')}>{(id) => <Input id={id} type="datetime-local" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} />}</Field>
        <Field label={t('Venue')}>{(id) => <Input id={id} value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })} />}</Field>
        <Field label={t('Meeting link')}>{(id) => <Input id={id} type="url" value={f.meetingUrl} onChange={(e) => setF({ ...f, meetingUrl: e.target.value })} />}</Field>
        <fieldset><legend className="mb-1 text-sm font-medium">{t('Presenters')}</legend><div className="max-h-40 space-y-1 overflow-y-auto">{people.map((u) => <label key={u.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.presenterIds.includes(u.id)} onChange={(e) => setF({ ...f, presenterIds: e.target.checked ? [...f.presenterIds, u.id] : f.presenterIds.filter((x) => x !== u.id) })} />{u.displayName}</label>)}</div></fieldset>
        <fieldset><legend className="mb-1 text-sm font-medium">{t('Preparers')}</legend><div className="max-h-40 space-y-1 overflow-y-auto">{people.map((u) => <label key={u.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.preparerIds.includes(u.id)} onChange={(e) => setF({ ...f, preparerIds: e.target.checked ? [...f.preparerIds, u.id] : f.preparerIds.filter((x) => x !== u.id) })} />{u.displayName}</label>)}</div></fieldset>
        <fieldset className="sm:col-span-2"><legend className="mb-1 text-sm font-medium">{t('Audience (leave empty for everyone)')}</legend><div className="grid max-h-40 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-3">{depts.data?.map((d) => <label key={d.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.audienceDeptIds.includes(d.id)} onChange={(e) => setF({ ...f, audienceDeptIds: e.target.checked ? [...f.audienceDeptIds, d.id] : f.audienceDeptIds.filter((x) => x !== d.id) })} />{d.name}</label>)}</div></fieldset>
      </div>
    </Modal>
  );
}

function Sessions() {
  const { can } = useAuth();
  const { data, reload } = useApi<SessionRow[]>('/awareness/sessions');
  const [open, setOpen] = useState(false);
  const upcoming = data?.filter((s) => new Date(s.startsAt) >= new Date()) ?? [];
  const past = data?.filter((s) => new Date(s.startsAt) < new Date()) ?? [];
  const Row = ({ s }: { s: SessionRow }) => (
    <li><Link href={`/awareness/sessions/${s.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2 hover:bg-slate-50">
      <span><span className="font-medium">{s.title}</span> <span className="text-xs text-slate-500">· {s.topic} · {label(s.format)}{s.venue ? ` · ${s.venue}` : ''}</span></span>
      <span className="flex items-center gap-2 text-xs">{fmtDateTime(s.startsAt)} <Badge>{t('{n} attended', { n: s._count.attendance })}</Badge><StatusBadge value={s.status} /></span>
    </Link></li>
  );
  return (
    <div className="space-y-4">
      <Card title={t('Upcoming sessions')} actions={can('awr:write', 'AWR') ? <Button size="sm" onClick={() => setOpen(true)}>{t('New session')}</Button> : null}>
        {!upcoming.length ? <Empty>{t('Nothing scheduled')}</Empty> : <ul className="divide-y text-sm">{upcoming.map((s) => <Row key={s.id} s={s} />)}</ul>}
      </Card>
      <Card title={t('Past sessions')}>{!past.length ? <Empty>{t('None yet')}</Empty> : <ul className="divide-y text-sm">{past.map((s) => <Row key={s.id} s={s} />)}</ul>}</Card>
      {open ? <SessionForm onClose={() => setOpen(false)} onSaved={async () => { setOpen(false); await reload(); }} /> : null}
    </div>
  );
}

function Plan() {
  const { can, me } = useAuth();
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, reload } = useApi<{ status: string; items: { id: string; topic: string; quarter: number; status: string; targetDeptIds: string[]; sessions: { id: string; title: string; status: string }[] }[] }>(`/awareness/plans/${year}`, [year]);
  const depts = useApi<Dept[]>('/config/departments');
  const [item, setItem] = useState<{ topic: string; quarter: string; targetDeptIds: string[] } | null>(null);
  const act = useAction();
  const approver = !!me?.roles.some((r) => r.role === 'HOD' || (r.role === 'UNIT_HEAD' && r.unit === 'AWR'));
  const name = (id: string) => depts.data?.find((d) => d.id === id)?.name ?? id;
  return (
    <Card title={<span>{t('Awareness plan {y}', { y: year })} {data ? <StatusBadge value={data.status} /> : null}</span>} actions={<>
      <Select aria-label={t('Year')} className="w-28" value={String(year)} onChange={(e) => setYear(Number(e.target.value))} options={[year - 1, year, year + 1].map((y) => ({ value: String(y), label: String(y) }))} />
      {can('awr:write', 'AWR') ? <Button size="sm" onClick={() => setItem({ topic: '', quarter: '1', targetDeptIds: [] })}>{t('Add topic')}</Button> : null}
      {approver && data?.status !== 'APPROVED' ? <Button size="sm" variant="secondary" onClick={() => act.run(async () => { await api.post(`/awareness/plans/${year}/approve`); await reload(); })}>{t('Approve plan')}</Button> : null}
    </>}>
      {act.error ? <Alert>{act.error}</Alert> : null}
      <div className="grid gap-3 md:grid-cols-4">{[1, 2, 3, 4].map((q) => (
        <div key={q} className="rounded border p-2"><div className="mb-2 text-xs font-semibold uppercase text-slate-500">Q{q}</div>
          <ul className="space-y-2 text-sm">{data?.items.filter((i) => i.quarter === q).map((i) => (
            <li key={i.id} className="rounded bg-slate-50 p-2"><div className="font-medium">{i.topic}</div><div className="text-xs text-slate-500">{i.targetDeptIds.map(name).join(', ') || t('All departments')}</div><div className="mt-1 flex flex-wrap gap-1"><StatusBadge value={i.status} />{i.sessions.map((s) => <Link key={s.id} href={`/awareness/sessions/${s.id}`}><Badge tone="blue">{s.title}</Badge></Link>)}</div></li>
          ))}</ul></div>
      ))}</div>
      <Modal open={!!item} title={t('Add plan topic')} onClose={() => setItem(null)} footer={<Button busy={act.busy} onClick={() => act.run(async () => { await api.post('/awareness/plan-items', { year, topic: item!.topic, quarter: Number(item!.quarter), targetDeptIds: item!.targetDeptIds }); setItem(null); await reload(); })}>{t('Save')}</Button>}>
        {item ? <>
          <Field label={t('Topic')}>{(id) => <Input id={id} value={item.topic} onChange={(e) => setItem({ ...item, topic: e.target.value })} />}</Field>
          <Field label={t('Quarter')}>{(id) => <Select id={id} value={item.quarter} onChange={(e) => setItem({ ...item, quarter: e.target.value })} options={['1', '2', '3', '4'].map((q) => ({ value: q, label: `Q${q}` }))} />}</Field>
          <fieldset><legend className="mb-1 text-sm font-medium">{t('Target departments')}</legend><div className="grid max-h-48 grid-cols-2 gap-1 overflow-y-auto">{depts.data?.map((d) => <label key={d.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={item.targetDeptIds.includes(d.id)} onChange={(e) => setItem({ ...item, targetDeptIds: e.target.checked ? [...item.targetDeptIds, d.id] : item.targetDeptIds.filter((x) => x !== d.id) })} />{d.name}</label>)}</div></fieldset>
        </> : null}
      </Modal>
    </Card>
  );
}

function Staff() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const { data, reload } = useApi<{ id: string; staffNo: string; name: string; department: { name: string } | null }[]>(`/awareness/employees?q=${encodeURIComponent(q)}`, [q]);
  const [hist, setHist] = useState<{ name: string; attendance: { session: { id: string; title: string; startsAt: string } }[]; presented: { id: string; title: string; startsAt: string; role: string }[] } | null>(null);
  const [imp, setImp] = useState<{ total: number; valid: number; errors: { row: number; errors: string[] }[]; committed: boolean } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const act = useAction();
  const upload = (commit: boolean) => act.run(async () => { const f = file.current?.files?.[0]; if (!f) throw new Error(t('Choose the staff list')); const fd = new FormData(); fd.set('file', f); setImp(await api.form(`/awareness/employees/import?commit=${commit}`, fd)); if (commit) await reload(); });
  return (
    <div className="space-y-4">
      {can('awr:write', 'AWR') ? (
        <Card title={t('Import staff list from HR (Excel: Staff No, Name, Department)')}>
          {act.error ? <Alert>{act.error}</Alert> : null}
          <div className="flex flex-wrap items-center gap-2"><input ref={file} type="file" accept=".xlsx" aria-label={t('Staff list')} className="text-sm" /><Button size="sm" variant="secondary" busy={act.busy} onClick={() => upload(false)}>{t('Check (dry run)')}</Button>{imp && !imp.committed && imp.valid ? <Button size="sm" busy={act.busy} onClick={() => upload(true)}>{t('Import {n} staff', { n: imp.valid })}</Button> : null}</div>
          {imp ? <div className="mt-2 text-sm">{t('{v} of {n} rows valid.', { v: imp.valid, n: imp.total })} {imp.committed ? t('Imported.') : ''}<ul className="text-xs text-red-700">{imp.errors.slice(0, 20).map((e) => <li key={e.row}>{t('Row')} {e.row}: {e.errors.join('; ')}</li>)}</ul></div> : null}
        </Card>
      ) : null}
      <Card title={t('Staff and training history')} actions={<Input aria-label={t('Search staff')} className="w-56" placeholder={t('Name or staff no.')} value={q} onChange={(e) => setQ(e.target.value)} />}>
        {!data?.length ? <Empty>{t('No staff records')}</Empty> : <ul className="divide-y text-sm">{data.map((e) => <li key={e.id} className="flex items-center justify-between py-1.5"><span>{e.name} <span className="text-xs text-slate-500">{e.staffNo} · {e.department?.name ?? ''}</span></span><Button size="sm" variant="ghost" onClick={() => act.run(async () => setHist(await api.get(`/awareness/employees/${e.id}/history`)))}>{t('Training history')}</Button></li>)}</ul>}
      </Card>
      <Modal open={!!hist} title={hist?.name ?? ''} onClose={() => setHist(null)}>
        <div className="text-sm"><div className="font-medium">{t('Attended')}</div><ul className="mb-2">{hist?.attendance.map((a) => <li key={a.session.id}>{fmtDate(a.session.startsAt)} · {a.session.title}</li>)}</ul>
          <div className="font-medium">{t('Presented / prepared')}</div><ul>{hist?.presented.map((p) => <li key={p.id}>{fmtDate(p.startsAt)} · {p.title} ({label(p.role)})</li>)}</ul></div>
      </Modal>
    </div>
  );
}

function Reports() {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data } = useApi<{ planned: number; held: number; attendance: number; averageFeedback: number | null; byQuarter: { quarter: number; planned: number; held: number }[]; coverage: { department: string; staff: number; reached: number; percent: number | null }[]; presenters: { name: string; sessions: number }[] }>(`/awareness/reports/${year}`, [year]);
  return (
    <div className="space-y-4">
      <Select aria-label={t('Year')} className="w-28" value={String(year)} onChange={(e) => setYear(Number(e.target.value))} options={[year - 1, year, year + 1].map((y) => ({ value: String(y), label: String(y) }))} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t('Planned topics')} value={data?.planned ?? '…'} /><Stat label={t('Sessions held')} value={data?.held ?? '…'} />
        <Stat label={t('Attendances')} value={data?.attendance ?? '…'} /><Stat label={t('Average feedback')} value={data?.averageFeedback ?? '—'} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t('Held vs planned')}><ul className="text-sm">{data?.byQuarter.map((q) => <li key={q.quarter} className="flex justify-between"><span>Q{q.quarter}</span><span>{q.held} / {q.planned}</span></li>)}</ul></Card>
        <Card title={t('Coverage by department')}><ul className="text-sm">{data?.coverage.map((c) => <li key={c.department} className="flex justify-between gap-2"><span>{c.department}</span><span>{c.reached}/{c.staff} {c.percent !== null ? `(${c.percent}%)` : ''}</span></li>)}</ul></Card>
        <Card title={t('Presenter activity')}><ul className="text-sm">{data?.presenters.map((p) => <li key={p.name} className="flex justify-between"><span>{p.name}</span><span>{p.sessions}</span></li>)}</ul></Card>
      </div>
    </div>
  );
}
