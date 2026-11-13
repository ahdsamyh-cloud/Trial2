import { Injectable } from '@nestjs/common';
import { makeCalendar, WorkCalendar } from '@ldms/shared';
import { PrismaService } from '../../common/prisma.service';
import { SETTING_DEFAULTS } from './config.registry';

/** Cached access to system settings and the business-day calendar. */
@Injectable()
export class SettingsService {
  private cal?: { at: number; value: WorkCalendar };

  constructor(private readonly prisma: PrismaService) {}

  async get<T>(key: string): Promise<T> {
    const row = await this.prisma.base.systemSetting.findUnique({ where: { key } });
    return (row?.value ?? SETTING_DEFAULTS[key]) as T;
  }

  async calendar(): Promise<WorkCalendar> {
    if (this.cal && Date.now() - this.cal.at < 60_000) return this.cal.value;
    const [holidays, workdays, cutoff] = await Promise.all([
      this.prisma.base.holiday.findMany({ select: { date: true } }),
      this.get<number[]>('calendar.workdays'),
      this.get<number>('calendar.cutoffMinutes'),
    ]);
    const value = makeCalendar({ workdays, cutoffMinutes: cutoff, holidays: holidays.map((h) => h.date) });
    this.cal = { at: Date.now(), value };
    return value;
  }

  invalidate() {
    this.cal = undefined;
  }
}
