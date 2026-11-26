import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { AdminNetwork, Authenticated, Can } from '../../common/decorators';
import { currentUser } from '../../common/context';
import { badRequest, forbidden, notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { parse, qs, updatable } from '../../common/zod';
import { AuditService } from '../audit/audit.service';
import { CONFIG_ENTITIES, SETTINGS, SETTING_DEFAULTS } from './config.registry';
import { SettingsService } from './settings.service';

@Controller('config')
export class ConfigController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly settings: SettingsService) {}

  private entity(name: string) {
    const e = CONFIG_ENTITIES[name];
    if (!e) throw notFound('Configuration list');
    return e;
  }

  private delegate(model: string) {
    return (this.prisma.base as unknown as Record<string, any>)[model];
  }

  @Get('settings')
  @Can('config:read')
  async getSettings() {
    const rows = await this.prisma.base.systemSetting.findMany();
    const out: Record<string, unknown> = { ...SETTING_DEFAULTS };
    for (const r of rows) out[r.key] = r.value;
    return out;
  }

  @Put('settings/:key')
  @Can('config:manage')
  @AdminNetwork()
  async setSetting(@Param('key') key: string, @Body() body: unknown) {
    const schema = SETTINGS[key];
    if (!schema) throw notFound('Setting');
    const value = parse(z.object({ value: schema }).strict(), body).value;
    const before = await this.settings.get(key);
    await this.prisma.base.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
    this.settings.invalidate();
    await this.audit.log({ action: 'config.setting', entityType: 'SystemSetting', entityId: key, before, after: value });
    return { key, value };
  }

  /** Dhivehi wording of the screens, as corrected in the app (it overrides the built-in draft translation). */
  @Get('i18n/dv')
  @Authenticated()
  async dhivehi() {
    return this.settings.get<Record<string, string>>('i18n.dv');
  }

  /** HoD or IT admin: save corrected Dhivehi wording (English text -> Dhivehi text). Empty values are dropped. */
  @Put('i18n/dv')
  @Authenticated()
  async setDhivehi(@Body() body: unknown) {
    const u = currentUser();
    if (!u.isHod && !u.perms.has('config:manage')) throw forbidden('Only the HoD or the IT administrator can change the Dhivehi wording');
    const { translations } = parse(z.object({ translations: z.record(z.string().max(500), z.string().max(2000)) }).strict(), body);
    const entries = Object.entries(translations).map(([k, v]) => [k, v.trim()] as const).filter(([, v]) => v);
    if (entries.length > 5000) throw badRequest('Too many entries');
    const value = Object.fromEntries(entries);
    const before = await this.settings.get<Record<string, string>>('i18n.dv');
    await this.prisma.base.systemSetting.upsert({ where: { key: 'i18n.dv' }, create: { key: 'i18n.dv', value }, update: { value } });
    this.settings.invalidate();
    const changed = entries.filter(([k, v]) => before[k] !== v).length + Object.keys(before).filter((k) => !(k in value)).length;
    await this.audit.log({ action: 'config.translations', entityType: 'SystemSetting', entityId: 'i18n.dv', meta: { entries: entries.length, changed } });
    return { saved: entries.length };
  }

  @Get(':entity')
  @Authenticated()
  async list(@Param('entity') name: string, @Query('q') qRaw?: unknown) {
    const q = qs(qRaw, 100);
    const e = this.entity(name);
    const user = currentUser();
    if (!user.perms.has('config:read') && !(e.publicRead && user.perms.has('portal:use'))) throw forbidden();
    const where = q ? { OR: e.searchFields.map((f) => ({ [f]: { contains: q, mode: 'insensitive' } })) } : {};
    return this.delegate(e.model).findMany({ where, orderBy: e.orderBy, take: 1000 });
  }

  @Post(':entity')
  @Can('config:manage')
  @AdminNetwork()
  async create(@Param('entity') name: string, @Body() body: unknown) {
    const e = this.entity(name);
    const data = parse(e.schema, body);
    const row = await this.delegate(e.model).create({ data });
    if (name === 'holidays') this.settings.invalidate();
    await this.audit.log({ action: 'config.create', entityType: e.model, entityId: row.id, after: row });
    return row;
  }

  @Patch(':entity/:id')
  @Can('config:manage')
  @AdminNetwork()
  async update(@Param('entity') name: string, @Param('id') id: string, @Body() body: unknown) {
    const e = this.entity(name);
    const data = parse(updatable(e.schema as z.ZodObject), body);
    const before = await this.delegate(e.model).findUnique({ where: { id } });
    if (!before) throw notFound();
    const row = await this.delegate(e.model).update({ where: { id }, data });
    if (name === 'holidays') this.settings.invalidate();
    await this.audit.log({ action: 'config.update', entityType: e.model, entityId: id, before, after: row });
    return row;
  }

  @Delete(':entity/:id')
  @Can('config:manage')
  @AdminNetwork()
  async remove(@Param('entity') name: string, @Param('id') id: string) {
    const e = this.entity(name);
    const before = await this.delegate(e.model).findUnique({ where: { id } });
    if (!before) throw notFound();
    try {
      await this.delegate(e.model).delete({ where: { id } });
    } catch {
      throw badRequest('This item is in use. Mark it inactive instead.');
    }
    if (name === 'holidays') this.settings.invalidate();
    await this.audit.log({ action: 'config.delete', entityType: e.model, entityId: id, before });
    return { ok: true };
  }
}
