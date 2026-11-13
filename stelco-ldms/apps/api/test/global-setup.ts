import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { Client } from 'pg';
import './setup-env';

/** Fresh schema + reference/demo data once per integration run. */
export default async function setup() {
  const root = join(__dirname, '..');
  const owner = process.env.MIGRATION_DATABASE_URL!;
  const c = new Client({ connectionString: owner });
  await c.connect();
  await c.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await c.end();
  const env = { ...process.env, DATABASE_URL: owner };
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: root, env, stdio: 'pipe' });
  execFileSync('node', ['scripts/apply-sql.js'], { cwd: root, env, stdio: 'pipe' });
  execFileSync('node', ['-r', '@swc-node/register', 'prisma/seed.ts'], { cwd: root, env, stdio: 'pipe' });
  const IORedis = (await import('ioredis')).default;
  const r = new IORedis(process.env.REDIS_URL!);
  await r.flushdb();
  await r.quit();
}
