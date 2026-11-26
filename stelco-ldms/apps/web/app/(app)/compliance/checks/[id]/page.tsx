'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useAction } from '@/lib/hooks';
import { fmtDate, fmtDateTime, label } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { DocumentsPanel } from '@/components/parts';
import { Alert, Badge, Button, Card, Field, PageHeader, Spinner, StatusBadge, Textarea } from '@/components/ui';

interface Item {
  id: string; response: string | null; answer: string | null; answeredAt: string | null; reminderCount: number; lastReminderAt: string | null; rating: string | null;
  obligation: { description: string; article: string | null; evidenceRequired: string | null; risk: string; law: { id: string; title: string } };
}
interface Cycle { id: string; departmentId: string; period: string; dueAt: string; status: string; items: Item[] }

/**
 * A department confirms each obligation itself: "Yes, we comply" closes it; "No" keeps it open and
 * the department is reminded until it is complied with. Legal can record an answer on the
 * department's behalf (e.g. received by email); that is marked in the audit trail.
 */
export default function CheckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me, can } = useAuth();
  const { data, reload, error } = useApi<Cycle>(`/compliance/cycles/${id}`);
  const depts = useApi<{ id: string; name: string }[]>('/config/departments');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const act = useAction();
  if (error) return <Alert>{error.message}</Alert>;
  if (!data) return <Spinner />;
  const dept = me?.departmentId === data.departmentId && can('portal:respond');
  const staff = can('cmp:write', 'CMP');
  const canAnswer = (dept || staff) && !['SUBMITTED', 'UNDER_REVIEW'].includes(data.status);
  const counts = { yes: data.items.filter((i) => i.answer === 'YES').length, no: data.items.filter((i) => i.answer === 'NO').length };
  const answer = (i: Item, a: 'YES' | 'NO') => act.run(async () => { await api.post(`/compliance/items/${i.id}/answer`, { answer: a, comment: notes[i.id] ?? i.response ?? null }); await reload(); });
  return (
    <div className="space-y-4">
      <PageHeader title={t('Compliance confirmation {p}', { p: data.period })}
        subtitle={<>{depts.data?.find((d) => d.id === data.departmentId)?.name ?? ''} · {t('Due')} {fmtDate(data.dueAt)} · <StatusBadge value={data.status} /></>}
        actions={<Link href="/compliance"><Button variant="ghost">{t('Back')}</Button></Link>} />
      <Card>
        <p className="text-sm text-slate-700">{t('For each obligation, confirm whether your department complies. "Yes" closes it. "No" keeps it open and you will be reminded until it is complied with. You will be asked again every year.')}</p>
        <div className="mt-2 flex flex-wrap gap-2 text-sm"><Badge tone="green">{t('Yes')}: {counts.yes}</Badge><Badge tone="red">{t('No')}: {counts.no}</Badge><Badge tone="amber">{t('Not answered')}: {data.items.length - counts.yes - counts.no}</Badge></div>
        {staff && !dept ? <p className="mt-2 text-xs text-slate-500">{t('You are Legal staff: an answer you record is marked as given on the department’s behalf.')}</p> : null}
      </Card>
      {act.error ? <Alert>{act.error}</Alert> : null}
      {data.items.map((i, n) => (
        <Card key={i.id} title={<span>{n + 1}. {i.obligation.description}</span>}
          actions={<><StatusBadge value={i.obligation.risk} />{i.answer ? <Badge tone={i.answer === 'YES' ? 'green' : 'red'}>{i.answer === 'YES' ? t('Complies') : t('Does not comply')}</Badge> : <Badge tone="amber">{t('Not answered')}</Badge>}</>}>
          <p className="mb-2 text-xs text-slate-500"><Link className="underline" href={`/compliance/laws/${i.obligation.law.id}`}>{i.obligation.law.title}</Link>{i.obligation.article ? ` · ${i.obligation.article}` : ''}{i.obligation.evidenceRequired ? ` · ${t('Evidence')}: ${i.obligation.evidenceRequired}` : ''}</p>
          {i.answeredAt ? <p className="text-xs text-slate-500">{t('Answered')} {fmtDateTime(i.answeredAt)}{i.reminderCount ? ` · ${t('{n} reminder(s) sent', { n: i.reminderCount })}` : ''}</p> : i.reminderCount ? <p className="text-xs text-slate-500">{t('{n} reminder(s) sent', { n: i.reminderCount })}</p> : null}
          {canAnswer ? (
            <div className="mt-2 space-y-2">
              <Field label={t('Comment (optional)')}>{(fid) => <Textarea id={fid} value={notes[i.id] ?? i.response ?? ''} onChange={(e) => setNotes({ ...notes, [i.id]: e.target.value })} />}</Field>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={i.answer === 'YES' ? 'primary' : 'secondary'} busy={act.busy} onClick={() => answer(i, 'YES')}>{t('Yes, we comply')}</Button>
                <Button size="sm" variant={i.answer === 'NO' ? 'danger' : 'secondary'} busy={act.busy} onClick={() => answer(i, 'NO')}>{t('No, not yet')}</Button>
              </div>
            </div>
          ) : i.response ? <p className="mt-2 whitespace-pre-wrap text-sm">{i.response}</p> : null}
          {i.rating ? <p className="mt-2 text-xs text-slate-500">{t('Earlier officer rating')}: {label(i.rating)}</p> : null}
          <div className="mt-3"><DocumentsPanel ownerType="checkItem" ownerId={i.id} canWrite={!!canAnswer} title={t('Evidence (optional)')} /></div>
        </Card>
      ))}
    </div>
  );
}
