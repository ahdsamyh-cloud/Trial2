import { Injectable, OnModuleInit } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../../common/prisma.service';
import { config } from '../../config';
import { logger } from '../../common/logger';
import { JobsService } from '../jobs/jobs.service';

export interface NotifyInput {
  type: string;
  title: string;
  body?: string;
  link?: string;
  matterId?: string;
  /** Restricted content: email carries only a generic line, never the title/body. */
  restricted?: boolean;
  /** Send email even if the user turned email notifications off (security notices). */
  emailAlways?: boolean;
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private transport?: nodemailer.Transporter;

  constructor(private readonly prisma: PrismaService, private readonly jobs: JobsService) {}

  onModuleInit() {
    this.jobs.register('mail.send', (d: { id: string }) => this.sendOutbox(d.id));
    this.jobs.register('mail.flush', () => this.flushOutbox());
    this.jobs.register('digest.daily', () => this.sendDigests('DAILY'));
    this.jobs.register('digest.weekly', () => this.sendDigests('WEEKLY'));
  }

  /** In-app notification always; email via the SMTP relay outbox if enabled and allowed. */
  async notify(userIds: (string | null | undefined)[], n: NotifyInput) {
    const ids = [...new Set(userIds.filter((x): x is string => !!x))];
    if (!ids.length) return;
    await this.prisma.base.notification.createMany({
      data: ids.map((userId) => ({ userId, type: n.type, title: n.title.slice(0, 300), body: n.body?.slice(0, 4000), link: n.link, matterId: n.matterId })),
    });
    if (!config().SMTP_ENABLED) return;
    const users = await this.prisma.base.user.findMany({ where: { id: { in: ids }, status: 'ACTIVE' }, include: { pref: true } });
    for (const u of users) {
      const wantsEmail = n.emailAlways || (u.pref?.email ?? true);
      if (!wantsEmail || (u.pref?.digest && u.pref.digest !== 'NONE' && !n.emailAlways && !n.type.startsWith('sla.'))) continue;
      const subject = n.restricted ? 'LDMS: you have a new notification' : `LDMS: ${n.title}`;
      const text = n.restricted
        ? `You have a new notification about a confidential matter. Sign in to LDMS to view it:\n${config().APP_ORIGIN}${n.link ?? '/notifications'}`
        : `${n.title}\n\n${n.body ?? ''}\n\n${config().APP_ORIGIN}${n.link ?? '/notifications'}`;
      await this.email(u.email, subject, text);
    }
  }

  async email(to: string, subject: string, text: string) {
    if (!config().SMTP_ENABLED) return;
    const row = await this.prisma.base.emailOutbox.create({ data: { to, subject: subject.slice(0, 250), text } });
    await this.jobs.enqueue('mail.send', { id: row.id });
  }

  private mailer() {
    const c = config();
    this.transport ??= nodemailer.createTransport({
      host: c.SMTP_HOST, port: c.SMTP_PORT, secure: c.SMTP_SECURE, requireTLS: c.SMTP_REQUIRE_TLS,
      auth: c.SMTP_USER ? { user: c.SMTP_USER, pass: c.SMTP_PASS } : undefined,
      tls: { minVersion: 'TLSv1.2' },
    });
    return this.transport;
  }

  async sendOutbox(id: string) {
    const row = await this.prisma.base.emailOutbox.findUnique({ where: { id } });
    if (!row || row.status === 'SENT') return;
    try {
      await this.mailer().sendMail({ from: config().SMTP_FROM, to: row.to, subject: row.subject, text: row.text });
      await this.prisma.base.emailOutbox.update({ where: { id }, data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 } } });
    } catch (err) {
      const attempts = row.attempts + 1;
      await this.prisma.base.emailOutbox.update({ where: { id }, data: { attempts, lastError: String(err).slice(0, 300), status: attempts >= 5 ? 'FAILED' : 'PENDING' } });
      logger.warn({ outboxId: id, attempts }, 'email send failed');
    }
  }

  async flushOutbox() {
    const pending = await this.prisma.base.emailOutbox.findMany({ where: { status: 'PENDING', attempts: { lt: 5 } }, take: 100, orderBy: { createdAt: 'asc' } });
    for (const p of pending) await this.sendOutbox(p.id);
  }

  async sendDigests(freq: 'DAILY' | 'WEEKLY') {
    const users = await this.prisma.base.user.findMany({ where: { status: 'ACTIVE', pref: { digest: freq } } });
    for (const u of users) {
      const items = await this.prisma.base.notification.findMany({ where: { userId: u.id, digested: false, readAt: null }, orderBy: { createdAt: 'asc' }, take: 50 });
      if (!items.length) continue;
      const lines = items.map((i) => `• ${i.matterId ? 'Matter update' : i.title}`).join('\n');
      await this.email(u.email, `LDMS ${freq.toLowerCase()} digest: ${items.length} item(s)`, `${lines}\n\nOpen LDMS: ${config().APP_ORIGIN}/notifications`);
      await this.prisma.base.notification.updateMany({ where: { id: { in: items.map((i) => i.id) } }, data: { digested: true } });
    }
  }

  /** Users with a given role (optionally for a unit). */
  async usersWithRole(role: string, unit?: string | null): Promise<string[]> {
    const rows = await this.prisma.base.userRole.findMany({
      where: { role: role as never, ...(unit ? { unit: unit as never } : {}), user: { status: 'ACTIVE' } },
      select: { userId: true },
    });
    return [...new Set(rows.map((r) => r.userId))];
  }
}
