import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { diffWordsWithSpace } from 'diff';
import mammoth from 'mammoth';
import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib';
import { config } from '../../config';
import { CryptoService } from '../../common/crypto.service';
import { ctx, currentUser } from '../../common/context';
import { badRequest, conflict, DomainError, forbidden, notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../config/settings.service';
import { JobsService } from '../jobs/jobs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SecurityAlerts } from '../notifications/security-alerts.service';
import { PolicyService } from '../policy/policy.service';
import { AvService } from './av.service';
import { ExtractService } from './extract.service';
import { cleanFilename, FileRejected, sniff } from './filetype';
import { StorageService } from './storage.service';

export const OWNER_FKS = ['matterId', 'intakeId', 'hearingId', 'lawId', 'checkItemId', 'findingId', 'sessionId', 'contractId', 'poaId'] as const;
export type OwnerFk = (typeof OWNER_FKS)[number];
export type OwnerType = 'matter' | 'intake' | 'hearing' | 'law' | 'checkItem' | 'finding' | 'session' | 'contract' | 'poa' | 'library';

export interface OwnerAccess {
  /** Throw if the current user may not read documents of this owner. */
  read(id: string): Promise<{ restricted?: boolean; portal?: boolean }>;
  /** Throw if the current user may not add/change documents of this owner. */
  write(id: string): Promise<void>;
}

const FK_OF: Record<Exclude<OwnerType, 'library'>, OwnerFk> = {
  matter: 'matterId', intake: 'intakeId', hearing: 'hearingId', law: 'lawId', checkItem: 'checkItemId',
  finding: 'findingId', session: 'sessionId', contract: 'contractId', poa: 'poaId',
};

type OwnerRef = { [K in OwnerFk]?: string | null };
type DocWithVersions = Prisma.DocumentGetPayload<{ include: { versions: true } }>;

@Injectable()
export class DocumentsService implements OnModuleInit {
  private readonly owners = new Map<OwnerType, OwnerAccess>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly av: AvService,
    private readonly extractor: ExtractService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly policy: PolicyService,
    private readonly notifications: NotificationsService,
    private readonly alerts: SecurityAlerts,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit() {
    this.jobs.register('doc.scan', (d: { versionId: string }) => this.scan(d.versionId));
    this.jobs.register('doc.extract', (d: { versionId: string }) => this.extract(d.versionId));
    this.registerOwner('matter', {
      read: async (id) => {
        const user = currentUser();
        if (!user.perms.has('doc:read') && user.perms.has('portal:use')) {
          const m = await this.policy.assertMatter(id, 'matter:read');
          return { restricted: m.restricted, portal: true };
        }
        const m = await this.policy.assertMatter(id, 'doc:read');
        return { restricted: m.restricted };
      },
      write: async (id) => {
        const m = await this.policy.assertMatter(id, 'doc:write');
        await this.policy.assertWrite(m);
      },
    });
    this.registerOwner('intake', {
      read: async (id) => {
        if (!currentUser().perms.has('intake:read')) throw notFound('Intake');
        await this.prisma.db.intake.findUniqueOrThrow({ where: { id } });
        return {};
      },
      write: async () => { if (!currentUser().perms.has('intake:create')) throw forbidden(); },
    });
    this.registerOwner('library', {
      read: async () => { if (!currentUser().perms.has('doc:read')) throw forbidden(); return {}; },
      write: async () => { if (!currentUser().perms.has('doc:write')) throw forbidden(); },
    });
  }

  registerOwner(type: OwnerType, access: OwnerAccess) {
    this.owners.set(type, access);
  }

  private owner(type: OwnerType) {
    const o = this.owners.get(type);
    if (!o) throw badRequest('Unknown document owner');
    return o;
  }

  private ownerOf(doc: { [K in OwnerFk]?: string | null }): { type: OwnerType; id: string } {
    for (const [type, fk] of Object.entries(FK_OF) as [Exclude<OwnerType, 'library'>, OwnerFk][]) if (doc[fk]) return { type, id: doc[fk]! };
    return { type: 'library', id: '' };
  }

  async assertDocRead(doc: OwnerRef & { sharedToPortal?: boolean; deletedAt?: Date | null }) {
    if (doc.deletedAt) throw notFound('Document');
    const o = this.ownerOf(doc);
    const r = await this.owner(o.type).read(o.id);
    if (r.portal && !doc.sharedToPortal) throw notFound('Document');
    return r;
  }

  async assertDocWrite(doc: { [K in OwnerFk]?: string | null }) {
    const o = this.ownerOf(doc);
    await this.owner(o.type).write(o.id);
  }

  // ------------------------------------------------------------------ upload
  /** Validates type by signature, stores in quarantine, queues AV scan. */
  async upload(input: {
    ownerType: OwnerType; ownerId?: string; title?: string; docTypeCode?: string; documentId?: string; stageLabel?: string;
    comment?: string; libraryKind?: string; file: { originalname: string; buffer: Buffer }; skipAccessCheck?: boolean; sharedToPortal?: boolean;
  }) {
    const user = currentUser();
    const filename = cleanFilename(input.file.originalname);
    if (input.file.buffer.length > config().MAX_UPLOAD_MB * 1024 * 1024) throw new DomainError(413, `Files must be smaller than ${config().MAX_UPLOAD_MB} MB`);
    let detected;
    try {
      detected = sniff(filename, input.file.buffer);
    } catch (e) {
      if (e instanceof FileRejected) {
        await this.audit.log({ action: 'document.rejected', outcome: 'DENIED', meta: { filename, reason: e.message } });
        throw badRequest(e.message);
      }
      throw e;
    }

    let doc: DocWithVersions;
    if (input.documentId) {
      const existing = await this.prisma.db.document.findUnique({ where: { id: input.documentId }, include: { versions: true } });
      if (!existing || existing.deletedAt) throw notFound('Document');
      await this.assertDocWrite(existing);
      if (existing.checkedOutById && existing.checkedOutById !== user.id) throw conflict('This document is checked out by someone else');
      doc = existing;
    } else {
      if (!input.skipAccessCheck) {
        if (input.ownerType !== 'library' && !input.ownerId) throw badRequest('Owner is required');
        await this.owner(input.ownerType).write(input.ownerId ?? '');
      }
      const ownerData = input.ownerType === 'library' ? {} : { [FK_OF[input.ownerType]]: input.ownerId };
      doc = await this.prisma.db.document.create({
        data: {
          title: (input.title || filename).slice(0, 200), docTypeCode: input.docTypeCode, libraryKind: input.libraryKind,
          createdById: user.id, sharedToPortal: input.sharedToPortal ?? false, ...ownerData,
        },
        include: { versions: true },
      });
    }

    const versionNo = doc.currentVersionNo + 1;
    const storageKey = `${new Date().getUTCFullYear()}/${randomUUID()}`;
    await this.storage.put('quarantine', storageKey, input.file.buffer, detected.mime);
    const version = await this.prisma.tx(async (tx) => {
      const v = await tx.documentVersion.create({
        data: {
          documentId: doc.id, versionNo, stageLabel: input.stageLabel, filename, storageKey, sha256: this.crypto.sha256(input.file.buffer),
          size: input.file.buffer.length, detectedMime: detected.mime, uploadedById: user.id, comment: input.comment?.slice(0, 1000),
        },
      });
      await tx.document.update({ where: { id: doc.id }, data: { currentVersionNo: versionNo } });
      await tx.documentAccessLog.create({ data: { versionId: v.id, userId: user.id, action: 'UPLOAD', ip: ctx().ip } });
      return v;
    });
    await this.audit.log({ action: 'document.uploaded', entityType: 'Document', entityId: doc.id, after: { versionNo, filename, size: version.size, sha256: version.sha256, stageLabel: input.stageLabel } });
    await this.jobs.enqueue('doc.scan', { versionId: version.id });
    return { documentId: doc.id, versionId: version.id, versionNo };
  }

  // ------------------------------------------------------------------ background: scan + extract
  async scan(versionId: string) {
    const v = await this.prisma.db.documentVersion.findUnique({ where: { id: versionId }, include: { document: true } });
    if (!v || v.scanStatus !== 'PENDING') return;
    const buf = await this.storage.get('quarantine', v.storageKey);
    if (this.crypto.sha256(buf) !== v.sha256) {
      await this.prisma.db.documentVersion.update({ where: { id: versionId }, data: { scanStatus: 'ERROR', scanDetail: 'integrity mismatch' } });
      return;
    }
    const result = await this.av.scan(buf);
    if (result.status === 'ERROR') {
      await this.prisma.db.documentVersion.update({ where: { id: versionId }, data: { scanDetail: result.detail?.slice(0, 200) } });
      throw new Error(`AV scan error: ${result.detail}`); // retried by the queue
    }
    if (result.status === 'INFECTED') {
      await this.prisma.db.documentVersion.update({ where: { id: versionId }, data: { scanStatus: 'INFECTED', scanDetail: result.detail?.slice(0, 200) } });
      await this.audit.log({ action: 'document.infected', outcome: 'FAILURE', entityType: 'Document', entityId: v.documentId, meta: { versionId, signature: result.detail } });
      const recipients = [v.uploadedById, ...(await this.notifications.usersWithRole('SUPER_ADMIN'))];
      await this.notifications.notify(recipients, { type: 'security.malware', title: 'An uploaded file was blocked by the virus scanner', body: `File "${v.filename}" was quarantined (${result.detail}).`, emailAlways: true });
      return;
    }
    await this.storage.promote(v.storageKey);
    await this.prisma.db.documentVersion.update({ where: { id: versionId }, data: { scanStatus: 'CLEAN', scanDetail: result.detail } });
    await this.jobs.enqueue('doc.extract', { versionId });
  }

  async extract(versionId: string) {
    const v = await this.prisma.db.documentVersion.findUnique({ where: { id: versionId } });
    if (!v || v.scanStatus !== 'CLEAN') return;
    const kind = sniff(v.filename, await this.storage.get('clean', v.storageKey)).kind;
    const { text, ocr } = await this.extractor.extract(kind, await this.storage.get('clean', v.storageKey));
    await this.prisma.db.documentVersion.update({ where: { id: versionId }, data: { extractedText: text || null, ocrApplied: ocr } });
  }

  // ------------------------------------------------------------------ read
  async listFor(ownerType: OwnerType, ownerId: string) {
    const r = await this.owner(ownerType).read(ownerId);
    const where: Prisma.DocumentWhereInput = ownerType === 'library'
      ? { libraryKind: ownerId || undefined, ...Object.fromEntries(OWNER_FKS.map((f) => [f, null])) }
      : { [FK_OF[ownerType]]: ownerId };
    return this.prisma.db.document.findMany({
      where: { ...where, deletedAt: null, ...(r.portal ? { sharedToPortal: true } : {}) },
      include: { versions: { orderBy: { versionNo: 'desc' }, select: { id: true, versionNo: true, filename: true, size: true, scanStatus: true, stageLabel: true, uploadedById: true, createdAt: true, comment: true, ocrApplied: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string) {
    const doc = await this.prisma.db.document.findUnique({ where: { id }, include: { versions: { orderBy: { versionNo: 'desc' } } } });
    if (!doc) throw notFound('Document');
    await this.assertDocRead(doc);
    const history = await this.prisma.db.documentAccessLog.findMany({ where: { version: { documentId: id } }, orderBy: { at: 'desc' }, take: 200 });
    return { ...doc, versions: doc.versions.map(({ extractedText: _t, storageKey: _k, ...v }) => v), history };
  }

  /** Short-lived (60 s) download URL bound to this user and session, served via the web origin. */
  async downloadLink(versionId: string) {
    const v = await this.prisma.db.documentVersion.findUnique({ where: { id: versionId }, include: { document: true } });
    if (!v) throw notFound('Document');
    await this.assertDocRead(v.document);
    if (v.scanStatus !== 'CLEAN') throw conflict(v.scanStatus === 'PENDING' ? 'This file is still being virus-scanned' : 'This file was blocked by the virus scanner');
    const token = this.crypto.sign({ v: versionId, u: currentUser().id, s: ctx().sessionId ?? '' }, 60);
    return { url: `/api/files/${token}` };
  }

  async resolveDownload(token: string) {
    const data = this.crypto.verify<{ v: string; u: string; s: string }>(token);
    const user = currentUser();
    if (!data || data.u !== user.id || data.s !== ctx().sessionId) throw notFound('File');
    const v = await this.prisma.db.documentVersion.findUnique({ where: { id: data.v }, include: { document: true } });
    if (!v || v.scanStatus !== 'CLEAN') throw notFound('File');
    await this.assertDocRead(v.document);
    let body = await this.storage.get('clean', v.storageKey);
    if (this.crypto.sha256(body) !== v.sha256) throw new DomainError(500, 'File integrity check failed');
    const watermark = v.detectedMime === 'application/pdf' && (await this.settings.get<boolean>('documents.watermarkPdf'));
    if (watermark) body = await this.watermark(body, `${user.displayName} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`);
    await this.prisma.db.documentAccessLog.create({ data: { versionId: v.id, userId: user.id, action: 'DOWNLOAD', ip: ctx().ip } });
    await this.audit.log({ action: 'document.downloaded', entityType: 'Document', entityId: v.documentId, meta: { versionNo: v.versionNo } });
    await this.alerts.onDownload(user.id, user.username);
    return { body, filename: v.filename, mime: v.detectedMime };
  }

  async watermark(pdf: Buffer, text: string): Promise<Buffer> {
    try {
      const doc = await PDFDocument.load(pdf, { ignoreEncryption: false });
      const font = await doc.embedFont(StandardFonts.Helvetica);
      for (const page of doc.getPages()) {
        const { width, height } = page.getSize();
        page.drawText(text, { x: width * 0.15, y: height * 0.35, size: 22, font, color: rgb(0.6, 0.6, 0.6), opacity: 0.35, rotate: degrees(35) });
        page.drawText(text, { x: 20, y: 12, size: 8, font, color: rgb(0.4, 0.4, 0.4), opacity: 0.8 });
      }
      return Buffer.from(await doc.save());
    } catch {
      return pdf; // encrypted or malformed PDFs are served unchanged
    }
  }

  // ------------------------------------------------------------------ check-out / check-in
  async checkout(id: string) {
    const doc = await this.prisma.db.document.findUnique({ where: { id } });
    if (!doc || doc.deletedAt) throw notFound('Document');
    await this.assertDocWrite(doc);
    const user = currentUser();
    const r = await this.prisma.db.document.updateMany({ where: { id, OR: [{ checkedOutById: null }, { checkedOutById: user.id }] }, data: { checkedOutById: user.id, checkedOutAt: new Date() } });
    if (r.count === 0) throw conflict('Already checked out by someone else');
    await this.audit.log({ action: 'document.checkout', entityType: 'Document', entityId: id });
    return { ok: true };
  }

  async checkin(id: string) {
    const doc = await this.prisma.db.document.findUnique({ where: { id } });
    if (!doc) throw notFound('Document');
    await this.assertDocWrite(doc);
    const user = currentUser();
    if (doc.checkedOutById && doc.checkedOutById !== user.id && !this.policy.covers('matter:assign', 'LIT') && !user.isHod) throw conflict('Checked out by someone else');
    await this.prisma.db.document.update({ where: { id }, data: { checkedOutById: null, checkedOutAt: null } });
    await this.audit.log({ action: 'document.checkin', entityType: 'Document', entityId: id });
    return { ok: true };
  }

  // ------------------------------------------------------------------ deletion, legal hold
  async remove(id: string, reason: string) {
    const doc = await this.prisma.db.document.findUnique({ where: { id } });
    if (!doc || doc.deletedAt) throw notFound('Document');
    await this.assertDocWrite(doc);
    if (doc.legalHold) throw conflict('This document is under legal hold and cannot be deleted');
    if (doc.matterId) {
      const m = await this.prisma.db.matter.findUnique({ where: { id: doc.matterId } });
      if (m?.legalHold) throw conflict('The matter is under legal hold; its documents cannot be deleted');
    }
    await this.prisma.db.document.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ action: 'document.deleted', entityType: 'Document', entityId: id, meta: { reason } });
    return { ok: true };
  }

  async setHold(scopeType: 'MATTER' | 'DOCUMENT', scopeId: string, on: boolean, reason: string) {
    const user = currentUser();
    if (on && !user.perms.has('hold:place')) throw forbidden();
    if (!on && !user.perms.has('hold:release')) throw forbidden('Only the HoD can release a legal hold');
    if (scopeType === 'MATTER') {
      const m = await this.policy.assertMatter(scopeId, 'matter:read');
      if (on) this.policy.assertUnit('hold:place', m.unit);
      await this.prisma.tx(async (tx) => {
        await tx.matter.update({ where: { id: scopeId }, data: { legalHold: on } });
        await tx.document.updateMany({ where: { matterId: scopeId }, data: { legalHold: on } });
      });
    } else {
      const doc = await this.prisma.db.document.findUnique({ where: { id: scopeId } });
      if (!doc) throw notFound('Document');
      await this.assertDocRead(doc);
      await this.prisma.db.document.update({ where: { id: scopeId }, data: { legalHold: on } });
    }
    if (on) await this.prisma.base.legalHold.create({ data: { scopeType, scopeId, reason, placedById: user.id } });
    else await this.prisma.base.legalHold.updateMany({ where: { scopeType, scopeId, releasedAt: null }, data: { releasedAt: new Date(), releasedById: user.id } });
    await this.audit.log({ action: on ? 'hold.placed' : 'hold.released', entityType: scopeType, entityId: scopeId, meta: { reason } });
    return { ok: true };
  }

  // ------------------------------------------------------------------ Word comparison
  async compare(documentId: string, a: number, b: number) {
    const doc = await this.prisma.db.document.findUnique({ where: { id: documentId }, include: { versions: true } });
    if (!doc) throw notFound('Document');
    await this.assertDocRead(doc);
    const va = doc.versions.find((v) => v.versionNo === a);
    const vb = doc.versions.find((v) => v.versionNo === b);
    if (!va || !vb) throw notFound('Version');
    const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (va.detectedMime !== docx || vb.detectedMime !== docx) throw badRequest('Comparison is available for Word (.docx) files');
    if (va.scanStatus !== 'CLEAN' || vb.scanStatus !== 'CLEAN') throw conflict('Both versions must have passed the virus scan');
    const [ta, tb] = await Promise.all([va, vb].map(async (v) => (await mammoth.extractRawText({ buffer: await this.storage.get('clean', v.storageKey) })).value));
    const parts = diffWordsWithSpace(ta!, tb!).map((p) => ({ type: p.added ? 'added' : p.removed ? 'removed' : 'same', text: p.value }));
    await this.audit.log({ action: 'document.compared', entityType: 'Document', entityId: documentId, meta: { a, b } });
    return { a, b, parts, stats: { added: parts.filter((p) => p.type === 'added').length, removed: parts.filter((p) => p.type === 'removed').length } };
  }

  async share(id: string, shared: boolean) {
    const doc = await this.prisma.db.document.findUnique({ where: { id } });
    if (!doc) throw notFound('Document');
    await this.assertDocWrite(doc);
    await this.prisma.db.document.update({ where: { id }, data: { sharedToPortal: shared } });
    await this.audit.log({ action: shared ? 'document.shared-portal' : 'document.unshared-portal', entityType: 'Document', entityId: id });
    return { ok: true };
  }
}
