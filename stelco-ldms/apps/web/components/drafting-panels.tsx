'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useAction } from '@/lib/hooks';
import { fmtDate, fmtDateTime, fmtMoney, label } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Alert, Badge, Button, Card, DL, Field, Input, Modal, Spinner, StatusBadge, Textarea } from './ui';
import { UserSelect } from './parts';
import { WorkloadHint, type MatterDetail } from './matter-view';

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
  if (error) return <Alert>{error.message}</Alert>;
  if (!d) return <Spinner />;
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
