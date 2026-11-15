'use client';
import { useState } from 'react';
import { UNIT_NAMES } from '@ldms/shared';
import { api, download } from '@/lib/api';
import { useApi, useAction } from '@/lib/hooks';
import { fmtDateTime, label } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, StatusBadge, Tabs } from '@/components/ui';

interface Template { id: string; name: string; unit: string | null; period: string; format: string; active: boolean; createdAt: string; file: { filename: string; scanStatus: string; createdAt: string } | null }
interface FieldDef { group: string; key: string; label: string; list?: string[] }

const UNIT_OPTIONS = [{ value: '', label: 'Whole department' }, ...(['LIT', 'DRF', 'CMP', 'AWR'] as const).map((u) => ({ value: u, label: UNIT_NAMES[u] }))];
const today = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

export default function Reports() {
  const [tab, setTab] = useState('formats');
  return (
    <div>
      <PageHeader title={t('Reports')} subtitle={t('Weekly and monthly reports for every unit, in your own Excel or Word formats.')} />
      <Tabs tabs={[{ id: 'formats', label: t('My report formats') }, { id: 'standard', label: t('Standard report') }, { id: 'help', label: t('Placeholders & samples') }]} active={tab} onChange={setTab} />
      {tab === 'formats' ? <Formats /> : tab === 'standard' ? <Standard /> : <Help />}
    </div>
  );
}

/** Period picker shared by both report kinds: a week is chosen by any date in it, a month by YYYY-MM. */
function PeriodPicker({ period, setPeriod, ref_, setRef }: { period: string; setPeriod: (p: string) => void; ref_: string; setRef: (r: string) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label={t('Period')}>{(id) => <Select id={id} value={period} onChange={(e) => { setPeriod(e.target.value); setRef(e.target.value === 'MONTHLY' ? today().slice(0, 7) : today()); }} options={[{ value: 'WEEKLY', label: t('Weekly (Sunday – Saturday)') }, { value: 'MONTHLY', label: t('Monthly') }]} />}</Field>
      {period === 'WEEKLY'
        ? <Field label={t('Any day of the week')}>{(id) => <Input id={id} type="date" value={ref_} onChange={(e) => setRef(e.target.value)} />}</Field>
        : <Field label={t('Month')}>{(id) => <Input id={id} type="month" value={ref_} onChange={(e) => setRef(e.target.value)} />}</Field>}
    </div>
  );
}

function Formats() {
  const { me } = useAuth();
  const manage = !!me?.roles.some((r) => r.role === 'HOD' || r.role === 'UNIT_HEAD' || r.role === 'SUPER_ADMIN');
  const { data, reload } = useApi<Template[]>('/reports/templates');
  const [period, setPeriod] = useState('WEEKLY');
  const [ref_, setRef] = useState(today());
  const [upload, setUpload] = useState<{ id?: string; name: string; unit: string; period: string; file: File | null } | null>(null);
  const act = useAction();
  const send = () => act.run(async () => {
    const fd = new FormData();
    if (upload!.file) fd.set('file', upload!.file);
    fd.set('name', upload!.name); fd.set('unit', upload!.unit); fd.set('period', upload!.period);
    if (upload!.id) await api.patch(`/reports/templates/${upload!.id}`, fd); else await api.form('/reports/templates', fd);
    setUpload(null); await reload();
  });
  return (
    <div className="space-y-4">
      <Card title={t('Generate a report')}>
        <PeriodPicker period={period} setPeriod={setPeriod} ref_={ref_} setRef={setRef} />
        <p className="mt-2 text-xs text-slate-500">{t('Choose the period, then "Generate" next to a format. The file is filled with the live data you are allowed to see.')}</p>
      </Card>
      <Card title={t('Report formats')} actions={manage ? <Button size="sm" onClick={() => setUpload({ name: '', unit: '', period: 'ANY', file: null })}>{t('Upload a format')}</Button> : null}>
        {act.error ? <Alert>{act.error}</Alert> : null}
        {!data ? null : !data.length ? <Empty>{t('No formats yet. Upload your Excel or Word report format (see "Placeholders & samples").')}</Empty> : (
          <ul className="divide-y text-sm" data-testid="report-formats">{data.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="space-x-1"><span className="font-medium">{r.name}</span> <Badge>{r.format === 'XLSX' ? 'Excel' : 'Word'}</Badge><Badge tone="blue">{r.unit ? UNIT_NAMES[r.unit as 'LIT'] : t('Whole department')}</Badge><Badge>{r.period === 'ANY' ? t('Weekly or monthly') : label(r.period)}</Badge>{!r.active ? <Badge tone="amber">{t('Inactive')}</Badge> : null}
                <span className="text-xs text-slate-500">{r.file ? `${r.file.filename} · ${fmtDateTime(r.file.createdAt)}` : ''}</span>{r.file && r.file.scanStatus !== 'CLEAN' ? <StatusBadge value={r.file.scanStatus} /> : null}</span>
              <span className="flex flex-wrap gap-1">
                {r.active ? <Button size="sm" busy={act.busy} disabled={r.period !== 'ANY' && r.period !== period} onClick={() => act.run(() => download(`/reports/templates/${r.id}/generate?period=${period}&ref=${encodeURIComponent(ref_)}`, `${r.name}.${r.format === 'XLSX' ? 'xlsx' : 'docx'}`))}>{t('Generate')}</Button> : null}
                {manage ? <Button size="sm" variant="ghost" onClick={() => setUpload({ id: r.id, name: r.name, unit: r.unit ?? '', period: r.period, file: null })}>{t('Edit / replace file')}</Button> : null}
                {manage ? <Button size="sm" variant="ghost" onClick={() => act.run(async () => { const fd = new FormData(); fd.set('active', String(!r.active)); await api.patch(`/reports/templates/${r.id}`, fd); await reload(); })}>{r.active ? t('Deactivate') : t('Activate')}</Button> : null}
              </span>
            </li>
          ))}</ul>
        )}
      </Card>
      <Modal open={!!upload} title={upload?.id ? t('Edit report format') : t('Upload a report format')} onClose={() => setUpload(null)} footer={<Button busy={act.busy} disabled={!upload?.name.trim() || (!upload?.id && !upload?.file)} onClick={send}>{t('Save')}</Button>}>
        {act.error ? <Alert>{act.error}</Alert> : null}
        {upload ? <>
          <Field label={t('Name')} required>{(id) => <Input id={id} value={upload.name} onChange={(e) => setUpload({ ...upload, name: e.target.value })} />}</Field>
          <Field label={t('Unit')}>{(id) => <Select id={id} value={upload.unit} onChange={(e) => setUpload({ ...upload, unit: e.target.value })} options={UNIT_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))} />}</Field>
          <Field label={t('Used for')}>{(id) => <Select id={id} value={upload.period} onChange={(e) => setUpload({ ...upload, period: e.target.value })} options={[{ value: 'ANY', label: t('Weekly or monthly') }, { value: 'WEEKLY', label: t('Weekly only') }, { value: 'MONTHLY', label: t('Monthly only') }]} />}</Field>
          <Field label={upload.id ? t('New file (optional, replaces the current one)') : t('Excel (.xlsx) or Word (.docx) file')} required={!upload.id}>{(id) => <input id={id} type="file" accept=".xlsx,.docx" className="block w-full text-sm" onChange={(e) => setUpload({ ...upload, file: e.target.files?.[0] ?? null })} />}</Field>
          <p className="text-xs text-slate-500">{t('The file is virus-scanned before it can be used. Old versions are kept.')}</p>
        </> : null}
      </Modal>
    </div>
  );
}

function Standard() {
  const [kind, setKind] = useState('weekly');
  const [ref_, setRef] = useState(today());
  const [unit, setUnit] = useState('');
  const period = kind === 'weekly' ? ref_ : kind === 'monthly' ? ref_.slice(0, 7) : ref_.slice(0, 4);
  const { data, error } = useApi<{ title: string; sections: { title: string; rows: [string, string | number][] }[] }>(`/reports/management?kind=${kind}&period=${period}${unit ? `&unit=${unit}` : ''}`, [kind, period, unit]);
  const act = useAction();
  const q = `kind=${kind}&period=${period}${unit ? `&unit=${unit}` : ''}`;
  return (
    <Card title={t('Standard management report')} actions={<>
      <Button size="sm" variant="secondary" busy={act.busy} onClick={() => act.run(() => download(`/reports/management?${q}&format=pdf`))}>{t('PDF')}</Button>
      <Button size="sm" variant="secondary" busy={act.busy} onClick={() => act.run(() => download(`/reports/management?${q}&format=xlsx`))}>{t('Excel')}</Button>
    </>}>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Field label={t('Period')}>{(id) => <Select id={id} value={kind} onChange={(e) => setKind(e.target.value)} options={[{ value: 'weekly', label: t('Weekly') }, { value: 'monthly', label: t('Monthly') }, { value: 'annual', label: t('Annual') }]} />}</Field>
        <Field label={kind === 'weekly' ? t('Any day of the week') : kind === 'monthly' ? t('Any day of the month') : t('Any day of the year')}>{(id) => <Input id={id} type="date" value={ref_} onChange={(e) => setRef(e.target.value)} />}</Field>
        <Field label={t('Unit')}>{(id) => <Select id={id} value={unit} onChange={(e) => setUnit(e.target.value)} options={UNIT_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))} />}</Field>
      </div>
      {act.error ? <Alert>{act.error}</Alert> : null}
      {error ? <Alert>{error.message}</Alert> : !data ? null : (
        <div className="grid gap-4 md:grid-cols-2">{data.sections.map((s) => (
          <div key={s.title}><h3 className="mb-1 text-sm font-semibold">{s.title}</h3>
            <table className="w-full text-sm"><tbody>{s.rows.map(([k, v]) => <tr key={k} className="border-b last:border-0"><td className="py-1 pr-2 text-slate-600">{k}</td><td className="py-1 text-right font-medium">{v}</td></tr>)}</tbody></table>
          </div>
        ))}</div>
      )}
    </Card>
  );
}

function Help() {
  const { data } = useApi<FieldDef[]>('/reports/fields');
  const act = useAction();
  const groups = [...new Set((data ?? []).map((f) => f.group))];
  return (
    <div className="space-y-4">
      <Card title={t('How report formats work')}>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>{t('Make your report in Excel or Word, as you want it to look (logo, headings, tables).')}</li>
          <li>{t('Where a value should go, type a placeholder in double curly braces, e.g. {{report.period}} or {{lit.counts.hearings}}.')}</li>
          <li>{t('Excel tables: put list placeholders in one row, e.g. {{lit.hearings.date}} | {{lit.hearings.reference}} | {{lit.hearings.chitSummary}}. That row is repeated for every hearing. {{#}} gives the row number.')}</li>
          <li>{t('Word tables / paragraphs: wrap the row in {{#lit.hearings}} … {{/lit.hearings}} and use {{date}}, {{reference}} … inside.')}</li>
          <li>{t('Upload it under "My report formats". When the format changes, upload the new file: no change to the system is needed.')}</li>
        </ol>
        <div className="mt-3 flex flex-wrap gap-2">
          {UNIT_OPTIONS.map((u) => <Button key={u.value} size="sm" variant="secondary" busy={act.busy} onClick={() => act.run(() => download(`/reports/sample-template${u.value ? `?unit=${u.value}` : ''}`, 'report-format-sample.xlsx'))}>{t('Sample Excel: {u}', { u: t(u.label) })}</Button>)}
        </div>
        {act.error ? <Alert>{act.error}</Alert> : null}
      </Card>
      {groups.map((g) => (
        <Card key={g} title={t(g)}>
          <table className="w-full text-sm"><tbody>{(data ?? []).filter((f) => f.group === g).map((f) => (
            <tr key={f.key} className="border-b align-top last:border-0">
              <td className="py-1 pr-3"><code className="text-xs" dir="ltr">{f.list ? `{{${f.key}.…}}` : `{{${f.key}}}`}</code></td>
              <td className="py-1">{f.label}{f.list ? <div className="text-xs text-slate-500">{t('Fields')}: {f.list.join(', ')}</div> : null}</td>
            </tr>
          ))}</tbody></table>
        </Card>
      ))}
    </div>
  );
}
