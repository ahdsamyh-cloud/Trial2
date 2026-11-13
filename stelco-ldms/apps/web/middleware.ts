import { NextRequest, NextResponse } from 'next/server';

/**
 * Strict CSP with a per-request nonce (no 'unsafe-inline' for scripts or styles),
 * plus the other security headers. Next.js reads the nonce from the request CSP header.
 */
export function middleware(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const dev = process.env.NODE_ENV !== 'production';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? ' ws:' : ''}`,
    "frame-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "manifest-src 'self'",
    "worker-src 'self'",
    ...(req.headers.get('x-forwarded-proto') === 'https' ? ['upgrade-insecure-requests'] : []),
  ].join('; ');

  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('Permissions-Policy', req.nextUrl.pathname.startsWith('/checkin') ? 'camera=(self), microphone=(), geolocation=()' : 'camera=(), microphone=(), geolocation=()');
  if (!dev && req.headers.get('x-forwarded-proto') === 'https') res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // Authenticated pages may contain confidential data: never cache (phones, shared PCs).
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export const config = {
  matcher: [{ source: '/((?!api|_next/static|_next/image|icons|manifest.webmanifest|sw.js).*)' }],
};
