'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { api, download } from '@/lib/api';
import { useApi, useAction } from '@/lib/hooks';
import { fmtDateTime, label } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Stat, StatusBadge, Textarea } from '@/components/ui';

interface Upload { batchId: string; headers: string[]; rowCount: number; sample: Record<string, string>[]; suggested: Record<string, string>; savedMappings: { id: string; name: string; columnMap: Record<string, string> }[]; fields: Record<string, { label: string; required: boolean }> }
interface Preview { stats: { total: number; create: number; duplicate: number; error: number }; unknown: { courts: string[]; firms: string[]; departments: string[] }; rows: { rowNo: number; action: string; errors: string[]; warnings: string[]; caseNo: string; court: string; title: string }[] }

export default function ImportWizard() {
  const { can } = useAuth();
  const history = useApi<{ id: string; filename: string; status: string; stats: Record<string, number> | null; createdAt: string }[]>('/litigation/import');
  const fileRef = useRef<HTMLInputElement>(null);
  const [up, setUp] = useState<Upload | null>(null);
  const [map, setMap] = useState<Record<string, string>>({});
  const [createMissing, setCreateMissing] = useState(true);
  const [prev, setPrev] = useState<Preview | null>(null);
  const [done, setDone] = useState<{ created: number; skipped: number } | null>(null);
  const [filter, setFilter] = useState('');
  const [rollback, setRollback] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const act = useAction();

  const upload = () => act.run(async () => {
    const f = fileRef.current?.files?.[0];
    if (!f) throw new Error(t('Choose the Excel file'));
    const fd = new FormData(); fd.set('file', f);
    const r = await api.form<Upload>('/litigation/import', fd);
    setUp(r); setMap(r.suggested); setPrev(null); setDone(null);
  });
  const preview = () => act.run(async () => setPrev(await api.post<Preview>(`/litigation/import/${up!.batchId}/preview`, { columnMap: map, createMissing })));
  const commit = () => act.run(async () => { setDone(await api.post(`/litigation/import/${up!.batchId}/commit`)); await history.reload(); });

  return (
    <div className="space-y-4">
      <PageHeader title={t('Import litigation register')} subtitle={t('Upload the Excel register, match its columns, check the dry run, then import. A batch can be rolled back.')}
        actions={<><Button variant="secondary" onClick={() => act.run(() => download('/litigation/import/template'))}>{t('Download template')}</Button><Link href="/litigation"><Button variant="ghost">{t('Back')}</Button></Link></>} />
      {act.error ? <Alert>{act.error}</Alert> : null}
      <Card title={t('1. Upload')}>
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t('Excel register (.xlsx)')}>{(id) => <input id={id} ref={fileRef} type="file" accept=".xlsx" className="block text-sm" />}</Field>
          <Button busy={act.busy} onClick={upload}>{t('Upload and read columns')}</Button>
        </div>
        {up ? <p className="mt-2 text-sm text-slate-600">{t('{n} rows found. Columns: {cols}', { n: up.rowCount, cols: up.headers.join(', ') })}</p> : null}
      </Card>
      {up ? (
        <Card title={t('2. Match columns')} actions={<>
          {up.savedMappings.length ? <Select aria-label={t('Saved mapping')} placeholder={t('Use a saved mapping')} value="" onChange={(e) => { const m = up.savedMappings.find((x) => x.id === e.target.value); if (m) setMap(m.columnMap); }} options={up.savedMappings.map((m) => ({ value: m.id, label: m.name }))} /> : null}
          <Button size="sm" variant="secondary" onClick={() => act.run(async () => { const name = prompt(t('Name this mapping')); if (name) await api.post('/litigation/import/mappings', { name, columnMap: map }); })}>{t('Save mapping')}</Button>
        </>}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(up.fields).map(([k, f]) => (
              <Field key={k} label={f.label} required={f.required}>{(id) => <Select id={id} placeholder={t('— Not in file —')} value={map[k] ?? ''} onChange={(e) => setMap({ ...map, [k]: e.target.value })} options={up.headers.map((h) => ({ value: h, label: h }))} />}</Field>
            ))}
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={createMissing} onChange={(e) => setCreateMissing(e.target.checked)} />{t('Create unknown courts, law firms and departments during the import')}</label>
          <Button className="mt-3" busy={act.busy} onClick={preview}>{t('Run dry-run preview')}</Button>
        </Card>
      ) : null}
      {prev ? (
        <Card title={t('3. Dry-run preview (nothing saved yet)')} actions={<>
          <Button variant="secondary" size="sm" onClick={() => act.run(() => download(`/litigation/import/${up!.batchId}/errors`))}>{t('Download rows to fix')}</Button>
          {!done ? <Button size="sm" busy={act.busy} disabled={!prev.stats.create} onClick={commit}>{t('Import {n} case(s)', { n: prev.stats.create })}</Button> : null}
        </>}>
          {done ? <Alert tone="green">{t('{n} case(s) imported; {s} row(s) skipped.', { n: done.created, s: done.skipped })} <Link href="/litigation" className="underline">{t('Open the case list')}</Link></Alert> : null}
          <div className="my-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={t('Rows')} value={prev.stats.total} />
            <Stat label={t('Will be created')} value={prev.stats.create} tone="green" />
            <Stat label={t('Possible duplicates')} value={prev.stats.duplicate} tone={prev.stats.duplicate ? 'amber' : undefined} />
            <Stat label={t('Errors')} value={prev.stats.error} tone={prev.stats.error ? 'red' : undefined} />
          </div>
          {prev.unknown.courts.length + prev.unknown.firms.length + prev.unknown.departments.length ? (
            <Alert tone="amber">{t('Not yet in the system')}: {[...prev.unknown.courts.map((c) => `${t('court')} "${c}"`), ...prev.unknown.firms.map((c) => `${t('firm')} "${c}"`), ...prev.unknown.departments.map((c) => `${t('department')} "${c}"`)].join(', ')}</Alert>
          ) : null}
          <div className="mt-3 flex gap-2">{['', 'CREATE', 'DUPLICATE', 'ERROR'].map((a) => <Button key={a} size="sm" variant={filter === a ? 'primary' : 'secondary'} onClick={() => setFilter(a)}>{a ? label(a) : t('All')}</Button>)}</div>
          <div className="mt-2 max-h-[50vh] overflow-auto">
            <table className="min-w-full text-sm">
              <thead><tr className="text-left text-xs uppercase text-slate-500"><th className="px-2 py-1">{t('Row')}</th><th className="px-2">{t('Case no.')}</th><th className="px-2">{t('Court')}</th><th className="px-2">{t('Result')}</th><th className="px-2">{t('Details')}</th></tr></thead>
              <tbody className="divide-y">{prev.rows.filter((r) => !filter || r.action === filter).map((r) => (
                <tr key={r.rowNo}><td className="px-2 py-1">{r.rowNo}</td><td className="px-2">{r.caseNo || '—'}</td><td className="px-2">{r.court}</td><td className="px-2"><Badge tone={r.action === 'CREATE' ? 'green' : r.action === 'ERROR' ? 'red' : 'amber'}>{label(r.action)}</Badge></td>
                  <td className="px-2 text-xs">{[...r.errors.map((e) => `✖ ${e}`), ...r.warnings.map((w) => `⚠ ${w}`)].join(' · ')}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      ) : null}
      <Card title={t('Previous imports')}>
        <ul className="divide-y text-sm">{history.data?.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>{b.filename} · {fmtDateTime(b.createdAt)} · {b.stats ? t('{n} created', { n: b.stats.created ?? 0 }) : ''}</span>
            <span className="flex items-center gap-2"><StatusBadge value={b.status} />{b.status === 'COMMITTED' && can('lit:import.rollback', 'LIT') ? <Button size="sm" variant="danger" onClick={() => { setRollback(b.id); setReason(''); }}>{t('Roll back')}</Button> : null}</span>
          </li>
        ))}</ul>
      </Card>
      <Modal open={!!rollback} title={t('Roll back this import')} onClose={() => setRollback(null)} footer={<Button variant="danger" busy={act.busy} disabled={reason.length < 3} onClick={() => act.run(async () => { await api.post(`/litigation/import/${rollback}/rollback`, { reason }); setRollback(null); await history.reload(); })}>{t('Remove imported cases')}</Button>}>
        <Alert tone="amber">{t('All cases created by this batch, and their hearings and calendar entries, will be removed.')}</Alert>
        <Field label={t('Reason')}>{(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </Modal>
    </div>
  );
}
