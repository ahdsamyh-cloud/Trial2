import { Injectable, OnModuleInit } from '@nestjs/common';
import { CryptoService } from '../../common/crypto.service';
import { currentUser } from '../../common/context';
import { conflict, DomainError, forbidden, notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { logger } from '../../common/logger';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../documents/storage.service';
import { JobsService } from '../jobs/jobs.service';
import { NotificationsService } from '../notifications/notifications.service';

const RECORD_UNIT: Record<string, string> = { LitigationCase: 'LIT', DraftingRequest: 'DRF' };

/**
 * Retention (PLAN §5.3): records past their retention period are proposed for disposal;
 * nothing is destroyed without HoD approval, and legal holds always win.
 * Also hosts the field-encryption key rotation job.
 */
@Injectable()
export class RetentionService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
    private readonly crypto: CryptoService,
  ) {}

  onModuleInit() {
    this.jobs.register('retention.scan', () => this.scan());
    this.jobs.register('crypto.rotate', () => this.rotateKeys());
  }

  /** Weekly: propose disposal of closed matters whose retention period has passed. */
  async scan(now = new Date()) {
    const policies = await this.prisma.base.retentionPolicy.findMany();
    let proposed = 0;
    for (const p of policies) {
      const unit = RECORD_UNIT[p.recordType];
      if (!unit) continue;
      const cutoff = new Date(now.getTime() - p.years * 365.25 * 86400_000);
      const due = await this.prisma.db.matter.findMany({ where: { unit: unit as never, closedAt: { lt: cutoff }, legalHold: false }, select: { id: true } });
      for (const m of due) {
        const exists = await this.prisma.base.disposalRequest.count({ where: { recordType: 'Matter', recordId: m.id, status: { in: ['PENDING', 'APPROVED'] } } });
        if (exists) continue;
        await this.prisma.base.disposalRequest.create({ data: { recordType: 'Matter', recordId: m.id, reason: `${p.recordType}: retention of ${p.years} years after closure has passed`, requestedById: 'system' } });
        proposed++;
      }
    }
    if (proposed) await this.notifications.notify(await this.notifications.usersWithRole('HOD'), { type: 'retention.review', title: `${proposed} record(s) are due for disposal review`, link: '/admin/retention' });
    return { proposed };
  }

  async list(status = 'PENDING') {
    if (!currentUser().perms.has('disposal:approve')) throw forbidden();
    const rows = await this.prisma.base.disposalRequest.findMany({ where: { status }, orderBy: { createdAt: 'asc' }, take: 500 });
    const matters = await this.prisma.db.matter.findMany({ where: { id: { in: rows.map((r) => r.recordId) } }, select: { id: true, reference: true, title: true, closedAt: true, legalHold: true } });
    return rows.map((r) => ({ ...r, matter: matters.find((m) => m.id === r.recordId) ?? null }));
  }

  /** HoD decision. Approval disposes immediately: stored files are destroyed, the record is deleted, an audit entry remains. */
  async decide(id: string, approve: boolean) {
    const user = currentUser();
    if (!user.perms.has('disposal:approve')) throw forbidden();
    const req = await this.prisma.base.disposalRequest.findUnique({ where: { id } });
    if (!req || req.status !== 'PENDING') throw notFound('Disposal request');
    if (!approve) {
      await this.prisma.base.disposalRequest.update({ where: { id }, data: { status: 'REJECTED', decidedById: user.id, decidedAt: new Date() } });
      await this.audit.log({ action: 'retention.rejected', entityType: 'DisposalRequest', entityId: id });
      return { ok: true };
    }
    const m = await this.prisma.db.matter.findUnique({ where: { id: req.recordId }, include: { documents: { include: { versions: true } } } });
    if (!m) throw notFound('Record');
    if (m.legalHold || m.documents.some((d) => d.legalHold)) throw conflict('This record is under legal hold and cannot be disposed of');
    const snapshot = { reference: m.reference, title: m.restricted ? '[restricted]' : m.title, unit: m.unit, closedAt: m.closedAt, documents: m.documents.length };
    // SECURITY/RECORDS INTEGRITY: previously storage errors were swallowed, so a record could be
    // marked DISPOSED while its files still existed. Now every failure is logged and audited, and
    // the register entry is only deleted once ALL files are gone. Deletes are idempotent (missing
    // objects count as deleted), so the HoD can simply approve again after IT fixes storage.
    const failed: string[] = [];
    for (const d of m.documents) for (const v of d.versions) {
      try {
        await this.storage.remove(v.scanStatus === 'CLEAN' ? 'clean' : 'quarantine', v.storageKey);
      } catch (err) {
        failed.push(v.id);
        logger.error({ disposalId: id, versionId: v.id, err: String(err).slice(0, 300) }, 'retention: file destruction failed');
      }
    }
    if (failed.length) {
      await this.audit.log({ action: 'retention.dispose.failed', outcome: 'FAILURE', entityType: 'Matter', entityId: m.id, meta: { failedVersions: failed.length } });
      throw new DomainError(503, 'Some files could not be destroyed, so the record was kept. Please try again later or contact IT.');
    }
    await this.prisma.tx(async (tx) => {
      await tx.calendarEvent.deleteMany({ where: { matterId: m.id } });
      await tx.intake.updateMany({ where: { matterId: m.id }, data: { matterId: null } });
      await tx.document.deleteMany({ where: { matterId: m.id } });
      await tx.matter.delete({ where: { id: m.id } });
    });
    await this.prisma.base.disposalRequest.update({ where: { id }, data: { status: 'DISPOSED', decidedById: user.id, decidedAt: new Date() } });
    await this.audit.log({ action: 'retention.disposed', entityType: 'Matter', entityId: m.id, before: snapshot });
    return { ok: true, disposed: snapshot.reference };
  }

  /**
   * Re-encrypt field-level values that use a non-active key (run after adding a new key to
   * FIELD_KEYS and switching FIELD_KEY_ACTIVE). Old keys can be removed once this reports 0.
   */
  async rotateKeys() {
    const targets: { model: string; field: string }[] = [
      { model: 'mfaFactor', field: 'secretEnc' }, { model: 'matter', field: 'descriptionEnc' }, { model: 'comment', field: 'bodyEnc' },
      { model: 'litigationCase', field: 'exposureEnc' }, { model: 'outcome', field: 'amountEnc' },
    ];
    let rotated = 0;
    for (const t of targets) {
      const delegate = (this.prisma.db as unknown as Record<string, { findMany: (a: unknown) => Promise<Record<string, string>[]>; update: (a: unknown) => Promise<unknown> }>)[t.model]!;
      const key = t.model === 'litigationCase' ? 'matterId' : 'id';
      const rows = await delegate.findMany({ select: { [key]: true, [t.field]: true } });
      for (const r of rows) {
        const v = r[t.field];
        if (!v || !this.crypto.needsRotation(v)) continue;
        await delegate.update({ where: { [key]: r[key] }, data: { [t.field]: this.crypto.encrypt(this.crypto.decrypt(v)) } });
        rotated++;
      }
    }
    logger.info({ rotated }, 'field key rotation pass complete');
    await this.audit.log({ action: 'crypto.rotated', meta: { rotated } });
    return { rotated };
  }
}
