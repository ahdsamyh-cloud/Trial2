import { NextRequest } from 'next/server';

/**
 * Backend-for-frontend proxy: the browser only talks to this origin; the NestJS API
 * stays on the internal network (API_INTERNAL_URL) and is never published.
 */
const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
const FORWARD_REQ = ['cookie', 'content-type', 'x-csrf-token', 'origin', 'referer', 'user-agent', 'accept', 'sec-fetch-site', 'content-length'];
const FORWARD_RES = ['content-type', 'content-disposition', 'cache-control', 'x-request-id', 'content-security-policy', 'x-content-type-options'];

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (path.some((p) => p === '..' || p.includes('\\'))) return new Response('Bad request', { status: 400 });
  const url = `${API}/api/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;
  const headers = new Headers();
  for (const h of FORWARD_REQ) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? '';
  if (ip) headers.set('x-forwarded-for', ip);
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const upstream = await fetch(url, {
    method: req.method,
    headers,
    body: hasBody ? req.body : undefined,
    redirect: 'manual',
    // @ts-expect-error Node fetch needs duplex for streamed bodies
    duplex: hasBody ? 'half' : undefined,
    cache: 'no-store',
  });
  const out = new Headers();
  for (const h of FORWARD_RES) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  for (const c of upstream.headers.getSetCookie()) out.append('set-cookie', c);
  out.set('Cache-Control', 'no-store');
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
