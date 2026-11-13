import IORedis from 'ioredis';
import { config } from '../config';

let client: IORedis | undefined;
export function redis(): IORedis {
  if (!client) client = new IORedis(config().REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
  return client;
}
export async function closeRedis() {
  if (client) { await client.quit().catch(() => undefined); client = undefined; }
}
