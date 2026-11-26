'use client';
import { useSyncExternalStore } from 'react';
import { setThaana, subscribeThaana, thaanaOn } from '@/lib/thaana';
import { t } from '@/lib/i18n';

/**
 * Switch for the Dhivehi phonetic keyboard: when on, typing in any text box produces Thaana.
 * Shown in the top bar and in every dialog (the top bar is covered while a dialog is open);
 * all switches share one state. Ctrl+Shift+D also switches it. The choice is remembered on this
 * device only (a UI preference; no content is stored).
 */
export function ThaanaToggle({ compact }: { compact?: boolean }) {
  const on = useSyncExternalStore(subscribeThaana, thaanaOn, () => false);
  return (
    <button type="button" onClick={() => setThaana(!on)} aria-pressed={on} title={t('Dhivehi keyboard (Ctrl+Shift+D)')}
      className={`rounded px-2 ${compact ? 'py-0.5 text-xs' : 'py-1 text-sm'} ${on ? 'bg-brand-600 text-white' : 'text-slate-700 hover:bg-slate-100'}`}>
      <span lang="dv">ދިވެހި</span><span className="sr-only"> {on ? t('Dhivehi keyboard on') : t('Dhivehi keyboard off')}</span>
    </button>
  );
}
