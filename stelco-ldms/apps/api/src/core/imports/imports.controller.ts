import { Controller, Get, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { Can } from '../../common/decorators';
import { badRequest } from '../../common/errors';
import { qs } from '../../common/zod';
import { ImportsService } from './imports.service';

const kind = z.enum(['contracts', 'laws']);

@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get(':kind/template')
  @Can('draft:draft', 'matter:write', 'cmp:write')
  async template(@Param('kind') k: string, @Res() res: Response) {
    const buf = await this.imports.template(kind.parse(k));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${k}-template.xlsx"`);
    res.end(buf);
  }

  @Post(':kind')
  @Can('draft:draft', 'matter:write', 'cmp:write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  run(@Param('kind') k: string, @UploadedFile() file: Express.Multer.File | undefined, @Query('commit') commit?: unknown) {
    if (!file) throw badRequest('Choose the Excel file');
    return this.imports.run(kind.parse(k), file, qs(commit, 5) === 'true');
  }
}
