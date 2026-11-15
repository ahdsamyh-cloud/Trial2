'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useAction } from '@/lib/hooks';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fmtDate, fmtDateTime, fmtMoney, label } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Alert, Badge, Button, Card, DL, Empty, Field, Input, Modal, Select, Spinner, StatusBadge, Textarea } from './ui';
import { UserSelect } from './parts';
import { WorkloadHint, type MatterDetail } from './matter-view';

interface VersionRow { version: number; id: string; reference: string; title: string; status: string; createdAt: string; closedAt: string | null; current: boolean; drafterName: string | null; documents: { id: string; title: string; versions: number; latest: { filename: string; stageLabel: string | null } | null }[] }
interface ExternalRow { id: string; firmId: string; lawyerId: string | null; firm: { name: string }; lawyer: { name: string } | null; scope: string; sentAt: string; dueAt: string | null; receivedAt: string | null; status: string; fee: string | null; currency: string; notes: string | null; overdue: boolean }
const day = (d?: string | null) => (d ? new Date(new Date(d).getTime() + 5 * 3600_000).toISOString().slice(0, 10) : '');
const iso = (s?: string) => (s ? new Date(`${s}T09:00:00+05:00`).toISOString() : null);

interface Drafting {
  counterparty: string | null; contractValue: string | null; currency: string; approvalLevel: string; escalationReason: string | null; followUpDate: string | null;
  drafterName: string | null; reviewerName: string | null;
  reviews: { id: string; round: number; reviewerName: string; decision: string | null; comments: string | null; decidedAt: string | null }[];
  approvals: { id: string; level: string; approverName: string; decision: string; reason: string | null; at: string }[];
  actions: { action: string; label: string; requiresComment: boolean }[];
}

const STEPS = ['REGISTERED', 'ASSIGNED', 'IN_DRAFTING', 'SUBMITTED_FOR_REVIEW', 'REVIEWED', 'PENDING_APPROVAL', 'APPROVED', 'SENT_TO_REQUESTER', 'CLOSED'];
const DANGER = ['cancel', 'reject', 'return_correction', 'return_from_approval'];

export function DraftingPanel({ m, reloadMatter }: { m: MatterDetail; reloadMatter: () => Promise<void> }) {
  const { data: d, reload, error } = useApi<Drafting>(`/drafting/requests/${m.id}`);
  const [pending, setPending] = useState<{ action: string; label: string; requiresComment: boolean } | null>(null);
  const [form, setForm] = useState({ comment: '', assigneeId: '', reviewerId: '', followUpDate: '' });
  const act = useAction();
  const router = useRouter();
  const versions = useApi<VersionRow[]>(`/drafting/requests/${m.id}/versions`);
  const externals = useApi<ExternalRow[]>(`/drafting/requests/${m.id}/externals`);
  const firms = useApi<{ id: string; name: string }[]>('/config/law-firms');
  const lawyers = useApi<{ id: string; name: string; firmId: string }[]>('/config/external-lawyers');
  const [dlg, setDlg] = useState<'newVersion' | 'external' | 'editExternal' | 'details' | null>(null);
  const [ef, setEf] = useState<Record<string, string>>({});
  const [selExt, setSelExt] = useState('');
  const setE = (k: string) => (e: { target: { value: string } }) => setEf((f) => ({ ...f, [k]: e.target.value }));
  if (error) return <Alert>{error.message}</Alert>;
  if (!d) return <Spinner />;
  const canWrite = m.canWrite;
  const current = m.status === 'PENDING_HOD_APPROVAL' ? 'PENDING_APPROVAL' : m.status === 'RETURNED_FOR_CORRECTION' || m.status === 'AWAITING_INFO' ? 'IN_DRAFTING' : m.status === 'FOLLOW_UP_REQUIRED' ? 'SENT_TO_REQUESTER' : m.status;
  const idx = STEPS.indexOf(current);

  const run = (a: { action: string; label: string; requiresComment: boolean }) => {
    if (a.requiresComment || a.action === 'assign' || a.action === 'require_follow_up' || a.action === 'approve' || a.action === 'hod_approve') { setForm({ comment: '', assigneeId: '', reviewerId: '', followUpDate: '' }); setPending(a); return; }
    void act.run(async () => { await api.post(`/drafting/requests/${m.id}/actions`, { action: a.action }); await reload(); await reloadMatter(); });
  };
  const submit = () => act.run(async () => {
    await api.post(`/drafting/requests/${m.id}/actions`, {
      action: pending!.action, comment: form.comment || undefined, assigneeId: form.assigneeId || undefined, reviewerId: form.reviewerId || undefined,
      followUpDate: form.followUpDate ? new Date(`${form.followUpDate}T16:00:00+05:00`).toISOString() : undefined,
    });
    setPending(null); await reload(); await reloadMatter();
  });

  return (
    <>
      <Card title={t('Workflow')}>
        <ol className="mb-4 flex flex-wrap gap-1 text-xs" aria-label={t('Progress')}>
          {STEPS.map((s, i) => <li key={s} aria-current={i === idx ? 'step' : undefined} className={`rounded-full px-2 py-1 ${i < idx ? 'bg-green-100 text-green-800' : i === idx ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{label(s)}</li>)}
        </ol>
        {['AWAITING_INFO', 'RETURNED_FOR_CORRECTION', 'PENDING_HOD_APPROVAL', 'FOLLOW_UP_REQUIRED', 'CANCELLED', 'REJECTED'].includes(m.status) ? <div className="mb-3"><StatusBadge value={m.status} /></div> : null}
        {act.error ? <Alert>{act.error}</Alert> : null}
        <div className="flex flex-wrap gap-2">
          {d.actions.length ? d.actions.map((a) => <Button key={a.action} variant={DANGER.includes(a.action) ? 'secondary' : 'primary'} size="sm" busy={act.busy} onClick={() => run(a)}>{t(a.label)}</Button>) : <p className="text-sm text-slate-500">{t('No action for you at this stage.')}</p>}
        </div>
        {canWrite ? <div className="mt-3"><Button size="sm" variant="ghost" onClick={() => { setEf({ counterparty: d.counterparty ?? '', contractValue: d.contractValue ?? '', currency: d.currency }); setDlg('details'); }}>{t('Edit details')}</Button></div> : null}
        <div className="mt-4"><DL items={[
          [t('Drafter (maker)'), d.drafterName ?? '—'], [t('Reviewer (checker)'), d.reviewerName ?? '—'], [t('Approval by'), d.approvalLevel === 'HOD' ? t('HoD') : t('Unit Head')],
          [t('Why HoD'), d.escalationReason ?? '—'], [t('Counterparty'), d.counterparty ?? '—'], [t('Contract value'), fmtMoney(d.contractValue, d.currency)], [t('Follow-up date'), fmtDate(d.followUpDate)],
        ]} /></div>
      </Card>
      {d.reviews.length || d.approvals.length ? (
        <Card title={t('Reviews and approvals')}>
          <ul className="space-y-2 text-sm">
            {d.reviews.map((r) => <li key={r.id}><Badge tone={r.decision === 'RETURNED' ? 'amber' : r.decision ? 'green' : 'blue'}>{t('Review round {n}', { n: r.round })}</Badge> {r.reviewerName} · {r.decision ? label(r.decision) : t('in review')} {r.decidedAt ? `· ${fmtDateTime(r.decidedAt)}` : ''}{r.comments ? <p className="mt-1 whitespace-pre-wrap text-slate-700">{r.comments}</p> : null}</li>)}
            {d.approvals.map((a) => <li key={a.id}><Badge tone={a.decision === 'APPROVED' ? 'green' : a.decision === 'ESCALATED' ? 'purple' : 'amber'}>{label(a.level)}</Badge> {a.approverName} · {label(a.decision)} · {fmtDateTime(a.at)}{a.reason ? <p className="mt-1 text-slate-700">{a.reason}</p> : null}</li>)}
          </ul>
        </Card>
      ) : null}
      <Card title={t('Versions of this request')} actions={canWrite ? <Button size="sm" variant="secondary" onClick={() => { setEf({ title: m.title, note: '' }); setDlg('newVersion'); }}>{t('Start a new version')}</Button> : null}>
        <p className="mb-2 text-xs text-slate-500">{t('When the same request comes again (renewal, revised policy...), start a new version: earlier work stays linked and visible here.')}</p>
        {!versions.data ? <Spinner /> : versions.data.length <= 1 ? <p className="text-sm text-slate-600">{t('This is the first version.')}</p> : (
          <ol className="space-y-2 text-sm" data-testid="request-versions">
            {versions.data.map((v) => (
              <li key={v.id} className={`rounded-md border p-2 ${v.current ? 'border-brand-600 bg-brand-50' : 'border-slate-200'}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span><Badge tone="blue">{t('Version {n}', { n: v.version })}</Badge> {v.current ? <strong>{v.reference}</strong> : <Link className="underline" href={`/drafting/${v.id}`}>{v.reference}</Link>} · {v.title}</span>
                  <span className="flex items-center gap-2 text-xs text-slate-500"><StatusBadge value={v.status} />{fmtDate(v.createdAt)}{v.closedAt ? ` → ${fmtDate(v.closedAt)}` : ''}</span>
                </div>
                <div className="text-xs text-slate-600">{t('Drafter')}: {v.drafterName ?? '—'} · {v.documents.length ? v.documents.map((doc) => `${doc.title} (v${doc.versions}${doc.latest?.stageLabel ? `, ${label(doc.latest.stageLabel)}` : ''})`).join('; ') : t('no documents')}</div>
              </li>
            ))}
          </ol>
        )}
      </Card>
      <Card title={t('External lawyers')} actions={canWrite ? <Button size="sm" variant="secondary" onClick={() => { setEf({ sentAt: day(new Date().toISOString()), currency: 'MVR' }); setDlg('external'); }}>{t('Send to external lawyer')}</Button> : null}>
        {!externals.data ? <Spinner /> : !externals.data.length ? <Empty>{t('Not sent to an external lawyer')}</Empty> : (
          <ul className="space-y-2 text-sm">
            {externals.data.map((x) => (
              <li key={x.id} className="rounded-md border p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{x.firm.name}{x.lawyer ? ` · ${x.lawyer.name}` : ''}</span>
                  <span className="flex items-center gap-1"><StatusBadge value={x.status} />{x.overdue ? <Badge tone="red">{t('Overdue')}</Badge> : null}</span>
                </div>
                <p className="whitespace-pre-wrap">{x.scope}</p>
                <div className="text-xs text-slate-600">{t('Sent')} {fmtDate(x.sentAt)} · {t('Due')} {fmtDate(x.dueAt)} · {t('Received')} {fmtDate(x.receivedAt)}{x.fee ? ` · ${fmtMoney(x.fee, x.currency)}` : ''}</div>
                {x.notes ? <p className="text-xs text-slate-600">{x.notes}</p> : null}
                {canWrite ? <div className="mt-1 flex flex-wrap gap-1">
                  {x.status === 'SENT' ? <Button size="sm" variant="ghost" onClick={() => act.run(async () => { await api.patch(`/drafting/externals/${x.id}`, { status: 'RECEIVED' }); await externals.reload(); })}>{t('Mark received')}</Button> : null}
                  <Button size="sm" variant="ghost" onClick={() => { setSelExt(x.id); setEf({ firmId: x.firmId, lawyerId: x.lawyerId ?? '', scope: x.scope, sentAt: day(x.sentAt), dueAt: day(x.dueAt), receivedAt: day(x.receivedAt), status: x.status, fee: x.fee ?? '', currency: x.currency, notes: x.notes ?? '' }); setDlg('editExternal'); }}>{t('Edit')}</Button>
                </div> : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-slate-500">{t('Upload what the external lawyer sends back in Documents (type "Work from external lawyer").')}</p>
      </Card>
      <Modal open={dlg === 'newVersion'} title={t('Start a new version of this request')} onClose={() => setDlg(null)} footer={<Button busy={act.busy} onClick={() => act.run(async () => { const r = await api.post<{ id: string }>(`/drafting/requests/${m.id}/new-version`, { title: ef.title, note: ef.note || null }); setDlg(null); router.push(`/drafting/${r.id}`); })}>{t('Create')}</Button>}>
        {act.error ? <Alert>{act.error}</Alert> : null}
        <p className="text-sm text-slate-600">{t('A new request is registered and linked to this one, keeping the requester, counterparty and value. This request stays as it is.')}</p>
        <Field label={t('Title')}>{(id) => <Input id={id} value={ef.title ?? ''} onChange={setE('title')} />}</Field>
        <Field label={t('What is different this time')}>{(id) => <Textarea id={id} value={ef.note ?? ''} onChange={setE('note')} />}</Field>
      </Modal>
      <Modal open={dlg === 'external' || dlg === 'editExternal'} title={dlg === 'external' ? t('Send to external lawyer') : t('Edit external engagement')} onClose={() => setDlg(null)} footer={<Button busy={act.busy} onClick={() => act.run(async () => {
        const body = { firmId: ef.firmId, lawyerId: ef.lawyerId || null, scope: ef.scope ?? '', sentAt: iso(ef.sentAt) ?? undefined, dueAt: iso(ef.dueAt), fee: ef.fee || null, currency: ef.currency || 'MVR', notes: ef.notes || null };
        if (dlg === 'external') await api.post(`/drafting/requests/${m.id}/externals`, body);
        else await api.patch(`/drafting/externals/${selExt}`, { ...body, status: ef.status, receivedAt: iso(ef.receivedAt) });
        setDlg(null); await externals.reload();
      })}>{t('Save')}</Button>}>
        {act.error ? <Alert>{act.error}</Alert> : null}
        <Field label={t('Law firm')} required>{(id) => <Select id={id} placeholder={t('— Select —')} value={ef.firmId ?? ''} onChange={(e) => setEf((f) => ({ ...f, firmId: e.target.value, lawyerId: '' }))} options={(firms.data ?? []).map((f) => ({ value: f.id, label: f.name }))} />}</Field>
        <Field label={t('Lawyer')}>{(id) => <Select id={id} placeholder={t('Any lawyer of the firm')} value={ef.lawyerId ?? ''} onChange={setE('lawyerId')} options={(lawyers.data ?? []).filter((l) => l.firmId === ef.firmId).map((l) => ({ value: l.id, label: l.name }))} />}</Field>
        <Field label={t('Work given to them')} required>{(id) => <Textarea id={id} value={ef.scope ?? ''} onChange={setE('scope')} />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Sent on')}>{(id) => <Input id={id} type="date" value={ef.sentAt ?? ''} onChange={setE('sentAt')} />}</Field>
          <Field label={t('Due back on')}>{(id) => <Input id={id} type="date" value={ef.dueAt ?? ''} onChange={setE('dueAt')} />}</Field>
          {dlg === 'editExternal' ? <Field label={t('Status')}>{(id) => <Select id={id} value={ef.status ?? 'SENT'} onChange={setE('status')} options={['SENT', 'RECEIVED', 'CANCELLED'].map((x) => ({ value: x, label: label(x) }))} />}</Field> : null}
          {dlg === 'editExternal' ? <Field label={t('Received on')}>{(id) => <Input id={id} type="date" value={ef.receivedAt ?? ''} onChange={setE('receivedAt')} />}</Field> : null}
          <Field label={t('Fee')}>{(id) => <Input id={id} inputMode="decimal" value={ef.fee ?? ''} onChange={setE('fee')} />}</Field>
          <Field label={t('Currency')}>{(id) => <Input id={id} maxLength={3} value={ef.currency ?? ''} onChange={setE('currency')} />}</Field>
        </div>
        <Field label={t('Notes')}>{(id) => <Textarea id={id} value={ef.notes ?? ''} onChange={setE('notes')} />}</Field>
      </Modal>
      <Modal open={dlg === 'details'} title={t('Edit request details')} onClose={() => setDlg(null)} footer={<Button busy={act.busy} onClick={() => act.run(async () => { await api.patch(`/drafting/requests/${m.id}`, { counterparty: ef.counterparty || null, contractValue: ef.contractValue || null, currency: ef.currency || 'MVR' }); setDlg(null); await reload(); })}>{t('Save')}</Button>}>
        {act.error ? <Alert>{act.error}</Alert> : null}
        <Field label={t('Counterparty')}>{(id) => <Input id={id} value={ef.counterparty ?? ''} onChange={setE('counterparty')} />}</Field>
        <Field label={t('Contract value')}>{(id) => <Input id={id} inputMode="decimal" value={ef.contractValue ?? ''} onChange={setE('contractValue')} />}</Field>
        <Field label={t('Currency')}>{(id) => <Input id={id} maxLength={3} value={ef.currency ?? ''} onChange={setE('currency')} />}</Field>
      </Modal>
      <Modal open={!!pending} title={pending ? t(pending.label) : ''} onClose={() => setPending(null)} footer={<><Button variant="secondary" onClick={() => setPending(null)}>{t('Cancel')}</Button><Button busy={act.busy} onClick={submit}>{t('Confirm')}</Button></>}>
        {act.error ? <Alert>{act.error}</Alert> : null}
        {pending?.action === 'assign' ? <>
          <WorkloadHint unit="DRF" />
          <UserSelect unit="DRF" labelText={t('Lawyer (maker)')} value={form.assigneeId} onChange={(v) => setForm({ ...form, assigneeId: v })} />
          <UserSelect unit="DRF" labelText={t('Reviewer (checker)')} exclude={[form.assigneeId]} value={form.reviewerId} onChange={(v) => setForm({ ...form, reviewerId: v })} />
        </> : null}
        {pending?.action === 'approve' || pending?.action === 'hod_approve' ? <Alert tone="blue">{t('Make sure the final version is uploaded with stage "Final".')}</Alert> : null}
        {pending?.action === 'require_follow_up' ? <Field label={t('Follow-up date')} required>{(id) => <Input id={id} type="date" value={form.followUpDate} onChange={(e) => setForm({ ...form, followUpDate: e.target.value })} />}</Field> : null}
        <Field label={pending?.requiresComment ? t('Reason / comments') : t('Comment (optional)')} required={pending?.requiresComment}>{(id) => <Textarea id={id} value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} />}</Field>
      </Modal>
    </>
  );
}
