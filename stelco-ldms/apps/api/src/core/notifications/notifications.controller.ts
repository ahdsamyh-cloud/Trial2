import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { Authenticated } from '../../common/decorators';
import { currentUser } from '../../common/context';
import { PrismaService } from '../../common/prisma.service';
import { parse, qs } from '../../common/zod';

const prefSchema = z.object({ email: z.boolean(), digest: z.enum(['NONE', 'DAILY', 'WEEKLY']) }).strict();

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Authenticated()
  async list(@Query('unread') unreadQ?: unknown) {
    const unread = qs(unreadQ, 5);
    const userId = currentUser().id;
    const [rows, unreadCount] = await Promise.all([
      this.prisma.base.notification.findMany({ where: { userId, ...(unread === 'true' ? { readAt: null } : {}) }, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.prisma.base.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { rows, unreadCount };
  }

  @Post(':id/read')
  @Authenticated()
  @HttpCode(200)
  async read(@Param('id') id: string) {
    await this.prisma.base.notification.updateMany({ where: { id, userId: currentUser().id }, data: { readAt: new Date() } });
    return { ok: true };
  }

  @Post('read-all')
  @Authenticated()
  @HttpCode(200)
  async readAll() {
    await this.prisma.base.notification.updateMany({ where: { userId: currentUser().id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }

  @Get('preferences')
  @Authenticated()
  async prefs() {
    return (await this.prisma.base.notificationPref.findUnique({ where: { userId: currentUser().id } })) ?? { email: true, digest: 'DAILY' };
  }

  @Put('preferences')
  @Authenticated()
  async setPrefs(@Body() body: unknown) {
    const p = parse(prefSchema, body);
    const userId = currentUser().id;
    return this.prisma.base.notificationPref.upsert({ where: { userId }, create: { userId, ...p }, update: p });
  }
}
