import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { LitigationStatus } from '@ldms/shared';
import { currentUser } from '../../common/context';
import { badRequest, conflict, forbidden, notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../core/audit/audit.service';
import { AvService } from '../../core/documents/av.service';
import { FileRejected, sniff } from '../../core/documents/filetype';
import { StorageService } from '../../core/documents/storage.service';
import { ExportService } from '../../core/export/export.service';
import { PolicyService } from '../../core/policy/policy.service';
import { LitigationService } from './litigation.service';

/** App fields a register column can map to. */
export const LIT_FIELDS = {
  courtCaseNo: { label: 'Case no. (court)', required: true },
  title: { label: 'Title / subject', required: false },
  court: { label: 'Court / forum', required: true },
  parties: { label: 'Parties (e.g. "STELCO v ABC Pvt Ltd")', required: false },
  subject: { label: 'Subject matter', required: false },
  externalLawyer: { label: 'External lawyer / law firm', required: false },
  filingDate: { label: 'Filing date', required: false },
  nextHearing: { label: 'Next hearing', required: false },
  status: { label: 'Status', required: false },
  claimAmount: { label: 'Claim amount', required: false },
  currency: { label: 'Currency', required: false },
  caseType: { label: 'Case type', required: false },
  ourRole: { label: 'Our role', required: false },
  department: { label: 'Related department', required: false },
  remarks: { label: 'Remarks', required: false },
} as const;
export type LitField = keyof typeof LIT_FIELDS;

const SYNONYMS: Record<LitField, RegExp> = {
  courtCaseNo: /^(case\s*(no|number|#)|court\s*case|suit\s*no)/i,
  title: /^(title|case\s*title|matter)$/i,
  court: /^(court|forum|tribunal)/i,
  parties: /^(?:part(?:y|ies)|.*\bversus\b|.*\bvs\b)/i,
  subject: /^(subject|nature|description)/i,
  externalLawyer: /(lawyer|counsel|law\s*firm|advocate|attorney)/i,
  filingDate: /(fil(ing|ed)\s*date|date\s*(of\s*)?fil)/i,
  nextHearing: /next\s*hearing/i,
  status: /^(?:status|.*stage)/i,
  claimAmount: /(claim|amount|value)/i,
  currency: /^(currency|ccy)$/i,
  caseType: /(case\s*type|type\s*of\s*case|category)/i,
  ourRole: /(our\s*role|stelco\s*(is|as)|role)/i,
  department: /(department|dept|division)/i,
  remarks: /(remark|note|comment)/i,
};

export interface ImportOptions { createMissing: boolean; defaultCurrency: string }

interface RowPlan {
  rowNo: number;
  raw: Record<string, string>;
  values: Partial<Record<LitField, string>>;
  errors: string[];
  warnings: string[];
  action: 'CREATE' | 'DUPLICATE' | 'ERROR';
  parsed?: {
    courtCaseNo: string; title: string; court: string; parties: { name: string; side: string }[]; subject: string | null; firm: string | null; lawyer: string | null;
    filingDate: Date | null; nextHearing: Date | null; status: LitigationStatus; claimAmount: string | null; currency: string; caseType: string; ourRole: string;
    department: string | null; remarks: string | null;
  };
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if ('result' in v && v.result !== undefined) return cellText(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return String(v.text);
    return '';
  }
  return String(v).trim();
}

/** Accepts ISO, dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy, "12 Mar 2025", Excel serials. Local (UTC+5) dates. */
export function parseDate(s: string): Date | null | 'invalid' {
  const v = s.trim();
  if (!v || /^(n\/?a|-|tbc|tba|none)$/i.test(v)) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) { const d = new Date(v); return Number.isNaN(d.getTime()) ? 'invalid' : d; }
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (m) return mk(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(v);
  if (m) return mk(+m[3]! < 100 ? 2000 + +m[3]! : +m[3]!, +m[2]!, +m[1]!);
  m = /^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s-,]*(\d{4})$/.exec(v);
  if (m) {
    const mon = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2]!.slice(0, 3).toLowerCase());
    if (mon >= 0) return mk(+m[3]!, mon + 1, +m[1]!);
  }
  if (/^\d{5}(\.\d+)?$/.test(v)) { const d = new Date(Math.round((Number(v) - 25569) * 86400_000)); return mk(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
  return 'invalid';
  function mk(y: number, mo: number, d: number): Date | 'invalid' {
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1950 || y > 2100) return 'invalid';
    const dt = new Date(Date.UTC(y, mo - 1, d, 4, 0)); // 09:00 MVT
    return dt.getUTCDate() === d ? dt : 'invalid';
  }
}

export function parseAmount(s: string): { amount: string | null; currency: string | null } | 'invalid' {
  const v = s.trim();
  if (!v || /^(n\/?a|-|nil|none)$/i.test(v)) return { amount: null, currency: null };
  const cur = /\b(MVR|USD|EUR|GBP|Rf|\$)\b|\$/i.exec(v)?.[0];
  const n = v.replace(/[^\d.\-]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(n)) return 'invalid';
  const currency = cur ? (cur === '$' || /usd/i.test(cur) ? 'USD' : /rf|mvr/i.test(cur) ? 'MVR' : cur.toUpperCase()) : null;
  return { amount: Number(n).toFixed(2), currency };
}

export function mapStatus(s: string): LitigationStatus | null {
  const v = s.toLowerCase();
  if (!v) return null;
  if (/settle/.test(v)) return 'SETTLED';
  if (/withdr/.test(v)) return 'WITHDRAWN';
  if (/clos|dispos|dismiss|concluded/.test(v)) return 'CLOSED';
  if (/enforce|execution/.test(v)) return 'ENFORCEMENT';
  if (/appeal/.test(v)) return 'APPEAL';
  if (/judg|decided|verdict|award/.test(v)) return 'JUDGMENT_DELIVERED';
  if (/hear|pending|ongoing|active|trial/.test(v)) return 'PENDING_HEARING';
  if (/fil|submitted|registered/.test(v)) return 'FILED';
  if (/notice|pre/.test(v)) return 'PRE_LITIGATION';
  return null;
}

function mapCaseType(s: string) {
  const v = s.toLowerCase();
  if (/labou?r|employ/.test(v)) return 'LABOUR';
  if (/commerc|contract/.test(v)) return 'COMMERCIAL';
  if (/crim/.test(v)) return 'CRIMINAL';
  if (/regul|tax/.test(v)) return 'REGULATORY';
  if (/arbitr/.test(v)) return 'ARBITRATION';
  if (/civil/.test(v)) return 'CIVIL';
  return v ? 'OTHER' : 'CIVIL';
}

function mapRole(s: string, parties: string) {
  const v = s.toLowerCase();
  if (/plaint|claim|applic|petition/.test(v)) return 'PLAINTIFF';
  if (/third/.test(v)) return 'THIRD_PARTY';
  if (/defend|respond/.test(v)) return 'DEFENDANT';
  const p = parties.toLowerCase();
  if (/^(?:stelco|state electric)/.test(p)) return 'PLAINTIFF';
  return 'DEFENDANT';
}

function splitParties(s: string): { name: string; side: string }[] {
  if (!s) return [];
  const parts = s.split(/\s+(?:v\.?|vs\.?|versus)\s+/i);
  if (parts.length === 2) return [{ name: parts[0]!.trim(), side: 'PLAINTIFF' }, { name: parts[1]!.trim(), side: 'DEFENDANT' }];
  return s.split(/[;\n]/).map((x) => ({ name: x.trim(), side: 'OTHER' })).filter((x) => x.name);
}

@Injectable()
export class LitigationImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly av: AvService,
    private readonly lit: LitigationService,
    private readonly audit: AuditService,
    private readonly exporter: ExportService,
    private readonly policy: PolicyService,
  ) {}

  private assertCanImport() {
    if (!this.policy.covers('lit:import', 'LIT')) throw forbidden();
  }

  private async readSheet(buf: Buffer): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw badRequest('The workbook has no sheets');
    if (ws.rowCount > 5001) throw badRequest('Import up to 5,000 rows at a time');
    let headerRow = 1;
    for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
      const vals = (ws.getRow(r).values as ExcelJS.CellValue[]).slice(1).map(cellText).filter(Boolean);
      if (vals.length >= 3) { headerRow = r; break; }
    }
    const headers = (ws.getRow(headerRow).values as ExcelJS.CellValue[]).slice(1).map((v, i) => cellText(v) || `Column ${i + 1}`);
    const rows: Record<string, string>[] = [];
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const vals = (ws.getRow(r).values as ExcelJS.CellValue[]).slice(1);
      const row: Record<string, string> = {};
      let any = false;
      headers.forEach((h, i) => { const t = cellText(vals[i] ?? null); row[h] = t; if (t) any = true; });
      if (any) rows.push(row);
    }
    return { headers, rows };
  }

  /** Step 1: upload. The file is type-checked, virus-scanned and stored; headers are returned with a suggested mapping. */
  async upload(file: { originalname: string; buffer: Buffer }) {
    this.assertCanImport();
    try {
      if (sniff(file.originalname, file.buffer).kind !== 'xlsx') throw badRequest('Upload an Excel workbook (.xlsx)');
    } catch (e) {
      if (e instanceof FileRejected) throw badRequest(e.message);
      throw e;
    }
    const scan = await this.av.scan(file.buffer);
    if (scan.status !== 'CLEAN') throw badRequest(scan.status === 'INFECTED' ? 'The file was blocked by the virus scanner' : 'The virus scanner is unavailable. Try again later.');
    const { headers, rows } = await this.readSheet(file.buffer);
    const key = `imports/${randomUUID()}`;
    await this.storage.put('clean', key, file.buffer);
    const batch = await this.prisma.db.importBatch.create({ data: { kind: 'LITIGATION', filename: file.originalname.slice(0, 200), storageKey: key, headers, createdById: currentUser().id } });
    const suggested: Partial<Record<LitField, string>> = {};
    for (const f of Object.keys(LIT_FIELDS) as LitField[]) {
      const h = headers.find((x) => SYNONYMS[f].test(x) && !Object.values(suggested).includes(x));
      if (h) suggested[f] = h;
    }
    const mappings = await this.prisma.db.importMapping.findMany({ where: { kind: 'LITIGATION' } });
    await this.audit.log({ action: 'import.uploaded', entityType: 'ImportBatch', entityId: batch.id, meta: { filename: batch.filename, rows: rows.length } });
    return { batchId: batch.id, headers, rowCount: rows.length, sample: rows.slice(0, 5), suggested, savedMappings: mappings, fields: LIT_FIELDS };
  }

  async saveMapping(name: string, columnMap: Partial<Record<LitField, string>>) {
    this.assertCanImport();
    const m = await this.prisma.db.importMapping.upsert({ where: { kind_name: { kind: 'LITIGATION', name } }, create: { kind: 'LITIGATION', name, columnMap }, update: { columnMap } });
    await this.audit.log({ action: 'import.mapping.saved', entityType: 'ImportMapping', entityId: m.id });
    return m;
  }

  private async batch(id: string) {
    const b = await this.prisma.db.importBatch.findUnique({ where: { id } });
    if (!b || b.kind !== 'LITIGATION') throw notFound('Import');
    return b;
  }

  /** Step 2: dry run. Nothing is created; each row gets CREATE / DUPLICATE / ERROR with reasons. */
  async preview(batchId: string, columnMap: Partial<Record<LitField, string>>, options: ImportOptions) {
    this.assertCanImport();
    const b = await this.batch(batchId);
    if (b.status === 'COMMITTED' || b.status === 'ROLLED_BACK') throw conflict('This import has already been committed');
    for (const [f, meta] of Object.entries(LIT_FIELDS)) if (meta.required && !columnMap[f as LitField]) throw badRequest(`Map a column to "${meta.label}"`);
    const { rows } = await this.readSheet(await this.storage.get('clean', b.storageKey));
    const [courts, firms, depts, existing] = await Promise.all([
      this.prisma.base.court.findMany(), this.prisma.base.lawFirm.findMany({ include: { lawyers: true } }), this.prisma.base.department.findMany(),
      this.prisma.base.litigationCase.findMany({ where: { courtCaseNo: { not: null } }, select: { courtCaseNo: true } }),
    ]);
    const existingNos = new Set(existing.map((e) => e.courtCaseNo!.toLowerCase().replace(/\s+/g, '')));
    const seen = new Map<string, number>();
    const unknown = { courts: new Set<string>(), firms: new Set<string>(), departments: new Set<string>() };
    const plans: RowPlan[] = rows.map((raw, i) => {
      const rowNo = i + 2;
      const values = Object.fromEntries((Object.keys(LIT_FIELDS) as LitField[]).map((f) => [f, columnMap[f] ? raw[columnMap[f]!] ?? '' : ''])) as Record<LitField, string>;
      const errors: string[] = [];
      const warnings: string[] = [];
      const caseNo = values.courtCaseNo.trim();
      if (!caseNo) errors.push('Case number is missing');
      if (!values.court.trim()) errors.push('Court is missing');
      const fd = parseDate(values.filingDate);
      if (fd === 'invalid') errors.push(`Filing date "${values.filingDate}" is not a valid date`);
      const nh = parseDate(values.nextHearing);
      if (nh === 'invalid') errors.push(`Next hearing "${values.nextHearing}" is not a valid date`);
      const amt = parseAmount(values.claimAmount);
      if (amt === 'invalid') errors.push(`Claim amount "${values.claimAmount}" is not a number`);
      const status = mapStatus(values.status) ?? 'PENDING_HEARING';
      if (values.status && !mapStatus(values.status)) warnings.push(`Status "${values.status}" not recognised — set to Pending hearing`);
      const court = values.court.trim();
      if (court && !courts.some((c) => c.name.toLowerCase() === court.toLowerCase())) {
        unknown.courts.add(court);
        if (!options.createMissing) errors.push(`Unknown court "${court}"`); else warnings.push(`Court "${court}" will be created`);
      }
      const [firmName, lawyerName] = values.externalLawyer.includes(' - ') ? values.externalLawyer.split(' - ').map((s) => s.trim()) : [values.externalLawyer.trim(), null];
      if (firmName && !firms.some((f) => f.name.toLowerCase() === firmName.toLowerCase())) {
        unknown.firms.add(firmName);
        if (!options.createMissing) errors.push(`Unknown law firm "${firmName}"`); else warnings.push(`Law firm "${firmName}" will be created`);
      }
      const dept = values.department.trim();
      if (dept && !depts.some((d) => d.name.toLowerCase() === dept.toLowerCase() || d.code.toLowerCase() === dept.toLowerCase())) {
        unknown.departments.add(dept);
        if (!options.createMissing) errors.push(`Unknown department "${dept}"`); else warnings.push(`Department "${dept}" will be created`);
      }
      const norm = caseNo.toLowerCase().replace(/\s+/g, '');
      let action: RowPlan['action'] = errors.length ? 'ERROR' : 'CREATE';
      if (!errors.length && norm && existingNos.has(norm)) { action = 'DUPLICATE'; warnings.push('A case with this number already exists — row will be skipped'); }
      if (!errors.length && norm && seen.has(norm)) { action = 'DUPLICATE'; warnings.push(`Same case number as row ${seen.get(norm)} — row will be skipped`); }
      if (norm && !seen.has(norm)) seen.set(norm, rowNo);
      const parties = splitParties(values.parties);
      const plan: RowPlan = { rowNo, raw, values, errors, warnings, action };
      if (action !== 'ERROR') {
        plan.parsed = {
          courtCaseNo: caseNo, court, parties, subject: values.subject || null, firm: firmName || null, lawyer: lawyerName,
          title: (values.title || values.subject || values.parties || caseNo).slice(0, 300),
          filingDate: fd instanceof Date ? fd : null, nextHearing: nh instanceof Date ? nh : null, status,
          claimAmount: amt === 'invalid' ? null : amt.amount, currency: (values.currency || (amt !== 'invalid' ? amt.currency : null) || options.defaultCurrency).toUpperCase().slice(0, 3),
          caseType: mapCaseType(values.caseType), ourRole: mapRole(values.ourRole, values.parties), department: dept || null, remarks: values.remarks || null,
        };
      }
      return plan;
    });
    await this.prisma.tx(async (tx) => {
      await tx.importRow.deleteMany({ where: { batchId } });
      await tx.importRow.createMany({ data: plans.map((p) => ({ batchId, rowNo: p.rowNo, raw: p.raw, errors: p.errors, warnings: p.warnings, action: p.action })) });
      await tx.importBatch.update({ where: { id: batchId }, data: { status: 'PREVIEWED', columnMap, options: { ...options }, stats: this.stats(plans) } });
    });
    return {
      batchId, stats: this.stats(plans),
      unknown: { courts: [...unknown.courts], firms: [...unknown.firms], departments: [...unknown.departments] },
      rows: plans.map((p) => ({ rowNo: p.rowNo, action: p.action, errors: p.errors, warnings: p.warnings, caseNo: p.values.courtCaseNo, court: p.values.court, title: p.parsed?.title ?? '' })),
    };
  }

  private stats(plans: RowPlan[]) {
    return { total: plans.length, create: plans.filter((p) => p.action === 'CREATE').length, duplicate: plans.filter((p) => p.action === 'DUPLICATE').length, error: plans.filter((p) => p.action === 'ERROR').length };
  }

  /** Step 3: create the cases. Rows with errors or duplicates are skipped. Every case is tagged with the batch. */
  async commit(batchId: string) {
    this.assertCanImport();
    const b = await this.batch(batchId);
    if (b.status !== 'PREVIEWED') throw conflict('Run the preview before importing');
    const preview = await this.preview(batchId, b.columnMap as Partial<Record<LitField, string>>, b.options as unknown as ImportOptions);
    const { rows } = await this.readSheet(await this.storage.get('clean', b.storageKey));
    const map = b.columnMap as Partial<Record<LitField, string>>;
    const opts = b.options as unknown as ImportOptions;
    let created = 0;
    const createdRefs = { courts: 0, firms: 0, departments: 0 };
    for (const r of preview.rows.filter((x) => x.action === 'CREATE')) {
      const raw = rows[r.rowNo - 2]!;
      const re = await this.planOne(raw, map, opts);
      if (!re) continue;
      const ids = await this.ensureReference(re.court, re.firm, re.lawyer, re.department, createdRefs);
      const m = await this.prisma.tx(async (tx) => {
        const matter = await this.lit.createInTx(tx, {
          title: re.title, courtCaseNo: re.courtCaseNo, courtId: ids.courtId, caseType: re.caseType, ourRole: re.ourRole, subject: re.subject,
          externalFirmId: ids.firmId, externalLawyerId: ids.lawyerId, claimAmount: re.claimAmount, currency: re.currency, filingDate: re.filingDate,
          remarks: re.remarks, requestingDeptId: ids.departmentId, status: re.status, parties: re.parties, importBatchId: batchId,
        });
        await tx.importRow.updateMany({ where: { batchId, rowNo: r.rowNo }, data: { entityId: matter.id } });
        return matter;
      });
      if (re.nextHearing && re.nextHearing > new Date(Date.now() - 86400_000)) await this.lit.addHearing(m.id, { startsAt: re.nextHearing, courtId: ids.courtId });
      created++;
    }
    await this.prisma.db.importBatch.update({ where: { id: batchId }, data: { status: 'COMMITTED', committedAt: new Date(), stats: { ...preview.stats, created, createdReference: createdRefs } } });
    await this.audit.log({ action: 'import.committed', entityType: 'ImportBatch', entityId: batchId, meta: { created, ...createdRefs } });
    return { created, skipped: preview.stats.total - created, createdReference: createdRefs };
  }

  private async planOne(raw: Record<string, string>, map: Partial<Record<LitField, string>>, opts: ImportOptions) {
    const v = (f: LitField) => (map[f] ? raw[map[f]!] ?? '' : '');
    const fd = parseDate(v('filingDate'));
    const nh = parseDate(v('nextHearing'));
    const amt = parseAmount(v('claimAmount'));
    const [firm, lawyer] = v('externalLawyer').includes(' - ') ? v('externalLawyer').split(' - ').map((s) => s.trim()) : [v('externalLawyer').trim(), null];
    return {
      courtCaseNo: v('courtCaseNo').trim(), court: v('court').trim(), parties: splitParties(v('parties')), subject: v('subject') || null, firm: firm || null, lawyer: lawyer ?? null,
      title: (v('title') || v('subject') || v('parties') || v('courtCaseNo')).slice(0, 300),
      filingDate: fd instanceof Date ? fd : null, nextHearing: nh instanceof Date ? nh : null, status: mapStatus(v('status')) ?? 'PENDING_HEARING',
      claimAmount: amt === 'invalid' ? null : amt.amount, currency: (v('currency') || (amt !== 'invalid' ? amt.currency : null) || opts.defaultCurrency).toUpperCase().slice(0, 3),
      caseType: mapCaseType(v('caseType')), ourRole: mapRole(v('ourRole'), v('parties')), department: v('department').trim() || null, remarks: v('remarks') || null,
    } as NonNullable<RowPlan['parsed']>;
  }

  private async ensureReference(court: string, firm: string | null, lawyer: string | null, dept: string | null, counter: { courts: number; firms: number; departments: number }) {
    const db = this.prisma.base;
    let c = await db.court.findFirst({ where: { name: { equals: court, mode: 'insensitive' } } });
    if (!c) { c = await db.court.create({ data: { name: court.slice(0, 200) } }); counter.courts++; await this.audit.log({ action: 'config.create', entityType: 'court', entityId: c.id, meta: { via: 'import' } }); }
    let firmId: string | null = null;
    let lawyerId: string | null = null;
    if (firm) {
      let f = await db.lawFirm.findFirst({ where: { name: { equals: firm, mode: 'insensitive' } } });
      if (!f) { f = await db.lawFirm.create({ data: { name: firm.slice(0, 200) } }); counter.firms++; await this.audit.log({ action: 'config.create', entityType: 'lawFirm', entityId: f.id, meta: { via: 'import' } }); }
      firmId = f.id;
      if (lawyer) lawyerId = (await db.externalLawyer.upsert({ where: { firmId_name: { firmId: f.id, name: lawyer.slice(0, 200) } }, create: { firmId: f.id, name: lawyer.slice(0, 200) }, update: {} })).id;
    }
    let departmentId: string | null = null;
    if (dept) {
      let d = await db.department.findFirst({ where: { OR: [{ name: { equals: dept, mode: 'insensitive' } }, { code: { equals: dept, mode: 'insensitive' } }] } });
      if (!d) { d = await db.department.create({ data: { name: dept.slice(0, 200), code: dept.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12) || `D${Date.now() % 100000}` } }); counter.departments++; }
      departmentId = d.id;
    }
    return { courtId: c.id, firmId, lawyerId, departmentId };
  }

  /** Remove every case created by a batch (unless edited by hand or under legal hold). */
  async rollback(batchId: string, reason: string) {
    if (!this.policy.covers('lit:import.rollback', 'LIT')) throw forbidden('Only the Litigation Unit Head or HoD can roll back an import');
    const b = await this.batch(batchId);
    if (b.status !== 'COMMITTED') throw conflict('Only committed imports can be rolled back');
    const matters = await this.prisma.db.matter.findMany({ where: { importBatchId: batchId } });
    const blocked = matters.filter((m) => m.legalHold);
    if (blocked.length) throw conflict(`${blocked.length} imported case(s) are under legal hold; release the hold first`);
    const ids = matters.map((m) => m.id);
    await this.prisma.tx(async (tx) => {
      await tx.calendarEvent.deleteMany({ where: { matterId: { in: ids } } });
      await tx.document.deleteMany({ where: { matterId: { in: ids } } });
      await tx.matter.deleteMany({ where: { id: { in: ids } } });
      await tx.importBatch.update({ where: { id: batchId }, data: { status: 'ROLLED_BACK', rolledBackAt: new Date() } });
    }, { timeout: 120_000 });
    await this.audit.log({ action: 'import.rolled-back', entityType: 'ImportBatch', entityId: batchId, meta: { removed: ids.length, reason } });
    return { removed: ids.length };
  }

  /** Downloadable error report: the original rows plus an Errors column, ready to fix and re-upload. */
  async errorReport(batchId: string) {
    this.assertCanImport();
    const b = await this.batch(batchId);
    const rows = await this.prisma.db.importRow.findMany({ where: { batchId, OR: [{ action: 'ERROR' }, { action: 'DUPLICATE' }] }, orderBy: { rowNo: 'asc' } });
    const columns = [{ key: '__row', header: 'Row' }, ...b.headers.map((h) => ({ key: h, header: h })), { key: '__errors', header: 'Errors / warnings', width: 60 }];
    return this.exporter.workbook([{ name: 'Rows to fix', columns, rows: rows.map((r) => ({ ...(r.raw as Record<string, string>), __row: r.rowNo, __errors: [...r.errors, ...r.warnings].join('; ') })) }]);
  }

  async list() {
    this.assertCanImport();
    return this.prisma.db.importBatch.findMany({ where: { kind: 'LITIGATION' }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, filename: true, status: true, stats: true, createdAt: true, committedAt: true, rolledBackAt: true } });
  }

  /** Sample register with the typical columns (until STELCO's real headers are provided). */
  async template() {
    const cols = ['Case No.', 'Court', 'Parties', 'Subject', 'External Lawyer', 'Filing Date', 'Next Hearing', 'Status', 'Claim Amount', 'Remarks'].map((h) => ({ key: h, header: h, width: 22 }));
    return this.exporter.workbook([{ name: 'Litigation register', columns: cols, rows: [
      { 'Case No.': 'CV-2024-1123', Court: 'Civil Court', Parties: 'ABC Pvt Ltd v STELCO', Subject: 'Unpaid invoices for cable supply', 'External Lawyer': 'Shah & Partners LLP - Senior Counsel (Shah)', 'Filing Date': '14/03/2024', 'Next Hearing': '20/12/2026', Status: 'Pending hearing', 'Claim Amount': 'MVR 1,250,000', Remarks: '' },
      { 'Case No.': 'EMP-2025-0042', Court: 'Employment Tribunal', Parties: 'A. Ibrahim v STELCO', Subject: 'Unfair dismissal claim', 'External Lawyer': 'Island Legal Associates', 'Filing Date': '2025-06-02', 'Next Hearing': '', Status: 'Filed', 'Claim Amount': '85000', Remarks: 'Mediation proposed' },
    ] }]);
  }
}
