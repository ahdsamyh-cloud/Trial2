'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useAction } from '@/lib/hooks';
import { fmtDateTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select } from '@/components/ui';

export default function Account() {
  const { me } = useAuth();
  const sessions = useApi<{ id: string; createdAt: string; lastSeenAt: string; ip: string | null; userAgent: string | null; mobile: boolean; current: boolean }[]>('/auth/sessions');
  const prefs = useApi<{ email: boolean; digest: string }>('/notifications/preferences');
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', repeat: '' });
  const [codes, setCodes] = useState<string[] | null>(null);
  const [msg, setMsg] = useState('');
  const act = useAction();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title={t('My account')} subtitle={`${me?.displayName} · ${me?.username}`} />
      {act.error ? <Alert>{act.error}</Alert> : null}
      {msg ? <Alert tone="green">{msg}</Alert> : null}
      <Card title={t('Signed-in devices')} actions={<Button size="sm" variant="secondary" onClick={() => act.run(async () => { await api.post('/auth/sessions/revoke-others'); await sessions.reload(); setMsg(t('Other sessions signed out.')); })}>{t('Sign out all other sessions')}</Button>}>
        <ul className="divide-y divide-slate-100 text-sm">
          {sessions.data?.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div><div>{s.userAgent?.slice(0, 80) ?? t('Unknown device')} {s.current ? <Badge tone="green">{t('This device')}</Badge> : null}</div><div className="text-xs text-slate-500">{s.ip} · {t('last active')} {fmtDateTime(s.lastSeenAt)}</div></div>
              {!s.current ? <Button size="sm" variant="ghost" onClick={() => act.run(async () => { await api.del(`/auth/sessions/${s.id}`); await sessions.reload(); })}>{t('Sign out')}</Button> : null}
            </li>
          ))}
        </ul>
      </Card>
      <Card title={t('Change password')}>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void act.run(async () => { if (pw.newPassword !== pw.repeat) throw new Error(t('The two passwords do not match')); await api.post('/auth/password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword }); setPw({ currentPassword: '', newPassword: '', repeat: '' }); setMsg(t('Password changed. Other sessions were signed out.')); }); }}>
          <Field label={t('Current password')}>{(id) => <Input id={id} type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required />}</Field>
          <Field label={t('New password')} hint={t('At least 12 characters.')}>{(id) => <Input id={id} type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required />}</Field>
          <Field label={t('Repeat new password')}>{(id) => <Input id={id} type="password" autoComplete="new-password" value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} required />}</Field>
          <Button type="submit" busy={act.busy}>{t('Change password')}</Button>
        </form>
      </Card>
      <Card title={t('Backup codes')} actions={<Button size="sm" variant="secondary" onClick={() => act.run(async () => setCodes((await api.post<{ backupCodes: string[] }>('/auth/backup-codes')).backupCodes))}>{t('Generate new codes')}</Button>}>
        <p className="text-sm text-slate-600">{t('Generating new codes cancels the old ones.')}</p>
        {codes ? <ul className="mt-2 grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-5">{codes.map((c) => <li key={c} className="rounded bg-slate-100 px-2 py-1 text-center">{c}</li>)}</ul> : null}
      </Card>
      {prefs.data ? (
        <Card title={t('Notifications')}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={prefs.data.email} onChange={(e) => act.run(async () => prefs.setData(await api.put('/notifications/preferences', { ...prefs.data!, email: e.target.checked })))} />{t('Email me (when email is enabled)')}</label>
            <Field label={t('Digest')}>{(id) => <Select id={id} value={prefs.data!.digest} onChange={(e) => act.run(async () => prefs.setData(await api.put('/notifications/preferences', { ...prefs.data!, digest: e.target.value })))} options={[{ value: 'NONE', label: t('No digest (send each email)') }, { value: 'DAILY', label: t('Daily') }, { value: 'WEEKLY', label: t('Weekly') }]} />}</Field>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
