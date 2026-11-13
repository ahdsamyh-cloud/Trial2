'use client';
import clsx from 'clsx';
import { ButtonHTMLAttributes, forwardRef, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, useEffect, useId, useRef } from 'react';
import { t } from '@/lib/i18n';
import { label as fmtLabel } from '@/lib/format';

export const cx = clsx;

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean; size?: 'sm' | 'md' }>(
  ({ variant = 'primary', busy, size = 'md', className, children, disabled, ...rest }, ref) => (
    <button
      ref={ref}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2.5 py-1 text-sm' : 'px-3.5 py-2 text-sm',
        variant === 'primary' && 'bg-brand-600 text-white hover:bg-brand-700',
        variant === 'secondary' && 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
        variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700',
        variant === 'ghost' && 'text-slate-700 hover:bg-slate-100',
        className,
      )}
      {...rest}
    >
      {busy ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : null}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

const fieldCls = 'block rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:bg-slate-100';

export function Field({ label, hint, error, children, required, id }: { label: string; hint?: string; error?: string; children: (id: string) => ReactNode; required?: boolean; id?: string }) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className="space-y-1">
      <label htmlFor={fid} className="block text-sm font-medium text-slate-700">
        {label}
        {required ? <span className="text-red-600" aria-hidden> *</span> : null}
      </label>
      {children(fid)}
      {hint && !error ? <p className="text-xs text-slate-500">{hint}</p> : null}
      {error ? <p className="text-xs text-red-700" role="alert">{error}</p> : null}
    </div>
  );
}

/** Full width unless the caller gives a width class (w-40, w-60…). */
const width = (c?: string) => (c && /(^|\s)(sm:|md:|lg:)?w-/.test(c) ? '' : 'w-full');
// Client-side validation defaults: every text field gets a length cap unless the caller sets one.
// This is a usability guard only; the API's zod schemas are the security boundary.
const INPUT_MAX = 2000;
const TEXTAREA_MAX = 100000;
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, maxLength, ...p }, ref) => <input ref={ref} maxLength={maxLength ?? INPUT_MAX} className={clsx(fieldCls, width(className), className)} {...p} />);
Input.displayName = 'Input';
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, maxLength, ...p }, ref) => <textarea ref={ref} maxLength={maxLength ?? TEXTAREA_MAX} className={clsx(fieldCls, 'min-h-[90px]', width(className), className)} {...p} />);
Textarea.displayName = 'Textarea';
export function Select({ className, options, placeholder, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <select className={clsx(fieldCls, width(className), className)} {...p}>
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('rounded-lg border border-slate-200 bg-white shadow-sm', className)}>
      {title || actions ? (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          {title ? <h2 className="text-sm font-semibold text-slate-800">{title}</h2> : <span />}
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

const TONES: Record<string, string> = {
  gray: 'bg-slate-100 text-slate-700', blue: 'bg-blue-100 text-blue-800', green: 'bg-green-100 text-green-800',
  amber: 'bg-amber-100 text-amber-900', red: 'bg-red-100 text-red-800', purple: 'bg-purple-100 text-purple-800',
};
export function Badge({ tone = 'gray', children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', TONES[tone])}>{children}</span>;
}

export function statusTone(s?: string | null): keyof typeof TONES {
  if (!s) return 'gray';
  if (/BREACH|OVERDUE|INFECTED|NON_COMPLIANT|REJECTED|URGENT|PROBABLE|HIGH|MISSED|DISPUTED|EXPIRED/.test(s)) return 'red';
  if (/WARN|AWAITING|PENDING|PARTIAL|RETURNED|POSSIBLE|MEDIUM|FOLLOW_UP|DRAFT/.test(s)) return 'amber';
  if (/CLOSED|APPROVED|COMPLIANT|CLEAN|DONE|COMPLETED|PAID|SETTLED|ACK|ACTIVE|OK|HELD|IN_FORCE/.test(s)) return 'green';
  if (/RESTRICTED|HOD/.test(s)) return 'purple';
  return 'blue';
}
export function StatusBadge({ value }: { value?: string | null }) {
  return <Badge tone={statusTone(value)}>{fmtLabel(value)}</Badge>;
}

export function Alert({ tone = 'red', children }: { tone?: 'red' | 'amber' | 'green' | 'blue'; children: ReactNode }) {
  const c = { red: 'border-red-200 bg-red-50 text-red-800', amber: 'border-amber-200 bg-amber-50 text-amber-900', green: 'border-green-200 bg-green-50 text-green-800', blue: 'border-blue-200 bg-blue-50 text-blue-800' }[tone];
  return <div role={tone === 'red' ? 'alert' : 'status'} className={clsx('rounded-md border px-3 py-2 text-sm', c)}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-slate-600">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-slate-500">{children}</p>;
}

export function Spinner() {
  return <div className="flex justify-center py-10" role="status" aria-label={t('Loading')}><span className="h-6 w-6 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" /></div>;
}

export function Modal({ open, title, onClose, children, footer, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={clsx('max-h-[92vh] w-full overflow-y-auto rounded-t-xl bg-white shadow-xl sm:rounded-xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label={t('Close')}>✕</button>
        </div>
        <div className="space-y-3 p-4">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t px-4 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: { id: string; label: string; count?: number }[]; active: string; onChange: (id: string) => void }) {
  return (
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((tb) => (
        <button key={tb.id} role="tab" aria-selected={active === tb.id} onClick={() => onChange(tb.id)}
          className={clsx('whitespace-nowrap border-b-2 px-3 py-2 text-sm', active === tb.id ? 'border-brand-600 font-semibold text-brand-700' : 'border-transparent text-slate-600 hover:text-slate-900')}>
          {tb.label}{tb.count !== undefined ? <span className="ml-1 text-xs text-slate-500">({tb.count})</span> : null}
        </button>
      ))}
    </div>
  );
}

export function DL({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{k}</dt>
          <dd className="mt-0.5 break-words text-sm text-slate-900">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Stat({ label, value, tone, href }: { label: string; value: ReactNode; tone?: 'red' | 'amber' | 'green'; href?: string }) {
  const body = (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={clsx('mt-1 text-2xl font-semibold', tone === 'red' ? 'text-red-700' : tone === 'amber' ? 'text-amber-700' : tone === 'green' ? 'text-green-700' : 'text-slate-900')}>{value}</div>
    </div>
  );
  return href ? <a href={href} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">{body}</a> : body;
}
