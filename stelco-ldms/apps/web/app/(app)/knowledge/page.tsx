'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useAction } from '@/lib/hooks';
import { fmtDate, label } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Textarea } from '@/components/ui';

export default function Knowledge() {
  const { can } = useAuth();
  const write = can('awr:write', 'AWR');
  const bulletins = useApi<{ id: string; title: string; body: string; kind: string; publishedAt: string | null }[]>('/awareness/bulletins');
  const [q, setQ] = useState('');
  const faq = useApi<{ id: string; question: string; answer: string; tags: string[]; published: boolean }[]>(`/awareness/faq?q=${encodeURIComponent(q)}`, [q]);
  const [b, setB] = useState<{ title: string; body: string; kind: string } | null>(null);
  const [f, setF] = useState<{ question: string; answer: string; tags: string } | null>(null);
  const act = useAction();
  return (
    <div className="space-y-4">
      <PageHeader title={t('Bulletins & FAQ')} subtitle={t('Legal news, circulars and answers to common legal questions.')} />
      {act.error ? <Alert>{act.error}</Alert> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('Bulletins and newsletters')} actions={write ? <Button size="sm" onClick={() => setB({ title: '', body: '', kind: 'BULLETIN' })}>{t('Write')}</Button> : null}>
          {!bulletins.data?.length ? <Empty>{t('Nothing published yet')}</Empty> : <ul className="space-y-3">{bulletins.data.map((x) => (
            <li key={x.id} className="rounded border p-3"><div className="flex items-center justify-between gap-2"><span className="font-medium">{x.title}</span><span className="flex items-center gap-1"><Badge>{label(x.kind)}</Badge>{x.publishedAt ? <span className="text-xs text-slate-500">{fmtDate(x.publishedAt)}</span> : write ? <Button size="sm" onClick={() => act.run(async () => { await api.post(`/awareness/bulletins/${x.id}/publish`); await bulletins.reload(); })}>{t('Publish')}</Button> : null}</span></div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{x.body}</p></li>
          ))}</ul>}
        </Card>
        <Card title={t('Frequently asked legal questions')} actions={<><Input aria-label={t('Search FAQ')} className="w-48" placeholder={t('Search')} value={q} onChange={(e) => setQ(e.target.value)} />{write ? <Button size="sm" onClick={() => setF({ question: '', answer: '', tags: '' })}>{t('Add')}</Button> : null}</>}>
          {!faq.data?.length ? <Empty>{t('No questions yet')}</Empty> : <ul className="space-y-2">{faq.data.map((x) => <li key={x.id}><details className="rounded border p-2"><summary className="cursor-pointer text-sm font-medium">{x.question}</summary><p className="mt-1 whitespace-pre-wrap text-sm">{x.answer}</p></details></li>)}</ul>}
        </Card>
      </div>
      <Modal open={!!b} wide title={t('New bulletin')} onClose={() => setB(null)} footer={<Button busy={act.busy} onClick={() => act.run(async () => { await api.post('/awareness/bulletins', { ...b, audienceDeptIds: [] }); setB(null); await bulletins.reload(); })}>{t('Save draft')}</Button>}>
        {b ? <><Field label={t('Title')}>{(id) => <Input id={id} value={b.title} onChange={(e) => setB({ ...b, title: e.target.value })} />}</Field>
          <Field label={t('Kind')}>{(id) => <Select id={id} value={b.kind} onChange={(e) => setB({ ...b, kind: e.target.value })} options={['BULLETIN', 'NEWSLETTER', 'CIRCULAR'].map((x) => ({ value: x, label: label(x) }))} />}</Field>
          <Field label={t('Text')}>{(id) => <Textarea id={id} rows={10} value={b.body} onChange={(e) => setB({ ...b, body: e.target.value })} />}</Field></> : null}
      </Modal>
      <Modal open={!!f} title={t('Add FAQ')} onClose={() => setF(null)} footer={<Button busy={act.busy} onClick={() => act.run(async () => { await api.post('/awareness/faq', { question: f!.question, answer: f!.answer, tags: f!.tags.split(',').map((s) => s.trim()).filter(Boolean), published: true }); setF(null); await faq.reload(); })}>{t('Save')}</Button>}>
        {f ? <><Field label={t('Question')}>{(id) => <Input id={id} value={f.question} onChange={(e) => setF({ ...f, question: e.target.value })} />}</Field>
          <Field label={t('Answer')}>{(id) => <Textarea id={id} rows={6} value={f.answer} onChange={(e) => setF({ ...f, answer: e.target.value })} />}</Field>
          <Field label={t('Tags')}>{(id) => <Input id={id} value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} />}</Field></> : null}
      </Modal>
    </div>
  );
}
