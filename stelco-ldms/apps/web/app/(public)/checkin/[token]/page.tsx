'use client';
import { use, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Alert, Button, Card, Field, Input, Textarea } from '@/components/ui';

/** Public QR check-in for staff without an LDMS account (signed, time-limited link). */
export default function CheckIn({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [info, setInfo] = useState<{ title: string; startsAt: string; venue: string | null; quiz: { id: string; question: string; options: string[] }[] } | null>(null);
  const [error, setError] = useState('');
  const [staffNo, setStaffNo] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [rating, setRating] = useState(0);
  const [comments, setComments] = useState('');
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [sent, setSent] = useState<{ quizScore: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get<typeof info>(`/awareness/public/checkin/${encodeURIComponent(token)}`).then(setInfo).catch((e) => setError(e.message)); }, [token]);
  const go = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  return (
    <main className="mx-auto max-w-md p-4">
      <div className="mb-4 flex items-center gap-2"><img src="/icons/icon.svg" alt="" width={28} height={28} /><span className="font-semibold text-brand-900">{t('STELCO Legal awareness')}</span></div>
      {error ? <Alert>{error}</Alert> : null}
      {info ? (
        <Card title={info.title}>
          <p className="mb-3 text-sm text-slate-600">{fmtDateTime(info.startsAt)}{info.venue ? ` · ${info.venue}` : ''}</p>
          {!done ? (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void go(async () => { const r = await api.post<{ name: string }>(`/awareness/public/checkin/${encodeURIComponent(token)}`, { staffNo }); setDone(r.name); }); }}>
              <Field label={t('Your staff number')}>{(id) => <Input id={id} inputMode="text" autoComplete="off" value={staffNo} onChange={(e) => setStaffNo(e.target.value)} required />}</Field>
              <Button type="submit" busy={busy} className="w-full">{t('Check in')}</Button>
            </form>
          ) : (
            <div className="space-y-4">
              <Alert tone="green">{t('Thank you, {name} — you are checked in.', { name: done })}</Alert>
              {!sent ? (
                <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void go(async () => setSent(await api.post(`/awareness/public/feedback/${encodeURIComponent(token)}`, { rating, comments: comments || undefined, answers }))); }}>
                  <fieldset><legend className="mb-1 text-sm font-medium">{t('How useful was this session?')}</legend>
                    <div className="flex gap-2">{[1, 2, 3, 4, 5].map((n) => <label key={n} className={`flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border text-sm ${rating === n ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300'}`}><input type="radio" name="rating" className="sr-only" value={n} checked={rating === n} onChange={() => setRating(n)} />{n}</label>)}</div></fieldset>
                  {info.quiz.map((q) => (
                    <fieldset key={q.id}><legend className="mb-1 text-sm font-medium">{q.question}</legend>
                      {q.options.map((o, i) => <label key={i} className="flex items-center gap-2 text-sm"><input type="radio" name={q.id} checked={answers[q.id] === i} onChange={() => setAnswers({ ...answers, [q.id]: i })} />{o}</label>)}</fieldset>
                  ))}
                  <Field label={t('Comments (optional, anonymous)')}>{(id) => <Textarea id={id} value={comments} onChange={(e) => setComments(e.target.value)} />}</Field>
                  <Button type="submit" busy={busy} disabled={!rating} className="w-full">{t('Send feedback')}</Button>
                </form>
              ) : <Alert tone="green">{t('Feedback received. Thank you!')}{sent.quizScore !== null ? ` ${t('Quiz score: {s}%', { s: sent.quizScore })}` : ''}</Alert>}
            </div>
          )}
        </Card>
      ) : null}
    </main>
  );
}
