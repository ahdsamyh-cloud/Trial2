#!/usr/bin/env node
/**
 * STELCO LDMS: local edition launcher. Needs only Node.js 22+ (no Docker, no PostgreSQL install,
 * no Redis, no ClamAV). For trying the app on one PC; NOT for production (see source/docs/IT_SETUP.md).
 *
 *   npm install      (once)
 *   npm start        then open http://localhost:3000
 *
 * What it does:
 *  1. Creates data/local.env on first run with random keys and a random demo password.
 *  2. Starts PostgreSQL itself, embedded (PGlite = real PostgreSQL compiled to WebAssembly),
 *     storing the database in data/db, listening on 127.0.0.1 only.
 *  3. Applies the same migrations, triggers, row-level-security policies and grants as production,
 *     and seeds reference data + demo users on the first run.
 *  4. Switches the database session to the restricted application role (ldms_app), so the
 *     row-level-security rules apply exactly as in production.
 *  5. Starts the API (127.0.0.1:4000) and the web app (localhost:3000).
 * Ctrl+C stops everything and saves the database.
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const major = Number(process.versions.node.split('.')[0]);
if (major < 22) {
  console.error(`Node.js 22 or newer is required (you have ${process.versions.node}). Download it from https://nodejs.org`);
  process.exit(1);
}

let PGlite, pg_trgm, PGLiteSocketServer;
try {
  ({ PGlite } = await import('@electric-sql/pglite'));
  ({ pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm'));
  ({ PGLiteSocketServer } = await import('@electric-sql/pglite-socket'));
} catch {
  console.error('Dependencies are missing. Run `npm install` in this folder first, then `npm start`.');
  process.exit(1);
}

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = join(root, 'data');
const apiDir = join(root, 'app', 'api');
const webServer = join(root, 'app', 'web', 'apps', 'web', 'server.js');
const WEB_PORT = Number(process.env.LDMS_PORT ?? 3000);
const API_PORT = Number(process.env.LDMS_API_PORT ?? 4000);
const DB_PORT = Number(process.env.LDMS_DB_PORT ?? 54329);
const APP_ROLE = 'ldms_app';

mkdirSync(join(dataDir, 'storage'), { recursive: true });

// ---------------------------------------------------------------- 1. local secrets (first run)
const base32 = (buf) => {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  return bits.match(/.{1,5}/g).map((c) => A[parseInt(c.padEnd(5, '0'), 2)]).join('');
};
const envFile = join(dataDir, 'local.env');
try {
  // 'wx' = create only if absent (atomic; an existing file is never overwritten).
  writeFileSync(envFile, [
    '# STELCO LDMS local edition - generated on first start. Keep private. Delete the whole data folder to start over.',
    '# Every demo user (hod, uh.lit, lo.lit1, pl.lit, req.fin, auditor, mgmt, adm.it, ...) signs in with DEMO_PASSWORD.',
    `DEMO_PASSWORD=Ldms-${randomBytes(12).toString('base64url')}`,
    `DEMO_TOTP_SECRET=${base32(randomBytes(20))}`,
    `FIELD_KEYS=k1:${randomBytes(32).toString('base64')}`,
    'FIELD_KEY_ACTIVE=k1',
    `SIGNING_KEY=${randomBytes(48).toString('base64')}`,
    '',
  ].join('\n'), { flag: 'wx', mode: 0o600 });
  console.log('First start: created data/local.env with your demo password and keys.');
} catch (err) {
  if (err.code !== 'EEXIST') throw err;
}
const secrets = Object.fromEntries(readFileSync(envFile, 'utf8').split(/\r?\n/)
  .filter((l) => l && !l.startsWith('#') && l.includes('='))
  .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

// ---------------------------------------------------------------- helpers
const portFree = (port, host) => new Promise((resolve) => {
  const s = createServer().once('error', () => resolve(false)).once('listening', () => s.close(() => resolve(true)));
  s.listen(port, host);
});
for (const [port, what, env] of [[WEB_PORT, 'web app', 'LDMS_PORT'], [API_PORT, 'API', 'LDMS_API_PORT'], [DB_PORT, 'database', 'LDMS_DB_PORT']]) {
  if (!(await portFree(port, '127.0.0.1'))) {
    console.error(`Port ${port} (${what}) is already in use. Close the program using it (maybe LDMS is already running), or set ${env} to another port.`);
    process.exit(1);
  }
}
const children = [];
let stopping = false;
function run(label, script, args, opts) {
  // process.execPath = this Node binary; no shell, so it behaves the same on Windows, macOS and Linux.
  const p = spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'inherit', 'inherit'], ...opts });
  children.push(p);
  return new Promise((resolve, reject) => {
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${label} exited with code ${code}`))));
  });
}

// ---------------------------------------------------------------- 2. embedded PostgreSQL
console.log('Starting the embedded PostgreSQL database (first start takes a little longer)...');
const db = await PGlite.create({ dataDir: join(dataDir, 'db'), extensions: { pg_trgm } });
const server = new PGLiteSocketServer({ db, port: DB_PORT, host: '127.0.0.1', maxConnections: 4 });
await server.start();
// pgbouncer=true: no named prepared statements. PGlite has ONE database session shared by every
// client connection, so names like "s0" left by one connection (e.g. the seed) would collide with the next.
const dbUrl = `postgresql://${APP_ROLE}:local@127.0.0.1:${DB_PORT}/postgres?sslmode=disable&pgbouncer=true`;

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  console.log('\nStopping LDMS and saving the database...');
  for (const c of children) if (c.exitCode === null) c.kill();
  await new Promise((r) => setTimeout(r, 500));
  try { await server.stop(); } catch { /* already stopped */ }
  try { await db.close(); } catch { /* already closed */ }
  process.exit(code);
}
process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

try {
  // ------------------------------------------------------------ 3. schema, security rules, seed
  // Migration history in Prisma's own table format, so the database looks exactly like one set up
  // with `prisma migrate deploy` (and the production grants script, which references it, applies).
  await db.exec(`DO $$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN CREATE ROLE ${APP_ROLE} NOLOGIN; END IF; END$$;
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY, "checksum" VARCHAR(64) NOT NULL, "finished_at" TIMESTAMPTZ, "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT, "rolled_back_at" TIMESTAMPTZ, "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "applied_steps_count" INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS _ldms_local_state (key text PRIMARY KEY, done_at timestamptz NOT NULL DEFAULT now());`);
  const applied = new Set((await db.query('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL')).rows.map((r) => r.migration_name));
  const seeded = (await db.query("SELECT 1 FROM _ldms_local_state WHERE key = 'seed'")).rows.length > 0;
  const migDir = join(apiDir, 'prisma', 'migrations');
  for (const m of readdirSync(migDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    if (applied.has(m)) continue;
    console.log(`  applying migration ${m}`);
    const sql = readFileSync(join(migDir, m, 'migration.sql'), 'utf8');
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query('INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count) VALUES ($1, $2, $3, now(), 1)',
        [randomUUID(), createHash('sha256').update(sql).digest('hex'), m]);
    });
  }
  // Triggers (append-only audit log), constraints, full-text indexes, row-level security, grants.
  // Idempotent, so they are re-applied on every start, exactly like production deployments.
  const sqlDir = join(apiDir, 'prisma', 'sql');
  for (const f of readdirSync(sqlDir).filter((f) => f.endsWith('.sql')).sort()) await db.exec(readFileSync(join(sqlDir, f), 'utf8'));

  const childEnv = {
    ...process.env,
    NODE_ENV: 'development',
    ...secrets,
    DATABASE_URL: `${dbUrl}&connection_limit=1&pool_timeout=60`,
    APP_ORIGIN: `http://localhost:${WEB_PORT}`,
    COOKIE_SECURE: 'false',
    TRUST_PROXY: '1',
    REDIS_URL: 'memory',
    QUEUE_INLINE: 'true',
    LOCAL_SCHEDULER: 'true',
    AV_MODE: 'eicar',
    STORAGE_DRIVER: 'fs',
    STORAGE_FS_ROOT: join(dataDir, 'storage'),
    OCR_ENABLED: 'false',
    SMTP_ENABLED: 'false',
    DB_TX_MAX_WAIT_MS: '30000',
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',
    SEED_DEMO: 'true',
  };
  if (!seeded) {
    console.log('  seeding reference data and demo users (first start only)...');
    await run('Seeding', join(apiDir, 'dist-tools', 'prisma', 'seed.js'), [], { cwd: apiDir, env: childEnv });
    await db.query("INSERT INTO _ldms_local_state (key) VALUES ('seed')");
  } else {
    // Reference data only (idempotent upserts): picks up new document/request types after an upgrade.
    await run('Updating reference data', join(apiDir, 'dist-tools', 'prisma', 'seed.js'), [], { cwd: apiDir, env: { ...childEnv, SEED_DEMO: 'false' } });
  }

  // ------------------------------------------------------------ 4. restricted role (RLS applies)
  // PGlite has a single database session. From here on every query from the API runs as ldms_app,
  // which has no owner/superuser rights, so FORCE ROW LEVEL SECURITY is enforced as in production.
  await db.exec(`DEALLOCATE ALL; SET ROLE ${APP_ROLE}`);
  const who = (await db.query('SELECT current_user AS u')).rows[0].u;
  if (who !== APP_ROLE) throw new Error(`database session is "${who}", expected ${APP_ROLE}`);

  // ------------------------------------------------------------ 5. API + web
  console.log('Starting the API...');
  const api = run('The API', join(apiDir, 'dist', 'main.js'), [], { cwd: apiDir, env: { ...childEnv, PORT: String(API_PORT), BIND_HOST: '127.0.0.1' } });
  api.catch((e) => { if (!stopping) { console.error(`\n${e.message}. Stopping.`); void shutdown(1); } });
  for (let i = 0; ; i++) {
    const ok = await fetch(`http://127.0.0.1:${API_PORT}/api/health`).then((r) => r.ok).catch(() => false);
    if (ok) break;
    if (i > 120) throw new Error('the API did not start within 60 seconds');
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log('Starting the web app...');
  const web = run('The web app', webServer, [], {
    cwd: dirname(webServer),
    env: { ...process.env, NODE_ENV: 'production', PORT: String(WEB_PORT), HOSTNAME: '127.0.0.1', API_INTERNAL_URL: `http://127.0.0.1:${API_PORT}`, NEXT_TELEMETRY_DISABLED: '1' },
  });
  web.catch((e) => { if (!stopping) { console.error(`\n${e.message}. Stopping.`); void shutdown(1); } });
  for (let i = 0; ; i++) {
    const ok = await fetch(`http://127.0.0.1:${WEB_PORT}/login`).then((r) => r.ok).catch(() => false);
    if (ok) break;
    if (i > 120) throw new Error('the web app did not start within 60 seconds');
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`
==============================================================================
  STELCO LDMS (local edition) is running:   http://localhost:${WEB_PORT}

  Username : hod  (Head of Department), or uh.lit, lo.lit1, pl.lit, req.fin,
             lo.cmp1, lo.awr1, mgmt, auditor, adm.it ...  (see README.txt)
  Password : the DEMO_PASSWORD line in data${process.platform === 'win32' ? '\\' : '/'}local.env  (open it in Notepad)
  6-digit code : open a second window here and run   npm run code

  Use "localhost" (not 127.0.0.1) in the address bar. Ctrl+C here stops LDMS.
==============================================================================
`);
} catch (err) {
  console.error(`\nCould not start LDMS: ${err.message}`);
  await shutdown(1);
}
