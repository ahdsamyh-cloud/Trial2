// Applies idempotent, repo-owned SQL (triggers, RLS, grants) after `prisma migrate deploy`, as the owner role.
// Runtime role name can be overridden with APP_DB_ROLE.
const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { Client } = require('pg');
(async () => {
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  const role = process.env.APP_DB_ROLE || 'ldms_app'; // nosemgrep: ajinabraham.njsscan.database.sql_injection.node_sqli_injection -- repo-owned SQL files; role name is regex-validated
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error('invalid APP_DB_ROLE');
  const client = new Client({ connectionString: url });
  await client.connect();
  const dir = join(__dirname, '..', 'prisma', 'sql'); // nosemgrep: ajinabraham.njsscan.database.sql_injection.node_sqli_injection -- repo-owned SQL files; role name is regex-validated
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await client.query(readFileSync(join(dir, f), 'utf8').replaceAll('ldms_app', role)); // nosemgrep: ajinabraham.njsscan.database.sql_injection.node_sqli_injection -- repo-owned SQL files; role name is regex-validated
    console.log('applied', f);
  }
  await client.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
