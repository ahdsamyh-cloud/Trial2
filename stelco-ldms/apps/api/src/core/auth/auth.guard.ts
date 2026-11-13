import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { Permission } from '@ldms/shared';
import { ADMIN_NET_KEY, PARTIAL_KEY, PERMISSION_KEY, PUBLIC_KEY, REAUTH_KEY } from '../../common/decorators';
import { ctx } from '../../common/context';
import { DomainError } from '../../common/errors';
import { config } from '../../config';
import { isIPv4 } from 'node:net';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SecurityAlerts } from '../notifications/security-alerts.service';
import { cookieNames, SessionService } from './session.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function ipInAllowlist(ip: string | undefined, list: string): boolean {
  if (!list.trim()) return true;
  if (!ip) return false;
  const clean = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  return list.split(',').map((s) => s.trim()).filter(Boolean).some((entry) => {
    const [base, bitsStr] = entry.split('/');
    if (!bitsStr) return base === clean;
    const toInt = (a: string) => a.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
    const bits = Number(bitsStr);
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return isIPv4(clean) && (toInt(clean) & mask) === (toInt(base!) & mask);
  });
}

/**
 * The single, global gate for every route: session → MFA/password stage → CSRF →
 * permission (deny by default) → re-auth freshness → admin network.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly alerts: SecurityAlerts,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets);
    const allowPartial = this.reflector.getAllAndOverride<boolean>(PARTIAL_KEY, targets);
    const perms = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSION_KEY, targets);
    const needsReauth = this.reflector.getAllAndOverride<boolean>(REAUTH_KEY, targets);
    const adminNet = this.reflector.getAllAndOverride<boolean>(ADMIN_NET_KEY, targets);
    const c = config();

    // Origin check on state-changing requests (CSRF layer 1), including public ones like login.
    if (!SAFE_METHODS.has(req.method)) {
      const origin = req.headers.origin ?? req.headers.referer;
      const site = req.headers['sec-fetch-site'];
      if ((origin && !String(origin).startsWith(c.APP_ORIGIN)) || site === 'cross-site') throw new DomainError(403, 'Cross-site request blocked');
    }

    const token = req.cookies?.[cookieNames().sid];
    const session = await this.sessions.findByToken(token);
    let valid = false;
    if (session && !session.revokedAt) {
      const now = Date.now();
      if (session.absoluteExpiry.getTime() < now) await this.sessions.revoke(session.id, 'absolute-timeout');
      else if (session.lastSeenAt.getTime() + this.sessions.idleLimitMs(session.mobile) < now) await this.sessions.revoke(session.id, 'idle-timeout');
      else valid = true;
    }

    if (valid && session) {
      const user = await this.sessions.loadAuthUser(session.userId);
      if (!user) {
        await this.sessions.revoke(session.id, 'user-inactive');
        valid = false;
      } else {
        const store = ctx();
        store.user = user;
        store.sessionId = session.id;
        (req as Request & { session?: typeof session }).session = session;
        if (Date.now() - session.lastSeenAt.getTime() > 30_000) {
          await this.prisma.base.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
        }
      }
    }
    if (!valid && token) this.sessions.clearCookies(res);

    if (isPublic) return true;
    if (!valid || !session) throw new DomainError(401, 'Please sign in');

    const user = ctx().user!;
    if (!allowPartial) {
      if (session.stage !== 'FULL') throw new DomainError(401, 'Two-factor verification required');
      if (user.mustChangePassword) throw new DomainError(403, 'You must change your password before continuing');
    }

    // CSRF layer 2: double-submit token bound to the session.
    if (!SAFE_METHODS.has(req.method)) {
      const header = req.headers['x-csrf-token'];
      if (typeof header !== 'string' || header !== this.sessions.csrfFor(session.tokenHash)) throw new DomainError(403, 'Invalid or missing CSRF token');
    }

    if (adminNet && !ipInAllowlist(req.ip, c.ADMIN_IP_ALLOWLIST)) {
      await this.deny(req, 'admin-network');
      throw new DomainError(403, 'Admin functions are only available from the office network');
    }

    if (perms === undefined) {
      // Deny by default: a route without @Can/@Authenticated/@Public is a bug.
      await this.deny(req, 'no-permission-metadata');
      throw new DomainError(403, 'You do not have permission to do that');
    }
    if (perms.length > 0 && !perms.some((p) => user.perms.has(p))) {
      await this.deny(req, perms.join('|'));
      throw new DomainError(403, 'You do not have permission to do that');
    }

    if (needsReauth) {
      const fresh = session.reauthAt && Date.now() - session.reauthAt.getTime() < c.REAUTH_WINDOW_MIN * 60_000;
      if (!fresh) throw new DomainError(401, 'Please confirm your password and code to continue', { reauthRequired: true });
    }
    return true;
  }

  private async deny(req: Request, reason: string) {
    await this.audit.log({ action: 'access.denied', outcome: 'DENIED', meta: { method: req.method, path: req.path, reason } });
    await this.alerts.onAccessDenied(ctx().user?.id ?? req.ip ?? 'unknown');
  }
}
