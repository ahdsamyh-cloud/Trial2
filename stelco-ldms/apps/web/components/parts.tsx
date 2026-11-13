'use client';
import { UPLOAD_ACCEPT } from '@ldms/shared';
import { useRef, useState } from 'react';
import { api, downloadVersion } from '@/lib/api';
import { useApi, useAction } from '@/lib/hooks';
import { fmtDateTime, label } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, Select, StatusBadge, Textarea } from './ui';

export interface DocRow {
  id: string; title: string; docTypeCode: string | null; legalHold: boolean; checkedOutById: string | null; sharedToPortal: boolean; createdAt: string;
  versions: { id: string; versionNo: number; filename: string; size: number; scanStatus: string; stageLabel: string | null; createdAt: string; comment: string | null; ocrApplied: boolean }[];
}

/** Documents of an owner: upload (with stage), versions, download via short-lived link, check-out, compare. */
export function DocumentsPanel({ ownerType, ownerId, canWrite = true, docTypes, stages, title }: { ownerType: string; ownerId: string; canWrite?: boolean; docTypes?: { value: string; label: string }[]; stages?: string[]; title?: string }) {
  const { data, reload, error } = useApi<DocRow[]>(`/documents?ownerType=${ownerType}&ownerId=${encodeURIComponent(ownerId)}`);
  const { me } = useAuth();
  const [open, setOpen] = useState<{ documentId?: string } | null>(null);
  const [compare, setCompare] = useState<{ id: string; parts: { type: string; text: string }[] } | null>(null);
  const act = useAction();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ title: '', docTypeCode: '', stageLabel: '', comment: '', sharedToPortal: false });

  const upload = () => act.run(async () => {
    const f = fileRef.current?.files?.[0];
    if (!f) throw new Error(t('Choose a file'));
    const fd = new FormData();
    fd.set('ownerType', ownerType);
    if (ownerType !== 'library') fd.set('ownerId', ownerId);
    else if (ownerId) fd.set('libraryKind', ownerId);
    if (open?.documentId) fd.set('documentId', open.documentId);
    if (form.title) fd.set('title', form.title);
    if (form.docTypeCode) fd.set('docTypeCode', form.docTypeCode);
    if (form.stageLabel) fd.set('stageLabel', form.stageLabel);
    if (form.comment) fd.set('comment', form.comment);
    if (form.sharedToPortal) fd.set('sharedToPortal', 'true');
    fd.set('file', f);
    await api.form('/documents', fd);
    setOpen(null);
    setForm({ title: '', docTypeCode: '', stageLabel: '', comment: '', sharedToPortal: false });
    await reload();
  });

  const doCompare = (d: DocRow) => act.run(async () => {
    const [b, a] = d.versions;
    const r = await api.get<{ parts: { type: string; text: string }[] }>(`/documents/${d.id}/compare?a=${a!.versionNo}&b=${b!.versionNo}`);
    setCompare({ id: d.id, parts: r.parts });
  });

  return (
    <Card title={title ?? t('Documents')} actions={canWrite ? <Button size="sm" onClick={() => setOpen({})}>{t('Upload')}</Button> : null}>
      {act.error ? <Alert>{act.error}</Alert> : null}
      {error ? <Alert>{error.message}</Alert> : null}
      {!data?.length ? <Empty>{t('No documents yet')}</Empty> : (
        <ul className="divide-y divide-slate-100">
          {data.map((d) => {
            const v = d.versions[0];
            return (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{d.title}</div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    {v ? <>v{v.versionNo}{v.stageLabel ? ` · ${label(v.stageLabel)}` : ''} · {v.filename} · {Math.ceil(v.size / 1024)} KB · {fmtDateTime(v.createdAt)}</> : null}
                    {v && v.scanStatus !== 'CLEAN' ? <StatusBadge value={v.scanStatus} /> : null}
                    {d.legalHold ? <Badge tone="purple">{t('Legal hold')}</Badge> : null}
                    {d.checkedOutById ? <Badge tone="amber">{d.checkedOutById === me?.id ? t('Checked out by you') : t('Checked out')}</Badge> : null}
                    {d.sharedToPortal ? <Badge tone="blue">{t('Shared with requester')}</Badge> : null}
                    {d.docTypeCode ? <Badge>{label(d.docTypeCode)}</Badge> : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {v?.scanStatus === 'CLEAN' ? <Button size="sm" variant="secondary" onClick={() => act.run(() => downloadVersion(v.id))}>{t('Download')}</Button> : null}
                  {canWrite ? <Button size="sm" variant="ghost" onClick={() => setOpen({ documentId: d.id })}>{t('New version')}</Button> : null}
                  {canWrite ? (d.checkedOutById
                    ? <Button size="sm" variant="ghost" onClick={() => act.run(async () => { await api.post(`/documents/${d.id}/checkin`); await reload(); })}>{t('Check in')}</Button>
                    : <Button size="sm" variant="ghost" onClick={() => act.run(async () => { await api.post(`/documents/${d.id}/checkout`); await reload(); })}>{t('Check out')}</Button>) : null}
                  {d.versions.length > 1 && d.versions[0]!.filename.endsWith('.docx') && d.versions[1]!.filename.endsWith('.docx') ? <Button size="sm" variant="ghost" onClick={() => doCompare(d)}>{t('Compare last two')}</Button> : null}
                  {canWrite && ownerType === 'matter' ? <Button size="sm" variant="ghost" onClick={() => act.run(async () => { await api.post(`/documents/${d.id}/share`, { shared: !d.sharedToPortal }); await reload(); })}>{d.sharedToPortal ? t('Unshare') : t('Share with requester')}</Button> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Modal open={!!open} title={open?.documentId ? t('Upload a new version') : t('Upload a document')} onClose={() => setOpen(null)}
        footer={<><Button variant="secondary" onClick={() => setOpen(null)}>{t('Cancel')}</Button><Button busy={act.busy} onClick={upload}>{t('Upload')}</Button></>}>
        {act.error ? <Alert>{act.error}</Alert> : null}
        <Field label={t('File')} hint={t('PDF, Word, Excel, PowerPoint, Outlook email, images or text. Files are virus-scanned before anyone can open them.')}>{(id) => <input id={id} ref={fileRef} type="file" className="block w-full text-sm" accept={UPLOAD_ACCEPT} />}</Field>
        {!open?.documentId ? <Field label={t('Title')}>{(id) => <Input id={id} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />}</Field> : null}
        {docTypes && !open?.documentId ? <Field label={t('Document type')}>{(id) => <Select id={id} placeholder={t('—')} options={docTypes} value={form.docTypeCode} onChange={(e) => setForm({ ...form, docTypeCode: e.target.value })} />}</Field> : null}
        {stages ? <Field label={t('Stage')}>{(id) => <Select id={id} placeholder={t('—')} options={stages.map((s) => ({ value: s, label: label(s) }))} value={form.stageLabel} onChange={(e) => setForm({ ...form, stageLabel: e.target.value })} />}</Field> : null}
        <Field label={t('Comment')}>{(id) => <Input id={id} value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} />}</Field>
        {ownerType === 'matter' && !open?.documentId ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.sharedToPortal} onChange={(e) => setForm({ ...form, sharedToPortal: e.target.checked })} />{t('Share with the requester (portal)')}</label> : null}
      </Modal>
      <Modal open={!!compare} wide title={t('Changes between the last two versions')} onClose={() => setCompare(null)}>
        <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded border bg-white p-3 text-sm leading-relaxed">
          {compare?.parts.map((p, i) => <span key={i} className={p.type === 'added' ? 'diff-added' : p.type === 'removed' ? 'diff-removed' : ''}>{p.text}</span>)}
        </div>
      </Modal>
    </Card>
  );
}

export function Comments({ matterId, comments, onPosted, portal }: { matterId: string; comments: { id: string; body: string | null; authorName: string; createdAt: string; internal: boolean }[]; onPosted: () => void; portal?: boolean }) {
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(!portal);
  const act = useAction();
  return (
    <Card title={t('Comments and notes')}>
      <ul className="space-y-3">
        {comments.map((c) => (
          <li key={c.id} className={`rounded-md border p-3 text-sm ${c.internal ? 'border-amber-200 bg-amber-50' : 'border-slate-200'}`}>
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500"><span className="font-medium text-slate-700">{c.authorName}</span>{fmtDateTime(c.createdAt)}{c.internal ? <Badge tone="amber">{t('Internal')}</Badge> : null}</div>
            <p className="whitespace-pre-wrap">{c.body}</p>
          </li>
        ))}
        {!comments.length ? <Empty>{t('No comments yet')}</Empty> : null}
      </ul>
      <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); void act.run(async () => { await api.post(`/matters/${matterId}/comments`, { body, internal }); setBody(''); onPosted(); }); }}>
        {act.error ? <Alert>{act.error}</Alert> : null}
        <Field label={t('Add a comment')} hint={portal ? undefined : t('Use @username to mention a colleague.')}>{(id) => <Textarea id={id} value={body} onChange={(e) => setBody(e.target.value)} required />}</Field>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {!portal ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />{t('Internal note (hidden from requester)')}</label> : <span />}
          <Button type="submit" busy={act.busy}>{t('Post')}</Button>
        </div>
      </form>
    </Card>
  );
}

export interface DirUser { id: string; displayName: string; username: string; roles: { role: string; unit: string | null }[] }

export function useDirectory(unit?: string) {
  return useApi<DirUser[]>(`/users/directory${unit ? `?unit=${unit}` : ''}`);
}

export function UserSelect({ unit, value, onChange, labelText, exclude, id: forcedId, allowEmpty = true }: { unit?: string; value: string; onChange: (v: string) => void; labelText: string; exclude?: string[]; id?: string; allowEmpty?: boolean }) {
  const { data } = useDirectory(unit);
  return (
    <Field label={labelText} id={forcedId}>
      {(id) => <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={allowEmpty ? t('— Select —') : undefined}
        options={(data ?? []).filter((u) => !exclude?.includes(u.id)).map((u) => ({ value: u.id, label: u.displayName }))} />}
    </Field>
  );
}

export function Timeline({ items }: { items: { id: string; at: string; fromStatus: string | null; toStatus: string; actorName: string; comment: string | null; action: string }[] }) {
  return (
    <Card title={t('History')}>
      <ol className="relative space-y-3 border-l border-slate-200 pl-4">
        {items.map((s) => (
          <li key={s.id} className="text-sm">
            <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-brand-500" aria-hidden />
            <div className="text-xs text-slate-500">{fmtDateTime(s.at)} · {s.actorName}</div>
            <div>{s.fromStatus ? <><StatusBadge value={s.fromStatus} /> → </> : null}<StatusBadge value={s.toStatus} /> <span className="text-xs text-slate-500">({label(s.action)})</span></div>
            {s.comment ? <p className="mt-0.5 whitespace-pre-wrap text-slate-700">{s.comment}</p> : null}
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function SlaPanel({ sla }: { sla: { id: string; step: string; policy: string; dueAt: string; state: string; percent: number; stoppedAt: string | null }[] }) {
  if (!sla.length) return null;
  return (
    <Card title={t('Service levels')}>
      <ul className="space-y-2">
        {sla.map((c) => (
          <li key={c.id} className="text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2"><span>{c.policy}</span><StatusBadge value={c.stoppedAt ? 'DONE' : c.state} /></div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-slate-100" role="progressbar" aria-valuenow={Math.min(100, c.percent)} aria-valuemin={0} aria-valuemax={100} aria-label={c.policy}>
              <div className={`h-full ${c.percent >= 100 ? 'bg-red-500' : c.percent >= 75 ? 'bg-amber-500' : 'bg-green-500'} ${['w-0', 'w-1/12', 'w-2/12', 'w-3/12', 'w-4/12', 'w-5/12', 'w-6/12', 'w-7/12', 'w-8/12', 'w-9/12', 'w-10/12', 'w-11/12', 'w-full'][Math.min(12, Math.round(c.percent / 100 * 12))]}`} />
            </div>
            <div className="text-xs text-slate-500">{t('Due')} {fmtDateTime(c.dueAt)}</div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Untrusted email HTML (already sanitised server-side) shown in a fully sandboxed frame. */
export function EmailFrame({ html }: { html: string }) {
  return <iframe title={t('Original email')} sandbox="" referrerPolicy="no-referrer" srcDoc={`<!doctype html><meta charset="utf-8"><body>${html}</body>`} className="h-80 w-full rounded border border-slate-200 bg-white" />;
}
