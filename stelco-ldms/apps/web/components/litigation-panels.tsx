'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useAction } from '@/lib/hooks';
import { fmtDate, fmtDateTime, fmtMoney, fromLocalInput, label } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { Alert, Badge, Button, Card, DL, Empty, Field, Input, Modal, Select, Spinner, StatusBadge, Textarea } from './ui';
import { UserSelect } from './parts';
import type { MatterDetail } from './matter-view';

interface Hearing { id: string; startsAt: string; judge: string | null; purpose: string | null; status: string; outcome: string | null; summaryEnteredAt: string | null; summary: { whatHappened: string; ordersMade: string; nextSteps: string; companyActions: string } | null; court: { name: string } | null }
interface CaseDetail {
  matterId: string; courtCaseNo: string | null; caseType: string; ourRole: string; subject: string | null; claimAmount: string | null; currency: string; filingDate: string | null;
  risk: string | null; exposure: string | null; remarks: string | null; jurisdiction: string | null; lastUpdateAt: string;
  court: { name: string } | null; externalFirm: { id: string; name: string } | null; externalLawyer: { name: string } | null; responsibleOfficer: { id: string; displayName: string } | null;
  parties: { id: string; name: string; side: string; counsel: string | null }[];
  hearings: Hearing[];
  deadlines: { id: string; type: string; title: string; dueAt: string; status: string }[];
  engagements: { id: string; firm: { name: string }; feeArrangement: string | null; budget: string | null; currency: string; actual: number; budgetUsedPct: number | null; invoices: { id: string; invoiceNo: string; amount: string; currency: string; receivedOn: string; status: string }[] }[];
  updates: { id: string; receivedAt: string; channel: string; summary: string }[];
  evaluation: { quality: number; responsiveness: number; cost: number; outcome: number; comments: string | null } | null;
  outcomes: { id: string; kind: string; decidedOn: string; amount: string | null; currency: string; direction: string; paymentStatus: string; terms: string | null; enforcement: { id: string; on: string; action: string; status: string }[] }[];
  allowedStatuses: Record<string, string[]>;
}

const NEXT_INVOICE: Record<string, string> = { RECEIVED: 'VERIFIED', VERIFIED: 'SENT_FOR_PAYMENT', SENT_FOR_PAYMENT: 'PAID' };

export function LitigationPanels({ m, reloadMatter }: { m: MatterDetail; reloadMatter: () => Promise<void> }) {
  const { data: c, reload, error } = useApi<CaseDetail>(`/litigation/cases/${m.id}`);
  const { can } = useAuth();
  const write = can('lit:write', 'LIT');
  const firms = useApi<{ id: string; name: string }[]>('/config/law-firms');
  const [dlg, setDlg] = useState<string | null>(null);
  const [sel, setSel] = useState<string>('');
  const [form, setForm] = useState<Record<string, string>>({});
  const act = useAction();
  const set = (k: string) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const done = async () => { setDlg(null); setForm({}); await reload(); await reloadMatter(); };
  if (error) return <Alert>{error.message}</Alert>;
  if (!c) return <Spinner />;
  const next = c.allowedStatuses[m.status] ?? [];

  return (
    <>
      {act.error ? <Alert>{act.error}</Alert> : null}
      <Card title={t('Case')} actions={write ? <>
        {next.length ? <Button size="sm" onClick={() => { setForm({ status: next[0]! }); setDlg('status'); }}>{t('Move to…')}</Button> : null}
        <Button size="sm" variant="secondary" onClick={() => { setForm({ risk: c.risk ?? '', exposure: c.exposure ?? '', claimAmount: c.claimAmount ?? '', courtCaseNo: c.courtCaseNo ?? '', remarks: c.remarks ?? '' }); setDlg('edit'); }}>{t('Edit case')}</Button>
      </> : null}>
        <DL items={[
          [t('Court case no.'), c.courtCaseNo ?? '—'], [t('Court / forum'), c.court?.name ?? '—'], [t('Case type'), label(c.caseType)], [t('Our role'), label(c.ourRole)],
          [t('External firm'), c.externalFirm?.name ?? '—'], [t('External lawyer'), c.externalLawyer?.name ?? '—'], [t('Responsible officer'), c.responsibleOfficer?.displayName ?? '—'],
          [t('Filing date'), fmtDate(c.filingDate)], [t('Claim'), fmtMoney(c.claimAmount, c.currency)],
          [t('Risk'), c.risk ? <StatusBadge key="r" value={c.risk} /> : t('Not assessed')], [t('Estimated exposure'), fmtMoney(c.exposure, c.currency)],
          [t('Last update'), fmtDateTime(c.lastUpdateAt)],
          [t('Parties'), c.parties.map((p) => `${p.name} (${label(p.side)})`).join('; ') || '—'], [t('Remarks'), c.remarks ?? '—'],
        ]} />
      </Card>

      <Card title={t('Hearings')} actions={write ? <Button size="sm" onClick={() => setDlg('hearing')}>{t('Add hearing')}</Button> : null}>
        {!c.hearings.length ? <Empty>{t('No hearings recorded')}</Empty> : (
          <ul className="space-y-3">
            {c.hearings.map((h) => {
              const past = new Date(h.startsAt) < new Date();
              return (
                <li key={h.id} className="rounded-md border border-slate-200 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">{fmtDateTime(h.startsAt)} {h.court ? `· ${h.court.name}` : ''} {h.judge ? `· ${h.judge}` : ''}</div>
                    <div className="flex flex-wrap items-center gap-1">
                      <StatusBadge value={h.status} />
                      {past && !h.summaryEnteredAt && h.status !== 'CANCELLED' ? <Badge tone="red">{t('Summary missing')}</Badge> : null}
                      {write && !h.summaryEnteredAt && h.status !== 'CANCELLED' ? <Button size="sm" onClick={() => { setSel(h.id); setForm({}); setDlg('summary'); }}>{t('Enter summary')}</Button> : null}
                      {write && h.status === 'SCHEDULED' ? <Button size="sm" variant="ghost" onClick={() => act.run(async () => { await api.post(`/litigation/hearings/${h.id}/status`, { status: 'ADJOURNED' }); await reload(); })}>{t('Adjourned')}</Button> : null}
                    </div>
                  </div>
                  {h.summary ? (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div><div className="text-xs font-semibold text-slate-500">{t('What happened')}</div><p className="whitespace-pre-wrap">{h.summary.whatHappened}</p></div>
                      <div><div className="text-xs font-semibold text-slate-500">{t('Orders made')}</div><p className="whitespace-pre-wrap">{h.summary.ordersMade || '—'}</p></div>
                      <div><div className="text-xs font-semibold text-slate-500">{t('Next steps')}</div><p className="whitespace-pre-wrap">{h.summary.nextSteps || '—'}</p></div>
                      <div><div className="text-xs font-semibold text-slate-500">{t('Actions for the company')}</div><p className="whitespace-pre-wrap">{h.summary.companyActions || '—'}</p></div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title={t('Deadlines and limitation dates')} actions={write ? <Button size="sm" onClick={() => setDlg('deadline')}>{t('Add deadline')}</Button> : null}>
        {!c.deadlines.length ? <Empty>{t('No deadlines')}</Empty> : (
          <ul className="divide-y text-sm">{c.deadlines.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div><Badge tone={d.type === 'LIMITATION' ? 'red' : 'blue'}>{label(d.type)}</Badge> {d.title}</div>
              <div className="flex items-center gap-2"><span className={d.status === 'OPEN' && new Date(d.dueAt) < new Date() ? 'font-semibold text-red-700' : ''}>{fmtDate(d.dueAt)}</span><StatusBadge value={d.status} />
                {write && d.status === 'OPEN' ? <Button size="sm" variant="ghost" onClick={() => act.run(async () => { await api.post(`/litigation/deadlines/${d.id}/status`, { status: 'DONE' }); await reload(); })}>{t('Done')}</Button> : null}</div>
            </li>
          ))}</ul>
        )}
      </Card>

      <Card title={t('External counsel')} actions={write ? <Button size="sm" onClick={() => setDlg('engagement')}>{t('Add engagement')}</Button> : null}>
        {!c.engagements.length ? <Empty>{t('No engagement recorded')}</Empty> : c.engagements.map((e) => (
          <div key={e.id} className="mb-3 rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium">{e.firm.name}</div>
              <div>{t('Budget')} {fmtMoney(e.budget, e.currency)} · {t('Actual')} {fmtMoney(e.actual, e.currency)} {e.budgetUsedPct !== null ? <Badge tone={e.budgetUsedPct > 100 ? 'red' : e.budgetUsedPct > 80 ? 'amber' : 'green'}>{e.budgetUsedPct}%</Badge> : null}</div>
            </div>
            {e.feeArrangement ? <p className="mt-1 text-slate-600">{e.feeArrangement}</p> : null}
            <ul className="mt-2 divide-y">{e.invoices.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span>{i.invoiceNo} · {fmtDate(i.receivedOn)} · {fmtMoney(i.amount, i.currency)}</span>
                <span className="flex items-center gap-1"><StatusBadge value={i.status} />
                  {write && NEXT_INVOICE[i.status] ? <Button size="sm" variant="ghost" onClick={() => act.run(async () => { await api.post(`/litigation/invoices/${i.id}/status`, { status: NEXT_INVOICE[i.status] }); await reload(); })}>{t('Mark {s}', { s: label(NEXT_INVOICE[i.status]).toLowerCase() })}</Button> : null}
                  {write && i.status !== 'PAID' && i.status !== 'DISPUTED' ? <Button size="sm" variant="ghost" onClick={() => act.run(async () => { await api.post(`/litigation/invoices/${i.id}/status`, { status: 'DISPUTED' }); await reload(); })}>{t('Dispute')}</Button> : null}
                </span>
              </li>
            ))}</ul>
            {write ? <Button size="sm" variant="secondary" className="mt-2" onClick={() => { setSel(e.id); setForm({}); setDlg('invoice'); }}>{t('Record invoice')}</Button> : null}
          </div>
        ))}
      </Card>

      <Card title={t('Updates from counsel')} actions={write ? <Button size="sm" onClick={() => setDlg('update')}>{t('Log update')}</Button> : null}>
        {!c.updates.length ? <Empty>{t('No updates logged')}</Empty> : <ul className="space-y-2 text-sm">{c.updates.map((u) => <li key={u.id}><div className="text-xs text-slate-500">{fmtDateTime(u.receivedAt)} · {label(u.channel)}</div><p className="whitespace-pre-wrap">{u.summary}</p></li>)}</ul>}
      </Card>

      <Card title={t('Settlements and judgments')} actions={write ? <Button size="sm" onClick={() => setDlg('outcome')}>{t('Record outcome')}</Button> : null}>
        {!c.outcomes.length ? <Empty>{t('None yet')}</Empty> : <ul className="space-y-2 text-sm">{c.outcomes.map((o) => (
          <li key={o.id} className="rounded border p-2">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{label(o.kind)} · {fmtDate(o.decidedOn)} · {fmtMoney(o.amount, o.currency)} ({label(o.direction)})</span><StatusBadge value={o.paymentStatus} /></div>
            {o.terms ? <p className="text-slate-600">{o.terms}</p> : null}
            {o.enforcement.map((x) => <div key={x.id} className="text-xs">↳ {fmtDate(x.on)} {x.action} ({label(x.status)})</div>)}
            {write && o.paymentStatus !== 'PAID' ? <Button size="sm" variant="ghost" onClick={() => act.run(async () => { await api.patch(`/litigation/outcomes/${o.id}`, { paymentStatus: 'PAID' }); await reload(); })}>{t('Mark paid')}</Button> : null}
          </li>
        ))}</ul>}
      </Card>

      {c.externalFirm ? (
        <Card title={t('Law firm performance evaluation')} actions={write ? <Button size="sm" variant="secondary" onClick={() => { setForm({ quality: String(c.evaluation?.quality ?? 3), responsiveness: String(c.evaluation?.responsiveness ?? 3), cost: String(c.evaluation?.cost ?? 3), outcome: String(c.evaluation?.outcome ?? 3), comments: c.evaluation?.comments ?? '' }); setDlg('evaluation'); }}>{c.evaluation ? t('Edit') : t('Evaluate')}</Button> : null}>
          {c.evaluation ? <DL items={[[t('Quality'), `${c.evaluation.quality}/5`], [t('Responsiveness'), `${c.evaluation.responsiveness}/5`], [t('Cost'), `${c.evaluation.cost}/5`], [t('Outcome'), `${c.evaluation.outcome}/5`], [t('Comments'), c.evaluation.comments ?? '—']]} /> : <p className="text-sm text-slate-600">{t('Required before the case can be closed.')}</p>}
        </Card>
      ) : null}

      <Modal open={dlg === 'status'} title={t('Change case status')} onClose={() => setDlg(null)} footer={<Button busy={act.busy} onClick={() => act.run(async () => { await api.post(`/litigation/cases/${m.id}/status`, { status: form.status, comment: form.comment }); await done(); })}>{t('Save')}</Button>}>
        <Field label={t('New status')}>{(id) => <Select id={id} value={form.status ?? ''} onChange={set('status')} options={next.map((s) => ({ value: s, label: label(s) }))} />}</Field>
        <Field label={t('Comment')}>{(id) => <Textarea id={id} value={form.comment ?? ''} onChange={set('comment')} />}</Field>
      </Modal>
      <Modal open={dlg === 'edit'} title={t('Edit case')} onClose={() => setDlg(null)} footer={<Button busy={act.busy} onClick={() => act.run(async () => { await api.patch(`/litigation/cases/${m.id}`, { courtCaseNo: form.courtCaseNo || null, risk: form.risk || null, exposure: form.exposure || null, claimAmount: form.claimAmount || null, remarks: form.remarks || null }); await done(); })}>{t('Save')}</Button>}>
        <Field label={t('Court case no.')}>{(id) => <Input id={id} value={form.courtCaseNo ?? ''} onChange={set('courtCaseNo')} />}</Field>
        <Field label={t('Risk assessment')}>{(id) => <Select id={id} placeholder={t('Not assessed')} value={form.risk ?? ''} onChange={set('risk')} options={['PROBABLE', 'POSSIBLE', 'REMOTE'].map((x) => ({ value: x, label: label(x) }))} />}</Field>
        <Field label={t('Estimated exposure')}>{(id) => <Input id={id} inputMode="decimal" value={form.exposure ?? ''} onChange={set('exposure')} />}</Field>
        <Field label={t('Claim amount')}>{(id) => <Input id={id} inputMode="decimal" value={form.claimAmount ?? ''} onChange={set('claimAmount')} />}</Field>
        <Field label={t('Remarks')}>{(id) => <Textarea id={id} value={form.remarks ?? ''} onChange={set('remarks')} />}</Field>
      </Modal>
      <Modal open={dlg === 'hearing'} title={t('Add hearing')} onClose={() => setDlg(null)} footer={<Button busy={act.busy} onClick={() => act.run(async () => { await api.post(`/litigation/cases/${m.id}/hearings`, { startsAt: fromLocalInput(form.startsAt ?? ''), judge: form.judge || null, purpose: form.purpose || null }); await done(); })}>{t('Save')}</Button>}>
        <Field label={t('Date and time')} required>{(id) => <Input id={id} type="datetime-local" value={form.startsAt ?? ''} onChange={set('startsAt')} />}</Field>
        <Field label={t('Judge')}>{(id) => <Input id={id} value={form.judge ?? ''} onChange={set('judge')} />}</Field>
        <Field label={t('Purpose')}>{(id) => <Input id={id} value={form.purpose ?? ''} onChange={set('purpose')} />}</Field>
      </Modal>
      <Modal open={dlg === 'summary'} wide title={t('Hearing summary')} onClose={() => setDlg(null)} footer={<Button busy={act.busy} onClick={() => act.run(async () => {
        await api.post(`/litigation/hearings/${sel}/summary`, { whatHappened: form.whatHappened ?? '', ordersMade: form.ordersMade, nextSteps: form.nextSteps, companyActions: form.companyActions, outcome: form.outcome || null, nextHearingAt: form.nextHearingAt ? fromLocalInput(form.nextHearingAt) : null, attendees: { internal: (form.internal ?? '').split(',').map((s) => s.trim()).filter(Boolean), external: (form.external ?? '').split(',').map((s) => s.trim()).filter(Boolean) } });
        await done();
      })}>{t('Save summary')}</Button>}>
        <Field label={t('What happened')} required>{(id) => <Textarea id={id} value={form.whatHappened ?? ''} onChange={set('whatHappened')} />}</Field>
        <Field label={t('Orders made')}>{(id) => <Textarea id={id} value={form.ordersMade ?? ''} onChange={set('ordersMade')} />}</Field>
        <Field label={t('Next steps')}>{(id) => <Textarea id={id} value={form.nextSteps ?? ''} onChange={set('nextSteps')} />}</Field>
        <Field label={t('Actions for the company')}>{(id) => <Textarea id={id} value={form.companyActions ?? ''} onChange={set('companyActions')} />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Attended (internal, comma-separated)')}>{(id) => <Input id={id} value={form.internal ?? ''} onChange={set('internal')} />}</Field>
          <Field label={t('Attended (external counsel)')}>{(id) => <Input id={id} value={form.external ?? ''} onChange={set('external')} />}</Field>
          <Field label={t('Outcome')}>{(id) => <Input id={id} value={form.outcome ?? ''} onChange={set('outcome')} />}</Field>
          <Field label={t('Next hearing date')} hint={t('Creates the next hearing and calendar entry.')}>{(id) => <Input id={id} type="datetime-local" value={form.nextHearingAt ?? ''} onChange={set('nextHearingAt')} />}</Field>
        </div>
      </Modal>
      <Modal open={dlg === 'deadline'} title={t('Add deadline')} onClose={() => setDlg(null)} footer={<Button busy={act.busy} onClick={() => act.run(async () => { await api.post(`/litigation/cases/${m.id}/deadlines`, { type: form.type ?? 'FILING', title: form.title ?? '', dueAt: new Date(`${form.dueAt}T16:00:00+05:00`).toISOString(), ownerId: form.ownerId || null }); await done(); })}>{t('Save')}</Button>}>
        <Field label={t('Type')}>{(id) => <Select id={id} value={form.type ?? 'FILING'} onChange={set('type')} options={['FILING', 'SUBMISSION', 'APPEAL', 'LIMITATION', 'OTHER'].map((x) => ({ value: x, label: label(x) }))} />}</Field>
        <Field label={t('Title')}>{(id) => <Input id={id} value={form.title ?? ''} onChange={set('title')} />}</Field>
        <Field label={t('Due date')}>{(id) => <Input id={id} type="date" value={form.dueAt ?? ''} onChange={set('dueAt')} />}</Field>
        <UserSelect unit="LIT" labelText={t('Owner')} value={form.ownerId ?? ''} onChange={(v) => setForm({ ...form, ownerId: v })} />
      </Modal>
      <Modal open={dlg === 'engagement'} title={t('Engage external counsel')} onClose={() => setDlg(null)} footer={<Button busy={act.busy} onClick={() => act.run(async () => { await api.post(`/litigation/cases/${m.id}/engagements`, { firmId: form.firmId, feeArrangement: form.fee || null, budget: form.budget || null }); await done(); })}>{t('Save')}</Button>}>
        <Field label={t('Law firm')}>{(id) => <Select id={id} placeholder={t('— Select —')} value={form.firmId ?? ''} onChange={set('firmId')} options={(firms.data ?? []).map((f) => ({ value: f.id, label: f.name }))} />}</Field>
        <Field label={t('Fee arrangement')}>{(id) => <Textarea id={id} value={form.fee ?? ''} onChange={set('fee')} />}</Field>
        <Field label={t('Budget')}>{(id) => <Input id={id} inputMode="decimal" value={form.budget ?? ''} onChange={set('budget')} />}</Field>
        <p className="text-xs text-slate-500">{t('Upload the engagement letter in Documents with type "Engagement letter".')}</p>
      </Modal>
      <Modal open={dlg === 'invoice'} title={t('Record invoice')} onClose={() => setDlg(null)} footer={<Button busy={act.busy} onClick={() => act.run(async () => { await api.post(`/litigation/engagements/${sel}/invoices`, { invoiceNo: form.invoiceNo ?? '', amount: form.amount ?? '', receivedOn: new Date(`${form.receivedOn}T09:00:00+05:00`).toISOString() }); await done(); })}>{t('Save')}</Button>}>
        <Field label={t('Invoice no.')}>{(id) => <Input id={id} value={form.invoiceNo ?? ''} onChange={set('invoiceNo')} />}</Field>
        <Field label={t('Amount')}>{(id) => <Input id={id} inputMode="decimal" value={form.amount ?? ''} onChange={set('amount')} />}</Field>
        <Field label={t('Received on')}>{(id) => <Input id={id} type="date" value={form.receivedOn ?? ''} onChange={set('receivedOn')} />}</Field>
      </Modal>
      <Modal open={dlg === 'update'} title={t('Log an update from counsel')} onClose={() => setDlg(null)} footer={<Button busy={act.busy} onClick={() => act.run(async () => { await api.post(`/litigation/cases/${m.id}/updates`, { receivedAt: fromLocalInput(form.receivedAt ?? ''), channel: form.channel ?? 'EMAIL', summary: form.summary ?? '' }); await done(); })}>{t('Save')}</Button>}>
        <Field label={t('Received')}>{(id) => <Input id={id} type="datetime-local" value={form.receivedAt ?? ''} onChange={set('receivedAt')} />}</Field>
        <Field label={t('Channel')}>{(id) => <Select id={id} value={form.channel ?? 'EMAIL'} onChange={set('channel')} options={['EMAIL', 'PHONE', 'MEETING', 'LETTER'].map((x) => ({ value: x, label: label(x) }))} />}</Field>
        <Field label={t('Summary')}>{(id) => <Textarea id={id} value={form.summary ?? ''} onChange={set('summary')} />}</Field>
      </Modal>
      <Modal open={dlg === 'outcome'} title={t('Record settlement or judgment')} onClose={() => setDlg(null)} footer={<Button busy={act.busy} onClick={() => act.run(async () => { await api.post(`/litigation/cases/${m.id}/outcomes`, { kind: form.kind ?? 'JUDGMENT', decidedOn: new Date(`${form.decidedOn}T09:00:00+05:00`).toISOString(), amount: form.amount || null, direction: form.direction ?? 'PAYABLE', terms: form.terms || null }); await done(); })}>{t('Save')}</Button>}>
        <Field label={t('Kind')}>{(id) => <Select id={id} value={form.kind ?? 'JUDGMENT'} onChange={set('kind')} options={['JUDGMENT', 'SETTLEMENT'].map((x) => ({ value: x, label: label(x) }))} />}</Field>
        <Field label={t('Date')}>{(id) => <Input id={id} type="date" value={form.decidedOn ?? ''} onChange={set('decidedOn')} />}</Field>
        <Field label={t('Amount')} hint={t('Stored encrypted.')}>{(id) => <Input id={id} inputMode="decimal" value={form.amount ?? ''} onChange={set('amount')} />}</Field>
        <Field label={t('Direction')}>{(id) => <Select id={id} value={form.direction ?? 'PAYABLE'} onChange={set('direction')} options={['PAYABLE', 'RECEIVABLE', 'NONE'].map((x) => ({ value: x, label: label(x) }))} />}</Field>
        <Field label={t('Terms')}>{(id) => <Textarea id={id} value={form.terms ?? ''} onChange={set('terms')} />}</Field>
      </Modal>
      <Modal open={dlg === 'evaluation'} title={t('Law firm performance evaluation')} onClose={() => setDlg(null)} footer={<Button busy={act.busy} onClick={() => act.run(async () => { await api.post(`/litigation/cases/${m.id}/evaluation`, { quality: +form.quality!, responsiveness: +form.responsiveness!, cost: +form.cost!, outcome: +form.outcome!, comments: form.comments || null }); await done(); })}>{t('Save')}</Button>}>
        {(['quality', 'responsiveness', 'cost', 'outcome'] as const).map((k) => <Field key={k} label={t(label(k))}>{(id) => <Select id={id} value={form[k] ?? '3'} onChange={set(k)} options={['1', '2', '3', '4', '5'].map((x) => ({ value: x, label: `${x} / 5` }))} />}</Field>)}
        <Field label={t('Comments')}>{(id) => <Textarea id={id} value={form.comments ?? ''} onChange={set('comments')} />}</Field>
      </Modal>
    </>
  );
}
