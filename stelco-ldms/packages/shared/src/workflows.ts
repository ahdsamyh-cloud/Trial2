/**
 * Workflow state machines (docs/PLAN.md §5). Plain transition tables:
 * the server-side WorkflowService enforces them and adds role/maker-checker guards.
 */
import type { Permission } from './permissions';

export interface TransitionDef<S extends string, A extends string> {
  action: A;
  from: readonly S[];
  to: S;
  perm: Permission;
  requiresComment?: boolean;
  label: string;
}

export interface Machine<S extends string, A extends string> {
  name: string;
  initial: S;
  terminal: readonly S[];
  transitions: readonly TransitionDef<S, A>[];
}

export function findTransition<S extends string, A extends string>(m: Machine<S, A>, from: S, action: string): TransitionDef<S, A> | undefined {
  return m.transitions.find((t) => t.action === action && t.from.includes(from));
}

export function availableActions<S extends string, A extends string>(m: Machine<S, A>, from: S): TransitionDef<S, A>[] {
  return m.transitions.filter((t) => t.from.includes(from));
}

// ---------------------------------------------------------------- Intake
export const INTAKE_STATUSES = ['NEW', 'CONVERTED', 'LINKED', 'NOT_LEGAL', 'DUPLICATE'] as const;
export type IntakeStatus = (typeof INTAKE_STATUSES)[number];
export const intakeMachine: Machine<IntakeStatus, 'convert' | 'link' | 'not_legal' | 'duplicate' | 'reopen'> = {
  name: 'intake',
  initial: 'NEW',
  terminal: ['CONVERTED', 'LINKED'],
  transitions: [
    { action: 'convert', from: ['NEW'], to: 'CONVERTED', perm: 'intake:triage', label: 'Convert to matter' },
    { action: 'link', from: ['NEW'], to: 'LINKED', perm: 'intake:triage', label: 'Link to existing matter' },
    { action: 'not_legal', from: ['NEW'], to: 'NOT_LEGAL', perm: 'intake:triage', requiresComment: true, label: 'Not a legal matter' },
    { action: 'duplicate', from: ['NEW'], to: 'DUPLICATE', perm: 'intake:triage', label: 'Mark duplicate' },
    { action: 'reopen', from: ['NOT_LEGAL', 'DUPLICATE'], to: 'NEW', perm: 'intake:assign', requiresComment: true, label: 'Reopen' },
  ],
};

// ---------------------------------------------------------------- Drafting
export const DRAFTING_STATUSES = [
  'RECEIVED', 'REGISTERED', 'ASSIGNED', 'IN_DRAFTING', 'AWAITING_INFO', 'SUBMITTED_FOR_REVIEW', 'RETURNED_FOR_CORRECTION',
  'REVIEWED', 'PENDING_APPROVAL', 'PENDING_HOD_APPROVAL', 'APPROVED', 'SENT_TO_REQUESTER', 'FOLLOW_UP_REQUIRED', 'CLOSED',
  'CANCELLED', 'REJECTED',
] as const;
export type DraftingStatus = (typeof DRAFTING_STATUSES)[number];
export type DraftingAction =
  | 'register' | 'assign' | 'start' | 'request_info' | 'info_received' | 'submit_review' | 'return_correction'
  | 'mark_reviewed' | 'send_for_approval' | 'approve' | 'escalate_hod' | 'hod_approve' | 'return_from_approval'
  | 'send' | 'require_follow_up' | 'close' | 'cancel' | 'reject';

export const DRAFTING_OPEN: DraftingStatus[] = DRAFTING_STATUSES.filter((s) => !['CLOSED', 'CANCELLED', 'REJECTED'].includes(s));

export const draftingMachine: Machine<DraftingStatus, DraftingAction> = {
  name: 'drafting',
  initial: 'RECEIVED',
  terminal: ['CLOSED', 'CANCELLED', 'REJECTED'],
  transitions: [
    { action: 'register', from: ['RECEIVED'], to: 'REGISTERED', perm: 'intake:triage', label: 'Register' },
    { action: 'assign', from: ['REGISTERED', 'ASSIGNED'], to: 'ASSIGNED', perm: 'matter:assign', label: 'Assign' },
    { action: 'start', from: ['ASSIGNED'], to: 'IN_DRAFTING', perm: 'draft:draft', label: 'Start drafting' },
    { action: 'request_info', from: ['IN_DRAFTING', 'ASSIGNED'], to: 'AWAITING_INFO', perm: 'draft:draft', requiresComment: true, label: 'Request information' },
    { action: 'info_received', from: ['AWAITING_INFO'], to: 'IN_DRAFTING', perm: 'draft:draft', label: 'Information received' },
    { action: 'submit_review', from: ['IN_DRAFTING'], to: 'SUBMITTED_FOR_REVIEW', perm: 'draft:draft', label: 'Submit for review' },
    { action: 'return_correction', from: ['SUBMITTED_FOR_REVIEW'], to: 'RETURNED_FOR_CORRECTION', perm: 'draft:review', requiresComment: true, label: 'Return for correction' },
    { action: 'start', from: ['RETURNED_FOR_CORRECTION'], to: 'IN_DRAFTING', perm: 'draft:draft', label: 'Resume drafting' },
    { action: 'mark_reviewed', from: ['SUBMITTED_FOR_REVIEW'], to: 'REVIEWED', perm: 'draft:review', label: 'Mark reviewed' },
    { action: 'send_for_approval', from: ['REVIEWED'], to: 'PENDING_APPROVAL', perm: 'draft:review', label: 'Send for approval' },
    { action: 'approve', from: ['PENDING_APPROVAL'], to: 'APPROVED', perm: 'draft:approve', label: 'Approve' },
    { action: 'escalate_hod', from: ['PENDING_APPROVAL'], to: 'PENDING_HOD_APPROVAL', perm: 'draft:approve', requiresComment: true, label: 'Escalate to HoD' },
    { action: 'hod_approve', from: ['PENDING_HOD_APPROVAL'], to: 'APPROVED', perm: 'draft:approve', label: 'HoD approve' },
    { action: 'return_from_approval', from: ['PENDING_APPROVAL', 'PENDING_HOD_APPROVAL'], to: 'RETURNED_FOR_CORRECTION', perm: 'draft:approve', requiresComment: true, label: 'Return for correction' },
    { action: 'send', from: ['APPROVED'], to: 'SENT_TO_REQUESTER', perm: 'draft:draft', label: 'Send to requester' },
    { action: 'require_follow_up', from: ['SENT_TO_REQUESTER'], to: 'FOLLOW_UP_REQUIRED', perm: 'draft:draft', label: 'Follow-up required' },
    { action: 'close', from: ['SENT_TO_REQUESTER', 'FOLLOW_UP_REQUIRED'], to: 'CLOSED', perm: 'draft:draft', label: 'Attended / close' },
    { action: 'cancel', from: DRAFTING_OPEN, to: 'CANCELLED', perm: 'matter:assign', requiresComment: true, label: 'Cancel' },
    { action: 'reject', from: DRAFTING_OPEN, to: 'REJECTED', perm: 'matter:assign', requiresComment: true, label: 'Reject' },
  ],
};

// ---------------------------------------------------------------- Litigation (defaults; configurable labels)
export const LITIGATION_STATUSES = [
  'PRE_LITIGATION', 'FILED', 'PENDING_HEARING', 'JUDGMENT_DELIVERED', 'APPEAL', 'ENFORCEMENT', 'SETTLED', 'WITHDRAWN', 'CLOSED',
] as const;
export type LitigationStatus = (typeof LITIGATION_STATUSES)[number];
export const LITIGATION_TRANSITIONS: Record<LitigationStatus, LitigationStatus[]> = {
  PRE_LITIGATION: ['FILED', 'SETTLED', 'WITHDRAWN', 'CLOSED'],
  FILED: ['PENDING_HEARING', 'SETTLED', 'WITHDRAWN'],
  PENDING_HEARING: ['JUDGMENT_DELIVERED', 'SETTLED', 'WITHDRAWN'],
  JUDGMENT_DELIVERED: ['APPEAL', 'ENFORCEMENT', 'CLOSED'],
  APPEAL: ['PENDING_HEARING', 'JUDGMENT_DELIVERED', 'SETTLED', 'WITHDRAWN'],
  ENFORCEMENT: ['CLOSED', 'SETTLED'],
  SETTLED: ['CLOSED'],
  WITHDRAWN: ['CLOSED'],
  CLOSED: [],
};
export const LITIGATION_OPEN: LitigationStatus[] = LITIGATION_STATUSES.filter((s) => s !== 'CLOSED');

// ---------------------------------------------------------------- Compliance
export const CHECK_CYCLE_STATUSES = ['ISSUED', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW', 'COMPLETED'] as const;
export type CheckCycleStatus = (typeof CHECK_CYCLE_STATUSES)[number];
export const CHECK_CYCLE_TRANSITIONS: Record<CheckCycleStatus, CheckCycleStatus[]> = {
  ISSUED: ['IN_PROGRESS', 'SUBMITTED'],
  IN_PROGRESS: ['SUBMITTED'],
  SUBMITTED: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['IN_PROGRESS', 'COMPLETED'],
  COMPLETED: [],
};

export const FINDING_STATUSES = ['OPEN', 'ACTION_PLAN_AGREED', 'EVIDENCE_SUBMITTED', 'CLOSED'] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];
export const FINDING_TRANSITIONS: Record<FindingStatus, FindingStatus[]> = {
  OPEN: ['ACTION_PLAN_AGREED'],
  ACTION_PLAN_AGREED: ['EVIDENCE_SUBMITTED'],
  EVIDENCE_SUBMITTED: ['CLOSED', 'ACTION_PLAN_AGREED'],
  CLOSED: [],
};

export const REG_CHANGE_STATUSES = ['IDENTIFIED', 'IMPACT_ASSESSMENT', 'COMMUNICATED', 'IMPLEMENTING', 'IMPLEMENTED'] as const;
export type RegChangeStatus = (typeof REG_CHANGE_STATUSES)[number];

// ---------------------------------------------------------------- Awareness
export const SESSION_STATUSES = ['PLANNED', 'SCHEDULED', 'MATERIALS_READY', 'HELD', 'FEEDBACK_COLLECTED', 'CLOSED', 'CANCELLED', 'POSTPONED'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export const SESSION_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  PLANNED: ['SCHEDULED', 'CANCELLED', 'POSTPONED'],
  SCHEDULED: ['MATERIALS_READY', 'HELD', 'CANCELLED', 'POSTPONED'],
  MATERIALS_READY: ['HELD', 'CANCELLED', 'POSTPONED'],
  HELD: ['FEEDBACK_COLLECTED', 'CLOSED'],
  FEEDBACK_COLLECTED: ['CLOSED'],
  POSTPONED: ['SCHEDULED', 'CANCELLED'],
  CLOSED: [],
  CANCELLED: [],
};

/** Generic check for the simple record-of-transitions machines. */
export function canMove<S extends string>(table: Record<S, S[]>, from: S, to: S): boolean {
  return (table[from] ?? []).includes(to);
}
