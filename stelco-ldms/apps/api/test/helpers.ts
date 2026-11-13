import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { authenticator } from 'otplib';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/bootstrap';
import { closeRedis } from '../src/common/redis';

export const ORIGIN = 'http://localhost:3000';
export const db = new PrismaClient({ datasources: { db: { url: process.env.MIGRATION_DATABASE_URL } } });

let app: INestApplication | undefined;
export async function getApp() {
  if (!app) {
    app = await createApp();
    await app.init();
  }
  return app;
}
export async function closeApp() {
  await app?.close();
  app = undefined;
  await closeRedis();
}

/** Minimal cookie-aware client that sends Origin + CSRF like the real web app. */
export class Client {
  cookies = new Map<string, string>();
  constructor(private readonly app: INestApplication) {}

  private absorb(res: request.Response) {
    const set = res.headers['set-cookie'] as unknown as string[] | undefined;
    for (const c of set ?? []) {
      const [pair] = c.split(';');
      const [k, ...v] = pair!.split('=');
      const val = v.join('=');
      if (/Expires=Thu, 01 Jan 1970/.test(c) || val === '') this.cookies.delete(k!);
      else this.cookies.set(k!, val);
    }
    return res;
  }
  private cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  private send(method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string) {
    const r = request(this.app.getHttpServer())[method](`/api${path}`).set('Cookie', this.cookieHeader()).set('Origin', ORIGIN);
    const csrf = this.cookies.get('ldms_csrf');
    if (csrf) r.set('x-csrf-token', csrf);
    return r;
  }
  async get(path: string) { return this.absorb(await this.send('get', path)); }
  async del(path: string) { return this.absorb(await this.send('delete', path)); }
  async post(path: string, body?: object) { return this.absorb(await this.send('post', path).send(body ?? {})); }
  async put(path: string, body?: object) { return this.absorb(await this.send('put', path).send(body ?? {})); }
  async patch(path: string, body?: object) { return this.absorb(await this.send('patch', path).send(body ?? {})); }
  async upload(path: string, fields: Record<string, string>, files: Record<string, { name: string; data: Buffer }[]>) {
    let r = this.send('post', path);
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    for (const [k, list] of Object.entries(files)) for (const f of list) r = r.attach(k, f.data, f.name);
    return this.absorb(await r);
  }
}

export const TOTP_SECRET = process.env.DEMO_TOTP_SECRET!;
export function totp(offsetSteps = 0, secret = TOTP_SECRET) {
  return authenticator.clone({ epoch: Date.now() + offsetSteps * 30_000 }).generate(secret);
}

/**
 * Signed-in client without going through TOTP (TOTP codes cannot be reused, so tests that
 * are not about sign-in use a directly created FULL session). Mirrors SessionService.
 */
export async function as(username: string, opts: { reauth?: boolean } = {}): Promise<Client> {
  const a = await getApp();
  const user = await db.user.findUniqueOrThrow({ where: { username } });
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await db.session.create({
    data: { userId: user.id, tokenHash, stage: 'FULL', absoluteExpiry: new Date(Date.now() + 8 * 3600_000), reauthAt: opts.reauth ? new Date() : null },
  });
  const c = new Client(a);
  c.cookies.set('ldms_sid', token);
  c.cookies.set('ldms_csrf', createHmac('sha256', Buffer.from(process.env.SIGNING_KEY!, 'base64')).update(`csrf:${tokenHash}`).digest('base64url'));
  return c;
}

export async function userId(username: string) {
  return (await db.user.findUniqueOrThrow({ where: { username } })).id;
}

export const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
export const EICAR = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');

export function sampleEml(id = `<${randomBytes(6).toString('hex')}@stelco.com.mv>`) {
  return Buffer.from([
    'From: "Finance Focal" <finance@stelco.com.mv>',
    'To: legal@stelco.com.mv',
    'Subject: Review of fuel supply agreement',
    `Message-ID: ${id}`,
    'Date: Sun, 15 Nov 2026 09:30:00 +0500',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="b1"',
    '',
    '--b1',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p onclick="alert(1)">Please review the attached agreement.</p><script>alert(2)</script><img src="https://tracker.example/x.png"><a href="javascript:alert(3)">x</a>',
    '--b1',
    'Content-Type: text/plain; name="notes.txt"',
    'Content-Disposition: attachment; filename="notes.txt"',
    '',
    'Key commercial terms attached.',
    '--b1--',
    '',
  ].join('\r\n'));
}
