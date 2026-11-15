import { Body, Controller, Get, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { UNITS } from '@ldms/shared';
import type { Unit } from '@prisma/client';
import { Can } from '../../common/decorators';
import { badRequest } from '../../common/errors';
import { parse, qrec } from '../../common/zod';
import { uploadInterceptor } from '../documents/documents.controller';
import { ExportService } from '../export/export.service';
import { ReportsService } from './reports.service';
import { ReportTemplatesService } from './report-templates.service';

const unitParam = z.enum(UNITS).nullish();
const templateFields = z.object({
  name: z.string().trim().min(2).max(200),
  unit: z.union([z.enum(UNITS), z.literal('')]).optional().transform((v) => (v ? v : null)),
  period: z.enum(['WEEKLY', 'MONTHLY', 'ANY']).default('ANY'),
}).strict();

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService, private readonly templates: ReportTemplatesService, private readonly exporter: ExportService) {}

  /** Built-in management report: weekly (period = any date in the week), monthly (YYYY-MM) or annual (YYYY); optional unit. */
  @Get('management')
  @Can('report:read')
  async management(@Query() query: unknown, @Res({ passthrough: true }) res: Response) {
    const q = parse(z.object({ kind: z.enum(['weekly', 'monthly', 'annual']).default('monthly'), period: z.string().max(10), format: z.enum(['json', 'xlsx', 'pdf']).default('json'), unit: unitParam }), query);
    const r = await this.reports.build(q.kind, q.period, (q.unit as Unit | null | undefined) ?? null);
    if (q.format === 'json') return r;
    await this.reports.logExport(q.kind, q.period, q.format);
    const buf = q.format === 'pdf' ? await this.reports.pdf(r) : await this.reports.xlsx(r);
    this.exporter.sendFile(res, `ldms-${q.unit ? `${q.unit.toLowerCase()}-` : ''}${q.kind}-report-${q.period}.${q.format}`, buf, q.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  // ------------------------------------------------------------------ uploaded report formats
  @Get('fields')
  @Can('report:read')
  fields() {
    return this.templates.fields();
  }

  /** Live data for a period, as the placeholders will see it (preview). */
  @Get('data')
  @Can('report:read')
  data(@Query() query: unknown) {
    const q = qrec(query, ['period', 'ref', 'unit']);
    return this.templates.data(this.unit(q.unit), this.period(q.period), q.ref ?? '');
  }

  @Get('sample-template')
  @Can('report:read')
  async sample(@Query() query: unknown, @Res({ passthrough: true }) res: Response) {
    const q = qrec(query, ['unit']);
    const unit = this.unit(q.unit);
    this.exporter.sendFile(res, `report-format-sample${unit ? `-${unit.toLowerCase()}` : ''}.xlsx`, await this.templates.sample(unit), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  @Get('templates')
  @Can('report:read')
  list() {
    return this.templates.list();
  }

  @Post('templates')
  @Can('report:read')
  @UseInterceptors(uploadInterceptor())
  create(@Body() body: unknown, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw badRequest('Choose the Excel or Word file of the report format');
    const b = parse(templateFields, body);
    return this.templates.create({ name: b.name, unit: b.unit as Unit | null, period: b.period }, file);
  }

  @Patch('templates/:id')
  @Can('report:read')
  @UseInterceptors(uploadInterceptor())
  update(@Param('id') id: string, @Body() body: unknown, @UploadedFile() file?: Express.Multer.File) {
    const b = parse(z.object({
      name: z.string().trim().min(2).max(200).optional(),
      unit: z.union([z.enum(UNITS), z.literal('')]).optional().transform((v) => (v === undefined ? undefined : v || null)),
      period: z.enum(['WEEKLY', 'MONTHLY', 'ANY']).optional(),
      active: z.enum(['true', 'false']).optional().transform((v) => (v === undefined ? undefined : v === 'true')),
    }).strict(), body);
    return this.templates.update(id, { ...b, unit: b.unit as Unit | null | undefined }, file);
  }

  @Get('templates/:id/generate')
  @Can('report:read')
  async generate(@Param('id') id: string, @Query() query: unknown, @Res({ passthrough: true }) res: Response) {
    const q = qrec(query, ['period', 'ref', 'unit']);
    const out = await this.templates.generate(id, this.period(q.period), q.ref ?? '', q.unit === undefined ? undefined : this.unit(q.unit));
    this.exporter.sendFile(res, out.filename, out.buffer, out.mime);
  }

  private period(p?: string): 'WEEKLY' | 'MONTHLY' {
    if (p === 'WEEKLY' || p === 'MONTHLY') return p;
    throw badRequest('Choose a weekly or monthly period');
  }

  private unit(u?: string): Unit | null {
    if (!u) return null;
    if (!(UNITS as readonly string[]).includes(u)) throw badRequest('Unknown unit');
    return u as Unit;
  }
}
