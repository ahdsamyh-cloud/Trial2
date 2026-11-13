import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../common/prisma.service';
import { CryptoService } from '../../common/crypto.service';
import { ctx, currentUser } from '../../common/context';
import { badRequest, DomainError } from '../../common/errors';
import { hit } from '../../common/rate-limit';
import { config } from '../../config';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SecurityAlerts } from '../notifications/security-alerts.service';
import { checkPassword, dummyHash, hashPassword, hashSecret, verifyHash } from './passwords';
import { newTotpSecret, otpauthUrl, verifyTotp } from './totp';
import { SessionService } from './session.service';

const GENERIC_LOGIN_ERROR = 'Incorrect username or password';
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
const BACKUP_CODE_COUNT = 10;

type LoginNext = 'MFA' | 'ENROL_MFA';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly alerts: SecurityAlerts,
  ) {}

  // ------------------------------------------------------------------ login (step 1: password)
  async login(username: string, password: string, req: Request, res: Response): Promise<{ next: LoginNext }> {
    const ipOk = await hit(`login-ip:${req.ip}`, 20, 60);
    if (!ipOk) throw new DomainError(429, 'Too many sign-in attempts from this network. Wait a minute and try again.');

    const user = await this.prisma.base.user.findUnique({ where: { username: username.toLowerCase() }, include: { credential: true, mfaFactors: true } });
    const now = new Date();

    if (!user || !user.credential || user.status !== 'ACTIVE' || (user.accessExpiresAt && user.accessExpiresAt < now)) {
      await verifyHash(await dummyHash(), password); // equalise timing
      await this.audit.log({ action: 'auth.login.failed', outcome: 'FAILURE', actorId: user?.id ?? null, actorName: username.slice(0, 64), meta: { reason: user ? 'inactive' : 'unknown-user' } });
      throw new DomainError(401, GENERIC_LOGIN_ERROR);
    }

    if (user.lockedUntil && user.lockedUntil > now) {
      await verifyHash(await dummyHash(), password);
      await this.audit.log({ action: 'auth.login.locked', outcome: 'DENIED', actorId: user.id, actorName: user.username });
      throw new DomainError(401, GENERIC_LOGIN_ERROR);
    }

    const ok = await verifyHash(user.credential.passwordHash, password);
    if (!ok) {
      const failed = user.failedCount + 1;
      const lock = failed >= MAX_FAILURES;
      const recentLockouts = user.lastLockoutAt && now.getTime() - user.lastLockoutAt.getTime() < 86400_000 ? user.lockoutCount24h : 0;
      await this.prisma.base.user.update({
        where: { id: user.id },
        data: lock
          ? { failedCount: 0, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000), lockoutCount24h: recentLockouts + 1, lastLockoutAt: now }
          : { failedCount: failed },
      });
      await this.audit.log({ action: lock ? 'auth.lockout' : 'auth.login.failed', outcome: 'FAILURE', actorId: user.id, actorName: user.username, meta: { failures: failed } });
      if (lock && recentLockouts + 1 >= 3) await this.alerts.repeatedLockout(user.username, recentLockouts + 1);
      // Increasing delay: 1, 2, 4, 8 s (base configurable; 0 in tests)
      await sleep(Math.min(8, 2 ** (failed - 1)) * config().LOGIN_DELAY_BASE_MS);
      throw new DomainError(401, GENERIC_LOGIN_ERROR);
    }

    await this.prisma.base.user.update({ where: { id: user.id }, data: { failedCount: 0, lockedUntil: null } });
    const { session, token } = await this.sessions.create(user.id, req, 'PENDING_MFA');
    this.sessions.setCookies(res, token, session.tokenHash);
    const hasMfa = user.mfaFactors.some((f) => f.verifiedAt);
    await this.audit.log({ action: 'auth.password.ok', actorId: user.id, actorName: user.username });
    return { next: hasMfa ? 'MFA' : 'ENROL_MFA' };
  }

  // ------------------------------------------------------------------ step 2: TOTP / backup code
  async verifySecondFactor(sessionId: string, code: string, req: Request, res: Response) {
    const session = await this.prisma.base.session.findUnique({ where: { id: sessionId } });
    if (!session || session.stage !== 'PENDING_MFA' || session.revokedAt) throw new DomainError(401, 'Please sign in again');
    if (!(await hit(`mfa:${session.userId}`, 10, 300))) throw new DomainError(429, 'Too many attempts. Wait a few minutes.');

    const ok = await this.checkSecondFactor(session.userId, code);
    if (!ok) {
      await this.audit.log({ action: 'auth.mfa.failed', outcome: 'FAILURE', actorId: session.userId });
      throw new DomainError(401, 'That code is not valid');
    }
    return this.completeLogin(session.id, session.userId, req, res, ok);
  }

  /** Returns 'TOTP' | 'BACKUP' on success, null on failure. Enforces no-reuse of TOTP steps. */
  private async checkSecondFactor(userId: string, rawCode: string): Promise<'TOTP' | 'BACKUP' | null> {
    const code = rawCode.replace(/[\s-]/g, '');
    const factor = await this.prisma.base.mfaFactor.findFirst({ where: { userId, verifiedAt: { not: null } } });
    if (factor && /^\d{6}$/.test(code)) {
      const step = verifyTotp(code, this.crypto.decrypt(factor.secretEnc)!);
      if (step !== null && BigInt(step) > factor.lastStep) {
        const upd = await this.prisma.base.mfaFactor.updateMany({ where: { id: factor.id, lastStep: { lt: BigInt(step) } }, data: { lastStep: BigInt(step) } });
        return upd.count === 1 ? 'TOTP' : null;
      }
      return null;
    }
    if (/^[A-Za-z0-9]{10}$/.test(code)) {
      const codes = await this.prisma.base.backupCode.findMany({ where: { userId, usedAt: null } });
      for (const bc of codes) {
        if (await verifyHash(bc.codeHash, code.toUpperCase())) {
          const upd = await this.prisma.base.backupCode.updateMany({ where: { id: bc.id, usedAt: null }, data: { usedAt: new Date() } });
          if (upd.count === 1) {
            await this.audit.log({ action: 'auth.backup-code.used', actorId: userId, meta: { remaining: codes.length - 1 } });
            return 'BACKUP';
          }
        }
      }
    }
    return null;
  }

  private async completeLogin(pendingSessionId: string, userId: string, req: Request, res: Response, method: string) {
    await this.sessions.revoke(pendingSessionId, 'upgraded');
    const { session, token } = await this.sessions.create(userId, req, 'FULL');
    this.sessions.setCookies(res, token, session.tokenHash);
    const deviceHash = this.sessions.ensureDeviceCookie(req, res);
    await this.prisma.base.session.update({ where: { id: session.id }, data: { deviceId: deviceHash, reauthAt: new Date() } });
    const known = await this.prisma.base.knownDevice.findUnique({ where: { userId_deviceHash: { userId, deviceHash } } });
    const user = await this.prisma.base.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    if (!known) {
      await this.prisma.base.knownDevice.create({ data: { userId, deviceHash, label: session.userAgent?.slice(0, 120) } });
      const priorDevices = await this.prisma.base.knownDevice.count({ where: { userId } });
      if (priorDevices > 1) {
        await this.notifications.notify([userId], {
          type: 'security.new-device', title: 'New sign-in to your account',
          body: `A sign-in from a new device (${session.userAgent?.slice(0, 80) ?? 'unknown'}, IP ${req.ip}) at ${new Date().toISOString()}. If this was not you, sign out other sessions and contact IT.`,
          link: '/account/sessions', emailAlways: true,
        });
      }
    } else {
      await this.prisma.base.knownDevice.update({ where: { id: known.id }, data: { lastSeen: new Date() } });
    }
    await this.audit.log({ action: 'auth.login', actorId: userId, actorName: user.username, meta: { method, sessionId: session.id, newDevice: !known } });
    return { ok: true, mustChangePassword: user.mustChangePassword };
  }

  // ------------------------------------------------------------------ TOTP enrolment (first sign-in)
  async startEnrolment(userId: string) {
    const user = await this.prisma.base.user.findUniqueOrThrow({ where: { id: userId }, include: { mfaFactors: true } });
    if (user.mfaFactors.some((f) => f.verifiedAt)) throw badRequest('Two-factor authentication is already set up');
    await this.prisma.base.mfaFactor.deleteMany({ where: { userId, verifiedAt: null } });
    const secret = newTotpSecret();
    await this.prisma.base.mfaFactor.create({ data: { userId, secretEnc: this.crypto.encrypt(secret)! } });
    const url = otpauthUrl(user.username, secret);
    return { secret, otpauthUrl: url, qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 220 }) };
  }

  async finishEnrolment(sessionId: string, userId: string, code: string, req: Request, res: Response) {
    const factor = await this.prisma.base.mfaFactor.findFirst({ where: { userId, verifiedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!factor) throw badRequest('Start the set-up again');
    const step = verifyTotp(code, this.crypto.decrypt(factor.secretEnc)!);
    if (step === null) throw new DomainError(401, 'That code is not valid. Check the time on your phone and try again.');
    await this.prisma.base.mfaFactor.update({ where: { id: factor.id }, data: { verifiedAt: new Date(), lastStep: BigInt(step) } });
    const backupCodes = await this.regenerateBackupCodes(userId);
    await this.audit.log({ action: 'auth.mfa.enrolled', actorId: userId });
    const result = await this.completeLogin(sessionId, userId, req, res, 'TOTP-ENROL');
    return { ...result, backupCodes };
  }

  async regenerateBackupCodes(userId: string): Promise<string[]> {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const codes = Array.from({ length: BACKUP_CODE_COUNT }, () => {
      const bytes = Buffer.from(this.crypto.randomToken(16), 'base64url');
      return Array.from(bytes.subarray(0, 10), (b) => alphabet[b % alphabet.length]).join('');
    });
    const hashes = await Promise.all(codes.map((c) => hashSecret(c)));
    await this.prisma.base.$transaction([
      this.prisma.base.backupCode.deleteMany({ where: { userId } }),
      this.prisma.base.backupCode.createMany({ data: hashes.map((codeHash) => ({ userId, codeHash })) }),
    ]);
    await this.audit.log({ action: 'auth.backup-codes.generated', actorId: userId });
    return codes;
  }

  // ------------------------------------------------------------------ re-authentication for sensitive actions
  async reauth(password: string, code: string) {
    const user = currentUser();
    const cred = await this.prisma.base.localCredential.findUnique({ where: { userId: user.id } });
    if (!(await hit(`reauth:${user.id}`, 10, 300))) throw new DomainError(429, 'Too many attempts. Wait a few minutes.');
    const ok = !!cred && (await verifyHash(cred.passwordHash, password)) && (await this.checkSecondFactor(user.id, code)) !== null;
    await this.audit.log({ action: ok ? 'auth.reauth' : 'auth.reauth.failed', outcome: ok ? 'SUCCESS' : 'FAILURE' });
    if (!ok) throw new DomainError(401, 'Password or code is incorrect');
    await this.prisma.base.session.update({ where: { id: ctx().sessionId! }, data: { reauthAt: new Date() } });
    return { ok: true };
  }

  // ------------------------------------------------------------------ password change
  async changePassword(currentPassword: string, newPassword: string) {
    const user = currentUser();
    const cred = await this.prisma.base.localCredential.findUnique({ where: { userId: user.id } });
    if (!cred || !(await verifyHash(cred.passwordHash, currentPassword))) {
      await this.audit.log({ action: 'auth.password.change.failed', outcome: 'FAILURE' });
      throw new DomainError(401, 'Current password is incorrect');
    }
    await this.setPassword(user.id, newPassword, { username: user.username, displayName: user.displayName });
    await this.sessions.revokeAllForUser(user.id, 'password-changed', ctx().sessionId);
    await this.audit.log({ action: 'auth.password.changed' });
    await this.notifications.notify([user.id], { type: 'security.password-changed', title: 'Your password was changed', emailAlways: true });
    return { ok: true };
  }

  async setPassword(userId: string, newPassword: string, context: { username: string; displayName: string }, mustChange = false) {
    const errors = checkPassword(newPassword, context);
    if (errors.length) throw badRequest(errors[0]!, { errors });
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.base.$transaction([
      this.prisma.base.localCredential.upsert({ where: { userId }, create: { userId, passwordHash }, update: { passwordHash, changedAt: new Date() } }),
      this.prisma.base.user.update({ where: { id: userId }, data: { mustChangePassword: mustChange, failedCount: 0, lockedUntil: null } }),
    ]);
  }

  // ------------------------------------------------------------------ one-time links (setup 24 h, reset 30 min)
  async issueToken(userId: string, purpose: 'SETUP' | 'RESET'): Promise<string> {
    const token = this.crypto.randomToken(32);
    const ttl = purpose === 'SETUP' ? 24 * 3600_000 : 30 * 60_000;
    await this.prisma.base.oneTimeToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } });
    await this.prisma.base.oneTimeToken.create({ data: { userId, purpose, tokenHash: this.crypto.sha256(token), expiresAt: new Date(Date.now() + ttl) } });
    return token;
  }

  async checkToken(token: string) {
    const t = await this.prisma.base.oneTimeToken.findUnique({ where: { tokenHash: this.crypto.sha256(token) }, include: { user: true } });
    if (!t || t.usedAt || t.expiresAt < new Date() || t.user.status === 'DISABLED') throw badRequest('This link is invalid or has expired. Ask an administrator for a new one.');
    return t;
  }

  async useToken(token: string, newPassword: string) {
    const t = await this.checkToken(token);
    await this.setPassword(t.userId, newPassword, { username: t.user.username, displayName: t.user.displayName });
    await this.prisma.base.oneTimeToken.update({ where: { id: t.id }, data: { usedAt: new Date() } });
    if (t.user.status === 'PENDING_SETUP') await this.prisma.base.user.update({ where: { id: t.userId }, data: { status: 'ACTIVE' } });
    await this.sessions.revokeAllForUser(t.userId, `password-${t.purpose.toLowerCase()}`);
    await this.audit.log({ action: t.purpose === 'SETUP' ? 'auth.setup.completed' : 'auth.reset.completed', actorId: t.userId, actorName: t.user.username });
    await this.notifications.notify([t.userId], { type: 'security.password-set', title: 'Your password was set', emailAlways: true });
    return { ok: true };
  }

  /** Self-service reset (only when SMTP is enabled). Always returns the same response. */
  async requestReset(email: string) {
    if (!config().SMTP_ENABLED) return { ok: true };
    if (!(await hit(`reset:${email.toLowerCase()}`, 3, 3600))) return { ok: true };
    const user = await this.prisma.base.user.findUnique({ where: { email: email.toLowerCase() } });
    if (user && user.status === 'ACTIVE' && !user.isAdminAccount) {
      const token = await this.issueToken(user.id, 'RESET');
      await this.notifications.email(user.email, 'Reset your LDMS password',
        `A password reset was requested for your account.\n\nOpen this link within 30 minutes:\n${config().APP_ORIGIN}/reset/${token}\n\nIf you did not ask for this, ignore this email and tell IT.`);
      await this.audit.log({ action: 'auth.reset.requested', actorId: user.id, actorName: user.username });
    }
    return { ok: true };
  }

  async logout(res: Response) {
    const sid = ctx().sessionId;
    if (sid) await this.sessions.revoke(sid, 'logout');
    this.sessions.clearCookies(res);
    await this.audit.log({ action: 'auth.logout' });
    return { ok: true };
  }
}
