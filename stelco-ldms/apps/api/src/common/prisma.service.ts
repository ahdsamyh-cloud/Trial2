import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma, PrismaClient } from '@prisma/client';
import { ctx } from './context';
import { config } from '../config';

/** Session settings that drive the RLS policies in prisma/sql/03_rls.sql. */
function rlsSettings(): [string, string, string] {
  const c = ctx();
  if (c.system) return ['system', '', 'off'];
  if (c.user) return ['user', c.user.id, c.user.isHod ? 'on' : 'off'];
  return ['anon', '', 'off'];
}

/**
 * The interactive transaction currently open in this async context (one per request/job), plus
 * work to run once it has finished. Lets code that is called inside `prisma.tx()` reuse the open
 * transaction instead of taking a SECOND pooled connection while holding the first; that pattern
 * deadlocks as soon as the pool is exhausted (always, with a 1-connection pool).
 */
interface TxScope { tx?: Tx; afterCommit: Array<() => Promise<unknown>>; afterEnd: Array<() => Promise<unknown>> }
const scope = new AsyncLocalStorage<TxScope>();

/** The open transaction in this context, if any. */
export const currentTx = (): Tx | undefined => scope.getStore()?.tx;

/** Run after the open transaction COMMITS (skipped on rollback); immediately if none is open. */
export async function onCommit(fn: () => Promise<unknown>): Promise<void> {
  const s = scope.getStore();
  if (s?.tx) s.afterCommit.push(fn); else await fn();
}

/** Run after the open transaction ends, committed OR rolled back; immediately if none is open. */
export async function onTxEnd(fn: () => Promise<unknown>): Promise<void> {
  const s = scope.getStore();
  if (s?.tx) s.afterEnd.push(fn); else await fn();
}

const lowerFirst = (m: string) => m.charAt(0).toLowerCase() + m.slice(1);

function extend(base: PrismaClient) {
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          // Inside prisma.tx(): run on that transaction (its RLS context is already set).
          const open = currentTx();
          if (open) return (open as unknown as Record<string, Record<string, (a: unknown) => Promise<unknown>>>)[lowerFirst(model)]![operation]!(args);
          const [c, uid, hod] = rlsSettings();
          const [, , , result] = await base.$transaction([
            base.$executeRaw`SELECT set_config('app.ctx', ${c}, true)`,
            base.$executeRaw`SELECT set_config('app.user_id', ${uid}, true)`,
            base.$executeRaw`SELECT set_config('app.is_hod', ${hod}, true)`,
            query(args),
          ]);
          return result;
        },
      },
    },
  });
}

export type Db = ReturnType<typeof extend>;
export type Tx = Prisma.TransactionClient;

@Injectable()
export class PrismaService implements OnModuleDestroy {
  /** Raw client — no RLS context. Only for audit-log appends and connection management. */
  readonly base: PrismaClient;
  /** RLS-aware client: every query runs with the request's user context. */
  readonly db: Db;

  constructor() {
    this.base = new PrismaClient();
    this.db = extend(this.base);
  }

  /** The raw client, or the open transaction if called inside prisma.tx() (never a second connection). */
  get raw(): Tx | PrismaClient {
    return currentTx() ?? this.base;
  }

  /**
   * Interactive transaction with RLS context applied. A nested call joins the already-open
   * transaction. Work registered with onCommit()/onTxEnd() runs after it finishes.
   */
  async tx<T>(fn: (tx: Tx) => Promise<T>, opts?: { timeout?: number }): Promise<T> {
    const open = currentTx();
    if (open) return fn(open);
    const [c, uid, hod] = rlsSettings();
    const s: TxScope = { afterCommit: [], afterEnd: [] };
    let result: T;
    try {
      result = await scope.run(s, () => this.base.$transaction(async (tx) => {
        s.tx = tx;
        try {
          await tx.$executeRaw`SELECT set_config('app.ctx', ${c}, true), set_config('app.user_id', ${uid}, true), set_config('app.is_hod', ${hod}, true)`;
          return await fn(tx);
        } finally {
          s.tx = undefined;
        }
      }, { timeout: opts?.timeout ?? 20000, maxWait: config().DB_TX_MAX_WAIT_MS }));
    } catch (err) {
      for (const f of s.afterEnd) await f();
      throw err;
    }
    for (const f of [...s.afterCommit, ...s.afterEnd]) await f();
    return result;
  }

  async onModuleDestroy() {
    await this.base.$disconnect();
  }
}
