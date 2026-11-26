import { Injectable, OnModuleInit } from '@nestjs/common';
import ExcelJS from 'exceljs';
import * as QRCode from 'qrcode';
import { canMove, SESSION_TRANSITIONS, SessionStatus, subtractBusinessDays } from '@ldms/shared';
import { CryptoService } from '../../common/crypto.service';
import { ctx, currentUser } from '../../common/context';
import { badRequest, conflict, DomainError, forbidden, notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { hit } from '../../common/rate-limit';
import { config } from '../../config';
import { AuditService } from '../../core/audit/audit.service';
import { CalendarService } from '../../core/calendar/calendar.service';
import { SettingsService } from '../../core/config/settings.service';
import { DocumentsService } from '../../core/documents/documents.service';
import { FileRejected, sniff } from '../../core/documents/filetype';
import { NotificationsService } from '../../core/notifications/notifications.service';
import { PolicyService } from '../../core/policy/policy.service';

export interface SessionInput {
  planItemId?: string | null; title: string; topic: string; format: 'IN_PERSON' | 'ONLINE' | 'ELEARNING' | 'CIRCULAR';
  startsAt: Date; endsAt: Date; venue?: string | null; meetingUrl?: string | null; audienceDeptIds: string[]; presenterIds: string[]; preparerIds: string[];
}

@Injectable()
export class AwarenessService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly calendar: CalendarService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly crypto: CryptoService,
    private readonly documents: DocumentsService,
  ) {}

  onModuleInit() {
    this.documents.registerOwner('session', {
      read: async (id) => { await this.session(id); return {}; },
      write: async (id) => { await this.session(id); this.assertStaff(); },
    });
  }

  private staff() { return this.policy.covers('awr:write', 'AWR') || this.policy.covers('matter:read', 'AWR'); }
  private assertStaff() { if (!this.policy.covers('awr:write', 'AWR')) throw forbidden(); }
  private assertReport() { if (!this.staff() && !currentUser().perms.has('dashboard:hod') && !currentUser().perms.has('dashboard:mgmt')) throw forbidden(); }

  private async session(id: string) {
    const s = await this.prisma.db.awarenessSession.findUnique({ where: { id } });
    if (!s) throw notFound('Session');
    if (!this.staff() && !currentUser().perms.has('report:read')) {
      const dept = currentUser().departmentId;
      if (s.audienceDeptIds.length && (!dept || !s.audienceDeptIds.includes(dept))) throw notFound('Session');
    }
    return s;
  }

  // ------------------------------------------------------------------ annual plan
  async plan(year: number) {
    if (!this.staff()) throw forbidden();
    return this.prisma.db.awarenessPlan.upsert({ where: { year }, create: { year }, update: {}, include: { items: { orderBy: [{ quarter: 'asc' }], include: { sessions: { select: { id: true, title: true, status: true, startsAt: true } } } } } });
  }

  async savePlanItem(id: string | null, data: { year?: number; topic: string; targetDeptIds: string[]; quarter: number; status?: string }) {
    this.assertStaff();
    let planId: string | undefined;
    if (!id) planId = (await this.prisma.db.awarenessPlan.upsert({ where: { year: data.year! }, create: { year: data.year! }, update: {} })).id;
    const { year: _y, ...rest } = data;
    const row = id ? await this.prisma.db.planItem.update({ where: { id }, data: rest }) : await this.prisma.db.planItem.create({ data: { ...rest, planId: planId! } });
    await this.audit.log({ action: id ? 'awr.plan.updated' : 'awr.plan.added', entityType: 'PlanItem', entityId: row.id, after: row });
    return row;
  }

  async approvePlan(year: number) {
    const u = currentUser();
    if (!u.isHod && !u.roles.some((r) => r.role === 'UNIT_HEAD' && r.unit === 'AWR')) throw forbidden('Only the Awareness Unit Head or HoD can approve the plan');
    const p = await this.prisma.db.awarenessPlan.update({ where: { year }, data: { status: 'APPROVED' } });
    await this.audit.log({ action: 'awr.plan.approved', entityType: 'AwarenessPlan', entityId: p.id });
    return p;
  }

  // ------------------------------------------------------------------ sessions
  async sessions(f: { from?: Date; to?: Date; status?: string }) {
    const u = currentUser();
    const dept = u.departmentId;
    return this.prisma.db.awarenessSession.findMany({
      where: {
        ...(f.status ? { status: f.status } : {}), ...(f.from || f.to ? { startsAt: { gte: f.from, lte: f.to } } : {}),
        ...(this.staff() || u.perms.has('report:read') ? {} : { OR: [{ audienceDeptIds: { isEmpty: true } }, ...(dept ? [{ audienceDeptIds: { has: dept } }] : [])] }),
      },
      include: { _count: { select: { attendance: true, feedback: true } } }, orderBy: { startsAt: 'desc' }, take: 500,
    });
  }

  async get(id: string) {
    const s = await this.session(id);
    const staff = this.staff();
    const full = await this.prisma.db.awarenessSession.findUniqueOrThrow({
      where: { id },
      include: { planItem: true, attendance: staff ? { include: { employee: { include: { department: { select: { name: true } } } } }, orderBy: { checkedInAt: 'asc' } } : false, quiz: staff, feedback: staff ? { select: { rating: true, comments: true, quizScore: true, createdAt: true } } : false },
    });
    const people = await this.prisma.base.user.findMany({ where: { id: { in: [...s.presenterIds, ...s.preparerIds] } }, select: { id: true, displayName: true } });
    const ratings = (full.feedback ?? []).map((f) => f.rating);
    return {
      ...full, checkinSecret: undefined,
      presenters: people.filter((p) => s.presenterIds.includes(p.id)), preparers: people.filter((p) => s.preparerIds.includes(p.id)),
      feedbackAvg: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
      materialsDueAt: subtractBusinessDays(s.startsAt, 5, await this.settings.calendar()),
    };
  }

  async save(id: string | null, data: SessionInput) {
    this.assertStaff();
    if (data.endsAt <= data.startsAt) throw badRequest('The session must end after it starts');
    for (const u of [...data.presenterIds, ...data.preparerIds]) {
      const exists = await this.prisma.base.user.count({ where: { id: u, status: 'ACTIVE' } });
      if (!exists) throw badRequest('Unknown presenter or preparer');
    }
    const before = id ? await this.session(id) : null;
    const row = id
      ? await this.prisma.db.awarenessSession.update({ where: { id }, data: { ...data, status: before!.status === 'PLANNED' && data.presenterIds.length ? 'SCHEDULED' : before!.status } })
      : await this.prisma.db.awarenessSession.create({ data: { ...data, status: data.presenterIds.length ? 'SCHEDULED' : 'PLANNED' } });
    const cal = await this.settings.calendar();
    await this.calendar.upsert({ kind: 'SESSION', unit: 'AWR', title: `Awareness session: ${row.title}`, sourceType: 'AwarenessSession', sourceId: row.id, startsAt: row.startsAt, endsAt: row.endsAt, ownerId: row.presenterIds[0] ?? null, location: row.venue ?? row.meetingUrl ?? null });
    await this.calendar.upsert({ kind: 'DEADLINE', unit: 'AWR', title: `Materials due: ${row.title}`, sourceType: 'AwarenessMaterials', sourceId: row.id, startsAt: subtractBusinessDays(row.startsAt, 5, cal), allDay: true, ownerId: row.preparerIds[0] ?? row.presenterIds[0] ?? null });
    const newPeople = [...row.presenterIds, ...row.preparerIds].filter((p) => !before || (!before.presenterIds.includes(p) && !before.preparerIds.includes(p)));
    await this.notifications.notify(newPeople, { type: 'awr.assigned', title: `You are presenting/preparing "${row.title}" on ${row.startsAt.toISOString().slice(0, 10)}`, link: `/awareness/sessions/${row.id}` });
    await this.audit.log({ action: id ? 'awr.session.updated' : 'awr.session.created', entityType: 'AwarenessSession', entityId: row.id, before, after: row });
    return row;
  }

  async setStatus(id: string, to: SessionStatus) {
    this.assertStaff();
    const s = await this.session(id);
    if (!canMove(SESSION_TRANSITIONS, s.status as SessionStatus, to)) throw conflict(`A session cannot move from ${s.status} to ${to}`);
    if (to === 'MATERIALS_READY' && !(await this.prisma.db.document.count({ where: { sessionId: id, deletedAt: null } }))) throw badRequest('Upload the presentation materials first');
    await this.prisma.db.awarenessSession.update({ where: { id }, data: { status: to } });
    if (to === 'MATERIALS_READY') await this.calendar.cancel('AwarenessMaterials', id);
    if (to === 'CANCELLED') await this.calendar.cancel('AwarenessSession', id);
    if (to === 'HELD' && s.planItemId) await this.prisma.db.planItem.update({ where: { id: s.planItemId }, data: { status: 'DONE' } });
    await this.audit.log({ action: 'awr.session.status', entityType: 'AwarenessSession', entityId: id, before: { status: s.status }, after: { status: to } });
    return { ok: true };
  }

  // ------------------------------------------------------------------ attendance
  async addAttendance(id: string, employeeIds: string[]) {
    this.assertStaff();
    await this.session(id);
    const r = await this.prisma.db.attendance.createMany({ data: employeeIds.map((employeeId) => ({ sessionId: id, employeeId, method: 'MANUAL' })), skipDuplicates: true });
    await this.audit.log({ action: 'awr.attendance.manual', entityType: 'AwarenessSession', entityId: id, meta: { added: r.count } });
    return { added: r.count };
  }

  async removeAttendance(id: string, employeeId: string) {
    this.assertStaff();
    await this.prisma.db.attendance.deleteMany({ where: { sessionId: id, employeeId } });
    await this.audit.log({ action: 'awr.attendance.removed', entityType: 'AwarenessSession', entityId: id, meta: { employeeId } });
    return { ok: true };
  }

  private async readSheet(file: { originalname: string; buffer: Buffer }) {
    try { if (sniff(file.originalname, file.buffer).kind !== 'xlsx') throw badRequest('Upload an Excel workbook (.xlsx)'); } catch (e) { if (e instanceof FileRejected) throw badRequest(e.message); throw e; }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw badRequest('Empty workbook');
    const headers = (ws.getRow(1).values as unknown[]).slice(1).map((v) => String(v ?? '').trim().toLowerCase());
    const rows: Record<string, string>[] = [];
    for (let r = 2; r <= Math.min(ws.rowCount, 10001); r++) {
      const vals = (ws.getRow(r).values as unknown[]).slice(1);
      const row: Record<string, string> = {};
      headers.forEach((h, i) => { const v = vals[i]; row[h] = v === null || v === undefined ? '' : typeof v === 'object' && 'text' in (v as object) ? String((v as { text: string }).text) : String(v).trim(); });
      if (Object.values(row).some(Boolean)) rows.push(row);
    }
    return { headers, rows };
  }

  /** Excel attendance list: a column "Staff No" (or "Staff number" / "Employee ID"). */
  async importAttendance(id: string, file: { originalname: string; buffer: Buffer }) {
    this.assertStaff();
    await this.session(id);
    const { headers, rows } = await this.readSheet(file);
    const col = headers.find((h) => /staff\s*(no|number|#)|employee\s*(id|no)/.test(h));
    if (!col) throw badRequest('The sheet needs a "Staff No" column');
    const nos = rows.map((r) => r[col]!).filter(Boolean);
    const emps = await this.prisma.db.employee.findMany({ where: { staffNo: { in: nos } } });
    const unknown = nos.filter((n) => !emps.some((e) => e.staffNo === n));
    const r = await this.prisma.db.attendance.createMany({ data: emps.map((e) => ({ sessionId: id, employeeId: e.id, method: 'IMPORT' })), skipDuplicates: true });
    await this.audit.log({ action: 'awr.attendance.import', entityType: 'AwarenessSession', entityId: id, meta: { added: r.count, unknown: unknown.length } });
    return { added: r.count, unknown };
  }

  // ------------------------------------------------------------------ QR self check-in (staff without accounts)
  /** Opens check-in: returns a signed link + QR. Valid from 1 h before the start to 2 h after the end. */
  async checkinLink(id: string) {
    this.assertStaff();
    const s = await this.session(id);
    const secret = s.checkinSecret ?? this.crypto.randomToken(16);
    if (!s.checkinSecret) await this.prisma.db.awarenessSession.update({ where: { id }, data: { checkinSecret: secret } });
    const ttl = Math.max(60, Math.floor((s.endsAt.getTime() + 2 * 3600_000 - Date.now()) / 1000));
    const token = this.crypto.sign({ s: id, k: this.crypto.sha256(secret).slice(0, 16) }, ttl);
    const url = `${config().APP_ORIGIN}/checkin/${token}`;
    await this.audit.log({ action: 'awr.checkin.opened', entityType: 'AwarenessSession', entityId: id });
    return { url, qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 320 }) };
  }

  async closeCheckin(id: string) {
    this.assertStaff();
    await this.prisma.db.awarenessSession.update({ where: { id }, data: { checkinSecret: null } });
    await this.audit.log({ action: 'awr.checkin.closed', entityType: 'AwarenessSession', entityId: id });
    return { ok: true };
  }

  private async fromToken(token: string) {
    const data = this.crypto.verify<{ s: string; k: string }>(token);
    if (!data) throw notFound('Check-in link');
    const s = await this.prisma.base.awarenessSession.findUnique({ where: { id: data.s } });
    if (!s || !s.checkinSecret || this.crypto.sha256(s.checkinSecret).slice(0, 16) !== data.k) throw notFound('Check-in link');
    if (Date.now() < s.startsAt.getTime() - 3600_000) throw new DomainError(400, 'Check-in opens one hour before the session starts');
    return s;
  }

  /** Public: what session is this link for? (title and time only). */
  async checkinInfo(token: string) {
    const s = await this.fromToken(token);
    const quiz = await this.prisma.base.quizQuestion.findMany({ where: { sessionId: s.id }, select: { id: true, question: true, options: true } });
    return { title: s.title, startsAt: s.startsAt, endsAt: s.endsAt, venue: s.venue, quiz };
  }

  /** Public: check in with a staff number. Rate-limited; never reveals whether a staff number exists. */
  async checkin(token: string, staffNo: string) {
    if (!(await hit(`checkin:${ctx().ip}`, 30, 300))) throw new DomainError(429, 'Too many attempts. Please wait a few minutes.');
    const s = await this.fromToken(token);
    const emp = await this.prisma.base.employee.findFirst({ where: { staffNo: staffNo.trim(), active: true } });
    if (!emp) throw badRequest('Check your staff number and try again');
    await this.prisma.base.attendance.upsert({ where: { sessionId_employeeId: { sessionId: s.id, employeeId: emp.id } }, create: { sessionId: s.id, employeeId: emp.id, method: 'QR' }, update: {} });
    await this.audit.log({ action: 'awr.checkin.qr', entityType: 'AwarenessSession', entityId: s.id, actorId: emp.userId, actorName: `staff:${emp.staffNo}` });
    return { ok: true, name: emp.name.split(' ')[0] };
  }

  /** Public: anonymous feedback (rating, comments, optional quiz). */
  async feedback(token: string, input: { rating: number; comments?: string; answers?: Record<string, number> }) {
    if (!(await hit(`feedback:${ctx().ip}`, 20, 600))) throw new DomainError(429, 'Too many submissions.');
    const s = await this.fromToken(token);
    const quiz = await this.prisma.base.quizQuestion.findMany({ where: { sessionId: s.id } });
    const quizScore = quiz.length && input.answers ? Math.round((quiz.filter((q) => input.answers![q.id] === q.answer).length / quiz.length) * 100) : null;
    await this.prisma.base.feedbackResponse.create({ data: { sessionId: s.id, rating: input.rating, comments: input.comments?.slice(0, 2000) ?? null, quizScore } });
    return { ok: true, quizScore };
  }

  async saveQuiz(id: string, questions: { question: string; options: string[]; answer: number }[]) {
    this.assertStaff();
    await this.session(id);
    for (const q of questions) if (q.answer < 0 || q.answer >= q.options.length) throw badRequest('Each question needs a valid correct answer');
    await this.prisma.tx(async (tx) => {
      await tx.quizQuestion.deleteMany({ where: { sessionId: id } });
      await tx.quizQuestion.createMany({ data: questions.map((q) => ({ sessionId: id, ...q })) });
    });
    await this.audit.log({ action: 'awr.quiz.saved', entityType: 'AwarenessSession', entityId: id, meta: { questions: questions.length } });
    return { ok: true };
  }

  // ------------------------------------------------------------------ employees & training records
  async employees(q?: string, departmentId?: string) {
    if (!this.staff()) throw forbidden();
    return this.prisma.db.employee.findMany({
      where: { ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { staffNo: { contains: q } }] } : {}), ...(departmentId ? { departmentId } : {}) },
      include: { department: { select: { name: true } } }, orderBy: { name: 'asc' }, take: 500,
    });
  }

  /** HR staff list import (Excel: Staff No, Name, Department). Dry-run unless commit=true. */
  async importEmployees(file: { originalname: string; buffer: Buffer }, commit: boolean) {
    this.assertStaff();
    const { headers, rows } = await this.readSheet(file);
    const c = (re: RegExp) => headers.find((h) => re.test(h));
    const noCol = c(/staff\s*(no|number|#)|employee\s*(id|no)/);
    const nameCol = c(/^(name|full\s*name|employee\s*name)/);
    const deptCol = c(/dep(ar)?t/);
    if (!noCol || !nameCol) throw badRequest('The sheet needs "Staff No" and "Name" columns');
    const depts = await this.prisma.base.department.findMany();
    const result = rows.map((r, i) => {
      const errors: string[] = [];
      const staffNo = r[noCol]!.trim();
      const name = r[nameCol]!.trim();
      const deptName = deptCol ? r[deptCol]!.trim() : '';
      const dept = deptName ? depts.find((d) => d.name.toLowerCase() === deptName.toLowerCase() || d.code.toLowerCase() === deptName.toLowerCase()) : null;
      if (!staffNo) errors.push('Staff number missing');
      if (!name) errors.push('Name missing');
      if (deptName && !dept) errors.push(`Unknown department "${deptName}"`);
      return { row: i + 2, staffNo, name, departmentId: dept?.id ?? null, errors };
    });
    const ok = result.filter((r) => !r.errors.length);
    if (commit) {
      for (const r of ok) await this.prisma.db.employee.upsert({ where: { staffNo: r.staffNo }, create: { staffNo: r.staffNo, name: r.name, departmentId: r.departmentId }, update: { name: r.name, departmentId: r.departmentId } });
      await this.audit.log({ action: 'awr.employees.imported', meta: { upserted: ok.length } });
    }
    return { total: result.length, valid: ok.length, errors: result.filter((r) => r.errors.length), committed: commit };
  }

  async history(employeeId: string) {
    if (!this.staff()) throw forbidden();
    const e = await this.prisma.db.employee.findUnique({ where: { id: employeeId }, include: { department: true, attendance: { include: { session: { select: { id: true, title: true, topic: true, startsAt: true, format: true } } }, orderBy: { checkedInAt: 'desc' } } } });
    if (!e) throw notFound('Employee');
    const presented = e.userId ? await this.prisma.db.awarenessSession.findMany({ where: { OR: [{ presenterIds: { has: e.userId } }, { preparerIds: { has: e.userId } }] }, select: { id: true, title: true, startsAt: true, presenterIds: true } }) : [];
    return { ...e, presented: presented.map((p) => ({ ...p, role: p.presenterIds.includes(e.userId!) ? 'PRESENTER' : 'PREPARER', presenterIds: undefined })) };
  }

  // ------------------------------------------------------------------ bulletins & FAQ
  bulletins() {
    const u = currentUser();
    return this.prisma.db.bulletin.findMany({
      where: this.staff() ? {} : { publishedAt: { not: null }, OR: [{ audienceDeptIds: { isEmpty: true } }, ...(u.departmentId ? [{ audienceDeptIds: { has: u.departmentId } }] : [])] },
      orderBy: [{ publishedAt: { sort: 'desc', nulls: 'first' } }], take: 200,
    });
  }

  async saveBulletin(id: string | null, data: { title: string; body: string; kind: string; audienceDeptIds: string[] }) {
    this.assertStaff();
    const row = id ? await this.prisma.db.bulletin.update({ where: { id }, data }) : await this.prisma.db.bulletin.create({ data: { ...data, createdById: currentUser().id } });
    await this.audit.log({ action: id ? 'awr.bulletin.updated' : 'awr.bulletin.created', entityType: 'Bulletin', entityId: row.id });
    return row;
  }

  async publishBulletin(id: string) {
    this.assertStaff();
    const b = await this.prisma.db.bulletin.update({ where: { id }, data: { publishedAt: new Date() } });
    const recipients = b.audienceDeptIds.length
      ? (await this.prisma.base.user.findMany({ where: { departmentId: { in: b.audienceDeptIds }, status: 'ACTIVE', isAdminAccount: false }, select: { id: true } })).map((u) => u.id)
      : (await this.prisma.base.user.findMany({ where: { status: 'ACTIVE', isAdminAccount: false }, select: { id: true } })).map((u) => u.id);
    await this.notifications.notify(recipients, { type: 'awr.bulletin', title: `${b.kind === 'CIRCULAR' ? 'Legal circular' : 'Legal bulletin'}: ${b.title}`, link: '/knowledge' });
    await this.audit.log({ action: 'awr.bulletin.published', entityType: 'Bulletin', entityId: id, meta: { recipients: recipients.length } });
    return b;
  }

  faq(q?: string) {
    return this.prisma.db.faqEntry.findMany({
      where: { ...(this.staff() ? {} : { published: true }), ...(q ? { OR: [{ question: { contains: q, mode: 'insensitive' } }, { answer: { contains: q, mode: 'insensitive' } }] } : {}) },
      orderBy: { question: 'asc' },
    });
  }

  async saveFaq(id: string | null, data: { question: string; answer: string; tags: string[]; published: boolean }) {
    this.assertStaff();
    const row = id ? await this.prisma.db.faqEntry.update({ where: { id }, data }) : await this.prisma.db.faqEntry.create({ data });
    await this.audit.log({ action: id ? 'awr.faq.updated' : 'awr.faq.created', entityType: 'FaqEntry', entityId: row.id });
    return row;
  }

  // ------------------------------------------------------------------ reports
  async report(year: number) {
    this.assertReport();
    const from = new Date(Date.UTC(year, 0, 1) - 5 * 3600_000);
    const to = new Date(Date.UTC(year + 1, 0, 1) - 5 * 3600_000);
    const [plan, sessions, depts, employees] = await Promise.all([
      this.prisma.db.awarenessPlan.findUnique({ where: { year }, include: { items: true } }),
      this.prisma.db.awarenessSession.findMany({ where: { startsAt: { gte: from, lt: to } }, include: { attendance: { include: { employee: { select: { departmentId: true } } } }, feedback: { select: { rating: true } } } }),
      this.prisma.base.department.findMany({ select: { id: true, name: true } }),
      this.prisma.db.employee.groupBy({ by: ['departmentId'], where: { active: true }, _count: true }),
    ]);
    const held = sessions.filter((s) => ['HELD', 'FEEDBACK_COLLECTED', 'CLOSED'].includes(s.status));
    const quarter = (d: Date) => Math.floor(new Date(d.getTime() + 5 * 3600_000).getUTCMonth() / 3) + 1;
    const byQuarter = [1, 2, 3, 4].map((q) => ({ quarter: q, planned: plan?.items.filter((i) => i.quarter === q).length ?? 0, held: held.filter((s) => quarter(s.startsAt) === q).length }));
    const attendedBy = new Map<string, Set<string>>();
    for (const s of held) for (const a of s.attendance) {
      const d = a.employee.departmentId ?? 'none';
      if (!attendedBy.has(d)) attendedBy.set(d, new Set());
      attendedBy.get(d)!.add(a.employeeId);
    }
    const coverage = depts.map((d) => {
      const staff = employees.find((e) => e.departmentId === d.id)?._count ?? 0;
      const reached = attendedBy.get(d.id)?.size ?? 0;
      return { department: d.name, staff, reached, percent: staff ? Math.round((reached / staff) * 100) : null };
    }).filter((c) => c.staff || c.reached);
    const ratings = held.flatMap((s) => s.feedback.map((f) => f.rating));
    const presenterCounts = new Map<string, number>();
    for (const s of held) for (const p of s.presenterIds) presenterCounts.set(p, (presenterCounts.get(p) ?? 0) + 1);
    const names = await this.prisma.base.user.findMany({ where: { id: { in: [...presenterCounts.keys()] } }, select: { id: true, displayName: true } });
    return {
      year, planned: plan?.items.length ?? 0, held: held.length, byQuarter, coverage,
      averageFeedback: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
      attendance: held.reduce((n, s) => n + s.attendance.length, 0),
      presenters: [...presenterCounts.entries()].map(([id, sessions]) => ({ name: names.find((n) => n.id === id)?.displayName ?? '', sessions })).sort((a, b) => b.sessions - a.sessions),
    };
  }
}
