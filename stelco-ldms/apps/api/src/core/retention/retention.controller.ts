import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Can, ReAuth } from '../../common/decorators';
import { parse, qs } from '../../common/zod';
import { RetentionService } from './retention.service';

@Controller('retention')
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Get('disposals')
  @Can('disposal:approve')
  list(@Query('status') status?: unknown) {
    return this.retention.list(z.enum(['PENDING', 'APPROVED', 'REJECTED', 'DISPOSED']).default('PENDING').parse(qs(status, 20)));
  }

  @Post('disposals/:id')
  @Can('disposal:approve')
  @ReAuth()
  @HttpCode(200)
  decide(@Param('id') id: string, @Body() body: unknown) {
    return this.retention.decide(id, parse(z.object({ approve: z.boolean() }).strict(), body).approve);
  }

  @Post('scan')
  @Can('disposal:approve')
  @HttpCode(200)
  scan() {
    return this.retention.scan();
  }
}
