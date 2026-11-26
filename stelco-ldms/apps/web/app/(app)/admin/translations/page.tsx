'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useAction } from '@/lib/hooks';
import { builtinDhivehi, englishKeys, t } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select } from '@/components/ui';

/**
 * HoD / IT admin: the Dhivehi wording of the screens. The built-in wording is a starting draft;
 * what is saved here replaces it for everyone. Empty = the screen shows English.
 * Status and type names (e.g. "In drafting") can be added with "Add a wording".
 */
export default function Translations() {
  const { me, can } = useAuth();
  const allowed = !!me?.roles.some((r) => r.role === 'HOD') || can('config:manage');
  const saved = useApi<Record<string, string>>('/config/i18n/dv');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [q, setQ] = useState('');
  const [show, setShow] = useState('missing');
  const [extra, setExtra] = useState('');
  const act = useAction();
  const [done, setDone] = useState(false);
  useEffect(() => { if (saved.data) setEdits({ ...builtinDhivehi, ...saved.data }); }, [saved.data]);
  const keys = useMemo(() => [...new Set([...englishKeys(), ...Object.keys(saved.data ?? {})])].sort((a, b) => a.localeCompare(b)), [saved.data]);
  const rows = keys.filter((k) => (!q || k.toLowerCase().includes(q.toLowerCase()) || (edits[k] ?? '').includes(q))
    && (show === 'all' || (show === 'missing' ? !edits[k] : !!edits[k])));
  const translated = keys.filter((k) => edits[k]).length;
  if (!allowed) return <Alert>{t('Only the HoD or the IT administrator can change the Dhivehi wording.')}</Alert>;
  const save = () => act.run(async () => {
    // Store everything that differs from the built-in draft (including deliberate blanks of built-in entries are not possible: blank = English).
    const out = Object.fromEntries(Object.entries(edits).filter(([k, v]) => v.trim() && v !== builtinDhivehi[k]));
    await api.put('/config/i18n/dv', { translations: out });
    setDone(true); await saved.reload();
  });
  return (
    <div className="space-y-4">
      <PageHeader title={t('Dhivehi wording')} subtitle={t('How the screens read in Dhivehi. The first wording is a draft: please check and correct it. Saved wording applies to everyone who chooses ދިވެހި.')} />
      {act.error ? <Alert>{act.error}</Alert> : null}
      {done ? <Alert tone="green">{t('Saved. Users see it the next time they open LDMS in Dhivehi.')}</Alert> : null}
      <Card>
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t('Search')}>{(id) => <Input id={id} className="w-64" value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
          <Field label={t('Show')}>{(id) => <Select id={id} value={show} onChange={(e) => setShow(e.target.value)} options={[{ value: 'missing', label: t('Not translated yet') }, { value: 'done', label: t('Translated') }, { value: 'all', label: t('All') }]} />}</Field>
          <Badge tone="blue">{t('{n} of {m} translated', { n: translated, m: keys.length })}</Badge>
          <Button busy={act.busy} onClick={save}>{t('Save')}</Button>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label={t('Add a wording for other English text (e.g. a status name)')}>{(id) => <Input id={id} className="w-72" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="In drafting" />}</Field>
          <Button variant="secondary" disabled={!extra.trim()} onClick={() => { setEdits({ ...edits, [extra.trim()]: edits[extra.trim()] ?? '' }); setQ(extra.trim()); setShow('all'); setExtra(''); }}>{t('Add')}</Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">{t('Keep {placeholders} such as {n} exactly as they are. Ctrl+Shift+D switches the Dhivehi keyboard.')}</p>
      </Card>
      <Card>
        <table className="w-full text-sm" data-testid="translations">
          <thead><tr className="text-start text-xs text-slate-500"><th className="w-1/2 py-1 text-start">{t('English')}</th><th className="py-1 text-start">{t('Dhivehi')}</th></tr></thead>
          <tbody className="divide-y">{rows.slice(0, 300).map((k) => (
            <tr key={k}>
              <td className="py-1.5 pe-3 align-top" dir="ltr">{k}</td>
              <td className="py-1"><Input aria-label={k} value={edits[k] ?? ''} onChange={(e) => setEdits({ ...edits, [k]: e.target.value })} /></td>
            </tr>
          ))}</tbody>
        </table>
        {rows.length > 300 ? <p className="mt-2 text-xs text-slate-500">{t('Showing 300 of {n}. Use search to find others.', { n: rows.length })}</p> : null}
      </Card>
    </div>
  );
}
