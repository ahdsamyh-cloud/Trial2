import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config';

/**
 * Field-level encryption (AES-256-GCM) with a keyring so keys can be rotated:
 * values are stored as `v1.<keyId>.<iv>.<tag>.<ciphertext>` (base64url).
 * Keys come from FIELD_KEYS (injected from Vault / deploy-time secrets).
 */
@Injectable()
export class CryptoService {
  private readonly keys = new Map<string, Buffer>();
  private readonly active: string;
  private readonly signingKey: Buffer;

  constructor() {
    const c = config();
    for (const entry of c.FIELD_KEYS.split(',')) {
      const [id, b64] = entry.split(':');
      const key = Buffer.from(b64 ?? '', 'base64');
      if (!id || key.length !== 32) throw new Error('FIELD_KEYS entries must be id:base64(32 bytes)');
      this.keys.set(id, key);
    }
    if (!this.keys.has(c.FIELD_KEY_ACTIVE)) throw new Error('FIELD_KEY_ACTIVE not in FIELD_KEYS');
    this.active = c.FIELD_KEY_ACTIVE;
    this.signingKey = Buffer.from(c.SIGNING_KEY, 'base64');
  }

  encrypt(plain: string | null | undefined): string | null {
    if (plain === null || plain === undefined) return null;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.active)!, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', this.active, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
  }

  decrypt(value: string | null | undefined): string | null {
    if (!value) return null;
    const [v, keyId, iv, tag, ct] = value.split('.');
    const key = keyId ? this.keys.get(keyId) : undefined;
    if (v !== 'v1' || !key || !iv || !tag || ct === undefined) throw new Error('Unreadable encrypted value');
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  }

  /** True if the value was encrypted with a key other than the active one (rotation job). */
  needsRotation(value: string): boolean {
    return value.split('.')[1] !== this.active;
  }

  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  sha256(s: string | Buffer): string {
    return createHash('sha256').update(s).digest('hex');
  }

  hmac(data: string): string {
    return createHmac('sha256', this.signingKey).update(data).digest('base64url');
  }

  safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && timingSafeEqual(ab, bb);
  }

  /** Signed, expiring token: payload.exp.sig */
  sign(payload: Record<string, string>, ttlSeconds: number): string {
    const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
    return `${body}.${this.hmac(body)}`;
  }

  verify<T extends Record<string, unknown>>(token: string): (T & { exp: number }) | null {
    const [body, sig] = token.split('.');
    if (!body || !sig || !this.safeEqual(sig, this.hmac(body))) return null;
    try {
      const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (typeof data.exp !== 'number' || data.exp < Date.now() / 1000) return null;
      return data;
    } catch {
      return null;
    }
  }
}
