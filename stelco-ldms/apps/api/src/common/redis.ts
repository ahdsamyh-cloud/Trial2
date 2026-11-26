import IORedis from 'ioredis';
import { config } from '../config';

/** The subset of Redis the API uses outside the job queue (rate limits, health check). */
export interface RedisLike {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  ping(): Promise<string>;
  quit(): Promise<unknown>;
}

/**
 * In-process stand-in for REDIS_URL=memory (local edition: one API process, no Redis server).
 * Counters live in this process only, which is fine for a single-user trial but not for
 * production, where config() refuses it.
 */
export class MemoryRedis implements RedisLike {
  private readonly store = new Map<string, { n: number; expiresAt: number }>();
  private sweep = 0;
  async incr(key: string) {
    const now = Date.now();
    if (++this.sweep % 1000 === 0) for (const [k, v] of this.store) if (v.expiresAt <= now) this.store.delete(k);
    const cur = this.store.get(key);
    const entry = cur && cur.expiresAt > now ? cur : { n: 0, expiresAt: Number.MAX_SAFE_INTEGER };
    entry.n += 1;
    this.store.set(key, entry);
    return entry.n;
  }
  async expire(key: string, seconds: number) {
    const cur = this.store.get(key);
    if (!cur) return 0;
    cur.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }
  async ping() { return 'PONG'; }
  async quit() { this.store.clear(); return 'OK'; }
}

let client: IORedis | undefined;
let memory: MemoryRedis | undefined;

export const usesMemoryRedis = () => config().REDIS_URL === 'memory';

/** Real Redis connection (BullMQ queue/worker). Not available with REDIS_URL=memory. */
export function redis(): IORedis {
  if (usesMemoryRedis()) throw new Error('REDIS_URL=memory has no Redis connection (use QUEUE_INLINE=true)');
  if (!client) client = new IORedis(config().REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
  return client;
}

/** Key-value operations: Redis, or the in-memory stand-in when REDIS_URL=memory. */
export function kv(): RedisLike {
  if (usesMemoryRedis()) return (memory ??= new MemoryRedis());
  return redis();
}

export async function closeRedis() {
  if (client) { await client.quit().catch(() => undefined); client = undefined; }
  if (memory) { await memory.quit(); memory = undefined; }
}
