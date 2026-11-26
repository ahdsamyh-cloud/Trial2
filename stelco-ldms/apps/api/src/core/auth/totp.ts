import { authenticator } from 'otplib';

authenticator.options = { step: 30, window: 1, digits: 6, algorithm: 'sha1' as never };

export function newTotpSecret(): string {
  return authenticator.generateSecret(20);
}

export function otpauthUrl(username: string, secret: string): string {
  return authenticator.keyuri(username, 'STELCO Legal', secret);
}

/**
 * Verify a TOTP code and return the time-step it matched, or null.
 * Callers reject steps ≤ the last accepted step (no code reuse).
 */
export function verifyTotp(code: string, secret: string, now = Date.now()): number | null {
  if (code.length !== 6 || ![...code].every((c) => c >= '0' && c <= '9')) return null;
  const delta = authenticator.checkDelta(code, secret);
  if (delta === null) return null;
  return Math.floor(now / 1000 / 30) + delta;
}

export function totpNow(secret: string): string {
  return authenticator.generate(secret);
}
