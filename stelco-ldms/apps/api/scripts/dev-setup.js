// Local development database setup (any OS): waits for Postgres, applies migrations,
// triggers/RLS/grants, and seeds reference data (+ demo users when SEED_DEMO=true).
// Uses the owner role (MIGRATION_DATABASE_URL) from apps/api/.env. Safe to re-run.
const { execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join } = require('node:path');
const { Client } = require('pg');

const apiDir = join(__dirname, '..');
const envFile = join(apiDir, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const owner = process.env.MIGRATION_DATABASE_URL;
if (!owner) {
  console.error('MIGRATION_DATABASE_URL is not set. Run `pnpm setup:env` first (creates apps/api/.env).');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
  console.error('dev-setup is for local development only. See docs/IT_SETUP.md for production.');
  process.exit(1);
}

async function waitForDb() {
  for (let i = 1; i <= 45; i++) {
    const c = new Client({ connectionString: owner });
    try { await c.connect(); await c.end(); return; } catch (err) {
      await c.end().catch(() => undefined);
      if (i === 1) console.log('Waiting for Postgres (docker compose -f infra/compose.dev.yml up -d)...');
      if (i === 45) throw new Error(`Postgres is not reachable: ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

function step(label, args) {
  console.log(`\n> ${label}`);
  // process.execPath = this Node binary; no shell, so it behaves the same in cmd, PowerShell and bash.
  execFileSync(process.execPath, args, { cwd: apiDir, stdio: 'inherit', env: { ...process.env, DATABASE_URL: owner } });
}

(async () => {
  await waitForDb();
  step('Apply database migrations', [require.resolve('prisma/build/index.js'), 'migrate', 'deploy']);
  step('Apply triggers, row-level security and grants', [join('scripts', 'apply-sql.js')]);
  step('Seed reference data' + (process.env.SEED_DEMO === 'true' ? ' and demo users' : ''), ['-r', '@swc-node/register', join('prisma', 'seed.ts')]);
  console.log('\nDatabase ready. Start the app with: pnpm dev');
})().catch((err) => { console.error(`\nSetup failed: ${err.message}`); process.exit(1); });
