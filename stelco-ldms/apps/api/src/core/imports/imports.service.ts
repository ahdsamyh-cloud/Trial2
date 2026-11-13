import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { currentUser } from '../../common/context';
import { badRequest, forbidden } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AvService } from '../documents/av.service';
import { FileRejected, sniff } from '../documents/filetype';
import { ExportService } from '../export/export.service';
import { PolicyService } from '../policy/policy.service';
import { parseAmount, parseDate } from '../../units/litigation/import.service';

type Kind = 'contracts' | 'laws';
interface FieldDef { key: string; header: string; re: RegExp; required?: boolean }

const FIELDS: Record<Kind, FieldDef[]> = {
  contracts: [
    { key: 'title', header: 'Title', re: /^(title|contract|agreement|name)/i, required: true },
    { key: 'parties', header: 'Parties', re: /part(y|ies)|counterpart/i },
    { key: 'value', header: 'Value', re: /value|amount|price/i },
    { key: 'currency', header: 'Currency', re: /^(currency|ccy)$/i },
    { key: 'startDate', header: 'Start date', re: /start|commence|effective/i },
    { key: 'endDate', header: 'End date', re: /end|expir/i },
    { key: 'autoRenew', header: 'Auto-renew', re: /renew/i },
    { key: 'noticePeriodDays', header: 'Notice period (days)', re: /notice/i },
    { key: 'department', header: 'Owning department', re: /dep(ar)?t|owner/i },
  ],
  laws: [
    { key: 'title', header: 'Title', re: /^(title|name|law)/i, required: true },
    { key: 'type', header: 'Type', re: /^(?:type|.*category)/i },
    { key: 'regulator', header: 'Regulator', re: /regulator|issuer|authority/i },
    { key: 'issuedOn', header: 'Issued on', re: /issu|enact|gazett/i },
    { key: 'effectiveOn', header: 'Effective on', re: /effective|commence/i },
    { key: 'status', header: 'Status', re: /status/i },
    { key: 'sourceUrl', header: 'Source link', re: /source|link|url/i },
    { key: 'summary', header: 'Summary', re: /summary|description|note/i },
  ],
};

/** Register importers (contracts, laws) with dry run. Staff list lives in Awareness; litigation has its own wizard. */
@Injectable()
export class ImportsService {
  constructor(private readonly prisma: PrismaService, private readonly av: AvService, private readonly exporter: ExportService, private readonly audit: AuditService, private readonly policy: PolicyService) {}

  private assert(kind: Kind) {
    const ok = kind === 'contracts' ? this.policy.covers('draft:draft', 'DRF') || this.policy.covers('matter:write', 'DRF') : this.policy.covers('cmp:write', 'CMP');
    if (!ok) throw forbidden();
  }

  template(kind: Kind) {
    this.assert(kind);
    return this.exporter.workbook([{ name: kind, columns: FIELDS[kind].map((f) => ({ key: f.key, header: f.header, width: 22 })), rows: [] }]);
  }

  async run(kind: Kind, file: { originalname: string; buffer: Buffer }, commit: boolean) {
    this.assert(kind);
    try { if (sniff(file.originalname, file.buffer).kind !== 'xlsx') throw badRequest('Upload an Excel workbook (.xlsx)'); } catch (e) { if (e instanceof FileRejected) throw badRequest(e.message); throw e; }
    if ((await this.av.scan(file.buffer)).status !== 'CLEAN') throw badRequest('The file was blocked or could not be scanned');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw badRequest('Empty workbook');
    const headers = (ws.getRow(1).values as unknown[]).slice(1).map((v) => String(v ?? '').trim());
    const map: Record<string, number> = {};
    for (const f of FIELDS[kind]) { const i = headers.findIndex((h, idx) => f.re.test(h) && !Object.values(map).includes(idx)); if (i >= 0) map[f.key] = i; }
    for (const f of FIELDS[kind]) if (f.required && map[f.key] === undefined) throw badRequest(`Column "${f.header}" not found`);
    const depts = await this.prisma.base.department.findMany();
    const regs = await this.prisma.base.regulator.findMany();
    const cell = (row: unknown[], k: string) => { const v = map[k] === undefined ? '' : row[map[k]!]; return v instanceof Date ? v.toISOString().slice(0, 10) : v === null || v === undefined ? '' : typeof v === 'object' && 'text' in (v as object) ? String((v as { text: string }).text) : String(v).trim(); };
    const results: { row: number; errors: string[]; data?: Record<string, unknown> }[] = [];
    for (let r = 2; r <= Math.min(ws.rowCount, 5001); r++) {
      const row = (ws.getRow(r).values as unknown[]).slice(1);
      if (!row.some((v) => v !== null && v !== undefined && String(v).trim())) continue;
      const errors: string[] = [];
      const date = (k: string) => { const d = parseDate(cell(row, k)); if (d === 'invalid') { errors.push(`${k}: "${cell(row, k)}" is not a date`); return null; } return d; };
      let data: Record<string, unknown>;
      if (kind === 'contracts') {
        const amt = parseAmount(cell(row, 'value'));
        if (amt === 'invalid') errors.push(`value: "${cell(row, 'value')}" is not a number`);
        const dept = cell(row, 'department');
        const d = dept ? depts.find((x) => x.name.toLowerCase() === dept.toLowerCase() || x.code.toLowerCase() === dept.toLowerCase()) : null;
        if (dept && !d) errors.push(`Unknown department "${dept}"`);
        const notice = cell(row, 'noticePeriodDays');
        if (notice && !/^\d+$/.test(notice)) errors.push('Notice period must be a whole number of days');
        data = {
          title: cell(row, 'title'), parties: cell(row, 'parties').split(/[;,\n]| v /).map((s) => s.trim()).filter(Boolean), value: amt === 'invalid' ? null : amt.amount,
          currency: (cell(row, 'currency') || (amt !== 'invalid' ? amt.currency : null) || 'MVR').toUpperCase().slice(0, 3), startDate: date('startDate'), endDate: date('endDate'),
          autoRenew: /^(y|yes|true|1)$/i.test(cell(row, 'autoRenew')), noticePeriodDays: notice ? Number(notice) : null, ownerDeptId: d?.id ?? null,
        };
      } else {
        const type = (cell(row, 'type') || 'ACT').toUpperCase();
        if (!['ACT', 'REGULATION', 'CIRCULAR', 'GUIDELINE', 'DIRECTIVE'].includes(type)) errors.push(`Unknown type "${type}"`);
        const regName = cell(row, 'regulator');
        const reg = regName ? regs.find((x) => x.name.toLowerCase() === regName.toLowerCase()) : null;
        if (regName && !reg) errors.push(`Unknown regulator "${regName}"`);
        const status = (cell(row, 'status') || 'IN_FORCE').toUpperCase().replace(/\s+/g, '_');
        if (!['IN_FORCE', 'AMENDED', 'REPEALED'].includes(status)) errors.push(`Unknown status "${status}"`);
        const url = cell(row, 'sourceUrl');
        if (url && !/^https?:\/\//i.test(url)) errors.push('Source link must start with http(s)://');
        data = { title: cell(row, 'title'), type, regulatorId: reg?.id ?? null, issuedOn: date('issuedOn'), effectiveOn: date('effectiveOn'), status, sourceUrl: url || null, summary: cell(row, 'summary') || null };
      }
      if (!data.title) errors.push('Title is missing');
      results.push({ row: r, errors, data: errors.length ? undefined : data });
    }
    const valid = results.filter((r) => !r.errors.length);
    if (commit) {
      for (const r of valid) {
        if (kind === 'contracts') await this.prisma.db.contract.create({ data: r.data as never });
        else {
          const law = await this.prisma.db.law.create({ data: r.data as never });
          await this.prisma.db.lawVersion.create({ data: { lawId: law.id, versionNo: 1, notes: 'Imported' } });
        }
      }
      await this.audit.log({ action: `import.${kind}`, meta: { created: valid.length, by: currentUser().username } });
    }
    return { total: results.length, valid: valid.length, errors: results.filter((r) => r.errors.length).map((r) => ({ row: r.row, errors: r.errors })), committed: commit, columns: Object.keys(map) };
  }
}
