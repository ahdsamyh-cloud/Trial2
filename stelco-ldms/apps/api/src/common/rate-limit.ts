import { Injectable, NestMiddleware } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { redis } from './redis';

/** Fixed-window limiter in Redis. Returns true if allowed. */
export async function hit(key: string, limit: number, windowSec: number): Promise<boolean> {
  const k = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
  const n = await redis().incr(k);
  if (n === 1) await redis().expire(k, windowSec + 1);
  return n <= limit;
}

/**
 * Rate limits: per signed-in session (so an office behind one NAT address is not throttled as a
 * whole) plus a higher per-IP ceiling as a flood backstop. The reverse proxy adds its own layer.
 * Login/MFA/reset have their own stricter limits in AuthService.
 */
@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  async use(req: Request, res: Response, next: NextFunction) {
    const perSession = Number(process.env.RATE_LIMIT_PER_MIN ?? 600);
    const perIp = Number(process.env.RATE_LIMIT_IP_PER_MIN ?? perSession * 10);
    const sid = (req.cookies?.['__Host-ldms_sid'] ?? req.cookies?.ldms_sid) as string | undefined;
    try {
      const ipOk = await hit(`ip:${req.ip}`, perIp, 60);
      const sessionOk = sid ? await hit(`s:${createHash('sha256').update(sid).digest('hex').slice(0, 24)}`, perSession, 60) : await hit(`anon:${req.ip}`, Math.max(60, perSession / 5), 60);
      if (!ipOk || !sessionOk) { res.status(429).json({ message: 'Too many requests. Please wait a minute.' }); return; }
    } catch {
      /* Redis unavailable: fail open for rate limiting only (auth still enforced) */
    }
    next();
  }
}
