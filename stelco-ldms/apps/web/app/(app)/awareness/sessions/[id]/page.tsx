'use client';
import { use, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useAction } from '@/lib/hooks';
import { fmtDateTime, label } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { DocumentsPanel } from '@/components/parts';
import { Alert, Badge, Button, Card, DL, Empty, Field, Input, Modal, PageHeader, Spinner, StatusBadge, Textarea } from '@/components/ui';

interface Session {
  id: string; title: string; topic: string; format: string; startsAt: string; endsAt: string; venue: string | null; meetingUrl: string | null; status: string; materialsDueAt: string;
  audienceDeptIds: string[]; presenterIds: string[]; preparerIds: string[]; presenters: { id: string; displayName: string }[]; preparers: { id: string; displayName: string }[];
  attendance?: { id: string; method: string; checkedInAt: string; employee: { id: string; name: string; staffNo: string; department: { name: string } | null } }[];
  feedback?: { rating: number; comments: string | null; quizScore: number | null }[]; feedbackAvg: number | null; quiz?: { question: string; options: string[]; answer: number }[];
}
const NEXT: Record<string, string[]> = { PLANNED: ['SCHEDULED', 'POSTPONED', 'CANCELLED'], SCHEDULED: ['MATERIALS_READY', 'HELD', 'POSTPONED', 'CANCELLED'], MATERIALS_READY: ['HELD', 'POSTPONED', 'CANCELLED'], HELD: ['FEEDBACK_COLLECTED', 'CLOSED'], FEEDBACK_COLLECTED: ['CLOSED'], POSTPONED: ['SCHEDULED', 'CANCELLED'] };

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const write = can('awr:write', 'AWR');
  const { data: s, reload, error } = useApi<Session>(`/awareness/sessions/${id}`);
  const [qr, setQr] = useState<{ url: string; qrDataUrl: string } | null>(null);
  const [staffQ, setStaffQ] = useState('');
  const emps = useApi<{ id: string; name: string; staffNo: string }[]>(write && staffQ.length > 1 ? `/awareness/employees?q=${encodeURIComponent(staffQ)}` : null, [staffQ]);
  const [quiz, setQuiz] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const act = useAction();
  if (error) return <Alert>{error.message}</Alert>;
  if (!s) return <Spinner />;
  return (
    <div className="space-y-4">
      <PageHeader title={s.title} subtitle={<>{fmtDateTime(s.startsAt)} – {fmtDateTime(s.endsAt)} · {label(s.format)} <StatusBadge value={s.status} /></>}
        actions={write ? <>{(NEXT[s.status] ?? []).map((n) => <Button key={n} size="sm" variant={n === 'CANCELLED' || n === 'POSTPONED' ? 'secondary' : 'primary'} onClick={() => act.run(async () => { await api.post(`/awareness/sessions/${id}/status`, { status: n }); await reload(); })}>{label(n)}</Button>)}</> : null} />
      {act.error ? <Alert>{act.error}</Alert> : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={t('Session')}><DL items={[[t('Topic'), s.topic], [t('Venue / link'), s.venue ?? s.meetingUrl ?? '—'], [t('Presenters'), s.presenters.map((p) => p.displayName).join(', ') || '—'], [t('Preparers'), s.preparers.map((p) => p.displayName).join(', ') || '—'], [t('Materials due'), fmtDateTime(s.materialsDueAt)], [t('Audience'), s.audienceDeptIds.length ? t('{n} department(s)', { n: s.audienceDeptIds.length }) : t('Everyone')]]} /></Card>
          <DocumentsPanel ownerType="session" ownerId={id} canWrite={write} title={t('Presentation materials')} />
          {s.attendance ? (
            <Card title={t('Attendance ({n})', { n: s.attendance.length })} actions={write ? <>
              <Button size="sm" onClick={() => act.run(async () => setQr(await api.post(`/awareness/sessions/${id}/checkin-link`)))}>{t('Open QR check-in')}</Button>
              <input ref={file} type="file" accept=".xlsx" aria-label={t('Attendance sheet')} className="hidden" onChange={() => act.run(async () => { const f = file.current?.files?.[0]; if (!f) return; const fd = new FormData(); fd.set('file', f); const r = await api.form<{ added: number; unknown: string[] }>(`/awareness/sessions/${id}/attendance/import`, fd); await reload(); if (r.unknown.length) alert(t('Unknown staff numbers: {list}', { list: r.unknown.join(', ') })); })} />
              <Button size="sm" variant="secondary" onClick={() => file.current?.click()}>{t('Import Excel')}</Button>
            </> : null}>
              {write ? <div className="mb-3"><Field label={t('Add attendee')}>{(fid) => <Input id={fid} placeholder={t('Search name or staff no.')} value={staffQ} onChange={(e) => setStaffQ(e.target.value)} />}</Field>
                <ul className="mt-1 flex flex-wrap gap-1">{emps.data?.map((e) => <li key={e.id}><Button size="sm" variant="ghost" onClick={() => act.run(async () => { await api.post(`/awareness/sessions/${id}/attendance`, { employeeIds: [e.id] }); setStaffQ(''); await reload(); })}>+ {e.name} ({e.staffNo})</Button></li>)}</ul></div> : null}
              {!s.attendance.length ? <Empty>{t('Nobody checked in yet')}</Empty> : <ul className="divide-y text-sm">{s.attendance.map((a) => <li key={a.id} className="flex items-center justify-between py-1.5"><span>{a.employee.name} <span className="text-xs text-slate-500">{a.employee.staffNo} · {a.employee.department?.name ?? ''}</span></span><span className="flex items-center gap-2"><Badge>{label(a.method)}</Badge>{write ? <Button size="sm" variant="ghost" aria-label={t('Remove')} onClick={() => act.run(async () => { await api.del(`/awareness/sessions/${id}/attendance/${a.employee.id}`); await reload(); })}>✕</Button> : null}</span></li>)}</ul>}
            </Card>
          ) : null}
        </div>
        <div className="space-y-4">
          {s.feedback ? <Card title={t('Feedback')}><div className="text-2xl font-semibold">{s.feedbackAvg ?? '—'} <span className="text-sm text-slate-500">/ 5 · {t('{n} responses', { n: s.feedback.length })}</span></div><ul className="mt-2 space-y-1 text-sm">{s.feedback.filter((f) => f.comments).map((f, i) => <li key={i} className="rounded bg-slate-50 p-2">“{f.comments}”</li>)}</ul></Card> : null}
          {write ? <Card title={t('Quiz')} actions={<Button size="sm" variant="secondary" onClick={() => setQuiz(JSON.stringify(s.quiz?.map(({ question, options, answer }) => ({ question, options, answer })) ?? [], null, 1))}>{t('Edit')}</Button>}><p className="text-sm text-slate-600">{t('{n} question(s). Answers are scored when attendees send feedback.', { n: s.quiz?.length ?? 0 })}</p></Card> : null}
        </div>
      </div>
      <Modal open={!!qr} title={t('QR check-in')} onClose={() => setQr(null)} footer={<Button variant="secondary" onClick={() => act.run(async () => { await api.post(`/awareness/sessions/${id}/checkin-close`); setQr(null); })}>{t('Close check-in')}</Button>}>
        {qr ? <div className="text-center"><img src={qr.qrDataUrl} alt={t('QR code for check-in')} width={320} height={320} className="mx-auto" /><p className="mt-2 break-all text-xs text-slate-600">{qr.url}</p><p className="mt-2 text-sm">{t('Attendees scan this with their phone camera and enter their staff number. The link stops working two hours after the session or when you close check-in.')}</p></div> : null}
      </Modal>
      <Modal open={quiz !== null} wide title={t('Quiz questions (JSON)')} onClose={() => setQuiz(null)} footer={<Button busy={act.busy} onClick={() => act.run(async () => { await api.post(`/awareness/sessions/${id}/quiz`, { questions: JSON.parse(quiz!) }); setQuiz(null); await reload(); })}>{t('Save')}</Button>}>
        <p className="text-xs text-slate-500">{t('Format: [{"question": "…", "options": ["A", "B"], "answer": 0}] — answer is the index of the correct option.')}</p>
        <Textarea aria-label={t('Quiz JSON')} rows={12} className="font-mono" value={quiz ?? ''} onChange={(e) => setQuiz(e.target.value)} />
      </Modal>
    </div>
  );
}
