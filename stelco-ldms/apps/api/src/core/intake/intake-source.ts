import { IntakeAdapter, IntakeSourceKind, Priority } from '@prisma/client';
import type { ParsedEmail } from './email-parser';

/** Canonical intake shape. A Phase 8 GraphIntakeSource produces the same shape — no schema change. */
export interface NormalisedIntake {
  adapter: IntakeAdapter;
  source: IntakeSourceKind;
  receivedAt: Date;
  senderName: string;
  senderEmail: string | null;
  senderDeptId: string | null;
  subject: string;
  summary: string | null;
  emailRef: string | null;
  priority: Priority;
  dueDate: Date | null;
  suggestedUnit: 'LIT' | 'CMP' | 'DRF' | 'AWR' | null;
  submittedById: string | null;
  email: (ParsedEmail & { graphMessageId?: string | null }) | null;
}

export interface IntakeSource<I> {
  readonly adapter: IntakeAdapter;
  toIntake(input: I): NormalisedIntake;
}

export interface ManualInput {
  source: IntakeSourceKind;
  receivedAt: Date;
  senderName: string;
  senderEmail?: string | null;
  senderDeptId?: string | null;
  subject: string;
  summary?: string | null;
  emailRef?: string | null;
  priority: Priority;
  dueDate?: Date | null;
  suggestedUnit?: 'LIT' | 'CMP' | 'DRF' | 'AWR' | null;
  email?: ParsedEmail | null;
}

export class ManualIntakeSource implements IntakeSource<ManualInput> {
  readonly adapter = 'MANUAL' as const;
  toIntake(i: ManualInput): NormalisedIntake {
    return {
      adapter: this.adapter, source: i.source, receivedAt: i.receivedAt, senderName: i.senderName, senderEmail: i.senderEmail?.toLowerCase() ?? null,
      senderDeptId: i.senderDeptId ?? null, subject: i.subject, summary: i.summary ?? null,
      emailRef: i.emailRef ?? i.email?.internetMessageId ?? null, priority: i.priority, dueDate: i.dueDate ?? null,
      suggestedUnit: i.suggestedUnit ?? null, submittedById: null, email: i.email ?? null,
    };
  }
}

export interface PortalInput {
  user: { id: string; displayName: string; email: string; departmentId: string | null };
  subject: string;
  summary: string;
  priority: Priority;
  dueDate?: Date | null;
  suggestedUnit?: 'LIT' | 'CMP' | 'DRF' | 'AWR' | null;
}

export class PortalIntakeSource implements IntakeSource<PortalInput> {
  readonly adapter = 'PORTAL' as const;
  toIntake(i: PortalInput): NormalisedIntake {
    return {
      adapter: this.adapter, source: 'PORTAL', receivedAt: new Date(), senderName: i.user.displayName, senderEmail: i.user.email,
      senderDeptId: i.user.departmentId, subject: i.subject, summary: i.summary, emailRef: null, priority: i.priority,
      dueDate: i.dueDate ?? null, suggestedUnit: i.suggestedUnit ?? null, submittedById: i.user.id, email: null,
    };
  }
}
