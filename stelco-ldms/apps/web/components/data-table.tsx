'use client';
import { ReactNode, useState } from 'react';
import { Button, Empty, Spinner } from './ui';
import { useLocal } from '@/lib/hooks';
import { t } from '@/lib/i18n';

export interface Col<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  className?: string;
  hideOnMobile?: boolean;
  optional?: boolean;
}

/** List view with column choice (per viewer), row selection for bulk actions and paging. */
export function DataTable<T extends { id: string }>({
  id, columns, rows, loading, total, page, pageSize, onPage, onRowClick, selectable, selected, onSelect, empty,
}: {
  id: string; columns: Col<T>[]; rows?: T[]; loading?: boolean; total?: number; page?: number; pageSize?: number;
  onPage?: (p: number) => void; onRowClick?: (r: T) => void; selectable?: boolean; selected?: string[]; onSelect?: (ids: string[]) => void; empty?: string;
}) {
  const [hidden, setHidden] = useLocal<string[]>(`cols:${id}`, columns.filter((c) => c.optional).map((c) => c.key));
  const [chooser, setChooser] = useState(false);
  const visible = columns.filter((c) => !hidden.includes(c.key));
  const pages = total && pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const sel = selected ?? [];
  const allOnPage = !!rows?.length && rows.every((r) => sel.includes(r.id));
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-xs text-slate-600">
        <span>{total !== undefined ? t('{n} item(s)', { n: total }) : ''}{sel.length ? ` · ${t('{n} selected', { n: sel.length })}` : ''}</span>
        <div className="relative">
          <Button variant="ghost" size="sm" onClick={() => setChooser(!chooser)} aria-expanded={chooser}>{t('Columns')}</Button>
          {chooser ? (
            <div className="absolute right-0 z-20 mt-1 w-56 rounded-md border bg-white p-2 shadow-lg">
              {columns.map((c) => (
                <label key={c.key} className="flex items-center gap-2 px-1 py-1 text-sm">
                  <input type="checkbox" checked={!hidden.includes(c.key)} onChange={(e) => setHidden(e.target.checked ? hidden.filter((h) => h !== c.key) : [...hidden, c.key])} />
                  {c.header}
                </label>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {loading && !rows ? <Spinner /> : !rows?.length ? <Empty>{empty ?? t('Nothing to show')}</Empty> : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                {selectable ? (
                  <th className="w-8 px-3 py-2"><input type="checkbox" aria-label={t('Select all')} checked={allOnPage} onChange={(e) => onSelect?.(e.target.checked ? [...new Set([...sel, ...rows.map((r) => r.id)])] : sel.filter((s) => !rows.some((r) => r.id === s)))} /></th>
                ) : null}
                {visible.map((c) => <th key={c.key} scope="col" className={`px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 ${c.hideOnMobile ? 'hidden md:table-cell' : ''}`}>{c.header}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className={onRowClick ? 'cursor-pointer hover:bg-slate-50' : ''} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                  {selectable ? (
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={t('Select row')} checked={sel.includes(r.id)} onChange={(e) => onSelect?.(e.target.checked ? [...sel, r.id] : sel.filter((s) => s !== r.id))} /></td>
                  ) : null}
                  {visible.map((c) => <td key={c.key} className={`px-3 py-2 align-top ${c.hideOnMobile ? 'hidden md:table-cell' : ''} ${c.className ?? ''}`}>{c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? '—')}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {onPage && pages > 1 ? (
        <div className="flex items-center justify-end gap-2 border-t px-3 py-2 text-sm">
          <Button variant="secondary" size="sm" disabled={(page ?? 1) <= 1} onClick={() => onPage((page ?? 1) - 1)}>{t('Previous')}</Button>
          <span>{t('Page {p} of {n}', { p: page ?? 1, n: pages })}</span>
          <Button variant="secondary" size="sm" disabled={(page ?? 1) >= pages} onClick={() => onPage((page ?? 1) + 1)}>{t('Next')}</Button>
        </div>
      ) : null}
    </div>
  );
}

/** Saved filter views per list (stored per viewer). */
export function SavedViews<F extends Record<string, string>>({ id, current, onApply }: { id: string; current: F; onApply: (f: F) => void }) {
  const [views, setViews] = useLocal<{ name: string; filter: F }[]>(`views:${id}`, []);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {views.map((v) => (
        <span key={v.name} className="inline-flex items-center rounded-full border border-slate-300 bg-white text-xs">
          <button className="px-2 py-1 hover:text-brand-700" onClick={() => onApply(v.filter)}>{v.name}</button>
          <button className="px-1.5 py-1 text-slate-400 hover:text-red-600" aria-label={t('Delete view {name}', { name: v.name })} onClick={() => setViews(views.filter((x) => x.name !== v.name))}>✕</button>
        </span>
      ))}
      <Button variant="ghost" size="sm" onClick={() => { const name = prompt(t('Name this view')); if (name) setViews([...views.filter((v) => v.name !== name), { name: name.slice(0, 40), filter: current }]); }}>{t('Save view')}</Button>
    </div>
  );
}
