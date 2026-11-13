'use client';
import { useState } from 'react';
import { ROLES, UNITS, UNIT_NAMES, UNIT_SCOPED_ROLES } from '@ldms/shared';
import { api, download } from '@/lib/api';
import { useApi, useAction } from '@/lib/hooks';
import { fmtDateTime, label } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { DataTable } from '@/components/data-table';
import { Alert, Badge, Button, Field, Input, Modal, PageHeader, Select, StatusBadge, Textarea } from '@/components/ui';

interface U { id: string; username: string; displayName: string; email: string; status: string; isAdminAccount: boolean; lastLoginAt: string | null; lockedUntil: string | null; accessExpiresAt: string | null; departmentId: string | null; roles: { role: string; unit: string | null }[]; department: { name: string } | null }
type Role = { role: string; unit: string | null };

export default function UsersAdmin() {
  const { can } = useAuth();
  const manage = can('users:manage');
  const [q, setQ] = useState('');
  const { data, reload, loading } = useApi<U[]>(`/users?q=${encodeURIComponent(q)}`, [q]);
  const depts = useApi<{ id: string; name: string }[]>('/config/departments');
  const [edit, setEdit] = useState<U | null>(null);
  const [create, setCreate] = useState(false);
  const [nu, setNu] = useState({ username: '', displayName: '', email: '', departmentId: '', isAdminAccount: false, accessExpiresAt: '' });
  const [roles, setRoles] = useState<Role[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const [work, setWork] = useState<{ total: number; assignments: { role: string; count: number }[] } | null>(null);
  const [reason, setReason] = useState('');
  const act = useAction();

  const RoleEditor = () => (
    <div className="space-y-2">
      {roles.map((r, i) => (
        <div key={i} className="flex gap-2">
          <Select aria-label={t('Role')} value={r.role} onChange={(e) => setRoles(roles.map((x, j) => (j === i ? { role: e.target.value, unit: UNIT_SCOPED_ROLES.includes(e.target.value as never) ? x.unit ?? 'LIT' : null } : x)))} options={ROLES.map((x) => ({ value: x, label: label(x) }))} />
          {UNIT_SCOPED_ROLES.includes(r.role as never) ? <Select aria-label={t('Unit')} value={r.unit ?? ''} onChange={(e) => setRoles(roles.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} options={UNITS.map((u) => ({ value: u, label: UNIT_NAMES[u] }))} /> : null}
          <Button variant="ghost" onClick={() => setRoles(roles.filter((_, j) => j !== i))} aria-label={t('Remove role')}>✕</Button>
        </div>
      ))}
      <Button size="sm" variant="secondary" onClick={() => setRoles([...roles, { role: 'LEGAL_OFFICER', unit: 'LIT' }])}>{t('Add role')}</Button>
    </div>
  );

  return (
    <div>
      <PageHeader title={t('Users')} subtitle={t('Create accounts, assign roles, reset sign-in, and run the quarterly access review.')}
        actions={<>
          {can('accessreview:read') ? <Button variant="secondary" onClick={() => act.run(() => download('/users/access-review?format=xlsx'))}>{t('Access review (Excel)')}</Button> : null}
          {manage ? <Button onClick={() => { setNu({ username: '', displayName: '', email: '', departmentId: '', isAdminAccount: false, accessExpiresAt: '' }); setRoles([]); setResult(null); setCreate(true); }}>{t('New user')}</Button> : null}
        </>} />
      {act.error ? <Alert>{act.error}</Alert> : null}
      {result ? <Alert tone="amber">{result}</Alert> : null}
      <Input aria-label={t('Search')} className="mb-3 w-72" placeholder={t('Search name, username, email')} value={q} onChange={(e) => setQ(e.target.value)} />
      <DataTable id="users" rows={data} loading={loading} total={data?.length} onRowClick={manage ? (u) => { setEdit(u); setRoles(u.roles.map((r) => ({ role: r.role, unit: r.unit }))); setWork(null); setReason(''); } : undefined}
        columns={[
          { key: 'displayName', header: t('Name'), render: (u) => <><div className="font-medium">{u.displayName}</div><div className="text-xs text-slate-500">{u.username}</div></> },
          { key: 'department', header: t('Department'), render: (u) => u.department?.name ?? '—', hideOnMobile: true },
          { key: 'roles', header: t('Roles'), render: (u) => <div className="flex flex-wrap gap-1">{u.isAdminAccount ? <Badge tone="purple">{t('Admin account')}</Badge> : null}{u.roles.map((r) => <Badge key={r.role + r.unit} tone="blue">{label(r.role)}{r.unit ? ` · ${r.unit}` : ''}</Badge>)}</div> },
          { key: 'status', header: t('Status'), render: (u) => <>{<StatusBadge value={u.status} />}{u.lockedUntil && new Date(u.lockedUntil) > new Date() ? <> <Badge tone="red">{t('Locked')}</Badge></> : null}</> },
          { key: 'lastLoginAt', header: t('Last sign-in'), render: (u) => fmtDateTime(u.lastLoginAt), hideOnMobile: true },
        ]} />
      <Modal open={create} title={t('New user')} onClose={() => setCreate(false)}
        footer={<><Button variant="secondary" onClick={() => setCreate(false)}>{t('Cancel')}</Button><Button busy={act.busy} onClick={() => act.run(async () => {
          const r = await api.post<{ temporaryPassword?: string; setupLinkSent: boolean }>('/users', { ...nu, departmentId: nu.departmentId || null, accessExpiresAt: nu.accessExpiresAt ? new Date(`${nu.accessExpiresAt}T23:59:00+05:00`).toISOString() : null, roles });
          setCreate(false);
          setResult(r.temporaryPassword ? t('Account created. Give the user this temporary password in person (shown once): {pw}. They must change it and set up their authenticator at first sign-in.', { pw: r.temporaryPassword }) : t('Account created. A one-time setup link (valid 24 hours) was emailed to the user.'));
          await reload();
        })}>{t('Create')}</Button></>}>
        {act.error ? <Alert>{act.error}</Alert> : null}
        <Field label={t('Username')} required>{(id) => <Input id={id} value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} />}</Field>
        <Field label={t('Full name')} required>{(id) => <Input id={id} value={nu.displayName} onChange={(e) => setNu({ ...nu, displayName: e.target.value })} />}</Field>
        <Field label={t('Email')} required>{(id) => <Input id={id} type="email" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} />}</Field>
        <Field label={t('Department')}>{(id) => <Select id={id} placeholder={t('— Select —')} value={nu.departmentId} onChange={(e) => setNu({ ...nu, departmentId: e.target.value })} options={(depts.data ?? []).map((d) => ({ value: d.id, label: d.name }))} />}</Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={nu.isAdminAccount} onChange={(e) => setNu({ ...nu, isAdminAccount: e.target.checked })} />{t('Separate admin account (IT only; cannot hold legal roles)')}</label>
        <Field label={t('Access expires (required for auditors)')}>{(id) => <Input id={id} type="date" value={nu.accessExpiresAt} onChange={(e) => setNu({ ...nu, accessExpiresAt: e.target.value })} />}</Field>
        <div><div className="mb-1 text-sm font-medium">{t('Roles')}</div><RoleEditor /></div>
      </Modal>
      <Modal open={!!edit} wide title={edit?.displayName ?? ''} onClose={() => setEdit(null)}>
        {edit ? (
          <div className="space-y-4">
            {act.error ? <Alert>{act.error}</Alert> : null}
            <div><div className="mb-1 text-sm font-medium">{t('Roles')}</div><RoleEditor />
              <Button className="mt-2" size="sm" busy={act.busy} onClick={() => act.run(async () => { await api.put(`/users/${edit.id}/roles`, { roles }); await reload(); setEdit(null); })}>{t('Save roles')}</Button></div>
            <div className="flex flex-wrap gap-2 border-t pt-3">
              <Button size="sm" variant="secondary" onClick={() => act.run(async () => { const r = await api.post<{ temporaryPassword?: string }>(`/users/${edit.id}/reset`, { password: true }); setResult(r.temporaryPassword ? t('New temporary password for {u}: {pw}', { u: edit.username, pw: r.temporaryPassword }) : t('Reset link emailed.')); setEdit(null); })}>{t('Reset password')}</Button>
              <Button size="sm" variant="secondary" onClick={() => act.run(async () => { await api.post(`/users/${edit.id}/reset`, { mfa: true }); setResult(t('Two-factor reset. {u} will set up a new authenticator at next sign-in.', { u: edit.username })); setEdit(null); })}>{t('Reset two-factor')}</Button>
              <Button size="sm" variant="secondary" onClick={() => act.run(async () => { await api.post(`/users/${edit.id}/unlock`); await reload(); setEdit(null); })}>{t('Unlock')}</Button>
              {edit.status === 'DISABLED'
                ? <Button size="sm" onClick={() => act.run(async () => { await api.post(`/users/${edit.id}/enable`); await reload(); setEdit(null); })}>{t('Enable')}</Button>
                : <Button size="sm" variant="secondary" onClick={() => act.run(async () => setWork(await api.get(`/users/${edit.id}/open-work`)))}>{t('Leaver checklist')}</Button>}
            </div>
            {work ? (
              <div className="space-y-2 rounded-md border p-3">
                <div className="text-sm font-medium">{t('Open work: {n} assignment(s)', { n: work.total })}</div>
                <ul className="text-sm">{work.assignments.map((a) => <li key={a.role}>{label(a.role)}: {a.count}</li>)}</ul>
                {work.total > 0 ? <Alert tone="amber">{t('Ask the HoD or Unit Head to reassign this work (Users → leaver) before disabling. Emergency disable is for security incidents.')}</Alert> : null}
                <Field label={t('Reason')}>{(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
                <div className="flex gap-2">
                  <Button size="sm" variant="danger" disabled={work.total > 0 || reason.length < 3} onClick={() => act.run(async () => { await api.post(`/users/${edit.id}/disable`, { reason }); await reload(); setEdit(null); })}>{t('Disable')}</Button>
                  <Button size="sm" variant="danger" disabled={reason.length < 3} onClick={() => act.run(async () => { await api.post(`/users/${edit.id}/disable`, { reason, emergency: true }); await reload(); setEdit(null); })}>{t('Emergency disable')}</Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
