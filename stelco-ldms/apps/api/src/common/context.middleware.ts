import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { als } from './context';
import { logger } from './logger';

/** Per-request context (correlation id, ip) available to services, audit and RLS. */
@Injectable()
export class ContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    const started = Date.now();
    res.on('finish', () => {
      logger.info({ requestId, method: req.method, path: req.path.replace(/\/files\/[^/]+/, '/files/[token]'), status: res.statusCode, ms: Date.now() - started, ip: req.ip }, 'request');
    });
    als.run({ requestId, ip: req.ip, userAgent: req.headers['user-agent']?.slice(0, 300) }, () => next());
  }
}
