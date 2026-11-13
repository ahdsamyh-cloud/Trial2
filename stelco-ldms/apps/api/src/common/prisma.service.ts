import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ctx } from './context';

/** Session settings that drive the RLS policies in prisma/sql/03_rls.sql. */
function rlsSettings(): [string, string, string] {
  const c = ctx();
  if (c.system) return ['system', '', 'off'];
  if (c.user) return ['user', c.user.id, c.user.isHod ? 'on' : 'off'];
  return ['anon', '', 'off'];
}

function extend(base: PrismaClient) {
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
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

  /** Interactive transaction with RLS context applied. */
  async tx<T>(fn: (tx: Tx) => Promise<T>, opts?: { timeout?: number }): Promise<T> {
    const [c, uid, hod] = rlsSettings();
    return this.base.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.ctx', ${c}, true), set_config('app.user_id', ${uid}, true), set_config('app.is_hod', ${hod}, true)`;
      return fn(tx);
    }, { timeout: opts?.timeout ?? 20000 });
  }

  async onModuleDestroy() {
    await this.base.$disconnect();
  }
}
