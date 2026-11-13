/* eslint-disable no-console */
/**
 * Seed reference data (all environments) and demo data (dev/test only).
 *   SEED_DEMO=true           create demo users and sample records
 *   DEMO_PASSWORD            password for all demo users (dev/test only)
 *   DEMO_TOTP_SECRET         base32 TOTP secret pre-enrolled for demo users (dev/test only)
 * Run as the migration/owner role: it sets app.ctx=system so RLS does not hide rows.
 */
import { PrismaClient, RoleCode, Unit } from '@prisma/client';
import * as argon2 from 'argon2';
import { createCipheriv, randomBytes } from 'node:crypto';
import { DEFAULT_SLA_POLICIES } from '@ldms/shared';

const db = new PrismaClient();

function encrypt(plain: string): string {
  const [entry] = (process.env.FIELD_KEYS ?? '').split(',');
  const [id, b64] = (entry ?? '').split(':');
  const key = Buffer.from(b64 ?? '', 'base64');
  if (!id || key.length !== 32) throw new Error('FIELD_KEYS must be set to seed demo users');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', process.env.FIELD_KEY_ACTIVE ?? id, iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export const DEPARTMENTS: [string, string][] = [
  ['MD', "Managing Director's Office"], ['FIN', 'Finance'], ['HR', 'Human Resources'], ['PROC', 'Procurement'], ['IT', 'Information Technology'],
  ['GEN', 'Generation'], ['DIST', 'Distribution'], ['TRANS', 'Transmission'], ['CS', 'Customer Services'], ['BILL', 'Billing'],
  ['MTR', 'Metering'], ['PLAN', 'Planning & Projects'], ['ENG', 'Engineering'], ['HSE', 'Health, Safety & Environment'], ['FUEL', 'Fuel Management'],
  ['STORE', 'Stores & Logistics'], ['FAC', 'Facilities'], ['AUD', 'Internal Audit'], ['CORP', 'Corporate Affairs'], ['COMM', 'Communications'],
  ['RE', 'Renewable Energy'], ['OPS', 'Outer Islands Operations'], ['FLEET', 'Fleet & Transport'], ['RISK', 'Risk Management'], ['LEGAL', 'Legal Department'],
];

const REQUEST_TYPES: [Unit, string, string, string | null][] = [
  ['DRF', 'CONTRACT', 'New or complex contract / agreement', 'DRF_CONTRACT'],
  ['DRF', 'STANDARD_CONTRACT', 'Standard contract from an approved template', 'DRF_STANDARD_CONTRACT'],
  ['DRF', 'MOU', 'MoU', 'DRF_MOU'],
  ['DRF', 'NDA', 'NDA / confidentiality agreement', 'DRF_NDA'],
  ['DRF', 'LETTER', 'Letter, notice or reply letter', 'DRF_LETTER'],
  ['DRF', 'POLICY', 'Policy or procedure drafting / review', 'DRF_POLICY'],
  ['DRF', 'OPINION', 'Legal opinion', 'DRF_OPINION'],
  ['DRF', 'CONTRACT_REVIEW', 'Review of a contract drafted by the other party', 'DRF_CONTRACT_REVIEW'],
  ['DRF', 'POA', 'Power of Attorney', 'DRF_POA'],
  ['DRF', 'OTHER', 'Other drafting request', 'DRF_OTHER'],
  ['LIT', 'LIT_CASE', 'Court case / dispute', null],
  ['LIT', 'LIT_UPDATE', 'Litigation case update', null],
  ['CMP', 'CMP_QUERY', 'Compliance query', null],
  ['CMP', 'CMP_ITEM', 'Compliance item', null],
  ['AWR', 'AWR_REQUEST', 'Awareness / training request', null],
];

/** Indicative 2026–2027 Maldives public holidays. VERIFY against the official gazette before go-live. */
const HOLIDAYS: [string, string][] = [
  ['2026-01-01', "New Year's Day"], ['2026-03-20', 'Eid al-Fitr (indicative)'], ['2026-03-22', 'Eid al-Fitr holiday (indicative)'],
  ['2026-05-01', 'Labour Day'], ['2026-05-26', 'Hajj Day (indicative)'], ['2026-05-27', 'Eid al-Adha (indicative)'],
  ['2026-05-28', 'Eid al-Adha holiday (indicative)'], ['2026-06-16', 'Islamic New Year (indicative)'], ['2026-07-26', 'Independence Day'],
  ['2026-08-25', 'Prophet Muhammad’s Birthday (indicative)'], ['2026-11-03', 'Victory Day'], ['2026-11-11', 'Republic Day'],
  ['2027-01-01', "New Year's Day"], ['2027-05-01', 'Labour Day'], ['2027-07-26', 'Independence Day'], ['2027-11-03', 'Victory Day'], ['2027-11-11', 'Republic Day'],
];

const TEMPLATES: [string, string, string][] = [
  ['INTAKE_ACK', 'Your request {{reference}}',
    'Dear {{senderName}},\n\nThank you for your request "{{subject}}" received on {{receivedAt}}.\n\nIt has been registered with the {{unit}} under reference {{reference}}. Please quote this reference in any further correspondence. Target date: {{dueDate}}.\n\nKind regards,\nLegal Department\nState Electric Company Limited (STELCO)'],
  ['INFO_REQUEST', 'Information needed for {{reference}}',
    'Dear {{senderName}},\n\nTo continue with {{reference}} we need the following information:\n\n{{details}}\n\nKind regards,\nLegal Department'],
  ['CIRCULAR', 'Legal circular: {{subject}}', '{{body}}\n\nPlease acknowledge receipt in LDMS by {{dueDate}}.'],
];

const DOC_TYPES: [string, string, Unit | null][] = [
  ['EMAIL', 'Original email', null], ['ATTACHMENT', 'Attachment', null], ['CORRESPONDENCE', 'Correspondence', null],
  ['PLEADING', 'Pleading', 'LIT'], ['EVIDENCE', 'Evidence', 'LIT'], ['SUBMISSION', 'Submission', 'LIT'], ['COURT_ORDER', 'Court order', 'LIT'],
  ['JUDGMENT', 'Judgment', 'LIT'], ['ENGAGEMENT_LETTER', 'Engagement letter', 'LIT'], ['INVOICE', 'Counsel invoice', 'LIT'],
  ['DRAFT', 'Draft', 'DRF'], ['SIGNED_CONTRACT', 'Signed contract', 'DRF'], ['OPINION', 'Legal opinion', 'DRF'], ['POA', 'Power of attorney', 'DRF'],
  ['LAW_TEXT', 'Law / regulation text', 'CMP'], ['EVIDENCE_CMP', 'Compliance evidence', 'CMP'], ['SLIDES', 'Presentation', 'AWR'], ['HANDOUT', 'Handout', 'AWR'],
];

async function reference() {
  await db.$executeRaw`SELECT set_config('app.ctx', 'system', false)`;
  for (const [code, name] of DEPARTMENTS) await db.department.upsert({ where: { code }, create: { code, name }, update: {} });
  for (const p of DEFAULT_SLA_POLICIES) await db.slaPolicy.upsert({ where: { code: p.code }, create: { code: p.code, name: p.name, target: p.target, unit: p.unit }, update: {} });
  for (const [unit, code, name, sla] of REQUEST_TYPES) {
    const policy = sla ? await db.slaPolicy.findUnique({ where: { code: sla } }) : null;
    await db.requestType.upsert({ where: { code }, create: { unit, code, name, slaPolicyId: policy?.id }, update: {} });
  }
  for (const [date, name] of HOLIDAYS) await db.holiday.upsert({ where: { date }, create: { date, name }, update: {} });
  for (const [code, subject, body] of TEMPLATES) await db.emailTemplate.upsert({ where: { code }, create: { code, subject, body }, update: {} });
  for (const [code, name, unit] of DOC_TYPES) await db.documentType.upsert({ where: { code }, create: { code, name, unit }, update: {} });
  for (const [recordType, years, trigger] of [['LitigationCase', 10, 'CLOSED_AT'], ['DraftingRequest', 7, 'CLOSED_AT'], ['Contract', 7, 'EXPIRY'], ['Intake', 3, 'CLOSED_AT'], ['AuditLog', 10, 'CREATED_AT']] as const) {
    await db.retentionPolicy.upsert({ where: { recordType }, create: { recordType, years, trigger }, update: {} });
  }
  const lit = ['PRE_LITIGATION', 'FILED', 'PENDING_HEARING', 'JUDGMENT_DELIVERED', 'APPEAL', 'ENFORCEMENT', 'SETTLED', 'WITHDRAWN', 'CLOSED'];
  for (const [i, code] of lit.entries()) {
    await db.statusDefinition.upsert({ where: { unit_code: { unit: 'LIT', code } }, create: { unit: 'LIT', code, label: code.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()), sortOrder: i, isTerminal: code === 'CLOSED' }, update: {} });
  }
  for (const name of ['Civil Court', 'High Court', 'Supreme Court', 'Criminal Court', 'Employment Tribunal', 'Tax Appeal Tribunal', 'Arbitration (MIAC)']) {
    await db.court.upsert({ where: { name }, create: { name, kind: name.includes('Tribunal') ? 'TRIBUNAL' : name.includes('Arbitration') ? 'ARBITRATION' : 'COURT', jurisdiction: 'Maldives' }, update: {} });
  }
  for (const name of ['Utility Regulatory Authority', 'Maldives Inland Revenue Authority', 'Environmental Protection Agency', 'Ministry of Climate Change, Environment and Energy', 'Labour Relations Authority', 'Maldives Monetary Authority']) {
    await db.regulator.upsert({ where: { name }, create: { name }, update: {} });
  }
}

const DEMO_USERS: { username: string; name: string; dept: string; roles: [RoleCode, Unit | null][]; admin?: boolean; expires?: boolean }[] = [
  { username: 'adm.it', name: 'IT Administrator', dept: 'IT', roles: [['SUPER_ADMIN', null]], admin: true },
  { username: 'hod', name: 'Aishath Hassan (HoD)', dept: 'LEGAL', roles: [['HOD', null]] },
  { username: 'uh.lit', name: 'Ibrahim Rasheed', dept: 'LEGAL', roles: [['UNIT_HEAD', 'LIT'], ['LEGAL_OFFICER', 'LIT']] },
  { username: 'uh.cmp', name: 'Mariyam Shifa', dept: 'LEGAL', roles: [['UNIT_HEAD', 'CMP'], ['LEGAL_OFFICER', 'CMP']] },
  { username: 'uh.drf', name: 'Ahmed Nashid', dept: 'LEGAL', roles: [['UNIT_HEAD', 'DRF'], ['LEGAL_OFFICER', 'DRF']] },
  { username: 'uh.awr', name: 'Fathimath Zaha', dept: 'LEGAL', roles: [['UNIT_HEAD', 'AWR'], ['LEGAL_OFFICER', 'AWR']] },
  { username: 'lo.lit1', name: 'Hassan Waheed', dept: 'LEGAL', roles: [['LEGAL_OFFICER', 'LIT']] },
  { username: 'lo.lit2', name: 'Aminath Leena', dept: 'LEGAL', roles: [['LEGAL_OFFICER', 'LIT']] },
  { username: 'lo.drf1', name: 'Mohamed Shiyam', dept: 'LEGAL', roles: [['LEGAL_OFFICER', 'DRF']] },
  { username: 'lo.drf2', name: 'Hawwa Nisha', dept: 'LEGAL', roles: [['LEGAL_OFFICER', 'DRF']] },
  { username: 'lo.cmp1', name: 'Ali Fazeel', dept: 'LEGAL', roles: [['LEGAL_OFFICER', 'CMP']] },
  { username: 'lo.awr1', name: 'Shaheema Ali', dept: 'LEGAL', roles: [['LEGAL_OFFICER', 'AWR']] },
  { username: 'pl.lit', name: 'Yoosuf Naseem', dept: 'LEGAL', roles: [['PARALEGAL', 'LIT']] },
  { username: 'pl.drf', name: 'Rifa Abdulla', dept: 'LEGAL', roles: [['PARALEGAL', 'DRF']] },
  { username: 'req.fin', name: 'Finance Focal Point', dept: 'FIN', roles: [['REQUESTER', null]] },
  { username: 'req.hr', name: 'HR Focal Point', dept: 'HR', roles: [['REQUESTER', null]] },
  { username: 'req.proc', name: 'Procurement Focal Point', dept: 'PROC', roles: [['REQUESTER', null]] },
  { username: 'auditor', name: 'External Auditor', dept: 'AUD', roles: [['AUDITOR', null]], expires: true },
  { username: 'mgmt', name: 'Managing Director', dept: 'MD', roles: [['MGMT_VIEWER', null]] },
];

async function demoUsers() {
  const password = process.env.DEMO_PASSWORD;
  if (!password) throw new Error('DEMO_PASSWORD is required for demo seeding');
  const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: process.env.NODE_ENV === 'test' ? 4096 : 65536, timeCost: process.env.NODE_ENV === 'test' ? 2 : 3, parallelism: 1 });
  const totp = process.env.DEMO_TOTP_SECRET;
  for (const u of DEMO_USERS) {
    const dept = await db.department.findUniqueOrThrow({ where: { code: u.dept } });
    const user = await db.user.upsert({
      where: { username: u.username },
      create: {
        username: u.username, displayName: u.name, email: `${u.username}@demo.stelco.invalid`, departmentId: dept.id, status: 'ACTIVE',
        isAdminAccount: !!u.admin, mustChangePassword: false, accessExpiresAt: u.expires ? new Date(Date.now() + 90 * 86400_000) : null,
        identities: { create: { provider: 'LOCAL', subject: u.username } },
        credential: { create: { passwordHash: hash } },
        roles: { create: u.roles.map(([role, unit]) => ({ role, unit })) },
      },
      update: {},
    });
    if (totp && !(await db.mfaFactor.findFirst({ where: { userId: user.id } }))) {
      await db.mfaFactor.create({ data: { userId: user.id, secretEnc: encrypt(totp), verifiedAt: new Date() } });
    }
  }
  for (const name of ['Shah & Partners LLP', 'Island Legal Associates', 'Male Law Chambers']) {
    const firm = await db.lawFirm.upsert({ where: { name }, create: { name, email: `info@${name.split(' ')[0]!.toLowerCase()}.example` }, update: {} });
    await db.externalLawyer.upsert({ where: { firmId_name: { firmId: firm.id, name: `Senior Counsel (${name.split(' ')[0]})` } }, create: { firmId: firm.id, name: `Senior Counsel (${name.split(' ')[0]})` }, update: {} });
  }
}

export async function seed() {
  await reference();
  if (process.env.SEED_DEMO === 'true') {
    if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
    await demoUsers();
    const demo = await import('./seed-demo').catch(() => null);
    if (demo) { await demo.seedDemo(db); await demo.seedAwareness(db); }
  }
}

if (require.main === module) {
  seed()
    .then(() => console.log('seed complete'))
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => db.$disconnect());
}
