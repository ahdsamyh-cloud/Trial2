import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { UNITS } from '@ldms/shared';
import { Can } from '../../common/decorators';
import { parse } from '../../common/zod';
import { DashboardService } from './dashboard.service';

const filter = z.object({ unit: z.enum(UNITS).optional(), departmentId: z.string().max(40).optional(), assigneeId: z.string().max(40).optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional() });

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dash: DashboardService) {}

  @Get()
  @Can('dashboard:hod', 'dashboard:unit')
  overview(@Query() q: unknown) {
    return this.dash.overview(parse(filter, q));
  }

  @Get('management')
  @Can('dashboard:mgmt')
  management(@Query() q: unknown) {
    return this.dash.management(parse(filter.pick({ from: true, to: true }), q));
  }
}
