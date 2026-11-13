import { Injectable, OnModuleInit } from '@nestjs/common';
import { Matter, Prisma } from '@prisma/client';
import { availableActions, DraftingAction, draftingMachine, DraftingStatus, findTransition } from '@ldms/shared';
import { currentUser, AuthUser } from '../../common/context';
import { badRequest, conflict, forbidden, notFound } from '../../common/errors';
import { PrismaService, Tx } from '../../common/prisma.service';
import { AuditService } from '../../core/audit/audit.service';
import { CalendarService } from '../../core/calendar/calendar.service';
import { SettingsService } from '../../core/config/settings.service';
import { DocumentsService } from '../../core/documents/documents.service';
import { IntakeService } from '../../core/intake/intake.service';
import { JobsService } from '../../core/jobs/jobs.service';
import { MattersService } from '../../core/matters/matters.service';
import { NotificationsService } from '../../core/notifications/notifications.service';
import { PolicyService } from '../../core/policy/policy.service';
import { SlaService } from '../../core/sla/sla.service';

interface HodRules { enabled: boolean; minContractValue: number | null; restricted: boolean; requestTypeCodes: string[] }

export interface ActionInput {
  action: DraftingAction;
  comment?: string;
  assigneeId?: string;
  reviewerId?: string;
  followUpDate?: Date;
}

@Injectable()
export class DraftingService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matters: MattersService,
    private readonly policy: PolicyService,
    private readonly sla: SlaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly calendar: CalendarService,
    private readonly intake: IntakeService,
    private readonly documents: DocumentsService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit() {
    this.intake.registerConverter('DRF', async (tx, i, input) => {
      const m = await this.matters.create(tx, {
        unit: 'DRF', title: input.title ?? i.subject, description: i.summary, requestTypeId: input.requestTypeId, priority: input.priority ?? i.priority,
        requestingDeptId: i.senderDeptId, requesterId: i.submittedById, requesterName: i.senderName, dueDate: input.dueDate ?? i.dueDate,
        restricted: input.restricted, status: 'REGISTERED', searchText: i.summary,
      });
      await tx.statusTransition.create({ data: { matterId: m.id, fromStatus: 'RECEIVED', toStatus: 'REGISTERED', action: 'register', actorId: currentUser().id, comment: `From intake ${i.intakeNo}` } });
      await tx.draftingRequest.create({ data: { matterId: m.id, counterparty: (input.extra?.counterparty as string) ?? null } });
      return m;
    });
  }

  // ------------------------------------------------------------------ create / read
  async create(input: { title: string; description?: string | null; requestTypeId: string; priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'; requestingDeptId?: string | null; requesterName?: string | null; dueDate?: Date | null; restricted?: boolean; counterparty?: string | null; contractValue?: string | null; currency?: string }) {
    if (!this.policy.covers('draft:draft', 'DRF') && !this.policy.covers('intake:triage', 'DRF')) throw forbidden();
    const rt = await this.prisma.base.requestType.findUnique({ where: { id: input.requestTypeId } });
    if (!rt || rt.unit !== 'DRF') throw badRequest('Choose a drafting request type');
    const m = await this.prisma.tx(async (tx) => {
      const matter = await this.matters.create(tx, { ...input, unit: 'DRF', status: 'REGISTERED' });
      await tx.statusTransition.create({ data: { matterId: matter.id, fromStatus: 'RECEIVED', toStatus: 'REGISTERED', action: 'register', actorId: currentUser().id } });
      await tx.draftingRequest.create({ data: { matterId: matter.id, counterparty: input.counterparty ?? null, contractValue: input.contractValue ?? null, currency: input.currency ?? 'MVR' } });
      return matter;
    });
    await this.sla.start({ policyCode: 'ASSIGN', step: 'ASSIGN', matterId: m.id, urgent: m.priority === 'URGENT' });
    await this.audit.log({ action: 'drf.request.created', entityType: 'Matter', entityId: m.id, after: { title: input.title, requestType: rt.code } });
    return { id: m.id, reference: m.reference };
  }

  private async load(id: string) {
    const m = await this.policy.assertMatter(id);
    if (m.unit !== 'DRF') throw notFound('Request');
    const d = await this.prisma.db.draftingRequest.findUnique({ where: { matterId: id }, include: { reviews: { orderBy: { round: 'asc' } }, approvals: { orderBy: { at: 'asc' } } } });
    if (!d) throw notFound('Request');
    const assignments = await this.prisma.db.matterAssignment.findMany({ where: { matterId: id } });
    const drafterId = d.drafterId ?? assignments.find((a) => a.role === 'ASSIGNEE')?.userId ?? null;
    const reviewerId = d.reviewerId ?? assignments.find((a) => a.role === 'REVIEWER')?.userId ?? null;
    return { m, d, drafterId, reviewerId };
  }

  async get(id: string) {
    const { m, d, drafterId, reviewerId } = await this.load(id);
    const user = currentUser();
    const names = await this.prisma.base.user.findMany({ where: { id: { in: [drafterId, reviewerId, ...d.approvals.map((a) => a.approverId), ...d.reviews.map((r) => r.reviewerId)].filter((x): x is string => !!x) } }, select: { id: true, displayName: true } });
    const name = (uid: string | null) => names.find((n) => n.id === uid)?.displayName ?? null;
    const actions = availableActions(draftingMachine, m.status as DraftingStatus)
      .filter((t) => this.guard(t.action, m, user, drafterId, reviewerId, true) === null)
      .map((t) => ({ action: t.action, label: t.label, requiresComment: !!t.requiresComment }));
    return {
      ...d, drafterId, reviewerId, drafterName: name(drafterId), reviewerName: name(reviewerId),
      reviews: d.reviews.map((r) => ({ ...r, reviewerName: name(r.reviewerId) })),
      approvals: d.approvals.map((a) => ({ ...a, approverName: name(a.approverId) })),
      actions: [...new Map(actions.map((a) => [a.action, a])).values()],
    };
  }

  async update(id: string, data: { counterparty?: string | null; contractValue?: string | null; currency?: string }) {
    const { m } = await this.load(id);
    await this.policy.assertWrite(m);
    const before = await this.prisma.db.draftingRequest.findUniqueOrThrow({ where: { matterId: id } });
    const after = await this.prisma.db.draftingRequest.update({ where: { matterId: id }, data });
    await this.audit.log({ action: 'drf.request.updated', entityType: 'Matter', entityId: id, before, after });
    return after;
  }

  // ------------------------------------------------------------------ guards (maker-checker)
  /** Returns null if allowed, or the reason. `quiet` = used to compute the action list. */
  private guard(action: DraftingAction, m: Matter, user: AuthUser, drafterId: string | null, reviewerId: string | null, _quiet = false): string | null {
    const unitHead = user.roles.some((r) => r.role === 'UNIT_HEAD' && r.unit === 'DRF');
    const isDrafter = !!drafterId && user.id === drafterId;
    const isReviewer = !!reviewerId && user.id === reviewerId;
    const manage = user.isHod || unitHead;
    switch (action) {
      case 'register': return this.policy.covers('intake:triage', 'DRF', user) ? null : 'Only Legal staff can register requests';
      case 'assign': case 'cancel': case 'reject': return manage ? null : 'Only the Unit Head or HoD can do this';
      case 'start': case 'request_info': case 'info_received': case 'submit_review':
        return isDrafter || (manage && action !== 'submit_review') ? null : 'Only the assigned lawyer can do this';
      case 'return_correction': case 'mark_reviewed':
        if (isDrafter) return 'The person who drafted a document cannot review it (maker-checker)';
        return isReviewer || manage ? null : 'Only the reviewer can do this';
      case 'send_for_approval': return isReviewer || isDrafter || manage ? null : 'Only the drafter or reviewer can do this';
      case 'approve': case 'escalate_hod': case 'return_from_approval':
        if (m.status === 'PENDING_HOD_APPROVAL') return user.isHod && !isDrafter && !isReviewer ? null : 'Waiting for HoD approval';
        if (isDrafter || isReviewer) return 'You drafted or reviewed this document, so you cannot approve it (maker-checker)';
        return unitHead || user.isHod ? null : 'Only the Unit Head or HoD can approve';
      case 'hod_approve':
        if (!user.isHod) return 'Only the HoD can approve at this stage';
        return isDrafter || isReviewer ? 'You drafted or reviewed this document, so you cannot approve it (maker-checker)' : null;
      case 'send': case 'require_follow_up': case 'close': return isDrafter || manage ? null : 'Only the assigned lawyer can do this';
      default: return 'Not allowed';
    }
  }

  /** Should approval go straight to the HoD? (Unit Head was maker/checker, or an optional configured rule.) */
  private async needsHod(tx: Tx, m: Matter, drafterId: string | null, reviewerId: string | null): Promise<string | null> {
    const unitHeads = await tx.userRole.findMany({ where: { role: 'UNIT_HEAD', unit: 'DRF' } });
    if (unitHeads.some((u) => u.userId === drafterId || u.userId === reviewerId)) return 'The Unit Head drafted or reviewed this document';
    const rules = await this.settings.get<HodRules>('drafting.hodRules');
    if (!rules?.enabled) return null;
    const d = await tx.draftingRequest.findUniqueOrThrow({ where: { matterId: m.id } });
    if (rules.restricted && m.restricted) return 'Restricted matters go to the HoD (rule)';
    if (rules.minContractValue !== null && d.contractValue && Number(d.contractValue) >= rules.minContractValue) return `Contract value at or above ${rules.minContractValue} (rule)`;
    if (rules.requestTypeCodes.length && m.requestTypeId) {
      const rt = await tx.requestType.findUnique({ where: { id: m.requestTypeId } });
      if (rt && rules.requestTypeCodes.includes(rt.code)) return `${rt.name} requests go to the HoD (rule)`;
    }
    return null;
  }

  private async latestVersion(tx: Tx, matterId: string, stages?: string[]) {
    return tx.documentVersion.findFirst({ where: { document: { matterId, deletedAt: null }, ...(stages ? { stageLabel: { in: stages } } : {}) }, orderBy: { createdAt: 'desc' } });
  }

  // ------------------------------------------------------------------ transitions
  async act(id: string, input: ActionInput) {
    const { m, drafterId, reviewerId } = await this.load(id);
    const user = currentUser();
    const from = m.status as DraftingStatus;
    const t = findTransition(draftingMachine, from, input.action);
    if (!t) throw conflict(`"${input.action.replace(/_/g, ' ')}" is not possible while the request is ${from.replace(/_/g, ' ').toLowerCase()}`);
    if (!this.policy.covers(t.perm, 'DRF')) throw forbidden();
    const reason = this.guard(input.action, m, user, drafterId, reviewerId);
    if (reason) {
      await this.audit.log({ action: 'drf.action.denied', outcome: 'DENIED', entityType: 'Matter', entityId: id, meta: { action: input.action, reason } });
      throw forbidden(reason);
    }
    if (t.requiresComment && !input.comment?.trim()) throw badRequest('A comment is required for this step');

    if (input.action === 'assign') {
      if (!input.assigneeId) throw badRequest('Choose the lawyer');
      if (input.reviewerId && input.reviewerId === input.assigneeId) throw badRequest('The reviewer cannot be the drafter (maker-checker)');
      await this.matters.assign(id, { assigneeIds: [input.assigneeId], reviewerId: input.reviewerId ?? null });
    }

    let to: DraftingStatus = t.to;
    let hodReason: string | null = null;
    const notify: { ids: (string | null)[]; title: string }[] = [];
    const rt = m.requestTypeId ? await this.prisma.base.requestType.findUnique({ where: { id: m.requestTypeId }, include: { slaPolicy: true } }) : null;

    await this.prisma.tx(async (tx) => {
      switch (input.action) {
        case 'assign': {
          await tx.draftingRequest.update({ where: { matterId: id }, data: { drafterId: input.assigneeId, reviewerId: input.reviewerId ?? null } });
          if (!(await tx.slaClock.count({ where: { matterId: id, step: 'DRAFTING' } }))) {
            await this.sla.start({ policyCode: rt?.slaPolicy?.code ?? 'DRF_OTHER', step: 'DRAFTING', matterId: id, urgent: m.priority === 'URGENT', ownerId: input.assigneeId }, tx);
          }
          break;
        }
        case 'request_info':
          await this.sla.pause(id, input.comment ?? 'awaiting information', tx);
          if (m.requesterId) notify.push({ ids: [m.requesterId], title: `Legal needs more information on ${m.reference}` });
          await tx.comment.create({ data: { matterId: id, authorId: user.id, internal: false, body: m.restricted ? null : `Information requested: ${input.comment}`, mentions: [] } });
          break;
        case 'info_received':
          await this.sla.resume(id, tx);
          break;
        case 'submit_review': {
          if (!reviewerId) throw badRequest('Assign a reviewer before submitting for review');
          const v = await this.latestVersion(tx, id);
          if (!v) throw badRequest('Upload the draft document before submitting for review');
          if (v.scanStatus !== 'CLEAN') throw conflict('The draft is still being virus-scanned');
          const round = (await tx.reviewRound.count({ where: { matterId: id } })) + 1;
          await tx.reviewRound.create({ data: { matterId: id, round, reviewerId, submittedVersionId: v.id } });
          await this.sla.start({ policyCode: 'REVIEW', step: 'REVIEW', matterId: id, ownerId: reviewerId, urgent: m.priority === 'URGENT' }, tx);
          notify.push({ ids: [reviewerId], title: `Please review ${m.reference} (round ${round})` });
          break;
        }
        case 'return_correction':
        case 'mark_reviewed': {
          const open = await tx.reviewRound.findFirst({ where: { matterId: id, decision: null }, orderBy: { round: 'desc' } });
          if (open) await tx.reviewRound.update({ where: { id: open.id }, data: { decision: input.action === 'mark_reviewed' ? 'REVIEWED' : 'RETURNED', comments: input.comment ?? null, decidedAt: new Date(), reviewerId: user.id } });
          await tx.slaClock.updateMany({ where: { matterId: id, step: 'REVIEW', stoppedAt: null }, data: { stoppedAt: new Date() } });
          if (input.action === 'return_correction') notify.push({ ids: [drafterId], title: `${m.reference} returned for correction` });
          break;
        }
        case 'send_for_approval': {
          hodReason = await this.needsHod(tx, m, drafterId, reviewerId);
          const approver = hodReason ? await tx.userRole.findFirst({ where: { role: 'HOD' } }) : await tx.userRole.findFirst({ where: { role: 'UNIT_HEAD', unit: 'DRF', userId: { notIn: [drafterId, reviewerId].filter((x): x is string => !!x) } } });
          await tx.draftingRequest.update({ where: { matterId: id }, data: { approvalLevel: hodReason ? 'HOD' : 'UNIT_HEAD', escalationReason: hodReason } });
          await this.sla.start({ policyCode: 'APPROVAL', step: 'APPROVAL', matterId: id, ownerId: approver?.userId ?? null, urgent: m.priority === 'URGENT' }, tx);
          const recipients = hodReason ? (await tx.userRole.findMany({ where: { role: 'HOD' } })).map((r) => r.userId) : (await tx.userRole.findMany({ where: { role: 'UNIT_HEAD', unit: 'DRF' } })).map((r) => r.userId);
          notify.push({ ids: recipients.filter((r) => r !== drafterId && r !== reviewerId), title: `${m.reference} is waiting for your approval` });
          break;
        }
        case 'approve':
        case 'hod_approve': {
          const final = await this.latestVersion(tx, id, ['FINAL']);
          if (!final) throw badRequest('Upload the final version (stage "Final") before approving');
          await tx.approval.create({ data: { matterId: id, level: input.action === 'hod_approve' || user.isHod ? 'HOD' : 'UNIT_HEAD', approverId: user.id, decision: 'APPROVED', reason: input.comment ?? null } });
          await tx.slaClock.updateMany({ where: { matterId: id, step: 'APPROVAL', stoppedAt: null }, data: { stoppedAt: new Date() } });
          await tx.slaClock.updateMany({ where: { matterId: id, step: 'DRAFTING', stoppedAt: null }, data: { stoppedAt: new Date() } });
          notify.push({ ids: [drafterId], title: `${m.reference} approved` });
          break;
        }
        case 'escalate_hod': {
          await tx.approval.create({ data: { matterId: id, level: 'UNIT_HEAD', approverId: user.id, decision: 'ESCALATED', reason: input.comment ?? null } });
          await tx.draftingRequest.update({ where: { matterId: id }, data: { approvalLevel: 'HOD', escalationReason: input.comment ?? null } });
          notify.push({ ids: (await tx.userRole.findMany({ where: { role: 'HOD' } })).map((r) => r.userId), title: `${m.reference} escalated to you for approval` });
          break;
        }
        case 'return_from_approval': {
          await tx.approval.create({ data: { matterId: id, level: m.status === 'PENDING_HOD_APPROVAL' ? 'HOD' : 'UNIT_HEAD', approverId: user.id, decision: 'RETURNED', reason: input.comment ?? null } });
          await tx.slaClock.updateMany({ where: { matterId: id, step: 'APPROVAL', stoppedAt: null }, data: { stoppedAt: new Date() } });
          notify.push({ ids: [drafterId], title: `${m.reference} returned by the approver` });
          break;
        }
        case 'send': {
          const final = await this.latestVersion(tx, id, ['FINAL']);
          if (final) await tx.document.update({ where: { id: final.documentId }, data: { sharedToPortal: true } });
          if (m.requesterId) notify.push({ ids: [m.requesterId], title: `Your request ${m.reference} is ready` });
          break;
        }
        case 'require_follow_up': {
          if (!input.followUpDate) throw badRequest('Choose the follow-up date');
          await tx.draftingRequest.update({ where: { matterId: id }, data: { followUpDate: input.followUpDate } });
          await this.calendar.upsert({ kind: 'FOLLOW_UP', unit: 'DRF', title: `Follow up ${m.reference}`, sourceType: 'DraftingFollowUp', sourceId: id, startsAt: input.followUpDate, allDay: true, ownerId: drafterId, matterId: id, restricted: m.restricted }, tx);
          break;
        }
        case 'close': case 'cancel': case 'reject':
          await this.calendar.cancel('DraftingFollowUp', id, tx);
          break;
      }
      await this.matters.recordTransition(tx, id, from, to, input.action, input.comment);
      if (input.action === 'send_for_approval' && hodReason) {
        await this.matters.recordTransition(tx, id, to, 'PENDING_HOD_APPROVAL', 'auto-route-hod', hodReason);
        to = 'PENDING_HOD_APPROVAL';
      }
    });

    for (const n of notify) await this.notifications.notify(n.ids.filter((x) => x && x !== user.id), { type: 'drf.workflow', title: n.title, link: `/drafting/${id}`, matterId: id, restricted: m.restricted });
    return this.get(id);
  }
}
