import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { UNITS } from '@ldms/shared';
import { Can } from '../../common/decorators';
import { parse, qrec } from '../../common/zod';
import { AuditService } from '../audit/audit.service';
import { CalendarService } from './calendar.service';

const q = z.object({
  from: z.coerce.date(), to: z.coerce.date(), unit: z.enum(UNITS).optional(), kind: z.string().max(40).optional(), ownerId: z.string().max(40).optional(),
});

@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendar: CalendarService, private readonly audit: AuditService) {}

  @Get()
  @Can('calendar:read')
  list(@Query() query: unknown) {
    const f = parse(q, query);
    if (f.to.getTime() - f.from.getTime() > 400 * 86400_000) throw new Error('Range too large');
    return this.calendar.list(f);
  }

  /** "Add to my calendar": .ics for one event or a range (opens in Outlook). */
  @Get('ics')
  @Can('calendar:read')
  async ics(@Query() raw: unknown, @Res() res: Response) {
    const query = qrec(raw);
    const ids = query.ids ? query.ids.split(',').slice(0, 200) : null;
    const body = ids ? await this.calendar.ics(ids) : await this.calendar.ics('ALL', parse(q.pick({ from: true, to: true }), query));
    await this.audit.log({ action: 'calendar.ics', meta: { count: ids?.length ?? 'range' } });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="ldms.ics"');
    res.setHeader('Cache-Control', 'no-store');
    res.end(body);
  }
}
