'use client';
import Link from 'next/link';
import { ReactNode, useState } from 'react';
import { UNIT_NAMES } from '@ldms/shared';
import { api, download } from '@/lib/api';
import { useApi, useAction } from '@/lib/hooks';
import { fmtDate, fmtDateTime, label } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { Alert, Badge, Button, Card, DL, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge, Textarea } from './ui';
import { Comments, DocumentsPanel, SlaPanel, Timeline, UserSelect, useDirectory } from './parts';

export interface MatterDetail {
  id: string; reference: string; unit: string; title: string; description: string | null; status: string; priority: string; dueDate: string | null; restricted: boolean;
  legalHold: boolean; tags: string[]; requesterName: string | null; requestingDeptId: string | null; createdAt: string; closedAt: string | null; portalView: boolean;
  requestType: { name: string; code: string } | null;
  assignments: { role: string; user: { id: string; displayName: string } }[];
  access?: { user: { id: string; displayName: string } }[];
  transitions: { id: string; at: string; fromStatus: string | null; toStatus: string; actorName: string; comment: string | null; action: string }[];
  comments: { id: string; body: string | null; authorName: string; createdAt: string; internal: boolean }[];
  links: { id: string; reference: string; title: string; restricted: boolean }[];
  intakes: { id: string; intakeNo: string; subject: string; receivedAt: string }[];
  sla: { id: string; step: string; policy: string; dueAt: string; state: string; percent: number; stoppedAt: string | null }[];
}

/** Shared matter page: header, people, SLA, documents, comments, history. Units add their own panels. */
export function MatterView({ id, children, actions, docStages, docTypes, extraInfo }: {
  id: string; children?: (m: MatterDetail, reload: () => Promise<void>) => ReactNode; actions?: (m: MatterDetail, reload: () => Promise<void>) => ReactNode;
  docStages?: string[]; docTypes?: { value: string; label: string }[]; extraInfo?: (m: MatterDetail) => [string, ReactNode][];
}) {
  const { data: m, reload, error } = useApi<MatterDetail>(`/matters/${id}`);
  const { can, me } = useAuth();
  const dir = useDirectory();
  const [dlg, setDlg] = useState<'assign' | 'restrict' | 'edit' | 'status' | 'hold' | 'link' | null>(null);
  const [assign, setAssign] = useState({ assignee: '', reviewer: '' });
  const [named, setNamed] = useState<string[]>([]);
  const [edit, setEdit] = useState({ title: '', description: '', priority: '', dueDate: '' });
  const [status, setStatus] = useState({ status: '', comment: '' });
  const [holdReason, setHoldReason] = useState('');
  const [linkQ, setLinkQ] = useState('');
  const links = useApi<{ rows: { id: string; reference: string; title: string }[] }>(dlg === 'link' && linkQ.length > 1 ? `/matters?q=${encodeURIComponent(linkQ)}&pageSize=10` : null, [linkQ, dlg]);
  const act = useAction();
  if (error) return <Alert>{error.message === 'Matter not found' ? t('This matter does not exist or you do not have access to it.') : error.message}</Alert>;
  if (!m) return <Spinner />;
  const assignees = m.assignments.filter((a) => a.role === 'ASSIGNEE');
  const reviewer = m.assignments.find((a) => a.role === 'REVIEWER');
  const canAssign = can('matter:assign', m.unit);
  // Server enforces the finer rule (assigned officer / Unit Head / paralegal); this only hides controls.
  const canWrite = !m.portalView && can('matter:write', m.unit) && (canAssign || !!me?.roles.some((r) => r.role === 'PARALEGAL' && r.unit === m.unit) || m.assignments.some((a) => a.user.id === me?.id));
  const generic = m.unit === 'CMP' || m.unit === 'AWR';

  return (
    <div className="space-y-4">
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">{m.title}{m.restricted ? <Badge tone="purple">{t('Restricted')}</Badge> : null}{m.legalHold ? <Badge tone="purple">{t('Legal hold')}</Badge> : null}</span>}
        subtitle={<>{m.reference} · {UNIT_NAMES[m.unit as 'LIT']}{m.requestType ? ` · ${m.requestType.name}` : ''}</>}
        actions={m.portalView ? null : <>
          {actions?.(m, reload)}
          {generic && canWrite ? <Button variant="secondary" onClick={() => { setStatus({ status: m.status, comment: '' }); setDlg('status'); }}>{t('Change status')}</Button> : null}
          {canAssign ? <Button variant="secondary" onClick={() => { setAssign({ assignee: assignees[0]?.user.id ?? '', reviewer: reviewer?.user.id ?? '' }); setDlg('assign'); }}>{t('Assign')}</Button> : null}
          {canWrite ? <Button variant="ghost" onClick={() => { setEdit({ title: m.title, description: m.description ?? '', priority: m.priority, dueDate: m.dueDate?.slice(0, 10) ?? '' }); setDlg('edit'); }}>{t('Edit')}</Button> : null}
          {can('matter:restrict', m.unit) ? <Button variant="ghost" onClick={() => { setNamed(m.access?.map((a) => a.user.id) ?? []); setDlg('restrict'); }}>{m.restricted ? t('Ethical wall') : t('Restrict')}</Button> : null}
          {can('hold:place', m.unit) || can('hold:release') ? <Button variant="ghost" onClick={() => setDlg('hold')}>{m.legalHold ? t('Release hold') : t('Legal hold')}</Button> : null}
          {canWrite ? <Button variant="ghost" onClick={() => setDlg('link')}>{t('Link')}</Button> : null}
          {can('export:bulk', m.unit) ? <Button variant="ghost" onClick={() => act.run(() => download(`/matters/${m.id}/export`, 'matter.xlsx'))}>{t('Export file')}</Button> : null}
        </>} />
      {act.error ? <Alert>{act.error}</Alert> : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={t('Overview')}>
            <DL items={[
              [t('Status'), <StatusBadge key="s" value={m.status} />], [t('Priority'), <StatusBadge key="p" value={m.priority} />],
              [t('Due'), fmtDate(m.dueDate)], [t('Requester'), m.requesterName ?? '—'],
              [t('Assigned to'), assignees.map((a) => a.user.displayName).join(', ') || '—'], [t('Reviewer'), reviewer?.user.displayName ?? '—'],
              [t('Opened'), fmtDateTime(m.createdAt)], [t('Closed'), m.closedAt ? fmtDateTime(m.closedAt) : '—'],
              ...(extraInfo?.(m) ?? []),
            ]} />
            {m.description ? <p className="mt-4 whitespace-pre-wrap text-sm">{m.description}</p> : null}
            {m.tags.length ? <div className="mt-3 flex flex-wrap gap-1">{m.tags.map((x) => <Badge key={x}>{x}</Badge>)}</div> : null}
          </Card>
          {children?.(m, reload)}
          <DocumentsPanel ownerType="matter" ownerId={m.id} canWrite={!m.portalView && canWrite} stages={docStages} docTypes={docTypes} />
          <Comments matterId={m.id} comments={m.comments} onPosted={reload} portal={m.portalView} />
        </div>
        <div className="space-y-4">
          <SlaPanel sla={m.sla} />
          {m.links.length || m.intakes.length ? (
            <Card title={t('Related')}>
              <ul className="space-y-1 text-sm">
                {m.links.map((l) => <li key={l.id}><Link className="underline" href={`/matters/${l.id}`}>{l.reference}</Link> {l.title}</li>)}
                {m.intakes.map((i) => <li key={i.id}><Link className="underline" href={`/intake/${i.id}`}>{i.intakeNo}</Link> {i.subject}</li>)}
              </ul>
            </Card>
          ) : null}
          {m.restricted && m.access ? <Card title={t('Named on this matter')}><ul className="text-sm">{m.access.map((a) => <li key={a.user.id}>{a.user.displayName}</li>)}</ul></Card> : null}
          {!m.portalView ? <Timeline items={m.transitions} /> : null}
        </div>
      </div>

      <Modal open={dlg === 'assign'} title={t('Assign')} onClose={() => setDlg(null)}
        footer={<><Button variant="secondary" onClick={() => setDlg(null)}>{t('Cancel')}</Button><Button busy={act.busy} disabled={!assign.assignee} onClick={() => act.run(async () => { await api.post(`/matters/${m.id}/assign`, { assigneeIds: [assign.assignee], reviewerId: assign.reviewer || null }); setDlg(null); await reload(); })}>{t('Save')}</Button></>}>
        <WorkloadHint unit={m.unit} />
        <UserSelect unit={m.unit} labelText={t('Lawyer (maker)')} value={assign.assignee} onChange={(v) => setAssign({ ...assign, assignee: v })} />
        <UserSelect unit={m.unit} labelText={t('Reviewer (checker)')} value={assign.reviewer} exclude={[assign.assignee]} onChange={(v) => setAssign({ ...assign, reviewer: v })} />
      </Modal>
      <Modal open={dlg === 'restrict'} title={t('Restricted matter (ethical wall)')} onClose={() => setDlg(null)}
        footer={<>
          {m.restricted && can('hold:release') ? <Button variant="danger" onClick={() => act.run(async () => { await api.post(`/matters/${m.id}/restrict`, { restricted: false }); setDlg(null); await reload(); })}>{t('Remove restriction')}</Button> : null}
          <Button busy={act.busy} onClick={() => act.run(async () => { await api.post(`/matters/${m.id}/restrict`, { restricted: true, userIds: named }); setDlg(null); await reload(); })}>{t('Save')}</Button>
        </>}>
        <p className="text-sm text-slate-600">{t('Only the people named here and the HoD can see a restricted matter. It disappears from everyone else’s lists, search and calendar.')}</p>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {(dir.data ?? []).map((u) => <label key={u.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={named.includes(u.id)} onChange={(e) => setNamed(e.target.checked ? [...named, u.id] : named.filter((x) => x !== u.id))} />{u.displayName}</label>)}
        </div>
      </Modal>
      <Modal open={dlg === 'edit'} title={t('Edit matter')} onClose={() => setDlg(null)}
        footer={<><Button variant="secondary" onClick={() => setDlg(null)}>{t('Cancel')}</Button><Button busy={act.busy} onClick={() => act.run(async () => { await api.patch(`/matters/${m.id}`, { title: edit.title, description: edit.description || null, priority: edit.priority, dueDate: edit.dueDate ? new Date(`${edit.dueDate}T16:00:00+05:00`).toISOString() : null }); setDlg(null); await reload(); })}>{t('Save')}</Button></>}>
        <Field label={t('Title')}>{(fid) => <Input id={fid} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />}</Field>
        <Field label={t('Description')}>{(fid) => <Textarea id={fid} rows={6} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />}</Field>
        <Field label={t('Priority')}>{(fid) => <Select id={fid} value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: e.target.value })} options={['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => ({ value: p, label: label(p) }))} />}</Field>
        <Field label={t('Due date')}>{(fid) => <Input id={fid} type="date" value={edit.dueDate} onChange={(e) => setEdit({ ...edit, dueDate: e.target.value })} />}</Field>
      </Modal>
      <Modal open={dlg === 'status'} title={t('Change status')} onClose={() => setDlg(null)}
        footer={<Button busy={act.busy} onClick={() => act.run(async () => { await api.post(`/matters/${m.id}/status`, status); setDlg(null); await reload(); })}>{t('Save')}</Button>}>
        <Field label={t('Status')}>{(fid) => <Select id={fid} value={status.status} onChange={(e) => setStatus({ ...status, status: e.target.value })} options={['OPEN', 'IN_PROGRESS', 'AWAITING_INFO', 'CLOSED'].map((s) => ({ value: s, label: label(s) }))} />}</Field>
        <Field label={t('Comment')}>{(fid) => <Textarea id={fid} value={status.comment} onChange={(e) => setStatus({ ...status, comment: e.target.value })} />}</Field>
      </Modal>
      <Modal open={dlg === 'hold'} title={m.legalHold ? t('Release legal hold') : t('Place legal hold')} onClose={() => setDlg(null)}
        footer={<Button busy={act.busy} disabled={holdReason.trim().length < 3} onClick={() => act.run(async () => { await api.post('/holds', { scopeType: 'MATTER', scopeId: m.id, on: !m.legalHold, reason: holdReason }); setDlg(null); await reload(); })}>{t('Confirm')}</Button>}>
        <p className="text-sm text-slate-600">{t('Documents of a matter under legal hold cannot be deleted or disposed of.')}</p>
        <Field label={t('Reason')}>{(fid) => <Textarea id={fid} value={holdReason} onChange={(e) => setHoldReason(e.target.value)} />}</Field>
      </Modal>
      <Modal open={dlg === 'link'} title={t('Link a related matter')} onClose={() => setDlg(null)}>
        <Field label={t('Find matter')}>{(fid) => <Input id={fid} value={linkQ} onChange={(e) => setLinkQ(e.target.value)} />}</Field>
        <ul className="space-y-1">{links.data?.rows.filter((r) => r.id !== m.id).map((r) => <li key={r.id}><Button size="sm" variant="ghost" onClick={() => act.run(async () => { await api.post(`/matters/${m.id}/links`, { toId: r.id }); setDlg(null); await reload(); })}>{r.reference} — {r.title}</Button></li>)}</ul>
      </Modal>
    </div>
  );
}

export function WorkloadHint({ unit }: { unit: string }) {
  const { data } = useApi<{ rows: { userId: string; displayName: string; assignee: number; reviewer: number; overdue: number }[]; suggestion: string | null }>(`/matters/workload?unit=${unit}`);
  if (!data) return null;
  const s = data.rows.find((r) => r.userId === data.suggestion);
  return (
    <div className="rounded-md bg-slate-50 p-2 text-xs text-slate-700">
      <div className="mb-1 font-medium">{t('Open work in this unit')}</div>
      <ul className="grid grid-cols-2 gap-x-3">{data.rows.map((r) => <li key={r.userId}>{r.displayName}: {r.assignee}{r.overdue ? ` (${r.overdue} ${t('overdue')})` : ''}</li>)}</ul>
      {s ? <div className="mt-1 text-brand-700">{t('Suggestion: {name} has the lightest load.', { name: s.displayName })}</div> : null}
    </div>
  );
}
