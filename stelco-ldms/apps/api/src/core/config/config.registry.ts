import { z, ZodTypeAny } from 'zod';
import { UNITS } from '@ldms/shared';

export interface ConfigEntity {
  model: string;
  schema: ZodTypeAny;
  orderBy: Record<string, 'asc' | 'desc'>;
  searchFields: string[];
  /** Readable by requesters (portal needs departments / request types) */
  publicRead?: boolean;
}

const unit = z.enum(UNITS);
const name = z.string().trim().min(1).max(200);

/** Admin-maintained reference data (PLAN §5.8). Every change is audited. */
export const CONFIG_ENTITIES: Record<string, ConfigEntity> = {
  departments: { model: 'department', orderBy: { name: 'asc' }, searchFields: ['name', 'code'], publicRead: true,
    schema: z.object({ code: z.string().trim().min(1).max(20).regex(/^[A-Z0-9_-]+$/), name, active: z.boolean().default(true) }).strict() },
  holidays: { model: 'holiday', orderBy: { date: 'asc' }, searchFields: ['name', 'date'],
    schema: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), name }).strict() },
  'sla-policies': { model: 'slaPolicy', orderBy: { code: 'asc' }, searchFields: ['name', 'code'],
    schema: z.object({ code: z.string().trim().min(1).max(40).regex(/^[A-Z0-9_]+$/), name, target: z.number().int().min(0).max(365), unit: z.enum(['BUSINESS', 'CALENDAR']), urgentHalves: z.boolean().default(true), active: z.boolean().default(true) }).strict() },
  'request-types': { model: 'requestType', orderBy: { name: 'asc' }, searchFields: ['name', 'code'], publicRead: true,
    schema: z.object({ unit, code: z.string().trim().min(1).max(40).regex(/^[A-Z0-9_]+$/), name, slaPolicyId: z.string().max(40).nullish(), active: z.boolean().default(true) }).strict() },
  'status-definitions': { model: 'statusDefinition', orderBy: { sortOrder: 'asc' }, searchFields: ['label', 'code'],
    schema: z.object({ unit, code: z.string().trim().min(1).max(40), label: name, sortOrder: z.number().int(), isTerminal: z.boolean().default(false) }).strict() },
  'email-templates': { model: 'emailTemplate', orderBy: { code: 'asc' }, searchFields: ['code', 'subject'],
    schema: z.object({ code: z.string().trim().min(1).max(40).regex(/^[A-Z0-9_]+$/), subject: name, body: z.string().max(10000) }).strict() },
  'document-types': { model: 'documentType', orderBy: { name: 'asc' }, searchFields: ['name', 'code'],
    schema: z.object({ code: z.string().trim().min(1).max(40).regex(/^[A-Z0-9_]+$/), name, unit: unit.nullish() }).strict() },
  'law-firms': { model: 'lawFirm', orderBy: { name: 'asc' }, searchFields: ['name'],
    schema: z.object({ name, address: z.string().max(500).nullish(), phone: z.string().max(40).nullish(), email: z.string().email().max(200).nullish(), active: z.boolean().default(true) }).strict() },
  'external-lawyers': { model: 'externalLawyer', orderBy: { name: 'asc' }, searchFields: ['name'],
    schema: z.object({ firmId: z.string().min(1).max(40), name, email: z.string().email().max(200).nullish(), phone: z.string().max(40).nullish() }).strict() },
  regulators: { model: 'regulator', orderBy: { name: 'asc' }, searchFields: ['name'],
    schema: z.object({ name, website: z.string().url().max(300).nullish() }).strict() },
  courts: { model: 'court', orderBy: { name: 'asc' }, searchFields: ['name'],
    schema: z.object({ name, kind: z.enum(['COURT', 'TRIBUNAL', 'ARBITRATION']).default('COURT'), jurisdiction: z.string().max(200).nullish() }).strict() },
  'retention-policies': { model: 'retentionPolicy', orderBy: { recordType: 'asc' }, searchFields: ['recordType'],
    schema: z.object({ recordType: z.string().trim().min(1).max(60), years: z.number().int().min(1).max(100), trigger: z.string().max(40) }).strict() },
};

/** Known system settings with their value schemas. */
export const SETTINGS: Record<string, ZodTypeAny> = {
  'calendar.workdays': z.array(z.number().int().min(0).max(6)).min(1).max(7),
  'calendar.cutoffMinutes': z.number().int().min(0).max(1439),
  'reminders.offsetsDays': z.array(z.number().int().min(0).max(365)).max(10),
  'litigation.noUpdateDays': z.number().int().min(1).max(365),
  'drafting.hodRules': z.object({ enabled: z.boolean(), minContractValue: z.number().nullable(), restricted: z.boolean(), requestTypeCodes: z.array(z.string()) }),
  'documents.watermarkPdf': z.boolean(),
  'intake.ackTemplateCode': z.string().max(40),
  'encryption.fields': z.array(z.string()),
};

export const SETTING_DEFAULTS: Record<string, unknown> = {
  'calendar.workdays': [0, 1, 2, 3, 4],
  'calendar.cutoffMinutes': 960,
  'reminders.offsetsDays': [30, 14, 7, 1, 0],
  'litigation.noUpdateDays': 30,
  'drafting.hodRules': { enabled: false, minContractValue: null, restricted: false, requestTypeCodes: [] },
  'documents.watermarkPdf': false,
  'intake.ackTemplateCode': 'INTAKE_ACK',
  'encryption.fields': ['Outcome.amount', 'LitigationCase.exposure', 'Matter.description(restricted)', 'Comment.body(restricted)', 'MfaFactor.secret'],
};
