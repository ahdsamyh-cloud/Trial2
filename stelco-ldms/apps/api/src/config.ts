import { z } from 'zod';

const bool = z.enum(['true', 'false']).default('false').transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  APP_ORIGIN: z.string().url().default('http://localhost:3000'),
  COOKIE_SECURE: bool,
  TRUST_PROXY: z.coerce.number().default(1),
  SESSION_IDLE_MIN: z.coerce.number().default(15),
  SESSION_IDLE_MOBILE_MIN: z.coerce.number().default(5),
  SESSION_ABS_HOURS: z.coerce.number().default(8),
  REAUTH_WINDOW_MIN: z.coerce.number().default(5),
  /** Comma-separated keyring: id:base64(32 bytes) */
  FIELD_KEYS: z.string().min(1),
  FIELD_KEY_ACTIVE: z.string().min(1),
  /** HMAC key for signed download URLs and CSRF tokens (base64, ≥32 bytes). */
  SIGNING_KEY: z.string().min(40),
  STORAGE_DRIVER: z.enum(['fs', 's3']).default('fs'),
  STORAGE_FS_ROOT: z.string().default('./var/storage'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('ldms-documents'),
  S3_QUARANTINE_BUCKET: z.string().default('ldms-quarantine'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool,
  AV_MODE: z.enum(['clamd', 'off']).default('clamd'),
  CLAMD_HOST: z.string().default('localhost'),
  CLAMD_PORT: z.coerce.number().default(3310),
  SMTP_ENABLED: bool,
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(25),
  SMTP_SECURE: bool,
  SMTP_REQUIRE_TLS: bool,
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('LDMS <no-reply-legal@stelco.com.mv>'),
  QUEUE_INLINE: bool,
  LOGIN_DELAY_BASE_MS: z.coerce.number().default(1000),
  ADMIN_IP_ALLOWLIST: z.string().default(''),
  MAX_UPLOAD_MB: z.coerce.number().default(50),
  OCR_ENABLED: bool,
  OCR_MAX_PAGES: z.coerce.number().default(50),
  BREACHED_PASSWORDS_FILE: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | undefined;
export function config(): AppConfig {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Names only — never print values.
    throw new Error(`Invalid configuration: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  }
  const c = parsed.data;
  if (c.NODE_ENV === 'production') {
    if (c.AV_MODE === 'off') throw new Error('AV_MODE=off is not allowed in production');
    if (!c.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production');
    if (c.QUEUE_INLINE) throw new Error('QUEUE_INLINE is not allowed in production');
  }
  cached = c;
  return c;
}

export function resetConfigForTests() {
  cached = undefined;
}
