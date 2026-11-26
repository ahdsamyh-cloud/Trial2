'use client';
import { use, useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useAction } from '@/lib/hooks';
import { fmtDate, fmtDateTime, label } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { DocumentsPanel } from '@/components/parts';
import { Alert, Button, Card, DL, Field, PageHeader, Spinner, StatusBadge, Textarea } from '@/components/ui';

interface Finding { id: string; title: string; severity: string; status: string; dueOn: string; actionPlan: string | null; departmentId: string; escalatedAt: string | null; actions: { id: string; note: string; at: string }[]; checkItem: { obligation: { description: string; law: { title: string } } } | null }

export default function FindingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const { data: f, reload, error } = useApi<Finding>(`/compliance/findings/${id}`);
  const [plan, setPlan] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const act = useAction();
  if (error) return <Alert>{error.message}</Alert>;
  if (!f) return <Spinner />;
  const officer = can('cmp:review', 'CMP');
  const step = (to: string, extra: object = {}) => act.run(async () => { await api.post(`/compliance/findings/${id}/step`, { to, note: note || undefined, ...extra }); setNote(''); await reload(); });
  return (
    <div className="space-y-4">
      <PageHeader title={f.title} subtitle={<><StatusBadge value={f.severity} /> <StatusBadge value={f.status} /></>} />
      {act.error ? <Alert>{act.error}</Alert> : null}
      <Card title={t('Finding')}>
        <DL items={[[t('Obligation'), f.checkItem?.obligation.description ?? '—'], [t('Law'), f.checkItem?.obligation.law.title ?? '—'], [t('Remediation due'), fmtDate(f.dueOn)], [t('Escalated'), f.escalatedAt ? fmtDateTime(f.escalatedAt) : '—']]} />
      </Card>
      <Card title={t('Action plan')}>
        {f.status === 'OPEN' ? <>
          <Field label={t('What will be done, by whom and when')}>{(fid) => <Textarea id={fid} rows={5} value={plan ?? f.actionPlan ?? ''} onChange={(e) => setPlan(e.target.value)} />}</Field>
          <Button className="mt-2" busy={act.busy} onClick={() => step('ACTION_PLAN_AGREED', { actionPlan: plan ?? f.actionPlan ?? '' })}>{t('Save action plan')}</Button>
        </> : <p className="whitespace-pre-wrap text-sm">{f.actionPlan}</p>}
      </Card>
      <DocumentsPanel ownerType="finding" ownerId={id} canWrite={f.status !== 'CLOSED'} title={t('Evidence of closure')} />
      {f.status !== 'CLOSED' ? (
        <Card title={t('Next step')}>
          <Field label={t('Note')}>{(fid) => <Textarea id={fid} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          <div className="mt-2 flex flex-wrap gap-2">
            {f.status === 'ACTION_PLAN_AGREED' ? <Button busy={act.busy} onClick={() => step('EVIDENCE_SUBMITTED')}>{t('Submit evidence')}</Button> : null}
            {f.status === 'EVIDENCE_SUBMITTED' && officer ? <><Button busy={act.busy} onClick={() => step('CLOSED')}>{t('Verify and close')}</Button><Button variant="secondary" busy={act.busy} onClick={() => step('ACTION_PLAN_AGREED')}>{t('Reject evidence')}</Button></> : null}
          </div>
        </Card>
      ) : null}
      <Card title={t('Follow-up log')}><ul className="space-y-1 text-sm">{f.actions.map((a) => <li key={a.id}><span className="text-xs text-slate-500">{fmtDateTime(a.at)}</span> {label(a.note.replace(/→/g, 'to'))}</li>)}</ul></Card>
    </div>
  );
}
