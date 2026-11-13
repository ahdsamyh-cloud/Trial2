'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { api, download } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { t } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { Alert, Button, Card, PageHeader } from '@/components/ui';

type Result = { total: number; valid: number; errors: { row: number; errors: string[] }[]; committed: boolean };

function Importer({ kind, title }: { kind: 'contracts' | 'laws'; title: string }) {
  const file = useRef<HTMLInputElement>(null);
  const [r, setR] = useState<Result | null>(null);
  const act = useAction();
  const run = (commit: boolean) => act.run(async () => { const f = file.current?.files?.[0]; if (!f) throw new Error(t('Choose the Excel file')); const fd = new FormData(); fd.set('file', f); setR(await api.form<Result>(`/imports/${kind}?commit=${commit}`, fd)); });
  return (
    <Card title={title} actions={<Button size="sm" variant="ghost" onClick={() => act.run(() => download(`/imports/${kind}/template`))}>{t('Template')}</Button>}>
      {act.error ? <Alert>{act.error}</Alert> : null}
      <div className="flex flex-wrap items-center gap-2"><input ref={file} type="file" accept=".xlsx" aria-label={title} className="text-sm" onChange={() => setR(null)} /><Button size="sm" variant="secondary" busy={act.busy} onClick={() => run(false)}>{t('Check (dry run)')}</Button>{r && !r.committed && r.valid ? <Button size="sm" busy={act.busy} onClick={() => run(true)}>{t('Import {n} row(s)', { n: r.valid })}</Button> : null}</div>
      {r ? <div className="mt-2 text-sm">{r.committed ? <Alert tone="green">{t('{n} row(s) imported.', { n: r.valid })}</Alert> : t('{v} of {n} rows are valid.', { v: r.valid, n: r.total })}<ul className="mt-1 text-xs text-red-700">{r.errors.slice(0, 30).map((e) => <li key={e.row}>{t('Row')} {e.row}: {e.errors.join('; ')}</li>)}</ul></div> : null}
    </Card>
  );
}

export default function Imports() {
  const { can } = useAuth();
  return (
    <div className="space-y-4">
      <PageHeader title={t('Data import')} subtitle={t('Load existing registers from Excel. Every import has a dry run first.')} />
      <div className="grid gap-4 lg:grid-cols-2">
        {can('lit:import', 'LIT') ? <Card title={t('Litigation register')}><p className="text-sm">{t('Use the guided wizard with column mapping and rollback.')}</p><Link href="/litigation/import"><Button className="mt-2" size="sm">{t('Open wizard')}</Button></Link></Card> : null}
        {can('draft:draft', 'DRF') || can('matter:write', 'DRF') ? <Importer kind="contracts" title={t('Contract register')} /> : null}
        {can('cmp:write', 'CMP') ? <Importer kind="laws" title={t('Laws and regulations')} /> : null}
        {can('awr:write', 'AWR') ? <Card title={t('Staff list (HR)')}><p className="text-sm">{t('Import the staff list from Awareness → Staff records.')}</p><Link href="/awareness"><Button className="mt-2" size="sm">{t('Open')}</Button></Link></Card> : null}
      </div>
    </div>
  );
}
