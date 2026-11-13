import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';
import { redis } from '../common/redis';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Public()
  async health() {
    const db = await this.prisma.base.$queryRaw`SELECT 1`.then(() => 'ok').catch(() => 'down');
    const r = await redis().ping().then(() => 'ok').catch(() => 'down');
    return { status: db === 'ok' && r === 'ok' ? 'ok' : 'degraded', db, redis: r };
  }
}
