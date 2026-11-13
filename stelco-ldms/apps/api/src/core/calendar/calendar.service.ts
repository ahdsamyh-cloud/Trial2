import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma, Unit } from '@prisma/client';
import * as ics from 'ics';
import { PrismaService, Tx } from '../../common/prisma.service';
import { currentUser } from '../../common/context';
import { config } from '../../config';
import { SettingsService } from '../config/settings.service';
import { JobsService } from '../jobs/jobs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PolicyService } from '../policy/policy.service';

export interface EventInput {
  kind: string;
  unit: Unit;
  title: string;
  sourceType: string;
  sourceId: string;
  startsAt: Date;
  endsAt?: Date | null;
  allDay?: boolean;
  ownerId?: string | null;
  matterId?: string | null;
  restricted?: boolean;
  location?: string | null;
  cancelled?: boolean;
}

/** Unified calendar projection + reminders (30/14/7/1/0 days by default, configurable). */
@Injectable()
export class CalendarService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
    private readonly policy: PolicyService,
  ) {}

  onModuleInit() {
    this.jobs.register('reminders.send', () => this.sendDue());
  }

  async upsert(e: EventInput, tx?: Tx) {
    const db = tx ?? this.prisma.db;
    const data = {
      unit: e.unit, title: e.title.slice(0, 300), startsAt: e.startsAt, endsAt: e.endsAt ?? null, allDay: e.allDay ?? false,
      ownerId: e.ownerId ?? null, matterId: e.matterId ?? null, restricted: e.restricted ?? false, location: e.location ?? null, cancelled: e.cancelled ?? false,
    };
    const ev = await db.calendarEvent.upsert({
      where: { sourceType_sourceId_kind: { sourceType: e.sourceType, sourceId: e.sourceId, kind: e.kind } },
      create: { kind: e.kind, sourceType: e.sourceType, sourceId: e.sourceId, ...data },
      update: data,
    });
    // Recreate future reminders.
    await db.reminder.deleteMany({ where: { eventId: ev.id, sentAt: null } });
    if (!data.cancelled) {
      const offsets = await this.settings.get<number[]>('reminders.offsetsDays');
      const now = Date.now();
      const rows = offsets
        .map((d) => ({ eventId: ev.id, offsetDays: d, sendAt: new Date(e.startsAt.getTime() - d * 86400_000) }))
        .filter((r) => r.sendAt.getTime() > now - 3600_000);
      if (rows.length) await db.reminder.createMany({ data: rows, skipDuplicates: true });
    }
    return ev;
  }

  async cancel(sourceType: string, sourceId: string, tx?: Tx) {
    const db = tx ?? this.prisma.db;
    await db.calendarEvent.updateMany({ where: { sourceType, sourceId }, data: { cancelled: true } });
    await db.reminder.deleteMany({ where: { sentAt: null, event: { sourceType, sourceId } } });
  }

  async sendDue(now = new Date()) {
    const due = await this.prisma.db.reminder.findMany({ where: { sentAt: null, sendAt: { lte: now } }, include: { event: true }, take: 500 });
    for (const r of due) {
      await this.prisma.db.reminder.update({ where: { id: r.id }, data: { sentAt: now } });
      if (r.event.cancelled || r.event.startsAt < new Date(now.getTime() - 86400_000)) continue;
      const when = r.offsetDays === 0 ? 'today' : `in ${r.offsetDays} day(s)`;
      const watchers = r.event.matterId
        ? (await this.prisma.db.matterAssignment.findMany({ where: { matterId: r.event.matterId }, select: { userId: true } })).map((a) => a.userId)
        : [];
      await this.notifications.notify([r.event.ownerId, ...watchers], {
        type: 'reminder', title: `${r.event.kind.replace(/_/g, ' ').toLowerCase()} ${when}: ${r.event.title}`,
        link: r.event.matterId ? `/matters/${r.event.matterId}` : '/calendar', matterId: r.event.matterId ?? undefined, restricted: r.event.restricted,
      });
    }
    return { sent: due.length };
  }

  /** Events visible to the current user: unit scope + ethical wall (RLS repeats the wall). */
  scope(): Prisma.CalendarEventWhereInput {
    const user = currentUser();
    const units = this.policy.units('calendar:read');
    const readUnits = this.policy.units('matter:read');
    if (!units) return { id: '__none__' };
    const unitFilter: Prisma.CalendarEventWhereInput = readUnits === 'ALL' ? {} : { OR: [{ unit: { in: (readUnits ?? []) as Unit[] } }, { ownerId: user.id }] };
    const wall: Prisma.CalendarEventWhereInput = user.isHod ? {} : { OR: [{ restricted: false }, { matter: { access: { some: { userId: user.id } } } }] };
    return { AND: [unitFilter, wall, { cancelled: false }] };
  }

  async list(f: { from: Date; to: Date; unit?: Unit; kind?: string; ownerId?: string }) {
    return this.prisma.db.calendarEvent.findMany({
      where: { AND: [this.scope(), { startsAt: { gte: f.from, lte: f.to } }, f.unit ? { unit: f.unit } : {}, f.kind ? { kind: f.kind } : {}, f.ownerId ? { ownerId: f.ownerId } : {}] },
      orderBy: { startsAt: 'asc' },
      take: 2000,
    });
  }

  async ics(eventIds: string[] | 'ALL', f?: { from: Date; to: Date }): Promise<string> {
    const events = await this.prisma.db.calendarEvent.findMany({
      where: { AND: [this.scope(), eventIds === 'ALL' ? { startsAt: { gte: f!.from, lte: f!.to } } : { id: { in: eventIds } }] },
      take: 2000,
    });
    const toArr = (d: Date): ics.DateArray => [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()];
    const { value, error } = ics.createEvents(events.map((e) => ({
      uid: `${e.id}@ldms.stelco`,
      title: e.restricted ? 'LDMS: confidential matter' : e.title,
      start: toArr(e.startsAt), startInputType: 'utc', startOutputType: 'utc',
      ...(e.endsAt ? { end: toArr(e.endsAt), endInputType: 'utc' as const, endOutputType: 'utc' as const } : { duration: { hours: 1 } }),
      location: e.restricted ? undefined : e.location ?? undefined,
      url: `${config().APP_ORIGIN}${e.matterId ? `/matters/${e.matterId}` : '/calendar'}`,
      categories: [e.unit, e.kind],
      alarms: [{ action: 'display', description: 'Reminder', trigger: { hours: 24, before: true } }],
    })));
    if (error) throw error;
    return value ?? '';
  }
}
