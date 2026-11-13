'use client';
import { UPLOAD_ACCEPT } from '@ldms/shared';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useAction } from '@/lib/hooks';
import { fromLocalInput, toLocalInput } from '@/lib/format';
import { t } from '@/lib/i18n';
import { UNITS, UNIT_NAMES } from '@ldms/shared';
import { Alert, Button, Card, Field, Input, PageHeader, Select, Textarea } from '@/components/ui';
import { EmailFrame } from '@/components/parts';

interface Parsed { senderName: string; senderEmail: string; receivedAt: string | null; subject: string; summary: string; emailRef: string | null; htmlSanitized: string | null; attachments: { filename: string; size: number }[] }

export default function NewIntake() {
  const router = useRouter();
  const depts = useApi<{ id: string; name: string }[]>('/config/departments');
  const emailRef = useRef<HTMLInputElement>(null);
  const attRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [drag, setDrag] = useState(false);
  const [f, setF] = useState({ source: 'EMAIL', receivedAt: toLocalInput(new Date()), senderName: '', senderEmail: '', senderDeptId: '', subject: '', summary: '', emailRef: '', priority: 'NORMAL', dueDate: '', suggestedUnit: '' });
  const act = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const parseFile = (file: File) => act.run(async () => {
    const dt = new DataTransfer();
    dt.items.add(file);
    if (emailRef.current) emailRef.current.files = dt.files;
    const fd = new FormData();
    fd.set('email', file);
    const p = await api.form<Parsed>('/intake/parse-email', fd);
    setParsed(p);
    setF((cur) => ({ ...cur, source: 'EMAIL', senderName: p.senderName, senderEmail: p.senderEmail, subject: p.subject, summary: p.summary, emailRef: p.emailRef ?? '', receivedAt: p.receivedAt ? toLocalInput(p.receivedAt) : cur.receivedAt }));
  });

  const save = () => act.run(async () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(f)) if (v) fd.set(k, k === 'receivedAt' ? fromLocalInput(v) : k === 'dueDate' ? new Date(`${v}T16:00:00+05:00`).toISOString() : v);
    const ef = emailRef.current?.files?.[0];
    if (ef) fd.set('email', ef);
    for (const a of Array.from(attRef.current?.files ?? [])) fd.append('attachments', a);
    const r = await api.form<{ id: string }>('/intake', fd);
    router.push(`/intake/${r.id}`);
  });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t('New intake')} subtitle={t('Record a request received by email, letter, phone or walk-in.')} />
      <div className="space-y-4">
        <Card title={t('1. Saved Outlook email (optional)')}>
          <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const file = e.dataTransfer.files[0]; if (file) void parseFile(file); }}
            className={`rounded-lg border-2 border-dashed p-6 text-center text-sm ${drag ? 'border-brand-500 bg-brand-50' : 'border-slate-300'}`}>
            <p>{t('Drag a saved email (.msg or .eml) here, or')}</p>
            <label className="mt-2 inline-block cursor-pointer text-brand-700 underline">
              {t('choose a file')}
              <input ref={emailRef} type="file" accept=".msg,.eml" className="sr-only" onChange={(e) => { const file = e.target.files?.[0]; if (file) void parseFile(file); }} />
            </label>
            <p className="mt-2 text-xs text-slate-500">{t('The sender, date, subject, body and attachments are read to pre-fill the form. Check them before saving. The original file is kept and virus-scanned.')}</p>
          </div>
          {parsed ? (
            <div className="mt-3 space-y-2">
              <Alert tone="blue">{t('Email read. {n} attachment(s) will be saved and scanned.', { n: parsed.attachments.length })} {parsed.attachments.map((a) => a.filename).join(', ')}</Alert>
              {parsed.htmlSanitized ? <EmailFrame html={parsed.htmlSanitized} /> : null}
            </div>
          ) : null}
        </Card>
        <Card title={t('2. Request details')}>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            {act.error ? <div className="sm:col-span-2"><Alert>{act.error}</Alert></div> : null}
            <Field label={t('Source')} required>{(id) => <Select id={id} value={f.source} onChange={set('source')} options={['EMAIL', 'LETTER', 'PHONE', 'WALKIN'].map((s) => ({ value: s, label: t(s === 'WALKIN' ? 'Walk-in' : s.charAt(0) + s.slice(1).toLowerCase()) }))} />}</Field>
            <Field label={t('Received (date and time)')} required>{(id) => <Input id={id} type="datetime-local" value={f.receivedAt} onChange={set('receivedAt')} required />}</Field>
            <Field label={t('Sender name')} required>{(id) => <Input id={id} value={f.senderName} onChange={set('senderName')} required />}</Field>
            <Field label={t('Sender email')}>{(id) => <Input id={id} type="email" value={f.senderEmail} onChange={set('senderEmail')} />}</Field>
            <Field label={t('Sender department')}>{(id) => <Select id={id} placeholder={t('— Select —')} value={f.senderDeptId} onChange={set('senderDeptId')} options={(depts.data ?? []).map((d) => ({ value: d.id, label: d.name }))} />}</Field>
            <Field label={t('Likely unit')}>{(id) => <Select id={id} placeholder={t('— Not sure —')} value={f.suggestedUnit} onChange={set('suggestedUnit')} options={UNITS.map((u) => ({ value: u, label: UNIT_NAMES[u] }))} />}</Field>
            <div className="sm:col-span-2"><Field label={t('Subject')} required>{(id) => <Input id={id} value={f.subject} onChange={set('subject')} required maxLength={300} />}</Field></div>
            <div className="sm:col-span-2"><Field label={t('Summary')}>{(id) => <Textarea id={id} rows={6} value={f.summary} onChange={set('summary')} />}</Field></div>
            <Field label={t('Original email reference')} hint={t('Filled from the email Message-ID when you upload one.')}>{(id) => <Input id={id} value={f.emailRef} onChange={set('emailRef')} />}</Field>
            <Field label={t('Priority')}>{(id) => <Select id={id} value={f.priority} onChange={set('priority')} options={['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => ({ value: p, label: t(p.charAt(0) + p.slice(1).toLowerCase()) }))} />}</Field>
            <Field label={t('Requested due date')}>{(id) => <Input id={id} type="date" value={f.dueDate} onChange={set('dueDate')} />}</Field>
            <Field label={t('Other attachments')}>{(id) => <input id={id} ref={attRef} type="file" multiple accept={UPLOAD_ACCEPT} className="block w-full text-sm" />}</Field>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button type="button" variant="secondary" onClick={() => router.back()}>{t('Cancel')}</Button>
              <Button type="submit" busy={act.busy}>{t('Save intake')}</Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
