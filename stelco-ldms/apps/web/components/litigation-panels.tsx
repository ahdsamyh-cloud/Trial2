'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useAction } from '@/lib/hooks';
import { fmtDate, fmtDateTime, fmtMoney, fromLocalInput, label, toLocalInput } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { Alert, Badge, Button, Card, DL, Empty, Field, Input, Modal, Select, Spinner, StatusBadge, Textarea } from './ui';
import { DocumentsPanel, UserSelect } from './parts';
import type { MatterDetail } from './matter-view';

interface HearingSummary { whatHappened: string; ordersMade: string; nextSteps: string; companyActions: string }
interface Hearing {
  id: string; startsAt: string; judge: string | null; purpose: string | null; status: string; outcome: string | null; summaryEnteredAt: string | null;
  summary: HearingSummary | null; court: { id: string; name: string } | null; courtId: string | null; chitSummary: string | null; postponeReason: string | null;
  continuanceStatus: string | null; continuanceRequestedAt: string | null; continuanceNote: string | null; nextHearingId: string | null;
}
interface CaseDetail {
  matterId: string; courtCaseNo: string | null; caseType: string; ourRole: string; subject: string | null; claimAmount: string | null; currency: string; filingDate: string | null;
  risk: string | null; exposure: string | null; remarks: string | null; jurisdiction: string | null; lastUpdateAt: string; courtId: string | null; externalFirmId: string | null; externalLawyerId: string | null;
  court: { name: string } | null; externalFirm: { id: string; name: string } | null; externalLawyer: { name: string } | null; responsibleOfficer: { id: string; displayName: string } | null;
  parties: { id: string; name: string; side: string; counsel: string | null }[];
  hearings: Hearing[];
  deadlines: { id: string; type: string; title: string; dueAt: string; status: string; ownerId: string | null }[];
  engagements: { id: string; firm: { name: string }; feeArrangement: string | null; budget: string | null; currency: string; actual: number; budgetUsedPct: number | null; invoices: { id: string; invoiceNo: string; amount: string; currency: string; receivedOn: string; status: string; notes: string | null }[] }[];
  updates: { id: string; receivedAt: string; channel: string; summary: string }[];
  evaluation: { quality: number; responsiveness: number; cost: number; outcome: number; comments: string | null } | null;
  outcomes: { id: string; kind: string; decidedOn: string; amount: string | null; currency: string; direction: string; paymentStatus: string; terms: string | null;
    appealDays: number | null; appealDayKind: string | null; appealFrom: string | null; appealDecision: string | null; appealDeadlineId: string | null; complyBy: string | null; complyDeadlineId: string | null; enforcement: { id: string; on: string; action: string; status: string }[] }[];
  allowedStatuses: Record<string, string[]>;
}

const NEXT_INVOICE: Record<string, string> = { RECEIVED: 'VERIFIED', VERIFIED: 'SENT_FOR_PAYMENT', SENT_FOR_PAYMENT: 'PAID' };
const HEARING_DOC_TYPES = [
  { value: 'HEARING_CHIT', label: 'Hearing chit' }, { value: 'CONTINUANCE_REQUEST', label: 'Request for continuance' },
  { value: 'POSTPONEMENT_NOTICE', label: 'Postponement notice' }, { value: 'COURT_ORDER', label: 'Court order' },
  { value: 'SUBMISSION', label: 'Submission' }, { value: 'CORRESPONDENCE', label: 'Correspondence' },
];
const CASE_TYPES = ['CIVIL', 'LABOUR', 'COMMERCIAL', 'CRIMINAL', 'REGULATORY', 'ARBITRATION', 'OTHER'];
const OUR_ROLES = ['PLAINTIFF', 'DEFENDANT', 'THIRD_PARTY'];
const PARTY_SIDES = ['OURS', 'OPPOSING', 'THIRD_PARTY', 'PLAINTIFF', 'DEFENDANT', 'OTHER'];
const dateOnly = (d?: string | null) => (d ? toLocalInput(d).slice(0, 10) : '');
const fromDate = (s?: string, time = '09:00') => (s ? new Date(`${s}T${time}:00+05:00`).toISOString() : null);

export function LitigationPanels({ m, reloadMatter }: { m: MatterDetail; reloadMatter: () => Promise<void> }) {
  const { data: c, reload, error } = useApi<CaseDetail>(`/litigation/cases/${m.id}`);
  const { can } = useAuth();
  const write = can('lit:write', 'LIT');
  const firms = useApi<{ id: string; name: string }[]>('/config/law-firms');
  const courts = useApi<{ id: string; name: string; appealDays: number | null; appealDayKind: string }[]>('/config/courts');
  const lawyers = useApi<{ id: string; name: string; firmId: string }[]>('/config/external-lawyers');
  const [dlg, setDlg] = useState<string | null>(null);
  const [sel, setSel] = useState<string>('');
  const [form, setForm] = useState<Record<string, string>>({});
  const [parties, setParties] = useState<{ name: string; side: string; counsel: string }[]>([]);
  const [openDocs, setOpenDocs] = useState<Record<string, boolean>>({});
  const act = useAction();
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const open = (name: string, values: Record<string, string> = {}, id = '') => { setSel(id); setForm(values); setDlg(name); };
  const close = () => setDlg(null);
  const done = async () => { setDlg(null); setForm({}); await reload(); await reloadMatter(); };
  if (error) return <Alert>{error.message}</Alert>;
  if (!c) return <Spinner />;
  const next = c.allowedStatuses[m.status] ?? [];
  const opt = (rows?: { id: string; name: string }[]) => (rows ?? []).map((r) => ({ value: r.id, label: r.name }));
  const err = act.error ? <Alert>{act.error}</Alert> : null;
  const save = (fn: () => Promise<unknown>, text = t('Save')) => <Button busy={act.busy} onClick={() => act.run(async () => { await fn(); await done(); })}>{text}</Button>;
  const hearingSel = c.hearings.find((h) => h.id === sel);

  return (
    <>
      {act.error && !dlg ? <Alert>{act.error}</Alert> : null}
      <Card title={t('Case')} actions={write ? <>
        {next.length ? <Button size="sm" onClick={() => open('status', { status: next[0]! })}>{t('Move to…')}</Button> : null}
        <Button size="sm" variant="secondary" onClick={() => {
          setParties(c.parties.map((p) => ({ name: p.name, side: p.side, counsel: p.counsel ?? '' })));
          open('edit', {
            title: m.title, courtCaseNo: c.courtCaseNo ?? '', courtId: c.courtId ?? '', jurisdiction: c.jurisdiction ?? '', caseType: c.caseType, ourRole: c.ourRole,
            subject: c.subject ?? '', externalFirmId: c.externalFirmId ?? '', externalLawyerId: c.externalLawyerId ?? '', responsibleOfficerId: c.responsibleOfficer?.id ?? '',
            claimAmount: c.claimAmount ?? '', currency: c.currency, filingDate: dateOnly(c.filingDate), risk: c.risk ?? '', exposure: c.exposure ?? '', remarks: c.remarks ?? '',
          });
        }}>{t('Edit case')}</Button>
      </> : null}>
        <DL items={[
          [t('Court case no.'), c.courtCaseNo ?? '—'], [t('Court / forum'), c.court?.name ?? '—'], [t('Case type'), label(c.caseType)], [t('Our role'), label(c.ourRole)],
          [t('External firm'), c.externalFirm?.name ?? '—'], [t('External lawyer'), c.externalLawyer?.name ?? '—'], [t('Responsible officer'), c.responsibleOfficer?.displayName ?? '—'],
          [t('Filing date'), fmtDate(c.filingDate)], [t('Claim'), fmtMoney(c.claimAmount, c.currency)], [t('Subject'), c.subject ?? '—'], [t('Jurisdiction'), c.jurisdiction ?? '—'],
          [t('Risk'), c.risk ? <StatusBadge key="r" value={c.risk} /> : t('Not assessed')], [t('Estimated exposure'), fmtMoney(c.exposure, c.currency)],
          [t('Last update'), fmtDateTime(c.lastUpdateAt)],
          [t('Parties'), c.parties.map((p) => `${p.name} (${label(p.side)})`).join('; ') || '—'], [t('Remarks'), c.remarks ?? '—'],
        ]} />
      </Card>

      <Card title={t('Hearings')} actions={write ? <Button size="sm" onClick={() => open('hearing')}>{t('Add hearing')}</Button> : null}>
        {!c.hearings.length ? <Empty>{t('No hearings recorded')}</Empty> : (
          <ul className="space-y-3">
            {c.hearings.map((h) => {
              const past = new Date(h.startsAt) < new Date();
              const live = h.status === 'SCHEDULED' || h.status === 'ADJOURNED';
              const needsSummary = past && !h.summaryEnteredAt && !['CANCELLED', 'POSTPONED'].includes(h.status);
              return (
                <li key={h.id} className="rounded-md border border-slate-200 p-3 text-sm" data-testid="hearing">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">{fmtDateTime(h.startsAt)} {h.court ? `· ${h.court.name}` : ''} {h.judge ? `· ${h.judge}` : ''}{h.purpose ? <span className="font-normal text-slate-600"> · {h.purpose}</span> : null}</div>
                    <div className="flex flex-wrap items-center gap-1">
                      <StatusBadge value={h.status} />
                      {h.continuanceStatus ? <Badge tone={h.continuanceStatus === 'DENIED' ? 'red' : h.continuanceStatus === 'GRANTED' ? 'green' : 'amber'}>{t('Continuance: {s}', { s: label(h.continuanceStatus).toLowerCase() })}</Badge> : null}
                      {needsSummary ? <Badge tone="red">{t('Summary missing')}</Badge> : null}
                    </div>
                  </div>
                  {h.status === 'POSTPONED' ? <p className="mt-1 text-slate-700">{t('Postponed')}{h.postponeReason ? `: ${h.postponeReason}` : ''}{h.nextHearingId ? ` → ${fmtDateTime(c.hearings.find((x) => x.id === h.nextHearingId)?.startsAt)}` : ''}</p> : null}
                  {h.continuanceNote ? <p className="mt-1 text-slate-600">{t('Continuance note')}: {h.continuanceNote}</p> : null}
                  <div className="mt-2">
                    <div className="text-xs font-semibold text-slate-500">{t('Hearing chit summary')}</div>
                    <p className="whitespace-pre-wrap">{h.chitSummary || <span className="text-slate-400">{t('Not entered yet')}</span>}</p>
                  </div>
                  {h.summary ? (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div><div className="text-xs font-semibold text-slate-500">{t('What happened')}</div><p className="whitespace-pre-wrap">{h.summary.whatHappened}</p></div>
                      <div><div className="text-xs font-semibold text-slate-500">{t('Orders made')}</div><p className="whitespace-pre-wrap">{h.summary.ordersMade || '—'}</p></div>
                      <div><div className="text-xs font-semibold text-slate-500">{t('Next steps')}</div><p className="whitespace-pre-wrap">{h.summary.nextSteps || '—'}</p></div>
                      <div><div className="text-xs font-semibold text-slate-500">{t('Actions for the company')}</div><p className="whitespace-pre-wrap">{h.summary.companyActions || '—'}</p></div>
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {write ? <Button size="sm" variant="secondary" onClick={() => open('editHearing', { startsAt: toLocalInput(h.startsAt), courtId: h.courtId ?? '', judge: h.judge ?? '', purpose: h.purpose ?? '', chitSummary: h.chitSummary ?? '', outcome: h.outcome ?? '' }, h.id)}>{t('Edit hearing')}</Button> : null}
                    {write && !h.summaryEnteredAt && !['CANCELLED', 'POSTPONED'].includes(h.status) ? <Button size="sm" onClick={() => open('summary', {}, h.id)}>{t('Enter summary')}</Button> : null}
                    {write && h.summary ? <Button size="sm" variant="secondary" onClick={() => open('editSummary', { ...h.summary }, h.id)}>{t('Edit summary')}</Button> : null}
                    {write && live ? <Button size="sm" variant="secondary" onClick={() => open('postpone', {}, h.id)}>{t('Postpone')}</Button> : null}
                    {write && live && h.continuanceStatus !== 'REQUESTED' ? <Button size="sm" variant="secondary" onClick={() => open('contRequest', {}, h.id)}>{t('Request continuance')}</Button> : null}
                    {write && h.continuanceStatus === 'REQUESTED' && live ? <Button size="sm" variant="secondary" onClick={() => open('contDecision', { decision: 'GRANTED' }, h.id)}>{t('Record continuance decision')}</Button> : null}
                    {write && h.status === 'SCHEDULED' ? <Button size="sm" variant="ghost" onClick={() => act.run(async () => { await api.post(`/litigation/hearings/${h.id}/status`, { status: 'ADJOURNED' }); await reload(); })}>{t('Adjourned')}</Button> : null}
                    <Button size="sm" variant="ghost" aria-expanded={!!openDocs[h.id]} onClick={() => setOpenDocs((o) => ({ ...o, [h.id]: !o[h.id] }))}>{openDocs[h.id] ? t('Hide documents') : t('Documents (chit, continuance…)')}</Button>
                  </div>
                  {openDocs[h.id] ? <div className="mt-2"><DocumentsPanel ownerType="hearing" ownerId={h.id} canWrite={write} docTypes={HEARING_DOC_TYPES.map((d) => ({ ...d, label: t(d.label) }))} title={t('Hearing documents')} /></div> : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title={t('Deadlines and limitation dates')} actions={write ? <Button size="sm" onClick={() => open('deadline', { type: 'FILING' })}>{t('Add deadline')}</Button> : null}>
        {!c.deadlines.length ? <Empty>{t('No deadlines')}</Empty> : (
          <ul className="divide-y text-sm">{c.deadlines.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div><Badge tone={d.type === 'LIMITATION' ? 'red' : 'blue'}>{label(d.type)}</Badge> {d.title}</div>
              <div className="flex items-center gap-2"><span className={d.status === 'OPEN' && new Date(d.dueAt) < new Date() ? 'font-semibold text-red-700' : ''}>{fmtDate(d.dueAt)}</span><StatusBadge value={d.status} />
                {write ? <Button size="sm" variant="ghost" onClick={() => open('editDeadline', { type: d.type, title: d.title, dueAt: dateOnly(d.dueAt), ownerId: d.ownerId ?? '' }, d.id)}>{t('Edit')}</Button> : null}
                {write && d.status === 'OPEN' ? <Button size="sm" variant="ghost" onClick={() => act.run(async () => { await api.post(`/litigation/deadlines/${d.id}/status`, { status: 'DONE' }); await reload(); })}>{t('Done')}</Button> : null}</div>
            </li>
          ))}</ul>
        )}
      </Card>

      <Card title={t('External counsel')} actions={write ? <Button size="sm" onClick={() => open('engagement')}>{t('Add engagement')}</Button> : null}>
        {!c.engagements.length ? <Empty>{t('No engagement recorded')}</Empty> : c.engagements.map((e) => (
          <div key={e.id} className="mb-3 rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium">{e.firm.name}</div>
              <div>{t('Budget')} {fmtMoney(e.budget, e.currency)} · {t('Actual')} {fmtMoney(e.actual, e.currency)} {e.budgetUsedPct !== null ? <Badge tone={e.budgetUsedPct > 100 ? 'red' : e.budgetUsedPct > 80 ? 'amber' : 'green'}>{e.budgetUsedPct}%</Badge> : null}</div>
            </div>
            {e.feeArrangement ? <p className="mt-1 whitespace-pre-wrap text-slate-600">{e.feeArrangement}</p> : null}
            <ul className="mt-2 divide-y">{e.invoices.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span>{i.invoiceNo} · {fmtDate(i.receivedOn)} · {fmtMoney(i.amount, i.currency)}</span>
                <span className="flex items-center gap-1"><StatusBadge value={i.status} />
                  {write ? <Button size="sm" variant="ghost" onClick={() => open('editInvoice', { invoiceNo: i.invoiceNo, amount: i.amount, receivedOn: dateOnly(i.receivedOn), notes: i.notes ?? '' }, i.id)}>{t('Edit')}</Button> : null}
                  {write && NEXT_INVOICE[i.status] ? <Button size="sm" variant="ghost" onClick={() => act.run(async () => { await api.post(`/litigation/invoices/${i.id}/status`, { status: NEXT_INVOICE[i.status] }); await reload(); })}>{t('Mark {s}', { s: label(NEXT_INVOICE[i.status]).toLowerCase() })}</Button> : null}
                  {write && i.status !== 'PAID' && i.status !== 'DISPUTED' ? <Button size="sm" variant="ghost" onClick={() => act.run(async () => { await api.post(`/litigation/invoices/${i.id}/status`, { status: 'DISPUTED' }); await reload(); })}>{t('Dispute')}</Button> : null}
                </span>
              </li>
            ))}</ul>
            {write ? <div className="mt-2 flex flex-wrap gap-1">
              <Button size="sm" variant="secondary" onClick={() => open('invoice', {}, e.id)}>{t('Record invoice')}</Button>
              <Button size="sm" variant="ghost" onClick={() => open('editEngagement', { fee: e.feeArrangement ?? '', budget: e.budget ?? '' }, e.id)}>{t('Edit engagement')}</Button>
            </div> : null}
          </div>
        ))}
      </Card>

      <Card title={t('Updates from counsel')} actions={write ? <Button size="sm" onClick={() => open('update', { channel: 'EMAIL' })}>{t('Log update')}</Button> : null}>
        {!c.updates.length ? <Empty>{t('No updates logged')}</Empty> : <ul className="space-y-2 text-sm">{c.updates.map((u) => (
          <li key={u.id}>
            <div className="flex items-center justify-between gap-2 text-xs text-slate-500"><span>{fmtDateTime(u.receivedAt)} · {label(u.channel)}</span>
              {write ? <Button size="sm" variant="ghost" onClick={() => open('editUpdate', { receivedAt: toLocalInput(u.receivedAt), channel: u.channel, summary: u.summary }, u.id)}>{t('Edit')}</Button> : null}</div>
            <p className="whitespace-pre-wrap">{u.summary}</p>
          </li>
        ))}</ul>}
      </Card>

      <Card title={t('Settlements and judgments')} actions={write ? <Button size="sm" onClick={() => { const ct = courts.data?.find((x) => x.id === c.courtId); open('outcome', { kind: 'JUDGMENT', direction: 'PAYABLE', appealDays: ct?.appealDays ? String(ct.appealDays) : '', appealDayKind: ct?.appealDayKind ?? 'CALENDAR', appealDecision: 'UNDECIDED' }); }}>{t('Record outcome')}</Button> : null}>
        {!c.outcomes.length ? <Empty>{t('None yet')}</Empty> : <ul className="space-y-2 text-sm">{c.outcomes.map((o) => (
          <li key={o.id} className="rounded border p-2">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{label(o.kind)} · {fmtDate(o.decidedOn)} · {fmtMoney(o.amount, o.currency)} ({label(o.direction)})</span><StatusBadge value={o.paymentStatus} /></div>
            {o.terms ? <p className="whitespace-pre-wrap text-slate-600">{o.terms}</p> : null}
            <AppealLine o={o} deadlines={c.deadlines} />
            {o.enforcement.map((x) => <div key={x.id} className="text-xs">↳ {fmtDate(x.on)} {x.action} ({label(x.status)})</div>)}
            <div className="flex flex-wrap gap-1">
              {write ? <Button size="sm" variant="ghost" onClick={() => open('editOutcome', { kind: o.kind, decidedOn: dateOnly(o.decidedOn), amount: o.amount ?? '', direction: o.direction, paymentStatus: o.paymentStatus, terms: o.terms ?? '',
                appealDays: o.appealDays ? String(o.appealDays) : '', appealDayKind: o.appealDayKind ?? 'CALENDAR', appealFrom: o.appealFrom ? dateOnly(o.appealFrom) : '', appealDecision: o.appealDecision ?? 'UNDECIDED', complyBy: o.complyBy ? dateOnly(o.complyBy) : '' }, o.id)}>{t('Edit')}</Button> : null}
              {write && o.kind === 'JUDGMENT' && (!o.appealDecision || o.appealDecision === 'UNDECIDED') ? <>
                <Button size="sm" variant="ghost" onClick={() => act.run(async () => { await api.patch(`/litigation/outcomes/${o.id}`, { appealDecision: 'APPEAL' }); await reload(); })}>{t('We will appeal')}</Button>
                <Button size="sm" variant="ghost" onClick={() => act.run(async () => { await api.patch(`/litigation/outcomes/${o.id}`, { appealDecision: 'NO_APPEAL' }); await reload(); })}>{t('No appeal')}</Button>
              </> : null}
              {write && o.paymentStatus !== 'PAID' ? <Button size="sm" variant="ghost" onClick={() => act.run(async () => { await api.patch(`/litigation/outcomes/${o.id}`, { paymentStatus: 'PAID' }); await reload(); })}>{t('Mark paid')}</Button> : null}
            </div>
          </li>
        ))}</ul>}
      </Card>

      {c.externalFirm ? (
        <Card title={t('Law firm performance evaluation')} actions={write ? <Button size="sm" variant="secondary" onClick={() => open('evaluation', { quality: String(c.evaluation?.quality ?? 3), responsiveness: String(c.evaluation?.responsiveness ?? 3), cost: String(c.evaluation?.cost ?? 3), outcome: String(c.evaluation?.outcome ?? 3), comments: c.evaluation?.comments ?? '' })}>{c.evaluation ? t('Edit') : t('Evaluate')}</Button> : null}>
          {c.evaluation ? <DL items={[[t('Quality'), `${c.evaluation.quality}/5`], [t('Responsiveness'), `${c.evaluation.responsiveness}/5`], [t('Cost'), `${c.evaluation.cost}/5`], [t('Outcome'), `${c.evaluation.outcome}/5`], [t('Comments'), c.evaluation.comments ?? '—']]} /> : <p className="text-sm text-slate-600">{t('Required before the case can be closed.')}</p>}
        </Card>
      ) : null}

      {/* ---------------------------------------------------------------- dialogs */}
      <Modal open={dlg === 'status'} title={t('Change case status')} onClose={close} footer={save(() => api.post(`/litigation/cases/${m.id}/status`, { status: form.status, comment: form.comment }))}>
        {err}
        <Field label={t('New status')}>{(id) => <Select id={id} value={form.status ?? ''} onChange={set('status')} options={next.map((s) => ({ value: s, label: label(s) }))} />}</Field>
        <Field label={t('Comment')}>{(id) => <Textarea id={id} value={form.comment ?? ''} onChange={set('comment')} />}</Field>
      </Modal>
      <Modal open={dlg === 'edit'} wide title={t('Edit case')} onClose={close} footer={save(() => api.patch(`/litigation/cases/${m.id}`, {
        title: form.title, courtCaseNo: form.courtCaseNo || null, courtId: form.courtId || null, jurisdiction: form.jurisdiction || null, caseType: form.caseType, ourRole: form.ourRole,
        subject: form.subject || null, externalFirmId: form.externalFirmId || null, externalLawyerId: form.externalLawyerId || null, responsibleOfficerId: form.responsibleOfficerId || null,
        claimAmount: form.claimAmount || null, currency: form.currency || 'MVR', filingDate: fromDate(form.filingDate), risk: form.risk || null, exposure: form.exposure || null, remarks: form.remarks || null,
        parties: parties.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), side: p.side, counsel: p.counsel.trim() || null })),
      }))}>
        {err}
        <p className="text-xs text-slate-500">{t('Every change is recorded in the history with the old and new value.')}</p>
        <Field label={t('Title')} required>{(id) => <Input id={id} value={form.title ?? ''} onChange={set('title')} />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Court case no.')}>{(id) => <Input id={id} value={form.courtCaseNo ?? ''} onChange={set('courtCaseNo')} />}</Field>
          <Field label={t('Court / forum')}>{(id) => <Select id={id} placeholder={t('— Select —')} value={form.courtId ?? ''} onChange={set('courtId')} options={opt(courts.data)} />}</Field>
          <Field label={t('Case type')}>{(id) => <Select id={id} value={form.caseType ?? ''} onChange={set('caseType')} options={CASE_TYPES.map((x) => ({ value: x, label: label(x) }))} />}</Field>
          <Field label={t('Our role')}>{(id) => <Select id={id} value={form.ourRole ?? ''} onChange={set('ourRole')} options={OUR_ROLES.map((x) => ({ value: x, label: label(x) }))} />}</Field>
          <Field label={t('External firm')}>{(id) => <Select id={id} placeholder={t('None')} value={form.externalFirmId ?? ''} onChange={(e) => setForm((f) => ({ ...f, externalFirmId: e.target.value, externalLawyerId: '' }))} options={opt(firms.data)} />}</Field>
          <Field label={t('External lawyer')}>{(id) => <Select id={id} placeholder={t('None')} value={form.externalLawyerId ?? ''} onChange={set('externalLawyerId')} options={opt((lawyers.data ?? []).filter((l) => l.firmId === form.externalFirmId))} />}</Field>
          <UserSelect unit="LIT" labelText={t('Responsible officer')} value={form.responsibleOfficerId ?? ''} onChange={(v) => setForm((f) => ({ ...f, responsibleOfficerId: v }))} />
          <Field label={t('Filing date')}>{(id) => <Input id={id} type="date" value={form.filingDate ?? ''} onChange={set('filingDate')} />}</Field>
          <Field label={t('Claim amount')}>{(id) => <Input id={id} inputMode="decimal" value={form.claimAmount ?? ''} onChange={set('claimAmount')} />}</Field>
          <Field label={t('Currency')}>{(id) => <Input id={id} maxLength={3} value={form.currency ?? ''} onChange={set('currency')} />}</Field>
          <Field label={t('Risk assessment')}>{(id) => <Select id={id} placeholder={t('Not assessed')} value={form.risk ?? ''} onChange={set('risk')} options={['PROBABLE', 'POSSIBLE', 'REMOTE'].map((x) => ({ value: x, label: label(x) }))} />}</Field>
          <Field label={t('Estimated exposure')} hint={t('Stored encrypted.')}>{(id) => <Input id={id} inputMode="decimal" value={form.exposure ?? ''} onChange={set('exposure')} />}</Field>
          <Field label={t('Jurisdiction')}>{(id) => <Input id={id} value={form.jurisdiction ?? ''} onChange={set('jurisdiction')} />}</Field>
        </div>
        <Field label={t('Subject')}>{(id) => <Textarea id={id} value={form.subject ?? ''} onChange={set('subject')} />}</Field>
        <Field label={t('Remarks')}>{(id) => <Textarea id={id} value={form.remarks ?? ''} onChange={set('remarks')} />}</Field>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-700">{t('Parties')}</legend>
          {parties.map((p, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_2fr_auto]">
              <Input aria-label={t('Party name')} value={p.name} onChange={(e) => setParties((ps) => ps.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <Select aria-label={t('Side')} value={p.side} onChange={(e) => setParties((ps) => ps.map((x, j) => (j === i ? { ...x, side: e.target.value } : x)))} options={PARTY_SIDES.map((x) => ({ value: x, label: label(x) }))} />
              <Input aria-label={t('Counsel')} placeholder={t('Counsel')} value={p.counsel} onChange={(e) => setParties((ps) => ps.map((x, j) => (j === i ? { ...x, counsel: e.target.value } : x)))} />
              <Button size="sm" variant="ghost" onClick={() => setParties((ps) => ps.filter((_, j) => j !== i))}>{t('Remove')}</Button>
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => setParties((ps) => [...ps, { name: '', side: 'OPPOSING', counsel: '' }])}>{t('Add party')}</Button>
        </fieldset>
      </Modal>
      <Modal open={dlg === 'hearing'} title={t('Add hearing')} onClose={close} footer={save(() => api.post(`/litigation/cases/${m.id}/hearings`, { startsAt: fromLocalInput(form.startsAt ?? ''), courtId: form.courtId || null, judge: form.judge || null, purpose: form.purpose || null }))}>
        {err}
        <Field label={t('Date and time')} required>{(id) => <Input id={id} type="datetime-local" value={form.startsAt ?? ''} onChange={set('startsAt')} />}</Field>
        <Field label={t('Court / forum')}>{(id) => <Select id={id} placeholder={t('Same as the case')} value={form.courtId ?? ''} onChange={set('courtId')} options={opt(courts.data)} />}</Field>
        <Field label={t('Judge')}>{(id) => <Input id={id} value={form.judge ?? ''} onChange={set('judge')} />}</Field>
        <Field label={t('Purpose')}>{(id) => <Input id={id} value={form.purpose ?? ''} onChange={set('purpose')} />}</Field>
      </Modal>
      <Modal open={dlg === 'editHearing'} wide title={t('Edit hearing')} onClose={close} footer={save(() => api.patch(`/litigation/hearings/${sel}`, {
        startsAt: form.startsAt ? fromLocalInput(form.startsAt) : undefined, courtId: form.courtId || null, judge: form.judge || null, purpose: form.purpose || null, chitSummary: form.chitSummary || null, outcome: form.outcome || null,
      }))}>
        {err}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Date and time')}>{(id) => <Input id={id} type="datetime-local" value={form.startsAt ?? ''} onChange={set('startsAt')} />}</Field>
          <Field label={t('Court / forum')}>{(id) => <Select id={id} placeholder={t('— Select —')} value={form.courtId ?? ''} onChange={set('courtId')} options={opt(courts.data)} />}</Field>
          <Field label={t('Judge')}>{(id) => <Input id={id} value={form.judge ?? ''} onChange={set('judge')} />}</Field>
          <Field label={t('Purpose')}>{(id) => <Input id={id} value={form.purpose ?? ''} onChange={set('purpose')} />}</Field>
        </div>
        <Field label={t('Hearing chit summary')} hint={t('Summary of the court’s hearing chit. Upload the chit itself under Documents on the hearing.')}>{(id) => <Textarea id={id} value={form.chitSummary ?? ''} onChange={set('chitSummary')} />}</Field>
        <Field label={t('Outcome')}>{(id) => <Input id={id} value={form.outcome ?? ''} onChange={set('outcome')} />}</Field>
      </Modal>
      <Modal open={dlg === 'summary'} wide title={t('Hearing summary')} onClose={close} footer={save(() => api.post(`/litigation/hearings/${sel}/summary`, {
        whatHappened: form.whatHappened ?? '', ordersMade: form.ordersMade, nextSteps: form.nextSteps, companyActions: form.companyActions, outcome: form.outcome || null,
        nextHearingAt: form.nextHearingAt ? fromLocalInput(form.nextHearingAt) : null,
        attendees: { internal: (form.internal ?? '').split(',').map((s) => s.trim()).filter(Boolean), external: (form.external ?? '').split(',').map((s) => s.trim()).filter(Boolean) },
      }), t('Save summary'))}>
        {err}
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
      <Modal open={dlg === 'editSummary'} wide title={t('Edit hearing summary')} onClose={close} footer={save(() => api.patch(`/litigation/hearings/${sel}`, { summary: { whatHappened: form.whatHappened ?? '', ordersMade: form.ordersMade ?? '', nextSteps: form.nextSteps ?? '', companyActions: form.companyActions ?? '' } }), t('Save summary'))}>
        {err}
        <Field label={t('What happened')} required>{(id) => <Textarea id={id} value={form.whatHappened ?? ''} onChange={set('whatHappened')} />}</Field>
        <Field label={t('Orders made')}>{(id) => <Textarea id={id} value={form.ordersMade ?? ''} onChange={set('ordersMade')} />}</Field>
        <Field label={t('Next steps')}>{(id) => <Textarea id={id} value={form.nextSteps ?? ''} onChange={set('nextSteps')} />}</Field>
        <Field label={t('Actions for the company')}>{(id) => <Textarea id={id} value={form.companyActions ?? ''} onChange={set('companyActions')} />}</Field>
      </Modal>
      <Modal open={dlg === 'postpone'} title={t('Postpone hearing')} onClose={close} footer={save(() => api.post(`/litigation/hearings/${sel}/postpone`, { startsAt: fromLocalInput(form.startsAt ?? ''), reason: form.reason ?? '' }))}>
        {err}
        <p className="text-sm text-slate-600">{t('This hearing ({d}) is marked postponed and a new hearing is created on the new date.', { d: fmtDateTime(hearingSel?.startsAt) })}</p>
        <Field label={t('New date and time')} required>{(id) => <Input id={id} type="datetime-local" value={form.startsAt ?? ''} onChange={set('startsAt')} />}</Field>
        <Field label={t('Reason')} required>{(id) => <Textarea id={id} value={form.reason ?? ''} onChange={set('reason')} />}</Field>
        <p className="text-xs text-slate-500">{t('Upload the postponement notice under Documents on the hearing.')}</p>
      </Modal>
      <Modal open={dlg === 'contRequest'} title={t('Request for continuance')} onClose={close} footer={save(() => api.post(`/litigation/hearings/${sel}/continuance`, { action: 'REQUEST', note: form.note || null }))}>
        {err}
        <Field label={t('Grounds / note')}>{(id) => <Textarea id={id} value={form.note ?? ''} onChange={set('note')} />}</Field>
        <p className="text-xs text-slate-500">{t('Upload the filed request under Documents on the hearing (type "Request for continuance").')}</p>
      </Modal>
      <Modal open={dlg === 'contDecision'} title={t('Continuance decision')} onClose={close} footer={save(() => api.post(`/litigation/hearings/${sel}/continuance`, { action: form.decision, note: form.note || null, startsAt: form.decision === 'GRANTED' && form.startsAt ? fromLocalInput(form.startsAt) : null }))}>
        {err}
        <Field label={t('Decision')}>{(id) => <Select id={id} value={form.decision ?? 'GRANTED'} onChange={set('decision')} options={[{ value: 'GRANTED', label: t('Granted (hearing moves to a new date)') }, { value: 'DENIED', label: t('Denied (hearing stays)') }]} />}</Field>
        {form.decision !== 'DENIED' ? <Field label={t('New date and time')} required>{(id) => <Input id={id} type="datetime-local" value={form.startsAt ?? ''} onChange={set('startsAt')} />}</Field> : null}
        <Field label={t('Note')}>{(id) => <Textarea id={id} value={form.note ?? ''} onChange={set('note')} />}</Field>
      </Modal>
      <Modal open={dlg === 'deadline' || dlg === 'editDeadline'} title={dlg === 'deadline' ? t('Add deadline') : t('Edit deadline')} onClose={close} footer={save(() => {
        const body = { type: form.type ?? 'FILING', title: form.title ?? '', dueAt: fromDate(form.dueAt, '16:00'), ownerId: form.ownerId || null };
        return dlg === 'deadline' ? api.post(`/litigation/cases/${m.id}/deadlines`, body) : api.patch(`/litigation/deadlines/${sel}`, body);
      })}>
        {err}
        <Field label={t('Type')}>{(id) => <Select id={id} value={form.type ?? 'FILING'} onChange={set('type')} options={['FILING', 'SUBMISSION', 'APPEAL', 'LIMITATION', 'OTHER'].map((x) => ({ value: x, label: label(x) }))} />}</Field>
        <Field label={t('Title')}>{(id) => <Input id={id} value={form.title ?? ''} onChange={set('title')} />}</Field>
        <Field label={t('Due date')}>{(id) => <Input id={id} type="date" value={form.dueAt ?? ''} onChange={set('dueAt')} />}</Field>
        <UserSelect unit="LIT" labelText={t('Owner')} value={form.ownerId ?? ''} onChange={(v) => setForm((f) => ({ ...f, ownerId: v }))} />
      </Modal>
      <Modal open={dlg === 'engagement'} title={t('Engage external counsel')} onClose={close} footer={save(() => api.post(`/litigation/cases/${m.id}/engagements`, { firmId: form.firmId, feeArrangement: form.fee || null, budget: form.budget || null }))}>
        {err}
        <Field label={t('Law firm')}>{(id) => <Select id={id} placeholder={t('— Select —')} value={form.firmId ?? ''} onChange={set('firmId')} options={opt(firms.data)} />}</Field>
        <Field label={t('Fee arrangement')}>{(id) => <Textarea id={id} value={form.fee ?? ''} onChange={set('fee')} />}</Field>
        <Field label={t('Budget')}>{(id) => <Input id={id} inputMode="decimal" value={form.budget ?? ''} onChange={set('budget')} />}</Field>
        <p className="text-xs text-slate-500">{t('Upload the engagement letter in Documents with type "Engagement letter".')}</p>
      </Modal>
      <Modal open={dlg === 'editEngagement'} title={t('Edit engagement')} onClose={close} footer={save(() => api.patch(`/litigation/engagements/${sel}`, { feeArrangement: form.fee || null, budget: form.budget || null }))}>
        {err}
        <Field label={t('Fee arrangement')}>{(id) => <Textarea id={id} value={form.fee ?? ''} onChange={set('fee')} />}</Field>
        <Field label={t('Budget')}>{(id) => <Input id={id} inputMode="decimal" value={form.budget ?? ''} onChange={set('budget')} />}</Field>
      </Modal>
      <Modal open={dlg === 'invoice' || dlg === 'editInvoice'} title={dlg === 'invoice' ? t('Record invoice') : t('Edit invoice')} onClose={close} footer={save(() => {
        const body = { invoiceNo: form.invoiceNo ?? '', amount: form.amount ?? '', receivedOn: fromDate(form.receivedOn) ?? undefined, notes: form.notes || null };
        return dlg === 'invoice' ? api.post(`/litigation/engagements/${sel}/invoices`, body) : api.patch(`/litigation/invoices/${sel}`, body);
      })}>
        {err}
        <Field label={t('Invoice no.')}>{(id) => <Input id={id} value={form.invoiceNo ?? ''} onChange={set('invoiceNo')} />}</Field>
        <Field label={t('Amount')}>{(id) => <Input id={id} inputMode="decimal" value={form.amount ?? ''} onChange={set('amount')} />}</Field>
        <Field label={t('Received on')}>{(id) => <Input id={id} type="date" value={form.receivedOn ?? ''} onChange={set('receivedOn')} />}</Field>
        <Field label={t('Notes')}>{(id) => <Textarea id={id} value={form.notes ?? ''} onChange={set('notes')} />}</Field>
      </Modal>
      <Modal open={dlg === 'update' || dlg === 'editUpdate'} title={dlg === 'update' ? t('Log an update from counsel') : t('Edit update')} onClose={close} footer={save(() => {
        const body = { receivedAt: fromLocalInput(form.receivedAt ?? ''), channel: form.channel ?? 'EMAIL', summary: form.summary ?? '' };
        return dlg === 'update' ? api.post(`/litigation/cases/${m.id}/updates`, body) : api.patch(`/litigation/updates/${sel}`, body);
      })}>
        {err}
        <Field label={t('Received')}>{(id) => <Input id={id} type="datetime-local" value={form.receivedAt ?? ''} onChange={set('receivedAt')} />}</Field>
        <Field label={t('Channel')}>{(id) => <Select id={id} value={form.channel ?? 'EMAIL'} onChange={set('channel')} options={['EMAIL', 'PHONE', 'MEETING', 'LETTER'].map((x) => ({ value: x, label: label(x) }))} />}</Field>
        <Field label={t('Summary')}>{(id) => <Textarea id={id} value={form.summary ?? ''} onChange={set('summary')} />}</Field>
      </Modal>
      <Modal open={dlg === 'outcome' || dlg === 'editOutcome'} title={dlg === 'outcome' ? t('Record settlement or judgment') : t('Edit settlement or judgment')} onClose={close} footer={save(() => {
        const judgment = (form.kind ?? 'JUDGMENT') === 'JUDGMENT';
        const body = { kind: form.kind ?? 'JUDGMENT', decidedOn: fromDate(form.decidedOn) ?? undefined, amount: form.amount || null, direction: form.direction ?? 'PAYABLE', terms: form.terms || null, ...(dlg === 'editOutcome' ? { paymentStatus: form.paymentStatus } : {}),
          complyBy: fromDate(form.complyBy) ?? null,
          ...(judgment ? { appealDays: form.appealDays ? Number(form.appealDays) : null, appealDayKind: (form.appealDayKind as 'CALENDAR' | 'BUSINESS') || 'CALENDAR', appealFrom: fromDate(form.appealFrom) ?? null, appealDecision: form.appealDecision || 'UNDECIDED' } : {}) };
        return dlg === 'outcome' ? api.post(`/litigation/cases/${m.id}/outcomes`, body) : api.patch(`/litigation/outcomes/${sel}`, body);
      })}>
        {err}
        <Field label={t('Kind')}>{(id) => <Select id={id} value={form.kind ?? 'JUDGMENT'} onChange={set('kind')} options={['JUDGMENT', 'SETTLEMENT'].map((x) => ({ value: x, label: label(x) }))} />}</Field>
        <Field label={t('Date')}>{(id) => <Input id={id} type="date" value={form.decidedOn ?? ''} onChange={set('decidedOn')} />}</Field>
        <Field label={t('Amount')} hint={t('Stored encrypted.')}>{(id) => <Input id={id} inputMode="decimal" value={form.amount ?? ''} onChange={set('amount')} />}</Field>
        <Field label={t('Direction')}>{(id) => <Select id={id} value={form.direction ?? 'PAYABLE'} onChange={set('direction')} options={['PAYABLE', 'RECEIVABLE', 'NONE'].map((x) => ({ value: x, label: label(x) }))} />}</Field>
        {dlg === 'editOutcome' ? <Field label={t('Payment status')}>{(id) => <Select id={id} value={form.paymentStatus ?? 'PENDING'} onChange={set('paymentStatus')} options={['PENDING', 'PARTIAL', 'PAID', 'NA'].map((x) => ({ value: x, label: label(x) }))} />}</Field> : null}
        <Field label={t('Terms')}>{(id) => <Textarea id={id} value={form.terms ?? ''} onChange={set('terms')} />}</Field>
        <Field label={t('Comply by (payment / action due)')} hint={t('Creates a deadline on the case and the calendar until it is paid.')}>{(id) => <Input id={id} type="date" value={form.complyBy ?? ''} onChange={set('complyBy')} />}</Field>
        {(form.kind ?? 'JUDGMENT') === 'JUDGMENT' ? (
          <fieldset className="rounded border p-3">
            <legend className="px-1 text-sm font-medium">{t('Appeal')}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label={t('Appeal period (days)')} hint={t('Pre-filled from the court; check it for this judgment.')}>{(id) => <Input id={id} inputMode="numeric" value={form.appealDays ?? ''} onChange={set('appealDays')} />}</Field>
              <Field label={t('Counted as')}>{(id) => <Select id={id} value={form.appealDayKind ?? 'CALENDAR'} onChange={set('appealDayKind')} options={[{ value: 'CALENDAR', label: t('Calendar days') }, { value: 'BUSINESS', label: t('Working days') }]} />}</Field>
              <Field label={t('Counted from')} hint={t('Empty = the judgment date (e.g. use the date the judgment was received).')}>{(id) => <Input id={id} type="date" value={form.appealFrom ?? ''} onChange={set('appealFrom')} />}</Field>
              <Field label={t('Decision')}>{(id) => <Select id={id} value={form.appealDecision ?? 'UNDECIDED'} onChange={set('appealDecision')} options={[{ value: 'UNDECIDED', label: t('Not decided yet') }, { value: 'APPEAL', label: t('We will appeal') }, { value: 'NO_APPEAL', label: t('No appeal') }]} />}</Field>
            </div>
            <p className="text-xs text-slate-500">{t('While undecided, the appeal deadline is on the case and calendar with reminders. Once decided it is closed.')}</p>
          </fieldset>
        ) : null}
      </Modal>
      <Modal open={dlg === 'evaluation'} title={t('Law firm performance evaluation')} onClose={close} footer={save(() => api.post(`/litigation/cases/${m.id}/evaluation`, { quality: +form.quality!, responsiveness: +form.responsiveness!, cost: +form.cost!, outcome: +form.outcome!, comments: form.comments || null }))}>
        {err}
        {(['quality', 'responsiveness', 'cost', 'outcome'] as const).map((k) => <Field key={k} label={t(label(k))}>{(id) => <Select id={id} value={form[k] ?? '3'} onChange={set(k)} options={['1', '2', '3', '4', '5'].map((x) => ({ value: x, label: `${x} / 5` }))} />}</Field>)}
        <Field label={t('Comments')}>{(id) => <Textarea id={id} value={form.comments ?? ''} onChange={set('comments')} />}</Field>
      </Modal>
    </>
  );
}

/** "Appeal by 11 Mar 2027 (10 calendar days) · not decided" under a judgment. */
function AppealLine({ o, deadlines }: { o: CaseDetail['outcomes'][number]; deadlines: CaseDetail['deadlines'] }) {
  if (o.kind !== 'JUDGMENT' && !o.complyBy) return null;
  const appeal = deadlines.find((d) => d.id === o.appealDeadlineId);
  const comply = deadlines.find((d) => d.id === o.complyDeadlineId);
  const decision = o.appealDecision === 'APPEAL' ? t('decided: appeal') : o.appealDecision === 'NO_APPEAL' ? t('decided: no appeal') : t('not decided');
  const overdue = (d?: { dueAt: string; status: string }) => d && d.status === 'OPEN' && new Date(d.dueAt) < new Date();
  return (
    <div className="mt-1 space-y-0.5 text-xs" data-testid="appeal-line">
      {o.kind === 'JUDGMENT' ? (o.appealDays
        ? <div className={overdue(appeal) ? 'font-semibold text-red-700' : ''}>{t('Appeal by {d}', { d: appeal ? fmtDate(appeal.dueAt) : '—' })} ({o.appealDays} {o.appealDayKind === 'BUSINESS' ? t('working days') : t('calendar days')}) · {decision}</div>
        : <div className="text-amber-800">{t('Appeal period not entered')} · {decision}</div>) : null}
      {o.complyBy ? <div className={overdue(comply) ? 'font-semibold text-red-700' : ''}>{t('Comply by {d}', { d: fmtDate(o.complyBy) })}{comply?.status === 'DONE' ? ` · ${t('done')}` : ''}</div> : null}
    </div>
  );
}
