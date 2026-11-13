import { Injectable, OnModuleInit } from '@nestjs/common';
import { logger } from '../../common/logger';
import { JobsService } from '../jobs/jobs.service';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../common/prisma.service';
import { ctx } from '../../common/context';

const SENSITIVE_KEY = /(Enc|Hash|password|secret|token|bodyText|bodyHtml|extractedText)$/i;
const GENESIS = 'GENESIS';

/** Deterministic JSON: sorted keys, Dates → ISO, Decimals/BigInt → strings, sensitive keys masked. */
export function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof (v as { toFixed?: unknown }).toFixed === 'function' && typeof (v as { d?: unknown }).d !== 'undefined') return String(value);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      if (v[k] === undefined) continue;
      out[k] = SENSITIVE_KEY.test(k) ? (v[k] ? '[masked]' : null) : canonicalize(v[k]);
    }
    return out;
  }
  return value;
}

export interface AuditEntry {
  action: string;
  entityType?: string;
  entityId?: string;
  outcome?: 'SUCCESS' | 'DENIED' | 'FAILURE';
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown>;
  actorId?: string | null;
  actorName?: string | null;
}

function hashOf(prevHash: string, e: { ts: string; actorId: string | null; sessionId: string | null; ip: string | null; action: string; entityType: string | null; entityId: string | null; outcome: string; before: unknown; after: unknown; meta: unknown }) {
  return createHash('sha256').update(prevHash).update(JSON.stringify(canonicalize(e))).digest('hex');
}

@Injectable()
export class AuditService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService, private readonly jobs: JobsService) {}

  onModuleInit() {
    // Nightly: verify the chain and ship the head hash to the SIEM, so tampering by a
    // database superuser is detectable from outside the database.
    this.jobs.register('audit.verify', async () => {
      const r = await this.verify();
      if (r.ok) logger.info({ auditChain: 'ok', entries: r.checked, head: r.head }, 'audit chain verified');
      else logger.fatal({ auditChain: 'BROKEN', brokenAt: r.brokenAt }, 'audit chain verification FAILED');
      return r;
    });
  }

  /** Append an entry, chained to the previous one. Serialised with an advisory lock. */
  async log(entry: AuditEntry): Promise<void> {
    const c = ctx();
    const actorId = entry.actorId !== undefined ? entry.actorId : c.user?.id ?? null;
    const actorName = entry.actorName !== undefined ? entry.actorName : c.user?.username ?? (c.system ? 'system' : null);
    const before = entry.before === undefined ? null : canonicalize(entry.before);
    const after = entry.after === undefined ? null : canonicalize(entry.after);
    const meta = entry.meta === undefined ? null : canonicalize(entry.meta);
    await this.prisma.base.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(74210001)`;
      const last = await tx.auditLog.findFirst({ orderBy: { seq: 'desc' }, select: { hash: true } });
      const prevHash = last?.hash ?? GENESIS;
      const ts = new Date();
      const record = {
        ts: ts.toISOString(), actorId, sessionId: c.sessionId ?? null, ip: c.ip ?? null, action: entry.action,
        entityType: entry.entityType ?? null, entityId: entry.entityId ?? null, outcome: entry.outcome ?? 'SUCCESS', before, after, meta,
      };
      const hash = hashOf(prevHash, record);
      await tx.auditLog.create({
        data: {
          ts, actorId, actorName, sessionId: record.sessionId, ip: record.ip, action: record.action, entityType: record.entityType,
          entityId: record.entityId, outcome: record.outcome, before: before as never, after: after as never, meta: meta as never, prevHash, hash,
        },
      });
    });
  }

  /** Walk the chain; returns the first broken sequence number, if any. */
  async verify(): Promise<{ ok: boolean; checked: number; brokenAt?: string; head?: string }> {
    let prev = GENESIS;
    let checked = 0;
    let cursor: bigint | undefined;
    for (;;) {
      const batch = await this.prisma.base.auditLog.findMany({ where: cursor ? { seq: { gt: cursor } } : {}, orderBy: { seq: 'asc' }, take: 1000 });
      if (batch.length === 0) break;
      for (const r of batch) {
        const expected = hashOf(prev, {
          ts: r.ts.toISOString(), actorId: r.actorId, sessionId: r.sessionId, ip: r.ip, action: r.action, entityType: r.entityType,
          entityId: r.entityId, outcome: r.outcome, before: r.before, after: r.after, meta: r.meta,
        });
        if (r.prevHash !== prev || r.hash !== expected) return { ok: false, checked, brokenAt: r.seq.toString() };
        prev = r.hash;
        checked++;
      }
      cursor = batch[batch.length - 1]!.seq;
    }
    return { ok: true, checked, head: prev };
  }
}
