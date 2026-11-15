'use client';
import { useEffect, useState } from 'react';
import { handleThaanaKey } from '@/lib/thaana';
import { t } from '@/lib/i18n';

const KEY = 'ldms.thaanaKeyboard';

/**
 * Header switch for the Dhivehi phonetic keyboard. When on, typing in any text box produces Thaana.
 * Ctrl+Shift+D (or the button) switches it. The on/off choice is remembered on this device only
 * (a UI preference; no content is stored).
 */
export function ThaanaToggle() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    try { setOn(localStorage.getItem(KEY) === '1'); } catch { /* storage unavailable: default off */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* storage unavailable */ }
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) { e.preventDefault(); setOn((v) => !v); return; }
      if (on) handleThaanaKey(e);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [on]);
  return (
    <button type="button" onClick={() => setOn(!on)} aria-pressed={on} title={t('Dhivehi keyboard (Ctrl+Shift+D)')}
      className={`rounded px-2 py-1 text-sm ${on ? 'bg-brand-600 text-white' : 'text-slate-700 hover:bg-slate-100'}`}>
      <span lang="dv">ދިވެހި</span><span className="sr-only"> {on ? t('Dhivehi keyboard on') : t('Dhivehi keyboard off')}</span>
    </button>
  );
}
