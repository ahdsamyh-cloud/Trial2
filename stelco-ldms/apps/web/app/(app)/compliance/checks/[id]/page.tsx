'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useAction } from '@/lib/hooks';
import { fmtDate, label } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { DocumentsPanel } from '@/components/parts';
import { Alert, Badge, Button, Card, Field, PageHeader, Select, Spinner, StatusBadge, Textarea } from '@/components/ui';

interface Cycle { id: string; departmentId: string; period: string; dueAt: string; status: string; items: { id: string; response: string | null; rating: string | null; reviewNote: string | null; findings: { id: string; status: string }[]; obligation: { description: string; article: string | null; evidenceRequired: string | null; risk: string; law: { id: string; title: string } } }[] }

export default function CheckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me, can } = useAuth();
  const { data, reload, error } = useApi<Cycle>(`/compliance/cycles/${id}`);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [rating, setRating] = useState<Record<string, { rating: string; note: string }>>({});
  const [returnNote, setReturnNote] = useState('');
  const act = useAction();
  if (error) return <Alert>{error.message}</Alert>;
  if (!data) return <Spinner />;
  const dept = me?.departmentId === data.departmentId && can('portal:respond');
  const editable = dept && ['ISSUED', 'IN_PROGRESS'].includes(data.status);
  const reviewer = can('cmp:review', 'CMP') && ['SUBMITTED', 'UNDER_REVIEW'].includes(data.status);
  return (
    <div className="space-y-4">
      <PageHeader title={t('Compliance checklist {p}', { p: data.period })} subtitle={<>{t('Due')} {fmtDate(data.dueAt)} · <StatusBadge value={data.status} /></>}
        actions={<>
          {editable ? <Button busy={act.busy} onClick={() => act.run(async () => { await api.post(`/compliance/cycles/${id}/submit`); await reload(); })}>{t('Submit to Legal')}</Button> : null}
          <Link href="/compliance"><Button variant="ghost">{t('Back')}</Button></Link>
        </>} />
      {act.error ? <Alert>{act.error}</Alert> : null}
      {data.items.map((i, n) => (
        <Card key={i.id} title={<span>{n + 1}. {i.obligation.description}</span>} actions={<><StatusBadge value={i.obligation.risk} />{i.rating ? <StatusBadge value={i.rating} /> : null}</>}>
          <p className="mb-2 text-xs text-slate-500"><Link className="underline" href={`/compliance/laws/${i.obligation.law.id}`}>{i.obligation.law.title}</Link>{i.obligation.article ? ` · ${i.obligation.article}` : ''}{i.obligation.evidenceRequired ? ` · ${t('Evidence')}: ${i.obligation.evidenceRequired}` : ''}</p>
          {editable ? (
            <div className="space-y-2">
              <Field label={t('Your answer')}>{(fid) => <Textarea id={fid} value={answers[i.id] ?? i.response ?? ''} onChange={(e) => setAnswers({ ...answers, [i.id]: e.target.value })} />}</Field>
              <Button size="sm" variant="secondary" busy={act.busy} onClick={() => act.run(async () => { await api.post(`/compliance/items/${i.id}/response`, { response: answers[i.id] ?? i.response ?? '' }); await reload(); })}>{t('Save answer')}</Button>
            </div>
          ) : <p className="whitespace-pre-wrap text-sm">{i.response ?? <span className="text-slate-400">{t('No answer yet')}</span>}</p>}
          <div className="mt-3"><DocumentsPanel ownerType="checkItem" ownerId={i.id} canWrite={!!editable} title={t('Evidence')} /></div>
          {i.reviewNote ? <p className="mt-2 text-sm"><strong>{t('Reviewer')}:</strong> {i.reviewNote}</p> : null}
          {i.findings.map((f) => <Link key={f.id} href={`/compliance/findings/${f.id}`} className="mt-2 inline-block"><Badge tone="red">{t('Finding')} · {label(f.status)}</Badge></Link>)}
          {reviewer && !i.rating ? (
            <div className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-3">
              <Field label={t('Rating')}>{(fid) => <Select id={fid} placeholder={t('— Select —')} value={rating[i.id]?.rating ?? ''} onChange={(e) => setRating({ ...rating, [i.id]: { note: rating[i.id]?.note ?? '', rating: e.target.value } })} options={['COMPLIANT', 'PARTIAL', 'NON_COMPLIANT', 'NA'].map((x) => ({ value: x, label: x === 'NA' ? t('Not applicable') : label(x) }))} />}</Field>
              <div className="sm:col-span-2"><Field label={t('Note')}>{(fid) => <Textarea id={fid} value={rating[i.id]?.note ?? ''} onChange={(e) => setRating({ ...rating, [i.id]: { rating: rating[i.id]?.rating ?? '', note: e.target.value } })} />}</Field></div>
              <Button size="sm" disabled={!rating[i.id]?.rating} busy={act.busy} onClick={() => act.run(async () => { await api.post(`/compliance/items/${i.id}/rating`, { rating: rating[i.id]!.rating, note: rating[i.id]!.note || undefined }); await reload(); })}>{t('Save rating')}</Button>
            </div>
          ) : null}
        </Card>
      ))}
      {reviewer ? (
        <Card title={t('Return to the department')}>
          <Field label={t('What is missing?')}>{(fid) => <Textarea id={fid} value={returnNote} onChange={(e) => setReturnNote(e.target.value)} />}</Field>
          <Button className="mt-2" variant="secondary" disabled={returnNote.length < 3} onClick={() => act.run(async () => { await api.post(`/compliance/cycles/${id}/return`, { note: returnNote }); await reload(); })}>{t('Return for more evidence')}</Button>
        </Card>
      ) : null}
    </div>
  );
}
