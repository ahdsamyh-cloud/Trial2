'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { UNITS, UNIT_NAMES } from '@ldms/shared';
import { api } from '@/lib/api';
import { useApi, useAction } from '@/lib/hooks';
import { fmtDate } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Alert, Button, Card, Empty, Field, Input, PageHeader, Select, StatusBadge, Textarea } from '@/components/ui';

export default function Portal() {
  const list = useApi<{ rows: { id: string; reference: string; title: string; status: string; dueDate: string | null; createdAt: string }[] }>('/matters?pageSize=100');
  const [f, setF] = useState({ subject: '', summary: '', priority: 'NORMAL', dueDate: '', suggestedUnit: '' });
  const [done, setDone] = useState<string | null>(null);
  const files = useRef<HTMLInputElement>(null);
  const act = useAction();
  const submit = () => act.run(async () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(f)) if (v) fd.set(k, k === 'dueDate' ? new Date(`${v}T16:00:00+05:00`).toISOString() : v);
    for (const file of Array.from(files.current?.files ?? [])) fd.append('attachments', file);
    const r = await api.form<{ intakeNo: string }>('/portal/requests', fd);
    setDone(r.intakeNo);
    setF({ subject: '', summary: '', priority: 'NORMAL', dueDate: '', suggestedUnit: '' });
  });
  return (
    <div className="space-y-4">
      <PageHeader title={t('Legal requests')} subtitle={t('Ask the Legal Department for help and follow your department’s requests.')} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('New request')}>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            {done ? <Alert tone="green">{t('Request received. Your intake number is {n}. You will get a reference once Legal registers it.', { n: done })}</Alert> : null}
            {act.error ? <Alert>{act.error}</Alert> : null}
            <Field label={t('What do you need?')} required>{(id) => <Input id={id} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} required minLength={3} />}</Field>
            <Field label={t('Details')} required hint={t('Background, parties, deadlines, anything Legal should know.')}>{(id) => <Textarea id={id} rows={6} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} required minLength={10} />}</Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t('Type')}>{(id) => <Select id={id} placeholder={t('— Not sure —')} value={f.suggestedUnit} onChange={(e) => setF({ ...f, suggestedUnit: e.target.value })} options={UNITS.map((u) => ({ value: u, label: UNIT_NAMES[u] }))} />}</Field>
              <Field label={t('Priority')}>{(id) => <Select id={id} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} options={['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => ({ value: p, label: p.charAt(0) + p.slice(1).toLowerCase() }))} />}</Field>
              <Field label={t('Needed by')}>{(id) => <Input id={id} type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />}</Field>
            </div>
            <Field label={t('Attachments')}>{(id) => <input id={id} ref={files} type="file" multiple className="block w-full text-sm" />}</Field>
            <Button type="submit" busy={act.busy}>{t('Send to Legal')}</Button>
          </form>
        </Card>
        <Card title={t('Your department’s requests')}>
          {!list.data?.rows.length ? <Empty>{t('No registered requests yet.')}</Empty> : (
            <ul className="divide-y divide-slate-100">
              {list.data.rows.map((m) => (
                <li key={m.id}><Link href={`/matters/${m.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2 hover:bg-slate-50">
                  <div><div className="font-mono text-xs text-slate-500">{m.reference}</div><div className="text-sm font-medium">{m.title}</div></div>
                  <div className="flex items-center gap-2 text-xs"><StatusBadge value={m.status} />{fmtDate(m.dueDate)}</div>
                </Link></li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
