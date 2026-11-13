import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { redis } from './redis';

/** Fixed-window limiter in Redis. Returns true if allowed. */
export async function hit(key: string, limit: number, windowSec: number): Promise<boolean> {
  const k = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
  const n = await redis().incr(k);
  if (n === 1) await redis().expire(k, windowSec + 1);
  return n <= limit;
}

/** Per-IP limit for all API traffic (the reverse proxy applies another layer). */
@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  async use(req: Request, res: Response, next: NextFunction) {
    const ok = await hit(`ip:${req.ip}`, Number(process.env.RATE_LIMIT_PER_MIN ?? 600), 60).catch(() => true);
    if (!ok) { res.status(429).json({ message: 'Too many requests. Please wait a minute.' }); return; }
    next();
  }
}
