// Test configuration: isolated database (runtime role), inline jobs, real ClamAV with the EICAR test signature.
//
// SECURITY: no credentials or keys are hard-coded here.
//  - Database URLs come from the environment, or from an optional git-ignored `apps/api/.env.test`
//    (copy `.env.test.example`). CI sets them as job environment variables.
//  - Demo password, TOTP secret, field-encryption keys and the signing key are generated randomly
//    once per run (unless supplied). global-setup imports this file first, so the values it creates
//    are inherited by every test worker and match the freshly seeded database.
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const envFile = join(__dirname, '..', '.env.test');
if (existsSync(envFile)) process.loadEnvFile(envFile);

for (const k of ['DATABASE_URL', 'MIGRATION_DATABASE_URL'] as const) {
  if (!process.env[k]) throw new Error(`${k} is not set. Export it or create apps/api/.env.test from .env.test.example.`);
}
if (!/ldms_test|_test\b/.test(process.env.MIGRATION_DATABASE_URL!)) {
  // global-setup DROPs the public schema: refuse to run against anything that is not a test database.
  throw new Error('MIGRATION_DATABASE_URL must point at a *_test database (the integration run wipes it).');
}

const b32 = (bytes: Buffer) => {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  return bits.match(/.{1,5}/g)!.map((c) => A[parseInt(c.padEnd(5, '0'), 2)]).join('');
};

process.env.NODE_ENV = 'test';
process.env.REDIS_URL ??= 'redis://localhost:6379/5';
process.env.APP_ORIGIN = 'http://localhost:3000';
process.env.FIELD_KEYS ??= `k1:${randomBytes(32).toString('base64')},k0:${randomBytes(32).toString('base64')}`;
process.env.FIELD_KEY_ACTIVE ??= 'k1';
process.env.SIGNING_KEY ??= randomBytes(48).toString('base64');
process.env.STORAGE_DRIVER = 'fs';
process.env.STORAGE_FS_ROOT ??= '/tmp/ldms-test-storage';
process.env.AV_MODE ??= 'clamd';
process.env.QUEUE_INLINE = 'true';
process.env.SMTP_ENABLED = 'false';
process.env.LOGIN_DELAY_BASE_MS = '0';
process.env.RATE_LIMIT_PER_MIN = '100000';
process.env.RATE_LIMIT_IP_PER_MIN = '1000000';
process.env.SEED_DEMO = 'true';
process.env.DEMO_PASSWORD ??= `test-${randomBytes(18).toString('base64url')}`;
process.env.DEMO_TOTP_SECRET ??= b32(randomBytes(20));
process.env.OCR_ENABLED = 'false';
