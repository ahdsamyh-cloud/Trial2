'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { Alert, Button, Card, Field, Input } from './ui';

/** Shared page for one-time setup (24 h) and reset (30 min) links. */
export function TokenPage({ token }: { token: string }) {
  const [info, setInfo] = useState<{ purpose: string; displayName: string } | null>(null);
  const [error, setError] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get<{ purpose: string; displayName: string }>(`/auth/token/${encodeURIComponent(token)}`).then(setInfo).catch((e) => setError(e.message)); }, [token]);
  const submit = async () => {
    setError('');
    if (pw !== pw2) { setError(t('The two passwords do not match')); return; }
    setBusy(true);
    try { await api.post('/auth/token', { token, password: pw }); setDone(true); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <div className="space-y-4">
          <h1 className="text-lg font-semibold">{info?.purpose === 'RESET' ? t('Reset your password') : t('Set up your account')}</h1>
          {error ? <Alert>{error}</Alert> : null}
          {done ? <Alert tone="green">{t('Your password is set. You can now sign in and set up your authenticator app.')} <a className="underline" href="/login">{t('Sign in')}</a></Alert> : info ? (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
              <p className="text-sm">{t('Hello {name}. Choose a password of at least 12 characters.', { name: info.displayName })}</p>
              <Field label={t('New password')}>{(id) => <Input id={id} type="password" autoComplete="new-password" minLength={12} value={pw} onChange={(e) => setPw(e.target.value)} required />}</Field>
              <Field label={t('Repeat new password')}>{(id) => <Input id={id} type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />}</Field>
              <Button type="submit" busy={busy} className="w-full">{t('Save password')}</Button>
            </form>
          ) : null}
        </div>
      </Card>
    </main>
  );
}
