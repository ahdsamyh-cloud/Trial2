'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { Alert, Button, Card, Field, Input } from '@/components/ui';

type Step = 'password' | 'mfa' | 'enrol' | 'codes' | 'change';

function LoginInner() {
  const params = useSearchParams();
  const { refresh } = useAuth();
  const [step, setStep] = useState<Step>('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [enrol, setEnrol] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [mustChange, setMustChange] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const next = params.get('next') && params.get('next')!.startsWith('/') && !params.get('next')!.startsWith('//') ? params.get('next')! : '/';

  useEffect(() => {
    api.get<{ stage: string; mustChangePassword: boolean }>('/auth/me').then((me) => {
      if (me.stage === 'FULL' && me.mustChangePassword) setStep('change');
      else if (me.stage === 'FULL') location.href = next;
    }).catch(() => undefined);
  }, [next]);

  const go = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const finish = async (mustChangePassword: boolean) => {
    await refresh();
    if (mustChangePassword) { setStep('change'); return; }
    location.href = next;
  };

  const submitPassword = () => go(async () => {
    const r = await api.post<{ next: 'MFA' | 'ENROL_MFA' }>('/auth/login', { username: username.trim(), password });
    setPassword('');
    if (r.next === 'ENROL_MFA') {
      setEnrol(await api.post('/auth/mfa/enrol'));
      setStep('enrol');
    } else setStep('mfa');
  });

  const submitMfa = () => go(async () => {
    const r = await api.post<{ mustChangePassword: boolean }>('/auth/mfa', { code });
    await finish(r.mustChangePassword);
  });

  const submitEnrol = () => go(async () => {
    const r = await api.post<{ backupCodes: string[]; mustChangePassword: boolean }>('/auth/mfa/enrol/verify', { code });
    setCodes(r.backupCodes);
    setMustChange(r.mustChangePassword);
    setStep('codes');
  });

  const submitChange = () => go(async () => {
    if (newPw !== newPw2) throw new Error(t('The two passwords do not match'));
    await api.post('/auth/password', { currentPassword: password, newPassword: newPw });
    await refresh();
    location.href = next;
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-50 to-white p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <img src="/icons/icon.svg" alt="" width={36} height={36} />
          <div><div className="text-lg font-semibold text-brand-900">{t('STELCO Legal')}</div><div className="text-xs text-slate-500">{t('Legal Department Management System')}</div></div>
        </div>
        <Card>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void ({ password: submitPassword, mfa: submitMfa, enrol: submitEnrol, codes: async () => finish(mustChange), change: submitChange }[step])(); }}>
            {error ? <Alert>{error}</Alert> : null}
            {step === 'password' ? (
              <>
                <h1 className="text-lg font-semibold">{t('Sign in')}</h1>
                <Field label={t('Username')}>{(id) => <Input id={id} autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required />}</Field>
                <Field label={t('Password')}>{(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}</Field>
                <Button type="submit" busy={busy} className="w-full">{t('Continue')}</Button>
                <p className="text-center text-xs text-slate-500">{t('Forgot your password? Contact IT or use the reset link if email is enabled.')}</p>
              </>
            ) : null}
            {step === 'mfa' ? (
              <>
                <h1 className="text-lg font-semibold">{t('Two-factor verification')}</h1>
                <p className="text-sm text-slate-600">{t('Enter the 6-digit code from your authenticator app, or one of your backup codes.')}</p>
                <Field label={t('Code')}>{(id) => <Input id={id} inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} required />}</Field>
                <Button type="submit" busy={busy} className="w-full">{t('Verify')}</Button>
              </>
            ) : null}
            {step === 'enrol' && enrol ? (
              <>
                <h1 className="text-lg font-semibold">{t('Set up two-factor authentication')}</h1>
                <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
                  <li>{t('Open Microsoft Authenticator or Google Authenticator on your phone.')}</li>
                  <li>{t('Add an account and scan this QR code.')}</li>
                  <li>{t('Enter the 6-digit code it shows.')}</li>
                </ol>
                <div className="flex justify-center"><img src={enrol.qrDataUrl} alt={t('QR code for authenticator app')} width={200} height={200} /></div>
                <p className="break-all text-center font-mono text-xs text-slate-600">{t('Or enter this key:')} {enrol.secret}</p>
                <Field label={t('Code')}>{(id) => <Input id={id} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />}</Field>
                <Button type="submit" busy={busy} className="w-full">{t('Verify and continue')}</Button>
              </>
            ) : null}
            {step === 'codes' ? (
              <>
                <h1 className="text-lg font-semibold">{t('Save your backup codes')}</h1>
                <Alert tone="amber">{t('Each code works once if you lose your phone. They will not be shown again. Store them somewhere safe.')}</Alert>
                <ul className="grid grid-cols-2 gap-2 font-mono text-sm" data-testid="backup-codes">{codes.map((c) => <li key={c} className="rounded bg-slate-100 px-2 py-1 text-center">{c}</li>)}</ul>
                <Button type="submit" className="w-full">{t('I have saved them')}</Button>
              </>
            ) : null}
            {step === 'change' ? (
              <>
                <h1 className="text-lg font-semibold">{t('Choose a new password')}</h1>
                <p className="text-sm text-slate-600">{t('Use at least 12 characters. A short sentence works well. Common or breached passwords are refused.')}</p>
                <Field label={t('Current (temporary) password')}>{(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}</Field>
                <Field label={t('New password')}>{(id) => <Input id={id} type="password" autoComplete="new-password" minLength={12} value={newPw} onChange={(e) => setNewPw(e.target.value)} required />}</Field>
                <Field label={t('Repeat new password')}>{(id) => <Input id={id} type="password" autoComplete="new-password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} required />}</Field>
                <Button type="submit" busy={busy} className="w-full">{t('Save password')}</Button>
              </>
            ) : null}
          </form>
        </Card>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return <Suspense><LoginInner /></Suspense>;
}
