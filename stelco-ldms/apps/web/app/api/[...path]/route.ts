import { NextRequest } from 'next/server';

/**
 * Backend-for-frontend proxy: the browser only talks to this origin; the NestJS API
 * stays on the internal network (API_INTERNAL_URL) and is never published.
 *
 * SECURITY notes:
 *  - Only an allow-list of request headers is forwarded (no Host, no hop-by-hop headers).
 *  - X-Forwarded-For: we forward the RIGHTMOST entry. That is the address our own nginx wrote
 *    (it sets X-Forwarded-For to $remote_addr). Any entries to its left could be supplied by the
 *    client, and trusting them would let a caller spoof their IP to dodge per-IP rate limits or the
 *    admin network allow-list.
 *  - The API's own security headers are passed through, and nosniff / no-store are always set, so
 *    JSON and file downloads cannot be MIME-sniffed or cached by shared devices/proxies.
 *  - Upstream calls time out, and failures return a generic message with no internals (the
 *    technical detail is logged on the server).
 */
const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
const UPSTREAM_TIMEOUT_MS = Number(process.env.API_TIMEOUT_MS ?? 120_000);
const FORWARD_REQ = ['cookie', 'content-type', 'x-csrf-token', 'origin', 'referer', 'user-agent', 'accept', 'sec-fetch-site', 'content-length'];
const FORWARD_RES = [
  'content-type', 'content-disposition', 'cache-control', 'x-request-id',
  'content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy',
  'cross-origin-resource-policy', 'cross-origin-opener-policy', 'retry-after',
];

function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  const last = xff?.split(',').map((s) => s.trim()).filter(Boolean).pop();
  return last ?? req.headers.get('x-real-ip') ?? '';
}

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  // Path traversal / smuggling guard: segments are already URL-decoded here.
  if (path.some((p) => p === '..' || p === '.' || p.includes('\\') || p.includes('/') || /[\u0000-\u001f]/.test(p))) {
    return Response.json({ message: 'Bad request' }, { status: 400 });
  }
  const url = `${API}/api/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;
  const headers = new Headers();
  for (const h of FORWARD_REQ) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  const ip = clientIp(req);
  if (ip) headers.set('x-forwarded-for', ip);
  const hasBody = !['GET', 'HEAD'].includes(req.method);

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      redirect: 'manual',
      // @ts-expect-error Node fetch needs duplex for streamed bodies
      duplex: hasBody ? 'half' : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    // Log the technical cause server-side only; the browser gets a friendly, generic message.
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    console.error(JSON.stringify({ level: 'error', msg: 'bff upstream failed', path: path.join('/'), method: req.method, timedOut, err: String(err).slice(0, 300) }));
    return Response.json(
      { message: timedOut ? 'The server took too long to respond. Please try again.' : 'The service is temporarily unavailable. Please try again shortly.' },
      { status: timedOut ? 504 : 502, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
    );
  }

  const out = new Headers();
  for (const h of FORWARD_RES) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  for (const c of upstream.headers.getSetCookie()) out.append('set-cookie', c);
  out.set('Cache-Control', 'no-store');
  out.set('X-Content-Type-Options', 'nosniff');
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
