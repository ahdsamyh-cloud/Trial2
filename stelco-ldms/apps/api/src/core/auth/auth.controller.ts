import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AllowPartial, Authenticated, Public } from '../../common/decorators';
import { ctx, currentUser } from '../../common/context';
import { DomainError, notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { parse } from '../../common/zod';
import { AuditService } from '../audit/audit.service';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

const loginSchema = z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(256) }).strict();
const codeSchema = z.object({ code: z.string().trim().min(6).max(12) }).strict();
const reauthSchema = z.object({ password: z.string().min(1).max(256), code: z.string().trim().min(6).max(12) }).strict();
const changeSchema = z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(1).max(256) }).strict();
const tokenSchema = z.object({ token: z.string().min(20).max(200), password: z.string().min(1).max(256) }).strict();
const resetReq = z.object({ email: z.string().email().max(200) }).strict();

type SessionReq = Request & { session?: { id: string; stage: string; userId: string } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Post('login')
  @Public()
  @HttpCode(200)
  login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const b = parse(loginSchema, body);
    return this.auth.login(b.username, b.password, req, res);
  }

  @Post('mfa')
  @Authenticated()
  @AllowPartial()
  @HttpCode(200)
  mfa(@Body() body: unknown, @Req() req: SessionReq, @Res({ passthrough: true }) res: Response) {
    const { code } = parse(codeSchema, body);
    return this.auth.verifySecondFactor(req.session!.id, code, req, res);
  }

  @Post('mfa/enrol')
  @Authenticated()
  @AllowPartial()
  @HttpCode(200)
  async enrol(@Req() req: SessionReq) {
    if (req.session!.stage !== 'PENDING_MFA') throw new DomainError(400, 'Already verified');
    return this.auth.startEnrolment(req.session!.userId);
  }

  @Post('mfa/enrol/verify')
  @Authenticated()
  @AllowPartial()
  @HttpCode(200)
  enrolVerify(@Body() body: unknown, @Req() req: SessionReq, @Res({ passthrough: true }) res: Response) {
    const { code } = parse(codeSchema, body);
    if (req.session!.stage !== 'PENDING_MFA') throw new DomainError(400, 'Already verified');
    return this.auth.finishEnrolment(req.session!.id, req.session!.userId, code, req, res);
  }

  @Post('backup-codes')
  @Authenticated()
  @HttpCode(200)
  async backupCodes() {
    return { backupCodes: await this.auth.regenerateBackupCodes(currentUser().id) };
  }

  @Post('reauth')
  @Authenticated()
  @HttpCode(200)
  reauth(@Body() body: unknown) {
    const b = parse(reauthSchema, body);
    return this.auth.reauth(b.password, b.code);
  }

  @Post('password')
  @Authenticated()
  @AllowPartial()
  @HttpCode(200)
  async change(@Body() body: unknown, @Req() req: SessionReq) {
    if (req.session!.stage !== 'FULL') throw new DomainError(401, 'Two-factor verification required');
    const b = parse(changeSchema, body);
    return this.auth.changePassword(b.currentPassword, b.newPassword);
  }

  @Get('token/:token')
  @Public()
  async checkToken(@Param('token') token: string) {
    const t = await this.auth.checkToken(token);
    return { purpose: t.purpose, username: t.user.username, displayName: t.user.displayName };
  }

  @Post('token')
  @Public()
  @HttpCode(200)
  useToken(@Body() body: unknown) {
    const b = parse(tokenSchema, body);
    return this.auth.useToken(b.token, b.password);
  }

  @Post('reset-request')
  @Public()
  @HttpCode(200)
  resetRequest(@Body() body: unknown) {
    return this.auth.requestReset(parse(resetReq, body).email);
  }

  @Post('logout')
  @Authenticated()
  @AllowPartial()
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    return this.auth.logout(res);
  }

  @Get('me')
  @Authenticated()
  @AllowPartial()
  async me(@Req() req: SessionReq) {
    const u = currentUser();
    return {
      id: u.id, username: u.username, displayName: u.displayName, email: u.email, departmentId: u.departmentId,
      isAdminAccount: u.isAdminAccount, mustChangePassword: u.mustChangePassword, roles: u.roles,
      permissions: [...u.perms.entries()].map(([p, g]) => ({ perm: p, scope: g.scope, units: g.units })),
      stage: req.session!.stage,
    };
  }

  // ------------------------------------------------------------------ own sessions
  @Get('sessions')
  @Authenticated()
  async mySessions() {
    const rows = await this.prisma.base.session.findMany({
      where: { userId: currentUser().id, revokedAt: null, stage: 'FULL', absoluteExpiry: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, createdAt: true, lastSeenAt: true, ip: true, userAgent: true, mobile: true },
    });
    return rows.map((r) => ({ ...r, current: r.id === ctx().sessionId }));
  }

  @Delete('sessions/:id')
  @Authenticated()
  async revokeMine(@Param('id') id: string) {
    const s = await this.prisma.base.session.findFirst({ where: { id, userId: currentUser().id } });
    if (!s) throw notFound('Session');
    await this.sessions.revoke(id, 'user-revoked');
    await this.audit.log({ action: 'session.revoked', entityType: 'Session', entityId: id });
    return { ok: true };
  }

  @Post('sessions/revoke-others')
  @Authenticated()
  @HttpCode(200)
  async revokeOthers() {
    const n = await this.sessions.revokeAllForUser(currentUser().id, 'user-revoked-others', ctx().sessionId);
    await this.audit.log({ action: 'session.revoked-others', meta: { count: n } });
    return { revoked: n };
  }
}
