import { Injectable } from '@nestjs/common';
import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from 'pdf-lib';
import { Prisma, Unit } from '@prisma/client';
import { UNIT_NAMES, UNITS } from '@ldms/shared';
import { CryptoService } from '../../common/crypto.service';
import { currentUser, runAsSystem } from '../../common/context';
import { badRequest, forbidden } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ExportService } from '../export/export.service';
import { PolicyService } from '../policy/policy.service';
import { SecurityAlerts } from '../notifications/security-alerts.service';

type Row = [string, string | number];
interface Section { title: string; rows: Row[] }
export interface ManagementReport { title: string; period: string; from: Date; to: Date; generatedAt: Date; sections: Section[] }

/** Monthly / annual management report (PDF + Excel). Aggregates only; scope follows the caller. */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly crypto: CryptoService,
    private readonly exporter: ExportService,
    private readonly audit: AuditService,
    private readonly alerts: SecurityAlerts,
  ) {}

  private range(kind: 'monthly' | 'annual', period: string) {
    const m = kind === 'monthly' ? /^(\d{4})-(\d{2})$/.exec(period) : /^(\d{4})$/.exec(period);
    if (!m) throw badRequest(kind === 'monthly' ? 'Period must look like 2026-11' : 'Period must look like 2026');
    const y = Number(m[1]);
    const mo = kind === 'monthly' ? Number(m[2]) - 1 : 0;
    const from = new Date(Date.UTC(y, mo, 1) - 5 * 3600_000);
    const to = new Date((kind === 'monthly' ? Date.UTC(y, mo + 1, 1) : Date.UTC(y + 1, 0, 1)) - 5 * 3600_000);
    return { from, to };
  }

  async build(kind: 'monthly' | 'annual', period: string): Promise<ManagementReport> {
    const user = currentUser();
    const grant = user.perms.get('report:read');
    if (!grant) throw forbidden();
    const { from, to } = this.range(kind, period);
    const units: Unit[] = grant.scope === 'UNIT' ? (grant.units as Unit[]) : [...UNITS];
    const aggregateOnly = grant.scope === 'AGG';
    const scope: Prisma.MatterWhereInput = aggregateOnly ? {} : this.policy.matterScope('matter:read');
    const compute = async () => {
      const inUnits: Prisma.MatterWhereInput = { AND: [scope, { unit: { in: units } }] };
      const sections: Section[] = [];
      const overview: Row[] = [];
      for (const u of units) {
        const [opened, closed, openAtEnd] = await Promise.all([
          this.prisma.db.matter.count({ where: { AND: [inUnits, { unit: u, createdAt: { gte: from, lt: to } }] } }),
          this.prisma.db.matter.count({ where: { AND: [inUnits, { unit: u, closedAt: { gte: from, lt: to } }] } }),
          this.prisma.db.matter.count({ where: { AND: [inUnits, { unit: u, createdAt: { lt: to } }, { OR: [{ closedAt: null }, { closedAt: { gte: to } }] }] } }),
        ]);
        overview.push([`${UNIT_NAMES[u]} — opened`, opened], [`${UNIT_NAMES[u]} — closed`, closed], [`${UNIT_NAMES[u]} — open at period end`, openAtEnd]);
      }
      sections.push({ title: 'Workload', rows: overview });

      const clocks = await this.prisma.db.slaClock.findMany({ where: { stoppedAt: { gte: from, lt: to }, matter: inUnits }, select: { breachedAt: true, stoppedAt: true, dueAt: true } });
      const met = clocks.filter((c) => !c.breachedAt && c.stoppedAt! <= c.dueAt).length;
      sections.push({ title: 'Service levels', rows: [['SLA steps completed', clocks.length], ['Completed on time', met], ['On-time rate', clocks.length ? `${Math.round((met / clocks.length) * 100)}%` : '—'], ['Open breaches now', await this.prisma.db.slaClock.count({ where: { breachedAt: { not: null }, stoppedAt: null, matter: inUnits } })]] });

      if (units.includes('LIT')) {
        const litScope = { AND: [inUnits, { unit: 'LIT' as Unit }] };
        const [newCases, hearings, summaries, judgments, open] = await Promise.all([
          this.prisma.db.matter.count({ where: { AND: [litScope, { createdAt: { gte: from, lt: to } }] } }),
          this.prisma.db.hearing.count({ where: { startsAt: { gte: from, lt: to }, case: { matter: litScope } } }),
          this.prisma.db.hearing.count({ where: { summaryEnteredAt: { gte: from, lt: to }, case: { matter: litScope } } }),
          this.prisma.db.outcome.count({ where: { decidedOn: { gte: from, lt: to }, case: { matter: litScope } } }),
          this.prisma.db.litigationCase.findMany({ where: { matter: { AND: [litScope, { closedAt: null }] } }, select: { risk: true, currency: true, exposureEnc: true } }),
        ]);
        const rows: Row[] = [['New cases', newCases], ['Hearings held', hearings], ['Hearing summaries entered', summaries], ['Judgments / settlements', judgments], ['Open cases', open.length]];
        const exp = new Map<string, number>();
        for (const c of open) { const k = `Exposure ${c.currency} — ${(c.risk ?? 'unassessed').toLowerCase()}`; exp.set(k, (exp.get(k) ?? 0) + Number(this.crypto.decrypt(c.exposureEnc) ?? 0)); }
        for (const [k, v] of [...exp.entries()].sort()) rows.push([k, v.toLocaleString('en-US')]);
        sections.push({ title: 'Litigation', rows });
      }
      if (units.includes('DRF')) {
        const drf = { AND: [inUnits, { unit: 'DRF' as Unit }] };
        const types = await this.prisma.db.matter.groupBy({ by: ['requestTypeId'], where: { AND: [drf, { createdAt: { gte: from, lt: to } }] }, _count: true });
        const names = await this.prisma.base.requestType.findMany({ where: { id: { in: types.map((t) => t.requestTypeId).filter((x): x is string => !!x) } } });
        const approvals = await this.prisma.db.approval.groupBy({ by: ['level', 'decision'], where: { at: { gte: from, lt: to }, request: { matter: drf } }, _count: true });
        sections.push({ title: 'Drafting', rows: [
          ...types.map((t): Row => [`Requests — ${names.find((n) => n.id === t.requestTypeId)?.name ?? 'Other'}`, t._count]),
          ...approvals.map((a): Row => [`${a.level === 'HOD' ? 'HoD' : 'Unit Head'} — ${a.decision.toLowerCase()}`, a._count]),
        ] });
      }
      if (units.includes('CMP')) {
        const [rated, findingsOpened, findingsClosed, acks, ackTotal] = await Promise.all([
          this.prisma.db.checkItem.findMany({ where: { rating: { not: null }, cycle: { completedAt: { gte: from, lt: to } } }, select: { rating: true } }),
          this.prisma.db.finding.count({ where: { createdAt: { gte: from, lt: to } } }),
          this.prisma.db.finding.count({ where: { closedAt: { gte: from, lt: to } } }),
          this.prisma.db.disseminationRecipient.count({ where: { acknowledgedAt: { not: null }, dissemination: { sentAt: { gte: from, lt: to } } } }),
          this.prisma.db.disseminationRecipient.count({ where: { dissemination: { sentAt: { gte: from, lt: to } } } }),
        ]);
        const r = rated.filter((x) => x.rating !== 'NA');
        const score = r.length ? Math.round((r.reduce((n, x) => n + (x.rating === 'COMPLIANT' ? 1 : x.rating === 'PARTIAL' ? 0.5 : 0), 0) / r.length) * 100) : null;
        sections.push({ title: 'Compliance', rows: [['Items rated', rated.length], ['Compliance score', score === null ? '—' : `${score}%`], ['Findings opened', findingsOpened], ['Findings closed', findingsClosed], ['Circular acknowledgements', `${acks} / ${ackTotal}`]] });
      }
      if (units.includes('AWR')) {
        const sessions = await this.prisma.db.awarenessSession.findMany({ where: { startsAt: { gte: from, lt: to }, status: { in: ['HELD', 'FEEDBACK_COLLECTED', 'CLOSED'] } }, include: { _count: { select: { attendance: true } }, feedback: { select: { rating: true } } } });
        const ratings = sessions.flatMap((s) => s.feedback.map((f) => f.rating));
        sections.push({ title: 'Awareness', rows: [['Sessions held', sessions.length], ['Attendances', sessions.reduce((n, s) => n + s._count.attendance, 0)], ['Average feedback (1–5)', ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : '—']] });
      }
      return sections;
    };
    const sections = aggregateOnly ? await runAsSystem(compute) : await compute();
    return { title: `Legal Department ${kind === 'monthly' ? 'monthly' : 'annual'} management report`, period, from, to, generatedAt: new Date(), sections };
  }

  async xlsx(r: ManagementReport): Promise<Buffer> {
    return this.exporter.workbook(r.sections.map((s) => ({ name: s.title, columns: [{ key: 'k', header: 'Measure', width: 48 }, { key: 'v', header: r.period, width: 20 }], rows: s.rows.map(([k, v]) => ({ k, v })) })));
  }

  async pdf(r: ManagementReport): Promise<Buffer> {
    const doc = await PDFDocument.create();
    doc.setTitle(`${r.title} ${r.period}`);
    doc.setProducer('STELCO LDMS');
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    let page = doc.addPage([595, 842]);
    let y = 790;
    const text = (p: PDFPage, s: string, x: number, yy: number, size: number, f: PDFFont, color = rgb(0.1, 0.1, 0.1)) => p.drawText(s.replace(/[^\x20-\x7E]/g, '-'), { x, y: yy, size, font: f, color });
    text(page, 'STELCO — Legal Department', 50, y, 10, font, rgb(0.07, 0.29, 0.56));
    y -= 22;
    text(page, r.title, 50, y, 16, bold);
    y -= 18;
    text(page, `Period: ${r.period}    Generated: ${r.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`, 50, y, 9, font, rgb(0.4, 0.4, 0.4));
    y -= 24;
    for (const s of r.sections) {
      if (y < 120) { page = doc.addPage([595, 842]); y = 790; }
      page.drawRectangle({ x: 45, y: y - 4, width: 505, height: 18, color: rgb(0.93, 0.96, 1) });
      text(page, s.title, 50, y, 11, bold, rgb(0.07, 0.29, 0.56));
      y -= 20;
      for (const [k, v] of s.rows) {
        if (y < 60) { page = doc.addPage([595, 842]); y = 790; }
        text(page, k.slice(0, 80), 55, y, 9.5, font);
        const val = String(v);
        text(page, val, 545 - font.widthOfTextAtSize(val, 9.5), y, 9.5, bold);
        page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: 545, y: y - 4 }, thickness: 0.3, color: rgb(0.85, 0.85, 0.85) });
        y -= 16;
      }
      y -= 10;
    }
    const pages = doc.getPages();
    pages.forEach((p, i) => text(p, `Confidential — internal use · page ${i + 1} of ${pages.length}`, 50, 30, 8, font, rgb(0.5, 0.5, 0.5)));
    return Buffer.from(await doc.save());
  }

  async logExport(kind: string, period: string, format: string) {
    const u = currentUser();
    await this.audit.log({ action: 'report.management', meta: { kind, period, format } });
    await this.alerts.onExport(u.id, u.username, 0);
  }
}
