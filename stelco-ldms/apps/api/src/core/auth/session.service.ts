import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { effectivePermissions, RoleAssignment } from '@ldms/shared';
import { PrismaService } from '../../common/prisma.service';
import { CryptoService } from '../../common/crypto.service';
import { AuthUser } from '../../common/context';
import { config } from '../../config';

export const PENDING_MFA_TTL_MS = 5 * 60_000;

export function cookieNames() {
  const secure = config().COOKIE_SECURE;
  return { sid: secure ? '__Host-ldms_sid' : 'ldms_sid', csrf: secure ? '__Host-ldms_csrf' : 'ldms_csrf', device: secure ? '__Host-ldms_dev' : 'ldms_dev' };
}

export function isMobileUa(ua?: string) {
  return !!ua && /Mobi|Android|iPhone|iPad/i.test(ua);
}

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService, private readonly crypto: CryptoService) {}

  async create(userId: string, req: Request, stage: 'PENDING_MFA' | 'FULL') {
    const token = this.crypto.randomToken(32);
    const now = Date.now();
    const ua = req.headers['user-agent']?.slice(0, 300);
    const session = await this.prisma.base.session.create({
      data: {
        userId,
        tokenHash: this.crypto.sha256(token),
        stage,
        absoluteExpiry: new Date(stage === 'PENDING_MFA' ? now + PENDING_MFA_TTL_MS : now + config().SESSION_ABS_HOURS * 3600_000),
        ip: req.ip,
        userAgent: ua,
        mobile: isMobileUa(ua),
        deviceId: this.deviceHash(req),
      },
    });
    return { session, token };
  }

  deviceHash(req: Request): string | null {
    const dev = req.cookies?.[cookieNames().device];
    return typeof dev === 'string' && dev.length >= 20 ? this.crypto.sha256(dev) : null;
  }

  csrfFor(tokenHash: string) {
    return this.crypto.hmac(`csrf:${tokenHash}`);
  }

  setCookies(res: Response, token: string, tokenHash: string) {
    const secure = config().COOKIE_SECURE;
    const n = cookieNames();
    res.cookie(n.sid, token, { httpOnly: true, secure, sameSite: 'strict', path: '/' });
    res.cookie(n.csrf, this.csrfFor(tokenHash), { httpOnly: false, secure, sameSite: 'strict', path: '/' });
  }

  ensureDeviceCookie(req: Request, res: Response): string {
    const n = cookieNames();
    let dev = req.cookies?.[n.device];
    if (typeof dev !== 'string' || dev.length < 20) {
      dev = this.crypto.randomToken(24);
      res.cookie(n.device, dev, { httpOnly: true, secure: config().COOKIE_SECURE, sameSite: 'strict', path: '/', maxAge: 400 * 86400_000 });
    }
    return this.crypto.sha256(dev);
  }

  clearCookies(res: Response) {
    const n = cookieNames();
    res.clearCookie(n.sid, { path: '/' });
    res.clearCookie(n.csrf, { path: '/' });
  }

  async findByToken(token: string | undefined) {
    if (!token || token.length > 200) return null;
    return this.prisma.base.session.findUnique({ where: { tokenHash: this.crypto.sha256(token) } });
  }

  async revoke(id: string, reason: string) {
    await this.prisma.base.session.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
  }

  async revokeAllForUser(userId: string, reason: string, exceptId?: string) {
    const r = await this.prisma.base.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return r.count;
  }

  idleLimitMs(mobile: boolean) {
    const c = config();
    return (mobile ? c.SESSION_IDLE_MOBILE_MIN : c.SESSION_IDLE_MIN) * 60_000;
  }

  async loadAuthUser(userId: string): Promise<AuthUser | null> {
    const u = await this.prisma.base.user.findUnique({ where: { id: userId }, include: { roles: true } });
    if (!u || u.status !== 'ACTIVE') return null;
    if (u.accessExpiresAt && u.accessExpiresAt < new Date()) return null;
    const now = new Date();
    const roles: RoleAssignment[] = u.roles.filter((r) => !r.expiresAt || r.expiresAt > now).map((r) => ({ role: r.role, unit: r.unit }));
    return {
      id: u.id, username: u.username, displayName: u.displayName, email: u.email, departmentId: u.departmentId,
      isAdminAccount: u.isAdminAccount, mustChangePassword: u.mustChangePassword, roles, perms: effectivePermissions(roles),
      isHod: roles.some((r) => r.role === 'HOD'),
    };
  }
}
