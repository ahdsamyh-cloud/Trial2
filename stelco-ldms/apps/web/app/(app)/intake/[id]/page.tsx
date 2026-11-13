'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useApi, useAction } from '@/lib/hooks';
import { fmtDateTime, label } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { UNITS, UNIT_NAMES } from '@ldms/shared';
import { Alert, Button, Card, DL, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge, Textarea } from '@/components/ui';
import { DocumentsPanel, EmailFrame, UserSelect } from '@/components/parts';

interface IntakeDetail {
  id: string; intakeNo: string; source: string; adapter: string; receivedAt: string; senderName: string; senderEmail: string | null; subject: string; summary: string | null;
  emailRef: string | null; priority: string; dueDate: string | null; status: string; suggestedUnit: string | null; matterId: string | null; triageNote: string | null; ackText: string;
  email: { fromAddr: string | null; to: string[]; cc: string[]; sentAt: string | null; bodyHtmlSanitized: string | null; bodyText: string | null; internetMessageId: string | null } | null;
}

export default function IntakeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { can } = useAuth();
  const { data, reload, error } = useApi<IntakeDetail>(`/intake/${id}`);
  const types = useApi<{ id: string; unit: string; name: string; active: boolean }[]>('/config/request-types');
  const [dialog, setDialog] = useState<'convert' | 'link' | 'not_legal' | 'duplicate' | null>(null);
  const [conv, setConv] = useState({ unit: '', requestTypeId: '', title: '', priority: '', dueDate: '', restricted: false, assigneeId: '' });
  const [linkQ, setLinkQ] = useState('');
  const [linkId, setLinkId] = useState('');
  const [reason, setReason] = useState('');
  const [dupId, setDupId] = useState('');
  const [ack, setAck] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const matches = useApi<{ rows: { id: string; reference: string; title: string }[] }>(dialog === 'link' && linkQ.length >= 2 ? `/matters?q=${encodeURIComponent(linkQ)}&pageSize=10` : null, [linkQ, dialog]);
  const dupes = useApi<{ rows: { id: string; intakeNo: string; subject: string }[] }>(dialog === 'duplicate' ? `/intake?q=${encodeURIComponent(data?.subject.slice(0, 30) ?? '')}&pageSize=20` : null, [dialog]);
  const act = useAction();

  if (error) return <Alert>{error.message}</Alert>;
  if (!data) return <Spinner />;
  const open = data.status === 'NEW';
  const unit = conv.unit || data.suggestedUnit || '';

  const doConvert = () => act.run(async () => {
    const r = await api.post<{ matterId: string; reference: string; ackText: string }>(`/intake/${id}/convert`, {
      unit, requestTypeId: conv.requestTypeId || null, title: conv.title || undefined, priority: conv.priority || undefined,
      dueDate: conv.dueDate ? new Date(`${conv.dueDate}T16:00:00+05:00`).toISOString() : null, restricted: conv.restricted,
      assigneeIds: conv.assigneeId ? [conv.assigneeId] : undefined,
    });
    setDialog(null); setAck(r.ackText); await reload();
  });
  const doLink = () => act.run(async () => { const r = await api.post<{ ackText: string }>(`/intake/${id}/link`, { matterId: linkId }); setDialog(null); setAck(r.ackText); await reload(); });
  const doNotLegal = () => act.run(async () => { await api.post(`/intake/${id}/not-legal`, { reason }); setDialog(null); await reload(); });
  const doDup = () => act.run(async () => { await api.post(`/intake/${id}/duplicate`, { duplicateOfId: dupId, reason: reason || 'Duplicate' }); setDialog(null); await reload(); });
  const copy = async (text: string) => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  return (
    <div className="space-y-4">
      <PageHeader title={data.subject} subtitle={<>{data.intakeNo} · {t('received')} {fmtDateTime(data.receivedAt)} · {label(data.source)}</>}
        actions={open && can('intake:triage') ? (
          <>
            <Button onClick={() => { setConv({ ...conv, unit: data.suggestedUnit ?? '' }); setDialog('convert'); }}>{t('Convert to matter')}</Button>
            <Button variant="secondary" onClick={() => setDialog('link')}>{t('Link to existing')}</Button>
            <Button variant="ghost" onClick={() => setDialog('duplicate')}>{t('Duplicate')}</Button>
            <Button variant="ghost" onClick={() => setDialog('not_legal')}>{t('Not a legal matter')}</Button>
          </>
        ) : data.matterId ? <Link href={`/matters/${data.matterId}`}><Button variant="secondary">{t('Open matter')}</Button></Link> : null} />
      {act.error ? <Alert>{act.error}</Alert> : null}
      {ack ? (
        <Card title={t('Acknowledgement')} actions={<Button size="sm" onClick={() => copy(ack)}>{copied ? t('Copied') : t('Copy reply')}</Button>}>
          <p className="mb-2 text-sm text-slate-600">{t('Paste this into your Outlook reply to the sender.')}</p>
          <pre className="whitespace-pre-wrap rounded bg-slate-50 p-3 text-sm">{ack}</pre>
        </Card>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={t('Request')}>
            <DL items={[
              [t('Status'), <StatusBadge key="s" value={data.status} />], [t('Priority'), <StatusBadge key="p" value={data.priority} />],
              [t('From'), `${data.senderName}${data.senderEmail ? ` <${data.senderEmail}>` : ''}`], [t('Likely unit'), data.suggestedUnit ? UNIT_NAMES[data.suggestedUnit as 'LIT'] : '—'],
              [t('Requested due date'), data.dueDate ? fmtDateTime(data.dueDate) : '—'], [t('Email reference'), data.emailRef ?? '—'],
              [t('Recorded via'), label(data.adapter)], [t('Triage note'), data.triageNote ?? '—'],
            ]} />
            {data.summary ? <p className="mt-4 whitespace-pre-wrap text-sm">{data.summary}</p> : null}
          </Card>
          {data.email ? (
            <Card title={t('Original email')}>
              <div className="mb-2 text-xs text-slate-600">{t('To')}: {data.email.to.join(', ')}{data.email.cc.length ? ` · ${t('Cc')}: ${data.email.cc.join(', ')}` : ''} · {fmtDateTime(data.email.sentAt)}</div>
              {data.email.bodyHtmlSanitized ? <EmailFrame html={data.email.bodyHtmlSanitized} /> : <pre className="whitespace-pre-wrap text-sm">{data.email.bodyText}</pre>}
              <p className="mt-2 text-xs text-slate-500">{t('Shown safely: scripts and remote images are blocked.')}</p>
            </Card>
          ) : null}
        </div>
        <div className="space-y-4">
          {!data.matterId ? <DocumentsPanel ownerType="intake" ownerId={id} canWrite={open} /> : <Alert tone="blue">{t('Documents moved to the matter.')}</Alert>}
          {!ack ? (
            <Card title={t('Acknowledgement text')} actions={<Button size="sm" variant="secondary" onClick={() => copy(data.ackText)}>{copied ? t('Copied') : t('Copy reply')}</Button>}>
              <pre className="whitespace-pre-wrap text-xs text-slate-700">{data.ackText}</pre>
            </Card>
          ) : null}
        </div>
      </div>

      <Modal open={dialog === 'convert'} title={t('Convert to matter')} onClose={() => setDialog(null)}
        footer={<><Button variant="secondary" onClick={() => setDialog(null)}>{t('Cancel')}</Button><Button busy={act.busy} disabled={!unit} onClick={doConvert}>{t('Convert')}</Button></>}>
        {act.error ? <Alert>{act.error}</Alert> : null}
        <Field label={t('Unit')} required>{(fid) => <Select id={fid} placeholder={t('— Select —')} value={unit} onChange={(e) => setConv({ ...conv, unit: e.target.value, requestTypeId: '' })} options={UNITS.filter((u) => can('intake:triage', u)).map((u) => ({ value: u, label: UNIT_NAMES[u] }))} />}</Field>
        <Field label={t('Request type')}>{(fid) => <Select id={fid} placeholder={t('— Select —')} value={conv.requestTypeId} onChange={(e) => setConv({ ...conv, requestTypeId: e.target.value })} options={(types.data ?? []).filter((x) => x.unit === unit && x.active).map((x) => ({ value: x.id, label: x.name }))} />}</Field>
        <Field label={t('Title')} hint={t('Leave empty to use the email subject.')}>{(fid) => <Input id={fid} value={conv.title} onChange={(e) => setConv({ ...conv, title: e.target.value })} />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Priority')}>{(fid) => <Select id={fid} placeholder={t('Keep')} value={conv.priority} onChange={(e) => setConv({ ...conv, priority: e.target.value })} options={['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => ({ value: p, label: label(p) }))} />}</Field>
          <Field label={t('Due date')}>{(fid) => <Input id={fid} type="date" value={conv.dueDate} onChange={(e) => setConv({ ...conv, dueDate: e.target.value })} />}</Field>
        </div>
        {unit && can('matter:assign', unit) ? <UserSelect unit={unit} labelText={t('Assign to (optional)')} value={conv.assigneeId} onChange={(v) => setConv({ ...conv, assigneeId: v })} /> : null}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={conv.restricted} onChange={(e) => setConv({ ...conv, restricted: e.target.checked })} />{t('Restricted (confidential) matter')}</label>
      </Modal>
      <Modal open={dialog === 'link'} title={t('Link to an existing matter')} onClose={() => setDialog(null)}
        footer={<><Button variant="secondary" onClick={() => setDialog(null)}>{t('Cancel')}</Button><Button busy={act.busy} disabled={!linkId} onClick={doLink}>{t('Link')}</Button></>}>
        <Field label={t('Find matter by reference or title')}>{(fid) => <Input id={fid} value={linkQ} onChange={(e) => setLinkQ(e.target.value)} />}</Field>
        <ul className="max-h-60 space-y-1 overflow-y-auto">{matches.data?.rows.map((m) => (
          <li key={m.id}><label className="flex items-center gap-2 text-sm"><input type="radio" name="m" checked={linkId === m.id} onChange={() => setLinkId(m.id)} /><span className="font-mono text-xs">{m.reference}</span> {m.title}</label></li>
        ))}</ul>
      </Modal>
      <Modal open={dialog === 'not_legal'} title={t('Not a legal matter')} onClose={() => setDialog(null)}
        footer={<><Button variant="secondary" onClick={() => setDialog(null)}>{t('Cancel')}</Button><Button busy={act.busy} disabled={reason.trim().length < 3} onClick={doNotLegal}>{t('Confirm')}</Button></>}>
        <Field label={t('Reason')} required>{(fid) => <Textarea id={fid} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </Modal>
      <Modal open={dialog === 'duplicate'} title={t('Mark as duplicate')} onClose={() => setDialog(null)}
        footer={<><Button variant="secondary" onClick={() => setDialog(null)}>{t('Cancel')}</Button><Button busy={act.busy} disabled={!dupId} onClick={doDup}>{t('Confirm')}</Button></>}>
        <ul className="max-h-60 space-y-1 overflow-y-auto">{dupes.data?.rows.filter((r) => r.id !== id).map((r) => (
          <li key={r.id}><label className="flex items-center gap-2 text-sm"><input type="radio" name="d" checked={dupId === r.id} onChange={() => setDupId(r.id)} /><span className="font-mono text-xs">{r.intakeNo}</span> {r.subject}</label></li>
        ))}</ul>
      </Modal>
      {data.status !== 'NEW' && !data.matterId ? <Button variant="ghost" onClick={() => router.push('/intake')}>{t('Back to inbox')}</Button> : null}
    </div>
  );
}
