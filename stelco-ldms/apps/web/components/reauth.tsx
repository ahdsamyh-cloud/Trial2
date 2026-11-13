'use client';
import { useEffect, useRef, useState } from 'react';
import { api, onReauthRequired } from '@/lib/api';
import { t } from '@/lib/i18n';
import { Alert, Button, Field, Input, Modal } from './ui';

/** Prompts for password + code when the API asks for re-authentication (sensitive actions). */
export function ReauthDialog() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    onReauthRequired(() => new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setPassword(''); setCode(''); setError('');
      setOpen(true);
    }));
    return () => onReauthRequired(null);
  }, []);

  const close = (ok: boolean) => { setOpen(false); resolver.current?.(ok); resolver.current = null; };
  const submit = async () => {
    setBusy(true); setError('');
    try { await api.post('/auth/reauth', { password, code }); close(true); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} title={t('Confirm it is you')} onClose={() => close(false)}
      footer={<><Button variant="secondary" onClick={() => close(false)}>{t('Cancel')}</Button><Button busy={busy} onClick={submit}>{t('Confirm')}</Button></>}>
      <p className="text-sm text-slate-600">{t('This action is sensitive. Enter your password and a code from your authenticator app.')}</p>
      {error ? <Alert>{error}</Alert> : null}
      <Field label={t('Password')}>{(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
      <Field label={t('Authenticator code')}>{(id) => <Input id={id} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />}</Field>
    </Modal>
  );
}
