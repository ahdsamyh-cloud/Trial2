import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import { currentUser } from '../../common/context';
import { AuditService } from '../audit/audit.service';
import { SecurityAlerts } from '../notifications/security-alerts.service';

export interface Column<T> {
  key: string;
  header: string;
  value?: (row: T) => unknown;
  width?: number;
}

/** Cells starting with these characters could be read as formulas by Excel (CSV/formula injection). */
export function safeCell(v: unknown): unknown {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

@Injectable()
export class ExportService {
  constructor(private readonly audit: AuditService, private readonly alerts: SecurityAlerts) {}

  async workbook<T>(sheets: { name: string; columns: Column<T>[]; rows: T[] }[]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'STELCO LDMS';
    wb.created = new Date();
    for (const s of sheets) {
      const ws = wb.addWorksheet(s.name.slice(0, 31));
      ws.columns = s.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? Math.max(12, c.header.length + 4) }));
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      for (const r of s.rows) {
        ws.addRow(Object.fromEntries(s.columns.map((c) => [c.key, safeCell(c.value ? c.value(r) : (r as Record<string, unknown>)[c.key])])));
      }
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /** Send an xlsx list export, audit-logged and checked for mass-export alerts. */
  async send<T>(res: Response, name: string, columns: Column<T>[], rows: T[], meta: Record<string, unknown> = {}) {
    const buf = await this.workbook([{ name, columns, rows }]);
    const user = currentUser();
    await this.audit.log({ action: 'export.list', entityType: name, meta: { rows: rows.length, ...meta } });
    await this.alerts.onExport(user.id, user.username, rows.length);
    const filename = `${name.replace(/[^a-z0-9-]+/gi, '-')}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.end(buf);
  }
}
