import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import express from 'express';
import { AppModule } from './app.module';
import { config } from './config';

export async function createApp(): Promise<INestApplication> {
  const c = config();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: c.NODE_ENV === 'test' ? false : ['error', 'warn'], bodyParser: false });
  app.set('trust proxy', c.TRUST_PROXY);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    hsts: { maxAge: 31536000, includeSubDomains: true },
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  }));
  app.use((_req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());
  // No endpoint takes repeated query keys: refuse array-valued parameters outright (type-confusion guard).
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (Object.values(req.query ?? {}).some((v) => typeof v !== 'string')) { res.status(400).json({ message: 'Invalid query parameter' }); return; }
    next();
  });
  // Body-parser errors happen before Nest: answer them generically (no internals).
  app.use((err: { type?: string; status?: number }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err?.type === 'entity.too.large') { res.status(413).json({ message: 'The request is too large' }); return; }
    if (err?.type === 'entity.parse.failed' || err?.type === 'encoding.unsupported') { res.status(400).json({ message: 'The request body is not valid' }); return; }
    next(err);
  });
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  return app;
}
