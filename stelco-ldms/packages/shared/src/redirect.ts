/**
 * SECURITY: open-redirect guard for the post-login `?next=` parameter.
 *
 * Only same-origin, path-absolute targets are allowed. The earlier check
 * (`startsWith('/') && !startsWith('//')`) let `/\evil.com` through: browsers
 * normalise `\` to `/`, so that value navigates to `//evil.com` (another site).
 * We also refuse control characters/whitespace (which browsers strip, turning
 * `/\t/evil.com` into `//evil.com`) and any value that resolves to another origin.
 */
export function safeRedirectPath(next: string | null | undefined, fallback = '/'): string {
  if (!next || next.length > 2000) return fallback;
  if (!next.startsWith('/') || next.startsWith('//')) return fallback;
  if (/[\\\u0000- \u007f]/.test(next)) return fallback;
  try {
    const base = 'https://ldms.invalid';
    const u = new URL(next, base);
    if (u.origin !== base) return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback; // malformed URL: fail closed to the safe default
  }
}
