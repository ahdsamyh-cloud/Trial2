import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { currentUser } from '../../common/context';
import { badRequest, forbidden, notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../core/audit/audit.service';
import { CalendarService } from '../../core/calendar/calendar.service';
import { DocumentsService } from '../../core/documents/documents.service';
import { StorageService } from '../../core/documents/storage.service';
import { JobsService } from '../../core/jobs/jobs.service';
import { NotificationsService } from '../../core/notifications/notifications.service';
import { PolicyService } from '../../core/policy/policy.service';

const DAY = 86400_000;

/** Template & clause library, contract repository, PoA register, legal opinions register. */
@Injectable()
export class RegistersService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly calendar: CalendarService,
    private readonly documents: DocumentsService,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  onModuleInit() {
    this.jobs.register('drf.expiry-scan', () => this.expiryScan());
    const unitRead = async () => { if (!this.policy.covers('matter:read', 'DRF') && !this.policy.covers('doc:read', 'DRF')) throw notFound('Record'); return {}; };
    const unitWrite = async () => { if (!this.policy.covers('draft:draft', 'DRF') && !this.policy.covers('matter:write', 'DRF')) throw forbidden(); };
    this.documents.registerOwner('contract', { read: async (id) => { await this.contract(id); return unitRead(); }, write: async (id) => { await this.contract(id); return unitWrite(); } });
    this.documents.registerOwner('template', {
      read: async (id) => { await this.template(id); return {}; },
      write: async (id) => { await this.template(id); this.library(); },
    });
    this.documents.registerOwner('poa', { read: async (id) => { await this.poa(id); return unitRead(); }, write: async (id) => { await this.poa(id); return unitWrite(); } });
  }

  private read() { if (!this.policy.covers('matter:read', 'DRF')) throw forbidden(); }
  private write() { if (!this.policy.covers('draft:draft', 'DRF') && !this.policy.covers('matter:write', 'DRF')) throw forbidden(); }
  private library() { if (!this.policy.covers('draft:library', 'DRF')) throw forbidden(); }
  private approveLibrary() { const u = currentUser(); if (!u.isHod && !u.roles.some((r) => r.role === 'UNIT_HEAD' && r.unit === 'DRF')) throw forbidden('Only the Drafting Unit Head or HoD can approve templates'); }

  // ------------------------------------------------------------------ templates & clauses
  private canApprove() { const u = currentUser(); return u.isHod || u.roles.some((r) => r.role === 'UNIT_HEAD' && r.unit === 'DRF'); }
  /** People who maintain the library see drafts and retired items; everyone else sees approved items only. */
  private seesDrafts() { return this.policy.covers('draft:library', 'DRF'); }

  templates(q?: string, kind?: string) {
    this.read();
    return this.prisma.db.template.findMany({
      where: { AND: [
        q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { category: { contains: q, mode: 'insensitive' } }, { body: { contains: q, mode: 'insensitive' } }] } : {},
        kind ? { kind } : {}, this.seesDrafts() ? {} : { status: 'APPROVED' }] },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
      include: { documents: { where: { deletedAt: null }, select: { id: true, title: true, currentVersionNo: true } } },
    });
  }

  async template(id: string) {
    this.read();
    const t = await this.prisma.db.template.findUnique({ where: { id } });
    if (!t || (!this.seesDrafts() && t.status !== 'APPROVED')) throw notFound('Template');
    return t;
  }

  /**
   * Create/change a template. A change to its wording bumps the version and keeps the previous text
   * (LibraryVersion). Only the Drafting Unit Head / HoD approve; if anyone else changes an approved
   * template it goes back to DRAFT until it is approved again.
   */
  async saveTemplate(id: string | null, data: { name: string; kind?: string; category: string; body?: string | null; guidance?: string | null; status?: 'DRAFT' | 'APPROVED' | 'RETIRED'; note?: string | null }) {
    this.library();
    const { note, ...fields } = data;
    if (fields.status === 'APPROVED') this.approveLibrary();
    const user = currentUser();
    const row = await this.prisma.tx(async () => {
      if (!id) {
        const approved = fields.status === 'APPROVED';
        return this.prisma.db.template.create({ data: { ...fields, status: fields.status ?? 'DRAFT', updatedById: user.id, ...(approved ? { approvedById: user.id, approvedAt: new Date() } : {}) } });
      }
      const before = await this.prisma.db.template.findUnique({ where: { id } });
      if (!before) throw notFound('Template');
      const wordingChanged = (['name', 'kind', 'category', 'body', 'guidance'] as const).some((k) => fields[k] !== undefined && (fields[k] ?? null) !== (before[k] ?? null));
      let status = fields.status ?? before.status;
      if (wordingChanged && before.status === 'APPROVED' && !this.canApprove()) status = 'DRAFT';
      if (wordingChanged) await this.prisma.db.libraryVersion.create({ data: { itemType: 'TEMPLATE', itemId: id, version: before.version, snapshot: { name: before.name, kind: before.kind, category: before.category, body: before.body, guidance: before.guidance, status: before.status }, changedById: user.id, note: note ?? null } });
      const nowApproved = status === 'APPROVED' && (before.status !== 'APPROVED' || wordingChanged);
      return this.prisma.db.template.update({ where: { id }, data: { ...fields, status, updatedById: user.id, ...(wordingChanged ? { version: before.version + 1 } : {}), ...(nowApproved ? { approvedById: user.id, approvedAt: new Date() } : status !== 'APPROVED' ? { approvedById: null, approvedAt: null } : {}) } });
    });
    await this.audit.log({ action: id ? 'drf.template.updated' : 'drf.template.created', entityType: 'Template', entityId: row.id, after: { name: row.name, status: row.status, version: row.version } });
    return row;
  }

  clauses(q?: string, tag?: string, category?: string) {
    this.read();
    return this.prisma.db.clause.findMany({
      where: { AND: [
        q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { body: { contains: q, mode: 'insensitive' } }] } : {}, tag ? { tags: { has: tag } } : {},
        category ? { category } : {}, this.seesDrafts() ? {} : { status: 'APPROVED' }] },
      orderBy: [{ category: 'asc' }, { title: 'asc' }],
    });
  }

  async saveClause(id: string | null, data: { title: string; body: string; tags: string[]; category?: string | null; guidance?: string | null; status?: string; note?: string | null }) {
    this.library();
    const { note, ...fields } = data;
    if (fields.status === 'APPROVED') this.approveLibrary();
    const user = currentUser();
    const row = await this.prisma.tx(async () => {
      if (!id) {
        const approved = fields.status === 'APPROVED';
        return this.prisma.db.clause.create({ data: { ...fields, status: fields.status ?? 'DRAFT', updatedById: user.id, ...(approved ? { approvedById: user.id, approvedAt: new Date() } : {}) } });
      }
      const before = await this.prisma.db.clause.findUnique({ where: { id } });
      if (!before) throw notFound('Clause');
      const wordingChanged = fields.title !== before.title || fields.body !== before.body || (fields.category !== undefined && (fields.category ?? null) !== before.category) || (fields.guidance !== undefined && (fields.guidance ?? null) !== before.guidance);
      let status = fields.status ?? before.status;
      if (wordingChanged && before.status === 'APPROVED' && !this.canApprove()) status = 'DRAFT';
      if (wordingChanged) await this.prisma.db.libraryVersion.create({ data: { itemType: 'CLAUSE', itemId: id, version: before.version, snapshot: { title: before.title, category: before.category, body: before.body, guidance: before.guidance, tags: before.tags, status: before.status }, changedById: user.id, note: note ?? null } });
      const nowApproved = status === 'APPROVED' && (before.status !== 'APPROVED' || wordingChanged);
      return this.prisma.db.clause.update({ where: { id }, data: { ...fields, status, updatedById: user.id, ...(wordingChanged ? { version: before.version + 1 } : {}), ...(nowApproved ? { approvedById: user.id, approvedAt: new Date() } : status !== 'APPROVED' ? { approvedById: null, approvedAt: null } : {}) } });
    });
    await this.audit.log({ action: id ? 'drf.clause.updated' : 'drf.clause.created', entityType: 'Clause', entityId: row.id, after: { title: row.title, status: row.status, version: row.version } });
    return row;
  }

  /** Start a drafting request from an approved template: its file(s) are copied in (and scanned again) as the first document. */
  async useTemplate(requestId: string, templateId: string) {
    const m = await this.policy.assertMatter(requestId, 'doc:write');
    if (m.unit !== 'DRF') throw notFound('Request');
    await this.policy.assertWrite(m);
    const tpl = await this.template(templateId);
    if (tpl.status !== 'APPROVED') throw badRequest('Only approved templates can be used');
    const docs = await this.prisma.db.document.findMany({ where: { templateId, deletedAt: null }, include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } } });
    const files = docs.map((d) => d.versions[0]).filter((v): v is NonNullable<typeof v> => !!v && v.scanStatus === 'CLEAN');
    if (!files.length) throw badRequest(tpl.body ? 'This template has no file; copy its text instead' : 'This template has no file yet');
    const out = [];
    for (const v of files) {
      const buffer = await this.storage.get('clean', v.storageKey);
      out.push(await this.documents.upload({ ownerType: 'matter', ownerId: requestId, title: `${tpl.name} (template v${tpl.version})`, stageLabel: 'Template', comment: `From template "${tpl.name}" version ${tpl.version}`, file: { originalname: v.filename, buffer } }));
    }
    await this.audit.log({ action: 'drf.template.used', entityType: 'Template', entityId: templateId, meta: { matterId: requestId, version: tpl.version } });
    return { copied: out.length };
  }

  /** Earlier wordings of a template or clause, newest first, with who changed it. */
  async libraryVersions(itemType: 'TEMPLATE' | 'CLAUSE', id: string) {
    if (itemType === 'TEMPLATE') await this.template(id);
    else {
      this.read();
      const c = await this.prisma.db.clause.findUnique({ where: { id } });
      if (!c || (!this.seesDrafts() && c.status !== 'APPROVED')) throw notFound('Clause');
    }
    const rows = await this.prisma.db.libraryVersion.findMany({ where: { itemType, itemId: id }, orderBy: { version: 'desc' } });
    const users = await this.prisma.base.user.findMany({ where: { id: { in: rows.map((r) => r.changedById).filter((x): x is string => !!x) } }, select: { id: true, displayName: true } });
    return rows.map((r) => ({ ...r, changedBy: users.find((u) => u.id === r.changedById)?.displayName ?? null }));
  }

  // ------------------------------------------------------------------ contracts
  private async contract(id: string) {
    const c = await this.prisma.db.contract.findUnique({ where: { id } });
    if (!c) throw notFound('Contract');
    return c;
  }

  contracts(f: { q?: string; status?: string; expiringDays?: number; ownerDeptId?: string }) {
    this.read();
    const where: Prisma.ContractWhereInput = {
      ...(f.q ? { OR: [{ title: { contains: f.q, mode: 'insensitive' } }, { parties: { has: f.q } }] } : {}),
      ...(f.status ? { status: f.status } : {}),
      ...(f.ownerDeptId ? { ownerDeptId: f.ownerDeptId } : {}),
      ...(f.expiringDays ? { endDate: { lte: new Date(Date.now() + f.expiringDays * DAY), gte: new Date() } } : {}),
    };
    return this.prisma.db.contract.findMany({ where, orderBy: [{ endDate: 'asc' }, { createdAt: 'desc' }], take: 1000 });
  }

  async getContract(id: string) {
    this.read();
    const c = await this.contract(id);
    await this.audit.log({ action: 'drf.contract.view', entityType: 'Contract', entityId: id });
    return { ...c, noticeDeadline: this.noticeDeadline(c), documents: await this.documents.listFor('contract', id) };
  }

  noticeDeadline(c: { endDate: Date | null; noticePeriodDays: number | null }) {
    return c.endDate && c.noticePeriodDays ? new Date(c.endDate.getTime() - c.noticePeriodDays * DAY) : null;
  }

  async saveContract(id: string | null, data: { matterId?: string | null; title: string; parties: string[]; value?: string | null; currency?: string; startDate?: Date | null; endDate?: Date | null; autoRenew?: boolean; noticePeriodDays?: number | null; ownerDeptId?: string | null; keyObligations?: string | null; status?: string }) {
    this.write();
    if (data.matterId) await this.policy.assertMatter(data.matterId);
    if (data.startDate && data.endDate && data.endDate < data.startDate) throw badRequest('End date is before the start date');
    const before = id ? await this.contract(id) : null;
    const row = id ? await this.prisma.db.contract.update({ where: { id }, data }) : await this.prisma.db.contract.create({ data });
    await this.syncContractEvents(row);
    await this.audit.log({ action: id ? 'drf.contract.updated' : 'drf.contract.created', entityType: 'Contract', entityId: row.id, before, after: row });
    return row;
  }

  private async syncContractEvents(c: { id: string; title: string; endDate: Date | null; noticePeriodDays: number | null; autoRenew: boolean; status: string; matterId: string | null }) {
    const active = c.status === 'ACTIVE';
    if (c.endDate) await this.calendar.upsert({ kind: 'CONTRACT_EXPIRY', unit: 'DRF', title: `Contract expires: ${c.title}`, sourceType: 'Contract', sourceId: c.id, startsAt: c.endDate, allDay: true, matterId: c.matterId, cancelled: !active });
    const notice = this.noticeDeadline(c);
    if (notice) await this.calendar.upsert({ kind: 'CONTRACT_NOTICE', unit: 'DRF', title: `${c.autoRenew ? 'Auto-renews unless notice given' : 'Notice deadline'}: ${c.title}`, sourceType: 'Contract', sourceId: c.id, startsAt: notice, allDay: true, matterId: c.matterId, cancelled: !active });
  }

  // ------------------------------------------------------------------ powers of attorney
  private async poa(id: string) {
    const p = await this.prisma.db.powerOfAttorney.findUnique({ where: { id } });
    if (!p) throw notFound('Power of attorney');
    return p;
  }

  poas(status?: string) {
    this.read();
    return this.prisma.db.powerOfAttorney.findMany({ where: status ? { status } : {}, orderBy: [{ status: 'asc' }, { expiresOn: 'asc' }] });
  }

  async savePoa(id: string | null, data: { holderName: string; holderUserId?: string | null; scope: string; issuedOn: Date; expiresOn?: Date | null; matterId?: string | null }) {
    this.write();
    if (data.expiresOn && data.expiresOn < data.issuedOn) throw badRequest('Expiry is before the issue date');
    const before = id ? await this.poa(id) : null;
    const row = id ? await this.prisma.db.powerOfAttorney.update({ where: { id }, data }) : await this.prisma.db.powerOfAttorney.create({ data });
    if (row.expiresOn) await this.calendar.upsert({ kind: 'POA_EXPIRY', unit: 'DRF', title: `Power of attorney expires: ${row.holderName}`, sourceType: 'PowerOfAttorney', sourceId: row.id, startsAt: row.expiresOn, allDay: true, ownerId: row.holderUserId, cancelled: row.status !== 'ACTIVE' });
    await this.audit.log({ action: id ? 'drf.poa.updated' : 'drf.poa.created', entityType: 'PowerOfAttorney', entityId: row.id, before, after: row });
    return row;
  }

  async revokePoa(id: string, reason: string) {
    this.write();
    await this.poa(id);
    const row = await this.prisma.db.powerOfAttorney.update({ where: { id }, data: { status: 'REVOKED', revokedOn: new Date() } });
    await this.calendar.cancel('PowerOfAttorney', id);
    await this.audit.log({ action: 'drf.poa.revoked', entityType: 'PowerOfAttorney', entityId: id, meta: { reason } });
    return row;
  }

  // ------------------------------------------------------------------ legal opinions
  async opinions(q?: string, tag?: string) {
    this.read();
    if (q && q.length >= 2) {
      const ids = await this.prisma.db.$queryRaw<{ id: string }[]>`
        SELECT o.id FROM "LegalOpinion" o
        WHERE to_tsvector('english', o.title || ' ' || o.question || ' ' || o.summary) @@ plainto_tsquery('english', ${q})
           OR o.title ILIKE ${'%' + q + '%'}
        LIMIT 200`;
      return this.prisma.db.legalOpinion.findMany({ where: { id: { in: ids.map((i) => i.id) }, ...(tag ? { tags: { has: tag } } : {}) }, orderBy: { issuedOn: 'desc' }, include: { matter: { select: { id: true, reference: true } } } });
    }
    return this.prisma.db.legalOpinion.findMany({ where: tag ? { tags: { has: tag } } : {}, orderBy: { issuedOn: 'desc' }, take: 500, include: { matter: { select: { id: true, reference: true } } } });
  }

  async saveOpinion(id: string | null, data: { matterId?: string | null; title: string; question: string; summary: string; tags: string[]; issuedOn: Date }) {
    this.write();
    if (data.matterId) await this.policy.assertMatter(data.matterId);
    const row = id ? await this.prisma.db.legalOpinion.update({ where: { id }, data }) : await this.prisma.db.legalOpinion.create({ data });
    await this.audit.log({ action: id ? 'drf.opinion.updated' : 'drf.opinion.created', entityType: 'LegalOpinion', entityId: row.id });
    return row;
  }

  /** Daily: expire contracts / PoAs past their end date; remind about notice periods. */
  async expiryScan() {
    const now = new Date();
    const exp = await this.prisma.db.contract.updateMany({ where: { status: 'ACTIVE', autoRenew: false, endDate: { lt: now } }, data: { status: 'EXPIRED' } });
    const poa = await this.prisma.db.powerOfAttorney.updateMany({ where: { status: 'ACTIVE', expiresOn: { lt: now } }, data: { status: 'EXPIRED' } });
    const heads = await this.notifications.usersWithRole('UNIT_HEAD', 'DRF');
    const soon = await this.prisma.db.contract.findMany({ where: { status: 'ACTIVE', endDate: { gte: now, lte: new Date(now.getTime() + 30 * DAY) } } });
    for (const c of soon) {
      const notice = this.noticeDeadline(c);
      if (notice && notice < now && c.autoRenew) {
        await this.notifications.notify(heads, { type: 'drf.contract.renewed', title: `Notice period passed — "${c.title}" will auto-renew`, link: `/drafting/contracts/${c.id}` });
      }
    }
    return { contractsExpired: exp.count, poasExpired: poa.count };
  }
}
