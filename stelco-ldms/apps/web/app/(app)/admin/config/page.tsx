'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useAction } from '@/lib/hooks';
import { label } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { Alert, Button, Card, Field, Input, Modal, PageHeader, Select, Textarea } from '@/components/ui';

type FieldDef = { key: string; label: string; type?: 'text' | 'number' | 'bool' | 'textarea' | 'date' | 'select'; options?: string[] };
const LISTS: Record<string, { title: string; fields: FieldDef[] }> = {
  holidays: { title: 'Public holidays', fields: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'name', label: 'Name' }] },
  'sla-policies': { title: 'SLA targets', fields: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'target', label: 'Target (days)', type: 'number' }, { key: 'unit', label: 'Counting', type: 'select', options: ['BUSINESS', 'CALENDAR'] }, { key: 'urgentHalves', label: 'Urgent halves target', type: 'bool' }, { key: 'active', label: 'Active', type: 'bool' }] },
  departments: { title: 'Departments', fields: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'active', label: 'Active', type: 'bool' }] },
  'request-types': { title: 'Request types', fields: [{ key: 'unit', label: 'Unit', type: 'select', options: ['LIT', 'CMP', 'DRF', 'AWR'] }, { key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'slaPolicyId', label: 'SLA policy id' }, { key: 'active', label: 'Active', type: 'bool' }] },
  'email-templates': { title: 'Email & reply templates', fields: [{ key: 'code', label: 'Code' }, { key: 'subject', label: 'Subject' }, { key: 'body', label: 'Body ({{reference}}, {{senderName}}, {{subject}}, {{dueDate}}, {{unit}})', type: 'textarea' }] },
  'document-types': { title: 'Document types', fields: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'unit', label: 'Unit', type: 'select', options: ['', 'LIT', 'CMP', 'DRF', 'AWR'] }] },
  'law-firms': { title: 'External law firms', fields: [{ key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' }, { key: 'address', label: 'Address' }, { key: 'active', label: 'Active', type: 'bool' }] },
  'external-lawyers': { title: 'External lawyers', fields: [{ key: 'firmId', label: 'Firm id' }, { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' }] },
  regulators: { title: 'Regulators', fields: [{ key: 'name', label: 'Name' }, { key: 'website', label: 'Website' }] },
  courts: { title: 'Courts & forums', fields: [{ key: 'name', label: 'Name' }, { key: 'kind', label: 'Kind', type: 'select', options: ['COURT', 'TRIBUNAL', 'ARBITRATION'] }, { key: 'jurisdiction', label: 'Jurisdiction' }] },
  'retention-policies': { title: 'Retention periods', fields: [{ key: 'recordType', label: 'Record type' }, { key: 'years', label: 'Years', type: 'number' }, { key: 'trigger', label: 'Counted from' }] },
};

type Row = Record<string, unknown> & { id: string };

export default function ConfigAdmin() {
  const { can } = useAuth();
  const manage = can('config:manage');
  const [list, setList] = useState('holidays');
  const def = LISTS[list]!;
  const { data, reload } = useApi<Row[]>(`/config/${list}`, [list]);
  const settings = useApi<Record<string, unknown>>('/config/settings');
  const [edit, setEdit] = useState<Row | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [setting, setSetting] = useState<{ key: string; value: string } | null>(null);
  const act = useAction();

  const open = (r: Row | null) => { setEdit(r ?? ({ id: '' } as Row)); setForm(r ? { ...r } : Object.fromEntries(def.fields.map((f) => [f.key, f.type === 'bool' ? true : '']))); };
  const save = () => act.run(async () => {
    const body: Record<string, unknown> = {};
    for (const f of def.fields) {
      const v = form[f.key];
      body[f.key] = f.type === 'number' ? Number(v) : f.type === 'bool' ? !!v : v === '' ? null : v;
    }
    if (edit?.id) await api.patch(`/config/${list}/${edit.id}`, body); else await api.post(`/config/${list}`, body);
    setEdit(null); await reload();
  });

  return (
    <div className="space-y-4">
      <PageHeader title={t('Configuration')} subtitle={t('Reference lists and rules, maintained without code changes. Every change is audit-logged.')} />
      {act.error ? <Alert>{act.error}</Alert> : null}
      <div className="flex flex-wrap gap-2">{Object.entries(LISTS).map(([k, v]) => <Button key={k} size="sm" variant={k === list ? 'primary' : 'secondary'} onClick={() => setList(k)}>{t(v.title)}</Button>)}</div>
      <Card title={t(def.title)} actions={manage ? <Button size="sm" onClick={() => open(null)}>{t('Add')}</Button> : null}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead><tr>{def.fields.map((f) => <th key={f.key} className="px-2 py-1 text-left text-xs uppercase text-slate-500">{t(f.label)}</th>)}<th /></tr></thead>
            <tbody className="divide-y">
              {data?.map((r) => (
                <tr key={r.id}>
                  {def.fields.map((f) => <td key={f.key} className="max-w-xs truncate px-2 py-1.5">{f.type === 'bool' ? (r[f.key] ? '✓' : '—') : String(r[f.key] ?? '—')}</td>)}
                  <td className="whitespace-nowrap px-2 py-1 text-right">{manage ? <><Button size="sm" variant="ghost" onClick={() => open(r)}>{t('Edit')}</Button><Button size="sm" variant="ghost" onClick={() => act.run(async () => { if (confirm(t('Delete this item?'))) { await api.del(`/config/${list}/${r.id}`); await reload(); } })}>{t('Delete')}</Button></> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title={t('System settings')}>
        <ul className="divide-y text-sm">
          {Object.entries(settings.data ?? {}).map(([k, v]) => (
            <li key={k} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div><div className="font-medium">{label(k.replace('.', '_'))}</div><code className="text-xs text-slate-600">{JSON.stringify(v)}</code></div>
              {manage ? <Button size="sm" variant="ghost" onClick={() => setSetting({ key: k, value: JSON.stringify(v, null, 1) })}>{t('Edit')}</Button> : null}
            </li>
          ))}
        </ul>
      </Card>
      <Modal open={!!edit} title={edit?.id ? t('Edit') : t('Add')} onClose={() => setEdit(null)} footer={<Button busy={act.busy} onClick={save}>{t('Save')}</Button>}>
        {act.error ? <Alert>{act.error}</Alert> : null}
        {def.fields.map((f) => (
          f.type === 'bool'
            ? <label key={f.key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.checked })} />{t(f.label)}</label>
            : <Field key={f.key} label={t(f.label)}>{(id) => f.type === 'textarea'
              ? <Textarea id={id} rows={8} value={String(form[f.key] ?? '')} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
              : f.type === 'select'
                ? <Select id={id} value={String(form[f.key] ?? '')} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} options={f.options!.map((o) => ({ value: o, label: o || '—' }))} />
                : <Input id={id} type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} value={String(form[f.key] ?? '')} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />}</Field>
        ))}
      </Modal>
      <Modal open={!!setting} title={setting?.key ?? ''} onClose={() => setSetting(null)} footer={<Button busy={act.busy} onClick={() => act.run(async () => { await api.put(`/config/settings/${setting!.key}`, { value: JSON.parse(setting!.value) }); setSetting(null); await settings.reload(); })}>{t('Save')}</Button>}>
        <Field label={t('Value (JSON)')}>{(id) => <Textarea id={id} rows={6} className="font-mono" value={setting?.value ?? ''} onChange={(e) => setSetting({ ...setting!, value: e.target.value })} />}</Field>
      </Modal>
    </div>
  );
}
