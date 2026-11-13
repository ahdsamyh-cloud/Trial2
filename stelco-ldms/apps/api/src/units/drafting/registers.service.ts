import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { currentUser } from '../../common/context';
import { badRequest, forbidden, notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../core/audit/audit.service';
import { CalendarService } from '../../core/calendar/calendar.service';
import { DocumentsService } from '../../core/documents/documents.service';
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
  ) {}

  onModuleInit() {
    this.jobs.register('drf.expiry-scan', () => this.expiryScan());
    const unitRead = async () => { if (!this.policy.covers('matter:read', 'DRF') && !this.policy.covers('doc:read', 'DRF')) throw notFound('Record'); return {}; };
    const unitWrite = async () => { if (!this.policy.covers('draft:draft', 'DRF') && !this.policy.covers('matter:write', 'DRF')) throw forbidden(); };
    this.documents.registerOwner('contract', { read: async (id) => { await this.contract(id); return unitRead(); }, write: async (id) => { await this.contract(id); return unitWrite(); } });
    this.documents.registerOwner('poa', { read: async (id) => { await this.poa(id); return unitRead(); }, write: async (id) => { await this.poa(id); return unitWrite(); } });
  }

  private read() { if (!this.policy.covers('matter:read', 'DRF')) throw forbidden(); }
  private write() { if (!this.policy.covers('draft:draft', 'DRF') && !this.policy.covers('matter:write', 'DRF')) throw forbidden(); }
  private library() { if (!this.policy.covers('draft:library', 'DRF')) throw forbidden(); }
  private approveLibrary() { const u = currentUser(); if (!u.isHod && !u.roles.some((r) => r.role === 'UNIT_HEAD' && r.unit === 'DRF')) throw forbidden('Only the Drafting Unit Head or HoD can approve templates'); }

  // ------------------------------------------------------------------ templates & clauses
  templates(q?: string) {
    this.read();
    return this.prisma.db.template.findMany({ where: q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { category: { contains: q, mode: 'insensitive' } }] } : {}, orderBy: { name: 'asc' } });
  }

  async saveTemplate(id: string | null, data: { name: string; category: string; body?: string | null; documentId?: string | null; status?: 'DRAFT' | 'APPROVED' | 'RETIRED' }) {
    this.library();
    if (data.status === 'APPROVED') this.approveLibrary();
    const row = id ? await this.prisma.db.template.update({ where: { id }, data }) : await this.prisma.db.template.create({ data: { ...data, status: data.status === 'APPROVED' ? 'APPROVED' : data.status ?? 'DRAFT' } });
    await this.audit.log({ action: id ? 'drf.template.updated' : 'drf.template.created', entityType: 'Template', entityId: row.id, after: { name: row.name, status: row.status } });
    return row;
  }

  clauses(q?: string, tag?: string) {
    this.read();
    return this.prisma.db.clause.findMany({
      where: { ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { body: { contains: q, mode: 'insensitive' } }] } : {}), ...(tag ? { tags: { has: tag } } : {}) },
      orderBy: { title: 'asc' },
    });
  }

  async saveClause(id: string | null, data: { title: string; body: string; tags: string[]; status?: string }) {
    this.library();
    if (data.status === 'APPROVED') this.approveLibrary();
    const row = id ? await this.prisma.db.clause.update({ where: { id }, data }) : await this.prisma.db.clause.create({ data: { ...data, status: data.status ?? 'DRAFT' } });
    await this.audit.log({ action: id ? 'drf.clause.updated' : 'drf.clause.created', entityType: 'Clause', entityId: row.id, after: { title: row.title, status: row.status } });
    return row;
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
