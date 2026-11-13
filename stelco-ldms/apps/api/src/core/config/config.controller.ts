import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { AdminNetwork, Authenticated, Can } from '../../common/decorators';
import { currentUser } from '../../common/context';
import { badRequest, forbidden, notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { parse } from '../../common/zod';
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

  @Get(':entity')
  @Authenticated()
  async list(@Param('entity') name: string, @Query('q') q?: string) {
    const e = this.entity(name);
    const user = currentUser();
    if (!user.perms.has('config:read') && !(e.publicRead && user.perms.has('portal:use'))) throw forbidden();
    const where = q ? { OR: e.searchFields.map((f) => ({ [f]: { contains: q.slice(0, 100), mode: 'insensitive' } })) } : {};
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
    const data = parse((e.schema as z.ZodObject).partial(), body);
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
