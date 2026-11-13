import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { Can } from '../../common/decorators';
import { parse } from '../../common/zod';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('management')
  @Can('report:read')
  async management(@Query() query: unknown, @Res({ passthrough: true }) res: Response) {
    const q = parse(z.object({ kind: z.enum(['monthly', 'annual']).default('monthly'), period: z.string().max(7), format: z.enum(['json', 'xlsx', 'pdf']).default('json') }), query);
    const r = await this.reports.build(q.kind, q.period);
    if (q.format === 'json') return r;
    await this.reports.logExport(q.kind, q.period, q.format);
    const buf = q.format === 'pdf' ? await this.reports.pdf(r) : await this.reports.xlsx(r);
    res.setHeader('Content-Type', q.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="ldms-${q.kind}-report-${q.period}.${q.format}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.end(buf);
  }
}
